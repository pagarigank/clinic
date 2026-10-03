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

interface SodPair {
  p1: string;
  p2: string;
  reason: string;
}

const SOD_CONFLICTS: SodPair[] = [
  { p1: "lab.result.enter", p2: "lab.result.verify", reason: "Technician entering analyte result cannot verify the same report" },
  { p1: "pharmacy.rx.verify", p2: "pharmacy.dispense.post", reason: "Verifier cannot dispense their own verified prescription" },
  { p1: "billing.payment.create", p2: "billing.payment.void", reason: "Cashier collecting payment cannot void transaction without supervisor authorization" },
  { p1: "supply.po.submit", p2: "supply.po.approve", reason: "Purchase order requester cannot self-approve order requisition" },
];

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

  const toggle = async (code: string) => {
    if (!selectedRole || selectedRole.isSystem || !canEdit || pending.size > 0) return;
    const currentlyGranted = selectedRole.permissions.includes(code);
    const nextPermissions = currentlyGranted
      ? selectedRole.permissions.filter((c) => c !== code)
      : [...selectedRole.permissions, code];
    setPending(new Set([code]));
    setError(null);
    setInfo(null);
    try {
      const updated = await apiPatch<RoleDto>(`/admin/roles/${selectedRole.id}`, {
        name: selectedRole.name,
        permissions: nextPermissions,
        rowVersion: selectedRole.rowVersion,
      });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setInfo(currentlyGranted ? `Revoked ${code}` : `Granted ${code}`);
    } catch (err) {
      // Surface the server's problem verbatim: SEGREGATION_OF_DUTIES details
      // name the conflicting pair and rationale (rbac.service.assertNoSoDConflicts).
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.problem.title ?? err.problem.code
          : "Could not update the role.",
      );
    } finally {
      setPending(new Set());
    }
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

        {/* Right: Selected Role Permission Matrix (editable for custom roles) */}
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
                <div className="alert alert-info py-2 px-3 small d-flex align-items-center justify-content-between mb-3">
                  <span>
                    This role holds <strong>{selectedRole.permissions.length} permissions</strong> — tick to grant, untick to revoke
                    {selectedRole.isSystem ? "" : canEdit ? "" : " (requires admin.role.update)"}.
                  </span>
                  {selectedRole.isSystem ? (
                    <span className="badge bg-info text-dark">Immutable Template</span>
                  ) : canEdit ? (
                    <span className="badge bg-success">Editable</span>
                  ) : (
                    <span className="badge bg-secondary">Read-only for you</span>
                  )}
                </div>

                {selectedRole.isSystem ? (
                  <div className="mb-3">
                    <AlertBanner severity="info">
                      System roles are template-managed. Clone this role (POST /admin/roles/:id/clone) to customize it.
                    </AlertBanner>
                  </div>
                ) : null}

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
                          const editable = !selectedRole.isSystem && canEdit && pending.size === 0;
                          return (
                            <tr key={p.code}>
                              <td>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={granted}
                                  disabled={!editable}
                                  onChange={() => toggle(p.code)}
                                  aria-label={`${granted ? "Revoke" : "Grant"} ${p.code} on ${selectedRole.name}`}
                                />
                              </td>
                              <td className={`font-monospace fw-semibold ${granted ? "text-primary" : "text-secondary"}`}>{p.code}</td>
                              <td><span className="badge bg-light text-dark border">{group.module}</span></td>
                              <td className="text-secondary">{p.description}</td>
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
