-- Demo seed (architecture §21.1): two mirrored tenants on purpose — the
-- isolation suite and the RLS canary prove A cannot see B.
-- Idempotent: re-running replaces the demo rows via delete-then-insert
-- (the global permissions catalogue is additive-only and never deleted).
-- Runs as clinic_owner (or superuser); FORCE RLS applies to the owner, so
-- each block sets its transaction-local context before touching its tables.
-- Password hashes are placeholders until Phase 1.2 ships Argon2id login.

-- Global catalogues (platform scope, no tenant context needed) -------------
BEGIN;
SELECT set_config('app.scope', 'platform', true);

INSERT INTO permissions (code, description) VALUES
  ('admin.users.manage',  'Manage tenant users and roles'),
  ('admin.roles.manage',  'Manage roles and the permission matrix'),
  ('patients.read',       'View patient records'),
  ('patients.write',      'Register and edit patients')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform_users (email, name, password_hash) VALUES
  ('superadmin@clinic.local', 'Platform Superadmin', 'argon2id:$PLACEHOLDER-SEED-ONLY:not-a-real-password')
ON CONFLICT (email) DO NOTHING;

INSERT INTO subscription_plans (id, code, name) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'starter', 'Starter (consultation + patients)'),
  ('fa000000-0000-4000-8000-000000000002', 'complete', 'Complete (all modules)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO tenants (id, name, slug, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Demo Clinic A', 'demo-a', 'ACTIVE'),
  ('22222222-2222-4222-8222-222222222222', 'Demo Clinic B', 'demo-b', 'ACTIVE')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, slug = EXCLUDED.slug, status = EXCLUDED.status;
COMMIT;

-- Tenant A ------------------------------------------------------------------
BEGIN;
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);

DELETE FROM user_roles        WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM role_permissions  WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM user_branches     WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM users             WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM roles             WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM branch_licences   WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM branches          WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM tenant_modules    WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM subscriptions     WHERE tenant_id = '11111111-1111-4111-8111-111111111111';

INSERT INTO branches (id, tenant_id, code, name, service_profile) VALUES
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'MAIN', 'Demo A — Main', '["consultation"]'::jsonb);

INSERT INTO branch_licences (tenant_id, branch_id, licence_type, licence_no) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001',
   'BUSINESS_PERMIT', 'DEMO-A-BP-0001');

INSERT INTO tenant_modules (tenant_id, module, status, seed_status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin',    'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'patients', 'ENABLED', 'SEEDED');

INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'fa000000-0000-4000-8000-000000000001', 'ACTIVE');

INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'tenant_admin', 'Tenant Admin', true),
  ('a2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'doctor',       'Doctor',       true),
  ('a2000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'receptionist', 'Receptionist', true);

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT t.tenant_id, rp.role_id::uuid, p.id
FROM (VALUES
  ('a2000000-0000-4000-8000-000000000001', 'admin.users.manage'),
  ('a2000000-0000-4000-8000-000000000001', 'admin.roles.manage'),
  ('a2000000-0000-4000-8000-000000000001', 'patients.read'),
  ('a2000000-0000-4000-8000-000000000001', 'patients.write'),
  ('a2000000-0000-4000-8000-000000000002', 'patients.read'),
  ('a2000000-0000-4000-8000-000000000002', 'patients.write'),
  ('a2000000-0000-4000-8000-000000000003', 'patients.read')
) AS rp(role_id, permission_code)
JOIN permissions p ON p.code = rp.permission_code
CROSS JOIN (SELECT '11111111-1111-4111-8111-111111111111'::uuid AS tenant_id) t;

INSERT INTO users (id, tenant_id, email, name, password_hash, status) VALUES
  ('a3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'admin@demo-a.test', 'Demo A Admin', 'argon2id:$PLACEHOLDER-SEED-ONLY:not-a-real-password', 'ACTIVE'),
  ('a3000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'doctor@demo-a.test', 'Demo A Doctor', 'argon2id:$PLACEHOLDER-SEED-ONLY:not-a-real-password', 'ACTIVE');

INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');

INSERT INTO user_branches (tenant_id, user_id, branch_id, is_default) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', true),
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', true);

DELETE FROM clinic_ping WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND note = 'demo-a seeded';
INSERT INTO clinic_ping (tenant_id, note)
VALUES ('11111111-1111-4111-8111-111111111111', 'demo-a seeded');
COMMIT;

-- Tenant B (mirror of A) ----------------------------------------------------
BEGIN;
SELECT set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);

DELETE FROM user_roles        WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM role_permissions  WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM user_branches     WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM users             WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM roles             WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM branch_licences   WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM branches          WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM tenant_modules    WHERE tenant_id = '22222222-2222-4222-8222-222222222222';
DELETE FROM subscriptions     WHERE tenant_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO branches (id, tenant_id, code, name, service_profile) VALUES
  ('b1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'MAIN', 'Demo B — Main', '["consultation"]'::jsonb);

INSERT INTO branch_licences (tenant_id, branch_id, licence_type, licence_no) VALUES
  ('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-000000000001',
   'BUSINESS_PERMIT', 'DEMO-B-BP-0001');

INSERT INTO tenant_modules (tenant_id, module, status, seed_status) VALUES
  ('22222222-2222-4222-8222-222222222222', 'admin',    'ENABLED', 'SEEDED'),
  ('22222222-2222-4222-8222-222222222222', 'patients', 'ENABLED', 'SEEDED');

INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES
  ('22222222-2222-4222-8222-222222222222', 'fa000000-0000-4000-8000-000000000002', 'ACTIVE');

INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES
  ('b2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'tenant_admin', 'Tenant Admin', true),
  ('b2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'doctor',       'Doctor',       true),
  ('b2000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'receptionist', 'Receptionist', true);

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT t.tenant_id, rp.role_id::uuid, p.id
FROM (VALUES
  ('b2000000-0000-4000-8000-000000000001', 'admin.users.manage'),
  ('b2000000-0000-4000-8000-000000000001', 'admin.roles.manage'),
  ('b2000000-0000-4000-8000-000000000001', 'patients.read'),
  ('b2000000-0000-4000-8000-000000000001', 'patients.write'),
  ('b2000000-0000-4000-8000-000000000002', 'patients.read'),
  ('b2000000-0000-4000-8000-000000000002', 'patients.write'),
  ('b2000000-0000-4000-8000-000000000003', 'patients.read')
) AS rp(role_id, permission_code)
JOIN permissions p ON p.code = rp.permission_code
CROSS JOIN (SELECT '22222222-2222-4222-8222-222222222222'::uuid AS tenant_id) t;

INSERT INTO users (id, tenant_id, email, name, password_hash, status) VALUES
  ('b3000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'admin@demo-b.test', 'Demo B Admin', 'argon2id:$PLACEHOLDER-SEED-ONLY:not-a-real-password', 'ACTIVE'),
  ('b3000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   'doctor@demo-b.test', 'Demo B Doctor', 'argon2id:$PLACEHOLDER-SEED-ONLY:not-a-real-password', 'ACTIVE');

INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
  ('22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002');

INSERT INTO user_branches (tenant_id, user_id, branch_id, is_default) VALUES
  ('22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', true),
  ('22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', true);

DELETE FROM clinic_ping WHERE tenant_id = '22222222-2222-4222-8222-222222222222' AND note = 'demo-b seeded';
INSERT INTO clinic_ping (tenant_id, note)
VALUES ('22222222-2222-4222-8222-222222222222', 'demo-b seeded');
COMMIT;
