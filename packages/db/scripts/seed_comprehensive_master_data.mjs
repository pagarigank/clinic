import pg from "pg";

const connectionString = process.env.CLINIC_DATABASE_URL || "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic";
const pool = new pg.Pool({ connectionString });

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_A = "a1000000-0000-4000-8000-000000000001";
const ADMIN_A = "a3000000-0000-4000-8000-000000000001";

export async function seedComprehensiveMasterData(client, targetTenantId = tenantId, targetBranchId = branchId, options = {}) {
  const tenantId = targetTenantId;
  const branchId = targetBranchId;
  const zeroStock = options.zeroStock === true;
  console.log(`Seeding comprehensive master data for tenant ${tenantId}...`);

  // ── 1. UOMs ─────────────────────────────────────────────────────────────
  console.log("  1. Seeding UOMs...");
  const uoms = [
    { code: "PCS", name: "Piece(s)" },
    { code: "BOX", name: "Box" },
    { code: "PACK", name: "Pack" },
    { code: "ROLL", name: "Roll" },
    { code: "VIAL", name: "Vial" },
    { code: "AMP", name: "Ampoule" },
    { code: "BOTTLE", name: "Bottle" },
    { code: "SET", name: "Set" },
    { code: "TUBE", name: "Tube" },
  ];

  const uomMap = new Map();
  for (const u of uoms) {
    const res = await client.query(
      `INSERT INTO uoms (tenant_id, code, name, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true
       RETURNING id, code`,
      [tenantId, u.code, u.name]
    );
    uomMap.set(u.code, res.rows[0].id);
  }

  // ── 2. Stock Locations ──────────────────────────────────────────────────
  console.log("  2. Seeding Stock Locations...");
  const locations = [
    { code: "LOC-MAIN-STORE", name: "Central Supply Depot", type: "CENTRAL_STORE" },
    { code: "LOC-PHARMACY", name: "Main Clinic Pharmacy", type: "PHARMACY" },
    { code: "LOC-ROOM-1", name: "Consultation Room 1", type: "CLINIC_ROOM" },
    { code: "LOC-ROOM-2", name: "Consultation Room 2", type: "CLINIC_ROOM" },
    { code: "LOC-PROC-ROOM", name: "Minor Procedure / Treatment Room", type: "CLINIC_ROOM" },
    { code: "LOC-PHLEB-ROOM", name: "Phlebotomy & Extraction Area", type: "CLINIC_ROOM" },
    { code: "LOC-ER-ROOM", name: "Emergency & Triage Station", type: "CLINIC_ROOM" },
  ];

  const locationMap = new Map();
  for (const loc of locations) {
    const res = await client.query(
      `INSERT INTO stock_locations (tenant_id, branch_id, code, name, type, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (tenant_id, branch_id, code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = true
       RETURNING id, code`,
      [tenantId, branchId, loc.code, loc.name, loc.type]
    );
    locationMap.set(loc.code, res.rows[0].id);
  }

  // ── 3. Central Supply Items ─────────────────────────────────────────────
  console.log("  3. Seeding Central Supply & Consumables Items...");
  const supplyItems = [
    { code: "SUP-GLV-S", name: "Latex Examination Gloves - Small", uom: "BOX", cost: 180.0 },
    { code: "SUP-GLV-M", name: "Latex Examination Gloves - Medium", uom: "BOX", cost: 180.0 },
    { code: "SUP-GLV-L", name: "Latex Examination Gloves - Large", uom: "BOX", cost: 180.0 },
    { code: "SUP-GAUZE-44", name: "Sterile Gauze Pads 4x4 100s", uom: "PACK", cost: 150.0 },
    { code: "SUP-GAUZE-22", name: "Sterile Gauze Pads 2x2 100s", uom: "PACK", cost: 95.0 },
    { code: "SUP-TAPE-1IN", name: "Micropore Surgical Tape 1-inch", uom: "ROLL", cost: 45.0 },
    { code: "SUP-TAPE-2IN", name: "Micropore Surgical Tape 2-inch", uom: "ROLL", cost: 85.0 },
    { code: "SUP-SYR-1ML", name: "Disposable Syringe 1mL Tuberculin", uom: "PCS", cost: 8.0 },
    { code: "SUP-SYR-3ML", name: "Disposable Syringe 3mL with Needle 23G", uom: "PCS", cost: 10.0 },
    { code: "SUP-SYR-5ML", name: "Disposable Syringe 5mL with Needle 22G", uom: "PCS", cost: 12.0 },
    { code: "SUP-SYR-10ML", name: "Disposable Syringe 10mL", uom: "PCS", cost: 15.0 },
    { code: "SUP-IV-G20", name: "IV Cannula / Venflon G20 Pink", uom: "PCS", cost: 35.0 },
    { code: "SUP-IV-G22", name: "IV Cannula / Venflon G22 Blue", uom: "PCS", cost: 35.0 },
    { code: "SUP-IV-G24", name: "IV Cannula / Venflon G24 Yellow", uom: "PCS", cost: 38.0 },
    { code: "SUP-IV-SET", name: "Macroset IV Tubing Infusion Set", uom: "SET", cost: 45.0 },
    { code: "SUP-IV-NSS-500", name: "0.9% Normal Saline Solution 500mL", uom: "BOTTLE", cost: 55.0 },
    { code: "SUP-IV-NSS-1L", name: "0.9% Normal Saline Solution 1000mL", uom: "BOTTLE", cost: 75.0 },
    { code: "SUP-IV-D5NSS-1L", name: "5% Dextrose in 0.9% NaCl 1000mL", uom: "BOTTLE", cost: 85.0 },
    { code: "SUP-IV-PLR-1L", name: "Plain Lactated Ringer's Solution 1000mL", uom: "BOTTLE", cost: 85.0 },
    { code: "SUP-ANT-POVI", name: "Povidone Iodine 10% Antiseptic 120mL", uom: "BOTTLE", cost: 65.0 },
    { code: "SUP-ALC-70", name: "70% Isopropyl Alcohol 500mL", uom: "BOTTLE", cost: 70.0 },
    { code: "SUP-VAC-EDTA", name: "Vacutainer EDTA K2 2mL Lavender Tube", uom: "PCS", cost: 12.0 },
    { code: "SUP-VAC-SST", name: "Vacutainer Gel SST 4mL Gold Tube", uom: "PCS", cost: 14.0 },
    { code: "SUP-VAC-BFLY", name: "Blood Collection Butterfly Needle 23G", uom: "PCS", cost: 22.0 },
    { code: "SUP-CONT-URINE", name: "Sterile Urine Container 60mL", uom: "PCS", cost: 15.0 },
    { code: "SUP-CONT-STOOL", name: "Clean Stool Container with Spoon", uom: "PCS", cost: 12.0 },
    { code: "SUP-MASK-SURG", name: "Surgical 3-Ply Face Mask 50s", uom: "BOX", cost: 120.0 },
    { code: "SUP-MASK-N95", name: "N95 Particulate Respirator Mask", uom: "PCS", cost: 40.0 },
    { code: "SUP-CHUX", name: "Disposable Underpad / Bed Chux 10s", uom: "PACK", cost: 160.0 },
    { code: "SUP-TONGUE-DEP", name: "Wooden Tongue Depressors 100s", uom: "BOX", cost: 60.0 },
  ];

  const supplyItemMap = new Map();
  for (const item of supplyItems) {
    const uomId = uomMap.get(item.uom) || uomMap.get("PCS");
    const res = await client.query(
      `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id, is_batch_tracked, is_expiry_tracked, standard_cost, min_shelf_life_days_on_receipt, is_active)
       VALUES ($1, $2, $3, 'SUPPLY', $4, true, true, $5, 180, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, standard_cost = EXCLUDED.standard_cost, is_active = true
       RETURNING id, code`,
      [tenantId, item.code, item.name, uomId, item.cost]
    );
    supplyItemMap.set(item.code, res.rows[0].id);

    if (!zeroStock) {
      // Seed stock batch and balance in Central Supply Depot
      const batchRes = await client.query(
        `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status, received_at)
         VALUES ($1, $2, $3, '2028-12-31', $4, 'AVAILABLE', now())
         RETURNING id`,
        [tenantId, res.rows[0].id, `LOT-2026-${item.code}`, item.cost]
      );

      const depotLocId = locationMap.get("LOC-MAIN-STORE");
      await client.query(
        `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, qty_reserved, last_movement_at)
         VALUES ($1, $2, $3, 200, 0, now())
         ON CONFLICT (tenant_id, location_id, batch_id) DO UPDATE SET qty_on_hand = 200, qty_reserved = 0`,
        [tenantId, depotLocId, batchRes.rows[0].id]
      );

      // Also seed a working stock batch in Consultation Room 1 for clinic use
      const room1LocId = locationMap.get("LOC-ROOM-1");
      await client.query(
        `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, qty_reserved, last_movement_at)
         VALUES ($1, $2, $3, 25, 0, now())
         ON CONFLICT (tenant_id, location_id, batch_id) DO UPDATE SET qty_on_hand = 25, qty_reserved = 0`,
        [tenantId, room1LocId, batchRes.rows[0].id]
      );
    }
  }

  // ── 4. Laboratory Master Data ───────────────────────────────────────────
  console.log("  4. Seeding Laboratory Master Data (Sections, Specimens, Tests, Analytes, Ranges)...");
  
  // Sections
  const labSections = [
    { code: "HEM", name: "Hematology", displayOrder: 1 },
    { code: "MIC", name: "Clinical Microscopy & Parasitology", displayOrder: 2 },
    { code: "CHM", name: "Clinical Chemistry", displayOrder: 3 },
    { code: "IMM", name: "Immunology & Serology", displayOrder: 4 },
    { code: "MCB", name: "Microbiology", displayOrder: 5 },
  ];
  const sectionMap = new Map();
  for (const s of labSections) {
    const res = await client.query(
      `INSERT INTO lab_sections (tenant_id, code, name, display_order, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order, is_active = true
       RETURNING id, code`,
      [tenantId, s.code, s.name, s.displayOrder]
    );
    sectionMap.set(s.code, res.rows[0].id);
  }

  // Specimen Types
  const labSpecimens = [
    { code: "WB-EDTA", name: "Whole Blood (EDTA Lavender Top)", container: "Vacutainer EDTA K2 2mL", color: "LAVENDER", stability: 24 },
    { code: "SERUM-SST", name: "Blood Serum (SST Gold Top)", container: "Vacutainer Gel SST 4mL", color: "GOLD", stability: 48 },
    { code: "PLASMA-CIT", name: "Blood Plasma (Sodium Citrate Light Blue Top)", container: "Vacutainer Citrate 2.7mL", color: "LIGHT_BLUE", stability: 8 },
    { code: "URINE-RND", name: "Clean-Catch Midstream Urine", container: "Sterile Urine Cup 60mL", color: "YELLOW_CUP", stability: 2 },
    { code: "STOOL-RTN", name: "Fresh Stool / Feces", container: "Clean Stool Container with Spoon", color: "BLUE_CUP", stability: 2 },
    { code: "SWAB-NPH", name: "Nasopharyngeal / Oropharyngeal Swab", container: "Viral Transport Media / Sterile Swab", color: "RED", stability: 12 },
    { code: "SPUTUM", name: "Early Morning Sputum", container: "Wide-mouth Sterile Sputum Cup", color: "CLEAR_CUP", stability: 4 },
  ];
  const specimenMap = new Map();
  for (const sp of labSpecimens) {
    const res = await client.query(
      `INSERT INTO lab_specimen_types (tenant_id, code, name, default_container, tube_top_color, stability_hours, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, default_container = EXCLUDED.default_container, tube_top_color = EXCLUDED.tube_top_color, stability_hours = EXCLUDED.stability_hours, is_active = true
       RETURNING id, code`,
      [tenantId, sp.code, sp.name, sp.container, sp.color, sp.stability]
    );
    specimenMap.set(sp.code, res.rows[0].id);
  }

  // Instruments
  const labInstruments = [
    { code: "SYS-XN350", name: "Sysmex XN-350 Automated Hematology Analyzer", section: "HEM", model: "XN-350", serial: "SN-XN-8849" },
    { code: "MND-BS240", name: "Mindray BS-240 Clinical Chemistry Analyzer", section: "CHM", model: "BS-240", serial: "SN-BS-9021" },
    { code: "DIR-H100", name: "Dirui H-100 Urine Chemistry Strip Analyzer", section: "MIC", model: "H-100", serial: "SN-H1-4412" },
    { code: "BIO-M200", name: "Bio-Rad Microplate Reader", section: "IMM", model: "M200", serial: "SN-BR-3091" },
  ];
  for (const inst of labInstruments) {
    await client.query(
      `INSERT INTO lab_instruments (tenant_id, branch_id, section_id, code, name, model, serial_no, calibration_due_at, last_calibrated_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '90 days', now(), true)
       ON CONFLICT DO NOTHING`,
      [tenantId, branchId, sectionMap.get(inst.section), inst.code, inst.name, inst.model, inst.serial]
    );
  }

  // Lab Tests & Panels Definition
  const tests = [
    {
      code: "CBC-PLT",
      name: "Complete Blood Count with Platelet Count (CBC-PC)",
      section: "HEM",
      specimen: "WB-EDTA",
      tat: 60,
      isPanel: true,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "WBC", name: "White Blood Cells (WBC)", unit: "10^9/L", min: 4.5, max: 11.0, critLow: 2.0, critHigh: 30.0 },
        { code: "RBC", name: "Red Blood Cells (RBC)", unit: "10^12/L", min: 4.0, max: 5.5 },
        { code: "HGB", name: "Hemoglobin", unit: "g/dL", min: 12.0, max: 16.0, critLow: 7.0, critHigh: 20.0 },
        { code: "HCT", name: "Hematocrit", unit: "%", min: 36.0, max: 48.0, critLow: 21.0, critHigh: 60.0 },
        { code: "PLT", name: "Platelet Count", unit: "10^9/L", min: 150.0, max: 450.0, critLow: 50.0, critHigh: 1000.0 },
        { code: "NEUT", name: "Neutrophils", unit: "%", min: 50.0, max: 70.0 },
        { code: "LYMPH", name: "Lymphocytes", unit: "%", min: 20.0, max: 40.0 },
        { code: "MONO", name: "Monocytes", unit: "%", min: 2.0, max: 8.0 },
        { code: "EOS", name: "Eosinophils", unit: "%", min: 1.0, max: 4.0 },
        { code: "BASO", name: "Basophils", unit: "%", min: 0.0, max: 1.0 },
      ],
    },
    {
      code: "UA-ROUT",
      name: "Routine Urinalysis (Physical, Chemical & Microscopic)",
      section: "MIC",
      specimen: "URINE-RND",
      tat: 45,
      isPanel: true,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "COLOR", name: "Color", unit: "", textRange: "Straw to Yellow" },
        { code: "CLAR", name: "Clarity / Transparency", unit: "", textRange: "Clear" },
        { code: "PH", name: "pH", unit: "pH", min: 5.0, max: 8.0 },
        { code: "SG", name: "Specific Gravity", unit: "", min: 1.005, max: 1.030 },
        { code: "PROT", name: "Protein", unit: "", textRange: "Negative" },
        { code: "GLU", name: "Glucose", unit: "", textRange: "Negative" },
        { code: "LEU", name: "Leukocyte Esterase", unit: "", textRange: "Negative" },
        { code: "BLD", name: "Blood / Hemoglobin", unit: "", textRange: "Negative" },
        { code: "RBC-HPF", name: "RBC (Microscopic)", unit: "/hpf", min: 0.0, max: 2.0 },
        { code: "WBC-HPF", name: "WBC (Microscopic)", unit: "/hpf", min: 0.0, max: 5.0 },
        { code: "EPITH", name: "Epithelial Cells", unit: "", textRange: "Rare to Few" },
        { code: "BACT", name: "Bacteria", unit: "", textRange: "None to Few" },
      ],
    },
    {
      code: "FEC-ROUT",
      name: "Routine Fecalysis / Stool Examination",
      section: "MIC",
      specimen: "STOOL-RTN",
      tat: 45,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "COL", name: "Stool Color", unit: "", textRange: "Brown" },
        { code: "CON", name: "Consistency", unit: "", textRange: "Formed / Soft" },
        { code: "PARASITE", name: "Ova or Parasites", unit: "", textRange: "No Ova or Parasites Seen" },
      ],
    },
    {
      code: "CHM-FBS",
      name: "Fasting Blood Sugar (FBS)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: true,
      fasting: true,
      fastingHours: 10,
      analytes: [
        { code: "FBS", name: "Fasting Blood Glucose", unit: "mg/dL", min: 70.0, max: 99.0, critLow: 50.0, critHigh: 400.0 },
      ],
    },
    {
      code: "CHM-HBA1C",
      name: "Glycated Hemoglobin (HbA1c)",
      section: "CHM",
      specimen: "WB-EDTA",
      tat: 120,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "HBA1C", name: "HbA1c", unit: "%", min: 4.0, max: 5.6 },
      ],
    },
    {
      code: "LIPID-PNL",
      name: "Lipid Profile Panel (Chol, Trig, HDL, LDL, VLDL)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 120,
      isPanel: true,
      statAllowed: false,
      fasting: true,
      fastingHours: 12,
      analytes: [
        { code: "CHOL", name: "Total Cholesterol", unit: "mg/dL", min: 0.0, max: 200.0 },
        { code: "TRIG", name: "Triglycerides", unit: "mg/dL", min: 0.0, max: 150.0 },
        { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", min: 40.0, max: 60.0 },
        { code: "LDL", name: "LDL Cholesterol (Direct/Calc)", unit: "mg/dL", min: 0.0, max: 100.0 },
      ],
    },
    {
      code: "CHM-CREA",
      name: "Serum Creatinine with eGFR",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "CREA", name: "Serum Creatinine", unit: "mg/dL", min: 0.6, max: 1.2, critLow: null, critHigh: 5.0 },
      ],
    },
    {
      code: "CHM-BUN",
      name: "Blood Urea Nitrogen (BUN)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "BUN", name: "Blood Urea Nitrogen", unit: "mg/dL", min: 7.0, max: 20.0 },
      ],
    },
    {
      code: "CHM-BUA",
      name: "Blood Uric Acid (BUA)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "BUA", name: "Blood Uric Acid", unit: "mg/dL", min: 3.5, max: 7.2 },
      ],
    },
    {
      code: "CHM-ALT",
      name: "SGPT / ALT (Alanine Aminotransferase)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "ALT", name: "SGPT / ALT", unit: "U/L", min: 7.0, max: 56.0 },
      ],
    },
    {
      code: "CHM-AST",
      name: "SGOT / AST (Aspartate Aminotransferase)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 90,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "AST", name: "SGOT / AST", unit: "U/L", min: 10.0, max: 40.0 },
      ],
    },
    {
      code: "LYTES-PNL",
      name: "Serum Electrolytes Panel (Sodium, Potassium, Chloride)",
      section: "CHM",
      specimen: "SERUM-SST",
      tat: 60,
      isPanel: true,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "NA", name: "Serum Sodium (Na+)", unit: "mmol/L", min: 135.0, max: 145.0, critLow: 120.0, critHigh: 160.0 },
        { code: "K", name: "Serum Potassium (K+)", unit: "mmol/L", min: 3.5, max: 5.0, critLow: 2.8, critHigh: 6.2 },
        { code: "CL", name: "Serum Chloride (Cl-)", unit: "mmol/L", min: 96.0, max: 106.0 },
      ],
    },
    {
      code: "IMM-DENG",
      name: "Dengue Duo Rapid Test (NS1 Antigen + IgG/IgM)",
      section: "IMM",
      specimen: "SERUM-SST",
      tat: 30,
      isPanel: true,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "DENG-NS1", name: "Dengue NS1 Antigen", unit: "", textRange: "Negative" },
        { code: "DENG-IGM", name: "Dengue IgM Antibody", unit: "", textRange: "Negative" },
        { code: "DENG-IGG", name: "Dengue IgG Antibody", unit: "", textRange: "Negative" },
      ],
    },
    {
      code: "IMM-HBSAG",
      name: "Hepatitis B Surface Antigen Rapid (HBsAg)",
      section: "IMM",
      specimen: "SERUM-SST",
      tat: 45,
      isPanel: false,
      statAllowed: false,
      fasting: false,
      analytes: [
        { code: "HBSAG", name: "HBsAg Rapid Screen", unit: "", textRange: "Non-Reactive" },
      ],
    },
    {
      code: "MIC-HCG",
      name: "Urine Pregnancy Test (hCG Rapid)",
      section: "MIC",
      specimen: "URINE-RND",
      tat: 15,
      isPanel: false,
      statAllowed: true,
      fasting: false,
      analytes: [
        { code: "HCG", name: "Urine hCG", unit: "", textRange: "Negative" },
      ],
    },
  ];

  for (const t of tests) {
    const sectionId = sectionMap.get(t.section);
    const specimenId = specimenMap.get(t.specimen);
    const testRes = await client.query(
      `INSERT INTO lab_tests (
         tenant_id, section_id, specimen_type_id, code, name, tat_minutes, 
         is_stat_allowed, is_confidential, fasting_required, fasting_hours, is_panel, requires_pathologist_review, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, false, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET 
         name = EXCLUDED.name, section_id = EXCLUDED.section_id, specimen_type_id = EXCLUDED.specimen_type_id,
         tat_minutes = EXCLUDED.tat_minutes, is_stat_allowed = EXCLUDED.is_stat_allowed, 
         fasting_required = EXCLUDED.fasting_required, fasting_hours = EXCLUDED.fasting_hours,
         is_panel = EXCLUDED.is_panel, is_active = true
       RETURNING id, code`,
      [tenantId, sectionId, specimenId, t.code, t.name, t.tat, t.statAllowed, t.fasting, t.fastingHours || 0, t.isPanel]
    );

    const testId = testRes.rows[0].id;

    let sortOrder = 1;
    for (const an of t.analytes) {
      const anRes = await client.query(
        `INSERT INTO lab_analytes (tenant_id, test_id, code, name, default_unit, precision_digits, is_calculated, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, 2, false, $6, true)
         ON CONFLICT (tenant_id, test_id, code) DO UPDATE SET name = EXCLUDED.name, default_unit = EXCLUDED.default_unit, sort_order = EXCLUDED.sort_order, is_active = true
         RETURNING id`,
        [tenantId, testId, an.code, an.name, an.unit, sortOrder++]
      );
      const analyteId = anRes.rows[0].id;

      // Seed reference range
      await client.query(
        `INSERT INTO lab_reference_ranges (tenant_id, analyte_id, sex, age_min_days, age_max_days, normal_min, normal_max, critical_low, critical_high, text_range, effective_from)
         VALUES ($1, $2, 'ALL', 0, 36500, $3, $4, $5, $6, $7, '2026-01-01T00:00:00Z')
         ON CONFLICT DO NOTHING`,
        [tenantId, analyteId, an.min ?? null, an.max ?? null, an.critLow ?? null, an.critHigh ?? null, an.textRange ?? null]
      );
    }
  }

  // ── 5. Pharmacy Master Data ─────────────────────────────────────────────
  console.log("  5. Seeding Pharmacy Master Data (Generics, Medicines, Drug Products, Stock)...");
  
  const generics = [
    { name: "Amoxicillin", atc: "J01CA04" },
    { name: "Co-Amoxiclav (Amoxicillin + Clavulanic Acid)", atc: "J01CR02" },
    { name: "Azithromycin", atc: "J01FA10" },
    { name: "Cefalexin", atc: "J01DB01" },
    { name: "Cefuroxime", atc: "J01DC02" },
    { name: "Ciprofloxacin", atc: "J01MA02" },
    { name: "Paracetamol", atc: "N02BE01" },
    { name: "Ibuprofen", atc: "M01AE01" },
    { name: "Mefenamic Acid", atc: "M01AG01" },
    { name: "Tramadol Hydrochloride", atc: "N02AX02" },
    { name: "Morphine Sulfate", atc: "N02AA01" },
    { name: "Diazepam", atc: "N05BA01" },
    { name: "Losartan Potassium", atc: "C09CA01" },
    { name: "Amlodipine Besilate", atc: "C08CA01" },
    { name: "Telmisartan", atc: "C09CA07" },
    { name: "Metoprolol Tartrate", atc: "C07AB02" },
    { name: "Carvedilol", atc: "C07AG02" },
    { name: "Metformin Hydrochloride", atc: "A10BA02" },
    { name: "Glimepiride", atc: "A10BB12" },
    { name: "Atorvastatin Calcium", atc: "C10AA05" },
    { name: "Rosuvastatin Calcium", atc: "C10AA07" },
    { name: "Salbutamol Sulfate", atc: "R03CC02" },
    { name: "Montelukast Sodium", atc: "R03DC03" },
    { name: "Cetirizine Hydrochloride", atc: "R06AE07" },
    { name: "Loratadine", atc: "R06AX13" },
    { name: "Omeprazole", atc: "A02BC01" },
    { name: "Esomeprazole", atc: "A02BC05" },
    { name: "Aluminum Hydroxide + Magnesium Hydroxide", atc: "A02AD01" },
    { name: "Oral Rehydration Salts (ORS)", atc: "A07CA" },
    { name: "Multivitamins + Iron", atc: "A11AA01" },
    { name: "Ascorbic Acid + Zinc", atc: "A11GB" },
  ];

  const genericMap = new Map();
  for (const g of generics) {
    const res = await client.query(
      `INSERT INTO generic_names (tenant_id, name, atc_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, name) DO UPDATE SET atc_code = EXCLUDED.atc_code
       RETURNING id, name`,
      [tenantId, g.name, g.atc]
    );
    genericMap.set(g.name, res.rows[0].id);
  }

  const medicines = [
    // Antibiotics
    { code: "MED-AMOX-500", name: "Amoxicillin 500mg Capsule", generic: "Amoxicillin", brand: "Amoxil", strength: "500mg", form: "Capsule", route: "ORAL", rxReq: "RX", cost: 4.5, sched: null },
    { code: "MED-COAMOX-625", name: "Co-Amoxiclav 625mg Tablet", generic: "Co-Amoxiclav (Amoxicillin + Clavulanic Acid)", brand: "Augmentin", strength: "625mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 24.0, sched: null },
    { code: "MED-AZITH-500", name: "Azithromycin 500mg Tablet", generic: "Azithromycin", brand: "Zithromax", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 65.0, sched: null },
    { code: "MED-CEFAL-500", name: "Cefalexin 500mg Capsule", generic: "Cefalexin", brand: "Keflex", strength: "500mg", form: "Capsule", route: "ORAL", rxReq: "RX", cost: 12.0, sched: null },
    { code: "MED-CEFUR-500", name: "Cefuroxime Axetil 500mg Tablet", generic: "Cefuroxime", brand: "Zinnat", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 38.0, sched: null },
    { code: "MED-CIPRO-500", name: "Ciprofloxacin 500mg Tablet", generic: "Ciprofloxacin", brand: "Ciprobay", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 18.0, sched: null },
    // Analgesics & Antipyretics
    { code: "MED-PARA-500", name: "Paracetamol 500mg Tablet", generic: "Paracetamol", brand: "Biogesic", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "OTC", cost: 2.5, sched: null },
    { code: "MED-PARA-SYR", name: "Paracetamol 250mg/5mL 60mL Syrup", generic: "Paracetamol", brand: "Calpol", strength: "250mg/5mL", form: "Syrup", route: "ORAL", rxReq: "OTC", cost: 68.0, sched: null },
    { code: "MED-IBU-200", name: "Ibuprofen 200mg Softgel", generic: "Ibuprofen", brand: "Advil", strength: "200mg", form: "Softgel", route: "ORAL", rxReq: "OTC", cost: 6.0, sched: null },
    { code: "MED-MEFEN-500", name: "Mefenamic Acid 500mg Tablet", generic: "Mefenamic Acid", brand: "Ponstan", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 8.5, sched: null },
    // Controlled S2 Drugs
    { code: "MED-TRAM-50", name: "Tramadol Hydrochloride 50mg Capsule", generic: "Tramadol Hydrochloride", brand: "Ultram", strength: "50mg", form: "Capsule", route: "ORAL", rxReq: "CONTROLLED", cost: 18.0, sched: "DDB_SCHEDULE_2" },
    { code: "MED-MORPH-10", name: "Morphine Sulfate 10mg CR Tablet", generic: "Morphine Sulfate", brand: "MST Continus", strength: "10mg", form: "Tablet", route: "ORAL", rxReq: "CONTROLLED", cost: 45.0, sched: "DDB_SCHEDULE_2" },
    { code: "MED-DIAZ-5", name: "Diazepam 5mg Tablet", generic: "Diazepam", brand: "Valium", strength: "50mg", form: "Tablet", route: "ORAL", rxReq: "CONTROLLED", cost: 15.0, sched: "DDB_SCHEDULE_2" },
    // Cardiovascular
    { code: "MED-LOS-50", name: "Losartan Potassium 50mg Tablet", generic: "Losartan Potassium", brand: "Cozaar", strength: "50mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 7.5, sched: null },
    { code: "MED-AMLO-5", name: "Amlodipine Besilate 5mg Tablet", generic: "Amlodipine Besilate", brand: "Norvasc", strength: "5mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 6.0, sched: null },
    { code: "MED-AMLO-10", name: "Amlodipine Besilate 10mg Tablet", generic: "Amlodipine Besilate", brand: "Norvasc", strength: "10mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 9.5, sched: null },
    { code: "MED-TELM-40", name: "Telmisartan 40mg Tablet", generic: "Telmisartan", brand: "Micardis", strength: "40mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 16.0, sched: null },
    { code: "MED-METO-50", name: "Metoprolol Tartrate 50mg Tablet", generic: "Metoprolol Tartrate", brand: "Neobloc", strength: "50mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 5.5, sched: null },
    { code: "MED-ATOR-20", name: "Atorvastatin Calcium 20mg Tablet", generic: "Atorvastatin Calcium", brand: "Lipitor", strength: "20mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 14.0, sched: null },
    { code: "MED-ROSU-10", name: "Rosuvastatin Calcium 10mg Tablet", generic: "Rosuvastatin Calcium", brand: "Crestor", strength: "10mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 19.0, sched: null },
    // Diabetes
    { code: "MED-METF-500", name: "Metformin Hydrochloride 500mg Tablet", generic: "Metformin Hydrochloride", brand: "Glucophage", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 3.5, sched: null },
    { code: "MED-METF-850", name: "Metformin Hydrochloride 850mg Tablet", generic: "Metformin Hydrochloride", brand: "Glucophage", strength: "850mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 5.0, sched: null },
    { code: "MED-GLIM-2", name: "Glimepiride 2mg Tablet", generic: "Glimepiride", brand: "Solosa", strength: "2mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 8.0, sched: null },
    // Respiratory & Allergy
    { code: "MED-SALB-NEB", name: "Salbutamol 2.5mg/2.5mL Nebule", generic: "Salbutamol Sulfate", brand: "Ventolin", strength: "2.5mg", form: "Respule", route: "INHALATION", rxReq: "RX", cost: 22.0, sched: null },
    { code: "MED-MONT-10", name: "Montelukast 10mg Chewable Tablet", generic: "Montelukast Sodium", brand: "Singulair", strength: "10mg", form: "Chewable Tablet", route: "ORAL", rxReq: "RX", cost: 18.0, sched: null },
    { code: "MED-CETI-10", name: "Cetirizine Hydrochloride 10mg Tablet", generic: "Cetirizine Hydrochloride", brand: "Virlix", strength: "10mg", form: "Tablet", route: "ORAL", rxReq: "OTC", cost: 6.5, sched: null },
    { code: "MED-LORA-10", name: "Loratadine 10mg Tablet", generic: "Loratadine", brand: "Claritin", strength: "10mg", form: "Tablet", route: "ORAL", rxReq: "OTC", cost: 9.0, sched: null },
    // GI & Antacids
    { code: "MED-OMEP-20", name: "Omeprazole 20mg Capsule", generic: "Omeprazole", brand: "Losec", strength: "20mg", form: "Capsule", route: "ORAL", rxReq: "RX", cost: 8.5, sched: null },
    { code: "MED-ESOM-40", name: "Esomeprazole 40mg Tablet", generic: "Esomeprazole", brand: "Nexium", strength: "40mg", form: "Tablet", route: "ORAL", rxReq: "RX", cost: 35.0, sched: null },
    { code: "MED-KREMIL", name: "Kremil-S Chewable Antacid Tablet", generic: "Aluminum Hydroxide + Magnesium Hydroxide", brand: "Kremil-S", strength: "Standard", form: "Chewable Tablet", route: "ORAL", rxReq: "OTC", cost: 4.0, sched: null },
    { code: "MED-ORS-SAC", name: "Hydrite Oral Rehydration Salts Sachet", generic: "Oral Rehydration Salts (ORS)", brand: "Hydrite", strength: "1L Sachet", form: "Powder Sachet", route: "ORAL", rxReq: "OTC", cost: 12.0, sched: null },
    // Vitamins & Minerals
    { code: "MED-VIT-ENER", name: "Enervon-C Multivitamins Tablet", generic: "Multivitamins + Iron", brand: "Enervon-C", strength: "Standard", form: "Tablet", route: "ORAL", rxReq: "OTC", cost: 6.0, sched: null },
    { code: "MED-VIT-IBER", name: "Iberet-Folic 500 Iron + Folic Acid", generic: "Multivitamins + Iron", brand: "Iberet-Folic", strength: "500mg", form: "Tablet", route: "ORAL", rxReq: "OTC", cost: 14.0, sched: null },
    { code: "MED-VIT-ZINC", name: "Ceelin Plus Ascorbic Acid + Zinc 120mL", generic: "Ascorbic Acid + Zinc", brand: "Ceelin Plus", strength: "100mg/5mL", form: "Syrup", route: "ORAL", rxReq: "OTC", cost: 110.0, sched: null },
  ];

  const pharmacyLocId = locationMap.get("LOC-PHARMACY");
  const pcsUomId = uomMap.get("PCS");

  for (const m of medicines) {
    const genericId = genericMap.get(m.generic);
    const itemRes = await client.query(
      `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id, is_batch_tracked, is_expiry_tracked, standard_cost, min_shelf_life_days_on_receipt, is_active)
       VALUES ($1, $2, $3, 'MEDICINE', $4, true, true, $5, 180, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, standard_cost = EXCLUDED.standard_cost, is_active = true
       RETURNING id, code`,
      [tenantId, m.code, m.name, pcsUomId, m.cost]
    );
    const itemId = itemRes.rows[0].id;

    await client.query(
      `INSERT INTO drug_products (
         tenant_id, item_id, generic_id, brand_name, strength, dosage_form, route, pack_size, fda_reg_no, rx_required, controlled_schedule, storage, is_formulary, high_alert
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 100, $8, $9, $10, 'ROOM', true, $11)
       ON CONFLICT (tenant_id, item_id) DO UPDATE SET 
         brand_name = EXCLUDED.brand_name, strength = EXCLUDED.strength, dosage_form = EXCLUDED.dosage_form,
         route = EXCLUDED.route, rx_required = EXCLUDED.rx_required, controlled_schedule = EXCLUDED.controlled_schedule`,
      [
        tenantId, itemId, genericId, m.brand, m.strength, m.form, m.route,
        `DR-XY${Math.floor(100000 + Math.random() * 900000)}`,
        m.rxReq, m.sched, m.rxReq === "CONTROLLED"
      ]
    );

    if (!zeroStock) {
      // Seed stock batch and balance in Main Clinic Pharmacy
      const batchRes = await client.query(
        `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status, received_at)
         VALUES ($1, $2, $3, '2028-06-30', $4, 'AVAILABLE', now())
         RETURNING id`,
        [tenantId, itemId, `LOT-2026-${m.code}`, m.cost]
      );

      await client.query(
        `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, qty_reserved, last_movement_at)
         VALUES ($1, $2, $3, 300, 0, now())
         ON CONFLICT (tenant_id, location_id, batch_id) DO UPDATE SET qty_on_hand = 300, qty_reserved = 0`,
        [tenantId, pharmacyLocId, batchRes.rows[0].id]
      );
    }
  }

  // ── 6. Other Master Data: Services, Payment Methods, Discount Types ───────
  console.log("  6. Seeding Service Catalog, Payment Methods, Discount Types, and ICD-10...");

  // Service Catalog
  const services = [
    { code: "SVC-CONS-GP", name: "General Outpatient Medical Consultation", cat: "consult", price: 400.0 },
    { code: "SVC-CONS-SP", name: "Specialist / Internal Medicine Consultation", cat: "consult", price: 700.0 },
    { code: "SVC-CONS-PED", name: "Pediatric Outpatient Consultation", cat: "consult", price: 600.0 },
    { code: "SVC-PROC-DRESS", name: "Minor Wound Dressing & Debridement", cat: "procedure", price: 350.0 },
    { code: "SVC-PROC-SUT", name: "Laceration Suture / Surgical Repair", cat: "procedure", price: 850.0 },
    { code: "SVC-PROC-SUTREM", name: "Suture Removal & Wound Inspection", cat: "procedure", price: 250.0 },
    { code: "SVC-PROC-NEB", name: "Nebulization Session / Therapy", cat: "procedure", price: 200.0 },
    { code: "SVC-DIAG-ECG", name: "12-Lead Electrocardiogram with Read", cat: "procedure", price: 500.0 },
    { code: "SVC-LAB-EXTR", name: "Blood Extraction / Phlebotomy Fee", cat: "lab", price: 100.0 },
    { code: "SVC-CERT-MED", name: "Medical Certificate Issuance", cat: "other", price: 200.0 },
    { code: "SVC-CERT-EMP", name: "Employment Health Clearance / Fit-to-Work", cat: "other", price: 350.0 },
  ];

  for (const s of services) {
    await client.query(
      `INSERT INTO service_catalog (tenant_id, branch_id, code, name, category, default_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT DO NOTHING`,
      [tenantId, branchId, s.code, s.name, s.cat, s.price]
    );
  }

  // Payment Methods
  const paymentMethods = [
    { code: "CASH", name: "Cash (Philippine Peso)" },
    { code: "GCASH", name: "GCash Mobile Wallet" },
    { code: "MAYA", name: "Maya Mobile Wallet" },
    { code: "CARD", name: "Credit / Debit Card (Visa, Mastercard)" },
    { code: "BANK_TRANSFER", name: "Bank Transfer (InstaPay / PESONet)" },
    { code: "HMO", name: "HMO Accredited Billing (Maxicare, Medicard, Intellicare)" },
    { code: "PHILHEALTH", name: "PhilHealth Konsulta Capitation Package" },
  ];
  for (const pm of paymentMethods) {
    await client.query(
      `INSERT INTO payment_methods (tenant_id, code, name, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING`,
      [tenantId, pm.code, pm.name]
    );
  }

  // Discount Types
  const discountTypes = [
    { code: "SENIOR", name: "Senior Citizen Discount (20%)", pct: 20.0, reqId: true, legal: "RA 9994 Expanded Senior Citizens Act" },
    { code: "PWD", name: "Persons with Disability Discount (20%)", pct: 20.0, reqId: true, legal: "RA 10754 Magna Carta for Disabled Persons" },
    { code: "SOLO_PARENT", name: "Solo Parent Welfare Discount (10%)", pct: 10.0, reqId: true, legal: "RA 11861 Expanded Solo Parents Welfare Act" },
    { code: "EMPLOYEE", name: "Employee & Dependent Courtesy (50%)", pct: 50.0, reqId: false, legal: "Internal Clinic Benefit Policy" },
    { code: "INDIGENT", name: "Social Welfare / Charity Care (100%)", pct: 100.0, reqId: true, legal: "Clinic Outreach Program" },
  ];
  for (const dt of discountTypes) {
    await client.query(
      `INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT DO NOTHING`,
      [tenantId, dt.code, dt.name, dt.pct, dt.reqId, dt.legal]
    );
  }

  console.log("Comprehensive master data seeded successfully!");
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
    await seedComprehensiveMasterData(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed seeding master data:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("seed_comprehensive_master_data.mjs")) {
  run().catch(console.error);
}
