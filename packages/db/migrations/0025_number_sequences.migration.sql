-- Gapless document numbering (architecture §6.6e, todo.md §0.3 ⛔ gap).
-- Used by every document module from Phase 3 onward: visit_no, rx_no, doc_no
-- (certificates), accession/lab order no (Phase 6), GRN/PO (Phase 4),
-- invoice/receipt (Phase 7).
--
-- Design: a per-tenant, per-sequence single row that is only ever incremented
-- inside the caller's transaction. `app.next_doc_no()` takes a transaction-level
-- advisory lock on the sequence row so two concurrent documents serialise on
-- the lock instead of racing an UPDATE; the number itself is gapless because a
-- rolled-back transaction releases the lock WITHOUT consuming a value (the
-- increment never happened). Uniqueness is enforced by the PK.

CREATE TABLE IF NOT EXISTS number_sequences (
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    sequence_key TEXT NOT NULL,
    current_value BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sequence_key)
);

ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY number_sequences_tenant_isolation ON number_sequences
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY number_sequences_tenant_isolation_write ON number_sequences
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
CREATE INDEX number_sequences_tenant_idx ON number_sequences (tenant_id);

-- VOLATILE (default): the function writes the sequence row. It is called
-- from service code, never from a policy USING clause, so volatility is fine.
CREATE OR REPLACE FUNCTION app.next_doc_no(p_tenant_id UUID, p_key TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
    v_lock_id BIGINT;
    v_next    BIGINT;
BEGIN
    -- Transaction-scope advisory lock keyed off the (tenant, sequence) pair.
    -- hashtextextended gives a stable 63-bit key; 't' = transaction scope, so
    -- the lock dies with the transaction even on error.
    v_lock_id := hashtextextended(p_tenant_id::text || ':' || p_key, 0);
    PERFORM pg_advisory_xact_lock(v_lock_id);

    INSERT INTO number_sequences (tenant_id, sequence_key, current_value)
    VALUES (p_tenant_id, p_key, 1)
    ON CONFLICT (tenant_id, sequence_key)
    DO UPDATE SET current_value = number_sequences.current_value + 1,
                  updated_at    = now()
    RETURNING current_value INTO v_next;

    RETURN v_next;
END;
$$;

-- Grant: the runtime role owns the sequence rows, the function runs with
-- invoker rights so RLS applies (no bypass path).
GRANT SELECT, INSERT, UPDATE ON number_sequences TO clinic_app;
GRANT EXECUTE ON FUNCTION app.next_doc_no(UUID, TEXT) TO clinic_app;
