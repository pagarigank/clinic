import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  StatusPill,
} from "@clinic/ui";
import { labApi, type WorklistItem, type LabResultValue } from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export function VerificationQueuePage() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Review modal state
  const [selectedItem, setSelectedItem] = useState<WorklistItem | null>(null);
  const [itemResults, setItemResults] = useState<LabResultValue[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Release Report modal state
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [reportRemarks, setReportRemarks] = useState("");
  const [releasing, setReleasing] = useState(false);

  const loadQueue = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch worklist items at RESULTED or VERIFIED status
      const res = await labApi.getWorklist({ status: "RESULTED" });
      setItems(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load verification queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const openReviewModal = async (item: WorklistItem) => {
    setSelectedItem(item);
    setItemResults([]);
    try {
      setLoadingResults(true);
      const res = await labApi.getItemResults(item.order_id, item.item_id);
      setItemResults(res);
    } catch (err: any) {
      setError(`Failed to load results: ${err.message}`);
    } finally {
      setLoadingResults(false);
    }
  };

  // Check if current user is the encoder of ANY of the results (AC-17 Segregation of Duties)
  const isEncoder = itemResults.some((r) => r.entered_by === session?.userId);

  const handleVerify = async (resultId: string) => {
    try {
      setVerifying(true);
      setError(null);
      await labApi.verifyResult(resultId);
      setSuccessMsg("Result verified successfully.");

      // Refresh results in modal
      if (selectedItem) {
        const res = await labApi.getItemResults(selectedItem.order_id, selectedItem.item_id);
        setItemResults(res);
      }
      await loadQueue();
    } catch (err: any) {
      setError(err?.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyAll = async () => {
    if (!selectedItem) return;
    try {
      setVerifying(true);
      setError(null);
      // Only ENTERED is verifiable. The lab_results CHECK constraint permits exactly
      // ENTERED / VERIFIED / AMENDED, so the previous gate on "DRAFT" || "PRELIMINARY"
      // never matched anything: the loop body was skipped for every result, and the
      // handler still reported "All results verified successfully." A verifier could
      // click it, see a success message, and leave every result unverified — which is
      // precisely the outcome AC-17 exists to make impossible.
      const pending = itemResults.filter((r) => r.status === "ENTERED");
      if (pending.length === 0) {
        setError("There are no results awaiting verification on this item.");
        return;
      }
      for (const res of pending) {
        await labApi.verifyResult(res.id);
      }
      setSuccessMsg(`Verified ${pending.length} result${pending.length === 1 ? "" : "s"}.`);
      const res = await labApi.getItemResults(selectedItem.order_id, selectedItem.item_id);
      setItemResults(res);
      await loadQueue();
    } catch (err: any) {
      setError(err?.message || "Batch verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleReleaseReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    try {
      setReleasing(true);
      await labApi.releaseReport(selectedItem.order_id, {
        notes: reportRemarks || undefined,
      });
      setIsReleaseModalOpen(false);
      setSelectedItem(null);
      setSuccessMsg("Laboratory report released with SHA-256 integrity hash.");
      await loadQueue();
      navigate("/laboratory/reports");
    } catch (err: any) {
      alert(`Report release error: ${err.message}`);
    } finally {
      setReleasing(false);
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
                Verification Queue
              </li>
            </ol>
          </nav>
          <h2 className="h4 fw-bold mb-0 d-flex align-items-center gap-2">
            <span>🛡️</span> Laboratory Verification Queue (AC-17)
          </h2>
          <p className="text-muted small mb-0">
            Segregation of Duties gate: result encoders cannot verify their own results. Pathologist / supervisor approval.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={loadQueue}>
            🔄 Refresh Queue
          </Button>
          <Link to="/laboratory/critical-alerts" className="btn btn-outline-danger btn-sm">
            ⚡ Critical Alerts Inbox
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

      {/* Queue Table */}
      <div className="card shadow-sm">
        <div className="card-header bg-white py-3">
          <h5 className="h6 fw-bold mb-0">
            Tests Awaiting Verification ({items.length})
          </h5>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
            <thead className="table-light text-muted small text-uppercase">
              <tr>
                <th style={{ width: "110px" }}>Priority</th>
                <th>Order / Accession</th>
                <th>Patient</th>
                <th>Test / Panel</th>
                <th>Specimen</th>
                <th>Status</th>
                <th className="text-end" style={{ minWidth: "150px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Loading verification queue…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    <div className="mb-2" style={{ fontSize: "2rem" }}>✅</div>
                    <h6>Verification Queue is Clean</h6>
                    <p className="small mb-0">No laboratory results are currently pending verification.</p>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isStat = item.priority === "STAT";
                  return (
                    <tr key={item.item_id} className={isStat ? "table-danger" : ""}>
                      {/* Priority */}
                      <td>
                        {isStat ? (
                          <span className="badge bg-danger text-white fw-bold px-2 py-1">
                            ⚡ STAT
                          </span>
                        ) : (
                          <span className="badge bg-secondary-subtle text-secondary px-2 py-1">
                            {item.priority}
                          </span>
                        )}
                      </td>

                      {/* Order & Accession */}
                      <td>
                        <div className="fw-semibold text-primary">{item.order_no}</div>
                        <div className="small font-monospace text-muted">{item.accession_no}</div>
                      </td>

                      {/* Patient */}
                      <td>
                        <div className="fw-semibold">
                          {item.family_name}, {item.given_name}
                        </div>
                        <div className="small text-muted">MRN: {item.mrn || "Walk-In"}</div>
                      </td>

                      {/* Test */}
                      <td>
                        <div className="fw-semibold">{item.test_name}</div>
                        <div className="small text-muted font-monospace">{item.test_code}</div>
                      </td>

                      {/* Specimen */}
                      <td>
                        <div>{item.specimen_type_name || "Blood"}</div>
                        <div className="small text-muted">Top: {item.tube_top_color || "Standard"}</div>
                      </td>

                      {/* Status */}
                      <td>
                        <StatusPill tone="pending" label={item.item_status} />
                      </td>

                      {/* Actions */}
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openReviewModal(item)}
                        >
                          🔍 Review &amp; Verify
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Review & Verification Modal ────────────────────────────────────── */}
      <Modal show={!!selectedItem} onHide={() => setSelectedItem(null)} size="xl">
        <Modal.Header closeButton>
          <Modal.Title className="h5 d-flex align-items-center gap-2">
            <span>🛡️</span> Result Verification &amp; Approval
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedItem && (
            <div className="p-3 bg-light rounded border mb-3">
              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <div className="small text-muted">Patient:</div>
                  <div className="fw-bold">
                    {selectedItem.family_name}, {selectedItem.given_name} (MRN: {selectedItem.mrn || "N/A"})
                  </div>
                </div>
                <div className="col-12 col-md-4">
                  <div className="small text-muted">Order &amp; Test:</div>
                  <div className="fw-bold text-primary">
                    {selectedItem.order_no} — {selectedItem.test_name}
                  </div>
                </div>
                <div className="col-12 col-md-4">
                  <div className="small text-muted">Accession:</div>
                  <div className="fw-bold font-monospace">
                    🏷️ {selectedItem.accession_no || "N/A"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AC-17 Segregation of Duties Banner */}
          {isEncoder && (
            <Alert variant="danger" className="mb-3">
              <div className="d-flex align-items-start gap-2">
                <span className="fs-5">⛔</span>
                <div>
                  <strong className="d-block">Encoder cannot verify own result (AC-17 Segregation of Duties)</strong>
                  <span className="small">
                    You entered one or more of the results below. Per clinic policy and laboratory accreditation standards,
                    a different laboratory professional, medical technologist, or pathologist must verify and sign off on these results.
                  </span>
                </div>
              </div>
            </Alert>
          )}

          {/* Analytes Verification Table */}
          <div className="table-responsive border rounded mb-3">
            <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
              <thead className="table-light text-muted small text-uppercase">
                <tr>
                  <th>Analyte</th>
                  <th>Observed Value</th>
                  <th>Unit</th>
                  <th>Flag</th>
                  <th>Status</th>
                  <th>Entered By</th>
                  <th className="text-end">Verify</th>
                </tr>
              </thead>
              <tbody>
                {loadingResults ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      Loading analyte results…
                    </td>
                  </tr>
                ) : itemResults.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      No results entered yet for this item.
                    </td>
                  </tr>
                ) : (
                  itemResults.map((r) => {
                    const ownResult = r.entered_by === session?.userId;
                    const isAlreadyVerified = r.status === "VERIFIED" || r.status === "AMENDED";

                    return (
                      <tr key={r.id}>
                        {/* Analyte */}
                        <td>
                          <div className="fw-semibold">{r.analyte_name}</div>
                          <div className="small text-muted font-monospace">{r.analyte_code}</div>
                        </td>

                        {/* Value */}
                        <td>
                          <span className="fw-bold font-monospace fs-6">
                            {r.value_numeric ?? r.value_text ?? "—"}
                          </span>
                        </td>

                        {/* Unit */}
                        <td>
                          <span className="font-monospace text-muted">{r.default_unit}</span>
                        </td>

                        {/* Flag */}
                        <td>
                          {r.flag === "HH" && <span className="badge bg-danger text-white">⚡ HH (Critical)</span>}
                          {r.flag === "LL" && <span className="badge bg-danger text-white">⚡ LL (Critical)</span>}
                          {r.flag === "H" && <span className="badge bg-warning text-dark">▲ H (High)</span>}
                          {r.flag === "L" && <span className="badge bg-warning text-dark">▼ L (Low)</span>}
                          {r.flag === "N" && <span className="badge bg-success-subtle text-success">Normal</span>}
                          {r.flag === "A" && <span className="badge bg-info text-white">Abnormal</span>}
                          {!r.flag && <span className="text-muted">—</span>}
                        </td>

                        {/* Status */}
                        <td>
                          <span
                            className={`badge ${
                              isAlreadyVerified
                                ? "bg-success"
                                : // ENTERED is the only pre-verification status the
                                  // lab_results CHECK constraint allows; "DRAFT" here
                                  // could never match and everything pending fell
                                  // through to the warning colour.
                                  r.status === "ENTERED"
                                ? "bg-warning text-dark"
                                : "bg-secondary"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>

                        {/* Entered By */}
                        <td>
                          <div>{r.entered_by_name || "Encoder"}</div>
                          {ownResult && (
                            <span className="badge bg-danger-subtle text-danger" style={{ fontSize: "0.7rem" }}>
                              You (Encoder)
                            </span>
                          )}
                        </td>

                        {/* Verify Button */}
                        <td className="text-end">
                          {isAlreadyVerified ? (
                            <span className="text-success small fw-semibold">✓ Verified</span>
                          ) : (
                            <Button
                              size="sm"
                              variant={ownResult ? "outline-secondary" : "success"}
                              disabled={ownResult || verifying}
                              onClick={() => handleVerify(r.id)}
                              title={
                                ownResult
                                  ? "Encoder cannot verify own result (AC-17)"
                                  : "Approve & verify result"
                              }
                            >
                              {ownResult ? "⛔ SoD Blocked" : "Verify"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <Button variant="secondary" onClick={() => setSelectedItem(null)}>
            Close
          </Button>

          <div className="d-flex gap-2">
            <Button
              variant="success"
              disabled={isEncoder || verifying || itemResults.length === 0}
              onClick={handleVerifyAll}
              title={isEncoder ? "Cannot verify results entered by yourself" : "Verify all pending results"}
            >
              {isEncoder ? "⛔ Verification Blocked (AC-17)" : "✓ Verify All Analytes"}
            </Button>

            {itemResults.every((r) => r.status === "VERIFIED" || r.status === "AMENDED") && (
              <Button
                variant="primary"
                onClick={() => setIsReleaseModalOpen(true)}
              >
                📜 Release Official Report →
              </Button>
            )}
          </div>
        </Modal.Footer>
      </Modal>

      {/* ── Release Report Modal ────────────────────────────────────────────── */}
      <Modal show={isReleaseModalOpen} onHide={() => setIsReleaseModalOpen(false)}>
        <form onSubmit={handleReleaseReport}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">📜 Release Laboratory Report</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Alert variant="info" className="small">
              Releasing this report generates an official immutable document version and calculates a SHA-256
              cryptographic integrity checksum per compliance requirements.
            </Alert>

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Pathologist / Lab Remarks (Optional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Clinical correlation advised, repeated for verification…"
                value={reportRemarks}
                onChange={(e) => setReportRemarks(e.target.value)}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsReleaseModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={releasing}>
              {releasing ? "Releasing Report…" : "Sign & Release Report"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}
