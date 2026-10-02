import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";
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
import {
  labApi,
  type WorklistItem,
  type LabResultValue,
  type LabInstrument,
  type LabTest,
} from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

export function ResultEntryPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();

  const orderId = searchParams.get("orderId");
  const itemId = searchParams.get("itemId");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [order, setOrder] = useState<any | null>(null);
  const [orderItem, setOrderItem] = useState<any | null>(null);
  const [testDetails, setTestDetails] = useState<LabTest | null>(null);
  const [instruments, setInstruments] = useState<LabInstrument[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<string>("");

  // Result row values: map analyteId -> { numeric, text, flag, delta }
  const [resultsMap, setResultsMap] = useState<
    Record<
      string,
      {
        value_numeric?: number | null;
        value_text?: string | null;
        flag?: "LL" | "L" | "N" | "H" | "HH" | "A" | null;
        instrument_id?: string;
      }
    >
  >({});

  // Existing results (if already entered/verified)
  const [existingResults, setExistingResults] = useState<LabResultValue[]>([]);

  // Amendment modal state
  const [isAmendModalOpen, setIsAmendModalOpen] = useState(false);
  const [amendTargetResult, setAmendTargetResult] = useState<LabResultValue | null>(null);
  const [amendNewValue, setAmendNewValue] = useState("");
  const [amendReason, setAmendReason] = useState("");
  const [amendSubmitting, setAmendSubmitting] = useState(false);

  // Confidential reason gate
  const [confidentialReason, setConfidentialReason] = useState<string>("");
  const [isConfidentialUnlocked, setIsConfidentialUnlocked] = useState(false);

  // Load Order & Item
  useEffect(() => {
    if (!orderId || !itemId) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [ord, insts] = await Promise.all([
          labApi.getOrder(orderId),
          labApi.listInstruments(),
        ]);
        setOrder(ord);
        setInstruments(insts);

        const currentItem = ord.items?.find((i: any) => i.id === itemId);
        setOrderItem(currentItem);

        if (currentItem) {
          const tDetail = await labApi.getTest(currentItem.test_id);
          setTestDetails(tDetail);

          // Fetch any existing results
          try {
            const exRes = await labApi.getItemResults(orderId, itemId, confidentialReason || undefined);
            setExistingResults(exRes);

            // Populate initial map
            const initialMap: Record<string, any> = {};
            exRes.forEach((r) => {
              initialMap[r.analyte_id] = {
                value_numeric: r.value_numeric,
                value_text: r.value_text,
                flag: r.flag,
                instrument_id: r.instrument_id,
              };
            });
            setResultsMap(initialMap);
          } catch {
            // New results, none entered yet
          }
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load order for result entry");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orderId, itemId, isConfidentialUnlocked]);

  // Compute Auto-Flag for an analyte
  const calculateAutoFlag = (analyte: any, valNum: number | null): "LL" | "L" | "N" | "H" | "HH" | null => {
    if (valNum === null || isNaN(valNum)) return null;
    const ref = analyte.reference_range;
    if (!ref) return null;

    if (ref.critical_low !== undefined && ref.critical_low !== null && valNum <= Number(ref.critical_low)) {
      return "LL";
    }
    if (ref.critical_high !== undefined && ref.critical_high !== null && valNum >= Number(ref.critical_high)) {
      return "HH";
    }
    if (ref.normal_min !== undefined && ref.normal_min !== null && valNum < Number(ref.normal_min)) {
      return "L";
    }
    if (ref.normal_max !== undefined && ref.normal_max !== null && valNum > Number(ref.normal_max)) {
      return "H";
    }
    return "N";
  };

  // Handle Numeric Input Change
  const handleNumericChange = (analyte: any, textVal: string) => {
    const num = textVal.trim() === "" ? null : Number(textVal);
    const flag = calculateAutoFlag(analyte, num);

    setResultsMap((prev) => ({
      ...prev,
      [analyte.id]: {
        ...prev[analyte.id],
        value_numeric: num,
        value_text: null,
        flag,
        instrument_id: selectedInstrument || undefined,
      },
    }));
  };

  // Handle Text Input Change
  const handleTextChange = (analyteId: string, textVal: string) => {
    setResultsMap((prev) => ({
      ...prev,
      [analyteId]: {
        ...prev[analyteId],
        value_numeric: null,
        value_text: textVal,
        flag: textVal.toUpperCase().includes("POSITIVE") || textVal.toUpperCase().includes("REACTIVE") ? "A" : "N",
        instrument_id: selectedInstrument || undefined,
      },
    }));
  };

  // Save / Submit Results
  const handleSubmitResults = async (asDraft = false) => {
    if (!orderId || !itemId || !testDetails) return;

    const analytesToSubmit = (testDetails.analytes || []).map((a) => {
      const entry = resultsMap[a.id];
      return {
        analyteId: a.id,
        unit: a.default_unit,
        valueNum: entry?.value_numeric ?? undefined,
        valueText: entry?.value_text ?? undefined,
        instrumentId: selectedInstrument || undefined,
      };
    });

    if (analytesToSubmit.length === 0) {
      alert("No analytes found for this test.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await labApi.enterResults(orderId, itemId, {
        results: analytesToSubmit,
      });

      setSuccessMsg(
        asDraft
          ? "Draft results saved successfully."
          : "Results entered and flags generated. Order item advanced to RESULTED stage."
      );

      // Reload results
      const updated = await labApi.getItemResults(orderId, itemId);
      setExistingResults(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to submit laboratory results");
    } finally {
      setLoading(false);
    }
  };

  // Handle Amend Result (AC-11)
  const handleAmendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amendTargetResult || !amendReason.trim() || !amendNewValue.trim()) {
      alert("Please provide the new value and a mandatory amendment reason.");
      return;
    }

    try {
      setAmendSubmitting(true);
      await labApi.amendResult(amendTargetResult.id, {
        newValue: amendNewValue.trim(),
        reason: amendReason.trim(),
      });

      setIsAmendModalOpen(false);
      setAmendTargetResult(null);
      setAmendNewValue("");
      setAmendReason("");
      setSuccessMsg("Result successfully amended with auditable redline trail (AC-11).");

      if (orderId && itemId) {
        const updated = await labApi.getItemResults(orderId, itemId);
        setExistingResults(updated);
      }
    } catch (err: any) {
      alert(`Amendment error: ${err.message}`);
    } finally {
      setAmendSubmitting(false);
    }
  };

  if (!orderId || !itemId) {
    return (
      <div className="container-fluid py-4 px-4">
        <Alert variant="info">
          <h5>No Order Item Selected</h5>
          <p>Please select a laboratory order item from the worklist to enter results.</p>
          <Link to="/laboratory/worklist" className="btn btn-primary btn-sm">
            Go to Laboratory Worklist
          </Link>
        </Alert>
      </div>
    );
  }

  const isVerified = existingResults.some((r) => r.status === "VERIFIED" || r.status === "AMENDED");

  return (
    <div className="container-fluid py-3 px-4">
      {/* Top Breadcrumb & Actions */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 small">
              <li className="breadcrumb-item">
                <Link to="/laboratory/worklist">Worklist</Link>
              </li>
              <li className="breadcrumb-item active" aria-current="page">
                Result Entry
              </li>
            </ol>
          </nav>
          <h2 className="h4 fw-bold mb-0 d-flex align-items-center gap-2">
            <span>📝</span> Analytical Result Entry &amp; Auto-Flagging
          </h2>
        </div>
        <div className="d-flex gap-2">
          <Link to="/laboratory/worklist" className="btn btn-outline-secondary btn-sm">
            ← Back to Worklist
          </Link>
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

      {/* Patient & Test Header Card */}
      {order && (
        <div className="card shadow-sm mb-3">
          <div className="card-body p-3">
            <div className="row g-3 align-items-center">
              <div className="col-12 col-md-4 border-end">
                <div className="small text-muted text-uppercase fw-semibold">Patient Information</div>
                <div className="h6 fw-bold mb-0">
                  {order.last_name}, {order.first_name}
                </div>
                <div className="small text-muted">
                  MRN: <strong>{order.mrn || "Walk-In"}</strong> • {order.gender}
                </div>
              </div>
              <div className="col-12 col-md-4 border-end">
                <div className="small text-muted text-uppercase fw-semibold">Order &amp; Specimen</div>
                <div className="h6 fw-bold mb-0 text-primary">{order.order_no}</div>
                <div className="small text-muted">
                  Priority:{" "}
                  <span
                    className={`badge ${
                      order.priority === "STAT"
                        ? "bg-danger"
                        : order.priority === "URGENT"
                        ? "bg-warning text-dark"
                        : "bg-secondary"
                    }`}
                  >
                    {order.priority}
                  </span>
                </div>
              </div>
              <div className="col-12 col-md-4">
                <div className="small text-muted text-uppercase fw-semibold">Test Details</div>
                <div className="h6 fw-bold mb-0">{testDetails?.name}</div>
                <div className="small text-muted font-monospace">{testDetails?.code}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confidentiality Gate if flagged */}
      {testDetails?.is_confidential && !isConfidentialUnlocked && (
        <div className="card shadow-sm border-warning mb-3">
          <div className="card-body p-4 bg-warning-subtle text-center">
            <h5 className="fw-bold text-warning-emphasis">🔒 Confidential Laboratory Test</h5>
            <p className="small text-muted max-w-md mx-auto mb-3">
              This test is marked confidential. Access is logged. Please provide clinical justification to view and record results.
            </p>
            <div className="d-inline-flex gap-2">
              <Form.Control
                size="sm"
                placeholder="Reason for viewing confidential test…"
                value={confidentialReason}
                onChange={(e) => setConfidentialReason(e.target.value)}
                style={{ width: "300px" }}
              />
              <Button
                size="sm"
                variant="warning"
                onClick={() => {
                  if (confidentialReason.trim()) setIsConfidentialUnlocked(true);
                  else alert("Reason required.");
                }}
              >
                Unlock Test
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Analytical Entry Grid */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-white py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div className="d-flex align-items-center gap-3">
            <h5 className="h6 fw-bold mb-0">Analytes &amp; Reference Ranges</h5>
            {isVerified && (
              <span className="badge bg-success-subtle text-success border border-success">
                ✓ VERIFIED (Immutable — AC-11 Amendment Mode)
              </span>
            )}
          </div>

          {/* Instrument Selector */}
          <div className="d-flex align-items-center gap-2">
            <span className="small text-muted fw-semibold">Analyzer:</span>
            <Form.Select
              size="sm"
              style={{ width: "220px" }}
              value={selectedInstrument}
              onChange={(e) => setSelectedInstrument(e.target.value)}
              disabled={isVerified}
            >
              <option value="">Manual Entry (No Instrument)</option>
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Form.Select>
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
            <thead className="table-light text-muted small text-uppercase">
              <tr>
                <th style={{ width: "20%" }}>Analyte</th>
                <th style={{ width: "15%" }}>Result Value</th>
                <th style={{ width: "10%" }}>Unit</th>
                <th style={{ width: "15%" }}>Normal Range</th>
                <th style={{ width: "15%" }}>Critical Limits</th>
                <th style={{ width: "10%" }}>Flag</th>
                <th style={{ width: "15%" }}>Delta Check</th>
              </tr>
            </thead>
            <tbody>
              {testDetails?.analytes?.map((analyte) => {
                const existing = existingResults.find((r) => r.analyte_id === analyte.id);
                const currentEntry = resultsMap[analyte.id] || {};
                const flag = existing?.flag || currentEntry.flag;
                const isCalculated = analyte.is_calculated;

                return (
                  <tr key={analyte.id}>
                    {/* Analyte Name */}
                    <td>
                      <div className="fw-semibold">{analyte.name}</div>
                      <div className="small text-muted font-monospace">{analyte.code}</div>
                      {isCalculated && (
                        <span className="badge bg-info-subtle text-info mt-1" style={{ fontSize: "0.7rem" }}>
                          Formula: {analyte.calculation_formula || "Auto-calculated"}
                        </span>
                      )}
                    </td>

                    {/* Result Value Input */}
                    <td>
                      {isVerified ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="fw-bold font-monospace fs-6">
                            {existing?.value_numeric ?? existing?.value_text ?? "—"}
                          </span>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem" }}
                            onClick={() => {
                              setAmendTargetResult(existing || null);
                              setAmendNewValue(String(existing?.value_numeric ?? existing?.value_text ?? ""));
                              setAmendReason("");
                              setIsAmendModalOpen(true);
                            }}
                          >
                            ✏️ Amend (AC-11)
                          </Button>
                        </div>
                      ) : (
                        <Form.Control
                          type={isCalculated ? "text" : "number"}
                          step="any"
                          size="sm"
                          placeholder={isCalculated ? "Auto-computed" : "Enter value"}
                          disabled={isCalculated}
                          value={
                            currentEntry.value_numeric !== undefined && currentEntry.value_numeric !== null
                              ? currentEntry.value_numeric
                              : currentEntry.value_text || ""
                          }
                          onChange={(e) => {
                            if (!isCalculated) {
                              handleNumericChange(analyte, e.target.value);
                            }
                          }}
                          className={`font-monospace ${
                            flag === "HH" || flag === "LL" ? "border-danger bg-danger-subtle fw-bold" : ""
                          }`}
                        />
                      )}
                    </td>

                    {/* Unit */}
                    <td>
                      <span className="font-monospace text-muted">{analyte.default_unit}</span>
                    </td>

                    {/* Normal Range */}
                    <td>
                      <span className="small text-dark">
                        {analyte.reference_range?.normal_min !== undefined &&
                        analyte.reference_range?.normal_max !== undefined
                          ? `${analyte.reference_range.normal_min} – ${analyte.reference_range.normal_max}`
                          : analyte.reference_range?.text_range || "N/A"}
                      </span>
                    </td>

                    {/* Critical Limits */}
                    <td>
                      <span className="small text-danger fw-semibold">
                        {analyte.reference_range?.critical_low !== undefined
                          ? `< ${analyte.reference_range.critical_low}`
                          : ""}
                        {analyte.reference_range?.critical_low !== undefined &&
                        analyte.reference_range?.critical_high !== undefined
                          ? " / "
                          : ""}
                        {analyte.reference_range?.critical_high !== undefined
                          ? `> ${analyte.reference_range.critical_high}`
                          : ""}
                      </span>
                    </td>

                    {/* Flag Badge */}
                    <td>
                      {flag === "HH" && (
                        <span className="badge bg-danger text-white fw-bold px-2 py-1 animate-pulse">
                          ⚡ HH (Critical High)
                        </span>
                      )}
                      {flag === "LL" && (
                        <span className="badge bg-danger text-white fw-bold px-2 py-1 animate-pulse">
                          ⚡ LL (Critical Low)
                        </span>
                      )}
                      {flag === "H" && <span className="badge bg-warning text-dark px-2 py-1">▲ H (High)</span>}
                      {flag === "L" && <span className="badge bg-warning text-dark px-2 py-1">▼ L (Low)</span>}
                      {flag === "N" && <span className="badge bg-success-subtle text-success px-2 py-1">Normal</span>}
                      {flag === "A" && <span className="badge bg-info text-white px-2 py-1">Abnormal</span>}
                      {!flag && <span className="text-muted small">—</span>}
                    </td>

                    {/* Delta Check */}
                    <td>
                      {existing?.delta_flag ? (
                        <span className="badge bg-warning text-dark" title={`Prev: ${existing.previous_value}`}>
                          ⚠️ Delta Alert (Prev: {existing.previous_value})
                        </span>
                      ) : (
                        <span className="small text-muted">No prior delta</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        {!isVerified && (
          <div className="card-footer bg-light p-3 d-flex justify-content-between align-items-center">
            <span className="small text-muted">
              Auto-flags are generated dynamically based on configured reference ranges and critical thresholds.
            </span>
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => handleSubmitResults(true)}
                disabled={loading}
              >
                💾 Save Draft
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSubmitResults(false)}
                disabled={loading}
              >
                {loading ? "Submitting…" : "✓ Submit for Verification"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Amendment Modal (AC-11) ─────────────────────────────────────────── */}
      <Modal show={isAmendModalOpen} onHide={() => setIsAmendModalOpen(false)}>
        <form onSubmit={handleAmendSubmit}>
          <Modal.Header closeButton>
            <Modal.Title className="h5 text-danger">⚠️ Amend Verified Result (AC-11)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Alert variant="warning" className="small">
              Verified results are immutable. Amending this result will preserve the original value, create a new
              amended record, record an audit event, and mark downstream reports as CORRECTED.
            </Alert>

            {amendTargetResult && (
              <div className="p-3 bg-light rounded border mb-3">
                <div className="small text-muted">Analyte</div>
                <div className="fw-bold">{amendTargetResult.analyte_name}</div>
                <div className="small text-muted">
                  Current Verified Value:{" "}
                  <strong>
                    {amendTargetResult.value_numeric ?? amendTargetResult.value_text}{" "}
                    {amendTargetResult.default_unit}
                  </strong>
                </div>
              </div>
            )}

            <div className="mb-3">
              <Form.Label className="small fw-semibold">New Corrected Value *</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter new value"
                value={amendNewValue}
                onChange={(e) => setAmendNewValue(e.target.value)}
                required
              />
            </div>

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Amendment Clinical Reason *</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="State why the result was amended (e.g. re-run on fresh sample, analytical dilution error, typo correction)…"
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                required
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsAmendModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" disabled={amendSubmitting}>
              {amendSubmitting ? "Amending…" : "Commit Amendment (AC-11)"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}
