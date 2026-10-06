SET ROLE clinic_owner;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS tagline,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS doh_license_no,
  DROP COLUMN IF EXISTS philhealth_accreditation_no,
  DROP COLUMN IF EXISTS tin,
  DROP COLUMN IF EXISTS letterhead_footer;

ALTER TABLE branches
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email;
