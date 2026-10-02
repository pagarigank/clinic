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
import {
  labApi,
  type LabQcMaterial,
  type LabQcRun,
  type LabInstrument,
  type LabTest,
} from "./api.js";

export function LabQcPage() {
  const [materials, setMaterials] = useState<LabQcMaterial[]>([]);
  const [instruments, setInstruments] = useState<LabInstrument[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [runs, setRuns] = useState<LabQcRun[]>([]);

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New QC Run Modal
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [runAnalyteId, setRunAnalyteId] = useState("");
  const [runValue, setRunValue] = useState("");
  const [runTargetMean, setRunTargetMean] = useState("100");
  const [runTargetSd, setRunTargetSd] = useState("5");
  const [runCorrectiveAction, setRunCorrectiveAction] = useState("");
  const [submittingRun, setSubmittingRun] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [mats, insts, allTests, qRuns] = await Promise.all([
        labApi.listQcMaterials(),
        labApi.listInstruments(),
        labApi.listTests(),
        labApi.listQcRuns(),
      ]);
      setMaterials(mats);
      setInstruments(insts);
      setTests(allTests);
      setRuns(qRuns);

      if (mats.length > 0 && mats[0] && !selectedMaterialId) {
        setSelectedMaterialId(mats[0].id);
      }
      if (insts.length > 0 && insts[0] && !selectedInstrumentId) {
        setSelectedInstrumentId(insts[0].id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load QC data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRecordRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInstrumentId || !selectedMaterialId || !runAnalyteId || !runValue) {
      alert("Please fill in all required fields for the QC run.");
      return;
    }

    try {
      setSubmittingRun(true);
      const valNum = Number(runValue);
      const meanNum = Number(runTargetMean);
      const sdNum = Number(runTargetSd);

      await labApi.createQcRun({
        instrumentId: selectedInstrumentId,
        materialId: selectedMaterialId,
        results: [
          {
            analyteId: runAnalyteId,
            valueNum: valNum,
            targetMean: meanNum,
            targetSd: sdNum,
          },
        ],
        correctiveAction: runCorrectiveAction || undefined,
      });

      setIsNewRunModalOpen(false);
      setRunValue("");
      setRunCorrectiveAction("");
      setSuccessMsg("QC Run evaluated against Westgard rules and recorded successfully.");
      await loadData();
    } catch (err: any) {
      alert(`QC Run error: ${err.message}`);
    } finally {
      setSubmittingRun(false);
    }
  };

  // Extract all analyte results for Levey-Jennings plot
  const plotData: Array<{
    id: string;
    runAt: string;
    value: number;
    mean: number;
    sd: number;
    zScore: number;
    flags?: string;
    isAccepted: boolean;
  }> = [];

  runs.forEach((r) => {
    r.results?.forEach((res) => {
      plotData.push({
        id: res.id,
        runAt: r.run_at,
        value: res.value_num,
        mean: res.target_mean,
        sd: res.target_sd,
        zScore: res.z_score,
        flags: res.westgard_flags,
        isAccepted: res.is_accepted,
      });
    });
  });

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
                Quality Control
              </li>
            </ol>
          </nav>
          <h2 className="h4 fw-bold mb-0 d-flex align-items-center gap-2">
            <span>📈</span> Quality Control &amp; Levey–Jennings (LAB-T5)
          </h2>
          <p className="text-muted small mb-0">
            Statistical process control, Westgard multirule evaluation (1-2s, 1-3s, 2-2s, R-4s), and corrective action logs.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={loadData}>
            🔄 Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsNewRunModalOpen(true)}>
            ➕ Record QC Run
          </Button>
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

      {/* Analyzer & Material Filter Bar */}
      <div className="card shadow-sm mb-3">
        <div className="card-body p-3 bg-light">
          <div className="row g-3 align-items-center">
            <div className="col-12 col-md-5">
              <Form.Label className="small fw-semibold text-muted mb-1">Analyzer / Instrument</Form.Label>
              <Form.Select
                size="sm"
                value={selectedInstrumentId}
                onChange={(e) => setSelectedInstrumentId(e.target.value)}
              >
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.code}) — {i.section_name}
                  </option>
                ))}
              </Form.Select>
            </div>
            <div className="col-12 col-md-5">
              <Form.Label className="small fw-semibold text-muted mb-1">Control Material &amp; Lot</Form.Label>
              <Form.Select
                size="sm"
                value={selectedMaterialId}
                onChange={(e) => setSelectedMaterialId(e.target.value)}
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — Lot: {m.lot_no} (Exp: {m.expiry_date})
                  </option>
                ))}
              </Form.Select>
            </div>
            <div className="col-12 col-md-2 text-md-end pt-md-4">
              <span className="badge bg-success-subtle text-success border">
                ✓ Westgard Active
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Levey-Jennings Visual Chart Card */}
      <div className="card shadow-sm mb-4">
        <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
          <h5 className="h6 fw-bold mb-0">Levey–Jennings Control Chart (Z-Score Variance)</h5>
          <div className="small text-muted d-flex gap-3">
            <span><strong className="text-success">Green:</strong> Within ±2s</span>
            <span><strong className="text-warning">Yellow:</strong> 1-2s Warning</span>
            <span><strong className="text-danger">Red:</strong> 1-3s Rejection</span>
          </div>
        </div>
        <div className="card-body p-4">
          {plotData.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <div style={{ fontSize: "2rem" }}>📊</div>
              <h6>No QC Run Data Yet</h6>
              <p className="small mb-0">Record a QC run above to plot data on the Levey-Jennings chart.</p>
            </div>
          ) : (
            <div className="levey-jennings-container position-relative py-3" style={{ height: "260px" }}>
              {/* Reference Band Lines: +3SD, +2SD, +1SD, Mean, -1SD, -2SD, -3SD */}
              {[
                { label: "+3 SD (Reject)", top: "10%", color: "#dc3545", style: "dashed" },
                { label: "+2 SD (Warning)", top: "25%", color: "#ffc107", style: "dotted" },
                { label: "+1 SD", top: "40%", color: "#6c757d", style: "solid" },
                { label: "Target Mean (0)", top: "50%", color: "#198754", style: "solid", bold: true },
                { label: "-1 SD", top: "60%", color: "#6c757d", style: "solid" },
                { label: "-2 SD (Warning)", top: "75%", color: "#ffc107", style: "dotted" },
                { label: "-3 SD (Reject)", top: "90%", color: "#dc3545", style: "dashed" },
              ].map((line, idx) => (
                <div
                  key={idx}
                  className="position-absolute w-100 d-flex align-items-center"
                  style={{
                    top: line.top,
                    left: 0,
                    borderBottom: `1px ${line.style} ${line.color}`,
                    opacity: line.bold ? 0.9 : 0.6,
                    height: "1px",
                  }}
                >
                  <span
                    className="position-absolute start-0 bg-white px-1 font-monospace"
                    style={{
                      fontSize: "0.68rem",
                      color: line.color,
                      transform: "translateY(-50%)",
                      fontWeight: line.bold ? 700 : 500,
                    }}
                  >
                    {line.label}
                  </span>
                </div>
              ))}

              {/* Data points */}
              <div
                className="position-absolute h-100 d-flex align-items-center justify-content-around"
                style={{ left: "100px", right: "20px", top: 0 }}
              >
                {plotData.map((pt, idx) => {
                  // Map z-score (-3.5 to +3.5) into percentage height (0% to 100%)
                  // z = +3 -> top: 10%
                  // z = 0  -> top: 50%
                  // z = -3 -> top: 90%
                  const clampedZ = Math.max(-3.5, Math.min(3.5, pt.zScore));
                  const topPercent = 50 - (clampedZ / 3.0) * 40;

                  const isReject = !pt.isAccepted || Math.abs(pt.zScore) >= 3;
                  const isWarn = Math.abs(pt.zScore) >= 2 && !isReject;

                  return (
                    <div
                      key={pt.id || idx}
                      className="position-relative d-flex flex-column align-items-center"
                      style={{ height: "100%", width: "40px" }}
                    >
                      <div
                        className="rounded-circle shadow-sm"
                        style={{
                          position: "absolute",
                          top: `${topPercent}%`,
                          transform: "translate(-50%, -50%)",
                          width: "14px",
                          height: "14px",
                          backgroundColor: isReject ? "#dc3545" : isWarn ? "#ffc107" : "#198754",
                          border: "2px solid #fff",
                          cursor: "pointer",
                          zIndex: 2,
                        }}
                        title={`Run ${idx + 1}: Val=${pt.value}, Z=${pt.zScore} (${pt.flags || "OK"})`}
                      />
                      <span
                        className="position-absolute bottom-0 text-muted font-monospace"
                        style={{ fontSize: "0.68rem" }}
                      >
                        #{idx + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QC Runs Audit Table */}
      <div className="card shadow-sm">
        <div className="card-header bg-white py-3">
          <h5 className="h6 fw-bold mb-0">QC Run History &amp; Westgard Evaluations</h5>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
            <thead className="table-light text-muted small text-uppercase">
              <tr>
                <th>Run Date &amp; Time</th>
                <th>Analyzer</th>
                <th>Control Material</th>
                <th>Analyte</th>
                <th>Observed Value</th>
                <th>Target (Mean ± SD)</th>
                <th>Z-Score</th>
                <th>Westgard Rules</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    No QC runs recorded.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const res = r.results?.[0];
                  const isAccepted = r.status === "ACCEPTED";

                  return (
                    <tr key={r.id}>
                      <td>{new Date(r.run_at).toLocaleString()}</td>
                      <td>{r.instrument_name || "Analyzer"}</td>
                      <td>
                        {r.material_name} (Lot: {r.lot_no})
                      </td>
                      <td className="fw-semibold">{res?.analyte_name || "Control"}</td>
                      <td className="font-monospace fw-bold">{res?.value_num ?? "—"}</td>
                      <td className="small text-muted">
                        {res?.target_mean} ± {res?.target_sd}
                      </td>
                      <td className="font-monospace">
                        <span
                          className={`badge ${
                            Math.abs(res?.z_score || 0) >= 3
                              ? "bg-danger"
                              : Math.abs(res?.z_score || 0) >= 2
                              ? "bg-warning text-dark"
                              : "bg-light text-dark border"
                          }`}
                        >
                          {res?.z_score !== undefined ? `${res.z_score > 0 ? "+" : ""}${res.z_score}s` : "—"}
                        </span>
                      </td>
                      <td>
                        {res?.westgard_flags ? (
                          <span className="badge bg-danger-subtle text-danger">
                            ⚠️ {res.westgard_flags}
                          </span>
                        ) : (
                          <span className="badge bg-success-subtle text-success">
                            ✓ Passed All Rules
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${isAccepted ? "bg-success" : "bg-danger"}`}
                        >
                          {r.status}
                        </span>
                        {r.corrective_action && (
                          <div className="small text-muted mt-1 fst-italic">
                            Action: {r.corrective_action}
                          </div>
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

      {/* ── Modal: Record New QC Run ────────────────────────────────────────── */}
      <Modal show={isNewRunModalOpen} onHide={() => setIsNewRunModalOpen(false)}>
        <form onSubmit={handleRecordRun}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">➕ Record Quality Control (QC) Run</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="mb-3">
              <Form.Label className="small fw-semibold">Target Analyte *</Form.Label>
              <Form.Select
                value={runAnalyteId}
                onChange={(e) => setRunAnalyteId(e.target.value)}
                required
              >
                <option value="">Select analyte for control run…</option>
                {tests.flatMap((t) => t.analytes || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.code}) — {a.default_unit}
                  </option>
                ))}
              </Form.Select>
            </div>

            <div className="row g-2 mb-3">
              <div className="col-4">
                <Form.Label className="small fw-semibold">Observed Value *</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  placeholder="e.g. 102"
                  value={runValue}
                  onChange={(e) => setRunValue(e.target.value)}
                  required
                />
              </div>
              <div className="col-4">
                <Form.Label className="small fw-semibold">Target Mean *</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  value={runTargetMean}
                  onChange={(e) => setRunTargetMean(e.target.value)}
                  required
                />
              </div>
              <div className="col-4">
                <Form.Label className="small fw-semibold">Target SD (1s) *</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  value={runTargetSd}
                  onChange={(e) => setRunTargetSd(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Corrective Action (if violation occurs)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Recalibrated, reconstituted fresh control vial, cleaned optical flow cell…"
                value={runCorrectiveAction}
                onChange={(e) => setRunCorrectiveAction(e.target.value)}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsNewRunModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={submittingRun}>
              {submittingRun ? "Evaluating Rules…" : "Save & Evaluate (Westgard)"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}
