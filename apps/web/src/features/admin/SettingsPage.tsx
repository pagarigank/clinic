import React, { useState } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { ThemeControls } from "../../shared/theme/ThemeControls.js";

interface ModuleEntitlement {
  module: string;
  name: string;
  description: string;
  status: "ENABLED" | "TRIAL" | "DISABLED" | "DRAINING";
  dependencies: string[];
}

const MODULES_LIST: ModuleEntitlement[] = [
  { module: "admin", name: "Tenant Administration", description: "Staff, roles, branches, service catalog, and security configuration.", status: "ENABLED", dependencies: [] },
  { module: "patients", name: "Patient Registry & MPI", description: "Demographics, PhilHealth Konsulta linkage, contacts, and emergency intake.", status: "ENABLED", dependencies: [] },
  { module: "clinical", name: "Clinical Care & Visits", description: "Scheduling, consultation notes, SOAP charts, and diagnosis coding.", status: "ENABLED", dependencies: ["patients"] },
  { module: "laboratory", name: "Laboratory Information System", description: "Specimen accessioning, analyte results, critical alerts, and QC runs.", status: "ENABLED", dependencies: ["patients"] },
  { module: "pharmacy", name: "Pharmacy & Dispensing", description: "E-prescriptions, FEFO stock allocation, and Dangerous Drugs Book.", status: "ENABLED", dependencies: ["patients"] },
  { module: "billing", name: "Billing & Cashier POS", description: "Charge capture, PhilHealth benefit claim, and official receipt settlement.", status: "ENABLED", dependencies: ["patients"] },
  { module: "supply", name: "Central Supply & Inventory", description: "Purchase orders, goods receipt notes (GRN), and multi-branch stock transfers.", status: "TRIAL", dependencies: [] },
  { module: "compliance", name: "Compliance & DPA 2012", description: "Immutable audit logs, PHI access logs, and Subject Access Requests (DSR).", status: "ENABLED", dependencies: [] },
  { module: "notifications", name: "Notifications Engine", description: "SMS/Email appointment reminders and license expiry alerts.", status: "ENABLED", dependencies: [] },
  { module: "reports", name: "Analytics & Regulatory Reports", description: "DOH annual statistics and PhilHealth Konsulta utilization reports.", status: "ENABLED", dependencies: [] },
];

