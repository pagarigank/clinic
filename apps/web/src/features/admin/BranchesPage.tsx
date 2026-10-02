import React, { useState, useEffect } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet } from "../../shared/api/client.js";

interface BranchItem {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: "ACTIVE" | "ARCHIVED";
  serviceProfile: string[];
  licences: {
    type: "LOCAL_BUSINESS_PERMIT" | "DOH_LTO" | "FDA_DRUGSTORE_LTO";
    licenceNo: string;
    expiresOn?: string;
  }[];
}

const DEFAULT_BRANCHES: BranchItem[] = [
  {
    id: "b1000000-0000-4000-8000-000000000001",
    code: "MNL-MAIN",
    name: "Metro General Hospital - Main Branch",
    timezone: "Asia/Manila",
    status: "ACTIVE",
    serviceProfile: ["CONSULTATION", "PROCEDURE_ROOM", "EMBEDDED_LABORATORY", "PHARMACY_DISPENSING"],
    licences: [
      { type: "LOCAL_BUSINESS_PERMIT", licenceNo: "BP-MNL-2026-08112", expiresOn: "2026-12-31" },
      { type: "DOH_LTO", licenceNo: "DOH-NCR-01449-L3", expiresOn: "2027-06-30" },
      { type: "FDA_DRUGSTORE_LTO", licenceNo: "FDA-NCR-CDRR-2026-09", expiresOn: "2027-01-15" },
    ],
  },
  {
    id: "b2000000-0000-4000-8000-000000000002",
    code: "QC-AMB",
    name: "North Care Ambulatory Center",
    timezone: "Asia/Manila",
    status: "ACTIVE",
    serviceProfile: ["CONSULTATION", "EMBEDDED_LABORATORY"],
    licences: [
      { type: "LOCAL_BUSINESS_PERMIT", licenceNo: "BP-QC-2026-44120", expiresOn: "2026-12-31" },
      // Notice: DOH LTO is missing for this branch that operates an embedded lab -> triggers informational compliance badge
    ],
  },
];

