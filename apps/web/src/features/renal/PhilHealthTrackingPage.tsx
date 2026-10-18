import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { Alert } from "@clinic/ui";
import { renalApi, type PhilHealthUsage, type DialysisSession } from "./api.js";

export function PhilHealthTrackingPage() {
  const [sessions, setSessions] = useState<DialysisSession[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [usage, setUsage] = useState<PhilHealthUsage | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    // Load completed sessions to extract patient list
    loadCompletedSessions();
  }, []);

  async function loadCompletedSessions() {
    try {
      const data = await renalApi.getSessions({ status: "COMPLETED" });
      setSessions(data);
      const first = data[0];
      if (first && !selectedPatientId) {
        setSelectedPatientId(first.patient_id);
        fetchUsage(first.patient_id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load dialysis history");
    }
  }

  async function fetchUsage(patientId: string) {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await renalApi.getPhilHealthUsage(patientId, currentYear);
      setUsage(res);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch PhilHealth usage");
    } finally {
      setLoading(false);
    }
  }

  function handleSelectPatient(patientId: string) {
    setSelectedPatientId(patientId);
    fetchUsage(patientId);
  }

  // Deduplicate patients from sessions list
  const patientMap = new Map<string, string>();
  sessions.forEach((s) => {
    if (!patientMap.has(s.patient_id)) {
      patientMap.set(s.patient_id, `${s.first_name || ""} ${s.last_name || ""}`);
    }
  });
  const patientList = Array.from(patientMap.entries()).map(([id, name]) => ({ id, name }));

  const used = usage?.sessionCount ?? 0;
  const maxLimit = usage?.maxBenefitSessions ?? 156;
  const remaining = Math.max(0, maxLimit - used);
  const percentUsed = Math.min(100, Math.round((used / maxLimit) * 100));
  const isPastCeiling = used > maxLimit;

  return (
    <div className="container-fluid p-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1 text-primary fw-bold d-flex align-items-center gap-2">
            <span>🏛️</span> PhilHealth 156-Session Dialysis Benefit Tracker
          </h2>
          <p className="text-muted mb-0">
            Automated calendar year tracking of Hemodialysis package benefit ceiling (AC-32).
          </p>
        </div>
        <div className="d-flex gap-2">
          <Link to="/renal/dashboard" className="btn btn-outline-secondary">
            &larr; Unit Dashboard
          </Link>
          <Link to="/renal/worklist" className="btn btn-outline-primary">
            <span>📋</span> Worklist
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Patient Selector */}
      <div className="card shadow-sm border-0 mb-4 rounded-3">
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-md-6">
              <label className="form-label small fw-bold text-muted mb-1">Select Patient</label>
              <select
                className="form-select"
                value={selectedPatientId}
                onChange={(e) => handleSelectPatient(e.target.value)}
              >
                {patientList.length === 0 && <option value="">No completed dialysis patients found</option>}
                {patientList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name.trim() ? p.name : `Patient ${p.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold text-muted mb-1">Benefit Calendar Year</label>
              <input type="text" className="form-control bg-light" value={currentYear} disabled />
            </div>
          </div>
        </div>
      </div>

      {/* Usage Analytics Grid */}
      <div className="row g-4 mb-4">
        {/* Progress Card */}
        <div className="col-lg-8">
          <div className="card shadow-sm border-0 rounded-3 h-100 p-4">
            <h5 className="fw-bold mb-3 d-flex justify-content-between align-items-center">
              <span>Annual Benefit Allowance ({currentYear})</span>
              <span className="badge bg-primary">Package Code: HD01</span>
            </h5>

            <div className="mb-3">
              <div className="d-flex justify-content-between mb-1 small text-muted">
                <span>Utilization</span>
                <span>
                  <strong>{used}</strong> of <strong>{maxLimit}</strong> Sessions
                </span>
              </div>
              <div className="progress" style={{ height: "24px" }}>
                <div
                  className={`progress-bar progress-bar-striped ${
                    isPastCeiling
                      ? "bg-danger"
                      : percentUsed > 80
                      ? "bg-warning text-dark"
                      : "bg-success"
                  }`}
                  role="progressbar"
                  style={{ width: `${percentUsed}%` }}
                >
                  {percentUsed}% ({used} / {maxLimit})
                </div>
              </div>
            </div>

            {isPastCeiling ? (
              <div className="alert alert-danger mb-0 small">
                <strong>Annual Ceiling Reached:</strong> Patient has consumed all 156 PhilHealth-covered
                sessions for {currentYear}. Subsequent treatments require full out-of-pocket patient copay
                (₱2,600.00 / session) or supplemental social service assistance.
              </div>
            ) : (
              <div className="alert alert-success-subtle border-0 mb-0 small text-success-emphasis">
                <strong>Remaining Covered Sessions:</strong> Patient has{" "}
                <strong>{remaining} sessions remaining</strong> eligible for PhilHealth full package reimbursement
                (₱2,600.00 per session with ₱0 copay).
              </div>
            )}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="col-lg-4">
          <div className="card shadow-sm border-0 rounded-3 h-100 p-4 bg-light">
            <h6 className="text-uppercase small fw-bold text-muted mb-3">Reimbursement Summary</h6>
            <div className="d-flex justify-content-between py-2 border-bottom">
              <span className="small text-muted">Covered Benefit Rate:</span>
              <strong className="text-primary">₱2,600.00 / session</strong>
            </div>
            <div className="d-flex justify-content-between py-2 border-bottom">
              <span className="small text-muted">Total Claimed Value:</span>
              <strong className="text-success">₱{(Math.min(used, maxLimit) * 2600).toLocaleString()}.00</strong>
            </div>
            <div className="d-flex justify-content-between py-2 border-bottom">
              <span className="small text-muted">Remaining Benefit Value:</span>
              <strong>₱{(remaining * 2600).toLocaleString()}.00</strong>
            </div>
            <div className="d-flex justify-content-between py-2">
              <span className="small text-muted">Current Patient Copay:</span>
              <span className="badge bg-secondary">
                {isPastCeiling ? "₱2,600.00 / session" : "₱0.00 (No Balance Billing)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Patient Dialysis Claims History */}
      <div className="card shadow-sm border-0 rounded-3">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="mb-0 fw-bold">Session &amp; eClaims Ledger</h5>
          <span className="badge bg-light text-dark border">
            {sessions.filter((s) => s.patient_id === selectedPatientId).length} Sessions
          </span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-uppercase text-muted">
              <tr>
                <th>Session No</th>
                <th>Treatment Date</th>
                <th>Duration</th>
                <th>Actual UF</th>
                <th>Claim Value</th>
                <th>eClaims Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.filter((s) => s.patient_id === selectedPatientId).length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">
                    No completed treatment records found for this patient.
                  </td>
                </tr>
              ) : (
                sessions
                  .filter((s) => s.patient_id === selectedPatientId)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong className="font-monospace text-primary">{s.session_no}</strong>
                      </td>
                      <td>{s.scheduled_date}</td>
                      <td>{s.actual_duration_minutes ? `${s.actual_duration_minutes} min` : "240 min"}</td>
                      <td>{s.total_uf_removed_liters ? `${s.total_uf_removed_liters} L` : "--"}</td>
                      <td>
                        <strong className="text-success">₱2,600.00</strong>
                      </td>
                      <td>
                        <span className="badge bg-info">DRAFT eCLAIM</span>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
