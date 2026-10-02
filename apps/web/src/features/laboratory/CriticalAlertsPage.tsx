import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  StatusPill,
} from "@clinic/ui";
import { labApi, type CriticalAlert } from "./api.js";

export function CriticalAlertsPage() {
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"ACTIVE" | "ACKNOWLEDGED">("ACTIVE");

  // Acknowledge Modal
  const [selectedAlert, setSelectedAlert] = useState<CriticalAlert | null>(null);
  const [commMethod, setCommMethod] = useState<"IN_APP" | "PHONE" | "SMS">("PHONE");
  const [readBackConfirmed, setReadBackConfirmed] = useState(false);
  const [readBackText, setReadBackText] = useState("");
  const [acking, setAcking] = useState(false);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await labApi.listCriticalAlerts(
        activeTab === "ACTIVE" ? false : true
      );
      setAlerts(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load critical alert notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [activeTab]);

  const handleOpenAckModal = (alertItem: CriticalAlert) => {
    setSelectedAlert(alertItem);
    setCommMethod("PHONE");
    setReadBackConfirmed(false);
    setReadBackText(
      `Read-back verified with Attending Physician: Patient ${alertItem.patient_name}, ${alertItem.analyte_name} = ${alertItem.value} ${alertItem.unit} (${alertItem.flag}).`
    );
  };

  const handleAcknowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlert) return;
    if (!readBackConfirmed || !readBackText.trim()) {
      alert("AC-10 Requirement: You must confirm verbal read-back and document the read-back confirmation text.");
      return;
    }

    try {
      setAcking(true);
      await labApi.acknowledgeCriticalAlert(selectedAlert.id, {
        method: commMethod,
        notifiedTo: "Attending Physician",
        readBackConfirmed: true,
        readBackText: readBackText.trim(),
      });
      setSelectedAlert(null);
      setSuccessMsg("Critical value alert acknowledged and read-back documented (AC-10). Escalation halted.");
      await loadAlerts();
    } catch (err: any) {
      alert(`Acknowledgment error: ${err.message}`);
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="container-fluid py-3 px-4">
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 small">
              <li className="breadcrumb-item">
                <Link to="/laboratory/worklist">Worklist</Link>
              </li>
              <li className="breadcrumb-item active" aria-current="page">
                Critical Alerts
              </li>
            </ol>
          </nav>
          <h2 className="h4 fw-bold mb-0 d-flex align-items-center gap-2">
            <span className="text-danger">⚡</span> Critical Panic Value Notifications (AC-10)
          </h2>
          <p className="text-muted small mb-0">
            Immediate life-threatening results (HH / LL). Mandatory verbal read-back notification and automated escalation tracking.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={loadAlerts}>
            🔄 Refresh
          </Button>
          <Link to="/laboratory/verification" className="btn btn-outline-primary btn-sm">
            Go to Verification Queue →
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="mb-3">
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert variant="success" dismissible onClose={() => setSuccessMsg(null)} className="mb-3">
          {successMsg}
        </Alert>
      )}

      {/* Tabs */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-white border-bottom-0 pb-0 pt-2 px-3">
          <ul className="nav nav-tabs card-header-tabs" role="tablist">
            <li className="nav-item">
              <button
                type="button"
                className={`nav-link ${activeTab === "ACTIVE" ? "active fw-bold text-danger" : "text-secondary"}`}
                onClick={() => setActiveTab("ACTIVE")}
              >
                ⚡ Active Panic Alerts
              </button>
            </li>
            <li className="nav-item">
              <button
                type="button"
                className={`nav-link ${activeTab === "ACKNOWLEDGED" ? "active fw-bold text-success" : "text-secondary"}`}
                onClick={() => setActiveTab("ACKNOWLEDGED")}
              >
                ✓ Acknowledged History
              </button>
            </li>
          </ul>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
            <thead className="table-light text-muted small text-uppercase">
              <tr>
                <th style={{ width: "90px" }}>Severity</th>
                <th>Patient</th>
                <th>Order</th>
                <th>Test / Analyte</th>
                <th>Panic Value</th>
                <th>Triggered At</th>
                <th>Status / Escalation</th>
                <th className="text-end" style={{ minWidth: "140px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Loading alerts…
                  </td>
                </tr>
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-5 text-muted">
                    <div className="mb-2" style={{ fontSize: "2rem" }}>🎉</div>
                    <h6>No {activeTab === "ACTIVE" ? "Active Critical Alerts" : "Acknowledged Alerts"}</h6>
                    <p className="small mb-0">
                      {activeTab === "ACTIVE"
                        ? "All critical results have been acknowledged and verified."
                        : "No historical critical acknowledgments recorded yet."}
                    </p>
                  </td>
                </tr>
              ) : (
                alerts.map((al) => {
                  const isHH = al.flag === "HH";
                  const elapsedMin = Math.round(
                    (Date.now() - new Date(al.created_at).getTime()) / (60 * 1000)
                  );

                  return (
                    <tr
                      key={al.id}
                      className={!al.acknowledged_at ? (isHH ? "table-danger" : "table-warning") : ""}
                    >
                      {/* Flag Badge */}
                      <td>
                        <span className="badge bg-danger text-white fw-bold px-2 py-1">
                          {al.flag}
                        </span>
                      </td>

                      {/* Patient */}
                      <td>
                        <div className="fw-semibold">{al.patient_name}</div>
                        <div className="small text-muted">MRN: {al.mrn || "Walk-In"}</div>
                      </td>

                      {/* Order */}
                      <td>
                        <div className="fw-semibold text-primary">{al.order_no}</div>
                      </td>

                      {/* Test / Analyte */}
                      <td>
                        <div className="fw-semibold">{al.analyte_name}</div>
                        <div className="small text-muted">{al.test_name}</div>
                      </td>

                      {/* Panic Value */}
                      <td>
                        <span className="fs-6 fw-bold font-monospace text-danger">
                          {al.value} {al.unit}
                        </span>
                      </td>

                      {/* Triggered At */}
                      <td>
                        <div>{new Date(al.created_at).toLocaleTimeString()}</div>
                        <div className="small text-muted">{elapsedMin}m ago</div>
                      </td>

                      {/* Escalation */}
                      <td>
                        {al.acknowledged_at ? (
                          <div>
                            <span className="badge bg-success-subtle text-success">
                              ✓ Acknowledged ({al.communication_method})
                            </span>
                            <div className="small text-muted">
                              by {al.acknowledged_by_name || "Staff"}
                            </div>
                          </div>
                        ) : al.is_escalated ? (
                          <span className="badge bg-danger text-white animate-pulse">
                            🚨 ESCALATED (Supervisor Alerted)
                          </span>
                        ) : (
                          <span className="badge bg-warning text-dark">
                            ⏳ Pending Ack ({elapsedMin}m)
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="text-end">
                        {!al.acknowledged_at ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleOpenAckModal(al)}
                          >
                            📞 Acknowledge &amp; Read-back
                          </Button>
                        ) : (
                          <span className="small text-muted font-monospace">
                            Read-back Confirmed ✓
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

      {/* ── Acknowledgment Modal (AC-10) ────────────────────────────────────── */}
      <Modal show={!!selectedAlert} onHide={() => setSelectedAlert(null)}>
        <form onSubmit={handleAcknowledge}>
          <Modal.Header closeButton>
            <Modal.Title className="h5 text-danger d-flex align-items-center gap-2">
              <span>📞</span> Verbal Read-Back Acknowledgment (AC-10)
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedAlert && (
              <div className="p-3 bg-danger-subtle rounded border border-danger mb-3">
                <div className="fw-bold text-danger">
                  🚨 CRITICAL PANIC VALUE: {selectedAlert.analyte_name} = {selectedAlert.value} {selectedAlert.unit} ({selectedAlert.flag})
                </div>
                <div className="small text-dark mt-1">
                  Patient: <strong>{selectedAlert.patient_name}</strong> • Order: {selectedAlert.order_no}
                </div>
              </div>
            )}

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Communication Channel *</Form.Label>
              <Form.Select
                value={commMethod}
                onChange={(e: any) => setCommMethod(e.target.value)}
              >
                <option value="PHONE">Direct Telephone / Paging (Recommended for Panic Values)</option>
                <option value="IN_APP">In-Person at Clinic Desk</option>
                <option value="SMS">Urgent SMS Notification with Callback</option>
              </Form.Select>
            </div>

            <div className="mb-3">
              <Form.Label htmlFor="readback-text" className="small fw-semibold">Mandatory Read-Back Confirmation Text *</Form.Label>
              <Form.Control
                id="readback-text"
                as="textarea"
                rows={3}
                value={readBackText}
                onChange={(e) => setReadBackText(e.target.value)}
                placeholder="Doctor/Nurse name and verbatim read-back confirmation…"
                required
              />
              <Form.Text className="text-muted small">
                Document that the attending clinician read back the patient name, analyte, and value.
              </Form.Text>
            </div>

            <div className="p-3 bg-light rounded border">
              <div className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="confirm-read-back"
                  checked={readBackConfirmed}
                  onChange={(e) => setReadBackConfirmed(e.target.checked)}
                  required
                />
                <label className="form-check-label small fw-bold text-dark" htmlFor="confirm-read-back">
                  I certify that a verbal read-back was conducted and verified with the ordering clinician.
                </label>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedAlert(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              disabled={acking || !readBackConfirmed}
            >
              {acking ? "Documenting…" : "✓ Confirm Read-Back & Close Alert"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}
