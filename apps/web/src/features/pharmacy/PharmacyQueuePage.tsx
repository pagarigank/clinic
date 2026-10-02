import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  PatientBanner,
  StatusPill,
} from "@clinic/ui";
import { apiGet, apiPost } from "../../shared/api/client.js";

interface PrescriptionLine {
  id: string;
  drugName: string;
  genericName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  uom: string;
  instructions: string;
  isControlled: boolean;
  specialRxNumber?: string;
}

interface SafetyFinding {
  type: "ALLERGY" | "INTERACTION" | "DUPLICATE_THERAPY" | "STOCK_SHORTAGE" | "DOSE_WARNING";
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  title: string;
  description: string;
  mechanism?: string;
  requiresOverrideReason?: boolean;
}

interface PrescriptionQueueItem {
  id: string;
  rxNumber: string;
  issuedAt: string;
  status: "ISSUED" | "VERIFIED" | "DISPENSED" | "CANCELLED";
  patient: {
    id: string;
    name: string;
    hrn: string;
    birthDate: string;
    sex: "MALE" | "FEMALE" | "OTHER";
    allergies: string[];
  };
  prescriber: {
    name: string;
    licenseNo: string;
    s2Number?: string;
  };
  items: PrescriptionLine[];
  findings: SafetyFinding[];
  isControlled: boolean;
}

