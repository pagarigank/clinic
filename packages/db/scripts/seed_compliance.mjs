import pg from 'pg';

const client = new pg.Client({ connectionString: 'postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic' });

async function seed() {
  await client.connect();
  const tenants = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  for (const tenantId of tenants) {
    await client.query(`
      INSERT INTO retention_policies (tenant_id, record_class, retention_years, action, legal_basis)
      VALUES
        ($1, 'CLINICAL_VISITS', 10, 'ARCHIVE', 'DOH AO 2007-0027 retention of clinical records'),
        ($1, 'CLINICAL_NOTES', 10, 'ARCHIVE', 'DOH AO 2007-0027 retention of clinical notes'),
        ($1, 'LAB_ORDERS', 10, 'ARCHIVE', 'DOH AO 2007-0027 clinical laboratory archive'),
        ($1, 'LAB_RESULTS', 10, 'ARCHIVE', 'DOH AO 2007-0027 clinical laboratory archive'),
        ($1, 'PRESCRIPTIONS', 5, 'ARCHIVE', 'PDEA S2 Dangerous Drugs Act RA 9165 / FDA Circular'),
        ($1, 'INVOICES', 10, 'ARCHIVE', 'NIRC Sec 235 / BIR RR 9-2009 commercial books retention'),
        ($1, 'PAYMENTS', 10, 'ARCHIVE', 'NIRC Sec 235 / BIR RR 9-2009 financial receipts'),
        ($1, 'AUDIT_LOGS', 10, 'ARCHIVE', 'DPA RA 10173 accountability principle')
      ON CONFLICT (tenant_id, record_class) DO NOTHING
    `, [tenantId]);

    await client.query(`
      INSERT INTO consent_templates (tenant_id, version, title, body, purposes, locale, status)
      VALUES (
        $1, 1, 'General Consent to Medical Treatment and Data Processing',
        'I hereby grant consent for medical consultation, clinical examinations, laboratory testing, and necessary treatment. I acknowledge that my personal and sensitive health information (PHI) will be processed in accordance with Republic Act No. 10173 (Data Privacy Act of 2012) and Department of Health regulations.',
        '["TREATMENT", "BILLING", "HEALTHCARE_OPERATIONS", "REGULATORY_COMPLIANCE"]'::jsonb,
        'en', 'PUBLISHED'
      )
      ON CONFLICT (tenant_id, locale, version) DO NOTHING
    `, [tenantId]);
  }
  console.log('Compliance baseline seeded successfully for demo tenants');
  await client.end();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
