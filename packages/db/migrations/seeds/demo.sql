-- Demo seed (architecture §21.1): two mirrored tenants on purpose — the
-- isolation suite and the RLS canary prove A cannot see B.
-- Idempotent: re-running replaces the demo rows via delete-then-insert.
-- Runs as clinic_owner; FORCE RLS applies to the owner too, so each block sets
-- its transaction-local tenant context before touching the table.

BEGIN;
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
DELETE FROM clinic_ping WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND note = 'demo-a seeded';
INSERT INTO clinic_ping (tenant_id, note)
VALUES ('11111111-1111-4111-8111-111111111111', 'demo-a seeded');
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);
DELETE FROM clinic_ping WHERE tenant_id = '22222222-2222-4222-8222-222222222222' AND note = 'demo-b seeded';
INSERT INTO clinic_ping (tenant_id, note)
VALUES ('22222222-2222-4222-8222-222222222222', 'demo-b seeded');
COMMIT;
