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
      // 1. Generate an object key (t/{tenant_id}/{random_uuid})
      const keyId = crypto.randomUUID();
      const objectKey = `t/${tenantId}/${keyId}`;

      // 2. Create the file record (status = SCAN_PENDING)
      const res = await tx.query(
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [tenantId, objectKey, dto.fileName, dto.mimeType, dto.sizeBytes, userId]
      );
      const fileId = res.rows[0].id;

      // 3. Generate presigned URL
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: dto.mimeType,
        ContentLength: dto.sizeBytes,
      });

      // Valid for 15 minutes
      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

      return {
        fileId,
        objectKey,
        uploadUrl,
      };
    });
  }

  /**
   * Get a short-lived download URL for a file.
   * Re-authorizes access via RLS (withTenant).
   * Refuses to serve if file is not READY.
   */
  async getDownloadUrl(tenantId: string, userId: string, fileId: string): Promise<{ downloadUrl: string }> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query<{ object_key: string; status: string; file_name: string }>(
        `SELECT object_key, status, file_name FROM files WHERE id = $1`,
        [fileId]
      );

      if (res.rowCount === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'File not found' });
      }

      const file = res.rows[0];
      if (!file) {
         throw new ProblemException('NOT_FOUND' as any, { detail: 'File not found' });
      }
      if (file.status !== 'READY') {
        throw new ProblemException('VALIDATION_FAILED', {
          detail: `File cannot be downloaded because its status is ${file.status}`,
        });
      }

      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.object_key,
        ResponseContentDisposition: `attachment; filename="${file.file_name}"`,
      });

      // Valid for 15 minutes
      const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

      return { downloadUrl };
    });
  }

  /**
   * Confirm file upload completed by client; transitions to READY.
   */
  async completeUpload(tenantId: string, userId: string, fileId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE files
         SET status = 'READY', updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, object_key, file_name, mime_type, size_bytes, status, created_at`,
        [fileId, tenantId],
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
        `SELECT id, object_key, file_name, mime_type, size_bytes, status, created_at
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
