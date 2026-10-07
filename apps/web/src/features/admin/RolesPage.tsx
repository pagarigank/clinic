import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPatch, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import type { RoleDto, PermissionDto } from "@clinic/contracts";

/**
 * Roles & Access Control (admin.role.* — specification §2.3, frontend §13).
 *
 * Live-backed: roles come from GET /admin/roles, the permission catalogue from
 * GET /admin/permissions, and granting/revoking PATCHes /admin/roles/:id.
 * The server re-validates every grant (catalogue membership + SoD via
 * sod_conflicts), so an optimistic tick that violates SoD rolls back with the
 * server's SEGREGATION_OF_DUTIES problem shown verbatim.
 *
 * System roles are template-managed (rbac.service refuses PATCH on them), so
 * their matrix renders read-only.
 */

export interface SodConflictRule {
  p1: string;
  p2: string;
  reason: string;
  preferred: string;
}

export const SOD_CONFLICTS: SodConflictRule[] = [
  {
    p1: "lab.result.enter",
    p2: "lab.result.verify",
    reason: "Technician entering analyte result cannot verify the same report (AC-17)",
    preferred: "lab.result.enter",
  },
  {
    p1: "pharmacy.rx.verify",
    p2: "pharmacy.dispense.post",
    reason: "Verifier cannot dispense their own verified prescription",
    preferred: "pharmacy.dispense.post",
  },
  {
    p1: "billing.payment.create",
    p2: "billing.payment.void",
    reason: "Cashier collecting payment cannot void transaction without supervisor authorization",
    preferred: "billing.payment.create",
  },
  {
    p1: "supply.po.submit",
    p2: "supply.po.approve",
    reason: "Purchase order requester cannot self-approve order requisition",
    preferred: "supply.po.submit",
  },
  {
    p1: "supply.adjust.submit",
    p2: "supply.adjust.approve",
    reason: "Stock adjustment creator must not approve adjustment",
    preferred: "supply.adjust.submit",
  },
  {
    p1: "supply.adjust.approve",
    p2: "supply.adjust.post",
    reason: "Stock adjustment approver must not post adjustment to ledger",
    preferred: "supply.adjust.submit",
  },
  {
    p1: "supply.grn.post",
    p2: "supply.invoice.match",
    reason: "Goods receiver must not 3-way match supplier invoice",
    preferred: "supply.grn.post",
  },
];

export function getConflictsFor(code: string): Array<{ conflictingCode: string; reason: string; preferred: string }> {
  const result: Array<{ conflictingCode: string; reason: string; preferred: string }> = [];
  for (const c of SOD_CONFLICTS) {
    if (c.p1 === code) {
      result.push({ conflictingCode: c.p2, reason: c.reason, preferred: c.preferred });
    } else if (c.p2 === code) {
      result.push({ conflictingCode: c.p1, reason: c.reason, preferred: c.preferred });
    }
  }
  return result;
}

export function resolveSodSafePerms(
  currentPerms: readonly string[],
  visibleCodesToAdd: readonly string[],
): {
  finalPerms: string[];
  skipped: Array<{ code: string; conflictingWith: string; reason: string }>;
} {
  const selected = new Set<string>(currentPerms);
  const candidates = Array.from(new Set(visibleCodesToAdd)).filter((c) => !selected.has(c));
  const candidateSet = new Set(candidates);
  const skipped: Array<{ code: string; conflictingWith: string; reason: string }> = [];

  for (const code of candidates) {
    const conflicts = getConflictsFor(code);

    // 1. Does `code` conflict with a permission already granted on this role?
    const existingConflict = conflicts.find((c) => selected.has(c.conflictingCode));
    if (existingConflict) {
      skipped.push({
        code,
        conflictingWith: existingConflict.conflictingCode,
        reason: existingConflict.reason,
      });
      continue;
    }

    // 2. Does `code` conflict with another candidate that takes precedence/preference?
    const preferredCandidateConflict = conflicts.find((c) => {
      return candidateSet.has(c.conflictingCode) && c.preferred === c.conflictingCode;
    });
    if (preferredCandidateConflict) {
      skipped.push({
        code,
        conflictingWith: preferredCandidateConflict.conflictingCode,
        reason: preferredCandidateConflict.reason,
      });
      continue;
    }

    selected.add(code);
  }

  return { finalPerms: Array.from(selected), skipped };
}