export function SettingsPage() {
  const [modules] = useState<ModuleEntitlement[]>(MODULES_LIST);
  const [selectedReqModule, setSelectedReqModule] = useState<string | null>(null);
  const [requestNotes, setRequestNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSendRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReqModule) return;
    setFeedback(`Module upgrade request for "${selectedReqModule.toUpperCase()}" submitted to Platform Sales.`);
    setSelectedReqModule(null);
    setRequestNotes("");
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Settings & Module Entitlements</h1>
          <div className="page-subtitle">
            Entitled platform modules, PhilHealth Konsulta compliance, and clinic security policies
          </div>
        </div>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity="success">{feedback}</AlertBanner>
        </div>
      )}

      {/* Appearance — client-side presentation preferences only (frontend §5.1).
          These never affect a server-side value, an entitlement, or a permission. */}
      <div className="clinic-card mb-4">
        <div className="clinic-card-header">
          <span className="fw-bold">Appearance</span>
        </div>
        <div className="clinic-card-body">
          <ThemeControls />
        </div>
      </div>

      {/* Clinical Master Data & ICD-10 */}
      <div className="clinic-card mb-4">
        <div className="clinic-card-header d-flex justify-content-between align-items-center">
          <div>
            <span className="fw-bold">Clinical Master Data &amp; ICD-10 Catalogue</span>
            <div className="small text-muted">
              Diagnostic reference database, standardized clinical impressions, and prescription pad coding
            </div>
          </div>
          <Link to="/admin/icd10" className="btn btn-sm btn-cerulean text-decoration-none">
            Manage ICD-10 Codes →
          </Link>
        </div>
        <div className="p-3">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="small text-secondary" style={{ maxWidth: "700px" }}>
              The ICD-10 catalogue serves as the authoritative diagnostic terminology across all consultations. Codes configured here are dynamically queried in the clinical visit chart (SOAP notes, problem lists) and formatted on printed official prescription pads.
            </div>
            <Link to="/admin/icd10" className="btn btn-sm btn-outline-primary">
              🩺 Open ICD-10 Registry
            </Link>
          </div>
        </div>
      </div>

      {/* Security Policies Card */}
      <div className="clinic-card mb-4">
        <div className="clinic-card-header">
          <span className="fw-bold">Security & Compliance Policies</span>
          <span className="badge bg-success-subtle text-success border border-success-subtle">
            ● Active
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3">
            <div className="col-md-4">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark small">SESSION IDLE TIMEOUT</div>
                <div className="fs-5 fw-semibold text-primary">15 Minutes</div>
                <div className="small text-muted mt-1">Automatic logout after inactivity countdown.</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark small">MFA ENFORCEMENT</div>
                <div className="fs-5 fw-semibold text-primary">Mandatory for Admins</div>
                <div className="small text-muted mt-1">RFC 6238 TOTP with recovery codes.</div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 border rounded bg-light">
                <div className="fw-bold text-dark small">DATA PRIVACY (RA 10173)</div>
                <div className="fs-5 fw-semibold text-success">Active PHI Auto-Mask</div>
                <div className="small text-muted mt-1">PhilHealth PIN & IDs masked until audited reveal.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modules Table */}
      <div className="clinic-card">
        <div className="clinic-card-header flex-wrap gap-2">
          <div>
            <h5 className="mb-0 text-dark fw-bold">My Modules ({modules.length})</h5>
            <div className="small text-muted">
              Read-only entitlement list. Request module upgrades from the platform team.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-cerulean"
            onClick={() => setSelectedReqModule("supply")}
          >
            + Request Additional Module
          </button>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>MODULE KEY</th>
                <th>MODULE NAME</th>
                <th>DESCRIPTION</th>
                <th>DEPENDENCIES</th>
                <th>ENTITLEMENT STATUS</th>
                <th className="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.module}>
                  <td>
                    <span className="badge bg-light text-dark border font-monospace">
                      {m.module}
                    </span>
                  </td>
                  <td>
                    <strong className="text-dark">{m.name}</strong>
                  </td>
                  <td className="small text-secondary">{m.description}</td>
                  <td>
                    {m.dependencies.length > 0 ? (
                      m.dependencies.map((d) => (
                        <span key={d} className="badge bg-light text-muted border me-1">
                          {d}
                        </span>
                      ))
                    ) : (
                      <span className="small text-muted">None</span>
                    )}
                  </td>
                  <td>
                    <StatusPill
                      tone={m.status === "ENABLED" ? "normal" : m.status === "TRIAL" ? "high" : "neutral"}
                      label={m.status}
                    />
                  </td>
                  <td className="text-end">
                    {m.status === "ENABLED" ? (
                      <span className="small text-success fw-semibold">Active in Workspace</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => setSelectedReqModule(m.module)}
                      >
                        Request Upgrade
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Module Modal */}
      {selectedReqModule && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleSendRequest}>
                <div className="modal-header">
                  <h5 className="modal-title">Request Module Activation</h5>
                  <button type="button" className="btn-close" onClick={() => setSelectedReqModule(null)} />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">SELECTED MODULE</label>
                    <input
                      type="text"
                      className="form-control font-monospace"
                      value={selectedReqModule.toUpperCase()}
                      disabled
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">BUSINESS REQUIREMENT / REASON</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      placeholder="Describe clinic operational needs or branch requirements..."
                      value={requestNotes}
                      onChange={(e) => setRequestNotes(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setSelectedReqModule(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-cerulean">
                    Submit Request
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
