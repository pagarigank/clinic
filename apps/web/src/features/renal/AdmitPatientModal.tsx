import React, { useState, useEffect } from "react";
import { Modal, Button, Alert } from "@clinic/ui";
import {
  renalApi,
  type RenalStation,
  type DialysisMachine,
  type DialysisShift,
  type DialysisPrescription,
  type VascularAccess,
  type Dialyzer,
  type PhilHealthUsage,
  type DialysisSession,
} from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export interface AdmitPatientModalProps {
  show: boolean;
  onHide: () => void;
  preselectedStationId?: string | null;
  onSessionAdmitted: (session: DialysisSession, startIntakeImmediately: boolean) => void;
}

export function AdmitPatientModal({
  show,
  onHide,
  preselectedStationId,
  onSessionAdmitted,
}: AdmitPatientModalProps) {
  const { session } = useAuth();
  const currentUserId = session?.userId && session.userId.length === 36 ? session.userId : crypto.randomUUID();

  // Reference data
  const [patients, setPatients] = useState<any[]>([]);
  const [stations, setStations] = useState<RenalStation[]>([]);
  const [machines, setMachines] = useState<DialysisMachine[]>([]);
  const [shifts, setShifts] = useState<DialysisShift[]>([]);

  // Selected Patient Data
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);

  // Patient Clinical Context
  const [prescriptions, setPrescriptions] = useState<DialysisPrescription[]>([]);
  const [accesses, setAccesses] = useState<VascularAccess[]>([]);
  const [dialyzers, setDialyzers] = useState<Dialyzer[]>([]);
  const [philHealthUsage, setPhilHealthUsage] = useState<PhilHealthUsage | null>(null);
  const [loadingClinical, setLoadingClinical] = useState(false);

  // Form selections
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<string>("");
  const [selectedAccessId, setSelectedAccessId] = useState<string>("");
  const [selectedDialyzerId, setSelectedDialyzerId] = useState<string>("");
  const [selectedStationId, setSelectedStationId] = useState<string>("");
  const [selectedMachineId, setSelectedMachineId] = useState<string>("");
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // UI state
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load of stations, machines, shifts, and patients
  useEffect(() => {
    if (show) {
      loadInitialData();
    }
  }, [show]);

  async function loadInitialData() {
    setLoading(true);
    setError(null);
    try {
      const [patRes, stList, mList, shList] = await Promise.all([
        renalApi.getPatients().catch(() => ({ data: [] })),
        renalApi.getStations().catch(() => []),
        renalApi.getMachines().catch(() => []),
        renalApi.getShifts().catch(() => []),
      ]);

      const patList = (patRes as any)?.data || (patRes as any)?.patients || [];
      setPatients(patList);
      setStations(stList);
      setMachines(mList);
      setShifts(shList);

      // Default shift
      if (shList.length > 0 && !selectedShiftId && shList[0]) {
        setSelectedShiftId(shList[0].id);
      }

      // Preselected station handling
      if (preselectedStationId) {
        setSelectedStationId(preselectedStationId);
        const assignedMachine = mList.find((m: DialysisMachine) => m.station_id === preselectedStationId);
        if (assignedMachine) {
          setSelectedMachineId(assignedMachine.id);
        }
      } else if (stList.length > 0 && !selectedStationId && stList[0]) {
        const firstStation = stList[0];
        setSelectedStationId(firstStation.id);
        const assignedMachine = mList.find((m: DialysisMachine) => m.station_id === firstStation.id);
        if (assignedMachine) {
          setSelectedMachineId(assignedMachine.id);
        } else if (mList.length > 0 && mList[0]) {
          setSelectedMachineId(mList[0].id);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load admission dependencies");
    } finally {
      setLoading(false);
    }
  }

  // When patient selection changes, load their clinical records
  async function handlePatientChange(pId: string) {
    setSelectedPatientId(pId);
    const pat = patients.find((p) => p.id === pId) || null;
    setSelectedPatient(pat);
    setSelectedPrescriptionId("");
    setSelectedAccessId("");
    setSelectedDialyzerId("");

    if (!pId) {
      setPrescriptions([]);
      setAccesses([]);
      setDialyzers([]);
      setPhilHealthUsage(null);
      return;
    }

    setLoadingClinical(true);
    setError(null);
    try {
      const [rxList, accList, dzList, phRes] = await Promise.all([
        renalApi.getPrescriptions(pId).catch(() => []),
        renalApi.getAccesses(pId).catch(() => []),
        renalApi.getDialyzers(pId).catch(() => []),
        renalApi.getPhilHealthUsage(pId).catch(() => null),
      ]);

      setPrescriptions(rxList);
      setAccesses(accList);
      setDialyzers(dzList);
      setPhilHealthUsage(phRes);

      // Auto-select active prescription
      const activeRx = rxList.find((r) => r.status === "ACTIVE") || rxList[0];
      if (activeRx) {
        setSelectedPrescriptionId(activeRx.id);

        // If patient is HBsAg+, ensure an isolation station is auto-selected if available
        if (activeRx.hbv_hbsag_positive) {
          const isoStation = stations.find((s) => s.is_isolation);
          if (isoStation) {
            setSelectedStationId(isoStation.id);
            const isoMach = machines.find((m) => m.station_id === isoStation.id || m.is_isolation);
            if (isoMach) setSelectedMachineId(isoMach.id);
          }
        }
      }

      // Auto-select active vascular access
      const activeAccess = accList.find((a) => a.status === "ACTIVE") || accList[0];
      if (activeAccess) {
        setSelectedAccessId(activeAccess.id);
      }

      // Auto-select valid dialyzer (CLEANED_READY with volume >= 80% & reuse <= 10)
      const validDialyzer = dzList.find((d) => {
        if (d.status !== "CLEANED_READY") return false;
        const baseline = Number(d.baseline_volume_ml) || 1;
        const current = Number(d.current_volume_ml) || 0;
        const recoveryPct = (current / baseline) * 100;
        return recoveryPct >= 80 && d.reuse_count <= (d.max_allowed_reuses || 10);
      }) || dzList[0];

      if (validDialyzer) {
        setSelectedDialyzerId(validDialyzer.id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load patient clinical history");
    } finally {
      setLoadingClinical(false);
    }
  }

  // When station changes, auto-select paired machine
  function handleStationChange(stId: string) {
    setSelectedStationId(stId);
    const matchedMachine = machines.find((m) => m.station_id === stId);
    if (matchedMachine) {
      setSelectedMachineId(matchedMachine.id);
    }
  }

  // Computed checks
  const selectedRx = prescriptions.find((r) => r.id === selectedPrescriptionId);
  const selectedDialyzer = dialyzers.find((d) => d.id === selectedDialyzerId);
  const selectedStation = stations.find((s) => s.id === selectedStationId);
  const selectedMachine = machines.find((m) => m.id === selectedMachineId);

  // Dialyzer QA calculations
  const baselineVol = Number(selectedDialyzer?.baseline_volume_ml) || 0;
  const currentVol = Number(selectedDialyzer?.current_volume_ml) || 0;
  const volumeRecoveryPct = baselineVol > 0 ? (currentVol / baselineVol) * 100 : 0;
  const isDialyzerVolumeSafe = volumeRecoveryPct >= 80;
  const isDialyzerReuseSafe = (selectedDialyzer?.reuse_count || 0) <= (selectedDialyzer?.max_allowed_reuses || 10);
  const isDialyzerReady = selectedDialyzer?.status === "CLEANED_READY";
  const isDialyzerSafeToUse = isDialyzerVolumeSafe && isDialyzerReuseSafe && isDialyzerReady;

  // Infection Control Gate: HBsAg isolation rule (AC-30 / R-REN-04)
  const isPatientHBsAgPositive = Boolean(selectedRx?.hbv_hbsag_positive);
  const isStationIsolationMismatch = isPatientHBsAgPositive && !selectedStation?.is_isolation;
  const isMachineIsolationMismatch = selectedMachine?.is_isolation && !selectedStation?.is_isolation;

  const canSubmit =
    selectedPatientId &&
    selectedPrescriptionId &&
    selectedDialyzerId &&
    selectedStationId &&
    selectedMachineId &&
    selectedShiftId &&
    !isStationIsolationMismatch &&
    !isMachineIsolationMismatch &&
    isDialyzerSafeToUse &&
    !submitting;

  async function handleAdmitSubmit(startIntakeImmediately: boolean) {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const branchId =
        selectedStation?.branch_id ||
        selectedMachine?.branch_id ||
        session?.branchId ||
        "00000000-0000-0000-0000-000000000000";

      const newSession = await renalApi.createSession({
        patientId: selectedPatientId,
        branchId,
        stationId: selectedStationId,
        machineId: selectedMachineId,
        prescriptionId: selectedPrescriptionId,
        accessId: selectedAccessId || undefined,
        dialyzerId: selectedDialyzerId,
        scheduledDate,
        shiftId: selectedShiftId,
        primaryNurseId: currentUserId,
        attendingNephrologistId: selectedRx?.nephrologist_id || undefined,
      });

      onSessionAdmitted(newSession, startIntakeImmediately);
      onHide();
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Failed to admit patient to dialysis machine";
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  // Filter patients by search text
  const filteredPatients = patients.filter((p) => {
    if (!patientSearch) return true;
    const q = patientSearch.toLowerCase();
    const fullName = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
    const no = (p.patient_no || "").toLowerCase();
    return fullName.includes(q) || no.includes(q);
  });

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton className="border-bottom pb-3">
        <div>
          <Modal.Title className="h5 fw-bold text-primary d-flex align-items-center gap-2">
            <span>💺</span> Admit Patient to Dialysis Machine
          </Modal.Title>
          <p className="text-muted small mb-0">
            Chair setup, infection control validation, dialyzer QA gate, and intake launch.
          </p>
        </div>
      </Modal.Header>

      <Modal.Body className="p-4">
        {error && (
          <Alert variant="danger" className="mb-3 py-2 small shadow-sm">
            <strong>Admission Gate Blocked:</strong> {error}
          </Alert>
        )}

        {/* ── 1. PATIENT SELECTION ────────────────────────────────────────────── */}
        <div className="card border-0 bg-light rounded-3 p-3 mb-3">
          <h6 className="fw-bold mb-2 text-dark d-flex align-items-center justify-content-between">
            <span>1. Patient Identification &amp; Clearance</span>
            {selectedPatient && (
              <span className="badge bg-secondary">
                {selectedPatient.patient_no || "Registered Patient"}
              </span>
            )}
          </h6>

          <div className="row g-2 mb-2">
            <div className="col-md-5">
              <label className="form-label small fw-semibold text-muted mb-1">Search Patient</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Type name or Patient ID…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
            </div>
            <div className="col-md-7">
              <label className="form-label small fw-semibold text-muted mb-1">Select Patient *</label>
              <select
                className="form-select form-select-sm fw-medium"
                value={selectedPatientId}
                onChange={(e) => handlePatientChange(e.target.value)}
                disabled={loading}
              >
                <option value="">-- Choose patient to admit --</option>
                {filteredPatients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.last_name}, {p.first_name} {p.patient_no ? `(${p.patient_no})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingClinical && (
            <div className="small text-muted py-2 text-center">
              <span className="spinner-border spinner-border-sm me-2"></span>
              Checking active prescription, vascular access, and dialyzer QA…
            </div>
          )}

          {/* Clinical Indicators & PhilHealth Benefit Badges */}
          {selectedPatient && !loadingClinical && (
            <div className="mt-2 pt-2 border-top d-flex flex-wrap gap-2 align-items-center small">
              {isPatientHBsAgPositive ? (
                <span className="badge bg-danger p-2 fs-7 d-flex align-items-center gap-1">
                  <span>⚠️</span> HBV (HBsAg+) POSITIVE &bull; ISOLATION REQUIRED
                </span>
              ) : (
                <span className="badge bg-success-subtle text-success border border-success-subtle p-2">
                  ✓ HBsAg Negative / Standard Unit
                </span>
              )}

              {philHealthUsage && (
                <span
                  className={`badge p-2 ${
                    philHealthUsage.isExceeded
                      ? "bg-danger text-white"
                      : philHealthUsage.sessionCount >= 150
                      ? "bg-warning text-dark"
                      : "bg-info-subtle text-info-emphasis border border-info-subtle"
                  }`}
                >
                  🏛️ PhilHealth: Session {philHealthUsage.sessionCount + 1} of 156 (
                  {philHealthUsage.remainingSessions} remaining in {philHealthUsage.calendarYear})
                </span>
              )}
            </div>
          )}
        </div>

        {selectedPatient && !loadingClinical && (
          <>
            {/* ── 2. ACTIVE PRESCRIPTION & VASCULAR ACCESS ────────────────────── */}
            <div className="card border-0 bg-light rounded-3 p-3 mb-3">
              <h6 className="fw-bold mb-2 text-dark">2. Dialysis Prescription &amp; Vascular Access</h6>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">
                    Active Prescription *
                  </label>
                  {prescriptions.length === 0 ? (
                    <div className="alert alert-warning p-2 small mb-0">
                      ⚠️ No signed active prescription found. Dialysis cannot proceed without an active prescription.
                    </div>
                  ) : (
                    <select
                      className="form-select form-select-sm"
                      value={selectedPrescriptionId}
                      onChange={(e) => setSelectedPrescriptionId(e.target.value)}
                    >
                      {prescriptions.map((rx) => (
                        <option key={rx.id} value={rx.id}>
                          {rx.modality} &bull; {rx.duration_minutes} min &bull; Dry: {rx.target_dry_weight_kg}kg ({rx.status})
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedRx && (
                    <div className="p-2 mt-2 bg-white rounded border small">
                      <div className="d-flex justify-content-between">
                        <span className="text-muted">Target Dry Weight:</span>
                        <strong className="text-primary">{selectedRx.target_dry_weight_kg} kg</strong>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted">Duration:</span>
                        <span>{selectedRx.duration_minutes} mins ({(selectedRx.duration_minutes / 60).toFixed(1)} hrs)</span>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted">Dialyzer Model:</span>
                        <span>{selectedRx.dialyzer_model || "Fresenius FX80"}</span>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted">Formula / BFR:</span>
                        <span>
                          {selectedRx.dialysate_formula || "Bicarbonate"} | {selectedRx.blood_flow_rate_target || 350} mL/min
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">
                    Vascular Access Cannulation Site
                  </label>
                  {accesses.length === 0 ? (
                    <div className="alert alert-secondary p-2 small mb-0">
                      No documented access. Assessment will be performed prior to cannulation.
                    </div>
                  ) : (
                    <select
                      className="form-select form-select-sm"
                      value={selectedAccessId}
                      onChange={(e) => setSelectedAccessId(e.target.value)}
                    >
                      <option value="">-- Select Access --</option>
                      {accesses.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.access_type.replace("_", " ")} ({acc.side} {acc.anatomical_site}) &bull; {acc.status}
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedRx && selectedRx.hbv_hbsag_positive && (
                    <div className="alert alert-danger p-2 small mt-2 mb-0">
                      <strong>Infection Isolation Gate (R-REN-04):</strong>
                      <br />
                      Patient is Hepatitis B (HBsAg) positive. Must be placed in a dedicated isolation station.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── 3. SINGLE-PATIENT DIALYZER VERIFICATION (QA GATE) ───────────── */}
            <div className="card border-0 bg-light rounded-3 p-3 mb-3">
              <h6 className="fw-bold mb-2 text-dark d-flex align-items-center justify-content-between">
                <span>3. Single-Patient Dialyzer Traceability &amp; QA (R-REN-01 / ADR-12)</span>
                {selectedDialyzer && (
                  <span
                    className={`badge ${
                      isDialyzerSafeToUse ? "bg-success" : "bg-danger"
                    }`}
                  >
                    {isDialyzerSafeToUse ? "QA PASSED (≥80%)" : "QA FAILED / REJECTED"}
                  </span>
                )}
              </h6>

              {dialyzers.length === 0 ? (
                <div className="alert alert-danger p-2 small mb-0">
                  ⚠️ No dialyzer registered for this patient. A single-patient dialyzer must be assigned or issued.
                </div>
              ) : (
                <>
                  <div className="mb-2">
                    <label className="form-label small fw-semibold text-muted mb-1">
                      Patient Dialyzer *
                    </label>
                    <select
                      className="form-select form-select-sm"
                      value={selectedDialyzerId}
                      onChange={(e) => setSelectedDialyzerId(e.target.value)}
                    >
                      {dialyzers.map((d) => {
                        const base = Number(d.baseline_volume_ml) || 1;
                        const curr = Number(d.current_volume_ml) || 0;
                        const pct = ((curr / base) * 100).toFixed(1);
                        return (
                          <option key={d.id} value={d.id}>
                            {d.serial_barcode} &bull; {d.dialyzer_model} (Reuse {d.reuse_count}/{d.max_allowed_reuses || 10}) &bull; Vol: {curr}mL ({pct}%) &bull; {d.status}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {selectedDialyzer && (
                    <div className="p-3 bg-white rounded border small">
                      <div className="row g-2 align-items-center">
                        <div className="col-md-3">
                          <span className="text-muted d-block">Serial Barcode</span>
                          <strong className="font-monospace text-dark">{selectedDialyzer.serial_barcode}</strong>
                        </div>
                        <div className="col-md-3">
                          <span className="text-muted d-block">Volume Recovery</span>
                          <strong
                            className={
                              isDialyzerVolumeSafe ? "text-success fw-bold" : "text-danger fw-bold"
                            }
                          >
                            {volumeRecoveryPct.toFixed(1)}% ({currentVol} / {baselineVol} mL)
                          </strong>
                        </div>
                        <div className="col-md-3">
                          <span className="text-muted d-block">Reuse Count</span>
                          <strong
                            className={
                              isDialyzerReuseSafe ? "text-dark" : "text-danger fw-bold"
                            }
                          >
                            {selectedDialyzer.reuse_count} / {selectedDialyzer.max_allowed_reuses || 10}
                          </strong>
                        </div>
                        <div className="col-md-3">
                          <span className="text-muted d-block">Lab QA Status</span>
                          <span
                            className={`badge ${
                              selectedDialyzer.status === "CLEANED_READY"
                                ? "bg-success"
                                : "bg-warning text-dark"
                            }`}
                          >
                            {selectedDialyzer.status}
                          </span>
                        </div>
                      </div>

                      {!isDialyzerVolumeSafe && (
                        <div className="alert alert-danger p-2 small mt-2 mb-0">
                          <strong>Volume Cutoff Lockout:</strong> Fiber bundle volume has fallen below 80% of baseline ({volumeRecoveryPct.toFixed(1)}%). DOH regulations mandate discarding this dialyzer to prevent clearance loss.
                        </div>
                      )}

                      {!isDialyzerReuseSafe && (
                        <div className="alert alert-danger p-2 small mt-2 mb-0">
                          <strong>Max Reuse Limit Exceeded:</strong> Dialyzer has reached maximum allowed reuses ({selectedDialyzer.reuse_count}). Must be discarded.
                        </div>
                      )}

                      {selectedDialyzer.status !== "CLEANED_READY" && (
                        <div className="alert alert-warning p-2 small mt-2 mb-0">
                          <strong>Reprocessing Status:</strong> Dialyzer is in status '{selectedDialyzer.status}'. It must undergo chemical disinfection and baseline test in Reprocessing Lab before clinical reuse.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── 4. CHAIR, MACHINE & SHIFT ASSIGNMENT ─────────────────────────── */}
            <div className="card border-0 bg-light rounded-3 p-3 mb-2">
              <h6 className="fw-bold mb-2 text-dark">4. Chair Station, Machine &amp; Shift Assignment</h6>

              <div className="row g-2 mb-2">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">
                    Dialysis Station / Chair *
                  </label>
                  <select
                    className={`form-select form-select-sm ${
                      isStationIsolationMismatch ? "is-invalid border-danger" : ""
                    }`}
                    value={selectedStationId}
                    onChange={(e) => handleStationChange(e.target.value)}
                  >
                    {stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.station_no} &bull; {st.name} {st.room ? `(${st.room})` : ""} {st.is_isolation ? "[ISOLATION]" : ""}
                      </option>
                    ))}
                  </select>
                  {isStationIsolationMismatch && (
                    <div className="text-danger small mt-1">
                      ⚠️ Selected station is not an isolation unit! HBsAg+ patients must be admitted to an isolation station.
                    </div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">
                    Dialysis Machine *
                  </label>
                  <select
                    className={`form-select form-select-sm ${
                      isMachineIsolationMismatch ? "is-invalid border-danger" : ""
                    }`}
                    value={selectedMachineId}
                    onChange={(e) => setSelectedMachineId(e.target.value)}
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brand} {m.model} (SN: {m.serial_no}) &bull; {Number(m.total_operating_hours).toFixed(0)} hrs {m.is_isolation ? "[ISOLATION]" : ""}
                      </option>
                    ))}
                  </select>
                  {isMachineIsolationMismatch && (
                    <div className="text-danger small mt-1">
                      ⚠️ Isolation machine cannot be assigned to a non-isolation station.
                    </div>
                  )}
                </div>
              </div>

              <div className="row g-2">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">Treatment Shift *</label>
                  <select
                    className="form-select form-select-sm"
                    value={selectedShiftId}
                    onChange={(e) => setSelectedShiftId(e.target.value)}
                  >
                    {shifts.map((sh) => (
                      <option key={sh.id} value={sh.id}>
                        {sh.shift_name} ({sh.start_time.slice(0, 5)} - {sh.end_time.slice(0, 5)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label small fw-semibold text-muted mb-1">Scheduled Date *</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer className="border-top pt-3 d-flex justify-content-between">
        <Button variant="outline-secondary" onClick={onHide} disabled={submitting}>
          Cancel
        </Button>

        <div className="d-flex gap-2">
          <Button
            variant="outline-primary"
            onClick={() => handleAdmitSubmit(false)}
            disabled={!canSubmit}
          >
            {submitting ? "Admitting…" : "Admit & Reserve Chair"}
          </Button>

          <Button
            variant="primary"
            className="shadow-sm fw-bold d-flex align-items-center gap-1"
            onClick={() => handleAdmitSubmit(true)}
            disabled={!canSubmit}
          >
            <span>⚡</span> {submitting ? "Admitting…" : "Admit & Start Intake Immediately"}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
