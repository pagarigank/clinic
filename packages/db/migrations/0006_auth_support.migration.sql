-- 0006_auth_support: Phase 1.2 auth scaffolding beyond 0005's core identity
-- tables — MFA recovery codes, trusted (remember-)devices, TOTP replay guard,
-- and the platform-side session/recovery tables the Phase 1.7 console and
-- break-glass flow need. All tenant-scoped tables get strict policy A
-- (app.apply_tenant_isolation); platform_* tables have no tenant_id → no RLS.

SET ROLE clinic_owner;

-- TOTP replay guard: last consumed 30 s step per user; verification refuses
-- steps <= last_used_step so a code shown once cannot be replayed in-window.
ALTER TABLE mfa_secrets ADD COLUMN last_used_step bigint;

CREATE TABLE mfa_recovery_codes (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid        NOT NULL,
  user_id   uuid        NOT NULL,
  code_hash text        NOT NULL,            -- sha-256; raw code shown once
  used_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_recovery_codes_unique UNIQUE (tenant_id, user_id, code_hash),
  CONSTRAINT mfa_recovery_codes_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX mfa_recovery_codes_open_idx
  ON mfa_recovery_codes (tenant_id, user_id) WHERE used_at IS NULL;

CREATE TABLE mfa_trusted_devices (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  token_hash   text        NOT NULL UNIQUE,   -- sha-256 of the device cookie
  label        text,
  expires_at   timestamptz NOT NULL,          -- remember-device window (30 d)
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_trusted_devices_user_fkey
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX mfa_trusted_devices_expiry_idx ON mfa_trusted_devices (expires_at);
CREATE INDEX mfa_trusted_devices_tenant_idx ON mfa_trusted_devices (tenant_id);

-- Platform console sessions (Phase 1.7): same rotation chain semantics as
-- tenant sessions (0005) — replaced_by + reuse detection — but keyed by
-- platform_user_id, outside tenant RLS entirely.
CREATE TABLE platform_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid        NOT NULL,
  refresh_hash     text        NOT NULL,
  user_agent       text,
  ip_address       text,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_reason   text,                       -- 'logout' | 'rotation' | 'reuse_detected'
  replaced_by      uuid,
  row_version      int         NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_sessions_user_fkey
    FOREIGN KEY (platform_user_id) REFERENCES platform_users (id) ON DELETE CASCADE
);

CREATE INDEX platform_sessions_user_active_idx ON platform_sessions (platform_user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX platform_sessions_expiry_idx ON platform_sessions (expires_at)
  WHERE revoked_at IS NULL;                    -- JOB-11 sweeps these too

CREATE TABLE platform_mfa_recovery_codes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid        NOT NULL,
  code_hash        text        NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_mfa_recovery_codes_unique UNIQUE (platform_user_id, code_hash),
  CONSTRAINT platform_mfa_recovery_codes_user_fkey
    FOREIGN KEY (platform_user_id) REFERENCES platform_users (id) ON DELETE CASCADE
);

-- Strict policy A on the tenant-scoped auth tables (runtime only; the console
-- never lists these — sessions were the same call in 0005).
SELECT app.apply_tenant_isolation('mfa_recovery_codes');
SELECT app.apply_tenant_isolation('mfa_trusted_devices');

-- Platform-side tables are console-managed: clinic_app gets no access until
-- the Phase 1.7 platform login ships; the migrator/owner provisions rows.
REVOKE ALL ON platform_sessions, platform_mfa_recovery_codes FROM clinic_app, clinic_report;

RESET ROLE;
