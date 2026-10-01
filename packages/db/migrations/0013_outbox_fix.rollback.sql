-- 0013_outbox_fix rollback

SET ROLE clinic_owner;

DROP POLICY IF EXISTS tenant_or_platform ON outbox;

CREATE POLICY outbox_tenant_isolation_policy ON outbox
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE outbox ALTER COLUMN aggregate_type SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN aggregate_id SET NOT NULL;

RESET ROLE;
