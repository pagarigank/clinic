-- 0003_platform: platform-side tables (non-PHI, no RLS — architecture §5.5,
-- todo 1.1 "Platform-side tables"). These never hold tenant clinical data:
--  - platform_users        superadmin accounts (TOTP mandatory, arch §10)
--  - subscription_plans    commercial plan catalogue
--  - tenant_directory      pre-auth slug lookup (§5.6 step 1); rows are a
--                          sync copy of tenants, trigger added in 0004
--  - system_settings       versioned, audited global settings
--  - platform_announcements console announcements
-- No tenant_id on any of these → no RLS. Writes happen under platform scope
-- or by the migrator only; tenant_directory gets narrow app grants because
-- the login flow (running as clinic_app before any tenant context) must read
-- it and the sync trigger (invoked by clinic_app writes on tenants) updates it.

-- Own the objects as clinic_owner (the runner RESETs ROLE between scripts,
-- so every post-0001 migration re-enters the owner role itself; the 0001
-- default privileges then apply to everything created here).
SET ROLE clinic_owner;

CREATE TABLE platform_users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  password_hash text        NOT NULL,
  totp_secret   text,                          -- encrypted at rest (Phase 1.2)
  is_active     boolean     NOT NULL DEFAULT true,
  row_version   int         NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

CREATE TABLE subscription_plans (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE tenant_directory (
  id         uuid        PRIMARY KEY,           -- = tenants.id (sync copy)
  slug       text        NOT NULL UNIQUE,
  status     text        NOT NULL DEFAULT 'PROVISIONING'
             CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  version    int         NOT NULL DEFAULT 1,    -- bumped on every write (audited)
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE platform_announcements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text        NOT NULL,
  body       text        NOT NULL,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- tenant_directory is the one platform table clinic_app touches pre-auth
-- (slug → tenant resolution) and the only one it writes (the sync trigger
-- runs with the invoker's rights on tenants writes). No DELETE: offboarded
-- tenants stay as OFFBOARDED rows so a reused slug cannot be silently
-- re-registered. Everything else here is platform-console-only.
GRANT SELECT, INSERT, UPDATE ON tenant_directory TO clinic_app;
REVOKE ALL ON platform_users, subscription_plans, system_settings, platform_announcements FROM clinic_app;
RESET ROLE;
