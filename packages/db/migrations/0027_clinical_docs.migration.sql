-- Phase 3 — Clinical notes, diagnoses, procedures, prescriptions, certificates,
-- referrals, order sets and templates (specification.md §7.1, todo.md §3.2–3.3).
-- Second half of the clinical schema; depends on 0026's visits table.

-- ── Clinical notes (CLN-T4: SOAP; signing locks, later changes are addenda) ─
CREATE TABLE clinical_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    note_type TEXT NOT NULL DEFAULT 'SOAP' CHECK (note_type IN ('SOAP','PROGRESS','PROCEDURE')),
    subjective TEXT,
    objective TEXT,
    assessment TEXT,
    plan TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SIGNED','AMENDED')),
    signed_by UUID,
    signed_at TIMESTAMPTZ,
    amends_id UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, signed_by) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinical_notes_tenant_isolation ON clinical_notes
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY clinical_notes_tenant_write ON clinical_notes
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Diagnoses on the visit + the patient's standing problem list ────────────
CREATE TABLE visit_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    icd10_code TEXT NOT NULL,
    dx_type TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (dx_type IN ('PRIMARY','SECONDARY')),
    certainty TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (certainty IN ('CONFIRMED','PROVISIONAL')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE visit_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY visit_diagnoses_tenant_isolation ON visit_diagnoses
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY visit_diagnoses_tenant_write ON visit_diagnoses
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

CREATE TABLE problem_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    patient_id UUID NOT NULL,
    icd10_code TEXT NOT NULL,
    onset_date DATE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE problem_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY problem_list_tenant_isolation ON problem_list
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY problem_list_tenant_write ON problem_list
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Procedures performed during a visit (posts a charge — Phase 3 contract) ─
CREATE TABLE visit_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    service_id UUID NOT NULL,
    performed_by UUID NOT NULL,
    notes TEXT,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, performed_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE visit_procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY visit_procedures_tenant_isolation ON visit_procedures
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY visit_procedures_tenant_write ON visit_procedures
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Immunizations (lot → stock batch link is a Phase 4 FK; kept nullable) ───
CREATE TABLE immunizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    patient_id UUID NOT NULL,
    visit_id UUID,
    vaccine TEXT NOT NULL,
    dose_no SMALLINT NOT NULL DEFAULT 1,
    lot_no TEXT,
    stock_batch_id UUID,
    site TEXT,
    given_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    given_by UUID NOT NULL,
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, given_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE immunizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY immunizations_tenant_isolation ON immunizations
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY immunizations_tenant_write ON immunizations
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Prescriptions (CLN-T5: draft → issue locks; issued Rx immutable) ────────
CREATE TABLE prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    prescriber_id UUID NOT NULL,
    rx_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ISSUED','PARTIALLY_DISPENSED','DISPENSED','EXPIRED','CANCELLED')),
    is_controlled BOOLEAN NOT NULL DEFAULT false,
    special_rx_no TEXT,
    qty_words TEXT,
    valid_until DATE,
    issued_at TIMESTAMPTZ,
    issued_by UUID,
    cancel_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, prescriber_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, issued_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, rx_no),
    UNIQUE (tenant_id, id)
);
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prescriptions_tenant_isolation ON prescriptions
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY prescriptions_tenant_write ON prescriptions
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

CREATE TABLE prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    rx_id UUID NOT NULL,
    drug_product_id UUID,
    generic_name TEXT NOT NULL,
    brand_name TEXT,
    strength TEXT,
    form TEXT,
    route TEXT,
    sig_dose TEXT NOT NULL,
    sig_frequency TEXT NOT NULL,
    sig_duration TEXT,
    qty_prescribed NUMERIC(12,2) NOT NULL,
    dispense_as_written BOOLEAN NOT NULL DEFAULT false,
    qty_dispensed NUMERIC(12,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (tenant_id, rx_id) REFERENCES prescriptions(tenant_id, id)
);
ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY prescription_items_tenant_isolation ON prescription_items
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY prescription_items_tenant_write ON prescription_items
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Certificates and referrals (numbered via app.next_doc_no) ───────────────
CREATE TABLE medical_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    cert_type TEXT NOT NULL CHECK (cert_type IN ('FIT_TO_WORK','SICK_LEAVE','CLEARANCE')),
    findings TEXT,
    valid_from DATE,
    valid_to DATE,
    doc_no TEXT NOT NULL,
    issued_by UUID NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    void_reason TEXT,
    file_id UUID,
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, issued_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, doc_no)
);
ALTER TABLE medical_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_certificates_tenant_isolation ON medical_certificates
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY medical_certificates_tenant_write ON medical_certificates
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    to_facility TEXT,
    to_practitioner TEXT,
    reason TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'ROUTINE' CHECK (urgency IN ('ROUTINE','URGENT','STAT')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referrals_tenant_isolation ON referrals
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY referrals_tenant_write ON referrals
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Order sets + note templates (§7.1) ──────────────────────────────────────
CREATE TABLE order_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE order_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_sets_tenant_isolation ON order_sets
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY order_sets_tenant_write ON order_sets
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

CREATE TABLE clinical_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    practitioner_id UUID,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    FOREIGN KEY (tenant_id, practitioner_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE clinical_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinical_templates_tenant_isolation ON clinical_templates
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY clinical_templates_tenant_write ON clinical_templates
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Charge capture (Appendix A2: `billing.charge.create` owner = Phase 3).
-- Billed modules post charge lines here; the Phase 7 invoice consumes them.
-- PHI-safe: no diagnosis text, only service references and amounts. ─────────
CREATE TABLE billing_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    visit_id UUID NOT NULL,
    charge_type TEXT NOT NULL CHECK (charge_type IN ('CONSULT','PROCEDURE','LAB','PHARMACY','SUPPLY','OTHER')),
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    service_id UUID,
    description TEXT NOT NULL,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(14,2) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    payer_type TEXT NOT NULL DEFAULT 'PRIVATE_CASH'
        CHECK (payer_type IN ('PRIVATE_CASH','HMO','PHILHEALTH','CORPORATE')),
    posted_by UUID NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, posted_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, source_type, source_id)
);
ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_charges_tenant_isolation ON billing_charges
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY billing_charges_tenant_write ON billing_charges
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
