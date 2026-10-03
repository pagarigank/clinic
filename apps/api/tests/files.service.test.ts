/**
 * Tests for FilesService (todo 2.1)
 * - requestUpload (SCAN_PENDING status, presigned PUT URL)
 * - getDownloadUrl before complete (fails because not READY)
 * - completeUpload (transitions to READY)
 * - getFile metadata
 * - getDownloadUrl after complete (returns presigned GET URL)
 * - NOT_FOUND for non-existent file
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { FilesService } from '../src/files/files.service.js';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const USER_A = 'a3000000-0000-4000-8000-000000000001';

describe.skipIf(!hasDb)('FilesService (todo 2.1)', () => {
  let service: FilesService;
  const createdFileIds: string[] = [];

  beforeEach(() => {
    service = new FilesService();
  });

  afterAll(async () => {
    if (createdFileIds.length > 0) {
      const ownerPool = createPool({ role: 'owner' });
      await ownerPool.query(`DELETE FROM files WHERE id = ANY($1)`, [createdFileIds]);
    }
  });

  it('handles full lifecycle: requestUpload -> fail download -> complete -> download', async () => {
    const uploadRes = await service.requestUpload(TENANT_A, USER_A, {
      fileName: 'lab_results.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1048576,
    });
    createdFileIds.push(uploadRes.fileId);

    expect(uploadRes.fileId).toBeDefined();
    expect(uploadRes.objectKey).toContain(`t/${TENANT_A}/`);
    expect(uploadRes.uploadUrl).toBeDefined();

    // Verify initial file metadata has SCAN_PENDING
    const pendingMeta = await service.getFile(TENANT_A, USER_A, uploadRes.fileId);
    expect(pendingMeta.file_name).toBe('lab_results.pdf');
    expect(pendingMeta.status).toBe('SCAN_PENDING');

    // Attempt download before complete should fail with validation error
    await expect(service.getDownloadUrl(TENANT_A, USER_A, uploadRes.fileId)).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_FAILED',
        detail: expect.stringContaining('SCAN_PENDING'),
      },
    });

    // Complete upload
    const completed = await service.completeUpload(TENANT_A, USER_A, uploadRes.fileId);
    expect(completed?.status).toBe('READY');

    // Fetch metadata again
    const readyMeta = await service.getFile(TENANT_A, USER_A, uploadRes.fileId);
    expect(readyMeta.status).toBe('READY');

    // Download URL should now succeed
    const downloadRes = await service.getDownloadUrl(TENANT_A, USER_A, uploadRes.fileId);
    expect(downloadRes.downloadUrl).toBeDefined();
    expect(downloadRes.downloadUrl).toContain('response-content-disposition');
  });

  it('throws NOT_FOUND when accessing non-existent file', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(service.getFile(TENANT_A, USER_A, fakeId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND', detail: 'File not found' },
    });
    await expect(service.getDownloadUrl(TENANT_A, USER_A, fakeId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND', detail: 'File not found' },
    });
    await expect(service.completeUpload(TENANT_A, USER_A, fakeId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND', detail: 'File not found' },
    });
  });
});
