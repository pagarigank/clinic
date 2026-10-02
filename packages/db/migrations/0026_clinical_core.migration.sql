-- Phase 3 — Clinical core (specification.md §7.1, todo.md §3.1–3.2).
-- practitioner_schedules (+exceptions), practitioner_profiles (Q-17 default),
-- appointments with the double-booking exclusion constraint (CLN-T1),
-- queue_tickets (CLN-T2), visits, vitals (CLN-T3).
--
-- Ground rules per table: tenant_id + composite FK to the parent,
-- RLS ENABLED here and FORCED in 0028 (same pattern as Phase 2),
-- (tenant_id, …) index for the schema linter, no SECURITY DEFINER.

-- btree_gist adds the btree equivalence operator classes (=, <) to GiST, which
-- the appointments double-booking EXCLUDE constraint needs for its UUID column.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Phase 2 shipped patients without the composite (tenant_id, id) unique key,
-- which every clinical child table needs for its composite tenant FK (ground
-- rule 1). Add it before the FKs below reference it.
ALTER TABLE patients ADD CONSTRAINT patients_tenant_id_id_key UNIQUE (tenant_id, id);

-- ── Practitioner profiles (Q-17: per-practitioner commercial config) ───────
-- Default shipped per specification §20 Q-17: fees on, PF share recorded but
-- internal-only (never printed/exported to patients).
CREATE TABLE practitioner_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL,
    branch_id UUID REFERENCES branches(id),
    philhealth_accreditation_no TEXT,
    consult_fee_new NUMERIC(14,2),
    consult_fee_follow_up NUMERIC(14,2),
    consult_fee_procedure NUMERIC(14,2),
    free_follow_up_days INTEGER NOT NULL DEFAULT 7,
    pf_share_percent NUMERIC(5,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, user_id, branch_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);
ALTER TABLE practitioner_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY practitioner_profiles_tenant_isolation ON practitioner_profiles
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY practitioner_profiles_tenant_write ON practitioner_profiles
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Practitioner schedule templates (§7.1) ──────────────────────────────────
CREATE TABLE practitioner_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_minutes INTEGER NOT NULL DEFAULT 30,
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, practitioner_id) REFERENCES users(tenant_id, id),
    CONSTRAINT practitioner_schedules_time CHECK (start_time < end_time),
    CONSTRAINT practitioner_schedules_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
ALTER TABLE practitioner_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY practitioner_schedules_tenant_isolation ON practitioner_schedules
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY practitioner_schedules_tenant_write ON practitioner_schedules
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- Exceptions: leave, holidays for one practitioner (CLN-T1 availability input).
CREATE TABLE practitioner_schedule_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    exception_date DATE NOT NULL,
    is_full_day BOOLEAN NOT NULL DEFAULT true,
    start_time TIME,
    end_time TIME,
    reason TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, practitioner_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE practitioner_schedule_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY practitioner_schedule_exceptions_tenant_isolation ON practitioner_schedule_exceptions
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY practitioner_schedule_exceptions_tenant_write ON practitioner_schedule_exceptions
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Appointments (CLN-T1 lifecycle + double-booking prevention) ─────────────
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    service_id UUID,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'BOOKED'
        CHECK (status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT','COMPLETED','CANCELLED','NO_SHOW')),
    channel TEXT NOT NULL DEFAULT 'FRONT_DESK',
    notes TEXT,
    cancel_reason TEXT,
    reminder_sent_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, practitioner_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
    CONSTRAINT appointments_time CHECK (starts_at < ends_at),
    -- Only live appointments hold the practitioner's time; cancelled and
    -- no-show slots are free for rebooking.
    CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
        practitioner_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT'))
);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_tenant_isolation ON appointments
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY appointments_tenant_write ON appointments
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Queue tickets (CLN-T2; walk-in sequential mode issues these on payment) ─
CREATE TABLE queue_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    ticket_no TEXT NOT NULL,
    patient_id UUID NOT NULL,
    visit_id UUID,
    service_unit_id UUID,
    priority SMALLINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING','CALLED','SERVING','DONE','SKIPPED')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    issued_by UUID NOT NULL,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, issued_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, branch_id, ticket_no)
);
ALTER TABLE queue_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY queue_tickets_tenant_isolation ON queue_tickets
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY queue_tickets_tenant_write ON queue_tickets
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Visits (CLN-T2/T4/T9 lifecycle: OPEN → IN_PROGRESS → READY_FOR_BILLING
--    → CLOSED; closed visits are immutable per §7.2) ─────────────────────────
CREATE TABLE visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    visit_no TEXT NOT NULL,
    patient_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    appointment_id UUID,
    queue_ticket_id UUID,
    visit_type TEXT NOT NULL DEFAULT 'OPD'
        CHECK (visit_type IN ('OPD','WALK_IN','FOLLOW_UP','PROCEDURE')),
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','READY_FOR_BILLING','CLOSED','CANCELLED')),
    chief_complaint TEXT,
    cancel_reason TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, practitioner_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
    UNIQUE (tenant_id, visit_no),
    -- Composite tenant key consumed by the 0027 child-table FKs (ground rule 1).
    UNIQUE (tenant_id, id)
);
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY visits_tenant_isolation ON visits
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY visits_tenant_write ON visits
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));

-- ── Vitals (CLN-T3; corrections are logged updates, no delete) ──────────────
CREATE TABLE vitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    visit_id UUID NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    bp_sys SMALLINT,
    bp_dia SMALLINT,
    heart_rate SMALLINT,
    respiratory_rate SMALLINT,
    temperature_c NUMERIC(4,1),
    spo2 SMALLINT,
    weight_kg NUMERIC(5,2),
    height_cm NUMERIC(5,1),
    bmi NUMERIC(4,1),
    pain_score SMALLINT CHECK (pain_score BETWEEN 0 AND 10),
    recorded_by UUID NOT NULL,
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, recorded_by) REFERENCES users(tenant_id, id)
);
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY vitals_tenant_isolation ON vitals
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY vitals_tenant_write ON vitals
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
