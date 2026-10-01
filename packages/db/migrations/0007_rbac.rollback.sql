-- 0007_rbac rollback.
--
-- Only `sod_conflicts` is dropped. The permission catalogue rows inserted by
-- 0007 are intentionally LEFT IN PLACE: this script runs before 0005's
-- rollback, and `role_permissions.permission_id` references `permissions`, so
-- deleting the catalogue here would raise an FK violation whenever any role
-- grants exist. The rows are idempotent reference data
-- (`ON CONFLICT (code) DO UPDATE`), so re-applying 0007 is a no-op, and
-- 0005's own rollback drops the whole table a few steps later.
DROP TABLE IF EXISTS sod_conflicts;
