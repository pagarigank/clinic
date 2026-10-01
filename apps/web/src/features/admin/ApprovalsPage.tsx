import React, { useState } from "react";
import { getRegistrationRequests, updateRegistrationStatus, type RegistrationRequest } from "../../shared/services/registrationStore.js";
import { AlertBanner } from "@clinic/ui";

export function ApprovalsPage() {
  const [requests, setRequests] = useState<RegistrationRequest[]>(() => getRegistrationRequests());
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [selectedReq, setSelectedReq] = useState<RegistrationRequest | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; severity: "success" | "info" } | null>(null);

  const refreshList = () => {
    setRequests(getRegistrationRequests());
  };

  const handleApprove = (id: string, name: string) => {
    updateRegistrationStatus(id, "APPROVED");
    refreshList();
    setFeedback({
      message: `Registration for ${name} has been APPROVED. Activation invite dispatched.`,
      severity: "success",
    });
    if (selectedReq?.id === id) {
      setSelectedReq(null);
    }
  };

  const handleReject = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to reject registration for ${name}?`)) {
      updateRegistrationStatus(id, "REJECTED");
      refreshList();
      setFeedback({
        message: `Registration for ${name} has been REJECTED.`,
        severity: "info",
      });
      if (selectedReq?.id === id) {
        setSelectedReq(null);
      }
    }
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff Registration Approvals</h1>
          <div className="page-subtitle">
            Tenant Administrator review queue for practitioner and clinical staff affiliation requests
          </div>
        </div>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity={feedback.severity}>{feedback.message}</AlertBanner>
        </div>
      )}

      {/* KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Pending Review</div>
              <div className="fs-3 fw-bold text-warning">{pendingCount}</div>
            </div>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "10px",
                backgroundColor: "#fef3c7",
                color: "#d97706",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              ⏳
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Approved Staff</div>
              <div className="fs-3 fw-bold text-success">{approvedCount}</div>
            </div>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "10px",
                backgroundColor: "#dcfce7",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              ✓
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Rejected Requests</div>
              <div className="fs-3 fw-bold text-secondary">{rejectedCount}</div>
            </div>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "10px",
                backgroundColor: "#f1f5f9",
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              ✕
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="clinic-card">
        <div className="clinic-card-header flex-wrap gap-2">
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              className={`btn ${filter === "PENDING" ? "btn-cerulean" : "btn-outline-secondary"}`}
              onClick={() => setFilter("PENDING")}
            >
              Pending Approval ({pendingCount})
            </button>
            <button
              type="button"
              className={`btn ${filter === "APPROVED" ? "btn-cerulean" : "btn-outline-secondary"}`}
              onClick={() => setFilter("APPROVED")}
            >
              Approved ({approvedCount})
            </button>
            <button
              type="button"
              className={`btn ${filter === "REJECTED" ? "btn-cerulean" : "btn-outline-secondary"}`}
              onClick={() => setFilter("REJECTED")}
            >
              Rejected ({rejectedCount})
            </button>
            <button
              type="button"
              className={`btn ${filter === "ALL" ? "btn-cerulean" : "btn-outline-secondary"}`}
              onClick={() => setFilter("ALL")}
            >
              All Requests ({requests.length})
            </button>
          </div>

          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={refreshList}
          >
            ↻ Refresh Queue
          </button>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <div style={{ fontSize: "2rem" }}>📭</div>
            <h5 className="mt-2">No Registration Requests in this View</h5>
            <p className="small mb-0">New requests submitted by staff on the registration page will appear here.</p>
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
                      <span className="badge bg-light text-dark border font-monospace">
                        {req.referenceNo}
                      </span>
                    </td>
                    <td>
                      <div className="fw-semibold text-dark">
                        {req.firstName} {req.lastName}
                      </div>
                      <div className="small text-muted">{req.email} · {req.phone}</div>
                    </td>
                    <td>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1">
                        {req.role}
                      </span>
                    </td>
                    <td className="small">
                      {req.licenseNo ? (
                        <span className="font-monospace text-secondary">{req.licenseNo}</span>
                      ) : (
                        <span className="text-muted italic">N/A</span>
                      )}
                    </td>
                    <td className="small text-secondary">{req.branch}</td>
                    <td className="small text-muted">{req.submittedAt}</td>
                    <td>
                      {req.status === "PENDING_APPROVAL" && (
                        <span className="badge bg-warning text-dark">
                          Pending Approval
                        </span>
                      )}
                      {req.status === "APPROVED" && (
                        <span className="badge bg-success">
                          Approved
                        </span>
                      )}
                      {req.status === "REJECTED" && (
                        <span className="badge bg-secondary">
                          Rejected
                        </span>
                      )}
                    </td>
                    <td className="text-end">
                      {req.status === "PENDING_APPROVAL" ? (
                        <div className="btn-group btn-group-sm">
                          <button
                            type="button"
                            className="btn btn-success"
                            onClick={() => handleApprove(req.id, `${req.firstName} ${req.lastName}`)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            onClick={() => handleReject(req.id, `${req.firstName} ${req.lastName}`)}
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

      {/* Details Modal */}
      {selectedReq && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Registration Request Details</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setSelectedReq(null)}
                />
              </div>
              <div className="modal-body small">
                <div className="mb-2"><strong>Tracking:</strong> {selectedReq.referenceNo}</div>
                <div className="mb-2"><strong>Name:</strong> {selectedReq.firstName} {selectedReq.middleName} {selectedReq.lastName}</div>
                <div className="mb-2"><strong>Email:</strong> {selectedReq.email}</div>
                <div className="mb-2"><strong>Phone:</strong> {selectedReq.phone}</div>
                <div className="mb-2"><strong>Role:</strong> {selectedReq.role}</div>
                {selectedReq.licenseNo && <div className="mb-2"><strong>PRC License:</strong> {selectedReq.licenseNo}</div>}
                <div className="mb-2"><strong>Branch:</strong> {selectedReq.branch}</div>
                {selectedReq.notes && <div className="mb-2"><strong>Notes:</strong> {selectedReq.notes}</div>}
                <div className="mb-2"><strong>Status:</strong> {selectedReq.status}</div>
                <div className="mb-2"><strong>Submitted:</strong> {selectedReq.submittedAt}</div>
                {selectedReq.reviewedAt && <div className="mb-2"><strong>Reviewed At:</strong> {selectedReq.reviewedAt} by {selectedReq.reviewedBy}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedReq(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
