-- 0052_employees.migration.sql
-- Employee Information tied to tenant users (HR & professional licensure profile).
-- Follows architecture §6.4 composite keys, §6.6b tenant isolation.

SET ROLE clinic_owner;

CREATE TABLE IF NOT EXISTS employees (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                         uuid NOT NULL,
  employee_no                     text NOT NULL,
  job_title                       text NOT NULL,
  department                      text NOT NULL,
  employment_type                 text NOT NULL DEFAULT 'FULL_TIME'
                                  CHECK (employment_type IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'CONSULTANT', 'INTERN')),
  specialization                  text,
  prc_license_no                  text,
  ptr_no                          text,
  s2_license_no                   text,
  phone                           text,
  hire_date                       date,
  emergency_contact_name          text,
  emergency_contact_phone         text,
  emergency_contact_relationship  text,
  tin                             text,
  sss_no                          text,
  philhealth_no                   text,
  notes                           text,
  status                          text NOT NULL DEFAULT 'ACTIVE'
                                  CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'PROBATION', 'RESIGNED', 'TERMINATED')),
  row_version                     int NOT NULL DEFAULT 1,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid,

  CONSTRAINT employees_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT employees_tenant_user_key UNIQUE (tenant_id, user_id),
  CONSTRAINT employees_tenant_emp_no_key UNIQUE (tenant_id, employee_no),
  CONSTRAINT employees_user_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES users (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS employees_tenant_dept_idx
  ON employees (tenant_id, department);

CREATE INDEX IF NOT EXISTS employees_tenant_status_idx
  ON employees (tenant_id, status);

SELECT app.apply_tenant_isolation('employees');
