-- 0002_ping: minimal tenant-stamped table for the Phase 0 vertical slice and
-- the isolation test harness demo. Replaced by real modules from Phase 1.
-- Own the objects as clinic_owner (the runner RESETs ROLE between scripts,
-- so every post-0001 migration re-enters the owner role itself; the 0001
-- default privileges then apply to everything created here).
SET ROLE clinic_owner;

CREATE TABLE clinic_ping (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinic_ping_tenant_idx ON clinic_ping (tenant_id, created_at DESC);

SELECT app.apply_tenant_isolation('clinic_ping');

-- Ground rule 1: no table with tenant_id ships without the isolation call.
-- app.apply_tenant_isolation above fails the migration if it did not run.
GRANT SELECT, INSERT, DELETE ON clinic_ping TO clinic_app;
RESET ROLE;
