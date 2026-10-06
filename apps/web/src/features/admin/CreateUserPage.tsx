import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost, apiPut, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import { useStepUpOptional, isStepUpRequired } from "../../shared/auth/StepUpContext.js";
import type { RoleDto, UserList } from "@clinic/contracts";

/**
 * Direct User Creation CRUD (specification §18.2 lines 1029–1035, frontend §14.2).
 *
 * Provides a dedicated, full-page CRUD workflow for provisioning new staff accounts.
 * Accessible directly from the navigation under Tenant Administration (/admin/users/new).
 *
 * Supports two onboarding modes:
 *  1. DIRECT: Immediately activates the account and sets an administrator-defined
 *     initial password (with built-in generator and clipboard copy).
 *  2. INVITE: Provisions the account in INVITED state so the user completes setup
 *     via email invitation.
 */

function generateInitialPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  let pwd = "ClinicPass-2026!";
  for (let i = 0; i < 4; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

function problemText(err: unknown, fallback: string): string {
  return err instanceof ApiError
    ? err.problem.detail ?? err.problem.title ?? err.problem.code
    : fallback;
}

interface CreatedResult {
  user: UserList;
  password?: string;
  mode: "DIRECT" | "INVITE";
  branchName?: string;
  roleNames: string[];
}

export function CreateUserPage() {
  const { session } = useAuth();
  const { hasPermission } = usePermissions();
  const stepUp = useStepUpOptional();
  const navigate = useNavigate();

  const canCreate = hasPermission("admin.user.create");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [branchId, setBranchId] = useState("");
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"DIRECT" | "INVITE">("DIRECT");
  const [password, setPassword] = useState(() => generateInitialPassword());
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  // Employee Information tied to user profile
  const [includeEmployee, setIncludeEmployee] = useState(false);
  const [employeeNo, setEmployeeNo] = useState(() => `EMP-${Math.floor(1000 + Math.random() * 9000)}`);
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("Clinical Care");
  const [employmentType, setEmploymentType] = useState<"FULL_TIME" | "PART_TIME" | "CONTRACT" | "CONSULTANT" | "INTERN">("FULL_TIME");
  const [specialization, setSpecialization] = useState("");
  const [prcLicenseNo, setPrcLicenseNo] = useState("");
  const [phone, setPhone] = useState("");

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<CreatedResult | null>(null);

  const loadData = useCallback(async () => {
    setIsLoadingData(true);
    setError(null);
    try {
      const [branchRes, roleRows] = await Promise.all([
        apiGet<Array<{ id: string; name: string }> | { branches: Array<{ id: string; name: string }> }>(
          "/admin/branches",
        ).catch(() => []),
        apiGet<RoleDto[]>("/admin/roles").catch(() => []),
      ]);
      const branchList = Array.isArray(branchRes)
        ? branchRes
        : Array.isArray((branchRes as { branches?: Array<{ id: string; name: string }> })?.branches)
        ? (branchRes as { branches: Array<{ id: string; name: string }> }).branches
        : [];
      setBranches(branchList);
      setRoles(Array.isArray(roleRows) ? roleRows : []);
      if (branchList.length > 0) {
        setBranchId((prev) => prev || branchList[0]!.id);
      }
    } catch (err) {
      setError(problemText(err, "Failed to load reference branches or roles."));
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runWithStepUp = useCallback(
    async (action: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        if (isStepUpRequired(err) && stepUp) {
          const granted = await stepUp.requestStepUp(action);
          if (granted) {
            await run();
            return;
          }
          throw new Error("Step-up authentication was cancelled.");
        }
        throw err;
      }
    },
    [stepUp],
  );

  const toggleRole = (id: string) => {
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllRoles = () => {
    setRoleIds(new Set(roles.map((r) => r.id)));
  };

  const clearRoles = () => {
    setRoleIds(new Set());
  };

  const handleCopyCredentials = async () => {
    if (!createdResult?.password) return;
    const text = `Clinic Platform Credentials\nEmail: ${createdResult.user.email}\nInitial Password: ${createdResult.password}\nLogin URL: ${window.location.origin}/login`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) {
      setError("You do not have permission to create staff accounts (requires admin.user.create).");
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedName) {
      setError("Full name is required.");
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("A valid work email address is required.");
      return;
    }
    if (mode === "DIRECT" && !trimmedPassword) {
      setError("An initial password is required for direct activation.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const employeePayload = includeEmployee && employeeNo.trim() && jobTitle.trim() ? {
        employeeNo: employeeNo.trim(),
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        employmentType,
        specialization: specialization.trim() || undefined,
        prcLicenseNo: prcLicenseNo.trim() || undefined,
        phone: phone.trim() || undefined,
      } : undefined;

      // 1. Create User via POST /admin/users
      const created = await apiPost<UserList>("/admin/users", {
        name: trimmedName,
        email: trimmedEmail,
        roleIds: [...roleIds],
        employee: employeePayload,
      });

      // 2. Assign Primary Branch if selected
      if (branchId) {
        await apiPut(`/admin/users/${created.id}/branches`, {
          branchIds: [branchId],
          defaultBranchId: branchId,
        }).catch(() => {
          // Non-blocking branch assignment failure
        });
      }

      // 3. In DIRECT mode, set the initial temporary password
      if (mode === "DIRECT" && trimmedPassword) {
        await runWithStepUp(`Set initial credential for ${created.name}`, async () => {
          await apiPost(`/admin/users/${created.id}/force-password-reset`, {
            newPassword: trimmedPassword,
          });
        });
      }

      const assignedBranchObj = branches.find((b) => b.id === branchId);
      const assignedRoleNames = roles.filter((r) => roleIds.has(r.id)).map((r) => r.name);

      setCreatedResult({
        user: created,
        password: mode === "DIRECT" ? trimmedPassword : undefined,
        mode,
        branchName: assignedBranchObj?.name,
        roleNames: assignedRoleNames,
      });
    } catch (err) {
      setError(problemText(err, "Could not create user account. Please check the inputs."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForAnother = () => {
    setName("");
    setEmail("");
    setPassword(generateInitialPassword());
    setRoleIds(new Set());
    setCreatedResult(null);
    setError(null);
  };

  return (
    <div className="container-fluid p-0">
      {/* Page Header */}
      <div className="page-header d-flex justify-content-between align-items-center mb-4">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 small">
              <li className="breadcrumb-item">
                <Link to="/admin/users" className="text-decoration-none">
                  Staff &amp; Users
                </Link>
              </li>
              <li className="breadcrumb-item active" aria-current="page">
                Create User
              </li>
            </ol>
          </nav>
          <h1 className="page-title mb-1">Create Staff User</h1>
          <div className="page-subtitle text-muted">
            Directly provision a staff member, assign clinic roles, set default branch, and configure access credentials
            {session?.tenantSlug ? <span className="ms-2 font-monospace badge bg-light text-dark border">clinic: {session.tenantSlug}</span> : null}
          </div>
        </div>
        <div>
          <Link to="/admin/users" className="btn btn-outline-secondary">
            ← Staff Directory
          </Link>
        </div>
      </div>

      {/* Error alert banner */}
      {error ? (
        <div className="mb-4">
          <AlertBanner severity="danger" title="Creation Failed">
            {error}
          </AlertBanner>
        </div>
      ) : null}

      {/* Permission guard warning */}
      {!canCreate ? (
        <div className="mb-4">
          <AlertBanner severity="warning" title="Restricted Action">
            Your current account role does not hold the <code>admin.user.create</code> permission. You may inspect this form, but account creation requests will be refused by the server.
          </AlertBanner>
        </div>
      ) : null}

      {/* Success View */}
      {createdResult ? (
        <div className="clinic-card border-success shadow-sm mb-4">
          <div className="clinic-card-header bg-success text-white d-flex align-items-center justify-content-between py-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ fontSize: "1.3rem" }}>✅</span>
              <strong className="fs-5">Staff Member Successfully Created!</strong>
            </div>
            <StatusPill
              tone={createdResult.mode === "DIRECT" ? "normal" : "pending"}
              label={createdResult.mode === "DIRECT" ? "ACTIVE" : "INVITED"}
            />
          </div>
          <div className="clinic-card-body p-4">
            <p className="lead mb-4">
              <strong>{createdResult.user.name}</strong> ({createdResult.user.email}) has been provisioned under clinic{" "}
              <code>{session?.tenantSlug || "current"}</code>.
            </p>

            <div className="row g-4 mb-4">
              <div className="col-md-6">
                <div className="p-3 bg-light rounded border">
                  <h6 className="text-secondary text-uppercase small fw-bold mb-3">Account Details</h6>
                  <div className="mb-2">
                    <span className="text-muted small d-block">Full Name</span>
                    <strong>{createdResult.user.name}</strong>
                  </div>
                  <div className="mb-2">
                    <span className="text-muted small d-block">Work Email</span>
                    <strong>{createdResult.user.email}</strong>
                  </div>
                  <div className="mb-2">
                    <span className="text-muted small d-block">Assigned Branch</span>
                    <span>{createdResult.branchName || "Default Clinic Location"}</span>
                  </div>
                  <div>
                    <span className="text-muted small d-block mb-1">Assigned Roles</span>
                    {createdResult.roleNames.length > 0 ? (
                      <div className="d-flex flex-wrap gap-1">
                        {createdResult.roleNames.map((r) => (
                          <span key={r} className="badge bg-primary text-white">
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted fst-italic small">No specific tenant roles assigned</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-md-6">
                {createdResult.mode === "DIRECT" && createdResult.password ? (
                  <div className="p-3 bg-light rounded border h-100 d-flex flex-column justify-content-between">
                    <div>
                      <h6 className="text-secondary text-uppercase small fw-bold mb-3">Immediate Sign-In Credentials</h6>
                      <div className="mb-3">
                        <span className="text-muted small d-block">Initial Temporary Password</span>
                        <div className="input-group mt-1">
                          <input
                            type="text"
                            readOnly
                            className="form-control font-monospace fw-bold bg-white"
                            value={createdResult.password}
                          />
                          <button
                            type="button"
                            className="btn btn-outline-primary"
                            onClick={handleCopyCredentials}
                          >
                            {copied ? "Copied! ✓" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <p className="small text-muted mb-0">
                        💡 Provide this password to the staff member. They can immediately log in at{" "}
                        <code>/login</code> with their email and this password.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-light rounded border h-100">
                    <h6 className="text-secondary text-uppercase small fw-bold mb-3">Invitation Status</h6>
                    <p className="small text-muted mb-2">
                      The user has been placed into <strong>INVITED</strong> status. They can complete registration and set their credentials by selecting &quot;Forgot password&quot; or using the invitation link.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="d-flex gap-3 pt-3 border-top">
              <button
                type="button"
                className="btn btn-cerulean"
                onClick={() => navigate("/admin/users")}
              >
                Go to Staff Directory
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={handleResetForAnother}
              >
                + Create Another Staff User
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* User Creation CRUD Form */
        <form noValidate onSubmit={handleSubmit}>
          <div className="row g-4">
            {/* Left Column: Account Details & Authentication Mode */}
            <div className="col-lg-7">
              {/* Card 1: Onboarding Mode */}
              <div className="clinic-card mb-4 shadow-sm">
                <div className="clinic-card-header">
                  <h5 className="m-0 fs-6 fw-bold">1. Onboarding Mode</h5>
                </div>
                <div className="clinic-card-body p-3">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div
                        className={`p-3 border rounded h-100 cursor-pointer ${
                          mode === "DIRECT" ? "border-primary bg-light" : "bg-white"
                        }`}
                        onClick={() => setMode("DIRECT")}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            name="userCreateMode"
                            id="modeDirect"
                            checked={mode === "DIRECT"}
                            onChange={() => setMode("DIRECT")}
                          />
                          <label className="form-check-label fw-bold d-block cursor-pointer" htmlFor="modeDirect">
                            ⚡ Direct Activation
                          </label>
                        </div>
                        <p className="small text-muted mt-2 mb-0">
                          Create an active account immediately with an administrator-defined temporary password. No waiting for email confirmation.
                        </p>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div
                        className={`p-3 border rounded h-100 cursor-pointer ${
                          mode === "INVITE" ? "border-primary bg-light" : "bg-white"
                        }`}
                        onClick={() => setMode("INVITE")}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            name="userCreateMode"
                            id="modeInvite"
                            checked={mode === "INVITE"}
                            onChange={() => setMode("INVITE")}
                          />
                          <label className="form-check-label fw-bold d-block cursor-pointer" htmlFor="modeInvite">
                            ✉️ Send Invitation
                          </label>
                        </div>
                        <p className="small text-muted mt-2 mb-0">
                          Account is created in <code>INVITED</code> state. Staff member sets their own password when signing in.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Personal & Work Profile */}
              <div className="clinic-card mb-4 shadow-sm">
                <div className="clinic-card-header">
                  <h5 className="m-0 fs-6 fw-bold">2. Staff Profile</h5>
                </div>
                <div className="clinic-card-body p-3">
                  <div className="row g-3">
                    <div className="col-12">
                      <label htmlFor="userFullName" className="form-label fw-semibold small">
                        Full Name <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        id="userFullName"
                        className="form-control"
                        placeholder="e.g. Dr. Maria Clara Santos, MD"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        disabled={isSubmitting}
                      />
                      <div className="form-text small text-muted">
                        Official staff name as it will appear on prescriptions, lab reports, and audit trails.
                      </div>
                    </div>

                    <div className="col-12">
                      <label htmlFor="userEmail" className="form-label fw-semibold small">
                        Work Email Address <span className="text-danger">*</span>
                      </label>
                      <input
                        type="email"
                        id="userEmail"
                        className="form-control"
                        placeholder="e.g. m.santos@demo-a.test"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isSubmitting}
                      />
                      <div className="form-text small text-muted">
                        Must be a unique email address under this clinic tenant. Used for signing in.
                      </div>
                    </div>

                    <div className="col-12">
                      <label htmlFor="userBranch" className="form-label fw-semibold small">
                        Primary Clinic Branch
                      </label>
                      <select
                        id="userBranch"
                        className="form-select"
                        value={branchId}
                        onChange={(e) => setBranchId(e.target.value)}
                        disabled={isSubmitting || isLoadingData}
                      >
                        <option value="">Default Branch / All Units</option>
                        {(Array.isArray(branches) ? branches : []).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <div className="form-text small text-muted">
                        Designates the primary service location or branch where the staff member operates.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Employee & HR Information (Tied to User Profile) */}
              <div className="clinic-card mb-4 shadow-sm">
                <div className="clinic-card-header d-flex align-items-center justify-content-between">
                  <div className="d-flex align-items-center gap-2">
                    <h5 className="m-0 fs-6 fw-bold">3. Employee &amp; HR Profile</h5>
                    <span className="badge bg-light text-secondary border">Optional</span>
                  </div>
                  <div className="form-check form-switch m-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="toggleEmployeeProfile"
                      checked={includeEmployee}
                      onChange={(e) => setIncludeEmployee(e.target.checked)}
                    />
                    <label className="form-check-label small fw-semibold cursor-pointer" htmlFor="toggleEmployeeProfile">
                      Tie Employee Profile
                    </label>
                  </div>
                </div>
                {includeEmployee ? (
                  <div className="clinic-card-body p-3">
                    <p className="small text-muted mb-3">
                      Establishes an official employee record tied directly to this user account with job designation and licensure.
                    </p>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label htmlFor="empNoInput" className="form-label fw-semibold small">
                          Employee ID *
                        </label>
                        <input
                          type="text"
                          id="empNoInput"
                          className="form-control font-monospace"
                          value={employeeNo}
                          onChange={(e) => setEmployeeNo(e.target.value)}
                          placeholder="e.g. EMP-1002"
                        />
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="empTitleInput" className="form-label fw-semibold small">
                          Job Title / Designation *
                        </label>
                        <input
                          type="text"
                          id="empTitleInput"
                          className="form-control"
                          value={jobTitle}
                          onChange={(e) => setJobTitle(e.target.value)}
                          placeholder="e.g. Attending Physician"
                        />
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="empDeptInput" className="form-label fw-semibold small">
                          Department
                        </label>
                        <select
                          id="empDeptInput"
                          className="form-select"
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                        >
                          <option value="Clinical Care">Clinical Care</option>
                          <option value="Nursing">Nursing</option>
                          <option value="Pharmacy">Pharmacy</option>
                          <option value="Laboratory">Laboratory</option>
                          <option value="Billing & Cashiering">Billing & Cashiering</option>
                          <option value="Administration & HR">Administration & HR</option>
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="empTypeInput" className="form-label fw-semibold small">
                          Employment Type
                        </label>
                        <select
                          id="empTypeInput"
                          className="form-select"
                          value={employmentType}
                          onChange={(e) => setEmploymentType(e.target.value as any)}
                        >
                          <option value="FULL_TIME">Full Time</option>
                          <option value="PART_TIME">Part Time</option>
                          <option value="CONTRACT">Contract</option>
                          <option value="CONSULTANT">Consultant</option>
                          <option value="INTERN">Intern</option>
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="empPrcInput" className="form-label fw-semibold small">
                          PRC License Number
                        </label>
                        <input
                          type="text"
                          id="empPrcInput"
                          className="form-control font-monospace"
                          value={prcLicenseNo}
                          onChange={(e) => setPrcLicenseNo(e.target.value)}
                          placeholder="e.g. PRC-0123456"
                        />
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="empPhoneInput" className="form-label fw-semibold small">
                          Contact Phone Number
                        </label>
                        <input
                          type="text"
                          id="empPhoneInput"
                          className="form-control"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="e.g. +63 917 123 4567"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Card 3: Credential Configuration (Direct Mode only) */}
              {mode === "DIRECT" ? (
                <div className="clinic-card mb-4 shadow-sm">
                  <div className="clinic-card-header d-flex align-items-center justify-content-between">
                    <h5 className="m-0 fs-6 fw-bold">3. Access Credentials</h5>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setPassword(generateInitialPassword())}
                    >
                      🎲 Generate New Password
                    </button>
                  </div>
                  <div className="clinic-card-body p-3">
                    <label htmlFor="userPassword" className="form-label fw-semibold small">
                      Initial Temporary Password <span className="text-danger">*</span>
                    </label>
                    <div className="input-group">
                      <input
                        type={showPassword ? "text" : "password"}
                        id="userPassword"
                        className="form-control font-monospace"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required={mode === "DIRECT"}
                        disabled={isSubmitting}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => setShowPassword((prev) => !prev)}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <div className="form-text small text-muted">
                      Password policy requires at least 8 characters with numbers and special symbols. The staff member will be prompted to reset upon first login.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right Column: Role Assignment & Action Summary */}
            <div className="col-lg-5">
              {/* Card 4: Role Selection */}
              <div className="clinic-card mb-4 shadow-sm">
                <div className="clinic-card-header d-flex align-items-center justify-content-between">
                  <h5 className="m-0 fs-6 fw-bold">Tenant Roles &amp; Permissions</h5>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      onClick={selectAllRoles}
                    >
                      All
                    </button>
                    <span className="text-muted">|</span>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      onClick={clearRoles}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="clinic-card-body p-3">
                  <p className="small text-muted mb-3">
                    Select one or more roles to grant access permissions for modules across the clinic.
                  </p>

                  {isLoadingData ? (
                    <div className="text-center py-4 text-muted small">Loading available roles...</div>
                  ) : roles.length === 0 ? (
                    <div className="text-center py-4 text-muted small">No roles available.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2" style={{ maxHeight: 340, overflowY: "auto" }}>
                      {roles.map((r) => {
                        const isChecked = roleIds.has(r.id);
                        return (
                          <div
                            key={r.id}
                            className={`p-2 border rounded d-flex align-items-center justify-content-between ${
                              isChecked ? "border-primary bg-light" : "bg-white"
                            }`}
                            style={{ cursor: "pointer" }}
                            onClick={() => toggleRole(r.id)}
                          >
                            <div className="form-check mb-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id={`role_${r.id}`}
                                checked={isChecked}
                                onChange={() => toggleRole(r.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <label
                                className="form-check-label fw-semibold cursor-pointer small ms-1"
                                htmlFor={`role_${r.id}`}
                              >
                                {r.name}
                              </label>
                            </div>
                            <div className="d-flex align-items-center gap-1">
                              <span className="badge bg-secondary font-monospace" style={{ fontSize: "0.7rem" }}>
                                {r.code}
                              </span>
                              {r.isSystem ? (
                                <span className="badge bg-info text-dark" style={{ fontSize: "0.65rem" }}>
                                  System
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Card 5: Review & Submit */}
              <div className="clinic-card shadow-sm">
                <div className="clinic-card-header">
                  <h5 className="m-0 fs-6 fw-bold">Review &amp; Actions</h5>
                </div>
                <div className="clinic-card-body p-3">
                  <div className="small mb-3">
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted">Staff Name:</span>
                      <strong className="text-truncate" style={{ maxWidth: 180 }}>
                        {name.trim() || "(empty)"}
                      </strong>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted">Email:</span>
                      <span className="text-truncate font-monospace" style={{ maxWidth: 180 }}>
                        {email.trim() || "(empty)"}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted">Activation Mode:</span>
                      <span className="badge bg-light text-dark border">
                        {mode === "DIRECT" ? "Direct Password" : "Email Invite"}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between py-1">
                      <span className="text-muted">Roles Selected:</span>
                      <strong>{roleIds.size} role(s)</strong>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-cerulean w-100 py-2 fw-bold"
                    disabled={isSubmitting || !canCreate}
                  >
                    {isSubmitting ? "Creating Staff User..." : "✓ Create Staff User"}
                  </button>

                  <div className="mt-2 text-center">
                    <Link to="/admin/users" className="small text-muted text-decoration-none">
                      Cancel and return to Staff Directory
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
