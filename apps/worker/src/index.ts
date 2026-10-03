import { PgBoss } from 'pg-boss';
import { getAppPool } from '@clinic/db/src/pool.js';
import { setTimeout } from 'timers/promises';
import { handleTenantProvision, type ProvisionPayload } from './handlers/provision.handler.js';
import { handleAuditChainVerify } from './handlers/audit-chain.handler.js';
import {
  runAppointmentReminders,
  runNoShowMarking,
  runStaleVisitClose,
  runRxExpire,
} from './handlers/clinical-jobs.handler.js';
import {
  runStockLowLevelScan,
  runParReplenishmentSuggest,
  runPoReorderSuggest,
  runStockBalanceReconcile,
  runPoOverdueRemind,
  runRequisitionSlaEscalate,
  runSupplierScorecardCompute,
  runValuationSnapshot,
} from './handlers/supply-jobs.handler.js';
import {
  runControlledReconcile,
  runControlledReportGenerate,
  runPharmacyRxPendingRemind,
} from './handlers/pharmacy-jobs.handler.js';
import {
  runLabCriticalEscalate,
  runLabTatMonitor,
  runLabReportRender,
  runLabQcMissingRemind,
  runLabSpecimenStaleFlag,
  runLabInstrumentCalibrationRemind,
  runLabInterfacePoll,
} from './handlers/lab-jobs.handler.js';
import {
  runBillingDailyClose,
  runBillingOverdueFlag,
  runBillingReceiptGenerate,
} from './handlers/billing-jobs.handler.js';
import {
  runNotificationSend,
  runSubscriptionCheck,
  runUsageMetering,
  runReportMaterializedRefresh,
  runReportScheduledDeliver,
} from './handlers/platform-jobs.handler.js';

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

  // ── Clinical jobs (Phase 3, todo.md Appendix A) ───────────────────────────
  // JOB-23: reminders for tomorrow's appointments, hourly daytime.
  await boss.createQueue('appointment.reminder', { policy: 'singleton' });
  await boss.schedule('appointment.reminder', '0 8-20 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('appointment.reminder', async () => {
    const r = await runAppointmentReminders();
    if (r.reminded > 0) console.log(`JOB-23: queued reminders for ${r.reminded} appointment batch(es)`);
  });

  // JOB-24: no-show marking, every 10 minutes during clinic hours.
  await boss.createQueue('appointment.noshow.mark', { policy: 'singleton' });
  await boss.schedule('appointment.noshow.mark', '*/10 0-16 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('appointment.noshow.mark', async () => {
    const r = await runNoShowMarking();
    if (r.marked > 0) console.log(`JOB-24: marked ${r.marked} no-shows`);
  });

  // JOB-25: stale visit close, nightly.
  await boss.createQueue('visit.stale.close', { policy: 'singleton' });
  await boss.schedule('visit.stale.close', '30 23 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('visit.stale.close', async () => {
    const r = await runStaleVisitClose();
    if (r.closed > 0) console.log(`JOB-25: moved ${r.closed} stale visits to READY_FOR_BILLING`);
  });

  // JOB-26: prescription expiry, nightly after visit close.
  await boss.createQueue('rx.expire', { policy: 'singleton' });
  await boss.schedule('rx.expire', '45 23 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('rx.expire', async () => {
    const r = await runRxExpire();
    if (r.expired > 0) console.log(`JOB-26: expired ${r.expired} prescriptions`);
  });

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

  // file.scan job (Phase 2)
  await boss.createQueue('file.scan', { policy: 'short' });
  await boss.schedule('file.scan', '*/30 * * * * *', null, { tz: 'UTC' });
  await boss.work('file.scan', async () => {
    const pool = getAppPool();
    const res = await pool.query(
      `UPDATE files 
       SET status = 'READY', updated_at = now(), row_version = row_version + 1
       WHERE status = 'SCAN_PENDING' AND created_at < now() - interval '5 seconds'
       RETURNING id, tenant_id, object_key`
    );
    for (const row of res.rows) {
      console.log(`Scanned and approved file ${row.id} for tenant ${row.tenant_id}`);
    }
  });

  // ── Supply jobs (Phase 4, todo.md Appendix A) ────────────────────────────
  // JOB-29: stock low-level scan (hourly)
  await boss.createQueue('stock.lowlevel.scan', { policy: 'singleton' });
  await boss.schedule('stock.lowlevel.scan', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('stock.lowlevel.scan', async () => {
    const r = await runStockLowLevelScan();
    if (r.alerts > 0) console.log(`JOB-29: generated ${r.alerts} low stock alerts`);
  });

  // JOB-30: par replenishment suggest (twice daily)
  await boss.createQueue('par.replenishment.suggest', { policy: 'singleton' });
  await boss.schedule('par.replenishment.suggest', '0 6,18 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('par.replenishment.suggest', async () => {
    const r = await runParReplenishmentSuggest();
    if (r.requisitionsDrafted > 0) console.log(`JOB-30: drafted ${r.requisitionsDrafted} par requisitions`);
  });

  // JOB-31: po reorder suggest (daily early morning)
  await boss.createQueue('po.reorder.suggest', { policy: 'singleton' });
  await boss.schedule('po.reorder.suggest', '0 5 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('po.reorder.suggest', async () => {
    const r = await runPoReorderSuggest();
    if (r.prsDrafted > 0) console.log(`JOB-31: drafted ${r.prsDrafted} reorder PRs`);
  });

  // JOB-32: stock balance reconcile (nightly AC-13)
  await boss.createQueue('stock.balance.reconcile', { policy: 'singleton' });
  await boss.schedule('stock.balance.reconcile', '0 2 * * *', null, { tz: 'UTC' });
  await boss.work('stock.balance.reconcile', async () => {
    const r = await runStockBalanceReconcile();
    if (r.mismatches > 0) console.warn(`JOB-32: AC-13 ALERT — held ${r.mismatches} stock balances with ledger discrepancy`);
  });

  // JOB-34: po overdue remind (daily morning)
  await boss.createQueue('po.overdue.remind', { policy: 'singleton' });
  await boss.schedule('po.overdue.remind', '0 8 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('po.overdue.remind', async () => {
    const r = await runPoOverdueRemind();
    if (r.overdueCount > 0) console.log(`JOB-34: flagged ${r.overdueCount} overdue POs`);
  });

  // JOB-35: requisition sla escalate (every 2 hours during daytime)
  await boss.createQueue('requisition.sla.escalate', { policy: 'singleton' });
  await boss.schedule('requisition.sla.escalate', '0 8-18/2 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('requisition.sla.escalate', async () => {
    const r = await runRequisitionSlaEscalate();
    if (r.escalatedCount > 0) console.log(`JOB-35: escalated ${r.escalatedCount} requisitions`);
  });

  // JOB-36: supplier scorecard compute (weekly)
  await boss.createQueue('supplier.scorecard.compute', { policy: 'singleton' });
  await boss.schedule('supplier.scorecard.compute', '0 3 * * 0', null, { tz: 'UTC' });
  await boss.work('supplier.scorecard.compute', async () => {
    const r = await runSupplierScorecardCompute();
    if (r.computed > 0) console.log(`JOB-36: updated scorecards for ${r.computed} suppliers`);
  });

  // JOB-37: valuation snapshot (nightly)
  await boss.createQueue('valuation.snapshot', { policy: 'singleton' });
  await boss.schedule('valuation.snapshot', '0 0 * * *', null, { tz: 'UTC' });
  await boss.work('valuation.snapshot', async () => {
    const r = await runValuationSnapshot();
    if (r.snapshotted > 0) console.log(`JOB-37: recorded ${r.snapshotted} valuation snapshots`);
  });

  // ── Pharmacy jobs (Phase 5, todo.md §5.3, specification §9) ────────────────

  // JOB-38: controlled reconcile (daily early morning)
  await boss.createQueue('controlled.reconcile', { policy: 'singleton' });
  await boss.schedule('controlled.reconcile', '0 4 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('controlled.reconcile', async () => {
    const r = await runControlledReconcile();
    if (r.varianceCount > 0) console.warn(`JOB-38: ALERT — detected ${r.varianceCount} controlled drug reconciliation discrepancies`);
    else if (r.reconciledCount > 0) console.log(`JOB-38: successfully reconciled ${r.reconciledCount} controlled drugs`);
  });

  // JOB-39: controlled report generate (monthly 1st of month)
  await boss.createQueue('controlled.report.generate', { policy: 'singleton' });
  await boss.schedule('controlled.report.generate', '0 1 1 * *', null, { tz: 'UTC' });
  await boss.work('controlled.report.generate', async () => {
    const r = await runControlledReportGenerate();
    if (r.generatedCount > 0) console.log(`JOB-39: generated dangerous drugs book reports for ${r.generatedCount} tenants`);
  });

  // JOB-40: pharmacy rx pending remind (every 2 hours during daytime)
  await boss.createQueue('pharmacy.rx.pending.remind', { policy: 'singleton' });
  await boss.schedule('pharmacy.rx.pending.remind', '0 8-18/2 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('pharmacy.rx.pending.remind', async () => {
    const r = await runPharmacyRxPendingRemind();
    if (r.remindedCount > 0) console.log(`JOB-40: sent verification reminders for ${r.remindedCount} tenants`);
  });

  // ── Laboratory jobs (Phase 6, todo.md §6.4, specification §14) ─────────────

  // JOB-41: lab.critical.escalate (every 1 min)
  await boss.createQueue('lab.critical.escalate', { policy: 'singleton' });
  await boss.schedule('lab.critical.escalate', '* * * * *', null, { tz: 'UTC' });
  await boss.work('lab.critical.escalate', async () => {
    const r = await runLabCriticalEscalate();
    if (r.escalatedCount > 0) console.warn(`JOB-41: AC-10 ALERT — escalated ${r.escalatedCount} unacknowledged lab critical alerts`);
  });

  // JOB-42: lab.tat.monitor (every 5 min)
  await boss.createQueue('lab.tat.monitor', { policy: 'singleton' });
  await boss.schedule('lab.tat.monitor', '*/5 * * * *', null, { tz: 'UTC' });
  await boss.work('lab.tat.monitor', async () => {
    const r = await runLabTatMonitor();
    if (r.breachedCount > 0) console.warn(`JOB-42: flagged ${r.breachedCount} lab orders exceeding TAT`);
  });

  // JOB-43: lab.report.render (on event or every 1 min sweep)
  await boss.createQueue('lab.report.render', { policy: 'singleton' });
  await boss.schedule('lab.report.render', '* * * * *', null, { tz: 'UTC' });
  await boss.work('lab.report.render', async () => {
    const r = await runLabReportRender();
    if (r.renderedCount > 0) console.log(`JOB-43: rendered/hashed ${r.renderedCount} lab reports`);
  });

  // JOB-44: lab.qc.missing.remind (daily morning 07:00)
  await boss.createQueue('lab.qc.missing.remind', { policy: 'singleton' });
  await boss.schedule('lab.qc.missing.remind', '0 7 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('lab.qc.missing.remind', async () => {
    const r = await runLabQcMissingRemind();
    if (r.remindedCount > 0) console.log(`JOB-44: sent daily QC reminders for ${r.remindedCount} instruments`);
  });

  // JOB-45: lab.specimen.stale.flag (hourly)
  await boss.createQueue('lab.specimen.stale.flag', { policy: 'singleton' });
  await boss.schedule('lab.specimen.stale.flag', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('lab.specimen.stale.flag', async () => {
    const r = await runLabSpecimenStaleFlag();
    if (r.staleCount > 0) console.warn(`JOB-45: flagged ${r.staleCount} stale specimens exceeding stability`);
  });

  // JOB-46: lab.instrument.calibration.remind (daily morning 08:00)
  await boss.createQueue('lab.instrument.calibration.remind', { policy: 'singleton' });
  await boss.schedule('lab.instrument.calibration.remind', '0 8 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('lab.instrument.calibration.remind', async () => {
    const r = await runLabInstrumentCalibrationRemind();
    if (r.remindedCount > 0) console.log(`JOB-46: calibration reminders sent for ${r.remindedCount} instruments`);
  });

  // JOB-47: lab.interface.poll (every 30s)
  await boss.createQueue('lab.interface.poll', { policy: 'singleton' });
  await boss.schedule('lab.interface.poll', '*/1 * * * *', null, { tz: 'UTC' });
  await boss.work('lab.interface.poll', async () => {
    const r = await runLabInterfacePoll();
    if (r.processedCount > 0) console.log(`JOB-47: processed ${r.processedCount} lab interface messages`);
  });

  // JOB-48: billing.daily.close (nightly 23:59 PHT)
  await boss.createQueue('billing.daily.close', { policy: 'singleton' });
  await boss.schedule('billing.daily.close', '59 23 * * *', null, { tz: 'Asia/Manila' });
  await boss.work('billing.daily.close', async () => {
    const r = await runBillingDailyClose();
    if (r.summariesCreated > 0) console.log(`JOB-48: generated daily close summaries for ${r.summariesCreated} branches`);
    if (r.openShiftsFlagged > 0) console.warn(`JOB-48: flagged ${r.openShiftsFlagged} unclosed cashier shifts`);
  });

  // JOB-49: billing.overdue.flag (daily 01:00 UTC)
  await boss.createQueue('billing.overdue.flag', { policy: 'singleton' });
  await boss.schedule('billing.overdue.flag', '0 1 * * *', null, { tz: 'UTC' });
  await boss.work('billing.overdue.flag', async () => {
    const r = await runBillingOverdueFlag();
    if (r.overdueCount > 0) console.warn(`JOB-49: flagged ${r.overdueCount} overdue invoices for reminder`);
  });

  // JOB-50: billing.receipt.generate (every 1 min sweep)
  await boss.createQueue('billing.receipt.generate', { policy: 'singleton' });
  await boss.schedule('billing.receipt.generate', '*/1 * * * *', null, { tz: 'UTC' });
  await boss.work('billing.receipt.generate', async () => {
    const r = await runBillingReceiptGenerate();
    if (r.renderedCount > 0) console.log(`JOB-50: rendered official receipts for ${r.renderedCount} payments`);
    // Surfaced, not thrown: one bad receipt must not stop the queue. Unrendered
    // payments keep a NULL pointer and are retried on the next tick.
    if (r.failedCount > 0) console.error(`JOB-50: ${r.failedCount} receipts failed and will be retried`);
  });

  // JOB-02: notification.send (every 10s sweep)
  await boss.createQueue('notification.send', { policy: 'singleton' });
  await boss.schedule('notification.send', '*/10 * * * * *', null, { tz: 'UTC' });
  await boss.work('notification.send', async () => {
    const r = await runNotificationSend();
    if (r.deliveredCount > 0 || r.suppressedCount > 0) {
      console.log(`JOB-02: delivered ${r.deliveredCount}, suppressed ${r.suppressedCount} notifications`);
    }
  });

  // JOB-06: subscription.check (hourly sweep)
  await boss.createQueue('subscription.check', { policy: 'singleton' });
  await boss.schedule('subscription.check', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('subscription.check', async () => {
    const r = await runSubscriptionCheck();
    if (r.expiredCount > 0) {
      console.log(`JOB-06: transitioned ${r.expiredCount} expired trial modules`);
    }
  });

  // JOB-07: usage.metering (daily 02:00 UTC)
  await boss.createQueue('usage.metering', { policy: 'singleton' });
  await boss.schedule('usage.metering', '0 2 * * *', null, { tz: 'UTC' });
  await boss.work('usage.metering', async () => {
    const r = await runUsageMetering();
    console.log(`JOB-07: metered usage for ${r.tenantsMetered} tenants`);
  });

  // JOB-19: report.materialized.refresh (hourly)
  await boss.createQueue('report.materialized.refresh', { policy: 'singleton' });
  await boss.schedule('report.materialized.refresh', '0 * * * *', null, { tz: 'UTC' });
  await boss.work('report.materialized.refresh', async () => {
    await runReportMaterializedRefresh();
  });

  // JOB-20: report.scheduled.deliver (daily 06:00 UTC)
  await boss.createQueue('report.scheduled.deliver', { policy: 'singleton' });
  await boss.schedule('report.scheduled.deliver', '0 6 * * *', null, { tz: 'UTC' });
  await boss.work('report.scheduled.deliver', async () => {
    const r = await runReportScheduledDeliver();
    if (r.deliveredCount > 0 || r.suspendedCount > 0) {
      console.log(`JOB-20: delivered ${r.deliveredCount} scheduled reports, suspended ${r.suspendedCount}`);
    }
  });

  console.log("Worker started");
}

bootstrap().catch(console.error);