export function PharmacyQueuePage() {
  const [prescriptions, setPrescriptions] = useState<PrescriptionQueueItem[]>([
    {
      id: "rx-101",
      rxNumber: "RX-2026-00412",
      issuedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      status: "ISSUED",
      patient: {
        id: "pat-1",
        name: "Clara Dela Cruz",
        hrn: "HRN-2026-0091",
        birthDate: "1988-04-12",
        sex: "FEMALE",
        allergies: ["Penicillin", "Amoxicillin"],
      },
      prescriber: {
        name: "Dr. Roberto Santos, MD",
        licenseNo: "PRC-0098412",
      },
      items: [
        {
          id: "item-1",
          drugName: "Amoxicillin 500mg Capsule",
          genericName: "Amoxicillin Trihydrate",
          dosage: "500 mg",
          route: "Oral",
          frequency: "Three times daily (TID)",
          durationDays: 7,
          quantity: 21,
          uom: "CAP",
          instructions: "Take with full glass of water after meals",
          isControlled: false,
        },
      ],
      findings: [
        {
          type: "ALLERGY",
          severity: "CRITICAL",
          title: "Known Severe Beta-Lactam Allergy Detected",
          description: "Patient has documented Penicillin / Amoxicillin allergy. High risk of anaphylaxis.",
          requiresOverrideReason: true,
        },
      ],
      isControlled: false,
    },
    {
      id: "rx-102",
      rxNumber: "RX-2026-00413",
      issuedAt: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
      status: "ISSUED",
      patient: {
        id: "pat-2",
        name: "Juan Emilio Aguinaldo",
        hrn: "HRN-2026-0034",
        birthDate: "1962-11-20",
        sex: "MALE",
        allergies: ["Aspirin"],
      },
      prescriber: {
        name: "Dr. Alicia Tan, MD",
        licenseNo: "PRC-0076231",
        s2Number: "S2-NCR-2026-8812",
      },
      items: [
        {
          id: "item-2",
          drugName: "Morphine Sulfate 10mg/mL Ampoule",
          genericName: "Morphine Sulfate",
          dosage: "10 mg/mL",
          route: "Subcutaneous",
          frequency: "Every 4 hours PRN severe breakthrough pain",
          durationDays: 3,
          quantity: 6,
          uom: "AMP",
          instructions: "Inject 1 ampoule SC for pain score > 7. Max 4 doses/24hr.",
          isControlled: true,
          specialRxNumber: "PDEA-DDB-2026-00981",
        },
      ],
      findings: [
        {
          type: "DOSE_WARNING",
          severity: "HIGH",
          title: "Controlled Substance — AC-7 Mandated Flow",
          description: "Dangerous Drug Schedule II. Yellow slip required, witness co-signature, and running ledger entry.",
        },
      ],
      isControlled: true,
    },
    {
      id: "rx-103",
      rxNumber: "RX-2026-00414",
      issuedAt: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
      status: "ISSUED",
      patient: {
        id: "pat-3",
        name: "Eduardo Manalo",
        hrn: "HRN-2026-0077",
        birthDate: "1975-08-05",
        sex: "MALE",
        allergies: [],
      },
      prescriber: {
        name: "Dr. Roberto Santos, MD",
        licenseNo: "PRC-0098412",
      },
      items: [
        {
          id: "item-3",
          drugName: "Simvastatin 20mg Tablet",
          genericName: "Simvastatin",
          dosage: "20 mg",
          route: "Oral",
          frequency: "Once daily at bedtime",
          durationDays: 30,
          quantity: 30,
          uom: "TAB",
          instructions: "Take 1 tablet at night",
          isControlled: false,
        },
        {
          id: "item-4",
          drugName: "Clarithromycin 500mg Tablet",
          genericName: "Clarithromycin",
          dosage: "500 mg",
          route: "Oral",
          frequency: "Twice daily (BID)",
          durationDays: 10,
          quantity: 20,
          uom: "TAB",
          instructions: "Take 1 tablet every 12 hours",
          isControlled: false,
        },
      ],
      findings: [
        {
          type: "INTERACTION",
          severity: "CRITICAL",
          title: "Severe Drug Interaction: Simvastatin + Clarithromycin",
          description: "Concurrent use significantly increases statin exposure. Marked risk of rhabdomyolysis and acute renal failure.",
          mechanism: "CYP3A4 inhibition by clarithromycin blocks hepatic simvastatin metabolism.",
          requiresOverrideReason: true,
        },
      ],
      isControlled: false,
    },
    {
      id: "rx-104",
      rxNumber: "RX-2026-00409",
      issuedAt: new Date(Date.now() - 190 * 60 * 1000).toISOString(),
      status: "VERIFIED",
      patient: {
        id: "pat-4",
        name: "Lourdes Bautista",
        hrn: "HRN-2026-0042",
        birthDate: "1995-02-18",
        sex: "FEMALE",
        allergies: [],
      },
      prescriber: {
        name: "Dr. Alicia Tan, MD",
        licenseNo: "PRC-0076231",
      },
      items: [
        {
          id: "item-5",
          drugName: "Paracetamol 500mg Tablet",
          genericName: "Paracetamol",
          dosage: "500 mg",
          route: "Oral",
          frequency: "Every 4-6 hours PRN fever",
          durationDays: 5,
          quantity: 15,
          uom: "TAB",
          instructions: "For temperature >= 38.0 C",
          isControlled: false,
        },
      ],
      findings: [],
      isControlled: false,
    },
  ]);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedRx, setSelectedRx] = useState<PrescriptionQueueItem | null>(null);
  const [isVerifyingModalOpen, setIsVerifyingModalOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Intervention modal state
  const [isInterveneModalOpen, setIsInterveneModalOpen] = useState(false);
  const [interventionType, setInterventionType] = useState("ALLERGY_ALERT");
  const [interventionNotes, setInterventionNotes] = useState("");
  const [physicianContacted, setPhysicianContacted] = useState(true);

  // Rejection modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const filteredPrescriptions = prescriptions.filter((rx) => {
    if (statusFilter !== "ALL" && rx.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchRx = rx.rxNumber.toLowerCase().includes(q);
      const matchPat = rx.patient.name.toLowerCase().includes(q) || rx.patient.hrn.toLowerCase().includes(q);
      const matchDrug = rx.items.some((it) => it.drugName.toLowerCase().includes(q) || it.genericName.toLowerCase().includes(q));
      if (!matchRx && !matchPat && !matchDrug) return false;
    }
    return true;
  });

  const openVerifyDrawer = (rx: PrescriptionQueueItem) => {
    setSelectedRx(rx);
    setOverrideReason("");
    setIsVerifyingModalOpen(true);
  };

  const handleApprove = async () => {
    if (!selectedRx) return;
    const hasCriticalFinding = selectedRx.findings.some((f) => f.severity === "CRITICAL" || f.requiresOverrideReason);
    if (hasCriticalFinding && !overrideReason.trim()) {
      alert("A documented clinical override reason is mandatory when approving prescriptions with critical safety alerts.");
      return;
    }

    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        decision: "APPROVED",
        overrideReason: overrideReason.trim() || undefined,
        notes: "Clinical checks reviewed and verified by Pharmacist",
      });
    } catch {
      // offline / mock fallback
    }

    setPrescriptions((prev) =>
      prev.map((item) => (item.id === selectedRx.id ? { ...item, status: "VERIFIED" } : item))
    );
    setIsVerifyingModalOpen(false);
    setActionSuccessMsg(`Prescription ${selectedRx.rxNumber} has been verified and cleared for dispensing.`);
  };

  const handleInterveneSubmit = async () => {
    if (!selectedRx || !interventionNotes.trim()) return;

    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        decision: "INTERVENED",
        interventionType,
        interventionNotes,
        physicianContacted,
      });
    } catch {
      // fallback
    }

    setIsInterveneModalOpen(false);
    setIsVerifyingModalOpen(false);
    setActionSuccessMsg(`Pharmacist intervention logged for ${selectedRx.rxNumber}. Notification queued for prescriber.`);
  };

  const handleRejectSubmit = async () => {
    if (!selectedRx || !rejectionReason.trim()) return;

    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        decision: "REJECTED",
        rejectionReason,
      });
    } catch {
      // fallback
    }

    setPrescriptions((prev) =>
      prev.map((item) => (item.id === selectedRx.id ? { ...item, status: "CANCELLED" } : item))
    );
    setIsRejectModalOpen(false);
    setIsVerifyingModalOpen(false);
    setActionSuccessMsg(`Prescription ${selectedRx.rxNumber} rejected back to prescriber.`);
  };

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
      {/* Page Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item"><Link to="/dashboard">Home</Link></li>
              <li className="breadcrumb-item">Pharmacy</li>
              <li className="breadcrumb-item active" aria-current="page">Verification Queue</li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary)" }}>
            💊 Prescription Verification Queue
          </h1>
          <p className="text-secondary mb-0" style={{ fontSize: "0.9rem" }}>
            Pharmacist clinical review, automated drug-drug &amp; allergy safety checks, AC-7 dangerous drugs gate.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Link to="/pharmacy/dispenses">
            <Button variant="outline-primary" className="d-inline-flex align-items-center gap-1">
              <span>⚖️</span>
              <span>Dispense Workbench</span>
            </Button>
          </Link>
          <Link to="/pharmacy/controlled-register">
            <Button variant="outline-danger" className="d-inline-flex align-items-center gap-1">
              <span>📕</span>
              <span>Dangerous Drugs Book (AC-7)</span>
            </Button>
          </Link>
        </div>
      </div>

      {actionSuccessMsg && (
        <Alert variant="success" dismissible onClose={() => setActionSuccessMsg(null)} className="mb-4">
          <div className="d-flex align-items-center gap-2">
            <span>✅</span>
            <strong>{actionSuccessMsg}</strong>
          </div>
        </Alert>
      )}

      {/* Filter and Search Bar */}
      <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-md-5">
              <Form.Label htmlFor="rxSearch" className="visually-hidden">Search prescriptions</Form.Label>
              <Form.Control
                id="rxSearch"
                type="search"
                placeholder="Search by Rx number, patient name, HRN, or medication…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted small fw-semibold">Status:</span>
                <div className="btn-group btn-group-sm w-100" role="group">
                  {["ALL", "ISSUED", "VERIFIED", "DISPENSED"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`btn ${statusFilter === st ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => setStatusFilter(st)}
                    >
                      {st === "ALL" ? "All Queue" : st}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-md-3 text-md-end text-muted small">
              Showing <strong>{filteredPrescriptions.length}</strong> orders
            </div>
          </div>
        </div>
      </div>

      {/* Prescriptions Queue Table */}
      <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th>Rx Number</th>
                <th>Issued At</th>
                <th>Patient Details</th>
                <th>Prescriber</th>
                <th>Prescribed Items</th>
                <th>Safety Alerts</th>
                <th>Status</th>
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrescriptions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    <div style={{ fontSize: "2rem" }}>💊</div>
                    <p className="mt-2 mb-0 fw-semibold">No prescriptions found matching the selected filter.</p>
                  </td>
                </tr>
              ) : (
                filteredPrescriptions.map((rx) => {
                  const criticalCount = rx.findings.filter((f) => f.severity === "CRITICAL").length;
                  const warningCount = rx.findings.filter((f) => f.severity === "HIGH" || f.severity === "MODERATE").length;

                  return (
                    <tr key={rx.id}>
                      <td>
                        <span className="fw-bold font-monospace text-primary">{rx.rxNumber}</span>
                        {rx.isControlled && (
                          <div className="mt-1">
                            <Badge bg="danger" className="text-uppercase" style={{ fontSize: "0.68rem" }}>
                              AC-7 DANGEROUS DRUG
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td className="small text-muted">
                        {new Date(rx.issuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        <div style={{ fontSize: "0.75rem" }}>
                          {new Date(rx.issuedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <div className="fw-semibold">{rx.patient.name}</div>
                        <div className="font-monospace text-muted small">{rx.patient.hrn}</div>
                        {rx.patient.allergies.length > 0 && (
                          <span className="badge bg-warning text-dark mt-1" style={{ fontSize: "0.68rem" }}>
                            Allergies: {rx.patient.allergies.join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="small">
                        <div>{rx.prescriber.name}</div>
                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                          {rx.prescriber.licenseNo}
                        </div>
                      </td>
                      <td>
                        <ul className="list-unstyled mb-0 small">
                          {rx.items.map((it) => (
                            <li key={it.id} className="text-truncate" style={{ maxWidth: 260 }}>
                              <strong>{it.drugName}</strong> — Qty: {it.quantity} {it.uom}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        {criticalCount > 0 ? (
                          <span className="badge bg-danger d-inline-flex align-items-center gap-1">
                            <span>⚠️</span> {criticalCount} Critical Alert
                          </span>
                        ) : warningCount > 0 ? (
                          <span className="badge bg-warning text-dark d-inline-flex align-items-center gap-1">
                            <span>⚡</span> {warningCount} Warning
                          </span>
                        ) : (
                          <span className="badge bg-success-subtle text-success border border-success-subtle">
                            ✓ Safety Clear
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusPill
                          tone={
                            rx.status === "VERIFIED"
                              ? "normal"
                              : rx.status === "ISSUED"
                              ? "pending"
                              : rx.status === "DISPENSED"
                              ? "normal"
                              : "neutral"
                          }
                          label={rx.status}
                        />
                      </td>
                      <td className="text-end">
                        {rx.status === "ISSUED" ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openVerifyDrawer(rx)}
                            className="d-inline-flex align-items-center gap-1"
                          >
                            <span>🔍</span>
                            <span>Verify Rx</span>
                          </Button>
                        ) : rx.status === "VERIFIED" ? (
                          <Link to={`/pharmacy/dispenses`}>
                            <Button variant="outline-success" size="sm">
                              ⚖️ Dispense
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-muted small">Completed</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verification & Safety Checks Modal */}
      {selectedRx && (
        <Modal
          show={isVerifyingModalOpen}
          onHide={() => setIsVerifyingModalOpen(false)}
          size="lg"
          centered
          backdrop="static"
        >
          <Modal.Header closeButton>
            <Modal.Title className="h5 fw-bold d-flex align-items-center gap-2">
              <span>💊</span>
              <span>Clinical Pharmacist Verification — {selectedRx.rxNumber}</span>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-4">
            {/* Patient Banner */}
            <div className="mb-4">
              <PatientBanner
                patient={{
                  id: selectedRx.patient.id,
                  name: selectedRx.patient.name,
                  dateOfBirth: selectedRx.patient.birthDate,
                  sex: selectedRx.patient.sex,
                  mrn: selectedRx.patient.hrn,
                }}
                allergies={selectedRx.patient.allergies.map((a) => ({ substance: a }))}
                allergiesCount={selectedRx.patient.allergies.length}
              />
            </div>

            {/* Prescriber info */}
            <div className="p-3 mb-3 bg-light rounded border d-flex justify-content-between align-items-center">
              <div>
                <span className="text-muted small fw-semibold">PRESCRIBER: </span>
                <span className="fw-semibold">{selectedRx.prescriber.name}</span>
                <span className="text-muted ms-2">({selectedRx.prescriber.licenseNo})</span>
              </div>
              {selectedRx.prescriber.s2Number && (
                <Badge bg="danger" className="p-2">
                  PDEA S2: {selectedRx.prescriber.s2Number}
                </Badge>
              )}
            </div>

            {/* Prescribed Items Table */}
            <h6 className="fw-bold mb-2">Prescribed Medication Lines</h6>
            <div className="table-responsive mb-4">
              <table className="table table-bordered table-sm align-middle">
                <thead className="table-light">
                  <tr style={{ fontSize: "0.78rem" }}>
                    <th>Medication / Generic</th>
                    <th>Dosage &amp; Route</th>
                    <th>Frequency</th>
                    <th>Duration</th>
                    <th>Qty</th>
                    <th>Instructions (Sig)</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: "0.85rem" }}>
                  {selectedRx.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="fw-bold">{item.drugName}</div>
                        <div className="text-muted small">{item.genericName}</div>
                        {item.isControlled && (
                          <Badge bg="danger" className="mt-1" style={{ fontSize: "0.68rem" }}>
                            CONTROLLED (AC-7)
                          </Badge>
                        )}
                      </td>
                      <td>{item.dosage} ({item.route})</td>
                      <td>{item.frequency}</td>
                      <td>{item.durationDays} days</td>
                      <td className="fw-bold">{item.quantity} {item.uom}</td>
                      <td className="fst-italic">{item.instructions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Automated Safety Checks findings */}
            <h6 className="fw-bold mb-2 d-flex align-items-center gap-2">
              <span>🛡️</span>
              <span>Automated Clinical Safety Review Findings</span>
            </h6>

            {selectedRx.findings.length === 0 ? (
              <Alert variant="success" className="d-flex align-items-center gap-2 mb-3">
                <span>✅</span>
                <div>
                  <strong>No clinical alerts found.</strong> Patient has no recorded allergies or severe interactions for these items.
                </div>
              </Alert>
            ) : (
              <div className="d-flex flex-column gap-2 mb-4">
                {selectedRx.findings.map((f, idx) => (
                  <AlertBanner
                    key={idx}
                    tone={f.severity === "CRITICAL" ? "danger" : "warning"}
                    title={f.title}
                  >
                    <p className="mb-1">{f.description}</p>
                    {f.mechanism && (
                      <div className="small text-muted">
                        <strong>Mechanism:</strong> {f.mechanism}
                      </div>
                    )}
                  </AlertBanner>
                ))}
              </div>
            )}

            {/* Override reason if critical alert */}
            {selectedRx.findings.some((f) => f.severity === "CRITICAL" || f.requiresOverrideReason) && (
              <div className="mb-3 p-3 bg-danger-subtle rounded border border-danger-subtle">
                <Form.Label htmlFor="overrideReason" className="fw-bold text-danger mb-1">
                  Clinical Override Justification (Mandatory for Approval)
                </Form.Label>
                <p className="text-muted small mb-2">
                  Document the clinical rationale or prescriber consultation approving continuation despite the critical alert.
                </p>
                <Form.Control
                  id="overrideReason"
                  as="textarea"
                  rows={2}
                  placeholder="e.g., Prescriber contacted Dr. Santos; benefit outweighs risk; patient advised to take with food and monitor symptoms..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </div>
            )}
          </Modal.Body>
          <Modal.Footer className="d-flex justify-content-between">
            <div className="d-flex gap-2">
              <Button
                variant="outline-warning"
                onClick={() => setIsInterveneModalOpen(true)}
                className="d-inline-flex align-items-center gap-1"
              >
                <span>⚠️</span>
                <span>Intervene / Clarify</span>
              </Button>
              <Button
                variant="outline-danger"
                onClick={() => setIsRejectModalOpen(true)}
                className="d-inline-flex align-items-center gap-1"
              >
                <span>❌</span>
                <span>Reject to Prescriber</span>
              </Button>
            </div>

            <div className="d-flex gap-2">
              <Button variant="secondary" onClick={() => setIsVerifyingModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="success"
                onClick={handleApprove}
                className="d-inline-flex align-items-center gap-1"
              >
                <span>✓</span>
                <span>Approve &amp; Clear for Dispensing</span>
              </Button>
            </div>
          </Modal.Footer>
        </Modal>
      )}

      {/* Pharmacist Intervention Modal */}
      <Modal show={isInterveneModalOpen} onHide={() => setIsInterveneModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Document Pharmacist Clinical Intervention</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Intervention Category</Form.Label>
            <Form.Select
              value={interventionType}
              onChange={(e) => setInterventionType(e.target.value)}
            >
              <option value="ALLERGY_ALERT">Allergy Alert / Cross-reactivity</option>
              <option value="DRUG_INTERACTION">Drug-Drug Interaction</option>
              <option value="DOSAGE_ADJUSTMENT">Dosage / Frequency Adjustment</option>
              <option value="DUPLICATE_THERAPY">Duplicate Therapy</option>
              <option value="FORMULARY_SUBSTITUTION">Formulary Substitution</option>
              <option value="CLARIFICATION_REQUIRED">Ambiguous Sig / Clarification Required</option>
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description / Pharmacist Recommendation</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              placeholder="State what was recommended to prescriber..."
              value={interventionNotes}
              onChange={(e) => setInterventionNotes(e.target.value)}
            />
          </Form.Group>

          <Form.Check
            type="checkbox"
            id="physicianContacted"
            label="Prescribing physician was contacted directly"
            checked={physicianContacted}
            onChange={(e) => setPhysicianContacted(e.target.checked)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsInterveneModalOpen(false)}>
            Back
          </Button>
          <Button variant="warning" onClick={handleInterveneSubmit} disabled={!interventionNotes.trim()}>
            Record Intervention
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Prescriber Rejection Modal */}
      <Modal show={isRejectModalOpen} onHide={() => setIsRejectModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold text-danger">Reject Prescription to Prescriber</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">
            The prescription will be marked as CANCELLED and returned to the prescriber with your recorded reason.
          </p>
          <Form.Group className="mb-3">
            <Form.Label>Rejection Reason</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              placeholder="e.g. Unsafe combination; patient refused substitute; prescriber confirmed cancel."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsRejectModalOpen(false)}>
            Back
          </Button>
          <Button variant="danger" onClick={handleRejectSubmit} disabled={!rejectionReason.trim()}>
            Confirm Rejection
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
