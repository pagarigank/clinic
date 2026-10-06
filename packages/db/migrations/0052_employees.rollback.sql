-- 0052_employees.rollback.sql
SET ROLE clinic_owner;

DROP TABLE IF EXISTS employees CASCADE;
