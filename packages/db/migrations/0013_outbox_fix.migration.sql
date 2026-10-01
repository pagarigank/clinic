-- 0013_outbox_fix migration
-- Fixes RLS policy on outbox to use standard app.tenant_id() instead of current_setting('app.current_tenant_id')
-- Drops NOT NULL constraints on aggregate_type and aggregate_id which are not used by the current application pattern.

ALTER TABLE outbox OWNER TO clinic_owner;

SET ROLE clinic_owner;

ALTER TABLE outbox ALTER COLUMN aggregate_type DROP NOT NULL;
ALTER TABLE outbox ALTER COLUMN aggregate_id DROP NOT NULL;

DROP POLICY IF EXISTS outbox_tenant_isolation_policy ON outbox;

-- Recreate using the standard policy B (tenant_or_platform) because outbox events 
-- can be created by platform scope (e.g. provisioning, breakglass).
CREATE POLICY tenant_or_platform ON outbox
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

RESET ROLE;
