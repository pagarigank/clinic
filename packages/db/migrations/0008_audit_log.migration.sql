-- 0008_audit_log: the system audit trail (todo 1.4)
-- Partitioned by month, append-only, hash-chained.

SET ROLE clinic_owner;

CREATE TABLE audit_log (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  actor_id            uuid,
  acting_as_platform  boolean     NOT NULL DEFAULT false,
  breakglass_id       uuid,
  action              text        NOT NULL,
  entity_type         text        NOT NULL,
  entity_id           uuid        NOT NULL,
  before_state        jsonb,
  after_state         jsonb,
  request_id          text,
  ip_address          text,
  user_agent          text,
  prev_hash           text,
  row_hash            text,
  CONSTRAINT audit_log_pk PRIMARY KEY (tenant_id, created_at, id),
  CONSTRAINT audit_log_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) PARTITION BY RANGE (created_at);

-- Index for querying by entity
CREATE INDEX audit_log_entity_idx ON audit_log (tenant_id, entity_type, entity_id);

-- Enforce append-only at the database level (todo 1.4)
CREATE FUNCTION app.audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE and DELETE are forbidden.';
END;
$$;

CREATE TRIGGER audit_log_deny_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_append_only();

CREATE TRIGGER audit_log_deny_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_append_only();

-- Setup a default partition so inserts during dev don't fail immediately
-- JOB-08 (partition.maintain) will handle real rolling partitions in production
CREATE TABLE audit_log_p_default PARTITION OF audit_log DEFAULT;

-- Architecture §6.4: REVOKE ALL on child partitions from the runtime role
REVOKE ALL ON audit_log_p_default FROM public, clinic_app, clinic_report;

-- Ground rule 1: RLS enforced on the partitioned parent
SELECT app.apply_tenant_isolation('audit_log');

-- Grant on the partitioned parent
GRANT SELECT, INSERT ON audit_log TO clinic_app;
GRANT SELECT ON audit_log TO clinic_report;

RESET ROLE;
