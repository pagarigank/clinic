-- 0001_roles_rls rollback: remove helpers and runtime roles.
DROP SCHEMA IF EXISTS app CASCADE;
DROP OWNED BY clinic_app, clinic_report;
DROP ROLE IF EXISTS clinic_report;
DROP ROLE IF EXISTS clinic_app;
