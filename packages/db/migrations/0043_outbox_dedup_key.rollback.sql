-- 0043_outbox_dedup_key.rollback.sql
--
-- Drops the outbox idempotency key. Existing rows keep their event_type,
-- payload and aggregate identity, so no event history is lost -- but JOB-49
-- reverts to re-inserting billing.invoice.overdue on every run, since the
-- uniqueness guarantee is what suppresses those duplicates.
--
-- If JOB-49 has already emitted events under the key, clearing dedup_key first
-- (UPDATE outbox SET dedup_key = NULL) is not required: the column and its
-- indexes are removed wholesale below.

DROP INDEX IF EXISTS idx_outbox_dedup_lookup;
DROP INDEX IF EXISTS uq_outbox_dedup_key;

ALTER TABLE outbox DROP COLUMN IF EXISTS dedup_key;
