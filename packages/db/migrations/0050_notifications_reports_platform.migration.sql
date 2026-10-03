-- 0050_notifications_reports_platform.migration.sql
-- Phase 9: Notifications, files enrichment, reports engine, and platform console completion
SET ROLE clinic_owner;

-- 1. Plan Modules (Platform-side, Commercial Plan Catalogue)
CREATE TABLE IF NOT EXISTS plan_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  module text NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_modules_plan_module_uniq UNIQUE (plan_id, module)
);

-- 2. In-App User Notifications
CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'CLINICAL_ALERT')),
  entity_type text,
  entity_id text,
  deep_link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS user_notifications_tenant_user_idx
  ON user_notifications (tenant_id, user_id, read_at, created_at DESC);

SELECT app.apply_tenant_isolation('user_notifications');

-- 3. User Notification Preferences & Quiet Hours
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channels jsonb NOT NULL DEFAULT '{"in_app": true, "email": true, "sms": false}'::jsonb,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start time DEFAULT '22:00:00',
  quiet_hours_end time DEFAULT '07:00:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notification_preferences_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT user_notification_preferences_user_uniq UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_notification_preferences_tenant_idx
  ON user_notification_preferences (tenant_id, user_id);

SELECT app.apply_tenant_isolation('user_notification_preferences');

-- 4. Notification Delivery Logs
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES user_notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'PUSH')),
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED_QUIET_HOURS')),
  error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_delivery_logs_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS notification_delivery_logs_tenant_idx
  ON notification_delivery_logs (tenant_id, status, created_at DESC);

SELECT app.apply_tenant_isolation('notification_delivery_logs');

-- 5. Report Master Catalogue (Global definitions, non-PHI)
CREATE TABLE IF NOT EXISTS report_definitions (
  id text PRIMARY KEY,
  module text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  permitted_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_period text NOT NULL DEFAULT '30d',
  export_formats jsonb NOT NULL DEFAULT '["CSV", "JSON", "PDF"]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Report Execution Runs (Tenant-scoped)
CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES report_definitions(id),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  row_count int NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  executed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_runs_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS report_runs_tenant_idx
  ON report_runs (tenant_id, report_id, status, created_at DESC);

SELECT app.apply_tenant_isolation('report_runs');

-- 7. Scheduled Report Delivery (Tenant-scoped)
CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES report_definitions(id),
  cron_expression text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  format text NOT NULL DEFAULT 'CSV' CHECK (format IN ('CSV', 'JSON', 'PDF')),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS report_schedules_tenant_idx
  ON report_schedules (tenant_id, is_active);

SELECT app.apply_tenant_isolation('report_schedules');

-- 8. File Versions & Scan Gating
ALTER TABLE files ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'CLEAN' CHECK (scan_status IN ('SCAN_PENDING', 'CLEAN', 'INFECTED'));
ALTER TABLE files ADD COLUMN IF NOT EXISTS preview_object_key text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  object_key text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  scan_status text NOT NULL DEFAULT 'CLEAN' CHECK (scan_status IN ('SCAN_PENDING', 'CLEAN', 'INFECTED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_versions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT file_versions_version_uniq UNIQUE (tenant_id, file_id, version)
);

CREATE INDEX IF NOT EXISTS file_versions_tenant_idx
  ON file_versions (tenant_id, file_id, version DESC);

SELECT app.apply_tenant_isolation('file_versions');

-- 9. Module Entitlement Transparency Audit (RPT-PLT-09)
CREATE TABLE IF NOT EXISTS module_entitlement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module text NOT NULL,
  action text NOT NULL CHECK (action IN ('TICK', 'ENABLE', 'DRAIN', 'DISABLE', 'TRIAL_START', 'TRIAL_EXPIRE')),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  is_forced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_entitlement_audit_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS module_entitlement_audit_tenant_idx
  ON module_entitlement_audit (tenant_id, module, created_at DESC);

SELECT app.apply_tenant_isolation('module_entitlement_audit');

-- 10. Grants for clinic_app and clinic_report
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_modules TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notifications TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_notification_preferences TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_delivery_logs TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_definitions TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_runs TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_versions TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON module_entitlement_audit TO clinic_app;

GRANT SELECT ON plan_modules TO clinic_report;
GRANT SELECT ON user_notifications TO clinic_report;
GRANT SELECT ON user_notification_preferences TO clinic_report;
GRANT SELECT ON notification_delivery_logs TO clinic_report;
GRANT SELECT ON report_definitions TO clinic_report;
GRANT SELECT ON report_runs TO clinic_report;
GRANT SELECT ON report_schedules TO clinic_report;
GRANT SELECT ON file_versions TO clinic_report;
GRANT SELECT ON module_entitlement_audit TO clinic_report;
