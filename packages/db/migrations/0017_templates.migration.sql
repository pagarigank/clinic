CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('DOCUMENT', 'NOTIFICATION', 'CONSENT')),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, code)
);
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY templates_tenant_isolation ON templates AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY templates_all ON templates FOR ALL USING (true);


CREATE TABLE template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (template_id) REFERENCES templates(id),
    UNIQUE (template_id, version_number)
);
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY template_versions_tenant_isolation ON template_versions AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY template_versions_all ON template_versions FOR ALL USING (true);

