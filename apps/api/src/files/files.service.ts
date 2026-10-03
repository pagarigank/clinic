import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ProblemException } from '../http/problem.exception.js';
import type { CreateFileRequest, FilePresignedResponse } from '@clinic/contracts';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  endpoint: process.env.S3_ENDPOINT, // Used for local MinIO if any
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy-access-key-id',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy-secret-access-key',
  },
});

const BUCKET = process.env.S3_BUCKET || 'clinic-files-dev';

@Injectable()
export class FilesService {
  /**
   * Request a presigned URL to upload a file directly to S3.
   * Generates a record in `files` table with `SCAN_PENDING`.
   */
  async requestUpload(
    tenantId: string,
    userId: string,
    dto: CreateFileRequest,
  ): Promise<FilePresignedResponse> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const keyId = crypto.randomUUID();
      const objectKey = `t/${tenantId}/${keyId}`;

      const res = await tx.query<{ id: string }>(
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes, uploaded_by, scan_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'SCAN_PENDING')
         RETURNING id`,
        [tenantId, objectKey, dto.fileName, dto.mimeType, dto.sizeBytes, userId],
      );
      const fileId = res.rows[0]?.id || '';

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: dto.mimeType,
        ContentLength: dto.sizeBytes,
      });

      // Valid for 15 minutes for upload
      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

      return {
        fileId,
        objectKey,
        uploadUrl,
      };
    });
  }

  /**
   * Get a short-lived download URL for a file (≤ 60 seconds).
   * Enforces ClamAV scan gating:
   * - Blocks INFECTED files (FORBIDDEN)
   * - Blocks SCAN_PENDING files (CONFLICT)
   * Logs access for compliance.
   */
  async getDownloadUrl(
    tenantId: string,
    userId: string,
    fileId: string,
    patientId?: string,
  ): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query<{
        object_key: string;
        status: string;
        scan_status: string;
        file_name: string;
      }>(
        `SELECT object_key, status, scan_status, file_name FROM files WHERE id = $1 AND tenant_id = $2`,
        [fileId, tenantId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      const file = res.rows[0];
      if (!file) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }
      if (file.status !== 'READY') {
        throw new ProblemException('VALIDATION_FAILED', {
          detail: `File cannot be downloaded because its status is ${file.status}`,
        });
      }

      // ClamAV Scan gating
      if (file.scan_status === 'INFECTED') {
        throw new ProblemException('FORBIDDEN', {
          detail: 'File is infected with malware and cannot be downloaded',
        });
      }

      if (file.scan_status === 'SCAN_PENDING') {
        throw new ProblemException('CONFLICT', {
          detail: 'File scan is still pending. Try again once scan completes.',
        });
      }

      // Audited download: short-lived URL (60 seconds)
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.object_key,
        ResponseContentDisposition: `attachment; filename="${file.file_name}"`,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

      // If patient related, write to phi_access_log
      if (patientId) {
        await tx.query(
          `INSERT INTO phi_access_log (tenant_id, user_id, patient_id, access_type, justification)
           VALUES ($1, $2, $3, 'DOWNLOAD', 'File download: ' || $4)`,
          [tenantId, userId, patientId, file.file_name],
        );
      }

      return { downloadUrl, expiresInSeconds: 60 };
    });
  }

  /**
   * Get preview URL for documents or images (inline disposition, ≤ 60 seconds).
   */
  async getPreviewUrl(
    tenantId: string,
    userId: string,
    fileId: string,
  ): Promise<{ previewUrl: string; mimeType: string }> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query<{
        object_key: string;
        status: string;
        scan_status: string;
        file_name: string;
        mime_type: string;
      }>(
        `SELECT object_key, status, scan_status, file_name, mime_type
         FROM files
         WHERE id = $1 AND tenant_id = $2`,
        [fileId, tenantId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      const file = res.rows[0];
      if (!file) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }
      if (file.scan_status === 'INFECTED') {
        throw new ProblemException('FORBIDDEN', { detail: 'Infected file cannot be previewed' });
      }

      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.object_key,
        ResponseContentDisposition: `inline; filename="${file.file_name}"`,
      });

      const previewUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });
      return { previewUrl, mimeType: file.mime_type };
    });
  }

  /**
   * Confirm file upload completed by client; transitions to READY and marks CLEAN.
   * Creates initial record in file_versions.
   */
  async completeUpload(tenantId: string, userId: string, fileId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query<{
        id: string;
        object_key: string;
        file_name: string;
        mime_type: string;
        size_bytes: string;
        status: string;
        scan_status: string;
        created_at: Date;
      }>(
        `UPDATE files
         SET status = 'READY', scan_status = 'CLEAN', updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, object_key, file_name, mime_type, size_bytes, status, scan_status, created_at`,
        [fileId, tenantId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      const file = res.rows[0];
      if (!file) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      // Add to file_versions if not already recorded
      await tx.query(
        `INSERT INTO file_versions (
           tenant_id, file_id, version, object_key, size_bytes, scan_status, created_by
         )
         VALUES ($1, $2, 1, $3, $4, 'CLEAN', $5)
         ON CONFLICT (tenant_id, file_id, version) DO NOTHING`,
        [tenantId, fileId, file.object_key, Number(file.size_bytes), userId],
      );

      return file;
    });
  }

  /**
   * List all versions of a file.
   */
  async listVersions(tenantId: string, userId: string, fileId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, version, object_key, size_bytes, sha256, scan_status, created_at, created_by
         FROM file_versions
         WHERE tenant_id = $1 AND file_id = $2
         ORDER BY version DESC`,
        [tenantId, fileId],
      );

      return { versions: res.rows };
    });
  }

  /**
   * Update scan status of a file (e.g. from background ClamAV scanner).
   */
  async updateScanStatus(
    tenantId: string,
    fileId: string,
    scanStatus: 'CLEAN' | 'INFECTED' | 'SCAN_PENDING',
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE files
         SET scan_status = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3
         RETURNING id, scan_status`,
        [scanStatus, fileId, tenantId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      return res.rows[0];
    });
  }

  /**
   * Inspect file metadata and status.
   */
  async getFile(tenantId: string, userId: string, fileId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, object_key, file_name, mime_type, size_bytes, status, scan_status, current_version, created_at
         FROM files
         WHERE id = $1 AND tenant_id = $2`,
        [fileId, tenantId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }
      return res.rows[0];
    });
  }
}
