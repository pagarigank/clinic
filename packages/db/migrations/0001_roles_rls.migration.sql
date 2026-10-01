-- 0001_roles_rls: DB roles, context helpers, tenant-isolation helper, grants.
-- Run by the local superuser (migrator; todo.md line 10 credentials).
-- Architecture §6.1–§6.3, todo 0.2.

-- Roles -------------------------------------------------------------------
-- The migrator is the machine's native superuser (todo.md); the two runtime
-- roles are created here so the stack is reproducible on any machine.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_app') THEN
    CREATE ROLE clinic_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'clinic_app_dev';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_report') THEN
    CREATE ROLE clinic_report LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'clinic_report_dev';
  END IF;
END
$$;

-- The superuser owns every object it creates; transfer ownership to a dedicated
-- NOLOGIN owner role so runtime code never connects as a superuser.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_owner') THEN
    CREATE ROLE clinic_owner NOLOGIN;
  END IF;
END
$$;
ALTER SCHEMA public OWNER TO clinic_owner;
GRANT ALL ON SCHEMA public TO clinic_owner;
ALTER DATABASE clinic OWNER TO clinic_owner;
SET ROLE clinic_owner;

-- Context helpers (SECURITY INVOKER — architecture §2.3, §6.2) -------------
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION clinic_owner;

CREATE OR REPLACE FUNCTION app.tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.is_platform() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.scope', true), '') = 'platform' $$;

CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.branch_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.branch_id', true), '')::uuid $$;

-- Tenant-isolation helper (architecture §6.6b). SECURITY INVOKER: it only
-- emits the ALTER/CREATE POLICY statements; whoever runs a migration must
-- already be privileged. Every tenant table calls this after creation.
CREATE OR REPLACE FUNCTION app.apply_tenant_isolation(p_table text) RETURNS void
LANGUAGE plpgsql AS
$$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', p_table);
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON %I
      USING      (tenant_id = (SELECT app.tenant_id()))
      WITH CHECK (tenant_id = (SELECT app.tenant_id()))
  $f$, p_table);
END
$$;

-- Grants -------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, app TO clinic_app, clinic_report;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO clinic_app;
ALTER DEFAULT PRIVILEGES FOR ROLE clinic_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
ALTER DEFAULT PRIVILEGES FOR ROLE clinic_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO clinic_report;
