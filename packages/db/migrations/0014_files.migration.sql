CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCAN_PENDING',
    scan_reason TEXT,
    uploaded_by UUID NOT NULL,
    row_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (tenant_id, uploaded_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, object_key),
    CHECK (status IN ('SCAN_PENDING', 'READY', 'REJECTED'))
);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY files_tenant_isolation ON files
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = (SELECT app.tenant_id()));

CREATE POLICY files_select ON files FOR SELECT USING (true);
CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (true);
CREATE POLICY files_update ON files FOR UPDATE USING (true);

