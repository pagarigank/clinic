import { PgBoss } from 'pg-boss';
import { getAppPool } from '@clinic/db/src/pool.js';
import { setTimeout } from 'timers/promises';

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

  await boss.schedule('audit.partition.maintain', '0 0 * * *', null, { tz: 'UTC' });
  await boss.work('audit.partition.maintain', async () => { /* create next month's partition */ });

  await boss.schedule('retention.enforce', '0 1 * * *', null, { tz: 'UTC' });
  await boss.work('retention.enforce', async () => { /* delete old records where tenant configured */ });

  await boss.createQueue('session.cleanup', { policy: 'short' });
  await boss.schedule('session.cleanup', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('session.cleanup', async () => { /* sweep expired sessions */ });

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
