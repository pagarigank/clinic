import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { Alert, Modal } from "@clinic/ui";
import { renalApi, type WaterTreatmentLog } from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export function WaterTreatmentLogPage() {
  const { session } = useAuth();
  const testedBy = session?.userId || "demo-tech";

  const [logs, setLogs] = useState<WaterTreatmentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New log form state (AC-31)
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [chlorinePpm, setChlorinePpm] = useState<number>(0.02);
  const [roConductivity, setRoConductivity] = useState<number>(8.5);
  const [roRejection, setRoRejection] = useState<number>(99.1);
  const [logNotes, setLogNotes] = useState<string>("");
  const [submittingLog, setSubmittingLog] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    loadWaterLogs();
  }, []);

  async function loadWaterLogs() {
    setLoading(true);
    setError(null);
    try {
      const data = await renalApi.getWaterLogs();
      setLogs(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load water treatment logs");
    } finally {
      setLoading(false);
    }
  }

  // Live threshold check
  const isChlorineLockout = chlorinePpm >= 0.1;

  async function handleSubmitLog(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingLog(true);
    setSubmitError(null);
    try {
      await renalApi.createWaterLog({
        branchId: "a1000000-0000-4000-8000-000000000001", // Demo Branch A
        logDate,
        testedBy,
        carbonBreakthroughChlorinePpm: Number(chlorinePpm),
        roConductivityUs: Number(roConductivity),
        roRejectionRatePct: Number(roRejection),
        chemicalDisinfectionDone: false,
        notes: logNotes || undefined,
      });
      setIsLogModalOpen(false);
      await loadWaterLogs();
    } catch (err: any) {
      setSubmitError(err?.problem?.detail || err?.message || "Failed to record water log");
    } finally {
      setSubmittingLog(false);
    }
  }

  return (
    <div className="container-fluid p-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
            <span>💧</span> Water Safety &amp; Reverse Osmosis Logs
          </h2>
          <p className="text-muted mb-0">
            AAMI / ISO 23500 pre-shift total chlorine breakthrough surveillance (AC-31).
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to="/renal/dashboard" className="btn btn-outline-secondary">
            &larr; Unit Dashboard
          </Link>
          <button className="btn btn-primary shadow-sm" onClick={() => setIsLogModalOpen(true)}>
            <span>➕</span> Log Pre-Shift Water Test
          </button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Safety Cutoff Guidance Card */}
      <div className="card border-0 bg-info-subtle text-info-emphasis shadow-sm p-3 mb-4 rounded-3">
        <div className="d-flex align-items-center gap-3">
          <span className="fs-1">🔬</span>
          <div>
            <h5 className="fw-bold mb-1">AAMI / ISO 23500 Standard for Hemodialysis Water</h5>
            <p className="mb-0 small">
              Total chlorine (free chlorine + chloramines) following the primary carbon bed must not exceed{" "}
              <strong>0.1 mg/L (ppm)</strong>. Testing is mandatory prior to the first patient shift of each day.
              If breakthrough &ge; 0.1 ppm occurs, all hemodialysis session intakes are{" "}
              <strong>fail-closed and automatically locked out</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Water Treatment Logs Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="mb-0 fw-bold">Surveillance Log Archive</h5>
          <span className="badge bg-light text-dark border">{logs.length} Log Entries</span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-uppercase text-muted">
              <tr>
                <th>Log Date</th>
                <th>Total Chlorine (ppm)</th>
                <th>RO Conductivity (µS/cm)</th>
                <th>RO Rejection Rate</th>
                <th>Safety Status</th>
                <th>Logged By</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    Loading water surveillance logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    No water treatment logs recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const cl = Number(log.carbon_breakthrough_chlorine_ppm);
                  const isSafe = cl < 0.1 && log.status === "COMPLIANT";

                  return (
                    <tr key={log.id}>
                      <td>
                        <strong>{log.log_date}</strong>
                        <div className="small text-muted font-monospace">
                          {new Date(log.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td>
                        <span className={`fw-bold fs-6 ${isSafe ? "text-success" : "text-danger"}`}>
                          {cl.toFixed(3)} ppm
                        </span>
                        <div className="small text-muted">Cutoff: &lt; 0.100 ppm</div>
                      </td>
                      <td>
                        <span>{Number(log.ro_conductivity_us).toFixed(1)} µS/cm</span>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark border">
                          {Number(log.ro_rejection_rate_pct).toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            isSafe ? "bg-success" : "bg-danger animate-pulse"
                          }`}
                        >
                          {isSafe ? "COMPLIANT (SAFE)" : "ACTION REQUIRED (LOCKOUT)"}
                        </span>
                      </td>
                      <td>
                        <span className="small text-muted font-monospace">
                          {log.tested_by.slice(0, 8)}...
                        </span>
                      </td>
                      <td>
                        <span className="small text-muted">{log.notes || "--"}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── NEW WATER TEST MODAL (AC-31) ────────────────────────────────────── */}
      <Modal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        title="Record Daily Pre-Shift Water Surveillance Test"
      >
        <form onSubmit={handleSubmitLog}>
          {submitError && <div className="alert alert-danger small p-2 mb-3">{submitError}</div>}

          <div className="mb-3">
            <label className="form-label small fw-bold">Test Date *</label>
            <input
              type="date"
              className="form-control"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">
              Carbon Bed Total Chlorine Breakthrough (PPM) *
            </label>
            <input
              type="number"
              step="0.001"
              className={`form-control ${isChlorineLockout ? "is-invalid" : "is-valid"}`}
              value={chlorinePpm}
              onChange={(e) => setChlorinePpm(Number(e.target.value))}
              required
            />
            <div className="mt-2 d-flex justify-content-between align-items-center">
              <span className="small text-muted">AAMI Standard Threshold: &lt; 0.1 ppm</span>
              <span className={`badge ${isChlorineLockout ? "bg-danger" : "bg-success"}`}>
                {isChlorineLockout ? "BREAKTHROUGH DETECTED (LOCKOUT)" : "SAFE LEVEL (< 0.1 PPM)"}
              </span>
            </div>
          </div>

          {isChlorineLockout && (
            <div className="alert alert-danger small p-2 mb-3">
              <strong>CRITICAL SAFETY ALERT (AC-31):</strong> Total chlorine &ge; 0.1 ppm causes acute patient
              hemolysis! Recording this test will fail-close and block all hemodialysis session intakes until a
              clean post-carbon flush is confirmed.
            </div>
          )}

          <div className="row g-2 mb-3">
            <div className="col-md-6">
              <label className="form-label small fw-bold">RO Conductivity (µS/cm) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={roConductivity}
                onChange={(e) => setRoConductivity(Number(e.target.value))}
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold">RO Rejection Rate (%) *</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={roRejection}
                onChange={(e) => setRoRejection(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-bold">Technician Observations</label>
            <textarea
              className="form-control form-control-sm"
              rows={2}
              placeholder="Filter cartridge delta P, salt tank level, carbon bed backwash status..."
              value={logNotes}
              onChange={(e) => setLogNotes(e.target.value)}
            />
          </div>

          <div className="d-flex justify-content-end gap-2 mt-4">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setIsLogModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${isChlorineLockout ? "btn-danger" : "btn-primary"}`}
              disabled={submittingLog}
            >
              {submittingLog
                ? "Submitting..."
                : isChlorineLockout
                ? "Record Breakthrough Lockout"
                : "Submit Compliant Water Test"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
