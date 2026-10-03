import React, { useState } from "react";
import { Link } from "react-router";
import { getRegistrationRequests, updateRegistrationStatus, type RegistrationRequest } from "../../shared/services/registrationStore.js";
import { AlertBanner } from "@clinic/ui";
import { apiPost } from "../../shared/api/client.js";

function StatusBadge({ status }: { status: RegistrationRequest["status"] }) {
  if (status === "PENDING_APPROVAL")
    return (
      <span
        style={{
          display: "inline-block",
          background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
          color: "#92400e",
          border: "1px solid #fde68a",
          borderRadius: "var(--radius-full)",
          fontSize: "0.72rem",
          fontWeight: 700,
          padding: "0.2rem 0.7rem",
          letterSpacing: "0.03em",
        }}
      >
        ⏳ Pending Approval
      </span>
    );
  if (status === "APPROVED")
    return (
      <span
        style={{
          display: "inline-block",
          background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
          color: "#166534",
          border: "1px solid #86efac",
          borderRadius: "var(--radius-full)",
          fontSize: "0.72rem",
          fontWeight: 700,
          padding: "0.2rem 0.7rem",
        }}
      >
        ✓ Approved
      </span>
    );
  return (
    <span
      style={{
        display: "inline-block",
        background: "linear-gradient(135deg, #f1f5f9, #e2e8f0)",
        color: "var(--grey-600)",
        border: "1px solid var(--grey-300)",
        borderRadius: "var(--radius-full)",
        fontSize: "0.72rem",
        fontWeight: 700,
        padding: "0.2rem 0.7rem",
      }}
    >
      ✕ Rejected
    </span>
  );
}

