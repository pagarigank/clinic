CREATE TABLE patient_philhealth (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL UNIQUE,
    pin TEXT NOT NULL,
    membership_category TEXT NOT NULL,
    konsulta_pcp TEXT,
    konsulta_status TEXT NOT NULL DEFAULT 'NOT_REGISTERED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_philhealth ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_philhealth_tenant_isolation ON patient_philhealth AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_philhealth_all ON patient_philhealth FOR ALL USING (true);

CREATE TABLE patient_philhealth_dependents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    dependent_first_name TEXT NOT NULL,
    dependent_last_name TEXT NOT NULL,
    dependent_dob DATE NOT NULL,
    dependent_relationship TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
ALTER TABLE patient_philhealth_dependents ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_philhealth_dependents_tenant_isolation ON patient_philhealth_dependents AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY patient_philhealth_dependents_all ON patient_philhealth_dependents FOR ALL USING (true);
