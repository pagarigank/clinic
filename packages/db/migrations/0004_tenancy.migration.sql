-- 0004_tenancy: the tenant core (todo 1.1 ⛔). Standard columns per
-- architecture §6.4: every tenant table carries tenant_id + audit columns +
-- row_version; every table with tenant_id gets the isolation block (§6.6b).
-- `tenants` itself is the administrative anchor: its policy is policy B
-- (tenant_or_platform) applied via a direct CREATE POLICY, because
-- app.apply_tenant_isolation emits the strict policy-A form.

-- Own the objects as clinic_owner (see 0003 for the rationale).
SET ROLE clinic_owner;

CREATE TABLE tenants (
  id              uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text     NOT NULL,
  slug            text     NOT NULL UNIQUE,
  status          text     NOT NULL DEFAULT 'PROVISIONING'
                  CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED')),
  timezone        text     NOT NULL DEFAULT 'Asia/Manila',     -- G-08 tenant tz
  modules_version int      NOT NULL DEFAULT 1,                 -- entitlement cache key (§5.3)
  row_version     int      NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

-- (tenant_id, id) pair on every tenant table so children form composite FKs
-- (architecture §6.4). On `tenants` itself PRIMARY KEY (id) implies it.
CREATE TABLE subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  plan_id      uuid        NOT NULL,
  status       text        NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','CANCELLED')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end   timestamptz,
  row_version  int         NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  CONSTRAINT subscriptions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT subscriptions_tenant_fkey  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT subscriptions_plan_fkey    FOREIGN KEY (plan_id)   REFERENCES subscription_plans(id)
);

-- One live subscription per tenant (cancelled rows keep their history).
CREATE UNIQUE INDEX subscriptions_one_live_idx
  ON subscriptions (tenant_id) WHERE status IN ('TRIAL','ACTIVE','PAST_DUE');

-- Module entitlements (§5.3, todo 1.6 — table now, state machine in app code).
CREATE TABLE tenant_modules (
  id          uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid   NOT NULL,
  module      text   NOT NULL CHECK (module IN
              ('admin','patients','clinical','supply','laboratory','pharmacy',
               'billing','compliance','notifications','reports')),
  status      text   NOT NULL DEFAULT 'DISABLED'
              CHECK (status IN ('TRIAL','ENABLED','DRAINING','DISABLED')),
  seed_status text   NOT NULL DEFAULT 'PENDING'
              CHECK (seed_status IN ('PENDING','SEEDING','SEEDED','FAILED')),
  limits      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  expires_at  timestamptz,
  disabled_reason text,
  disabled_by uuid,
  disabled_at timestamptz,
  row_version int    NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT tenant_modules_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT tenant_modules_pk UNIQUE (tenant_id, module),
  CONSTRAINT tenant_modules_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE branches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  -- Service profile (Q-18, spec §19.8): what this branch operates. Drives
  -- JOB-03 seeding, expected licences, and compliance badges — never access.
  service_profile text    NOT NULL DEFAULT '["consultation"]'::jsonb,
  status      text        NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','ARCHIVED')),
  timezone    text,                              -- NULL → tenant timezone (G-08)
  row_version int         NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  CONSTRAINT branches_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT branches_code_unique_per_tenant UNIQUE (tenant_id, code),
  CONSTRAINT branches_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX branches_tenant_status_idx ON branches (tenant_id, status);

CREATE TABLE branch_licences (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  branch_id   uuid        NOT NULL,
  licence_type text       NOT NULL
              CHECK (licence_type IN ('BUSINESS_PERMIT','DOH_LTO','FDA_DRUGSTORE')),
  licence_no  text,
  expires_on  date,
  verified_at timestamptz,
  row_version int         NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT branch_licences_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT branch_licences_unique_per_type UNIQUE (tenant_id, branch_id, licence_type),
  CONSTRAINT branch_licences_branch_fkey
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id)
);

CREATE INDEX branch_licences_expiry_idx ON branch_licences (tenant_id, expires_on)
  WHERE expires_on IS NOT NULL;

-- Isolation: policy B (tenant_or_platform) on administrative tables,
-- policy A (strict) on branch operational data.
ALTER TABLE tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform ON tenants
  USING      (id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

SELECT app.apply_tenant_isolation('subscriptions');
SELECT app.apply_tenant_isolation('tenant_modules');
SELECT app.apply_tenant_isolation('branches');
SELECT app.apply_tenant_isolation('branch_licences');

-- The sync trigger from §5.6: tenants write → tenant_directory follows.
-- Suspend/offboard flows only ever UPDATE tenants.status; the directory
-- mirrors it so the pre-auth lookup sees the same state.
CREATE FUNCTION app.sync_tenant_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO tenant_directory (id, slug, status)
  VALUES (NEW.id, NEW.slug, NEW.status)
  ON CONFLICT (id) DO UPDATE
    SET slug = EXCLUDED.slug, status = EXCLUDED.status;
  RETURN NEW;
END
$$;

CREATE TRIGGER tenants_sync_directory
  AFTER INSERT OR UPDATE OF slug, status ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.sync_tenant_directory();

RESET ROLE;
