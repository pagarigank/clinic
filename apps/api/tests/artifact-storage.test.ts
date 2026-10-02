/**
 * Generated artifact storage (print pipeline, todo.md 3.2 / JOB-43 / JOB-50).
 *
 * `files` carries two storage strategies and they must never be confused:
 *   - origin='UPLOAD'    bytes stream to object storage via presigned URL,
 *                        record waits in SCAN_PENDING for the malware gate.
 *   - origin='GENERATED' bytes are produced server-side by @clinic/print and
 *                        live inline; there is no upload to scan, so the row
 *                        is READY on insert and carries a SHA-256 digest.
 *
 * The digest lives on `files` as well as on the owning document row so that a
 * stored artifact's hash can be re-verified against the exact bytes served.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenantOnPool } from '@clinic/db';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'a3000000-0000-4000-8000-000000000001';

const insertedIds: string[] = [];

// Schema introspection runs as owner: `information_schema` only exposes columns
// the connecting role holds privileges on, and clinic_report has no SELECT on
// files/medical_certificates at all, so it would report those columns as absent
// regardless of what the schema actually contains.
async function columnExists(table: string, column: string): Promise<boolean> {
  const pool = createPool({ role: 'owner' });
  try {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return res.rowCount === 1;
  } finally {
    await pool.end();
  }
}

async function constraintNames(table: string): Promise<string[]> {
  const pool = createPool({ role: 'owner' });
  try {
    const res = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass`,
      [table],
    );
    return res.rows.map((r: { conname: string }) => r.conname);
  } finally {
    await pool.end();
  }
}

const ARTIFACT_CHECK = 'files_generated_artifact_integrity';

/**
 * Assert a statement is rejected *by the named CHECK*, not merely by some
 * unrelated error. Without this, an insert fails for the wrong reason (a
 * missing column, say) and the test reports a false pass. If the insert
 * unexpectedly succeeds we remove the row so a red run cannot leave artifacts
 * behind in `files`.
 */
async function expectRejectedByCheck(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
  sql: string,
  params: unknown[],
): Promise<void> {
  try {
    const res = await pool.query(sql, params);
    await pool.query(`DELETE FROM files WHERE object_key = $1`, [
      (res.rows[0] as { object_key?: string } | undefined)?.object_key ?? '',
    ]);
    throw new Error('expected insert to be rejected but it succeeded');
  } catch (e) {
    const message = (e as Error).message ?? '';
    if (message.includes('expected insert to be rejected')) throw e;
    expect(message).toContain(ARTIFACT_CHECK);
  }
}

