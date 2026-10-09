-- ============================================================================
-- 0063_reconcile_demo_doctor_role
-- ============================================================================
-- WHY
--   The demo tenants' `doctor` role accumulated grants that the DOCTOR role is
--   not supposed to hold under `specification.md` §2.2 / §2.3. The canonical,
--   auditable source of truth is `SYSTEM_ROLE_TEMPLATES.doctor` in
--   `packages/contracts/src/permissions.ts`, mirrored verbatim by
--   `migrations/seeds/demo_clean.sql` §3b (62 codes: Clinical F(own) plus read,
--   order and prescribe across Lab/Pharmacy; NO lab-bench, supply-stock or
--   billing actions).
--
--   The drift came from `scripts/purge-and-seed.mjs` step 9, whose inline
--   DOCTOR_PERMISSIONS list granted lab-bench / supply / pharmacy-stock actions
--   the spec never gives a physician (lab.config.*, lab.result.enter,
--   lab.report.release, lab.specimen.*, supply.req.create,
--   supply.consumption.create, pharmacy.stock.read, ...). That script only
--   INSERTs with `ON CONFLICT DO NOTHING`, so it can never remove a grant once
--   added — the over-grant was permanent.
--
--   The user-visible effect: the web app's namespace-based navigation gating
--   (`frontend.md` §7.2) correctly rendered the Laboratory / Supply / Billing
--   rails to a doctor, because the role genuinely held a permission in those
--   namespaces. The nav code was working as designed; the GRANT DATA was wrong.
--   This migration restores the grant data, so the gating then hides those
--   modules for a doctor.
--
-- WHAT
--   For the DEMO tenants only (demo-a, demo-b), delete every `role_permissions`
--   row on role code = 'doctor' whose permission code is not in the canonical
--   §2.2 set below.
--
--   * Additive-only, idempotent — re-running deletes the same (already gone) rows.
--   * SoD-safe — it only removes grants; it cannot create a sod_conflicts pair.
--   * Scoped — la-salette / bootstrap-probe / other tenants are deliberately NOT
--     touched. Their doctor role may legitimately carry the billing
--     charge-capture grants added by 0044_billing_fixes, which is a separate,
--     deliberate decision outside this reconciliation.
-- ============================================================================

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.tenant_id      = r.tenant_id
  AND rp.role_id        = r.id
  AND rp.permission_id  = p.id
  AND r.tenant_id IN (
        '11111111-1111-4111-8111-111111111111',   -- demo-a
        '22222222-2222-4222-8222-222222222222'    -- demo-b
      )
  AND r.code = 'doctor'
  AND p.code NOT IN (
    -- patient
    'patient.record.read', 'patient.record.update',
    -- clinical: schedule / appointment / queue
    'clinical.schedule.read', 'clinical.schedule.update',
    'clinical.appointment.read', 'clinical.appointment.update',
    'clinical.queue.read',
    -- clinical: visit / vitals
    'clinical.visit.read', 'clinical.visit.create', 'clinical.visit.update',
    'clinical.visit.start', 'clinical.visit.ready', 'clinical.visit.close',
    'clinical.vitals.read', 'clinical.vitals.create', 'clinical.vitals.update',
    -- clinical: notes / diagnoses / procedures
    'clinical.note.read', 'clinical.note.create', 'clinical.note.update',
    'clinical.note.sign', 'clinical.note.amend',
    'clinical.diagnosis.read', 'clinical.diagnosis.create',
    'clinical.diagnosis.update', 'clinical.diagnosis.delete',
    'clinical.procedure.read', 'clinical.procedure.create',
    'clinical.procedure.update', 'clinical.procedure.delete',
    -- clinical: shared supplies / certificates / referrals / problems
    'clinical.supply.read', 'clinical.supply.create',
    'clinical.certificate.read', 'clinical.certificate.create',
    'clinical.referral.read', 'clinical.referral.create', 'clinical.referral.update',
    'clinical.problem.read', 'clinical.problem.create',
    'clinical.problem.update', 'clinical.problem.resolve',
    -- clinical: prescriptions / order sets / templates / immunizations
    'clinical.rx.read', 'clinical.rx.create', 'clinical.rx.update',
    'clinical.rx.sign', 'clinical.rx.cancel',
    'clinical.order_set.read', 'clinical.order_set.create', 'clinical.order_set.update',
    'clinical.template.read', 'clinical.template.create', 'clinical.template.update',
    'clinical.immunization.read', 'clinical.immunization.create',
    -- lab: ordering + reading only (NOT entry/verify/config/bench)
    'lab.order.read', 'lab.order.create', 'lab.result.read', 'lab.report.read',
    -- pharmacy: view the verification queue (prescribe path)
    'pharmacy.rx.read',
    -- platform primitives
    'reference.read', 'files.read', 'files.write', 'notifications.read'
  );
