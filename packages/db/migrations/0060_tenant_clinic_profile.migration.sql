-- 0060_tenant_clinic_profile: Tenant clinic profile and official printout letterhead fields
-- Adds facility letterhead & regulatory identity fields to tenants and branches.
SET ROLE clinic_owner;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS doh_license_no text,
  ADD COLUMN IF NOT EXISTS philhealth_accreditation_no text,
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS letterhead_footer text;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text;

-- Seed default letterhead for active demo tenants if empty
SELECT set_config('app.is_platform', 'true', true);
UPDATE tenants
SET
  tagline = COALESCE(tagline, 'Primary Care, Diagnostic & Ambulatory Center'),
  address = COALESCE(address, '100 Medical Center Way, Ermita, Manila, Philippines'),
  phone = COALESCE(phone, '(02) 8524-1000 / +63 917 555 0100'),
  email = COALESCE(email, 'care@lasaletteclinic.ph'),
  doh_license_no = COALESCE(doh_license_no, 'DOH-LTO-01449-NCR'),
  philhealth_accreditation_no = COALESCE(philhealth_accreditation_no, 'PHIC-ACC-98765-PCP'),
  tin = COALESCE(tin, '009-876-543-000'),
  letterhead_footer = COALESCE(letterhead_footer, 'Licensed Secondary Clinical Laboratory & PhilHealth Konsulta Accredited Facility')
WHERE slug = 'la-salette' AND address IS NULL;

UPDATE tenants
SET
  tagline = COALESCE(tagline, 'Family Medicine & Diagnostic Center'),
  address = COALESCE(address, '789 Healthcare Avenue, Quezon City, Metro Manila'),
  phone = COALESCE(phone, '(02) 8920-5000 / +63 918 555 0200'),
  email = COALESCE(email, 'contact@demo-a.clinic.ph'),
  doh_license_no = COALESCE(doh_license_no, 'DOH-NCR-01234-L2'),
  philhealth_accreditation_no = COALESCE(philhealth_accreditation_no, 'PHIC-ACC-12345'),
  tin = COALESCE(tin, '001-234-567-000'),
  letterhead_footer = COALESCE(letterhead_footer, 'Licensed by the Department of Health (DOH) · PhilHealth Accredited')
WHERE slug = 'demo-a' AND address IS NULL;
