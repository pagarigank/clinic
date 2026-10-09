import React, { useMemo, useState } from "react";
import { Form } from "@clinic/ui";

export type DispensingModule = "PHARMACY" | "SUPPLY" | "LAB";

export interface PatientGroup<TRequest = any> {
  patientId: string;
  patientName: string;
  patientIdDisplay?: string | null;
  pendingCount: number;
  oldestRequestAt?: string | null;
  requests: TRequest[];
  meta?: Record<string, any>;
}

export interface PatientGroupedRequestListProps<TRequest = any> {
  module: DispensingModule;
  title: string;
  subtitle?: string;
  groups: PatientGroup<TRequest>[];
  loading?: boolean;
  emptyMessage?: string;
  selectedPatientId?: string | null;
  onSelectPatient: (patientId: string | null) => void;
  renderRequests: (group: PatientGroup<TRequest>, onBack: () => void) => React.ReactNode;
  headerActions?: React.ReactNode;
  metricsHeader?: React.ReactNode;
  selectButtonLabel?: string;
  searchPlaceholder?: string;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return String(iso);
  }
}

export function PatientGroupedRequestList<TRequest = any>({
  module,
  title,
  subtitle,
  groups,
  loading = false,
  emptyMessage,
  selectedPatientId,
  onSelectPatient,
  renderRequests,
  headerActions,
  metricsHeader,
  selectButtonLabel,
  searchPlaceholder = "Search patient name or ID…",
}: PatientGroupedRequestListProps<TRequest>) {
  const [searchTerm, setSearchTerm] = useState("");

  const moduleLabel = useMemo(() => {
    switch (module) {
      case "PHARMACY":
        return "Pharmacy (Medication Requests Only)";
      case "SUPPLY":
        return "Supply (Item & Consumable Requests Only)";
      case "LAB":
        return "Laboratory (Lab Test Requests Only)";
      default:
        return module;
    }
  }, [module]);

  const getUnit = (count: number) => {
    switch (module) {
      case "PHARMACY":
        return count === 1 ? "Prescription" : "Prescriptions";
      case "SUPPLY":
        return count === 1 ? "Supply Item" : "Supply Items";
      case "LAB":
        return count === 1 ? "Lab Test" : "Lab Tests";
      default:
        return count === 1 ? "Request" : "Requests";
    }
  };

  // Filter groups by patient name and ID
  const filteredGroups = useMemo(() => {
    // Only include patients who have at least one request
    const active = groups.filter((g) => g.requests && g.requests.length > 0);
    if (!searchTerm.trim()) return active;
    const q = searchTerm.toLowerCase().trim();
    return active.filter(
      (g) =>
        g.patientName.toLowerCase().includes(q) ||
        (g.patientIdDisplay && g.patientIdDisplay.toLowerCase().includes(q)) ||
        g.patientId.toLowerCase().includes(q),
    );
  }, [groups, searchTerm]);

  const selectedGroup = useMemo(() => {
    if (!selectedPatientId) return null;
    return groups.find((g) => g.patientId === selectedPatientId) ?? null;
  }, [groups, selectedPatientId]);

  // ── LEVEL 2: PATIENT SELECTED (REQUEST LEVEL VIEW) ──────────────────────────
  if (selectedGroup) {
    return (
      <div className="patient-grouped-requests-container">
        {/* Navigation & Patient Header */}
        <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-3">
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
              onClick={() => onSelectPatient(null)}
              aria-label="Back to patient list"
            >
              <span aria-hidden="true">←</span>
              <span>Back to Patient List</span>
            </button>
            <span className="text-muted">|</span>
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
              {moduleLabel}
            </span>
          </div>

          <div className="d-flex align-items-center gap-2">
            <span className="small text-muted">
              Pending in {module}: <strong>{selectedGroup.requests.length}</strong> {getUnit(selectedGroup.requests.length)}
            </span>
          </div>
        </div>

        {/* Patient Demographic Summary Card */}
        <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderLeft: "4px solid var(--brand-primary, #0284c7)" }}>
          <div className="card-body p-3 d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div className="d-flex align-items-center gap-3">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  backgroundColor: "rgba(2, 132, 199, 0.12)",
                  color: "#0284c7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "1.1rem",
                }}
              >
                {selectedGroup.patientName.charAt(0) || "P"}
              </div>
              <div>
                <div className="d-flex align-items-center gap-2">
                  <h2 className="h5 fw-bold mb-0 text-dark">{selectedGroup.patientName}</h2>
                  {selectedGroup.patientIdDisplay && (
                    <span className="badge bg-secondary-subtle text-secondary font-monospace" style={{ fontSize: "0.75rem" }}>
                      {selectedGroup.patientIdDisplay}
                    </span>
                  )}
                </div>
                <div className="small text-muted mt-1">
                  Patient ID: <span className="font-monospace">{selectedGroup.patientId}</span>
                  {selectedGroup.oldestRequestAt && (
                    <span className="ms-2">· Oldest Request: {formatDate(selectedGroup.oldestRequestAt)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Specific Request List for this module */}
        <div className="patient-module-requests-view">
          {renderRequests(selectedGroup, () => onSelectPatient(null))}
        </div>
      </div>
    );
  }

  // ── LEVEL 1: MAIN LIST (PATIENT LEVEL VIEW) ─────────────────────────────────
  return (
    <div className="patient-grouped-main-list">
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary, #0284c7)" }}>
            {title}
          </h1>
          {subtitle && <p className="text-secondary mb-0" style={{ fontSize: "0.95rem" }}>{subtitle}</p>}
        </div>
        {headerActions && <div className="d-flex align-items-center gap-2">{headerActions}</div>}
      </div>

      {/* Optional Metrics Header */}
      {metricsHeader && <div className="mb-4">{metricsHeader}</div>}

      {/* Filter and Search Bar */}
      <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)" }}>
        <div className="card-body p-3">
          <div className="row g-3 align-items-center justify-content-between">
            <div className="col-12 col-md-6 col-lg-5">
              <Form.Control
                type="search"
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search patients"
              />
            </div>
            <div className="col-12 col-md-6 text-md-end small text-muted">
              Showing <strong>{filteredGroups.length}</strong> patient{filteredGroups.length === 1 ? "" : "s"} with pending {getUnit(filteredGroups.length)}
            </div>
          </div>
        </div>
      </div>

      {/* Patient Table (Exactly ONE row per patient with pending requests) */}
      <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th style={{ minWidth: 220 }}>Patient Name</th>
                <th style={{ width: 180 }}>Patient ID / MRN</th>
                <th style={{ width: 180 }}>Pending Requests</th>
                <th style={{ width: 200 }}>Oldest Request</th>
                <th className="text-end" style={{ width: 200 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-5 text-muted">
                    <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                    <span>Loading patient queue…</span>
                  </td>
                </tr>
              ) : filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-5 text-muted">
                    <div style={{ fontSize: "2rem" }} className="mb-2">📋</div>
                    <div className="fw-semibold">
                      {emptyMessage || `No patients with pending ${moduleLabel.toLowerCase()} found.`}
                    </div>
                    {searchTerm && <p className="small mb-0 mt-1">Try clearing your search filter.</p>}
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => (
                  <tr
                    key={group.patientId}
                    onClick={() => onSelectPatient(group.patientId)}
                    style={{ cursor: "pointer" }}
                    className="hover-bg-light transition-all"
                  >
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            backgroundColor: "rgba(2, 132, 199, 0.1)",
                            color: "#0284c7",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: "0.85rem",
                          }}
                        >
                          {group.patientName.charAt(0) || "P"}
                        </span>
                        <div>
                          <div className="d-flex align-items-center flex-wrap gap-1">
                            <span className="fw-bold text-dark">{group.patientName}</span>
                            {group.meta?.isControlled && (
                              <span className="badge bg-danger" style={{ fontSize: "0.68rem" }}>
                                ⚠️ PDEA S2 CONTROLLED
                              </span>
                            )}
                            {group.meta?.hasStat && (
                              <span className="badge bg-danger" style={{ fontSize: "0.68rem" }}>
                                ⚡ STAT
                              </span>
                            )}
                            {group.meta?.hasUrgent && (
                              <span className="badge bg-warning text-dark" style={{ fontSize: "0.68rem" }}>
                                ⚠️ URGENT
                              </span>
                            )}
                          </div>
                          {group.meta?.orderNos && group.meta.orderNos.length > 0 && (
                            <div className="text-muted font-monospace small" style={{ fontSize: "0.75rem" }}>
                              {group.meta.orderNos.map((no: string, idx: number) => (
                                <span key={`${no}-${idx}`} className="me-2">{no}</span>
                              ))}
                            </div>
                          )}
                          {group.meta?.extra && (
                            <div className="small text-muted" style={{ fontSize: "0.78rem" }}>
                              {group.meta.extra}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {group.patientIdDisplay ? (
                        <span className="badge bg-secondary-subtle text-secondary font-monospace" style={{ fontSize: "0.78rem" }}>
                          {group.patientIdDisplay}
                        </span>
                      ) : (
                        <span className="font-monospace text-muted small">{group.patientId.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td>
                      <span className="badge bg-primary px-2 py-1" style={{ fontSize: "0.78rem" }}>
                        {group.pendingCount} {getUnit(group.pendingCount)}
                      </span>
                    </td>
                    <td className="small text-muted">
                      {formatDate(group.oldestRequestAt)}
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary py-1 px-3 fw-semibold d-inline-flex align-items-center gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPatient(group.patientId);
                        }}
                      >
                        <span>{selectButtonLabel || (module === "PHARMACY" ? "Select Patient & Dispense" : "Select Patient")}</span>
                        <span aria-hidden="true">→</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
