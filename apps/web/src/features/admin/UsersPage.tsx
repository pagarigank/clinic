import React, { useState } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  mfaEnabled: boolean;
  status: "ACTIVE" | "LOCKED" | "INVITED";
  lastLogin: string;
}

const SEEDED_USERS: StaffUser[] = [
  {
    id: "u-1",
    name: "Dr. Maria Clara Santos",
    email: "dr.santos@metrocare.ph",
    role: "DOCTOR",
    branch: "Metro General Hospital - Main Branch",
    mfaEnabled: true,
    status: "ACTIVE",
    lastLogin: "Today, 10:14 AM",
  },
  {
    id: "u-2",
    name: "Tenant Administrator",
    email: "admin@example.com",
    role: "TENANT_ADMIN",
    branch: "All Branches (Tenant Wide)",
    mfaEnabled: true,
    status: "ACTIVE",
    lastLogin: "Today, 08:30 AM",
  },
  {
    id: "u-3",
    name: "Carmela Reyes, RN",
    email: "carmela.reyes@metrocare.ph",
    role: "NURSE",
    branch: "North Care Ambulatory Center",
    mfaEnabled: true,
    status: "ACTIVE",
    lastLogin: "Yesterday, 04:15 PM",
  },
  {
    id: "u-4",
    name: "Juan Dela Cruz",
    email: "juan.delacruz@metrocare.ph",
    role: "ENCODER",
    branch: "Metro General Hospital - Main Branch",
    mfaEnabled: false,
    status: "ACTIVE",
    lastLogin: "2026-09-29 09:10 AM",
  },
  {
    id: "u-5",
    name: "Mark Villanueva, RPh",
    email: "mark.pharma@metrocare.ph",
    role: "PHARMACIST",
    branch: "Metro General Hospital - Main Branch",
    mfaEnabled: true,
    status: "ACTIVE",
    lastLogin: "2026-09-30 01:20 PM",
  },
];

export function UsersPage() {
  const [users] = useState<StaffUser[]>(SEEDED_USERS);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff & User Directory</h1>
          <div className="page-subtitle">
            Manage clinician accounts, role assignments, branch privileges, and MFA security status
          </div>
        </div>
        <div className="d-flex gap-2">
          <Link to="/admin/approvals" className="btn btn-outline-secondary">
            Pending Approvals
          </Link>
          <button
            type="button"
            className="btn btn-cerulean"
            onClick={() => setFeedback("Invitation link dispatched to user's registered work email.")}
          >
            + Invite Clinical Staff
          </button>
        </div>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity="success">{feedback}</AlertBanner>
        </div>
      )}

      {/* Staff Table */}
      <div className="clinic-card">
        <div className="clinic-card-header flex-wrap gap-2">
          <div className="input-group input-group-sm" style={{ maxWidth: 360 }}>
            <span className="input-group-text bg-light text-muted">🔍</span>
            <input
              type="text"
              className="form-control"
              placeholder="Search staff by name, email, or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="small text-muted">
            Displaying {filtered.length} of {users.length} clinical accounts
          </span>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>STAFF MEMBER</th>
                <th>ROLE</th>
                <th>BRANCH ASSIGNMENT</th>
                <th>MFA STATUS</th>
                <th>LAST SIGN IN</th>
                <th>ACCOUNT STATUS</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="fw-semibold text-dark">{u.name}</div>
                    <div className="small text-muted">{u.email}</div>
                  </td>
                  <td>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1">
                      {u.role}
                    </span>
                  </td>
                  <td className="small text-secondary">{u.branch}</td>
                  <td>
                    {u.mfaEnabled ? (
                      <span className="badge bg-success-subtle text-success border border-success-subtle">
                        ✓ TOTP Active
                      </span>
                    ) : (
                      <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                        MFA Pending
                      </span>
                    )}
                  </td>
                  <td className="small text-muted">{u.lastLogin}</td>
                  <td>
                    <StatusPill tone={u.status === "ACTIVE" ? "normal" : "high"} label={u.status} />
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setFeedback(`Security audit profile loaded for ${u.name}`)}
                    >
                      Audit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
