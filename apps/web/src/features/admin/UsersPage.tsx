import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill, Modal, Form } from "@clinic/ui";
import { apiGet, apiPost, apiPatch, apiPut, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import { useStepUpOptional, isStepUpRequired } from "../../shared/auth/StepUpContext.js";
import type { RoleDto, UserList, EmployeeUpsert } from "@clinic/contracts";

/**
 * Staff & User Directory (specification §18.2 lines 1029–1035, frontend §14.2).
 *
 * Live-backed against the admin user CRUD: list/create via /admin/users,
 * tenant-wide role assignment via PUT /admin/users/:id/roles, and the
 * lifecycle actions (deactivate/reactivate/unlock/reset-mfa/force-password-reset).
 * Every lifecycle action is 🔒 step-up protected on the server; the client
 * answers the 401 STEP_UP_REQUIRED challenge with the shared passphrase modal
 * and retries once.
 *
 * Reads degrade fail-soft: without admin.role.read the page still lists users
 * but disables role editing (assignment needs the role catalogue); every
 * mutation still fails closed server-side via PermissionGuard + ModuleGuard.
 */

const STATUS_TONES: Record<UserList["status"], "normal" | "pending" | "high" | "neutral"> = {
  ACTIVE: "normal",
  INVITED: "pending",
  LOCKED: "high",
  DEACTIVATED: "neutral",
};

function problemText(err: unknown, fallback: string): string {
  return err instanceof ApiError
    ? err.problem.detail ?? err.problem.title ?? err.problem.code
    : fallback;
}

export function UsersPage() {
  const { session } = useAuth();
  const { hasPermission } = usePermissions();
  const stepUp = useStepUpOptional();

  const canCreate = hasPermission("admin.user.create");
  const canUpdate = hasPermission("admin.user.update");
  const canDeactivate = hasPermission("admin.user.deactivate");
  const canReset = hasPermission("admin.user.reset");

  const [users, setUsers] = useState<UserList[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [rolesUnavailable, setRolesUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newBranchId, setNewBranchId] = useState("");
  const [newRoleIds, setNewRoleIds] = useState<Set<string>>(new Set());
  const [createMode, setCreateMode] = useState<"INVITE" | "DIRECT">("INVITE");
  const [createTempPassword, setCreateTempPassword] = useState("TempPassw0rd!2026");
  const [createBusy, setCreateBusy] = useState(false);

  // edit user modal
  const [editTarget, setEditTarget] = useState<UserList | null>(null);
  const [editName, setEditName] = useState("");
  const [editBranchId, setEditBranchId] = useState("");
  const [editRoleIds, setEditRoleIds] = useState<Set<string>>(new Set());
  const [editBusy, setEditBusy] = useState(false);

  // role editor modal
  const [roleTarget, setRoleTarget] = useState<UserList | null>(null);
  const [roleDraft, setRoleDraft] = useState<Set<string>>(new Set());
  const [roleBusy, setRoleBusy] = useState(false);

  // password modal
  const [pwTarget, setPwTarget] = useState<UserList | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // employee profile modal
  const [empTarget, setEmpTarget] = useState<UserList | null>(null);
  const [empNo, setEmpNo] = useState("");
  const [empTitle, setEmpTitle] = useState("");
  const [empDept, setEmpDept] = useState("Clinical Care");
  const [empType, setEmpType] = useState<EmployeeUpsert["employmentType"]>("FULL_TIME");
  const [empStatus, setEmpStatus] = useState<EmployeeUpsert["status"]>("ACTIVE");
  const [empSpec, setEmpSpec] = useState("");
  const [empPrc, setEmpPrc] = useState("");
  const [empPtr, setEmpPtr] = useState("");
  const [empS2, setEmpS2] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empHireDate, setEmpHireDate] = useState("");
  const [empEmergencyName, setEmpEmergencyName] = useState("");
  const [empEmergencyPhone, setEmpEmergencyPhone] = useState("");
  const [empEmergencyRel, setEmpEmergencyRel] = useState("");
  const [empBusy, setEmpBusy] = useState(false);

  const openEmployeeModal = (u: UserList) => {
    setEmpTarget(u);
    if (u.employee) {
      setEmpNo(u.employee.employeeNo);
      setEmpTitle(u.employee.jobTitle);
      setEmpDept(u.employee.department);
      setEmpType(u.employee.employmentType);
      setEmpStatus(u.employee.status);
      setEmpSpec(u.employee.specialization || "");
      setEmpPrc(u.employee.prcLicenseNo || "");
      setEmpPtr(u.employee.ptrNo || "");
      setEmpS2(u.employee.s2LicenseNo || "");
      setEmpPhone(u.employee.phone || "");
      setEmpHireDate(u.employee.hireDate || "");
      setEmpEmergencyName(u.employee.emergencyContactName || "");
      setEmpEmergencyPhone(u.employee.emergencyContactPhone || "");
      setEmpEmergencyRel(u.employee.emergencyContactRelationship || "");
    } else {
      setEmpNo(`EMP-${Math.floor(1000 + Math.random() * 9000)}`);
      setEmpTitle("Staff Member");
      setEmpDept("Clinical Care");
      setEmpType("FULL_TIME");
      setEmpStatus("ACTIVE");
      setEmpSpec("");
      setEmpPrc("");
      setEmpPtr("");
      setEmpS2("");
      setEmpPhone("");
      setEmpHireDate("");
      setEmpEmergencyName("");
      setEmpEmergencyPhone("");
      setEmpEmergencyRel("");
    }
  };

  const saveEmployee = async () => {
    if (!empTarget) return;
    if (!empNo.trim() || !empTitle.trim()) {
      setError("Employee number and job title are required.");
      return;
    }
    setEmpBusy(true);
    setError(null);
    try {
      const payload: EmployeeUpsert = {
        employeeNo: empNo.trim(),
        jobTitle: empTitle.trim(),
        department: empDept.trim(),
        employmentType: empType,
        status: empStatus,
        specialization: empSpec.trim() || undefined,
        prcLicenseNo: empPrc.trim() || undefined,
        ptrNo: empPtr.trim() || undefined,
        s2LicenseNo: empS2.trim() || undefined,
        phone: empPhone.trim() || undefined,
        hireDate: empHireDate || undefined,
        emergencyContactName: empEmergencyName.trim() || undefined,
        emergencyContactPhone: empEmergencyPhone.trim() || undefined,
        emergencyContactRelationship: empEmergencyRel.trim() || undefined,
        rowVersion: empTarget.employee?.rowVersion,
      };
      await apiPut(`/admin/users/${empTarget.id}/employee`, payload);
      setInfo(`Employee profile updated for ${empTarget.name} (${empNo.trim()}).`);
      setEmpTarget(null);
      await load();
    } catch (err) {
      setError(problemText(err, "Failed to save employee profile."));
    } finally {
      setEmpBusy(false);
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [userRows, roleRows, branchRows] = await Promise.all([
        apiGet<UserList[]>("/admin/users"),
        apiGet<RoleDto[]>("/admin/roles").catch(() => {
          // admin.user.read without admin.role.read is a legitimate role
          // shape — degrade to read-only directory rather than failing.
          setRolesUnavailable(true);
          return [] as RoleDto[];
        }),
        apiGet<Array<{ id: string; name: string }> | { branches: Array<{ id: string; name: string }> }>(
          "/admin/branches",
        ).catch(() => []),
      ]);
      const branchList = Array.isArray(branchRows)
        ? branchRows
        : Array.isArray((branchRows as { branches?: Array<{ id: string; name: string }> })?.branches)
        ? (branchRows as { branches: Array<{ id: string; name: string }> }).branches
        : [];
      setUsers(userRows);
      setRoles(roleRows);
      setBranches(branchList);
    } catch (err) {
      setError(problemText(err, "Could not load the staff directory."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        const q = search.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.roles.some((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
        );
      }),
    [users, search],
  );

  /** Run a mutation; on 401 STEP_UP_REQUIRED prompt once and retry. */
  const runWithStepUp = useCallback(
    async (action: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        if (isStepUpRequired(err) && stepUp) {
          const granted = await stepUp.requestStepUp(action);
          if (granted) {
            try {
              await run();
              return;
            } catch (retryErr) {
              setError(problemText(retryErr, "The action was refused."));
              return;
            }
          }
          return; // cancelled challenge
        }
        setError(problemText(err, "The action was refused."));
      }
    },
    [stepUp],
  );

  const createUser = async () => {
    if (createBusy) return;
    setCreateBusy(true);
    setError(null);
    try {
      const created = await apiPost<UserList>("/admin/users", {
        email: newEmail.trim(),
        name: newName.trim(),
        roleIds: [...newRoleIds],
      });

      if (newBranchId) {
        await apiPut(`/admin/users/${created.id}/branches`, {
          branchIds: [newBranchId],
          defaultBranchId: newBranchId,
        }).catch(() => {});
      }

      if (createMode === "DIRECT" && createTempPassword.trim()) {
        await runWithStepUp(`Set initial credential for ${created.name}`, async () => {
          await apiPost(`/admin/users/${created.id}/force-password-reset`, {
            newPassword: createTempPassword.trim(),
          });
        });
      }

      setInfo(
        createMode === "DIRECT"
          ? `${created.name} was created with an active account and assigned credential.`
          : `${created.name} was invited as ${created.status}. They set their own password via "Forgot password" on the sign-in screen.`,
      );
      setShowCreate(false);
      setNewEmail("");
      setNewName("");
      setNewBranchId("");
      setNewRoleIds(new Set());
      setCreateMode("INVITE");
      await load();
    } catch (err) {
      setError(problemText(err, "Could not create the user."));
    } finally {
      setCreateBusy(false);
    }
  };

  const openEdit = (u: UserList) => {
    setEditTarget(u);
    setEditName(u.name);
    const defaultBranch = u.branches.find((b) => b.isDefault)?.id || u.branches[0]?.id || "";
    setEditBranchId(defaultBranch);
    setEditRoleIds(new Set(u.roles.map((r) => r.id)));
    setError(null);
  };

  const saveEdit = async () => {
    if (!editTarget || editBusy) return;
    setEditBusy(true);
    setError(null);
    try {
      // 1. Update basic profile if name changed
      if (editName.trim() !== editTarget.name) {
        await apiPatch(`/admin/users/${editTarget.id}`, {
          name: editName.trim(),
          rowVersion: editTarget.rowVersion,
        });
      }

      // 2. Update branches if changed
      const currDefault = editTarget.branches.find((b) => b.isDefault)?.id || editTarget.branches[0]?.id || "";
      if (editBranchId !== currDefault) {
        await runWithStepUp(`Update branch assignment for ${editTarget.name}`, async () => {
          await apiPut(`/admin/users/${editTarget.id}/branches`, {
            branchIds: editBranchId ? [editBranchId] : [],
            defaultBranchId: editBranchId || null,
          });
        });
      }

      // 3. Update roles if changed
      const currentRoleIds = new Set(editTarget.roles.map((r) => r.id));
      const rolesChanged =
        editRoleIds.size !== currentRoleIds.size || [...editRoleIds].some((id) => !currentRoleIds.has(id));
      if (rolesChanged) {
        await runWithStepUp(`Assign roles to ${editTarget.name}`, async () => {
          await apiPut(`/admin/users/${editTarget.id}/roles`, {
            roleIds: [...editRoleIds],
            branchId: null,
          });
        });
      }

      setInfo(`Staff details updated for ${editName.trim()}.`);
      setEditTarget(null);
      await load();
    } catch (err) {
      setError(problemText(err, "Could not update user details."));
    } finally {
      setEditBusy(false);
    }
  };

  const openRoles = (u: UserList) => {
    setRoleTarget(u);
    setRoleDraft(new Set(u.roles.map((r) => r.id)));
    setError(null);
  };

  const saveRoles = async () => {
    if (!roleTarget || roleBusy) return;
    setRoleBusy(true);
    setError(null);
    await runWithStepUp(`Assign roles to ${roleTarget.name}`, async () => {
      await apiPut(`/admin/users/${roleTarget.id}/roles`, {
        roleIds: [...roleDraft],
        branchId: null,
      });
      // Optimistic update of local state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === roleTarget.id ? { ...u, roles: roles.filter((r) => roleDraft.has(r.id)) } : u,
        ),
      );
      setInfo(`Roles updated for ${roleTarget.name}.`);
      setRoleTarget(null);
      await load();
    });
    setRoleBusy(false);
  };

  const lifecycle = (u: UserList, action: "deactivate" | "reactivate" | "unlock" | "reset-mfa") => {
    void runWithStepUp(`${action} ${u.name}`, async () => {
      await apiPost(`/admin/users/${u.id}/${action}`);
      setInfo(`${action.replace("-", " ")} completed for ${u.name}.`);
      await load();
    });
  };

  const submitPassword = async () => {
    if (!pwTarget || pwBusy) return;
    setPwBusy(true);
    setError(null);
    await runWithStepUp(`Force password reset for ${pwTarget.name}`, async () => {
      await apiPost(`/admin/users/${pwTarget.id}/force-password-reset`, { newPassword });
      setInfo(`Password replaced for ${pwTarget.name}; all their sessions were signed out.`);
      setPwTarget(null);
      setNewPassword("");
      await load();
    });
    setPwBusy(false);
  };

  const roleEditorEditable = canUpdate && !rolesUnavailable;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff &amp; User Directory</h1>
          <div className="page-subtitle">
            Manage staff accounts, tenant-wide role assignments, and credential lifecycle
            {session?.tenantSlug ? <span className="ms-2 font-monospace small">tenant: {session.tenantSlug}</span> : null}
          </div>
        </div>
        <div className="d-flex gap-2">
          <Link to="/admin/approvals" className="btn btn-outline-secondary">
            Pending Approvals
          </Link>
          <Link
            to="/admin/users/new"
            className={`btn btn-cerulean ${canCreate ? "" : "disabled"}`}
            aria-disabled={!canCreate}
            title={canCreate ? undefined : "Requires admin.user.create"}
          >
            + Create Staff User
          </Link>
          <button
            type="button"
            className="btn btn-outline-primary"
            disabled={!canCreate}
            title={canCreate ? undefined : "Requires admin.user.create"}
            onClick={() => setShowCreate(true)}
          >
            + Invite Staff User
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <AlertBanner severity="danger" title="Action refused">{error}</AlertBanner>
        </div>
      ) : null}
      {info ? (
        <div className="mb-3">
          <AlertBanner severity="success">{info}</AlertBanner>
        </div>
      ) : null}

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
            {isLoading ? "loading…" : `Displaying ${filtered.length} of ${users.length} staff accounts`}
          </span>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>STAFF MEMBER</th>
                <th>ROLES</th>
                <th>BRANCH</th>
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
                    {u.employee ? (
                      <div className="mt-1 d-flex align-items-center gap-1">
                        <span className="badge bg-light text-dark border font-monospace" style={{ fontSize: "0.7rem" }}>
                          {u.employee.employeeNo}
                        </span>
                        <span className="small text-muted" style={{ fontSize: "0.75rem" }}>
                          {u.employee.jobTitle}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {u.roles.length === 0 ? (
                      <span className="small text-muted">no tenant-wide roles</span>
                    ) : (
                      u.roles.map((r) => (
                        <span
                          key={r.id}
                          className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 me-1"
                        >
                          {r.name}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    {u.branches.length > 0 ? (
                      u.branches.map((b) => (
                        <span key={b.id} className="badge bg-light text-dark border me-1">
                          {b.name} {b.isDefault ? "★" : ""}
                        </span>
                      ))
                    ) : (
                      <span className="small text-muted">—</span>
                    )}
                  </td>
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
                  <td className="small text-muted">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "— never —"}
                  </td>
                  <td>
                    <StatusPill tone={STATUS_TONES[u.status]} label={u.status} />
                  </td>
                  <td className="text-end">
                    <div className="d-flex gap-1 justify-content-end flex-wrap">
                      {canUpdate ? (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openEdit(u)}>
                          Edit
                        </button>
                      ) : null}
                      {canUpdate ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-info"
                          onClick={() => openEmployeeModal(u)}
                          title="View / Edit Tied Employee Profile"
                        >
                          🪪 HR Profile
                        </button>
                      ) : null}
                      {roleEditorEditable ? (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => openRoles(u)}>
                          Roles
                        </button>
                      ) : null}
                      {canReset && u.status === "LOCKED" ? (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => lifecycle(u, "unlock")}>
                          Unlock
                        </button>
                      ) : null}
                      {canReset ? (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPwTarget(u)}>
                          Reset password
                        </button>
                      ) : null}
                      {canReset && u.mfaEnabled ? (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => lifecycle(u, "reset-mfa")}>
                          Reset MFA
                        </button>
                      ) : null}
                      {canDeactivate && u.status !== "DEACTIVATED" ? (
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => lifecycle(u, "deactivate")}>
                          Deactivate
                        </button>
                      ) : null}
                      {canDeactivate && u.status === "DEACTIVATED" ? (
                        <button type="button" className="btn btn-sm btn-outline-success" onClick={() => lifecycle(u, "reactivate")}>
                          Reactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
                    No staff accounts match the search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create (invite / direct) modal */}
      <Modal show={showCreate} onHide={() => setShowCreate(false)} centered aria-labelledby="create-title">
        <Modal.Header closeButton>
          <Modal.Title id="create-title">Create / Invite Staff User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex gap-3 mb-3 pb-2 border-bottom">
            <Form.Check
              type="radio"
              id="mode-invite"
              name="create-mode"
              label="Send Invitation (User sets password)"
              checked={createMode === "INVITE"}
              onChange={() => setCreateMode("INVITE")}
            />
            <Form.Check
              type="radio"
              id="mode-direct"
              name="create-mode"
              label="Direct Activation (Admin sets password)"
              checked={createMode === "DIRECT"}
              onChange={() => setCreateMode("DIRECT")}
            />
          </div>

          <Form.Group controlId="invite-name" className="mb-3">
            <Form.Label>Full name</Form.Label>
            <Form.Control value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus placeholder="e.g. Dr. Maria Santos" />
          </Form.Group>
          <Form.Group controlId="invite-email" className="mb-3">
            <Form.Label>Work email</Form.Label>
            <Form.Control type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="e.g. maria.santos@clinic.ph" />
          </Form.Group>

          {branches.length > 0 && (
            <Form.Group controlId="invite-branch" className="mb-3">
              <Form.Label>Primary Branch Assignment</Form.Label>
              <Form.Select value={newBranchId} onChange={(e) => setNewBranchId(e.target.value)}>
                <option value="">— Select branch (optional) —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          {createMode === "DIRECT" && (
            <Form.Group controlId="create-temp-password" className="mb-3">
              <Form.Label>Initial Password *</Form.Label>
              <Form.Control
                type="password"
                value={createTempPassword}
                onChange={(e) => setCreateTempPassword(e.target.value)}
              />
              <Form.Text muted>Minimum 12 characters with upper case, lower case, and a digit.</Form.Text>
            </Form.Group>
          )}

          <Form.Group controlId="invite-roles" className="mb-1">
            <Form.Label>Tenant-wide roles {rolesUnavailable ? "(unavailable without admin.role.read)" : ""}</Form.Label>
            <div style={{ maxHeight: "10rem", overflowY: "auto" }} className="border rounded p-2">
              {roles.map((r) => (
                <Form.Check
                  key={r.id}
                  id={`invite-role-${r.id}`}
                  type="checkbox"
                  label={`${r.name} (${r.code})`}
                  checked={newRoleIds.has(r.id)}
                  onChange={() =>
                    setNewRoleIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
              ))}
              {roles.length === 0 ? <span className="small text-muted">No roles visible.</span> : null}
            </div>
            <Form.Text muted>
              Roles holding mutually exclusive permissions (SoD) are refused by the server.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCreate(false)} disabled={createBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-cerulean"
            disabled={createBusy || newName.trim().length === 0 || newEmail.trim().length === 0}
            onClick={() => void createUser()}
          >
            {createBusy ? "Creating…" : createMode === "DIRECT" ? "Create Active User" : "Create Invitation"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Edit user modal */}
      <Modal show={editTarget !== null} onHide={() => setEditTarget(null)} centered aria-labelledby="edit-user-title">
        <Modal.Header closeButton>
          <Modal.Title id="edit-user-title">Edit Staff Member — {editTarget?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="edit-user-name" className="mb-3">
            <Form.Label>Full Name *</Form.Label>
            <Form.Control
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Full name"
            />
          </Form.Group>

          <Form.Group controlId="edit-user-email" className="mb-3">
            <Form.Label>Work Email</Form.Label>
            <Form.Control value={editTarget?.email || ""} disabled readOnly />
            <Form.Text muted>Work email cannot be changed once created for tenant isolation.</Form.Text>
          </Form.Group>

          {Array.isArray(branches) && branches.length > 0 && (
            <Form.Group controlId="edit-user-branch" className="mb-3">
              <Form.Label>Primary Branch Assignment</Form.Label>
              <Form.Select value={editBranchId} onChange={(e) => setEditBranchId(e.target.value)}>
                <option value="">— No branch assigned —</option>
                {(Array.isArray(branches) ? branches : []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          <Form.Group controlId="edit-user-roles" className="mb-1">
            <Form.Label>Assigned Roles</Form.Label>
            <div style={{ maxHeight: "10rem", overflowY: "auto" }} className="border rounded p-2">
              {roles.map((r) => (
                <Form.Check
                  key={r.id}
                  id={`edit-target-role-${r.id}`}
                  type="checkbox"
                  label={`${r.name} (${r.code})`}
                  checked={editRoleIds.has(r.id)}
                  onChange={() =>
                    setEditRoleIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setEditTarget(null)} disabled={editBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-cerulean"
            disabled={editBusy || editName.trim().length === 0}
            onClick={() => void saveEdit()}
          >
            {editBusy ? "Saving…" : "Save Changes"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Role editor modal */}
      <Modal show={roleTarget !== null} onHide={() => setRoleTarget(null)} centered aria-labelledby="roles-title">
        <Modal.Header closeButton>
          <Modal.Title id="roles-title">Roles for {roleTarget?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">
            Replaces this member&rsquo;s <strong>tenant-wide</strong> grants. Segregation-of-duties is checked against the
            final permission union — a conflicting combination is refused with the server&rsquo;s explanation.
          </p>
          {roles.map((r) => (
            <Form.Check
              key={r.id}
              id={`edit-role-${r.id}`}
              type="checkbox"
              label={`${r.name} (${r.code})`}
              checked={roleDraft.has(r.id)}
              onChange={() =>
                setRoleDraft((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.id)) next.delete(r.id);
                  else next.add(r.id);
                  return next;
                })
              }
            />
          ))}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setRoleTarget(null)} disabled={roleBusy}>
            Cancel
          </button>
          <button type="button" className="btn btn-cerulean" disabled={roleBusy} onClick={() => void saveRoles()}>
            {roleBusy ? "Saving…" : "Save roles"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Force password reset modal */}
      <Modal show={pwTarget !== null} onHide={() => setPwTarget(null)} centered aria-labelledby="pw-title">
        <Modal.Header closeButton>
          <Modal.Title id="pw-title">Force password reset — {pwTarget?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">
            Sets a new credential and signs out every active session for this member. Share the new secret through your
            approved out-of-band channel; the platform never emails passwords.
          </p>
          <Form.Group controlId="force-password">
            <Form.Label>New password</Form.Label>
            <Form.Control
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
            <Form.Text muted>Minimum 12 characters with upper case, lower case, and a digit.</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setPwTarget(null)} disabled={pwBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={pwBusy || newPassword.length === 0}
            onClick={() => void submitPassword()}
          >
            {pwBusy ? "Resetting…" : "Reset password"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* Employee Profile Modal */}
      {empTarget ? (
        <Modal show animation={false} onHide={() => setEmpTarget(null)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>
              {empTarget.employee ? `Employee Profile: ${empTarget.name}` : `Link Employee Profile: ${empTarget.name}`}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="small text-muted mb-3">
              Official HR details, professional licensure, and emergency contacts tied directly to user account <strong>{empTarget.email}</strong>.
            </p>
            <div className="row g-3">
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-no">
                  <Form.Label className="fw-semibold small">Employee ID *</Form.Label>
                  <Form.Control
                    value={empNo}
                    onChange={(e) => setEmpNo(e.target.value)}
                    placeholder="e.g. EMP-1002"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-title">
                  <Form.Label className="fw-semibold small">Job Title / Designation *</Form.Label>
                  <Form.Control
                    value={empTitle}
                    onChange={(e) => setEmpTitle(e.target.value)}
                    placeholder="e.g. Attending Physician"
                  />
                </Form.Group>
              </div>
              <div className="col-md-4">
                <Form.Group controlId="modal-emp-dept">
                  <Form.Label className="fw-semibold small">Department</Form.Label>
                  <Form.Select value={empDept} onChange={(e) => setEmpDept(e.target.value)}>
                    <option value="Clinical Care">Clinical Care</option>
                    <option value="Nursing">Nursing</option>
                    <option value="Pharmacy">Pharmacy</option>
                    <option value="Laboratory">Laboratory</option>
                    <option value="Billing & Cashiering">Billing & Cashiering</option>
                    <option value="Administration & HR">Administration & HR</option>
                  </Form.Select>
                </Form.Group>
              </div>
              <div className="col-md-4">
                <Form.Group controlId="modal-emp-type">
                  <Form.Label className="fw-semibold small">Employment Type</Form.Label>
                  <Form.Select value={empType} onChange={(e) => setEmpType(e.target.value as any)}>
                    <option value="FULL_TIME">Full Time</option>
                    <option value="PART_TIME">Part Time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="CONSULTANT">Consultant</option>
                    <option value="INTERN">Intern</option>
                  </Form.Select>
                </Form.Group>
              </div>
              <div className="col-md-4">
                <Form.Group controlId="modal-emp-status">
                  <Form.Label className="fw-semibold small">HR Status</Form.Label>
                  <Form.Select value={empStatus} onChange={(e) => setEmpStatus(e.target.value as any)}>
                    <option value="ACTIVE">Active</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="PROBATION">Probation</option>
                    <option value="RESIGNED">Resigned</option>
                    <option value="TERMINATED">Terminated</option>
                  </Form.Select>
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-spec">
                  <Form.Label className="fw-semibold small">Specialization</Form.Label>
                  <Form.Control
                    value={empSpec}
                    onChange={(e) => setEmpSpec(e.target.value)}
                    placeholder="e.g. Internal Medicine"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-prc">
                  <Form.Label className="fw-semibold small">PRC License Number</Form.Label>
                  <Form.Control
                    value={empPrc}
                    onChange={(e) => setEmpPrc(e.target.value)}
                    placeholder="e.g. PRC-0123456"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-ptr">
                  <Form.Label className="fw-semibold small">PTR Number</Form.Label>
                  <Form.Control
                    value={empPtr}
                    onChange={(e) => setEmpPtr(e.target.value)}
                    placeholder="e.g. PTR-789012"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-s2">
                  <Form.Label className="fw-semibold small">S2 Narcotics License</Form.Label>
                  <Form.Control
                    value={empS2}
                    onChange={(e) => setEmpS2(e.target.value)}
                    placeholder="e.g. S2-345678"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-phone">
                  <Form.Label className="fw-semibold small">Contact Phone Number</Form.Label>
                  <Form.Control
                    value={empPhone}
                    onChange={(e) => setEmpPhone(e.target.value)}
                    placeholder="e.g. +63 917 123 4567"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="modal-emp-hire">
                  <Form.Label className="fw-semibold small">Hire Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={empHireDate}
                    onChange={(e) => setEmpHireDate(e.target.value)}
                  />
                </Form.Group>
              </div>
              <div className="col-12 border-top pt-3">
                <h6 className="small text-uppercase fw-bold text-secondary mb-2">Emergency Contact</h6>
                <div className="row g-2">
                  <div className="col-md-5">
                    <Form.Control
                      placeholder="Contact Name"
                      value={empEmergencyName}
                      onChange={(e) => setEmpEmergencyName(e.target.value)}
                    />
                  </div>
                  <div className="col-md-3">
                    <Form.Control
                      placeholder="Relationship"
                      value={empEmergencyRel}
                      onChange={(e) => setEmpEmergencyRel(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4">
                    <Form.Control
                      placeholder="Phone"
                      value={empEmergencyPhone}
                      onChange={(e) => setEmpEmergencyPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setEmpTarget(null)}
              disabled={empBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-cerulean"
              disabled={empBusy}
              onClick={() => void saveEmployee()}
            >
              {empBusy ? "Saving…" : "Save Employee Profile"}
            </button>
          </Modal.Footer>
        </Modal>
      ) : null}
    </div>
  );
}
