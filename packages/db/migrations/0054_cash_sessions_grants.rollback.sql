-- 0054_cash_sessions_grants.rollback.sql
-- Revoke exactly the privileges 0051 granted. Rolling back to the broken state
-- is intentional: the rollback must restore the pre-fix privilege set so a
-- down/up cycle is genuinely reversible.

REVOKE ALL ON cash_sessions FROM clinic_app;
REVOKE ALL ON cash_sessions FROM clinic_report;