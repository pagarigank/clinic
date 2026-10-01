import { PgBoss } from 'pg-boss';
import { getAppPool } from '@clinic/db/src/pool.js';
import { setTimeout } from 'timers/promises';
import { handleTenantProvision, type ProvisionPayload } from './handlers/provision.handler.js';
import { handleAuditChainVerify } from './handlers/audit-chain.handler.js';

async function bootstrap() {
  const boss = new PgBoss({
    db: {
      executeSql: async (text: string, values: any[]) => {
        const pool = getAppPool();
        const res = await pool.query(text, values);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      }
    }
  });

  boss.on('error', (error: any) => console.error(error));

  await boss.start();

  await boss.createQueue('outbox.dispatch', { policy: 'stately' });
  await boss.schedule('outbox.dispatch', '*/5 * * * * *', null, { tz: 'UTC' });
  await boss.work('outbox.dispatch', async () => {
    const pool = getAppPool();
    const res = await pool.query(
      `UPDATE outbox SET processed_at = now() WHERE processed_at IS NULL RETURNING id, event_type, payload`
    );
    for (const row of res.rows) {
      console.log(`Dispatched outbox event ${row.id} of type ${row.event_type}`);
    }
  });

  // JOB-03: tenant provisioning — key_strict_fifo per "{tenantId}:{module}" (todo 1.5)
  await boss.createQueue('tenant.provision', { policy: 'key_strict_fifo' });
  await boss.work<ProvisionPayload>('tenant.provision', async (jobs) => {
    for (const job of jobs) {
      const payload = job.data;
      if (!payload?.tenantId) {
        throw new Error('JOB-03: invalid payload — missing tenantId');
      }
      await handleTenantProvision(payload);
    }
  });

  await boss.schedule('audit.partition.maintain', '0 0 * * *', null, { tz: 'UTC' });
  await boss.work('audit.partition.maintain', async () => { /* create next month's partition */ });

  // JOB-10: audit hash chain verification (nightly after partition maintenance)
  await boss.schedule('audit.chain.verify', '30 0 * * *', null, { tz: 'UTC' });
  await boss.work('audit.chain.verify', async () => {
    await handleAuditChainVerify();
  });

  await boss.schedule('retention.enforce', '0 1 * * *', null, { tz: 'UTC' });
  await boss.work('retention.enforce', async () => { /* delete old records where tenant configured */ });

  await boss.createQueue('session.cleanup', { policy: 'short' });
  await boss.schedule('session.cleanup', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('session.cleanup', async () => {
    const pool = getAppPool();
    // Sweep expired regular sessions
    await pool.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'expired'
       WHERE revoked_at IS NULL AND expires_at < now()`
    );
    // Sweep expired break-glass sessions (JOB-11 requirement: AC-16)
    const bgResult = await pool.query(
      `UPDATE breakglass_sessions
       SET ended_at = now(), row_version = row_version + 1
       WHERE ended_at IS NULL AND expires_at <= now()`
    );
    if ((bgResult.rowCount ?? 0) > 0) {
      console.log(`JOB-11: swept ${bgResult.rowCount} expired break-glass sessions`);
    }
  });

  await boss.schedule('user.inactive.deactivate', '0 2 * * *', null, { tz: 'UTC' });
  await boss.work('user.inactive.deactivate', async () => { /* deactivate inactive users */ });

  await boss.schedule('credential.expiry.remind', '0 9 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('credential.expiry.remind', async () => { /* remind expiring PRC/S2/PDEA licences */ });

  await boss.createQueue('subscription.check', { policy: 'singleton' });
  await boss.schedule('subscription.check', '0 3 * * *', null, { tz: 'UTC' });
  await boss.work('subscription.check', async () => { /* check subscription */ });

  await boss.createQueue('rls.canary', { policy: 'singleton' });
  await boss.schedule('rls.canary', '*/15 * * * *', null, { tz: 'UTC' });
  await boss.work('rls.canary', async () => { 
    const pool = getAppPool();
    try {
      const res = await pool.query('SELECT current_setting(\'app.current_tenant_id\', true)');
      if (!res.rows[0].current_setting) {
        throw new Error('RLS canary failed: app.current_tenant_id is empty');
      }
    } catch (e) {
      console.error('SECURITY-EVENT: RLS Canary Failed', e);
      throw e;
    }
  });

  await boss.createQueue('report.export', { expireInSeconds: 3600, retentionSeconds: 1209600 });
  await boss.work('report.export', async () => {
    await setTimeout(10000);
  });

  console.log("Worker started");
}

bootstrap().catch(console.error);

