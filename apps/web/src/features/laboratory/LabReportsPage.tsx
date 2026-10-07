import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { Alert, Button } from "@clinic/ui";
import { labApi, type LabReport } from "./api.js";
import { LabReportPrintModal } from "./LabReportPrintModal.js";

export function LabReportsPage() {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail / Print Modal
  const [selectedReport, setSelectedReport] = useState<LabReport | null>(null);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      // In a real scenario, we can pass orderId or list across tenant
      // We can fetch from worklist items that are RELEASED or fetch reports
      const worklist = await labApi.getWorklist({ status: "RELEASED" });
      const reportPromises = worklist.map(async (w) => {
        try {
          const list = await labApi.listReports(w.order_id);
          return list;
        } catch {
          return [];
        }
      });
      const nested = await Promise.all(reportPromises);
      const flattened = nested.flat();
      setReports(flattened);
    } catch (err: any) {
      setError(err?.message || "Failed to load released laboratory reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

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
                Official Reports
              </li>
            </ol>
          </nav>
          <h2 className="h4 fw-bold mb-0 d-flex align-items-center gap-2">
            <span>📜</span> Official Released Laboratory Reports (LAB-T8)
          </h2>
          <p className="text-muted small mb-0">
            Immutable document releases secured with SHA-256 integrity checksums. Versioned history (Preliminary → Final → Corrected).
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={loadReports}>
            🔄 Refresh
          </Button>
          <Link to="/laboratory/worklist" className="btn btn-outline-primary btn-sm">
            Go to Worklist →
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="mb-3">
          {error}
        </Alert>
      )}

      {/* Reports Table */}
      <div className="card shadow-sm">
        <div className="card-header bg-white py-3">
          <h5 className="h6 fw-bold mb-0">Released Reports ({reports.length})</h5>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
            <thead className="table-light text-muted small text-uppercase">
              <tr>
                <th style={{ width: "90px" }}>Version</th>
                <th>Order Number</th>
                <th>Status</th>
                <th>Issued At</th>
                <th>Issued By</th>
                <th>SHA-256 Integrity Hash</th>
                <th className="text-end" style={{ minWidth: "140px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Loading released reports…
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-5 text-muted">
                    <div className="mb-2" style={{ fontSize: "2rem" }}>📄</div>
                    <h6>No Released Reports Yet</h6>
                    <p className="small mb-0">
                      Reports will appear here once verified order results are officially released.
                    </p>
                  </td>
                </tr>
              ) : (
                reports.map((rep) => {
                  const isCorrected = rep.status === "CORRECTED";

                  return (
                    <tr key={rep.id} className={isCorrected ? "table-warning" : ""}>
                      {/* Version */}
                      <td>
                        <span className="badge bg-secondary font-monospace">
                          v{rep.version}
                        </span>
                      </td>

                      {/* Order Number */}
                      <td className="fw-semibold text-primary">
                        {rep.report_data?.order?.order_no || rep.order_id.slice(0, 8)}
                      </td>

                      {/* Status */}
                      <td>
                        <span
                          className={`badge ${
                            rep.status === "FINAL"
                              ? "bg-success"
                              : rep.status === "CORRECTED"
                              ? "bg-warning text-dark"
                              : "bg-info text-white"
                          }`}
                        >
                          {rep.status}
                        </span>
                      </td>

                      {/* Issued At */}
                      <td>{new Date(rep.issued_at).toLocaleString()}</td>

                      {/* Issued By */}
                      <td>{rep.issued_by_name || "Pathologist"}</td>

                      {/* SHA-256 Hash */}
                      <td>
                        <span
                          className="font-monospace text-muted small bg-light p-1 rounded border text-truncate d-inline-block"
                          style={{ maxWidth: "220px" }}
                          title={rep.sha256_hash ?? rep.report_hash}
                        >
                          🔒 {rep.sha256_hash ?? rep.report_hash}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => setSelectedReport(rep)}
                        >
                          👁️ View Report
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

      {/* ── True Vector PDF Report Document Modal ─────────────────────────────── */}
      <LabReportPrintModal
        isOpen={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        report={selectedReport}
      />
    </div>
  );
}
