CREATE TABLE ref_icd10 (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL
);
ALTER TABLE ref_icd10 ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_icd10_select ON ref_icd10 FOR SELECT USING (true);

CREATE TABLE ref_psgc (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    level TEXT NOT NULL
);
ALTER TABLE ref_psgc ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_psgc_select ON ref_psgc FOR SELECT USING (true);

CREATE TABLE ref_loinc (
    code TEXT PRIMARY KEY,
    component TEXT NOT NULL,
    property TEXT,
    system TEXT
);
ALTER TABLE ref_loinc ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_loinc_select ON ref_loinc FOR SELECT USING (true);

CREATE TABLE ref_drug_schedules (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL
);
ALTER TABLE ref_drug_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_drug_schedules_select ON ref_drug_schedules FOR SELECT USING (true);
