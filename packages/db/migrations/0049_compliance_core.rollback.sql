-- 0049_compliance_core.rollback.sql
-- Rollback for Phase 8 Compliance Core Migration

DROP TRIGGER IF EXISTS security_events_deny_delete ON security_events;
DROP TRIGGER IF EXISTS security_events_deny_update ON security_events;
DROP FUNCTION IF EXISTS app.security_events_append_only();

DROP TABLE IF EXISTS pidsr_cases CASCADE;
DROP TABLE IF EXISTS access_review_decisions CASCADE;
DROP TABLE IF EXISTS access_reviews CASCADE;
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS retention_candidates CASCADE;
DROP TABLE IF EXISTS legal_holds CASCADE;
DROP TABLE IF EXISTS retention_policies CASCADE;
DROP TABLE IF EXISTS breach_incidents CASCADE;
DROP TABLE IF EXISTS data_subject_requests CASCADE;
DROP TABLE IF EXISTS consent_templates CASCADE;