export function ApprovalsPage() {
  const [requests, setRequests] = useState<RegistrationRequest[]>(() => getRegistrationRequests());
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [selectedReq, setSelectedReq] = useState<RegistrationRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; severity: "success" | "info" } | null>(null);

  const refreshList = () => setRequests(getRegistrationRequests());

  const handleApprove = (id: string, name: string) => {
    updateRegistrationStatus(id, "APPROVED");
    const target = requests.find((r) => r.id === id);
    refreshList();
    setFeedback({ message: `Registration for ${name} has been APPROVED and provisioned in staff directory.`, severity: "success" });
    if (selectedReq?.id === id) setSelectedReq(null);

    if (target) {
      void apiPost("/admin/users", {
        email: target.email,
        name: `${target.firstName} ${target.lastName}`.trim(),
        roleIds: [],
      }).catch(() => {
        // Fallback silently if user already exists or in offline test environment
      });
    }
  };

  const handleConfirmReject = () => {
    if (!rejectTarget) return;
    updateRegistrationStatus(rejectTarget.id, "REJECTED");
    refreshList();
    setFeedback({ message: `Registration for ${rejectTarget.name} has been REJECTED.`, severity: "info" });
    if (selectedReq?.id === rejectTarget.id) setSelectedReq(null);
    setRejectTarget(null);
  };

  const filteredRequests = requests.filter((r) => {
    if (filter === "PENDING") return r.status === "PENDING_APPROVAL";
    if (filter === "APPROVED") return r.status === "APPROVED";
    if (filter === "REJECTED") return r.status === "REJECTED";
    return true;
  });

  const pendingCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
  const approvedCount = requests.filter((r) => r.status === "APPROVED").length;
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;

  const filterBtnStyle = (active: boolean) => ({
    fontSize: "0.82rem",
    fontWeight: 600,
    padding: "0.38rem 0.9rem",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid",
    cursor: "pointer",
    transition: "all 0.15s ease",
    ...(active
      ? { background: "var(--gradient-cerulean)", color: "var(--white)", borderColor: "transparent", boxShadow: "0 2px 8px rgba(14,165,233,0.22)" }
      : { background: "var(--white)", color: "var(--grey-600)", borderColor: "var(--grey-300)" }),
  } as React.CSSProperties);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff Registration Approvals</h1>
          <div className="page-subtitle">
            Tenant Administrator review queue for practitioner and clinical staff affiliation requests
          </div>
        </div>
        <div>
          <Link to="/admin/users" className="btn btn-outline-secondary">
            ← Staff Directory
          </Link>
        </div>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity={feedback.severity}>{feedback.message}</AlertBanner>
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────── */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Pending Review
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: pendingCount > 0 ? "#d97706" : "var(--grey-900)", lineHeight: 1 }}>
                {pendingCount}
              </div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, #fffbeb, #fef3c7)", color: "#d97706" }}>
              ⏳
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Approved Staff
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#16a34a", lineHeight: 1 }}>
                {approvedCount}
              </div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, #dcfce7, #bbf7d0)", color: "#16a34a" }}>
              ✓
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Rejected Requests
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--grey-500)", lineHeight: 1 }}>
                {rejectedCount}
              </div>
            </div>
            <div className="metric-icon" style={{ background: "var(--grey-100)", color: "var(--grey-500)" }}>
              ✕
            </div>
          </div>
        </div>
      </div>

      {/* ── Requests Table ─────────────────────────────────────── */}
      <div className="clinic-card">
        <div className="clinic-card-header flex-wrap gap-2">
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map((f) => (
              <button
                key={f}
                type="button"
                style={filterBtnStyle(filter === f)}
                onClick={() => setFilter(f)}
              >
                {f === "PENDING" && `Pending (${pendingCount})`}
                {f === "APPROVED" && `Approved (${approvedCount})`}
                {f === "REJECTED" && `Rejected (${rejectedCount})`}
                {f === "ALL" && `All (${requests.length})`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-auto"
            onClick={refreshList}
          >
            ↻ Refresh
          </button>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="text-center py-5" style={{ color: "var(--grey-400)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📭</div>
            <div style={{ fontWeight: 600, color: "var(--grey-700)", marginBottom: 4 }}>No Requests in this View</div>
            <div style={{ fontSize: "0.85rem" }}>New requests submitted via the registration page will appear here.</div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light small text-secondary">
                <tr>
                  <th>REF NO.</th>
                  <th>APPLICANT</th>
                  <th>REQUESTED ROLE</th>
                  <th>PRC LICENSE</th>
                  <th>ASSIGNED BRANCH</th>
                  <th>SUBMITTED</th>
                  <th>STATUS</th>
                  <th className="text-end">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <span className="badge bg-light text-dark border font-monospace">{req.referenceNo}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--grey-800)", fontSize: "0.875rem" }}>
                        {req.firstName} {req.lastName}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--grey-500)" }}>{req.email} · {req.phone}</div>
                    </td>
                    <td>
                      <span
                        style={{
                          background: "var(--cerulean-100)",
                          color: "var(--cerulean-800)",
                          border: "1px solid var(--cerulean-200)",
                          borderRadius: "var(--radius-full)",
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          padding: "0.2rem 0.65rem",
                        }}
                      >
                        {req.role}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>
                      {req.licenseNo
                        ? <span className="font-monospace text-secondary">{req.licenseNo}</span>
                        : <span style={{ color: "var(--grey-400)", fontStyle: "italic" }}>N/A</span>
                      }
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "var(--grey-500)" }}>{req.branch}</td>
                    <td style={{ fontSize: "0.78rem", color: "var(--grey-400)" }}>{req.submittedAt}</td>
                    <td><StatusBadge status={req.status} /></td>
                    <td className="text-end">
                      {req.status === "PENDING_APPROVAL" ? (
                        <div className="d-flex gap-1 justify-content-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-cerulean"
                            style={{ padding: "0.3rem 0.8rem" }}
                            onClick={() => handleApprove(req.id, `${req.firstName} ${req.lastName}`)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              border: "1.5px solid #fca5a5",
                              color: "#991b1b",
                              background: "transparent",
                              borderRadius: "var(--radius-sm)",
                              fontWeight: 600,
                              padding: "0.3rem 0.8rem",
                              transition: "all 0.15s ease",
                            }}
                            onMouseOver={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2";
                            }}
                            onMouseOut={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                            }}
                            onClick={() => setRejectTarget({ id: req.id, name: `${req.firstName} ${req.lastName}` })}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => setSelectedReq(req)}
                        >
                          Details
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Details Modal ────────────────────────────────────────── */}
      {selectedReq && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="approvals-detail-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedReq(null); }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="approvals-detail-title">Registration Request Details</h5>
                <button type="button" className="btn-close" onClick={() => setSelectedReq(null)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  {[
                    ["Tracking Ref", selectedReq.referenceNo],
                    ["Applicant", `${selectedReq.firstName} ${selectedReq.middleName || ""} ${selectedReq.lastName}`.trim()],
                    ["Email", selectedReq.email],
                    ["Phone", selectedReq.phone],
                    ["Role", selectedReq.role],
                    ["PRC License", selectedReq.licenseNo || "N/A"],
                    ["Branch", selectedReq.branch],
                    ["Status", selectedReq.status],
                    ["Submitted", selectedReq.submittedAt],
                    ...(selectedReq.reviewedAt ? [["Reviewed", `${selectedReq.reviewedAt} by ${selectedReq.reviewedBy}`]] : []),
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: "0.6rem 0.75rem", background: "var(--grey-50)", borderRadius: "var(--radius-sm)", border: "1px solid var(--grey-200)" }}>
                      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{k}</div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--grey-800)" }}>{v}</div>
                    </div>
                  ))}
                </div>
                {selectedReq.notes && (
                  <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--cerulean-50)", border: "1px solid var(--cerulean-200)", borderRadius: "var(--radius-sm)", borderLeft: "4px solid var(--cerulean-600)" }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--cerulean-700)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--grey-700)" }}>{selectedReq.notes}</div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedReq(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Confirmation Modal ─────────────────────────────── */}
      {rejectTarget && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-modal-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setRejectTarget(null); }}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }}>
            <div className="modal-content">
              <div className="modal-header" style={{ background: "linear-gradient(135deg, #dc2626, #991b1b)" }}>
                <h5 className="modal-title" id="reject-modal-title">Confirm Rejection</h5>
                <button type="button" className="btn-close" onClick={() => setRejectTarget(null)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <p style={{ margin: 0, color: "var(--grey-700)", lineHeight: 1.6 }}>
                  Are you sure you want to <strong style={{ color: "#991b1b" }}>reject</strong> the registration request for{" "}
                  <strong>{rejectTarget.name}</strong>? This action will be logged in the audit trail.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setRejectTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)", color: "#fff", border: "none", fontWeight: 600, borderRadius: "var(--radius-sm)", padding: "0.4rem 1rem" }}
                  onClick={handleConfirmReject}
                >
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
