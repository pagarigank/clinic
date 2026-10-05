-- 0054_cash_sessions_grants.migration.sql
-- Fix: migration 0045 created cash_sessions with RLS but never GRANTed it to the
-- runtime roles. Every other migration that creates a table ends with explicit
-- GRANTs (e.g. 0044 grants SELECT, INSERT on payment_splits to clinic_app);
-- 0045 omitted them, so the table was unreachable by the API role:
--
--   GET /billing/sessions -> 500 "permission denied for table cash_sessions"
--
-- RLS was correct and untouched — this only restores the table-level privilege
-- that clinic_app/clinic_report need in order for RLS to be the thing that
-- actually decides access (architecture §6.1, §6.3). Without the GRANT the
-- request fails at the privilege check before RLS is ever consulted, which is
-- both a 500 and a misleading error: it looks like a policy bug, not a grant.

-- Runtime role needs full DML: the POS session is created, updated across the
-- hold/resume/complete lifecycle, and read back for the cashier's own list.
GRANT SELECT, INSERT, UPDATE ON cash_sessions TO clinic_app;

-- Read-only reporting role (architecture §6.1).
GRANT SELECT ON cash_sessions TO clinic_report;

-- Session data is cashier-scoped mutable state, so it needs UPDATE; there is no
-- DELETE path by design (todo.md §7.3: sessions complete or void, they are not
-- removed — ground rule 7, append-only for anything that has been transacted).