describe.skipIf(!hasDb)('generated artifact storage (files)', () => {
  afterAll(async () => {
    if (insertedIds.length === 0) return;
    const ownerPool = createPool({ role: 'owner' });
    try {
      await ownerPool.query(`DELETE FROM files WHERE id = ANY($1)`, [insertedIds]);
    } finally {
      await ownerPool.end();
    }
  });

  it('files exposes content, sha256 and origin columns', async () => {
    expect(await columnExists('files', 'content')).toBe(true);
    expect(await columnExists('files', 'sha256')).toBe(true);
    expect(await columnExists('files', 'origin')).toBe(true);
  });

  it('origin defaults to UPLOAD so the presigned-upload path is unchanged', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      const res = await pool.query(
        `SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'origin'`,
      );
      expect(res.rows[0]?.column_default).toMatch(/UPLOAD/);
    } finally {
      await pool.end();
    }
  });

  it('rejects a GENERATED artifact that has no bytes or no digest', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, sha256)
         VALUES ($1, 't/a/gen-missing-content', 'r.pdf', 'application/pdf', 10,
                 $2, 'GENERATED', repeat('a', 64))
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );

      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, content)
         VALUES ($1, 't/a/gen-missing-hash', 'r.pdf', 'application/pdf', 10,
                 $2, 'GENERATED', '\\x25504446'::bytea)
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );
    } finally {
      await pool.end();
    }
  });

  it('rejects a GENERATED artifact that is not READY (no upload to scan)', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, content, sha256, status)
         VALUES ($1, 't/a/gen-not-ready', 'r.pdf', 'application/pdf', 10,
                 $2, 'GENERATED', '\\x25504446'::bytea, repeat('b', 64), 'SCAN_PENDING')
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );
    } finally {
      await pool.end();
    }
  });

  it('rejects an UPLOAD row that carries inline bytes', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, content, sha256, status)
         VALUES ($1, 't/a/upload-with-bytes', 'r.pdf', 'application/pdf', 10,
                 $2, 'UPLOAD', '\\x25504446'::bytea, repeat('c', 64), 'READY')
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );
    } finally {
      await pool.end();
    }
  });

  it('rejects inline bytes and a digest on the same UPLOAD row', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, sha256, status)
         VALUES ($1, 't/a/upload-with-hash', 'r.pdf', 'application/pdf', 10,
                 $2, 'UPLOAD', repeat('f', 64), 'READY')
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );
    } finally {
      await pool.end();
    }
  });

  it('rejects a GENERATED artifact whose size disagrees with its bytes', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      await expectRejectedByCheck(
        pool,
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                            uploaded_by, origin, content, sha256, status)
         VALUES ($1, 't/a/gen-size-mismatch', 'r.pdf', 'application/pdf', 999,
                 $2, 'GENERATED', '\\x25504446'::bytea, repeat('d', 64), 'READY')
         RETURNING object_key`,
        [TENANT_A, USER_A],
      );
    } finally {
      await pool.end();
    }
  });

  it('stores a GENERATED artifact inline with a verifiable digest', async () => {
    const bytes = Buffer.from('%PDF-1.4 generated');
    const sha256 = 'd'.repeat(64);
    const appPool = createPool({ role: 'app' });
    let insertedId: string;
    try {
      const inserted = await withTenantOnPool(
        appPool,
        { tenantId: TENANT_A, userId: USER_A },
        async (tx) => {
          const res = await tx.query<{ id: string }>(
            `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                                uploaded_by, origin, content, sha256, status)
             VALUES ($1, $2, 'report.pdf', 'application/pdf', $3, $4, 'GENERATED', $5, $6, 'READY')
             RETURNING id`,
            [TENANT_A, `t/${TENANT_A}/${crypto.randomUUID()}`, bytes.length, USER_A, bytes, sha256],
          );
          return res.rows[0]!;
        },
      );
      insertedId = inserted.id;
    } finally {
      await appPool.end();
    }
    insertedIds.push(insertedId!);

    const ownerPool = createPool({ role: 'owner' });
    try {
      const res = await ownerPool.query<{ content: Buffer; sha256: string; status: string }>(
        `SELECT content, sha256, status FROM files WHERE id = $1`,
        [insertedId!],
      );
      const row = res.rows[0]!;
      expect(row.content.equals(bytes)).toBe(true);
      expect(row.sha256).toBe(sha256);
      expect(row.status).toBe('READY');
    } finally {
      await ownerPool.end();
    }
  });

  it('isolates a generated artifact between tenants', async () => {
    const bytes = Buffer.from('%PDF-1.4 tenant isolation');
    const appPool = createPool({ role: 'app' });
    let insertedId: string;
    try {
      const inserted = await withTenantOnPool(
        appPool,
        { tenantId: TENANT_A, userId: USER_A },
        async (tx) => {
          const res = await tx.query<{ id: string }>(
            `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                                uploaded_by, origin, content, sha256, status)
             VALUES ($1, $2, 'iso.pdf', 'application/pdf', $3, $4, 'GENERATED', $5, $6, 'READY')
             RETURNING id`,
            [
              TENANT_A,
              `t/${TENANT_A}/${crypto.randomUUID()}`,
              bytes.length,
              USER_A,
              bytes,
              'e'.repeat(64),
            ],
          );
          return res.rows[0]!;
        },
      );
      insertedId = inserted.id;
    } finally {
      await appPool.end();
    }
    insertedIds.push(insertedId!);

    const otherPool = createPool({ role: 'app' });
    try {
      const asTenantB = await withTenantOnPool(
        otherPool,
        { tenantId: TENANT_B, userId: USER_A },
        (tx) => tx.query(`SELECT id FROM files WHERE id = $1`, [insertedId!]),
      );
      expect(asTenantB.rowCount).toBe(0);
    } finally {
      await otherPool.end();
    }
  });
});

describe.skipIf(!hasDb)('document digest columns', () => {
  it('medical_certificates records a digest and has a real FK on file_id', async () => {
    expect(await columnExists('medical_certificates', 'sha256_hash')).toBe(true);
    const names = await constraintNames('medical_certificates');
    expect(names).toContain('medical_certificates_file_id_fkey');
  });

  it('payment_reprints records its artifact and digest', async () => {
    expect(await columnExists('payment_reprints', 'file_id')).toBe(true);
    expect(await columnExists('payment_reprints', 'sha256_hash')).toBe(true);
  });

  it('lab_reports.sha256_hash is nullable: a document cannot be hashed before it is rendered', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      const res = await pool.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'lab_reports' AND column_name = 'sha256_hash'`,
      );
      expect(res.rows[0]?.is_nullable).toBe('YES');
    } finally {
      await pool.end();
    }
  });

  it('lab_reports.file_id is a composite tenant FK, not a bare files(id) reference', async () => {
    const pool = createPool({ role: 'owner' });
    try {
      const res = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = 'lab_reports'::regclass AND conname = 'lab_reports_file_id_fkey'`,
      );
      const def = res.rows[0]?.def ?? '';
      // A bare `REFERENCES files(id)` cannot express "same tenant" and so
      // permits one tenant's report to point at another tenant's artifact.
      expect(def).toContain('(tenant_id, file_id)');
      expect(def).toContain('files(tenant_id, id)');
    } finally {
      await pool.end();
    }
  });
});