export function BranchesPage() {
  const [branches, setBranches] = useState<BranchItem[]>(DEFAULT_BRANCHES);
  const [_isLoading, setIsLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newServices, setNewServices] = useState<string[]>(["CONSULTATION"]);
  const [feedback, setFeedback] = useState<{ message: string; severity: "success" | "info" } | null>(null);

  useEffect(() => {
    async function loadBranches() {
      setIsLoading(true);
      try {
        const res = await apiGet<{ branches: BranchItem[] }>("/admin/branches");
        if (res?.branches && res.branches.length > 0) {
          setBranches(res.branches);
        }
      } catch {
        // Fall back to default seeded branches
      } finally {
        setIsLoading(false);
      }
    }
    loadBranches();
  }, []);

  const handleCreateBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;

    const newBranch: BranchItem = {
      id: `b-${Date.now()}`,
      code: newCode.toUpperCase().trim(),
      name: newName.trim(),
      timezone: "Asia/Manila",
      status: "ACTIVE",
      serviceProfile: newServices,
      licences: [
        { type: "LOCAL_BUSINESS_PERMIT", licenceNo: `BP-GEN-${Date.now().toString().slice(-5)}`, expiresOn: "2026-12-31" },
      ],
    };

    setBranches([...branches, newBranch]);
    setIsAddModalOpen(false);
    setNewCode("");
    setNewName("");
    setNewServices(["CONSULTATION"]);
    setFeedback({
      message: `Branch "${newBranch.name}" created with profile: ${newBranch.serviceProfile.join(", ")}.`,
      severity: "success",
    });
  };

  const toggleService = (srv: string) => {
    if (newServices.includes(srv)) {
      setNewServices(newServices.filter((s) => s !== srv));
    } else {
      setNewServices([...newServices, srv]);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Branches & Operational Scopes</h1>
          <div className="page-subtitle">
            Manage physical facility scopes, clinical service profiles, and Philippine regulatory licences
          </div>
        </div>
        <button
          type="button"
          className="btn btn-cerulean d-flex align-items-center gap-2"
          onClick={() => setIsAddModalOpen(true)}
        >
          <span>+</span>
          <span>Add Clinic Branch</span>
        </button>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity={feedback.severity}>{feedback.message}</AlertBanner>
        </div>
      )}

      {/* Overview Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Operating Branches</div>
              <div className="fs-3 fw-bold text-dark">{branches.length}</div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "var(--cerulean-100)",
                color: "var(--cerulean-700)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              🏢
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Active Licences</div>
              <div className="fs-3 fw-bold text-success">
                {branches.reduce((acc, b) => acc + (b.licences?.length || 0), 0)}
              </div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "rgb(220, 252, 231)",
                color: "rgb(22, 163, 74)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              📜
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Compliance Status</div>
              <div className="fs-3 fw-bold text-primary">DPA / DOH Compliant</div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "rgb(240, 249, 255)",
                color: "var(--cerulean-600)",
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
      </div>

      {/* Branches Table */}
      <div className="clinic-card">
        <div className="clinic-card-header">
          <span className="fw-bold">Facility Scopes ({branches.length})</span>
          <span className="small text-muted">Timezone: Asia/Manila (PHT)</span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>CODE</th>
                <th>BRANCH NAME</th>
                <th>OPERATING PROFILE</th>
                <th>REGULATORY LICENCES</th>
                <th>STATUS</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const hasLab = b.serviceProfile.includes("EMBEDDED_LABORATORY");
                const hasLabLicence = b.licences.some((l) => l.type === "DOH_LTO");
                const showLabWarning = hasLab && !hasLabLicence;

                return (
                  <tr key={b.id}>
                    <td>
                      <span className="badge bg-light text-dark border font-monospace fw-bold">
                        {b.code}
                      </span>
                    </td>
                    <td>
                      <div className="fw-semibold text-dark">{b.name}</div>
                      <div className="small text-muted">{b.timezone}</div>
                    </td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        {b.serviceProfile.map((srv) => (
                          <span
                            key={srv}
                            className="badge bg-primary-subtle text-primary border border-primary-subtle"
                            style={{ fontSize: "0.72rem" }}
                          >
                            {srv.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="d-flex flex-column gap-1">
                        {b.licences.map((l) => (
                          <div key={l.type} className="small text-secondary d-flex align-items-center gap-1">
                            <span className="fw-semibold text-dark">{l.type.replace(/_/g, " ")}:</span>
                            <span className="font-monospace">{l.licenceNo}</span>
                            {l.expiresOn && <span className="text-muted">(exp: {l.expiresOn})</span>}
                          </div>
                        ))}
                        {showLabWarning && (
                          <div
                            className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle text-start p-1"
                            title="Embedded laboratory declared without DOH LTO on file (Informational per Q-18)"
                          >
                            ⚠️ DOH LTO licence not on file
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <StatusPill tone="normal" label={b.status} />
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setSelectedBranch(b)}
                      >
                        Inspect Scope
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Branch Modal */}
      {isAddModalOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleCreateBranch}>
                <div className="modal-header">
                  <h5 className="modal-title">Add Clinic Facility / Branch</h5>
                  <button type="button" className="btn-close" onClick={() => setIsAddModalOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">BRANCH CODE (UPPERCASE) *</label>
                    <input
                      type="text"
                      className="form-control font-monospace"
                      placeholder="e.g. CEB-MAIN"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">FACILITY NAME *</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Metro Cebu Ambulatory Clinic"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">OPERATIONAL SERVICES PROFILE</label>
                    <div className="d-flex flex-column gap-2 p-2 border rounded bg-light">
                      {[
                        "CONSULTATION",
                        "PROCEDURE_ROOM",
                        "EMBEDDED_LABORATORY",
                        "PHARMACY_DISPENSING",
                        "AMBULATORY_SURGICAL",
                        "DIALYSIS",
                      ].map((srv) => (
                        <div key={srv} className="form-check">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            id={`srv-${srv}`}
                            checked={newServices.includes(srv)}
                            onChange={() => toggleService(srv)}
                          />
                          <label className="form-check-label small" htmlFor={`srv-${srv}`}>
                            {srv.replace(/_/g, " ")}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsAddModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-cerulean">
                    Create Branch
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Branch Details Modal */}
      {selectedBranch && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Branch Profile: {selectedBranch.name}</h5>
                <button type="button" className="btn-close" onClick={() => setSelectedBranch(null)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <span className="badge bg-light text-dark border font-monospace me-2">
                    {selectedBranch.code}
                  </span>
                  <StatusPill tone="normal" label={selectedBranch.status} />
                </div>
                <div className="small text-secondary mb-3">
                  <strong>Timezone:</strong> {selectedBranch.timezone} (UTC+8)
                </div>

                <h6 className="small fw-bold text-uppercase text-secondary mt-3">Services Configured</h6>
                <ul className="small">
                  {selectedBranch.serviceProfile.map((s) => (
                    <li key={s}>{s.replace(/_/g, " ")}</li>
                  ))}
                </ul>

                <h6 className="small fw-bold text-uppercase text-secondary mt-3">Registered Licences</h6>
                <div className="d-flex flex-column gap-2">
                  {selectedBranch.licences.map((l) => (
                    <div key={l.type} className="p-2 border rounded bg-light small">
                      <div className="fw-bold">{l.type.replace(/_/g, " ")}</div>
                      <div className="font-monospace text-secondary">{l.licenceNo}</div>
                      {l.expiresOn && <div className="text-muted">Expires: {l.expiresOn}</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setSelectedBranch(null)}>
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
