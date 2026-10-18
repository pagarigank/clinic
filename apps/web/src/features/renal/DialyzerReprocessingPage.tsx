import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { Alert, Modal } from "@clinic/ui";
import { renalApi, type Dialyzer } from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export function DialyzerReprocessingPage() {
  const { session } = useAuth();
  const technicianId = session?.userId || "demo-tech";

  const [dialyzers, setDialyzers] = useState<Dialyzer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchBarcode, setSearchBarcode] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Selected dialyzer for reprocessing
  const [selectedDialyzer, setSelectedDialyzer] = useState<Dialyzer | null>(null);
  const [isReprocessModalOpen, setIsReprocessModalOpen] = useState(false);

  // Reprocessing Form State (ADR-12 / AC-30)
  const [measuredVolume, setMeasuredVolume] = useState<number>(90);
  const [leakTestPassed, setLeakTestPassed] = useState<boolean>(true);
  const [disinfectant, setDisinfectant] = useState<string>("PERACETIC_ACID_4PCT");
  const [reprocessNotes, setReprocessNotes] = useState<string>("");
  const [submittingReprocess, setSubmittingReprocess] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<{
    passed: boolean;
    discardReason?: string;
  } | null>(null);

  useEffect(() => {
    loadDialyzers();
  }, []);

  async function loadDialyzers() {
    setLoading(true);
    setError(null);
    try {
      const list = await renalApi.getDialyzers();
      setDialyzers(list);
    } catch (err: any) {
      setError(err?.message || "Failed to load dialyzer inventory");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenReprocess(d: Dialyzer) {
    setSelectedDialyzer(d);
    setMeasuredVolume(Number(d.baseline_volume_ml) * 0.9);
    setLeakTestPassed(true);
    setReprocessNotes("");
    setReprocessResult(null);
    setIsReprocessModalOpen(true);
  }

  // Live bundle volume calculation & safety gate check
  const baselineVol = selectedDialyzer ? Number(selectedDialyzer.baseline_volume_ml) : 100;
  const volumePercentage = baselineVol > 0 ? (measuredVolume / baselineVol) * 100 : 0;
  const isVolumeBelowCutoff = volumePercentage < 80.0;
  const willDiscard = isVolumeBelowCutoff || !leakTestPassed;

  async function handleSubmitReprocess(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDialyzer) return;
    setSubmittingReprocess(true);
    try {
      const res = await renalApi.reprocessDialyzer(selectedDialyzer.id, {
        technicianId,
        preCleanOk: true,
        measuredVolumeMl: Number(measuredVolume),
        pressureLeakTestPassed: leakTestPassed,
        disinfectantAgent: disinfectant,
        disinfectantConcentrationOk: true,
        notes: reprocessNotes || undefined,
      });
      setReprocessResult({
        passed: res.passed,
        discardReason: res.discardReason,
      });
      await loadDialyzers();
    } catch (err: any) {
      setError(err?.problem?.detail || err?.message || "Reprocessing failed");
    } finally {
      setSubmittingReprocess(false);
    }
  }

  const filteredDialyzers = dialyzers.filter((d) => {
    if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
    if (searchBarcode) {
      const q = searchBarcode.toLowerCase();
      const code = (d.serial_barcode || "").toLowerCase();
      const pat = `${d.first_name || ""} ${d.last_name || ""}`.toLowerCase();
      if (!code.includes(q) && !pat.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="container-fluid p-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
            <span>🔄</span> Dialyzer Reprocessing &amp; QA
          </h2>
          <p className="text-muted mb-0">
            Strict single-patient dialyzer tracking (ADR-12) with &ge; 80% bundle volume cutoff (AC-30).
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to="/renal/dashboard" className="btn btn-outline-secondary">
            &larr; Unit Dashboard
          </Link>
          <Link to="/renal/worklist" className="btn btn-primary">
            <span>📋</span> Worklist
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Safety Standard Card */}
      <div className="card border-0 bg-primary-subtle text-primary-emphasis shadow-sm p-3 mb-4 rounded-3">
        <div className="d-flex align-items-center gap-3">
          <span className="fs-1">🛡️</span>
          <div>
            <h5 className="fw-bold mb-1">AAMI / DOH Dialyzer Reprocessing Standards</h5>
            <p className="mb-0 small">
              Dialyzers are strictly <strong>single-patient dedicated</strong>. A dialyzer whose total fiber bundle
              volume drops below <strong>80% of its initial baseline</strong> or fails pressure leak testing must be
              immediately retired to <code>DISCARDED</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Barcode Search */}
      <div className="card shadow-sm border-0 mb-4 rounded-3">
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-md-5">
              <label className="form-label small fw-bold text-muted mb-1">Barcode Scanner / Search</label>
              <div className="input-group">
                <span className="input-group-text bg-light">🔍</span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Scan dialyzer barcode or search patient..."
                  value={searchBarcode}
                  onChange={(e) => setSearchBarcode(e.target.value)}
                />
              </div>
            </div>

            <div className="col-md-7">
              <label className="form-label small fw-bold text-muted mb-1">Filter by Lifecycle Status</label>
              <div className="btn-group w-100" role="group">
                {["ALL", "PENDING_REPROCESS", "CLEANED_READY", "IN_USE", "DISCARDED"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`btn btn-sm ${
                      statusFilter === st ? "btn-primary" : "btn-outline-secondary"
                    }`}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dialyzers Table */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-uppercase text-muted">
              <tr>
                <th>Barcode / Model</th>
                <th>Dedicated Patient</th>
                <th>Baseline Vol</th>
                <th>Current Vol (% Baseline)</th>
                <th>Reuses / Max</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    Loading dialyzer inventory...
                  </td>
                </tr>
              ) : filteredDialyzers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    No dialyzers found matching query.
                  </td>
                </tr>
              ) : (
                filteredDialyzers.map((d) => {
                  const base = Number(d.baseline_volume_ml);
                  const curr = Number(d.current_volume_ml);
                  const pct = base > 0 ? (curr / base) * 100 : 0;

                  return (
                    <tr key={d.id}>
                      <td>
                        <strong className="font-monospace text-primary">{d.serial_barcode}</strong>
                        <div className="small text-muted">{d.dialyzer_model}</div>
                      </td>
                      <td>
                        <div className="fw-semibold">
                          {d.first_name} {d.last_name}
                        </div>
                        <div className="small text-muted font-monospace">{d.patient_id.slice(0, 8)}...</div>
                      </td>
                      <td>
                        <span className="fw-semibold">{base.toFixed(1)} mL</span>
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span className={`fw-bold ${pct < 80 ? "text-danger" : "text-success"}`}>
                            {curr.toFixed(1)} mL ({pct.toFixed(1)}%)
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="badge bg-light text-dark border">
                          {d.reuse_count} / {d.max_allowed_reuses} reuses
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            d.status === "CLEANED_READY"
                              ? "bg-success"
                              : d.status === "IN_USE"
                              ? "bg-primary"
                              : d.status === "PENDING_REPROCESS"
                              ? "bg-warning text-dark"
                              : "bg-danger"
                          }`}
                        >
                          {d.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-end">
                        {d.status !== "DISCARDED" && (
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => handleOpenReprocess(d)}
                          >
                            Reprocess QA
                          </button>
                        )}
                        {d.status === "DISCARDED" && (
                          <span className="small text-muted">
                            {d.discard_reason || "Retired"}
                          </span>
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

      {/* ── REPROCESSING QA MODAL (AC-30) ────────────────────────────────────── */}
      <Modal
        isOpen={isReprocessModalOpen}
        onClose={() => {
          setIsReprocessModalOpen(false);
          setReprocessResult(null);
        }}
        title={`Automated Reprocessing QA: ${selectedDialyzer?.serial_barcode}`}
      >
        {reprocessResult ? (
          <div>
            {reprocessResult.passed ? (
              <div className="alert alert-success p-3 rounded-3 mb-3">
                <h5 className="alert-heading fw-bold">Reprocessing QA PASSED!</h5>
                <p className="mb-0 small">
                  Bundle volume &ge; 80% baseline and pressure leak test passed. Dialyzer is disinfected and
                  marked <code>CLEANED_READY</code> for next scheduled session.
                </p>
              </div>
            ) : (
              <div className="alert alert-danger p-3 rounded-3 mb-3">
                <h5 className="alert-heading fw-bold">SAFETY GATE FAILED: DIALYZER DISCARDED</h5>
                <p className="mb-0 small">
                  <strong>Discard Reason:</strong> {reprocessResult.discardReason}
                </p>
                <div className="mt-2 text-danger-emphasis small">
                  This dialyzer has been permanently retired and cannot be assigned to any patient session.
                </div>
              </div>
            )}
            <div className="d-flex justify-content-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setIsReprocessModalOpen(false);
                  setReprocessResult(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitReprocess}>
            <div className="card bg-light border-0 p-3 mb-3 small">
              <div className="d-flex justify-content-between mb-1">
                <span>Dedicated Patient:</span>
                <strong>
                  {selectedDialyzer?.first_name} {selectedDialyzer?.last_name}
                </strong>
              </div>
              <div className="d-flex justify-content-between mb-1">
                <span>Initial Baseline Volume:</span>
                <strong>{selectedDialyzer?.baseline_volume_ml} mL</strong>
              </div>
              <div className="d-flex justify-content-between">
                <span>Current Reuse Count:</span>
                <strong>
                  {selectedDialyzer?.reuse_count} / {selectedDialyzer?.max_allowed_reuses}
                </strong>
              </div>
            </div>

            {/* Live Volume % Indicator */}
            <div className="mb-3">
              <label className="form-label small fw-bold">
                Measured Fiber Bundle Volume (mL) *
              </label>
              <input
                type="number"
                step="0.5"
                className="form-control"
                value={measuredVolume}
                onChange={(e) => setMeasuredVolume(Number(e.target.value))}
                required
              />
              <div className="mt-2 d-flex justify-content-between align-items-center">
                <span className="small text-muted">
                  Remaining volume: <strong>{volumePercentage.toFixed(1)}%</strong> of baseline
                </span>
                <span
                  className={`badge ${
                    volumePercentage >= 80 ? "bg-success" : "bg-danger"
                  }`}
                >
                  {volumePercentage >= 80 ? "PASS (>= 80%)" : "FAIL (< 80% CUTOFF)"}
                </span>
              </div>
            </div>

            {isVolumeBelowCutoff && (
              <div className="alert alert-warning small p-2 mb-3">
                <strong>Safety Warning:</strong> Bundle volume is below the 80% baseline threshold (AC-30).
                Submitting will automatically transition this dialyzer to <strong>DISCARDED</strong>.
              </div>
            )}

            {/* Pressure Leak Test */}
            <div className="mb-3">
              <label className="form-label small fw-bold">Pressure Leak Test *</label>
              <div className="d-flex gap-3">
                <div className="form-check">
                  <input
                    type="radio"
                    className="form-check-input"
                    id="leakPass"
                    name="leakTest"
                    checked={leakTestPassed === true}
                    onChange={() => setLeakTestPassed(true)}
                  />
                  <label className="form-check-label text-success fw-bold small" htmlFor="leakPass">
                    PASSED (No pressure decay)
                  </label>
                </div>
                <div className="form-check">
                  <input
                    type="radio"
                    className="form-check-input"
                    id="leakFail"
                    name="leakTest"
                    checked={leakTestPassed === false}
                    onChange={() => setLeakTestPassed(false)}
                  />
                  <label className="form-check-label text-danger fw-bold small" htmlFor="leakFail">
                    FAILED (Pressure decay / leak)
                  </label>
                </div>
              </div>
            </div>

            {/* Disinfectant Chemical */}
            <div className="mb-3">
              <label className="form-label small fw-bold">Chemical Disinfectant Agent *</label>
              <select
                className="form-select form-select-sm"
                value={disinfectant}
                onChange={(e) => setDisinfectant(e.target.value)}
              >
                <option value="PERACETIC_ACID_4PCT">Peracetic Acid 4% (Renalin)</option>
                <option value="FORMALDEHYDE_4PCT">Formalin 4%</option>
                <option value="GLUTARALDEHYDE">Glutaraldehyde</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="form-label small fw-bold">Technician Observations</label>
              <textarea
                className="form-control form-control-sm"
                rows={2}
                placeholder="Fiber appearance, header rinse, residual disinfectant check..."
                value={reprocessNotes}
                onChange={(e) => setReprocessNotes(e.target.value)}
              />
            </div>

            <div className="d-flex justify-content-end gap-2 mt-4">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIsReprocessModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`btn ${willDiscard ? "btn-danger" : "btn-primary"}`}
                disabled={submittingReprocess}
              >
                {submittingReprocess
                  ? "Evaluating..."
                  : willDiscard
                  ? "Fail Safety & Discard Dialyzer"
                  : "Pass QA & Mark Ready"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
