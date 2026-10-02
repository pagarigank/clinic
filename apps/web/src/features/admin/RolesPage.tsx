import React, { useState } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";

interface RoleItem {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissionsCount: number;
  modules: string[];
}

const SYSTEM_ROLES: RoleItem[] = [
  {
    id: "r-admin",
    name: "Tenant Administrator",
    description: "Full administrative jurisdiction over staff, branches, audit, and facility policies.",
    isSystem: true,
    userCount: 2,
    permissionsCount: 84,
    modules: ["admin", "compliance", "patients", "clinical"],
  },
  {
    id: "r-doctor",
    name: "Physician / Medical Specialist",
    description: "Clinical consultation, diagnosis entry, e-prescriptions, and procedure orders.",
    isSystem: true,
    userCount: 5,
    permissionsCount: 42,
    modules: ["patients", "clinical", "pharmacy", "laboratory"],
  },
  {
    id: "r-nurse",
    name: "Staff Nurse / Triage",
    description: "Vitals capture, triage intake, patient queue management, and immunization logging.",
    isSystem: true,
    userCount: 8,
    permissionsCount: 28,
    modules: ["patients", "clinical"],
  },
  {
    id: "r-pharmacist",
    name: "Licensed Pharmacist",
    description: "Prescription verification, drug dispensing, FEFO allocation, and Dangerous Drugs Book register.",
    isSystem: true,
    userCount: 3,
    permissionsCount: 31,
    modules: ["pharmacy", "supply"],
  },
  {
    id: "r-lab",
    name: "Medical Technologist",
    description: "Specimen accessioning, analyte test results entry, critical alerts, and QC runs.",
    isSystem: true,
    userCount: 4,
    permissionsCount: 36,
    modules: ["laboratory"],
  },
  {
    id: "r-billing",
    name: "Billing Cashier",
    description: "Patient POS settlement, PhilHealth Konsulta claim claims, split tender, and shift closure.",
    isSystem: true,
    userCount: 3,
    permissionsCount: 22,
    modules: ["billing"],
  },
];

const SOD_CONFLICTS = [
  { p1: "pharmacy.rx.verify", p2: "pharmacy.dispense.post", reason: "Verifier cannot dispense their own verified prescription" },
  { p1: "lab.result.enter", p2: "lab.result.verify", reason: "Technician entering analyte result cannot verify the same report" },
  { p1: "billing.payment.create", p2: "billing.payment.void", reason: "Cashier collecting payment cannot void transaction without supervisor authorization" },
  { p1: "supply.po.submit", p2: "supply.po.approve", reason: "Purchase order requester cannot self-approve order requisition" },
];