export function RolesPage() {
  const { session } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("admin.role.update");

  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [catalogue, setCatalogue] = useState<Array<{ module: string; permissions: PermissionDto[] }>>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [searchModule, setSearchModule] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [roleRows, matrix] = await Promise.all([
        apiGet<RoleDto[]>("/admin/roles"),
        apiGet<Array<{ module: string; permissions: PermissionDto[] }>>("/admin/permissions"),
      ]);
      setRoles(roleRows);
      setCatalogue(matrix);
      setSelectedRoleId((prev) => prev ?? roleRows[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title ?? err.problem.code : "Could not load roles or the permission catalogue.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRole = useMemo(() => roles.find((r) => r.id === selectedRoleId) ?? null, [roles, selectedRoleId]);

  const visibleMatrix = useMemo(
    () => (searchModule === "ALL" ? catalogue : catalogue.filter((m) => m.module === searchModule)),
    [catalogue, searchModule],
  );

  const modules = useMemo(() => ["ALL", ...catalogue.map((m) => m.module)], [catalogue]);

  const isGranted = useCallback(
    (code: string) => selectedRole?.permissions.includes(code) || pending.has(code),
    [selectedRole, pending],
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveRolePermissions = async (nextPermissions: string[], notifyMessage?: string) => {
    if (!selectedRole || !canEdit || isSaving) return;
    setIsSaving(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await apiPatch<RoleDto>(`/admin/roles/${selectedRole.id}`, {
        name: selectedRole.name,
        permissions: nextPermissions,
        rowVersion: selectedRole.rowVersion,
      });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setInfo(notifyMessage ?? `Permissions for ${selectedRole.name} saved successfully.`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.problem.title ?? err.problem.code
          : "Could not update role permissions.",
      );
    } finally {
      setIsSaving(false);
      setPending(new Set());
    }
  };

  const toggle = async (code: string) => {
    if (!selectedRole || !canEdit || isSaving || pending.size > 0) return;
    if (selectedRole.code === "tenant_admin" && (code === "admin.role.update" || code === "admin.role.read")) {
      setError("Cannot revoke core role administration permissions from the Tenant Administrator.");
      return;
    }
    const currentlyGranted = selectedRole.permissions.includes(code);
    let nextPermissions: string[];
    let note: string;

    if (currentlyGranted) {
      nextPermissions = selectedRole.permissions.filter((c) => c !== code);
      note = `Revoked ${code} — Saved`;
    } else {
      // If granting `code`, check if any currently held permission conflicts with `code`
      const conflicts = getConflictsFor(code);
      const conflictingHeld = conflicts.filter((c) => selectedRole.permissions.includes(c.conflictingCode));

      if (conflictingHeld.length > 0) {
        // Auto-swap: remove the conflicting permissions to preserve Segregation of Duties
        const dropCodes = new Set(conflictingHeld.map((c) => c.conflictingCode));
        nextPermissions = [...selectedRole.permissions.filter((c) => !dropCodes.has(c)), code];
        const conflictNames = conflictingHeld.map((c) => c.conflictingCode).join(", ");
        note = `Granted ${code} (automatically unselected ${conflictNames} per Segregation of Duties AC-17) — Saved`;
      } else {
        nextPermissions = [...selectedRole.permissions, code];
        note = `Granted ${code} — Saved`;
      }
    }

    setPending(new Set([code]));
    await saveRolePermissions(nextPermissions, note);
  };

  const grantAllVisible = async () => {
    if (!selectedRole || !canEdit || isSaving) return;
    const visibleCodes = visibleMatrix.flatMap((g) => g.permissions.map((p) => p.code));
    const { finalPerms, skipped } = resolveSodSafePerms(selectedRole.permissions, visibleCodes);

    const filterLabel = searchModule === "ALL" ? "" : searchModule + " ";
    const skippedNote = skipped.length > 0
      ? ` (SoD compliance active: excluded ${skipped.length} mutually exclusive permission${skipped.length > 1 ? "s" : ""}: ${skipped.map((s) => s.code).slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""})`
      : "";

    await saveRolePermissions(
      finalPerms,
      `Granted all visible ${filterLabel}permissions${skippedNote} — Saved`,
    );
  };

  const revokeAllVisible = async () => {
    if (!selectedRole || !canEdit || isSaving) return;
    const visibleCodes = new Set(visibleMatrix.flatMap((g) => g.permissions.map((p) => p.code)));
    const remaining = selectedRole.permissions.filter((c) => {
      if (selectedRole.code === "tenant_admin" && (c === "admin.role.update" || c === "admin.role.read")) return true;
      return !visibleCodes.has(c);
    });
    await saveRolePermissions(
      remaining,
      `Revoked all visible ${searchModule === "ALL" ? "" : searchModule + " "}permissions — Saved`,
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles &amp; Access Control</h1>
          <div className="page-subtitle">
            Role-Based Access Control (RBAC), the permission catalogue, and Segregation of Duties (SoD) safeguards
            {session?.tenantSlug ? <span className="ms-2 font-monospace small">tenant: {session.tenantSlug}</span> : null}
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

      {error ? (
        <div className="mb-3">
          <AlertBanner severity="danger" title="RBAC update refused">{error}</AlertBanner>
        </div>
      ) : null}
      {info ? (
        <div className="mb-3">
          <AlertBanner severity="success">{info}</AlertBanner>
        </div>
      ) : null}

      <div className="row g-4">
        {/* Left: Roles List */}
        <div className="col-lg-5">
          <div className="clinic-card mb-4">
            <div className="clinic-card-header">
              <span className="fw-bold">Roles ({roles.length})</span>
              <span className="small text-muted">
                {isLoading ? "loading…" : "live from /admin/roles"}
              </span>
            </div>
            <div className="list-group list-group-flush">
              {roles.map((r) => {
                const isSelected = selectedRole?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`list-group-item list-group-item-action p-3 text-start ${isSelected ? "bg-light border-start border-4 border-primary" : ""}`}
                    onClick={() => setSelectedRoleId(r.id)}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <strong className="text-dark">{r.name}</strong>
                      <StatusPill tone={r.isSystem ? "normal" : "low"} label={r.isSystem ? "system" : "custom"} />
                    </div>
                    <p className="text-secondary small mb-2 font-monospace">{r.code}</p>
                    <div className="d-flex gap-1 flex-wrap">
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle" style={{ fontSize: "0.7rem" }}>
                        {r.permissions.length} permissions
                      </span>
                    </div>
                  </button>
                );
              })}
              {!isLoading && roles.length === 0 ? (
                <div className="list-group-item text-muted small">No roles visible — ask for admin.role.read.</div>
              ) : null}
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

        {/* Right: Selected Role Permission Matrix */}
        <div className="col-lg-7">
          {selectedRole ? (
            <div className="clinic-card">
              <div className="clinic-card-header flex-wrap gap-2">
                <div>
                  <h5 className="mb-0 text-dark fw-bold">{selectedRole.name}</h5>
                  <div className="small text-muted font-monospace">{selectedRole.code}</div>
                </div>
                <div className="btn-group btn-group-sm" role="group" aria-label="Filter by module">
                  {modules.map((mod) => (
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
                <div className="alert alert-info py-2 px-3 small d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                  <span>
                    This role holds <strong>{selectedRole.permissions.length} permissions</strong> — tick to grant, untick to revoke
                    {canEdit ? "" : " (requires admin.role.update)"}.
                  </span>
                  <div className="d-flex align-items-center gap-2">
                    {selectedRole.code === "tenant_admin" ? (
                      <span className="badge bg-info text-dark">Immutable Template (Protected Admin)</span>
                    ) : canEdit ? (
                      <span className="badge bg-success">Editable</span>
                    ) : (
                      <span className="badge bg-secondary">Read-only for you</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary py-1 px-3 fw-semibold shadow-sm"
                        onClick={() => saveRolePermissions(selectedRole.permissions, `Permissions for ${selectedRole.name} saved successfully.`)}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
                            Saving...
                          </>
                        ) : (
                          "💾 Save Changes"
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {selectedRole.code === "tenant_admin" && (
                  <div className="mb-3">
                    <AlertBanner severity="info">
                      <strong>Tenant Administrator Role (Protected Template):</strong> Operational permissions are customizable. Core management permissions (<code className="text-dark">admin.role.update</code>, <code className="text-dark">admin.role.read</code>) remain permanently active to prevent administrator lockout.
                    </AlertBanner>
                  </div>
                )}

                <div className="d-flex justify-content-between align-items-center mb-2 px-1 flex-wrap gap-2">
                  <div className="small">
                    {isSaving ? (
                      <span className="text-primary fw-semibold">
                        <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
                        Saving changes to database...
                      </span>
                    ) : (
                      <span className="text-success small fw-semibold">
                        ✓ Auto-saves instantly on toggle (SoD conflicts auto-resolved)
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="d-flex gap-1">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm py-0 px-2"
                        style={{ fontSize: "0.75rem" }}
                        onClick={grantAllVisible}
                        disabled={isSaving}
                        title="Grant all permissions currently visible, automatically skipping mutually conflicting SoD pairs"
                      >
                        Grant All Visible
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm py-0 px-2"
                        style={{ fontSize: "0.75rem" }}
                        onClick={revokeAllVisible}
                        disabled={isSaving}
                        title="Revoke all permissions currently visible (preserving essential admin management)"
                      >
                        Revoke All Visible
                      </button>
                    </div>
                  )}
                </div>

                <div className="table-responsive" style={{ maxHeight: "32rem", overflowY: "auto" }}>
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light small text-secondary">
                      <tr>
                        <th style={{ width: "3rem" }} aria-label="Granted" />
                        <th>CODE</th>
                        <th>MODULE</th>
                        <th>DESCRIPTION</th>
                      </tr>
                    </thead>
                    <tbody className="small">
                      {visibleMatrix.map((group) =>
                        group.permissions.map((p) => {
                          const granted = isGranted(p.code);
                          const isLocked = selectedRole.code === "tenant_admin" && (p.code === "admin.role.update" || p.code === "admin.role.read");
                          const editable = canEdit && pending.size === 0 && !isSaving && !isLocked;
                          const conflicts = getConflictsFor(p.code);
                          const activeConflict = conflicts.find((c) => selectedRole.permissions.includes(c.conflictingCode));

                          return (
                            <tr key={p.code} className={activeConflict && !granted ? "table-light text-muted" : ""}>
                              <td>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={granted}
                                  disabled={!editable}
                                  onChange={() => toggle(p.code)}
                                  aria-label={`${granted ? "Revoke" : "Grant"} ${p.code} on ${selectedRole.name}`}
                                  title={
                                    isLocked
                                      ? "Essential permission locked to prevent lockout"
                                      : activeConflict && !granted
                                      ? `Checking this will automatically swap out ${activeConflict.conflictingCode}`
                                      : undefined
                                  }
                                />
                              </td>
                              <td className={`font-monospace fw-semibold ${granted ? "text-primary" : "text-secondary"}`}>
                                {p.code}
                                {activeConflict && granted && (
                                  <span
                                    className="badge bg-danger-subtle text-danger border border-danger-subtle ms-2"
                                    style={{ fontSize: "0.68rem" }}
                                    title={`Mutually exclusive with ${activeConflict.conflictingCode}: ${activeConflict.reason}`}
                                  >
                                    ⚖️ SoD Active (excludes {activeConflict.conflictingCode})
                                  </span>
                                )}
                                {activeConflict && !granted && (
                                  <span
                                    className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle ms-2"
                                    style={{ fontSize: "0.68rem" }}
                                    title={`Mutually exclusive with ${activeConflict.conflictingCode}: ${activeConflict.reason}. Checking this will auto-swap.`}
                                  >
                                    ⚡ Excludes {activeConflict.conflictingCode} (auto-swaps)
                                  </span>
                                )}
                                {conflicts.length > 0 && !activeConflict && (
                                  <span
                                    className="badge bg-light text-muted border ms-2"
                                    style={{ fontSize: "0.68rem" }}
                                    title={`Mutually exclusive with: ${conflicts.map((c) => c.conflictingCode).join(", ")}`}
                                  >
                                    ⚡ SoD Pair
                                  </span>
                                )}
                              </td>
                              <td><span className="badge bg-light text-dark border">{group.module}</span></td>
                              <td className="text-secondary">
                                {p.description}
                                {isLocked && (
                                  <span className="badge bg-secondary-subtle text-secondary ms-2" style={{ fontSize: "0.68rem" }}>
                                    🔒 Protected Core
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="clinic-card p-5 text-center text-muted">
              {isLoading ? "Loading roles…" : "Select a role on the left to inspect permissions."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


