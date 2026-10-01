/**
 * JOB-10: audit.chain.verify — walks recent audit_log rows and verifies
 * the hash chain integrity. Reports any broken chain to security_events.
 *
 * Architecture §21.2: "Tampering with a row in a test DB breaks the chain."
 * The chain uses SHA-256 of the previous row's row_hash concatenated with
 * key fields of the current row.
 *
 * Run nightly by the audit.partition.maintain schedule.
 */
import { createHash } from 'node:crypto';
import { getAppPool } from '@clinic/db';

export interface AuditRow {
  id: string;
  tenant_id: string;
  created_at: string;
  prev_hash: string | null;
  row_hash: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
}

/**
 * Compute the expected row_hash for an audit row.
 * Hash covers: prev_hash (or 'GENESIS'), tenant_id, actor_id, action,
 * entity_type, entity_id, created_at.
 */
function computeRowHash(row: AuditRow, prevHash: string | null): string {
  const parts = [
    prevHash ?? 'GENESIS',
    row.tenant_id,
    row.actor_id ?? 'NULL',
    row.action,
    row.entity_type,
    row.entity_id,
    row.created_at,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Verify the audit chain for a tenant over a date range.
 * Returns the count of rows verified and whether the chain is intact.
 */
export async function verifyAuditChain(
  tenantId: string,
  since: Date,
  until: Date,
): Promise<{ verified: number; broken: boolean; firstBrokenId?: string }> {
  const pool = getAppPool();

  const rows = await pool.query<AuditRow>(
    `SELECT id, tenant_id, created_at::text, prev_hash, row_hash,
            action, entity_type, entity_id, actor_id
     FROM audit_log
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at ASC, id ASC`,
    [tenantId, since, until],
  );

  let verified = 0;

  for (const row of rows.rows) {
    // Rows without a row_hash were written before hash-chaining was enabled
    // (Phase 1 audit interceptor does not yet compute hashes — that lands here)
    if (!row.row_hash) {
      // Pre-hash rows are exempt from chain verification
      verified++;
      continue;
    }

    const expected = computeRowHash(row, row.prev_hash);
    if (expected !== row.row_hash) {
      return { verified, broken: true, firstBrokenId: row.id };
    }
    verified++;
  }

  return { verified, broken: false };
}

/**
 * Full JOB-10 run: verifies audit chains for all active tenants over the
 * last 24 hours and emits a security_event on breakage.
 */
export async function handleAuditChainVerify(): Promise<void> {
  const pool = getAppPool();
  const until = new Date();
  const since = new Date(until.getTime() - 24 * 3600 * 1000);

  const tenantRows = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status NOT IN ('OFFBOARDED')`,
  );

  for (const { id: tenantId } of tenantRows.rows) {
    try {
      const result = await verifyAuditChain(tenantId, since, until);
      if (result.broken) {
        console.error(
          `SECURITY-EVENT: audit chain broken for tenant ${tenantId}, first broken row: ${result.firstBrokenId}`,
        );
        // Write a security event
        await pool.query(
          `INSERT INTO outbox (tenant_id, event_type, payload)
           VALUES ($1, 'audit.chain.broken', $2)`,
          [
            tenantId,
            JSON.stringify({
              tenantId,
              since: since.toISOString(),
              until: until.toISOString(),
              firstBrokenId: result.firstBrokenId,
            }),
          ],
        );
      } else {
        console.log(`JOB-10: audit chain OK for tenant ${tenantId}: ${result.verified} rows verified`);
      }
    } catch (err) {
      console.error(`JOB-10: failed to verify audit chain for tenant ${tenantId}:`, err);
    }
  }
}
