-- 0043_outbox_dedup_key.migration.sql
-- Phase 7 / JOB-49 (todo.md 7.6; specification 14).
--
-- Why this exists: the outbox carried no uniqueness of any kind, so a
-- scheduled job that inserts one event per qualifying row re-inserts it on
-- every run forever. JOB-49 (billing.overdue.flag, daily 01:00 UTC) wrote
-- `billing.invoice.overdue` for every past-due invoice on every run. Its
-- `ON CONFLICT DO NOTHING` was a no-op, because with no unique index or
-- constraint there is no conflict for Postgres to suppress -- the duplicate
-- reminders were real, and their `balance` payload also went stale.
--
-- dedup_key is opt-in and nullable:
--   NULL  - no dedup, today's behaviour, so existing producers are unchanged.
--   value - the producer's natural key for "this event about this thing".
--
-- The index deliberately covers processed rows too. The outbox consumer
-- (`UPDATE outbox SET processed_at = now() WHERE processed_at IS NULL`)
-- marks events processed inside the same sweep, so a partial
-- `WHERE processed_at IS NULL` index would free the uniqueness slot
-- immediately and the next run would duplicate again. Idempotency here has
-- to survive the consumer.
--
-- Re-arm rule: re-notifying the same subject is an explicit act, never a
-- side effect of a schedule. The producer clears the key --
-- `UPDATE outbox SET dedup_key = NULL WHERE tenant_id = $1 AND event_type = $2
-- AND dedup_key = $3` -- which releases the key without deleting event
-- history, keeping the outbox append-only.

ALTER TABLE outbox ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- (tenant_id, event_type, dedup_key) is the natural key: the same subject may
-- legitimately produce different event types, and two tenants may never share
-- a slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_dedup_key
  ON outbox (tenant_id, event_type, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- The dedup path is a lookup, and it is always scoped by tenant.
CREATE INDEX IF NOT EXISTS idx_outbox_dedup_lookup
  ON outbox (tenant_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

COMMENT ON COLUMN outbox.dedup_key IS
  'Producer-supplied idempotency key for this event. NULL means the producer '
  'does not deduplicate. When set, at most one row per (tenant_id, event_type, '
  'dedup_key) may ever exist, processed or not.';
