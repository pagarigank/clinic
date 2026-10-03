-- 0045_cash_sessions.rollback.sql
DROP POLICY IF EXISTS cash_sessions_tenant_write ON cash_sessions;
DROP POLICY IF EXISTS cash_sessions_tenant_isolation ON cash_sessions;
ALTER TABLE IF EXISTS cash_sessions NO FORCE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS cash_sessions;
