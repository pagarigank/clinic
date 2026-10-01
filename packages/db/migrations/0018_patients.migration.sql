CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_name TEXT,
    date_of_birth DATE NOT NULL,
    gender TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_tenant_isolation ON patients AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patients_all ON patients FOR ALL USING (true);


CREATE INDEX patients_name_trgm_idx ON patients USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

CREATE TABLE patient_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_identifiers_tenant_isolation ON patient_identifiers AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_identifiers_all ON patient_identifiers FOR ALL USING (true);


CREATE TABLE patient_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_contacts_tenant_isolation ON patient_contacts AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_contacts_all ON patient_contacts FOR ALL USING (true);


CREATE TABLE patient_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    substance TEXT NOT NULL,
    severity TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_allergies_tenant_isolation ON patient_allergies AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_allergies_all ON patient_allergies FOR ALL USING (true);


CREATE TABLE patient_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    level TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_flags_tenant_isolation ON patient_flags AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_flags_all ON patient_flags FOR ALL USING (true);


CREATE TABLE patient_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    withdrawn_at TIMESTAMPTZ,
    file_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (template_version_id) REFERENCES template_versions(id)
);
ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_consents_tenant_isolation ON patient_consents AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_consents_all ON patient_consents FOR ALL USING (true);


CREATE TABLE patient_merges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    surviving_patient_id UUID NOT NULL,
    merged_patient_id UUID NOT NULL,
    snapshot_data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (surviving_patient_id) REFERENCES patients(id),
    FOREIGN KEY (merged_patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_merges_tenant_isolation ON patient_merges AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_merges_all ON patient_merges FOR ALL USING (true);

