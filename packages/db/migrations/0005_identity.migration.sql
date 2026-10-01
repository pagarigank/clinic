-- 0005_identity: users, RBAC, sessions, and auth-support tables
-- (todo 1.1 ⛔ + 1.2/1.3; architecture §10). All tenant-scoped → policy B
-- (administrative: platform must be able to list/manage via console).
-- login_attempts and password_resets are written by the login flow, which
-- resolves the tenant from tenant_directory FIRST (§5.6) and then runs
-- inside withTenant() — so a tenant context always exists for these writes.

-- Own the objects as clinic_owner (see 0003 for the rationale).
SET ROLE clinic_owner;

CREATE TABLE users (
  id                  uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid   NOT NULL,
  email               text   NOT NULL,
  name                text   NOT NULL,
  password_hash       text   NOT NULL,           -- Argon2id (Phase 1.2)
  status              text   NOT NULL DEFAULT 'INVITED'
                      CHECK (status IN ('INVITED','ACTIVE','LOCKED','DEACTIVATED')),
  mfa_secret          text,                      -- NULL until enrolled (encrypted)
  mfa_enabled         boolean NOT NULL DEFAULT false,
  failed_login_count  int     NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  deactivated_at      timestamptz,               -- JOB-12 user.inactive.deactivate
  row_version         int     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT users_email_unique_per_tenant UNIQUE (tenant_id, email),
  CONSTRAINT users_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX users_tenant_status_idx ON users (tenant_id, status);

CREATE TABLE roles (
  id          uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid   NOT NULL,
  code        text   NOT NULL,
  name        text   NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,    -- seeded system roles: not deletable
  row_version int    NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  CONSTRAINT roles_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT roles_code_unique_per_tenant UNIQUE (tenant_id, code),
  CONSTRAINT roles_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX roles_tenant_idx ON roles (tenant_id);

-- Permissions are a GLOBAL catalogue (arch §10: permissions → roles per
-- tenant → user_roles) — no tenant_id, no RLS. clinic_app gets SELECT only;
-- the catalogue changes via deploy/migrator, never via tenant requests.
CREATE TABLE permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,      -- e.g. 'lab.result.verify'
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON permissions TO clinic_app, clinic_report;
REVOKE INSERT, UPDATE, DELETE ON permissions FROM clinic_app;

CREATE TABLE role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  role_id       uuid NOT NULL,
  permission_id uuid NOT NULL,
  CONSTRAINT role_permissions_unique UNIQUE (tenant_id, role_id, permission_id),
  CONSTRAINT role_permissions_role_fkey
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_fkey
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_id);

CREATE TABLE user_roles (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  role_id   uuid NOT NULL,
  branch_id uuid,                                -- NULL = tenant-wide grant
  CONSTRAINT user_roles_unique UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role_id, branch_id),
  CONSTRAINT user_roles_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_fkey
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX user_roles_role_idx ON user_roles (role_id);

CREATE TABLE user_branches (
  tenant_id  uuid    NOT NULL,
  user_id    uuid    NOT NULL,
  branch_id  uuid    NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, branch_id),
  -- Composite FKs on both sides pin branch and user to the SAME tenant:
  -- (t,u) must be a real user pair and (t,b) a real branch pair.
  CONSTRAINT user_branches_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_branches_branch_fkey
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX user_branches_branch_idx ON user_branches (tenant_id, branch_id);
-- exactly one default branch per user
CREATE UNIQUE INDEX user_branches_one_default_idx
  ON user_branches (tenant_id, user_id) WHERE is_default;

CREATE TABLE sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  user_id          uuid        NOT NULL,
  refresh_hash     text        NOT NULL,        -- sha-256 of the refresh token
  user_agent       text,
  ip_address       text,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_reason   text,                        -- 'logout' | 'rotation' | 'reuse_detected' | 'suspend'
  replaced_by      uuid,                        -- refresh rotation chain (reuse detection)
  row_version      int         NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  CONSTRAINT sessions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sessions_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT sessions_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX sessions_user_active_idx ON sessions (tenant_id, user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at)
  WHERE revoked_at IS NULL;                      -- JOB-11 session.cleanup sweep

CREATE TABLE mfa_secrets (
  tenant_id    uuid   NOT NULL,
  user_id      uuid   NOT NULL,
  secret       text   NOT NULL,                  -- encrypted at rest (Phase 1.2)
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_secrets_tenant_id_id_key UNIQUE (tenant_id, user_id),
  CONSTRAINT mfa_secrets_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE login_attempts (
  id           uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid   NOT NULL,
  email        text   NOT NULL,
  ip_address   text,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_lookup_idx ON login_attempts (tenant_id, email, attempted_at DESC);

CREATE TABLE password_resets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_resets_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  name         text        NOT NULL,
  key_hash     text        NOT NULL UNIQUE,     -- hashed; raw shown once at create
  scopes       text[]      NOT NULL DEFAULT '{}',
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  row_version  int         NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  CONSTRAINT api_keys_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT api_keys_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id);

CREATE TABLE breakglass_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,        -- target tenant
  platform_user_id uuid        NOT NULL,
  reason           text        NOT NULL CHECK (length(reason) >= 15),
  expires_at       timestamptz NOT NULL,        -- hard 8h ceiling (enforced in service)
  ended_at         timestamptz,
  row_version      int         NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT breakglass_sessions_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT breakglass_sessions_platform_user_fkey
    FOREIGN KEY (platform_user_id) REFERENCES platform_users(id)
);

CREATE INDEX breakglass_open_idx ON breakglass_sessions (expires_at)
  WHERE ended_at IS NULL;                        -- auto-expiry sweep (JOB-11)

-- Policy B (tenant_or_platform) on administrative tables the platform
-- console must list/manage: users, roles*, user_branches, breakglass_sessions.
-- Policy A (strict) on runtime tenant-scoped tables: sessions, mfa_secrets,
-- login_attempts, password_resets, api_keys.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON users
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON roles
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON role_permissions
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON user_roles
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branches FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON user_branches
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

ALTER TABLE breakglass_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakglass_sessions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON breakglass_sessions
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

SELECT app.apply_tenant_isolation('sessions');
SELECT app.apply_tenant_isolation('mfa_secrets');
SELECT app.apply_tenant_isolation('login_attempts');
SELECT app.apply_tenant_isolation('password_resets');
SELECT app.apply_tenant_isolation('api_keys');

RESET ROLE;
