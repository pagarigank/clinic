-- 0041_generated_artifacts.migration.sql
-- Generated document artifacts (todo.md 3.2, JOB-43 / JOB-50, certificate PDF)
--
-- `files` already existed as the *upload* path: the client streams bytes to
-- object storage through a presigned URL and the row waits in SCAN_PENDING for
-- the malware gate. Server-rendered documents never take that path - there is
-- no upload to scan - so this migration adds a second, explicitly labelled
-- storage strategy on the same table rather than introducing a parallel table.
--
--   origin = 'UPLOAD'     object_key set, bytes in object storage, SCAN_PENDING
--   origin = 'GENERATED'  content set inline, sha256 set, READY immediately
--
-- The digest is stored twice on purpose: on `files` so the bytes actually
-- served can be re-verified, and on the owning document row so the document
-- carries its own integrity marker (lab_reports already did this).
--
-- `files` gains UNIQUE (tenant_id, id) so downstream references can be
-- *composite* tenant FKs. A single-column `REFERENCES files(id)` cannot express
-- "same tenant" and therefore permits cross-tenant artifact linkage, which the
-- tenant-isolation ground rules (todo.md 49) forbid.

-- 1. Composite-FK prerequisite: allow (tenant_id, id) references.
ALTER TABLE files
    ADD CONSTRAINT files_tenant_id_id_key UNIQUE (tenant_id, id);

-- 2. Inline artifact storage for server-rendered documents.
ALTER TABLE files
    ADD COLUMN content BYTEA,
    ADD COLUMN sha256 TEXT,
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'UPLOAD';

-- A digest that is not 64 lowercase hex characters cannot have come from
-- SHA-256, so reject it rather than storing an unverifiable marker.
ALTER TABLE files
    ADD CONSTRAINT files_sha256_format
    CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

-- The two strategies are mutually exclusive and each is internally consistent:
-- a GENERATED row must carry bytes, a digest, READY status, and a declared size
-- that agrees with the byte count. Without the size agreement a truncated read
-- could pass a length check.
ALTER TABLE files
    ADD CONSTRAINT files_generated_artifact_integrity
    CHECK (
        (origin = 'UPLOAD'
         AND content IS NULL
         AND sha256 IS NULL)
     OR (origin = 'GENERATED'
         AND content IS NOT NULL
         AND sha256 IS NOT NULL
         AND status = 'READY'
         AND size_bytes = octet_length(content))
    );

-- 3. medical_certificates: file_id existed with no foreign key at all, so it
--    could dangle or point at another tenant's artifact. Add a composite FK
--    plus the document's own digest.
ALTER TABLE medical_certificates
    ADD COLUMN sha256_hash TEXT;

ALTER TABLE medical_certificates
    ADD CONSTRAINT medical_certificates_file_id_fkey
    FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id);

-- 4. payment_reprints: `format` already distinguished PDF from THERMAL but
--    there was nowhere to record the artifact or its digest.
ALTER TABLE payment_reprints
    ADD COLUMN file_id UUID,
    ADD COLUMN sha256_hash TEXT;

ALTER TABLE payment_reprints
    ADD CONSTRAINT payment_reprints_file_id_fkey
    FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id);

-- 5. lab_reports: replace the single-column FK with a composite tenant FK.
--    ON DELETE SET NULL is not available here - it would null tenant_id too,
--    which is NOT NULL - so deletion is RESTRICTed. Rendered reports are
--    evidence: `files.deleted_at` provides the soft-delete path.
ALTER TABLE lab_reports
    DROP CONSTRAINT lab_reports_file_id_fkey;

ALTER TABLE lab_reports
    ADD CONSTRAINT lab_reports_file_id_fkey
    FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id) ON DELETE RESTRICT;

-- 6. A document cannot be hashed before it is rendered. `sha256_hash` was NOT
--    NULL, which is why both lab.service.ts and JOB-43 filled it with a digest
--    of a metadata string (report JSON, or a string containing Date.now()).
--    Those values are well-formed 64-hex but describe no document, so a stored
--    "verified" hash could not be re-verified against served bytes.
--    The digest now means "SHA-256 of the rendered PDF in `files`", and it stays
--    NULL until JOB-43 has actually rendered one. file_id IS NULL is therefore
--    the honest "not yet rendered" marker.
ALTER TABLE lab_reports
    ALTER COLUMN sha256_hash DROP NOT NULL;
