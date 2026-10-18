import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { Alert, Modal } from "@clinic/ui";
import { renalApi, type DialysisSession } from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

type StageFilter = "ALL" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export function DialysisWorklistPage() {
  const { session } = useAuth();
  const currentUserId = session?.userId || "demo-nurse";

  const [sessions, setSessions] = useState<DialysisSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [stageFilter, setStageFilter] = useState<StageFilter>("ALL");
  const [searchFilter, setSearchFilter] = useState("");

  // Modals state
  const [selectedSession, setSelectedSession] = useState<DialysisSession | null>(null);
  const [isPreModalOpen, setIsPreModalOpen] = useState(false);
  const [isFlowsheetModalOpen, setIsFlowsheetModalOpen] = useState(false);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Pre-Dialysis Intake Form State
  const [preWeight, setPreWeight] = useState<number>(68.0);
  const [dryWeight, setDryWeight] = useState<number>(65.0);
  const [sittingSys, setSittingSys] = useState<number>(140);
  const [sittingDia, setSittingDia] = useState<number>(85);
  const [standingSys] = useState<number | undefined>(undefined);
  const [standingDia] = useState<number | undefined>(undefined);
  const [pulse, setPulse] = useState<number>(76);
  const [temp, setTemp] = useState<number>(36.6);
  const [targetUf, setTargetUf] = useState<number>(3.0);
  const [edema] = useState<string>("NONE");
  const [accessChecked, setAccessChecked] = useState<boolean>(true);
  const [preNotes] = useState<string>("");
  const [submittingPre, setSubmittingPre] = useState(false);
  const [preError, setPreError] = useState<string | null>(null);

  // Flowsheet Form State
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(60);
  const [flowBpSys, setFlowBpSys] = useState<number>(135);
  const [flowBpDia, setFlowBpDia] = useState<number>(80);
  const [flowPulse, setFlowPulse] = useState<number>(74);
  const [bfr, setBfr] = useState<number>(350);
  const [dfr, setDfr] = useState<number>(500);
  const [artPress] = useState<number>(-120);
  const [venPress] = useState<number>(150);
  const [tmp, setTmp] = useState<number>(90);
  const [cumUf, setCumUf] = useState<number>(0.75);
  const [heparinGiven, setHeparinGiven] = useState<number>(1000);
  const [flowSymptoms, setFlowSymptoms] = useState<string>("");
  const [flowInterventions, setFlowInterventions] = useState<string>("");
  const [submittingFlow, setSubmittingFlow] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Post-Dialysis Close State
  const [postWeight, setPostWeight] = useState<number>(65.2);
  const [postSittingSys, setPostSittingSys] = useState<number>(128);
  const [postSittingDia, setPostSittingDia] = useState<number>(78);
  const [postPulse, setPostPulse] = useState<number>(72);
  const [postTemp] = useState<number>(36.5);
  const [actualUfRemoved, setActualUfRemoved] = useState<number>(2.8);
  const [hemostasisMinutes, setHemostasisMinutes] = useState<number>(15);
  const [dischargeCondition, setDischargeCondition] = useState<string>("STABLE");
  const [accessBruitThrill, setAccessBruitThrill] = useState<boolean>(true);
  const [postNotes] = useState<string>("");
  const [submittingPost, setSubmittingPost] = useState(false);
  const [postSuccessData, setPostSuccessData] = useState<any | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [selectedDate]);

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      const data = await renalApi.getSessions({ scheduledDate: selectedDate });
      setSessions(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load dialysis worklist");
    } finally {
      setLoading(false);
    }
  }

  // Pre-Dialysis Action
  function handleOpenPre(sessionItem: DialysisSession) {
    setSelectedSession(sessionItem);
    setPreError(null);
    setPreWeight(68.0);
    setDryWeight(65.0);
    setSittingSys(140);
    setSittingDia(85);
    setPulse(76);
    setTemp(36.6);
    setTargetUf(3.0);
    setIsPreModalOpen(true);
  }

  async function handleSubmitPre(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;
    setSubmittingPre(true);
    setPreError(null);
    try {
      await renalApi.startPreDialysis(selectedSession.id, {
        preWeightKg: Number(preWeight),
        dryWeightKg: Number(dryWeight),
        sittingBpSystolic: Number(sittingSys),
        sittingBpDiastolic: Number(sittingDia),
        standingBpSystolic: standingSys ? Number(standingSys) : undefined,
        standingBpDiastolic: standingDia ? Number(standingDia) : undefined,
        pulse: Number(pulse),
        temp: Number(temp),
        targetUfLiters: Number(targetUf),
        edemaGrade: edema as any,
        accessChecked,
        nurseSignId: currentUserId,
        notes: preNotes || undefined,
      });
      setIsPreModalOpen(false);
      await loadSessions();
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Pre-dialysis intake failed";
      setPreError(detail);
    } finally {
      setSubmittingPre(false);
    }
  }

  // Flowsheet Action
  async function handleOpenFlowsheet(sessionItem: DialysisSession) {
    setSelectedSession(sessionItem);
    setFlowError(null);
    try {
      const full = await renalApi.getSession(sessionItem.id);
      setSelectedSession(full);
      // Auto-increment elapsed minutes if prior flows exist
      const count = full.flowsheet?.length || 0;
      setElapsedMinutes((count + 1) * 60);
      setCumUf(Number(((count + 1) * 0.75).toFixed(2)));
    } catch {
      // Fallback
    }
    setIsFlowsheetModalOpen(true);
  }

  async function handleSubmitFlowsheet(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;
    setSubmittingFlow(true);
    setFlowError(null);
    try {
      await renalApi.recordFlowsheet(selectedSession.id, {
        elapsedMinutes: Number(elapsedMinutes),
        bpSystolic: Number(flowBpSys),
        bpDiastolic: Number(flowBpDia),
        pulse: Number(flowPulse),
        bloodFlowRate: Number(bfr),
        dialysateFlowRate: Number(dfr),
        arterialPressure: artPress ? Number(artPress) : undefined,
        venousPressure: venPress ? Number(venPress) : undefined,
        tmp: tmp ? Number(tmp) : undefined,
        cumUfVolumeLiters: Number(cumUf),
        heparinAdministered: heparinGiven ? Number(heparinGiven) : undefined,
        symptoms: flowSymptoms || undefined,
        interventions: flowInterventions || undefined,
        recordedBy: currentUserId,
      });
      // Refresh session
      const updated = await renalApi.getSession(selectedSession.id);
      setSelectedSession(updated);
      setFlowSymptoms("");
      setFlowInterventions("");
      setElapsedMinutes(elapsedMinutes + 60);
      setCumUf(Number((cumUf + 0.75).toFixed(2)));
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Failed to record flowsheet";
      setFlowError(detail);
    } finally {
      setSubmittingFlow(false);
    }
  }

  // Post-Dialysis Action
  function handleOpenPost(sessionItem: DialysisSession) {
    setSelectedSession(sessionItem);
    setPostError(null);
    setPostSuccessData(null);
    setIsPostModalOpen(true);
  }

  async function handleSubmitPost(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;
    setSubmittingPost(true);
    setPostError(null);
    try {
      const res = await renalApi.completePostDialysis(selectedSession.id, {
        postWeightKg: Number(postWeight),
        sittingBpSystolic: Number(postSittingSys),
        sittingBpDiastolic: Number(postSittingDia),
        pulse: Number(postPulse),
        temp: Number(postTemp),
        actualUfRemovedLiters: Number(actualUfRemoved),
        hemostasisMinutes: Number(hemostasisMinutes),
        conditionAtDischarge: dischargeCondition as any,
        accessBruitThrill,
        signedBy: currentUserId,
        postNurseNotes: postNotes || undefined,
      });
      setPostSuccessData(res);
      await loadSessions();
    } catch (err: any) {
      const detail = err?.problem?.detail || err?.message || "Failed to complete post-dialysis close";
      setPostError(detail);
    } finally {
      setSubmittingPost(false);
    }
  }

  // View Details
  async function handleOpenDetail(sessionItem: DialysisSession) {
    try {
      const full = await renalApi.getSession(sessionItem.id);
      setSelectedSession(full);
      setIsDetailModalOpen(true);
    } catch {
      setSelectedSession(sessionItem);
      setIsDetailModalOpen(true);
    }
  }

  // Filtered session list
  const filteredSessions = sessions.filter((s) => {
    if (stageFilter !== "ALL" && s.status !== stageFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const patient = `${s.first_name || ""} ${s.last_name || ""}`.toLowerCase();
      const num = (s.session_no || "").toLowerCase();
      const st = (s.station_no || "").toLowerCase();
      if (!patient.includes(q) && !num.includes(q) && !st.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="container-fluid p-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
            <span>📋</span> Dialysis Session Worklist
          </h2>
          <p className="text-muted mb-0">
            Intra-dialytic charting, pre/post intake gates, and automated PhilHealth claim logging.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to="/renal/dashboard" className="btn btn-outline-secondary">
            &larr; Unit Dashboard
          </Link>
          <Link to="/renal/reprocessing" className="btn btn-outline-primary">
            <span>🔄</span> Reprocessing
          </Link>
          <Link to="/renal/water-safety" className="btn btn-outline-info">
            <span>💧</span> Water Safety
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {/* Control Bar: Date Selector, Tabs, Search */}
      <div className="card shadow-sm border-0 mb-4 rounded-3">
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-auto">
              <label className="form-label small fw-bold text-muted mb-1">Scheduled Date</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            <div className="col">
              <label className="form-label small fw-bold text-muted mb-1">Lifecycle Stage</label>
              <div className="btn-group btn-group-sm w-100" role="group">
                {(["ALL", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as StageFilter[]).map(
                  (stage) => (
                    <button
                      key={stage}
                      type="button"
                      className={`btn ${
                        stageFilter === stage ? "btn-primary" : "btn-outline-secondary"
                      }`}
                      onClick={() => setStageFilter(stage)}
                    >
                      {stage.replace("_", " ")}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="col-md-3">
              <label className="form-label small fw-bold text-muted mb-1">Search Worklist</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Patient, Station, or Session #"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-uppercase text-muted">
              <tr>
                <th>Session No</th>
                <th>Patient</th>
                <th>Station / Machine</th>
                <th>Dialyzer</th>
                <th>Status</th>
                <th>Started / Duration</th>
                <th>Target UF</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    Loading sessions for {selectedDate}...
                  </td>
                </tr>
              ) : filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    No dialysis sessions found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((s) => {
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong className="text-primary font-monospace">{s.session_no}</strong>
                        <div className="small text-muted">{s.scheduled_date}</div>
                      </td>
                      <td>
                        <div className="fw-semibold">
                          {s.first_name} {s.last_name}
                        </div>
                      </td>
                      <td>
                        <div className="badge bg-light text-dark border">
                          Station: {s.station_no || "N/A"}
                        </div>
                        {s.machine_serial && (
                          <div className="small text-muted font-monospace">
                            M: {s.machine_serial}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{s.dialyzer_model || "High-Flux"}</div>
                        <div className="small text-muted font-monospace">
                          {s.dialyzer_barcode}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            s.status === "COMPLETED"
                              ? "bg-success"
                              : s.status === "IN_PROGRESS"
                              ? "bg-primary animate-pulse"
                              : s.status === "SCHEDULED"
                              ? "bg-secondary"
                              : "bg-danger"
                          }`}
                        >
                          {s.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        {s.started_at ? (
                          <>
                            <div className="small text-dark">
                              {new Date(s.started_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <div className="small text-muted">
                              {s.actual_duration_minutes ? `${s.actual_duration_minutes} min` : "Running"}
                            </div>
                          </>
                        ) : (
                          <span className="small text-muted">&mdash;</span>
                        )}
                      </td>
                      <td>
                        {s.total_uf_removed_liters ? (
                          <span className="fw-semibold text-success">
                            {Number(s.total_uf_removed_liters).toFixed(2)} L
                          </span>
                        ) : (
                          <span className="text-muted small">Pending close</span>
                        )}
                      </td>
                      <td className="text-end">
                        <div className="d-flex justify-content-end gap-1">
                          {s.status === "SCHEDULED" && (
                            <button
                              className="btn btn-sm btn-primary shadow-sm"
                              onClick={() => handleOpenPre(s)}
                            >
                              Intake &amp; Start
                            </button>
                          )}

                          {s.status === "IN_PROGRESS" && (
                            <>
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => handleOpenFlowsheet(s)}
                              >
                                Flowsheet
                              </button>
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleOpenPost(s)}
                              >
                                Close Session
                              </button>
                            </>
                          )}

                          <button
                            className="btn btn-sm btn-light border"
                            onClick={() => handleOpenDetail(s)}
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 1. PRE-DIALYSIS INTAKE MODAL (AC-29, AC-30, AC-31) ───────────────── */}
      <Modal
        isOpen={isPreModalOpen}
        onClose={() => setIsPreModalOpen(false)}
        title={`Pre-Dialysis Intake & Safety Gates: ${selectedSession?.session_no}`}
      >
        <form onSubmit={handleSubmitPre}>
          {preError && (
            <div className="alert alert-danger small p-2 mb-3">
              <strong>Clinical Safety Gate Lockout:</strong> {preError}
            </div>
          )}

          <div className="alert alert-info small p-2 mb-3">
            <strong>Automated Safety Verification:</strong> Evaluates pre-shift water carbon breakthrough (&lt; 0.1 ppm)
            and patient dialyzer bundle volume (&ge; 80% baseline).
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-6">
              <label className="form-label small fw-bold">Pre-Treatment Weight (kg) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={preWeight}
                onChange={(e) => setPreWeight(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold">Target Dry Weight (kg) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={dryWeight}
                onChange={(e) => setDryWeight(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-6">
              <label className="form-label small fw-bold">Target UF Removal (Liters) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={targetUf}
                onChange={(e) => setTargetUf(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold">Calculated Fluid Gain</label>
              <input
                type="text"
                className="form-control bg-light"
                value={`${(preWeight - dryWeight).toFixed(2)} kg`}
                disabled
              />
            </div>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <label className="form-label small fw-bold">Sitting Sys BP *</label>
              <input
                type="number"
                className="form-control"
                value={sittingSys}
                onChange={(e) => setSittingSys(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Sitting Dia BP *</label>
              <input
                type="number"
                className="form-control"
                value={sittingDia}
                onChange={(e) => setSittingDia(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Pulse (bpm) *</label>
              <input
                type="number"
                className="form-control"
                value={pulse}
                onChange={(e) => setPulse(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Temp (°C) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={temp}
                onChange={(e) => setTemp(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="mb-3 form-check">
            <input
              type="checkbox"
              className="form-check-input"
              id="chkAccess"
              checked={accessChecked}
              onChange={(e) => setAccessChecked(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="chkAccess">
              Vascular access evaluated (thrill / bruit confirmed; no signs of aneurysm or infection)
            </label>
          </div>

          <div className="d-flex justify-content-end gap-2 mt-4">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setIsPreModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submittingPre}>
              {submittingPre ? "Verifying Gates..." : "Pass Gates & Start Session"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── 2. INTRA-DIALYTIC FLOWSHEET MODAL ─────────────────────────────────── */}
      <Modal
        isOpen={isFlowsheetModalOpen}
        onClose={() => setIsFlowsheetModalOpen(false)}
        title={`Intra-dialytic Flowsheet: ${selectedSession?.session_no}`}
      >
        <div className="mb-4">
          <h6 className="fw-bold mb-2">Recorded Hourly Intervals</h6>
          <div className="table-responsive border rounded">
            <table className="table table-sm table-striped mb-0 small">
              <thead className="table-light">
                <tr>
                  <th>Min</th>
                  <th>BP</th>
                  <th>Pulse</th>
                  <th>BFR</th>
                  <th>DFR</th>
                  <th>TMP</th>
                  <th>Cum UF</th>
                  <th>Heparin</th>
                </tr>
              </thead>
              <tbody>
                {selectedSession?.flowsheet && selectedSession.flowsheet.length > 0 ? (
                  selectedSession.flowsheet.map((f: any, idx: number) => (
                    <tr key={idx}>
                      <td>{f.elapsed_minutes}m</td>
                      <td>
                        {f.bp_systolic}/{f.bp_diastolic}
                      </td>
                      <td>{f.pulse}</td>
                      <td>{f.blood_flow_rate}</td>
                      <td>{f.dialysate_flow_rate}</td>
                      <td>{f.tmp || "--"}</td>
                      <td>{f.cum_uf_volume_liters} L</td>
                      <td>{f.heparin_administered || "--"} U</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="text-center py-2 text-muted">
                      No intervals charted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <form onSubmit={handleSubmitFlowsheet}>
          <h6 className="fw-bold mb-2">Chart New Interval</h6>
          {flowError && <div className="alert alert-danger small p-2">{flowError}</div>}

          <div className="row g-2 mb-2">
            <div className="col-md-3">
              <label className="form-label small fw-bold">Elapsed (min) *</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={elapsedMinutes}
                onChange={(e) => setElapsedMinutes(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">BP Sys / Dia *</label>
              <div className="input-group input-group-sm">
                <input
                  type="number"
                  className="form-control"
                  value={flowBpSys}
                  onChange={(e) => setFlowBpSys(Number(e.target.value))}
                  required
                />
                <input
                  type="number"
                  className="form-control"
                  value={flowBpDia}
                  onChange={(e) => setFlowBpDia(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Pulse (bpm) *</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={flowPulse}
                onChange={(e) => setFlowPulse(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Cum UF (L) *</label>
              <input
                type="number"
                step="0.05"
                className="form-control form-control-sm"
                value={cumUf}
                onChange={(e) => setCumUf(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-md-3">
              <label className="form-label small fw-bold">BFR (mL/min) *</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={bfr}
                onChange={(e) => setBfr(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">DFR (mL/min) *</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={dfr}
                onChange={(e) => setDfr(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">TMP (mmHg)</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={tmp}
                onChange={(e) => setTmp(Number(e.target.value))}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Heparin (U)</label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={heparinGiven}
                onChange={(e) => setHeparinGiven(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="d-flex justify-content-end gap-2 mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setIsFlowsheetModalOpen(false)}
            >
              Done
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submittingFlow}>
              {submittingFlow ? "Saving..." : "Save Interval"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── 3. POST-DIALYSIS CLOSE MODAL (AC-29, AC-32) ──────────────────────── */}
      <Modal
        isOpen={isPostModalOpen}
        onClose={() => {
          setIsPostModalOpen(false);
          setPostSuccessData(null);
        }}
        title={`Post-Dialysis Close & Charge Capture: ${selectedSession?.session_no}`}
      >
        {postSuccessData ? (
          <div>
            <div className="alert alert-success p-3 rounded-3 mb-3">
              <h5 className="alert-heading fw-bold">Session Successfully Completed!</h5>
              <p className="mb-0 small">
                Hemodialysis session finalized. Financial charges and PhilHealth package counter updated.
              </p>
            </div>

            <div className="card bg-light border-0 p-3 mb-3 small">
              <div className="d-flex justify-content-between mb-1">
                <span>PhilHealth Annual Session:</span>
                <strong className="text-primary fs-6">
                  Session #{postSuccessData.philHealthSequenceNo} of 156
                </strong>
              </div>
              <div className="d-flex justify-content-between mb-1">
                <span>PhilHealth Benefit Claim:</span>
                <strong>₱{Number(postSuccessData.claimAmount).toFixed(2)}</strong>
              </div>
              <div className="d-flex justify-content-between mb-1">
                <span>Patient Copay:</span>
                <strong>₱{Number(postSuccessData.copayAmount).toFixed(2)}</strong>
              </div>
              <div className="d-flex justify-content-between border-top pt-2 mt-2">
                <span>Dialysis Charge Captured:</span>
                <span className="badge bg-success">₱2,600.00 POSTED TO BILLING</span>
              </div>
            </div>

            <div className="d-flex justify-content-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setIsPostModalOpen(false);
                  setPostSuccessData(null);
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitPost}>
            {postError && <div className="alert alert-danger small p-2 mb-3">{postError}</div>}

            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label small fw-bold">Post-Treatment Weight (kg) *</label>
                <input
                  type="number"
                  step="0.1"
                  className="form-control"
                  value={postWeight}
                  onChange={(e) => setPostWeight(Number(e.target.value))}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-bold">Actual UF Removed (Liters) *</label>
                <input
                  type="number"
                  step="0.1"
                  className="form-control"
                  value={actualUfRemoved}
                  onChange={(e) => setActualUfRemoved(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div className="row g-2 mb-3">
              <div className="col-md-4">
                <label className="form-label small fw-bold">Sitting BP Sys / Dia *</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    value={postSittingSys}
                    onChange={(e) => setPostSittingSys(Number(e.target.value))}
                    required
                  />
                  <input
                    type="number"
                    className="form-control"
                    value={postSittingDia}
                    onChange={(e) => setPostSittingDia(Number(e.target.value))}
                    required
                  />
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label small fw-bold">Pulse (bpm) *</label>
                <input
                  type="number"
                  className="form-control"
                  value={postPulse}
                  onChange={(e) => setPostPulse(Number(e.target.value))}
                  required
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small fw-bold">Hemostasis (min) *</label>
                <input
                  type="number"
                  className="form-control"
                  value={hemostasisMinutes}
                  onChange={(e) => setHemostasisMinutes(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label small fw-bold">Condition at Discharge *</label>
                <select
                  className="form-select"
                  value={dischargeCondition}
                  onChange={(e) => setDischargeCondition(e.target.value)}
                >
                  <option value="STABLE">STABLE</option>
                  <option value="WEAK">WEAK / DIZZY</option>
                  <option value="HYPOTENSIVE">HYPOTENSIVE</option>
                  <option value="REFERRED_TO_ER">REFERRED TO ER</option>
                </select>
              </div>
              <div className="col-md-6 d-flex align-items-center pt-3">
                <div className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="chkBruit"
                    checked={accessBruitThrill}
                    onChange={(e) => setAccessBruitThrill(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="chkBruit">
                    Access bruit and thrill palpable post-procedure
                  </label>
                </div>
              </div>
            </div>

            <div className="d-flex justify-content-end gap-2 mt-4">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIsPostModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-success" disabled={submittingPost}>
                {submittingPost ? "Finalizing Session..." : "Finalize Session & Capture Charge"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── 4. SESSION DETAIL MODAL ─────────────────────────────────────────── */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={`Session Summary: ${selectedSession?.session_no}`}
      >
        <div className="small">
          <div className="row g-2 mb-3">
            <div className="col-md-6">
              <strong>Patient:</strong> {selectedSession?.first_name} {selectedSession?.last_name}
            </div>
            <div className="col-md-6">
              <strong>Status:</strong>{" "}
              <span className="badge bg-primary">{selectedSession?.status}</span>
            </div>
            <div className="col-md-6">
              <strong>Station:</strong> {selectedSession?.station_no}
            </div>
            <div className="col-md-6">
              <strong>Dialyzer:</strong> {selectedSession?.dialyzer_model} (
              <code>{selectedSession?.dialyzer_barcode}</code>)
            </div>
          </div>

          {selectedSession?.preAssessment && (
            <div className="p-2 border rounded bg-light mb-3">
              <h6 className="fw-bold mb-1 small text-primary">Pre-Dialysis Intake</h6>
              <div>
                Weight: {selectedSession.preAssessment.pre_weight_kg} kg (Dry:{" "}
                {selectedSession.preAssessment.dry_weight_kg} kg) | Target UF:{" "}
                {selectedSession.preAssessment.target_uf_liters} L
              </div>
              <div>
                BP: {selectedSession.preAssessment.sitting_bp_systolic}/
                {selectedSession.preAssessment.sitting_bp_diastolic} mmHg | HR:{" "}
                {selectedSession.preAssessment.pulse} bpm
              </div>
            </div>
          )}

          {selectedSession?.postAssessment && (
            <div className="p-2 border rounded bg-light mb-3">
              <h6 className="fw-bold mb-1 small text-success">Post-Dialysis Evaluation</h6>
              <div>
                Post Weight: {selectedSession.postAssessment.post_weight_kg} kg | Actual UF:{" "}
                {selectedSession.postAssessment.actual_uf_removed_liters} L
              </div>
              <div>
                Discharge Condition: {selectedSession.postAssessment.condition_at_discharge}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
