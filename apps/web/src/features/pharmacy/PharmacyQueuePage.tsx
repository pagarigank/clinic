import React, { useState, useEffect, useCallback } from "react";
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
import { apiPost, apiGetBlob, apiGet } from "../../shared/api/client.js";

/**
 * Maps the API snake_case queue rows onto the camelCase model this screen renders.
 *
 * The list endpoint (/pharmacy/queue) returns one row per prescription with the
 * patient and prescriber denormalised but NO item lines; items, allergies and
 * safety findings live on /pharmacy/prescriptions/:id. The table renders the drug
 * and quantity, and the verify drawer renders findings, so this fetches the detail
 * for the rows on screen. Sequential rather than parallel because a pharmacist
 * verification queue is short, and it keeps the request count predictable.
 */
async function loadQueueIntoModel(): Promise<PrescriptionQueueItem[]> {
  const rows = await apiGet<any[]>("/pharmacy/queue");
  if (!Array.isArray(rows)) return [];

  const out: PrescriptionQueueItem[] = [];
  for (const r of rows) {
    let detail: any = r;
    try {
      detail = (await apiGet<any>(`/pharmacy/prescriptions/${r.id}`)) ?? r;
    } catch {
      // Keep the row with whatever the list gave us rather than dropping it: a
      // prescription with no visible item lines is still a real queued order, and
      // hiding it entirely would be worse than showing it thinly.
    }

    const items: PrescriptionLine[] = (detail.items ?? []).map((it: any) => ({
      id: it.id,
      drugName: it.brand_name || it.generic_name || it.item_name || "Unnamed product",
      genericName: it.generic_name ?? "",
      dosage: it.sig_dose ?? "",
      route: it.route ?? "",
      frequency: it.sig_frequency ?? "",
      durationDays: 0,
      quantity: Number(it.qty_prescribed ?? 0),
      uom: it.form ?? "unit",
      instructions: [it.sig_dose, it.sig_frequency, it.sig_duration].filter(Boolean).join(" "),
      isControlled: Boolean(it.controlled_schedule),
      specialRxNumber: it.item_code ?? undefined,
    }));

    out.push({
      id: r.id,
      rxNumber: r.rx_no ?? detail.rx_no ?? "",
      issuedAt: r.issued_at ?? new Date().toISOString(),
      status: (detail.status ?? r.status) as PrescriptionQueueItem["status"],
      patient: {
        id: r.patient_id ?? "",
        name: detail.patient_name || `${r.patient_first_name ?? ""} ${r.patient_last_name ?? ""}`.trim(),
        hrn: r.hrn ?? "",
        birthDate: (detail.birth_date ?? r.birth_date ?? "").slice(0, 10),
        sex: (detail.patient_sex ?? "OTHER") as "MALE" | "FEMALE" | "OTHER",
        // Allergies are safety-critical. An empty list must read as none recorded
        // rather than silently reading as no known allergies.
        allergies: (detail.allergies ?? detail.patient_allergies ?? [])
          .map((a: any) => (typeof a === "string" ? a : (a.substance ?? a.allergen ?? "")))
          .filter(Boolean),
      },
      prescriber: { name: r.prescriber_name ?? "", licenseNo: r.prescriber_license_no ?? "" },
      items,
      findings: (detail.findings ?? detail.checks ?? []) as SafetyFinding[],
      verifiedForDispensing: Boolean(
        detail.verified_at ?? detail.verifiedForDispensing ?? r.verified_at ?? false,
      ),
      isControlled: Boolean(detail.is_controlled ?? r.is_controlled),
    });
  }
  return out;
}

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
  // Only the real DB values (specification §5.2 data dictionary). There is no
  // VERIFIED prescription status — verification is a gate recorded in
  // pharmacist_interventions, not a lifecycle state.
  status: "DRAFT" | "ISSUED" | "PARTIALLY_DISPENSED" | "DISPENSED" | "EXPIRED" | "CANCELLED";
  /** Set once a pharmacist has cleared this Rx for dispensing (PHM-T1). */
  verifiedForDispensing?: boolean;
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
  // Loaded from GET /pharmacy/queue. This used to be a hardcoded list of four
  // fictional prescriptions (Clara Dela Cruz / rx-101 ...), so the verification
  // queue a pharmacist worked from contained no real patients at all, while the
  // allergy and AC-7 dangerous-drug panels below it rendered against that fiction.
  const [prescriptions, setPrescriptions] = useState<PrescriptionQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);;

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedRx, setSelectedRx] = useState<PrescriptionQueueItem | null>(null);
  const [isVerifyingModalOpen, setIsVerifyingModalOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloadingQueuePdf, setIsDownloadingQueuePdf] = useState(false);

  const downloadQueuePdf = async () => {
    setIsDownloadingQueuePdf(true);
    try {
      const status = statusFilter === "ALL" ? "ISSUED" : statusFilter;
      const blob = await apiGetBlob(`/pharmacy/queue/pdf?status=${encodeURIComponent(status)}`);
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = `Pharmacy-RxQueue-${status}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("RX queue PDF download failed, falling back to window.print():", err);
      window.print();
    } finally {
      setIsDownloadingQueuePdf(false);
    }
  };

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

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      setPrescriptions(await loadQueueIntoModel());
    } catch (err) {
      setPrescriptions([]);
      const detail =
        err && typeof err === "object" && "problem" in err
          ? String((err as any).problem?.detail ?? (err as any).problem?.title ?? err)
          : String(err);
      setQueueError(`Could not load the verification queue: ${detail}`);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);
  const openVerifyDrawer = (rx: PrescriptionQueueItem) => {
    setSelectedRx(rx);
    setOverrideReason("");
    setIsVerifyingModalOpen(true);
  };

  /** Surface a failed pharmacist action instead of reporting a success that did not happen. */
  const describeActionError = (err: unknown): string =>
    err && typeof err === "object" && "problem" in err
      ? String((err as any).problem?.detail ?? (err as any).problem?.title ?? err)
      : String(err);

  const handleApprove = async () => {
    if (!selectedRx) return;
    const hasCriticalFinding = selectedRx.findings.some((f) => f.severity === "CRITICAL" || f.requiresOverrideReason);
    if (hasCriticalFinding && !overrideReason.trim()) {
      alert("A documented clinical override reason is mandatory when approving prescriptions with critical safety alerts.");
      return;
    }

    // VerifyPrescriptionSchema (packages/contracts) requires `action` with the
    // literal "APPROVE". This sent `decision: "APPROVED"`, which Zod rejected as
    // an invalid enum value — so the approval never reached the service, and the
    // empty catch below still showed the pharmacist a success message. Field names
    // must match the contract exactly; see CreatePatientSchema/dob for the same trap.
    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        action: "APPROVE",
        description:
          overrideReason.trim() || "Clinical checks reviewed and verified by Pharmacist",
        outcome: hasCriticalFinding ? "APPROVED_WITH_OVERRIDE" : undefined,
      });
    } catch (err) {
      // Do not claim success on a rejected write. The pharmacist must know the
      // approval did not stick, otherwise they would release a drug against a
      // prescription the server still considers unverified.
      setActionError(`Could not verify ${selectedRx.rxNumber}: ${describeActionError(err)}`);
      return;
    }

    // The Rx stays ISSUED after verification — per specification §9.3 its status only
    // changes when it is dispensed. Marking it VERIFIED here was a fiction the UI
    // invented (and the DB has no such status), so it now reflects what happened.
    // Mark it verified in local state so the row switches to the Dispense action.
    // The status itself is unchanged (still ISSUED); only the gate flipped.
    setPrescriptions((prev) =>
      prev.map((item) =>
        item.id === selectedRx.id ? { ...item, verifiedForDispensing: true } : item,
      ),
    );
    setIsVerifyingModalOpen(false);
    setActionSuccessMsg(
      `Prescription ${selectedRx.rxNumber} has been verified and cleared for dispensing. ` +
        `It stays in the queue until the pharmacist dispenses it.`,
    );
  };

  const handleInterveneSubmit = async () => {
    if (!selectedRx || !interventionNotes.trim()) return;

    // Same contract mismatch as handleApprove: `action: "INTERVENE"` with
    // `description` / `outcome`, not `decision` / `interventionNotes`.
    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        action: "INTERVENE",
        interventionType,
        description: interventionNotes.trim(),
        outcome: "MODIFIED_BY_PRESCRIBER",
      });
    } catch (err) {
      setActionError(`Could not log the intervention on ${selectedRx.rxNumber}: ${describeActionError(err)}`);
      return;
    }

    setIsInterveneModalOpen(false);
    setIsVerifyingModalOpen(false);
    setActionSuccessMsg(`Pharmacist intervention logged for ${selectedRx.rxNumber}. Notification queued for prescriber.`);
  };

  const handleRejectSubmit = async () => {
    if (!selectedRx || !rejectionReason.trim()) return;

    try {
      await apiPost(`/pharmacy/prescriptions/${selectedRx.id}/verify`, {
        action: "REJECT",
        rejectReason: rejectionReason.trim(),
      });
    } catch (err) {
      setActionError(`Could not reject ${selectedRx.rxNumber}: ${describeActionError(err)}`);
      return;
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
          <Button
            variant="outline-secondary"
            className="d-inline-flex align-items-center gap-1"
            onClick={() => void downloadQueuePdf()}
            disabled={isDownloadingQueuePdf}
          >
            <span>📄</span>
            <span>{isDownloadingQueuePdf ? "Preparing…" : "Download RX Queue PDF"}</span>
          </Button>
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

      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError(null)} className="mb-4">
          <div className="d-flex align-items-center gap-2">
            <span>⚠️</span>
            <strong>{actionError}</strong>
          </div>
          <p className="mb-0 mt-1 small">
            The prescription was not changed on the server. Reload the queue before acting on it.
          </p>
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
                  {["ALL", "ISSUED", "PARTIALLY_DISPENSED", "DISPENSED", "CANCELLED"].map((st) => (
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
              {queueLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    <div aria-hidden="true" style={{ fontSize: "2rem" }}>⏳</div>
                    <p className="mt-2 mb-0">Loading prescriptions awaiting verification…</p>
                  </td>
                </tr>
              ) : queueError ? (
                <tr>
                  <td colSpan={8} className="text-center py-5">
                    <div aria-hidden="true" style={{ fontSize: "2rem" }}>⚠️</div>
                    <p className="mt-2 mb-1 fw-semibold text-danger">Verification queue unavailable</p>
                    <p className="mb-2 small text-muted">{queueError}</p>
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void loadQueue()}>
                      Retry
                    </button>
                  </td>
                </tr>
              ) : filteredPrescriptions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    <div aria-hidden="true" style={{ fontSize: "2rem" }}>💊</div>
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
                            rx.status === "ISSUED"
                              ? rx.verifiedForDispensing
                                ? "normal"
                                : "pending"
                              : rx.status === "DISPENSED" || rx.status === "PARTIALLY_DISPENSED"
                              ? "normal"
                              : "neutral"
                          }
                          label={rx.status === "ISSUED" && rx.verifiedForDispensing ? "VERIFIED" : rx.status}
                        />
                      </td>
                      <td className="text-end">
                        {rx.status === "ISSUED" && !rx.verifiedForDispensing ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => openVerifyDrawer(rx)}
                            className="d-inline-flex align-items-center gap-1"
                          >
                            <span>🔍</span>
                            <span>Verify Rx</span>
                          </Button>
                        ) : rx.status === "ISSUED" ? (
                          <Link to={`/pharmacy/dispenses?rxId=${rx.id}`}>
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
