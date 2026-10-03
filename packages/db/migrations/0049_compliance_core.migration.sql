-- 0049_compliance_core.migration.sql
-- Phase 8: Compliance, Audit, Consent, DSR, Retention, Breach Management, Access Reviews, PIDSR
-- Specification §12, §18.10, todo.md Phase 8, architecture §21.2


-- 1. Consent Templates (§12.1, todo §8.2)
CREATE TABLE IF NOT EXISTS consent_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  version        INTEGER NOT NULL DEFAULT 1,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  purposes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  locale         TEXT NOT NULL DEFAULT 'en',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  CONSTRAINT consent_templates_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT consent_templates_version_key UNIQUE (tenant_id, locale, version)
);

-- 2. Enrich Patient Consents (§12.1, Phase 2 baseline in 0018)
ALTER TABLE patient_consents ALTER COLUMN template_version_id DROP NOT NULL;
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES consent_templates(id);
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS template_version INTEGER;
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS signed_by_name TEXT;
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS relationship TEXT DEFAULT 'SELF';
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

-- 3. Data Subject Requests (DSR) (§12.1, CMP-T1, AC-15)
CREATE TABLE IF NOT EXISTS data_subject_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  patient_id         UUID NOT NULL,
  request_no         TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('ACCESS', 'CORRECTION', 'ERASURE', 'OBJECTION', 'PORTABILITY')),
  status             TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  due_at             TIMESTAMPTZ NOT NULL,
  identity_verified  BOOLEAN NOT NULL DEFAULT false,
  identity_verified_at TIMESTAMPTZ,
  identity_notes     TEXT,
  handled_by         UUID,
  outcome_note       TEXT,
  export_artifact_id UUID,
  rejection_reason   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT data_subject_requests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT data_subject_requests_no_key UNIQUE (tenant_id, request_no),
  CONSTRAINT data_subject_requests_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- 4. Breach Incidents (§12.1, CMP-T2, Q-2)
CREATE TABLE IF NOT EXISTS breach_incidents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  incident_no            TEXT NOT NULL,
  detected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  description            TEXT NOT NULL,
  severity               TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  data_classes           TEXT[] NOT NULL DEFAULT '{}',
  affected_count         INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'ASSESSED', 'NOTIFIED', 'CLOSED')),
  notify_regulator_due_at TIMESTAMPTZ NOT NULL,
  notified_at            TIMESTAMPTZ,
  notified_regulator     BOOLEAN NOT NULL DEFAULT false,
  notified_subjects      BOOLEAN NOT NULL DEFAULT false,
  corrective_actions     TEXT,
  lessons_learned        TEXT,
  closed_at              TIMESTAMPTZ,
  closed_by              UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT breach_incidents_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT breach_incidents_no_key UNIQUE (tenant_id, incident_no)
);

-- 5. Retention Policies (§12.1, CMP-T5)
CREATE TABLE IF NOT EXISTS retention_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  record_class    TEXT NOT NULL CHECK (record_class IN ('CLINICAL_VISITS', 'CLINICAL_NOTES', 'LAB_ORDERS', 'LAB_RESULTS', 'PRESCRIPTIONS', 'INVOICES', 'PAYMENTS', 'AUDIT_LOGS')),
  retention_years INTEGER NOT NULL CHECK (retention_years >= 1),
  action          TEXT NOT NULL DEFAULT 'ARCHIVE' CHECK (action IN ('ARCHIVE', 'ANONYMIZE', 'DELETE')),
  legal_basis     TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retention_policies_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT retention_policies_class_key UNIQUE (tenant_id, record_class)
);

-- 6. Legal Holds (§12.1, CMP-T1/T5)
CREATE TABLE IF NOT EXISTS legal_holds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  hold_no        TEXT NOT NULL,
  scope          TEXT NOT NULL CHECK (scope IN ('PATIENT', 'RECORD_CLASS', 'ENTIRE_TENANT')),
  patient_id     UUID,
  record_class   TEXT,
  reason         TEXT NOT NULL,
  placed_by      UUID,
  placed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at    TIMESTAMPTZ,
  released_by    UUID,
  release_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT legal_holds_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT legal_holds_no_key UNIQUE (tenant_id, hold_no)
);

-- 7. Retention Candidates (JOB-15)
CREATE TABLE IF NOT EXISTS retention_candidates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  policy_id              UUID NOT NULL,
  record_class           TEXT NOT NULL,
  entity_id              UUID NOT NULL,
  entity_ref             TEXT NOT NULL,
  patient_id             UUID,
  eligible_at            TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'HELD', 'EXECUTED', 'REJECTED')),
  held_by_legal_hold_id  UUID,
  reviewed_by            UUID,
  reviewed_at            TIMESTAMPTZ,
  executed_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retention_candidates_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT retention_candidates_policy_fkey FOREIGN KEY (tenant_id, policy_id) REFERENCES retention_policies(tenant_id, id)
);

-- 8. Security Events (§12.1, JOB-10, rls.canary)
CREATE TABLE IF NOT EXISTS security_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  event_type     TEXT NOT NULL CHECK (event_type IN ('LOGIN_FAIL', 'LOCKOUT', 'MFA_RESET', 'ROLE_CHANGE', 'RLS_CANARY_FAIL', 'AUDIT_CHAIN_BREAK', 'SECURITY_ANOMALY')),
  severity       TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  actor_id       UUID,
  target_user_id UUID,
  ip_address     TEXT,
  user_agent     TEXT,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT security_events_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- Append-only trigger for security_events
