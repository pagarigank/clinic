-- 0037_phase6_rls_grants.rollback.sql
DROP TRIGGER IF EXISTS trg_guard_verified_result_mutation ON lab_results;
DROP FUNCTION IF EXISTS app.fn_guard_verified_result_mutation();
