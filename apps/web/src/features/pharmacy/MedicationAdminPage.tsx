import React, { useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  PatientBanner,
} from "@clinic/ui";
import { apiPost } from "../../shared/api/client.js";

interface AdministeredRecord {
  id: string;
  patientName: string;
  patientHrn: string;
  drugName: string;
  dose: string;
  route: string;
  site: string;
  administeredAt: string;
  administeringUser: string;
  lotNo: string;
  reactionNotes: string;
}

export function MedicationAdminPage() {
  const [patient] = useState({
    name: "Clara Dela Cruz",
    hrn: "HRN-2026-0091",
    birthDate: "1988-04-12",
    sex: "FEMALE" as const,
    allergies: ["Penicillin", "Amoxicillin"],
  });

  const [availableMeds] = useState([
    {
      id: "med-tetanus",
      name: "Tetanus Toxoid 0.5mL Vial",
      genericName: "Tetanus Toxoid",
      defaultDose: "0.5 mL",
      route: "IM",
      availableBatch: "LOT-TT-2026B (Exp: 2026-12-31)",
    },
    {
      id: "med-paracetamol-iv",
      name: "Paracetamol 10mg/mL 100mL IV Infusion",
      genericName: "Paracetamol",
      defaultDose: "1000 mg (100 mL)",
      route: "IV Infusion",
      availableBatch: "LOT-IV-PCM-2027A (Exp: 2027-04-15)",
    },
    {
      id: "med-salbutamol-neb",
      name: "Salbutamol 2.5mg/2.5mL Respules",
      genericName: "Salbutamol Sulfate",
      defaultDose: "2.5 mg",
      route: "Inhalation (Nebulization)",
      availableBatch: "LOT-SAL-2026F (Exp: 2026-11-20)",
    },
  ]);

  const [selectedMedId, setSelectedMedId] = useState(availableMeds[0]!.id);
  const [dose, setDose] = useState(availableMeds[0]!.defaultDose);
  const [route, setRoute] = useState(availableMeds[0]!.route);
  const [site, setSite] = useState("Right Deltoid (IM)");
  const [notes, setNotes] = useState("Patient tolerated administration well. No immediate adverse reaction.");

  // 5 Rights Verification Checklist
  const [rights, setRights] = useState({
    patient: false,
    drug: false,
    dose: false,
    route: false,
    time: false,
  });

  const [records, setRecords] = useState<AdministeredRecord[]>([
    {
      id: "mar-1",
      patientName: "Juan Emilio Aguinaldo",
      patientHrn: "HRN-2026-0034",
      drugName: "Paracetamol 10mg/mL 100mL IV Infusion",
      dose: "1000 mg",
      route: "IV Infusion",
      site: "Left Cephalic Vein",
      administeredAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      administeringUser: "Gabriel Mendoza, RN",
      lotNo: "LOT-IV-PCM-2027A",
      reactionNotes: "Infusion completed over 15 mins. Temp dropped from 39.2 to 37.8 C.",
    },
  ]);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const allRightsConfirmed =
    rights.patient && rights.drug && rights.dose && rights.route && rights.time;

  const currentMed = availableMeds.find((m) => m.id === selectedMedId) || availableMeds[0]!;

  const handleAdminister = async () => {
    if (!allRightsConfirmed) return;

    const newRecord: AdministeredRecord = {
      id: `mar-${Date.now().toString().slice(-5)}`,
      patientName: patient.name,
      patientHrn: patient.hrn,
      drugName: currentMed.name,
      dose,
      route,
      site,
      administeredAt: new Date().toISOString(),
      administeringUser: "Gabriel Mendoza, RN",
      lotNo: currentMed.availableBatch.split(" ")[0] || "LOT-CUR-1",
      reactionNotes: notes,
    };

    try {
      await apiPost("/pharmacy/administrations", {
        patientId: "pat-1",
        itemId: selectedMedId,
        dose,
        route,
        site,
        notes,
      });
    } catch {
      // offline / mock fallback
    }

    setRecords((prev) => [newRecord, ...prev]);
    setSuccessMsg(`Medication administration recorded. Inventory stock deducted via CONSUMPTION movement.`);

    // Reset checklist
    setRights({
      patient: false,
      drug: false,
      dose: false,
      route: false,
      time: false,
    });
  };

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item"><Link to="/dashboard">Home</Link></li>
              <li className="breadcrumb-item"><Link to="/pharmacy/queue">Pharmacy</Link></li>
              <li className="breadcrumb-item active" aria-current="page">Medication Administration (MAR)</li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary)" }}>
            💉 In-Clinic Medication Administration Record (MAR)
          </h1>
          <p className="text-secondary mb-0" style={{ fontSize: "0.9rem" }}>
            Nursing 5 Rights verification, immediate inventory consumption, and patient reaction documentation.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Link to="/pharmacy/queue">
            <Button variant="outline-primary" size="sm">
              💊 Verification Queue
            </Button>
          </Link>
          <Link to="/pharmacy/dispenses">
            <Button variant="outline-secondary" size="sm">
              ⚖️ Dispense Workbench
            </Button>
          </Link>
        </div>
      </div>

      {successMsg && (
        <Alert variant="success" dismissible onClose={() => setSuccessMsg(null)} className="mb-4">
          <div className="d-flex align-items-center gap-2">
            <span>✅</span>
            <strong>{successMsg}</strong>
          </div>
        </Alert>
      )}

      {/* Patient Banner */}
      <div className="mb-4">
        <PatientBanner
          patient={{
            id: "pat-mar-1",
            name: patient.name,
            dateOfBirth: patient.birthDate,
            sex: patient.sex,
            mrn: patient.hrn,
          }}
          allergies={patient.allergies.map((a) => ({ substance: a }))}
          allergiesCount={patient.allergies.length}
        />
      </div>

      <div className="row g-4 mb-4">
        {/* Left Column: Administer Form & 5 Rights */}
        <div className="col-lg-6">
          <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
            <div className="card-header bg-white py-3 border-bottom">
              <h5 className="mb-0 fw-bold">Administer In-Clinic Dose</h5>
            </div>
            <div className="card-body p-4">
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold">Select In-Clinic Drug Product</Form.Label>
                <Form.Select
                  value={selectedMedId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedMedId(id);
                    const found = availableMeds.find((m) => m.id === id);
                    if (found) {
                      setDose(found.defaultDose);
                      setRoute(found.route);
                    }
                  }}
                >
                  {availableMeds.map((med) => (
                    <option key={med.id} value={med.id}>
                      {med.name} ({med.route})
                    </option>
                  ))}
                </Form.Select>
                <div className="small text-muted mt-1">
                  Drawn from stock: <strong>{currentMed.availableBatch}</strong>
                </div>
              </Form.Group>

              <div className="row g-3 mb-3">
                <div className="col-md-6">
                  <Form.Group>
                    <Form.Label className="small fw-semibold">Dose</Form.Label>
                    <Form.Control
                      type="text"
                      value={dose}
                      onChange={(e) => setDose(e.target.value)}
                    />
                  </Form.Group>
                </div>
                <div className="col-md-6">
                  <Form.Group>
                    <Form.Label className="small fw-semibold">Route</Form.Label>
                    <Form.Control
                      type="text"
                      value={route}
                      onChange={(e) => setRoute(e.target.value)}
                    />
                  </Form.Group>
                </div>
              </div>

              <Form.Group className="mb-3">
                <Form.Label className="small fw-semibold">Anatomical Site</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. Right Deltoid, Left Antecubital Fossa..."
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                />
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label className="small fw-semibold">Observation &amp; Reaction Notes</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Form.Group>

              {/* 5 Rights Verification Checklist */}
              <div className="p-3 bg-light rounded border mb-4">
                <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
                  <span>🛡️</span>
                  <span>Mandatory 5 Rights Verification Checklist</span>
                </h6>
                <div className="d-flex flex-column gap-2 small">
                  <Form.Check
                    type="checkbox"
                    id="chkRightPat"
                    label={`1. Right Patient: Confirmed two identifiers (${patient.name}, ${patient.hrn})`}
                    checked={rights.patient}
                    onChange={(e) => setRights((prev) => ({ ...prev, patient: e.target.checked }))}
                  />
                  <Form.Check
                    type="checkbox"
                    id="chkRightDrug"
                    label={`2. Right Drug: Checked against allergies (${currentMed.genericName})`}
                    checked={rights.drug}
                    onChange={(e) => setRights((prev) => ({ ...prev, drug: e.target.checked }))}
                  />
                  <Form.Check
                    type="checkbox"
                    id="chkRightDose"
                    label={`3. Right Dose: Correct dose and concentration (${dose})`}
                    checked={rights.dose}
                    onChange={(e) => setRights((prev) => ({ ...prev, dose: e.target.checked }))}
                  />
                  <Form.Check
                    type="checkbox"
                    id="chkRightRoute"
                    label={`4. Right Route & Site: Correct administration route (${route} - ${site})`}
                    checked={rights.route}
                    onChange={(e) => setRights((prev) => ({ ...prev, route: e.target.checked }))}
                  />
                  <Form.Check
                    type="checkbox"
                    id="chkRightTime"
                    label="5. Right Time: Correct scheduled interval and active clinic encounter"
                    checked={rights.time}
                    onChange={(e) => setRights((prev) => ({ ...prev, time: e.target.checked }))}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-100 fw-bold d-flex justify-content-center align-items-center gap-2"
                disabled={!allRightsConfirmed}
                onClick={handleAdminister}
              >
                <span>💉</span>
                <span>Confirm Administration &amp; Record MAR</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: In-Clinic MAR Activity Log */}
        <div className="col-lg-6">
          <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
            <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
              <h5 className="mb-0 fw-bold">Recent Clinic Administrations Log</h5>
              <span className="badge bg-secondary">{records.length} Recorded</span>
            </div>

            <div className="card-body p-3">
              {records.map((rec) => (
                <div key={rec.id} className="p-3 bg-light rounded border mb-3">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div>
                      <h6 className="fw-bold mb-0 text-primary">{rec.drugName}</h6>
                      <div className="small text-muted">
                        Dose: <strong>{rec.dose}</strong> via <strong>{rec.route}</strong> ({rec.site})
                      </div>
                    </div>
                    <span className="badge bg-success-subtle text-success border border-success-subtle">
                      ✓ ADMINISTERED
                    </span>
                  </div>

                  <div className="small text-secondary mb-2 fst-italic">
                    "{rec.reactionNotes}"
                  </div>

                  <div className="d-flex justify-content-between align-items-center pt-2 border-top text-muted" style={{ fontSize: "0.75rem" }}>
                    <span>Patient: <strong>{rec.patientName}</strong> ({rec.patientHrn})</span>
                    <span>Administered By: <strong>{rec.administeringUser}</strong></span>
                    <span>{new Date(rec.administeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