export function RolesPage() {
  const [roles] = useState<RoleItem[]>(SYSTEM_ROLES);
  const [selectedRole, setSelectedRole] = useState<RoleItem | null>(roles[0] || null);
  const [searchModule, setSearchModule] = useState("ALL");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles & Access Control</h1>
          <div className="page-subtitle">
            Role-Based Access Control (RBAC), 354 permission catalogue codes, and Segregation of Duties (SoD) safeguards
          </div>
        </div>
      </div>

      {/* Segregation of Duties Invariant Banner */}
      <div className="mb-4">
        <AlertBanner severity="warning">
          <strong>Segregation of Duties (SoD) Enforcement Active:</strong> The platform strictly prevents granting
          mutually conflicting permissions to the same role or user to satisfy Philippine healthcare fraud prevention rules.
        </AlertBanner>
      </div>

      <div className="row g-4">
        {/* Left: Roles List */}
        <div className="col-lg-5">
          <div className="clinic-card mb-4">
            <div className="clinic-card-header">
              <span className="fw-bold">Standard Roles ({roles.length})</span>
              <span className="small text-muted">System Seeded</span>
            </div>
            <div className="list-group list-group-flush">
              {roles.map((r) => {
                const isSelected = selectedRole?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`list-group-item list-group-item-action p-3 text-start ${isSelected ? "bg-light border-start border-4 border-primary" : ""}`}
                    onClick={() => setSelectedRole(r)}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <strong className="text-dark">{r.name}</strong>
                      <StatusPill tone="normal" label={`${r.userCount} users`} />
                    </div>
                    <p className="text-secondary small mb-2">{r.description}</p>
                    <div className="d-flex gap-1 flex-wrap">
                      {r.modules.map((m) => (
                        <span key={m} className="badge bg-light text-dark border" style={{ fontSize: "0.7rem" }}>
                          {m}
                        </span>
                      ))}
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle ms-auto" style={{ fontSize: "0.7rem" }}>
                        {r.permissionsCount} permissions
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SoD Conflict Matrix Card */}
          <div className="clinic-card p-3">
            <h6 className="fw-bold text-dark mb-2">⚖️ Segregation of Duties Rules</h6>
            <div className="small text-muted mb-3">
              Automated rules preventing single-user conflict of interest:
            </div>
            <div className="d-flex flex-column gap-2">
              {SOD_CONFLICTS.map((c, i) => (
                <div key={i} className="p-2 border rounded bg-light small">
                  <div className="font-monospace fw-semibold text-danger" style={{ fontSize: "0.75rem" }}>
                    {c.p1} ⚡ {c.p2}
                  </div>
                  <div className="text-secondary mt-1">{c.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Selected Role Permissions Matrix */}
        <div className="col-lg-7">
          {selectedRole ? (
            <div className="clinic-card">
              <div className="clinic-card-header flex-wrap gap-2">
                <div>
                  <h5 className="mb-0 text-dark fw-bold">{selectedRole.name}</h5>
                  <div className="small text-muted">{selectedRole.description}</div>
                </div>
                <div className="btn-group btn-group-sm">
                  {["ALL", "clinical", "patients", "pharmacy", "laboratory", "admin"].map((mod) => (
                    <button
                      key={mod}
                      type="button"
                      className={`btn ${searchModule === mod ? "btn-cerulean" : "btn-outline-secondary"}`}
                      onClick={() => setSearchModule(mod)}
                    >
                      {mod.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3">
                <div className="alert alert-info py-2 px-3 small d-flex align-items-center justify-content-between mb-3">
                  <span>This system role has <strong>{selectedRole.permissionsCount} verified permissions</strong> mapped.</span>
                  <span className="badge bg-info text-dark">Immutable Template</span>
                </div>

                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light small text-secondary">
                      <tr>
                        <th>CODE</th>
                        <th>MODULE</th>
                        <th>DESCRIPTION</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody className="small">
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">patient.record.read</td>
                        <td><span className="badge bg-light text-dark border">patients</span></td>
                        <td>View patient demographic profile, history, and identifiers</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">patient.record.create</td>
                        <td><span className="badge bg-light text-dark border">patients</span></td>
                        <td>Intake and register new patients in facility registry</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">clinical.encounter.read</td>
                        <td><span className="badge bg-light text-dark border">clinical</span></td>
                        <td>Read consultation records, vitals, and physician notes</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">clinical.encounter.write</td>
                        <td><span className="badge bg-light text-dark border">clinical</span></td>
                        <td>Record SOAP notes, diagnoses, and outpatient treatment plans</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">pharmacy.rx.read</td>
                        <td><span className="badge bg-light text-dark border">pharmacy</span></td>
                        <td>View physician issued electronic prescriptions</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-primary fw-semibold">admin.branch.read</td>
                        <td><span className="badge bg-light text-dark border">admin</span></td>
                        <td>Inspect facility scopes and operating hours</td>
                        <td><span className="badge bg-success">GRANTED</span></td>
                      </tr>
                      <tr>
                        <td className="font-monospace text-secondary fw-semibold">admin.tenant.provision</td>
                        <td><span className="badge bg-light text-dark border">admin</span></td>
                        <td>Platform tenant lifecycle provisioning</td>
                        <td><span className="badge bg-secondary">DENIED</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="clinic-card p-5 text-center text-muted">
              Select a role on the left to inspect permissions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
