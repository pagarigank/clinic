/**
 * JOB-10 audit chain verification under forced RLS.
 *
 * Regression: `verifyAuditChain` read `audit_log` through the raw application
 * pool with no tenant GUC. `audit_log` is FORCE RLS and the app role is
 * NOBYPASSRLS, so the read returned zero rows and a tampered chain was reported
 * as "OK: 0 rows verified" — a silent false-negative security check. The tenant
 * enumeration also read `tenants` (FORCE RLS) and the outbox write was unscoped.
 *
 * Fixtures live in Demo Clinic B. The owner pool is used for setup, teardown and
 * assertions only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { verifyAuditChain, handleAuditChainVerify } from '../src/handlers/audit-chain.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const tag = `aud-${Date.now().toString(36)}`;
const owner = createPool({ role: 'owner' });

const ids: Record<string, string> = {};

async function one(sql: string, params: unknown[]): Promise<string> {
  const res = await owner.query<{ id: string }>(sql, params);
  return res.rows[0]!.id;
}

beforeAll(async () => {
  if (!hasDb) return;

  // A pre-hash row (row_hash NULL): exempt from chain verification.
  ids.prehash = await one(
    `INSERT INTO audit_log (tenant_id, created_at, action, entity_type, entity_id)
     VALUES ($1, now() - interval '3 minutes', $2, 'test', gen_random_uuid()) RETURNING id`,
    [TENANT, `${tag}.prehash`],
  );

  // A row whose stored row_hash cannot match the recomputed one.
  ids.broken = await one(
    `INSERT INTO audit_log (tenant_id, created_at, action, entity_type, entity_id, prev_hash, row_hash)
     VALUES ($1, now() - interval '2 minutes', $2, 'test', gen_random_uuid(), 'GENESIS', $3) RETURNING id`,
    [TENANT, `${tag}.broken`, 'f'.repeat(64)],
  );

  // A correctly-hashed row at a fixed timestamp to prove an intact chain passes.
  const fixedTs = '2026-01-01 12:00:00+00';
  const tsText = (await owner.query<{ ts: string }>(`SELECT ($1::timestamptz)::text AS ts`, [fixedTs]))
    .rows[0]!.ts;
  const entityId = '22222222-2222-4222-8222-0000000000ff';
  const action = `${tag}.valid`;
  const hash = createHash('sha256')
    .update(['GENESIS', TENANT, 'NULL', action, 'test', entityId, tsText].join('|'))
    .digest('hex');
  ids.valid = await one(
    `INSERT INTO audit_log (tenant_id, created_at, action, entity_type, entity_id, prev_hash, row_hash)
     VALUES ($1, $2, $3, 'test', $4, 'GENESIS', $5) RETURNING id`,
    [TENANT, fixedTs, action, entityId, hash],
  );
});

afterAll(async () => {
  if (!hasDb) return;
  try {
    await owner.query(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
    await owner.query(`DELETE FROM audit_log WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
      TENANT,
      [ids.prehash, ids.broken, ids.valid],
    ]);
    await owner.query(`ALTER TABLE audit_log ENABLE TRIGGER USER`);
    await owner.query(
      `DELETE FROM outbox WHERE tenant_id = $1 AND event_type = 'audit.chain.broken'`,
      [TENANT],
    );
  } finally {
    await owner.end();
  }
});

describe.skipIf(!hasDb)('audit chain verification reads and writes under forced RLS', () => {
  it('detects a tampered row instead of silently verifying zero rows', async () => {
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const until = new Date();
    const res = await verifyAuditChain(TENANT, since, until);

    expect(res.verified).toBeGreaterThanOrEqual(1);
    expect(res.broken).toBe(true);
    expect(res.firstBrokenId).toBe(ids.broken);
  });

  it('passes an intact chain and counts pre-hash rows as exempt', async () => {
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const until = new Date(Date.now() - 2.5 * 60 * 1000);
    const res = await verifyAuditChain(TENANT, since, until);

    expect(res.verified).toBeGreaterThanOrEqual(1);
    expect(res.broken).toBe(false);
  });

  it('accepts a correctly-hashed row', async () => {
    const res = await verifyAuditChain(
      TENANT,
      new Date('2025-12-31T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z'),
    );
    expect(res.verified).toBe(1);
    expect(res.broken).toBe(false);
  });

  it('emits exactly one deduplicated security event for the broken row', async () => {
    await handleAuditChainVerify();
    await handleAuditChainVerify();

    const res = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox
       WHERE tenant_id = $1 AND event_type = 'audit.chain.broken'
         AND payload ->> 'firstBrokenId' = $2`,
      [TENANT, ids.broken],
    );
    expect(res.rows[0]!.count).toBe('1');
  });
});
