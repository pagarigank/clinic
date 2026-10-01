-- 0009_phi_access_log: tracking patient record access (todo 1.4)
-- Partitioned by month, append-only.

SET ROLE clinic_owner;

CREATE TABLE phi_access_log (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid        NOT NULL,
  patient_id   uuid        NOT NULL, -- No FK to patients (erasure anonymizes, doesn't delete log)
  resource     text        NOT NULL,
  purpose      text        NOT NULL,
  request_id   text,
  ip_address   text,
  user_agent   text,
  CONSTRAINT phi_access_log_pk PRIMARY KEY (tenant_id, created_at, id),
  CONSTRAINT phi_access_log_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) PARTITION BY RANGE (created_at);

CREATE INDEX phi_access_log_patient_idx ON phi_access_log (tenant_id, patient_id);

-- Enforce append-only
CREATE FUNCTION app.phi_access_log_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RAISE EXCEPTION 'phi_access_log is append-only; UPDATE and DELETE are forbidden.';
END;
$$;

CREATE TRIGGER phi_access_log_deny_update
  BEFORE UPDATE ON phi_access_log
  FOR EACH ROW EXECUTE FUNCTION app.phi_access_log_append_only();

CREATE TRIGGER phi_access_log_deny_delete
  BEFORE DELETE ON phi_access_log
  FOR EACH ROW EXECUTE FUNCTION app.phi_access_log_append_only();

CREATE TABLE phi_access_log_p_default PARTITION OF phi_access_log DEFAULT;
REVOKE ALL ON phi_access_log_p_default FROM public, clinic_app, clinic_report;

SELECT app.apply_tenant_isolation('phi_access_log');

GRANT SELECT, INSERT ON phi_access_log TO clinic_app;
GRANT SELECT ON phi_access_log TO clinic_report;

RESET ROLE;
