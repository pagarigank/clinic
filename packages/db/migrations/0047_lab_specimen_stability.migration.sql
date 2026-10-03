-- 0047_lab_specimen_stability.migration.sql
-- Phase 6 / JOB-45 (todo.md 6.4; specification 14, table `specimen_types`).
--
-- Why this exists: JOB-45 (lab.specimen.stale.flag) selects
-- `st.stability_hours` from the specimen-type table, but the physical table
-- `lab_specimen_types` never had that column and the handler joined the wrong
-- table name (`specimen_types`). The job therefore could not run at all: the
-- query errored before the RLS defect below it even mattered.
--
-- specification.md 14.1 lists `stability_hours` as part of the specimen-type
-- model, so the column belongs here. It is nullable: a window is a property of
-- the specimen type's handling protocol and may legitimately be unset, in which
-- case JOB-45 falls back to 24 hours (COALESCE).

ALTER TABLE lab_specimen_types
  ADD COLUMN IF NOT EXISTS stability_hours integer;

COMMENT ON COLUMN lab_specimen_types.stability_hours IS
  'Hours a specimen of this type remains valid after collection. NULL means '
  'the handler default (24h) applies. Consumed by JOB-45 lab.specimen.stale.flag.';
