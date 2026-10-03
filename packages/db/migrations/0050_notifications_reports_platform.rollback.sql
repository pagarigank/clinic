-- 0050_notifications_reports_platform.rollback.sql
DROP TABLE IF EXISTS module_entitlement_audit CASCADE;
DROP TABLE IF EXISTS file_versions CASCADE;
DROP TABLE IF EXISTS report_schedules CASCADE;
DROP TABLE IF EXISTS report_runs CASCADE;
DROP TABLE IF EXISTS report_definitions CASCADE;
DROP TABLE IF EXISTS notification_delivery_logs CASCADE;
DROP TABLE IF EXISTS user_notification_preferences CASCADE;
DROP TABLE IF EXISTS user_notifications CASCADE;
DROP TABLE IF EXISTS plan_modules CASCADE;
ALTER TABLE files DROP COLUMN IF EXISTS scan_status;
ALTER TABLE files DROP COLUMN IF EXISTS preview_object_key;
ALTER TABLE files DROP COLUMN IF EXISTS current_version;
