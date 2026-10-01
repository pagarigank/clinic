-- 0011_outbox migration

CREATE TABLE outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    processed_at timestamp with time zone
);

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_tenant_isolation_policy ON outbox
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_outbox_tenant_id ON outbox(tenant_id);
CREATE INDEX idx_outbox_unprocessed ON outbox(created_at) WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON outbox TO clinic_app;