CREATE OR REPLACE FUNCTION app.security_events_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RAISE EXCEPTION 'security_events is append-only; UPDATE and DELETE are forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS security_events_deny_update ON security_events;
CREATE TRIGGER security_events_deny_update
  BEFORE UPDATE ON security_events
  FOR EACH ROW EXECUTE FUNCTION app.security_events_append_only();

DROP TRIGGER IF EXISTS security_events_deny_delete ON security_events;
CREATE TRIGGER security_events_deny_delete
  BEFORE DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION app.security_events_append_only();

-- 9. Access Reviews (§12.1, CMP-T3, ADM-T5)
CREATE TABLE IF NOT EXISTS access_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  campaign_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  reviewer_id   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_reviews_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS access_review_decisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  review_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  role_id     UUID NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('MAINTAIN', 'REVOKE', 'MODIFY')),
  notes       TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by  UUID,
  CONSTRAINT access_review_decisions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT access_review_decisions_review_fkey FOREIGN KEY (tenant_id, review_id) REFERENCES access_reviews(tenant_id, id),
  CONSTRAINT access_review_decisions_user_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
  CONSTRAINT access_review_decisions_role_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);

-- 10. PIDSR Notifiable Disease Cases (todo §8.4, Q-16, RA 11332)
CREATE TABLE IF NOT EXISTS pidsr_cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID NOT NULL,
  case_no        TEXT NOT NULL,
  patient_id     UUID NOT NULL,
  visit_id       UUID,
  disease_code   TEXT NOT NULL,
  disease_name   TEXT NOT NULL,
  icd10_code     TEXT NOT NULL,
  date_of_onset  DATE NOT NULL,
  classification TEXT NOT NULL DEFAULT 'SUSPECTED' CHECK (classification IN ('SUSPECTED', 'PROBABLE', 'CONFIRMED')),
  cif_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'REPORTED', 'ARCHIVED')),
  reported_at    TIMESTAMPTZ,
  reported_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pidsr_cases_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pidsr_cases_no_key UNIQUE (tenant_id, case_no),
  CONSTRAINT pidsr_cases_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT pidsr_cases_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- ── 11. Apply Tenant Isolation (RLS ENABLED and FORCED) ─────────────────────
SELECT app.apply_tenant_isolation('consent_templates');
SELECT app.apply_tenant_isolation('data_subject_requests');
SELECT app.apply_tenant_isolation('breach_incidents');
SELECT app.apply_tenant_isolation('retention_policies');
SELECT app.apply_tenant_isolation('legal_holds');
SELECT app.apply_tenant_isolation('retention_candidates');
SELECT app.apply_tenant_isolation('security_events');
SELECT app.apply_tenant_isolation('access_reviews');
SELECT app.apply_tenant_isolation('access_review_decisions');
SELECT app.apply_tenant_isolation('pidsr_cases');

-- ── 12. Tenant Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS consent_templates_tenant_idx ON consent_templates (tenant_id);

CREATE INDEX IF NOT EXISTS data_subject_requests_tenant_idx ON data_subject_requests (tenant_id);
CREATE INDEX IF NOT EXISTS data_subject_requests_tenant_patient_idx ON data_subject_requests (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS data_subject_requests_tenant_status_due_idx ON data_subject_requests (tenant_id, status, due_at);

CREATE INDEX IF NOT EXISTS breach_incidents_tenant_idx ON breach_incidents (tenant_id);
CREATE INDEX IF NOT EXISTS breach_incidents_tenant_status_deadline_idx ON breach_incidents (tenant_id, status, notify_regulator_due_at);

CREATE INDEX IF NOT EXISTS retention_policies_tenant_idx ON retention_policies (tenant_id);
CREATE INDEX IF NOT EXISTS legal_holds_tenant_idx ON legal_holds (tenant_id);
CREATE INDEX IF NOT EXISTS legal_holds_tenant_patient_idx ON legal_holds (tenant_id, patient_id) WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS retention_candidates_tenant_idx ON retention_candidates (tenant_id);
CREATE INDEX IF NOT EXISTS retention_candidates_tenant_status_idx ON retention_candidates (tenant_id, status);

CREATE INDEX IF NOT EXISTS security_events_tenant_idx ON security_events (tenant_id);
CREATE INDEX IF NOT EXISTS security_events_tenant_type_idx ON security_events (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS access_reviews_tenant_idx ON access_reviews (tenant_id);
CREATE INDEX IF NOT EXISTS access_review_decisions_tenant_idx ON access_review_decisions (tenant_id);
CREATE INDEX IF NOT EXISTS access_review_decisions_tenant_review_idx ON access_review_decisions (tenant_id, review_id);

CREATE INDEX IF NOT EXISTS pidsr_cases_tenant_idx ON pidsr_cases (tenant_id);
CREATE INDEX IF NOT EXISTS pidsr_cases_tenant_patient_idx ON pidsr_cases (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS pidsr_cases_tenant_status_idx ON pidsr_cases (tenant_id, status);

-- ── 13. Application Role Grants ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  consent_templates, data_subject_requests,
  breach_incidents, retention_policies, legal_holds,
  retention_candidates, access_reviews, access_review_decisions, pidsr_cases
TO clinic_app;

GRANT SELECT, INSERT, UPDATE ON patient_consents TO clinic_app;

GRANT SELECT, INSERT ON security_events TO clinic_app;
REVOKE UPDATE, DELETE ON security_events FROM clinic_app, clinic_report, PUBLIC;

GRANT SELECT ON
  consent_templates, patient_consents, data_subject_requests,
  breach_incidents, retention_policies, legal_holds,
  retention_candidates, security_events, access_reviews, access_review_decisions, pidsr_cases
TO clinic_report;

