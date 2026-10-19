import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button } from "@clinic/ui";
import { renalApi, type RenalStation, type DialysisMachine, type DialysisSession, type WaterTreatmentLog } from "./api.js";
import { ReportPdfModal } from "../../shared/reports/ReportPdfModal.js";
import { AdmitPatientModal } from "./AdmitPatientModal.js";

export function RenalDashboardPage() {
  const navigate = useNavigate();
  const [stations, setStations] = useState<RenalStation[]>([]);
  const [machines, setMachines] = useState<DialysisMachine[]>([]);
  const [todaySessions, setTodaySessions] = useState<DialysisSession[]>([]);
  const [latestWaterLog, setLatestWaterLog] = useState<WaterTreatmentLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeReportTitle, setActiveReportTitle] = useState<string>('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAdmitModalOpen, setIsAdmitModalOpen] = useState(false);
  const [admitStationId, setAdmitStationId] = useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    setError(null);
    try {
      const [stList, mList, sList, wList] = await Promise.all([
        renalApi.getStations().catch(() => []),
        renalApi.getMachines().catch(() => []),
        renalApi.getSessions({ scheduledDate: todayStr }).catch(() => []),
        renalApi.getWaterLogs(undefined, todayStr).catch(() => []),
      ]);
      setStations(stList);
      setMachines(mList);
      setTodaySessions(sList);
      if (wList && wList.length > 0 && wList[0]) {
        setLatestWaterLog(wList[0]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load renal dashboard data");
    } finally {
      setLoading(false);
    }
  }

  // Pre-shift water safety compliance status
  const chlorineBreakthrough = latestWaterLog
    ? Number(latestWaterLog.carbon_breakthrough_chlorine_ppm)
    : null;
  const isWaterCompliant =
    chlorineBreakthrough !== null && chlorineBreakthrough < 0.1 && latestWaterLog?.status === "COMPLIANT";

  // Session counts
  const scheduledCount = todaySessions.filter((s) => s.status === "SCHEDULED").length;
  const inProgressCount = todaySessions.filter((s) => s.status === "IN_PROGRESS").length;
  const completedCount = todaySessions.filter((s) => s.status === "COMPLETED").length;

  function handleOpenAdmit(stationId?: string) {
    setAdmitStationId(stationId || null);
    setIsAdmitModalOpen(true);
  }

  return (
    <div className="container-fluid p-4">
      {/* Header & Quick Action Buttons */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
            <span>🩸</span> Hemodialysis Unit Operations
          </h2>
          <p className="text-muted mb-0">
            Real-time station monitoring, water safety fail-safe gates, and dialyzer traceability.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button
            variant="primary"
            className="d-flex align-items-center gap-1 shadow-sm fw-bold px-3"
            onClick={() => handleOpenAdmit()}
          >
            <span>➕</span> Admit Patient
          </Button>
          <Link to="/renal/worklist" className="btn btn-outline-primary d-flex align-items-center gap-1 shadow-sm">
            <span>📋</span> Daily Worklist
          </Link>
          <Link to="/renal/water-safety" className="btn btn-outline-info d-flex align-items-center gap-1">
            <span>💧</span> Water Safety Log
          </Link>
          <Link to="/renal/reprocessing" className="btn btn-outline-secondary d-flex align-items-center gap-1">
            <span>🔄</span> Reprocessing Lab
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Pre-Shift Water Safety Gate Banner (AC-31) */}
      <div className="mb-4">
        {latestWaterLog ? (
          isWaterCompliant ? (
            <div className="alert alert-success d-flex justify-content-between align-items-center shadow-sm border-0 bg-success-subtle p-3 rounded-3">
              <div className="d-flex align-items-center gap-3">
                <span className="fs-2">💧</span>
                <div>
                  <h5 className="mb-1 fw-bold text-success">
                    PRE-SHIFT WATER SAFETY COMPLIANT (AAMI / ISO 23500)
                  </h5>
                  <p className="mb-0 text-success-emphasis small">
                    Carbon bed total chlorine breakthrough: <strong>{chlorineBreakthrough?.toFixed(3)} ppm</strong>{" "}
                    (Safe threshold &lt; 0.1 ppm) | RO Rejection:{" "}
                    <strong>{Number(latestWaterLog.ro_rejection_rate_pct).toFixed(1)}%</strong> | Conductivity:{" "}
                    <strong>{Number(latestWaterLog.ro_conductivity_us).toFixed(1)} µS/cm</strong>
                  </p>
                </div>
              </div>
              <span className="badge bg-success px-3 py-2 fs-6">
                TREATMENT APPROVED
              </span>
            </div>
          ) : (
            <div className="alert alert-danger d-flex justify-content-between align-items-center shadow border-0 bg-danger-subtle p-3 rounded-3">
              <div className="d-flex align-items-center gap-3">
                <span className="fs-2 animate-bounce">⚠️</span>
                <div>
                  <h5 className="mb-1 fw-bold text-danger">
                    CRITICAL: WATER SAFETY LOCKOUT ACTIVE (AC-31)
                  </h5>
                  <p className="mb-0 text-danger-emphasis small">
                    Carbon breakthrough chlorine: <strong>{chlorineBreakthrough?.toFixed(3)} ppm</strong> (&ge; 0.1
                    ppm cutoff). Hemodialysis sessions are <strong>LOCKED OUT</strong> to prevent patient hemolysis.
                  </p>
                </div>
              </div>
              <Link to="/renal/water-safety" className="btn btn-danger btn-sm shadow-sm">
                Address Water Breakthrough
              </Link>
            </div>
          )
        ) : (
          <div className="alert alert-warning d-flex justify-content-between align-items-center shadow-sm p-3 rounded-3">
            <div className="d-flex align-items-center gap-3">
              <span className="fs-2">⚠️</span>
              <div>
                <h5 className="mb-1 fw-bold text-warning-emphasis">NO PRE-SHIFT WATER LOG RECORDED TODAY</h5>
                <p className="mb-0 small text-muted">
                  A pre-shift total chlorine breakthrough test is mandatory before initiating any patient session.
                </p>
              </div>
            </div>
            <Link to="/renal/water-safety" className="btn btn-warning btn-sm">
              Log Pre-Shift Water Test
            </Link>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted text-uppercase mb-1 small fw-semibold">Today's Sessions</h6>
                  <h3 className="mb-0 fw-bold">{todaySessions.length}</h3>
                </div>
                <div className="p-3 bg-primary-subtle text-primary rounded-circle fs-4">📅</div>
              </div>
              <div className="mt-3 small text-muted d-flex gap-2">
                <span className="badge bg-secondary">{scheduledCount} scheduled</span>
                <span className="badge bg-info">{inProgressCount} active</span>
                <span className="badge bg-success">{completedCount} done</span>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted text-uppercase mb-1 small fw-semibold">Active Dialysis Chairs</h6>
                  <h3 className="mb-0 fw-bold">{stations.length}</h3>
                </div>
                <div className="p-3 bg-success-subtle text-success rounded-circle fs-4">💺</div>
              </div>
              <div className="mt-3 small text-muted">
                {stations.filter((s) => s.is_isolation).length} Isolation station(s) (HBsAg+)
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted text-uppercase mb-1 small fw-semibold">Dialysis Machines</h6>
                  <h3 className="mb-0 fw-bold">{machines.length}</h3>
                </div>
                <div className="p-3 bg-info-subtle text-info rounded-circle fs-4">📟</div>
              </div>
              <div className="mt-3 small text-muted">
                {machines.filter((m) => m.status === "ACTIVE").length} Operational |{" "}
                {machines.filter((m) => m.status !== "ACTIVE").length} In Maintenance
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm border-0 rounded-3 h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="text-muted text-uppercase mb-1 small fw-semibold">PhilHealth 156-Cap</h6>
                  <h3 className="mb-0 fw-bold text-primary">₱2,600</h3>
                </div>
                <div className="p-3 bg-warning-subtle text-warning-emphasis rounded-circle fs-4">🏛️</div>
              </div>
              <div className="mt-3 small text-muted">
                Annual HD benefit package per patient with automated claim generation.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Station Occupancy Grid */}
      <div className="card shadow-sm border-0 rounded-3 mb-4">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="mb-0 fw-bold">Dialysis Station & Chair Status</h5>
          <span className="badge bg-light text-dark border">
            {stations.length} Total Units
          </span>
        </div>
        <div className="card-body p-4">
          {loading ? (
            <div className="text-center py-5 text-muted">Loading dialysis stations...</div>
          ) : stations.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <p className="mb-2">No dialysis stations registered yet.</p>
              <Link to="/renal/worklist" className="btn btn-outline-primary btn-sm">
                Configure Stations
              </Link>
            </div>
          ) : (
            <div className="row g-3">
              {stations.map((st) => {
                // Find machine assigned to this station
                const machine = machines.find((m) => m.station_id === st.id);
                // Find if there's an active session in progress on this station
                const activeSession = todaySessions.find(
                  (s) => s.station_id === st.id && s.status === "IN_PROGRESS"
                );
                const scheduledSession = todaySessions.find(
                  (s) => s.station_id === st.id && s.status === "SCHEDULED"
                );

                const statusColor = activeSession
                  ? "border-primary bg-primary-subtle text-primary-emphasis"
                  : scheduledSession
                  ? "border-info bg-info-subtle"
                  : "border-success bg-white";

                return (
                  <div key={st.id} className="col-md-4 col-lg-3">
                    <div className={`card h-100 border-2 rounded-3 shadow-sm ${statusColor}`}>
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <span className="fw-bold fs-5">{st.station_no}</span>
                          <div>
                            {st.is_isolation && (
                              <span className="badge bg-danger me-1">ISOLATION</span>
                            )}
                            <span
                              className={`badge ${
                                activeSession
                                  ? "bg-primary"
                                  : scheduledSession
                                  ? "bg-info"
                                  : "bg-success"
                              }`}
                            >
                              {activeSession
                                ? "IN TREATMENT"
                                : scheduledSession
                                ? "RESERVED"
                                : "AVAILABLE"}
                            </span>
                          </div>
                        </div>

                        <div className="small text-muted mb-2">
                          <strong>Chair:</strong> {st.name} {st.room ? `(${st.room})` : ""}
                        </div>

                        {machine && (
                          <div className="small text-muted mb-2">
                            <strong>Machine:</strong> {machine.brand} {machine.model} (
                            <code>{machine.serial_no}</code>)
                          </div>
                        )}

                        {activeSession ? (
                          <div className="p-2 bg-white rounded border mt-2 small">
                            <div className="fw-bold text-primary">
                              {activeSession.first_name} {activeSession.last_name}
                            </div>
                            <div className="text-muted">
                              Session: <code>{activeSession.session_no}</code>
                            </div>
                            <div className="text-muted">
                              Dialyzer: {activeSession.dialyzer_model}
                            </div>
                            <div className="mt-2 d-flex justify-content-between">
                              <span className="badge bg-primary">RUNNING</span>
                              <Link
                                to={`/renal/worklist`}
                                className="btn btn-sm btn-link p-0 text-decoration-none"
                              >
                                View Flowsheet &rarr;
                              </Link>
                            </div>
                          </div>
                        ) : scheduledSession ? (
                          <div className="p-2 bg-white rounded border mt-2 small">
                            <div className="fw-bold text-dark">
                              {scheduledSession.first_name} {scheduledSession.last_name}
                            </div>
                            <div className="text-muted">
                              Scheduled HD Session
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-success w-100 fw-bold d-flex align-items-center justify-content-center gap-1 shadow-sm"
                              onClick={() => handleOpenAdmit(st.id)}
                            >
                              <span>⚡</span> Admit Patient to Chair
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 4. STATUTORY & REGULATORY REPORTS CENTER (True Vector PDF) ────────── */}
      <div className="card shadow-sm border-0 rounded-3 mb-4 mt-4">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
              <span>🏛️</span> DOH &amp; PhilHealth Statutory Reports (True Vector PDF)
            </h5>
            <p className="text-muted mb-0 small">
              Official statutory reporting with facility letterhead, accreditation IDs, clinical telemetry, and doctor/nurse signature lines.
            </p>
          </div>
          <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1">
            Server Rendered (Playwright Chromium)
          </span>
        </div>
        <div className="card-body p-4">
          <div className="row g-3">
            {[
              {
                id: 'RPT-REN-01',
                title: 'Philippine Renal Disease Registry (PRDR)',
                desc: 'Mandated DOH AO 2012-0001 census of hemodialysis patients, etiology, modalities, and outcomes.',
                icon: '🏛️',
                badge: 'DOH Mandate',
              },
              {
                id: 'RPT-REN-02',
                title: 'Water Safety & Chlorine Testing Log',
                desc: 'AAMI / ISO 23500 pre-shift chlorine breakthrough surveillance (< 0.1 ppm) and RO rejection records.',
                icon: '💧',
                badge: 'Daily Safety',
              },
              {
                id: 'RPT-REN-03',
                title: 'Dialyzer Reprocessing & Reuse Register',
                desc: 'DOH AO 2020-0035 single-patient dialyzer tracking with ≥ 80% volume cutoff and disinfectant tests.',
                icon: '🔄',
                badge: 'Infection Control',
              },
              {
                id: 'RPT-REN-04',
                title: 'Hemodialysis Adverse Events & Pyrogenic Log',
                desc: 'Clinical complications register: hypotensive episodes, dialyzer clotting, and pyrogenic reactions.',
                icon: '⚠️',
                badge: 'QA & Safety',
              },
              {
                id: 'RPT-REN-05',
                title: 'PhilHealth 156-Session Dialysis Benefit Register',
                desc: 'Official calendar year claim utilization registry tracking session sequence (1…156) and copays.',
                icon: '💳',
                badge: 'PhilHealth eClaims',
              },
              {
                id: 'RPT-REN-06',
                title: 'Hemodialysis Adequacy & Kt/V Register',
                desc: 'Daugirdas spKt/V and Urea Reduction Ratio (URR) monthly clinical adequacy surveillance.',
                icon: '🧪',
                badge: 'Clinical Outcome',
              },
            ].map((rpt) => (
              <div key={rpt.id} className="col-md-6 col-lg-4">
                <div className="card h-100 border shadow-sm rounded-3 p-3 d-flex flex-column justify-content-between hover-shadow">
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="badge bg-light text-dark border font-monospace">{rpt.id}</span>
                      <span className="badge bg-secondary-subtle text-secondary">{rpt.badge}</span>
                    </div>
                    <h6 className="fw-bold mb-1 text-dark d-flex align-items-center gap-1">
                      <span>{rpt.icon}</span> {rpt.title}
                    </h6>
                    <p className="text-muted small mb-3" style={{ fontSize: '0.8rem' }}>
                      {rpt.desc}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger w-100 d-flex align-items-center justify-content-center gap-1 shadow-sm mt-2"
                    onClick={() => {
                      setActiveReportId(rpt.id);
                      setActiveReportTitle(rpt.title);
                      setIsReportModalOpen(true);
                    }}
                  >
                    <span>📄</span> View / Print True PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 5. FORMAL REPORT PDF MODAL ────────────────────────────────────────── */}
      <ReportPdfModal
        isOpen={isReportModalOpen}
        onClose={() => {
          setIsReportModalOpen(false);
          setActiveReportId(null);
        }}
        reportId={activeReportId || undefined}
        reportTitle={activeReportTitle}
        filename={activeReportId ? `${activeReportId.toLowerCase()}_formal_report.pdf` : undefined}
      />

      {/* ── 6. ADMIT PATIENT TO MACHINE MODAL ─────────────────────────────────── */}
      <AdmitPatientModal
        show={isAdmitModalOpen}
        onHide={() => {
          setIsAdmitModalOpen(false);
          setAdmitStationId(null);
        }}
        preselectedStationId={admitStationId}
        onSessionAdmitted={(session, startImmediately) => {
          if (startImmediately) {
            navigate(`/renal/worklist?admitSessionId=${session.id}`);
          } else {
            loadDashboardData();
          }
        }}
      />
    </div>
  );
}
