import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill, Modal, Form } from "@clinic/ui";
import { apiGet, apiPut, apiDelete, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import type { EmployeeWithUser, EmployeeUpsert, UserList } from "@clinic/contracts";

/**
 * Employee Information CRUD tied to the User Profile (specification §18.2).
 *
 * Manages official clinic HR details, professional licensure (PRC, PTR, S2 Narcotics),
 * employment type, department assignments, and emergency contacts.
 */

function problemText(err: unknown, fallback: string): string {
  return err instanceof ApiError
    ? err.problem.detail ?? err.problem.title ?? err.problem.code
    : fallback;
}

const DEPARTMENTS = [
  "Clinical Care",
  "Nursing",
  "Pharmacy",
  "Laboratory",
  "Billing & Cashiering",
  "Administration & HR",
  "Radiology & Imaging",
  "Medical Records",
] as const;

export function EmployeesPage() {
  const { session } = useAuth();
  const { hasPermission } = usePermissions();

  const canRead = hasPermission("admin.user.read");
  const canUpdate = hasPermission("admin.user.update");

  const [employees, setEmployees] = useState<EmployeeWithUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Edit / Upsert modal
  const [editTarget, setEditTarget] = useState<EmployeeWithUser | null>(null);
  const [editEmployeeNo, setEditEmployeeNo] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editDepartment, setEditDepartment] = useState("Clinical Care");
  const [editEmploymentType, setEditEmploymentType] = useState<EmployeeUpsert["employmentType"]>("FULL_TIME");
  const [editStatus, setEditStatus] = useState<EmployeeUpsert["status"]>("ACTIVE");
  const [editSpecialization, setEditSpecialization] = useState("");
  const [editPrcLicenseNo, setEditPrcLicenseNo] = useState("");
  const [editPtrNo, setEditPtrNo] = useState("");
  const [editS2LicenseNo, setEditS2LicenseNo] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editHireDate, setEditHireDate] = useState("");
  const [editEmergencyName, setEditEmergencyName] = useState("");
  const [editEmergencyPhone, setEditEmergencyPhone] = useState("");
  const [editEmergencyRel, setEditEmergencyRel] = useState("");
  const [editTin, setEditTin] = useState("");
  const [editSss, setEditSss] = useState("");
  const [editPhilhealth, setEditPhilhealth] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Link to new user modal
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUserId, setLinkUserId] = useState("");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<EmployeeWithUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [empData, userData] = await Promise.all([
        apiGet<EmployeeWithUser[]>("/admin/employees"),
        apiGet<UserList[]>("/admin/users").catch(() => []),
      ]);
      setEmployees(empData);
      setAllUsers(userData);
    } catch (err) {
      setError(problemText(err, "Could not load employee records."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (emp: EmployeeWithUser) => {
    setEditTarget(emp);
    setEditEmployeeNo(emp.employeeNo);
    setEditJobTitle(emp.jobTitle);
    setEditDepartment(emp.department);
    setEditEmploymentType(emp.employmentType);
    setEditStatus(emp.status);
    setEditSpecialization(emp.specialization || "");
    setEditPrcLicenseNo(emp.prcLicenseNo || "");
    setEditPtrNo(emp.ptrNo || "");
    setEditS2LicenseNo(emp.s2LicenseNo || "");
    setEditPhone(emp.phone || "");
    setEditHireDate(emp.hireDate || "");
    setEditEmergencyName(emp.emergencyContactName || "");
    setEditEmergencyPhone(emp.emergencyContactPhone || "");
    setEditEmergencyRel(emp.emergencyContactRelationship || "");
    setEditTin(emp.tin || "");
    setEditSss(emp.sssNo || "");
    setEditPhilhealth(emp.philhealthNo || "");
    setEditNotes(emp.notes || "");
  };

  const handleOpenLinkModal = () => {
    // Find first user without employee profile
    const unlinked = allUsers.filter((u) => !employees.some((e) => e.userId === u.id));
    setLinkUserId(unlinked[0]?.id || "");
    setEditEmployeeNo(`EMP-${Math.floor(1000 + Math.random() * 9000)}`);
    setEditJobTitle("Staff Member");
    setEditDepartment("Clinical Care");
    setEditEmploymentType("FULL_TIME");
    setEditStatus("ACTIVE");
    setEditSpecialization("");
    setEditPrcLicenseNo("");
    setEditPtrNo("");
    setEditS2LicenseNo("");
    setEditPhone("");
    setEditHireDate("");
    setEditEmergencyName("");
    setEditEmergencyPhone("");
    setEditEmergencyRel("");
    setEditTin("");
    setEditSss("");
    setEditPhilhealth("");
    setEditNotes("");
    setShowLinkModal(true);
  };

  const handleSave = async (userId: string, rowVersion?: number) => {
    if (!editEmployeeNo.trim()) {
      setError("Employee number is required.");
      return;
    }
    if (!editJobTitle.trim()) {
      setError("Job title is required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload: EmployeeUpsert = {
        employeeNo: editEmployeeNo.trim(),
        jobTitle: editJobTitle.trim(),
        department: editDepartment.trim(),
        employmentType: editEmploymentType,
        status: editStatus,
        specialization: editSpecialization.trim() || undefined,
        prcLicenseNo: editPrcLicenseNo.trim() || undefined,
        ptrNo: editPtrNo.trim() || undefined,
        s2LicenseNo: editS2LicenseNo.trim() || undefined,
        phone: editPhone.trim() || undefined,
        hireDate: editHireDate || undefined,
        emergencyContactName: editEmergencyName.trim() || undefined,
        emergencyContactPhone: editEmergencyPhone.trim() || undefined,
        emergencyContactRelationship: editEmergencyRel.trim() || undefined,
        tin: editTin.trim() || undefined,
        sssNo: editSss.trim() || undefined,
        philhealthNo: editPhilhealth.trim() || undefined,
        notes: editNotes.trim() || undefined,
        rowVersion,
      };

      await apiPut(`/admin/users/${userId}/employee`, payload);
      setInfo(`Employee record saved for ${editJobTitle} (${editEmployeeNo.trim()}).`);
      setEditTarget(null);
      setShowLinkModal(false);
      await load();
    } catch (err) {
      setError(problemText(err, "Failed to save employee record."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setError(null);
    try {
      await apiDelete(`/admin/users/${deleteTarget.userId}/employee`);
      setInfo(`Employee record unlinked for ${deleteTarget.userName}.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(problemText(err, "Failed to unlink employee record."));
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered employees list
  const filtered = useMemo(() => {
    return employees.filter((emp) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        emp.employeeNo.toLowerCase().includes(q) ||
        emp.jobTitle.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q) ||
        emp.userName.toLowerCase().includes(q) ||
        emp.userEmail.toLowerCase().includes(q) ||
        (emp.prcLicenseNo && emp.prcLicenseNo.toLowerCase().includes(q)) ||
        (emp.specialization && emp.specialization.toLowerCase().includes(q));

      const matchesDept = deptFilter === "ALL" || emp.department === deptFilter;
      const matchesType = typeFilter === "ALL" || emp.employmentType === typeFilter;
      const matchesStatus = statusFilter === "ALL" || emp.status === statusFilter;

      return matchesSearch && matchesDept && matchesType && matchesStatus;
    });
  }, [employees, search, deptFilter, typeFilter, statusFilter]);

  const unlinkedUsers = useMemo(() => {
    return allUsers.filter((u) => !employees.some((e) => e.userId === u.id));
  }, [allUsers, employees]);

  return (
    <div>
      {/* Header */}
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
                Employee Records
              </li>
            </ol>
          </nav>
          <h1 className="page-title mb-1">Employee Records &amp; HR Profiles</h1>
          <div className="page-subtitle text-muted">
            Manage HR employment details, professional licensure (PRC, PTR, S2 Narcotics), and emergency contacts tied to staff user accounts
            {session?.tenantSlug ? <span className="ms-2 font-monospace badge bg-light text-dark border">clinic: {session.tenantSlug}</span> : null}
          </div>
        </div>
        <div className="d-flex gap-2">
          <Link to="/admin/users" className="btn btn-outline-secondary">
            Staff Directory
          </Link>
          <Link to="/admin/users/new" className="btn btn-outline-primary">
            + Create Staff User
          </Link>
          <button
            type="button"
            className="btn btn-cerulean"
            disabled={!canUpdate || unlinkedUsers.length === 0}
            title={unlinkedUsers.length === 0 ? "All staff accounts already have an employee profile" : undefined}
            onClick={handleOpenLinkModal}
          >
            + Link Employee Profile
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <AlertBanner severity="danger" title="Error">
            {error}
          </AlertBanner>
        </div>
      ) : null}

      {info ? (
        <div className="mb-3">
          <AlertBanner severity="success">{info}</AlertBanner>
        </div>
      ) : null}

      {/* Filter Toolbar */}
      <div className="clinic-card mb-4 shadow-sm">
        <div className="clinic-card-header d-flex flex-wrap gap-2 justify-content-between align-items-center p-3">
          <div className="input-group input-group-sm" style={{ maxWidth: 320 }}>
            <span className="input-group-text bg-light text-muted">🔍</span>
            <input
              type="text"
              className="form-control"
              placeholder="Search by name, ID, job title, PRC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="d-flex gap-2 flex-wrap">
            <select
              className="form-select form-select-sm"
              style={{ width: "auto" }}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="ALL">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              className="form-select form-select-sm"
              style={{ width: "auto" }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Employment Types</option>
              <option value="FULL_TIME">Full Time</option>
              <option value="PART_TIME">Part Time</option>
              <option value="CONTRACT">Contract</option>
              <option value="CONSULTANT">Consultant</option>
              <option value="INTERN">Intern</option>
            </select>

            <select
              className="form-select form-select-sm"
              style={{ width: "auto" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On Leave</option>
              <option value="PROBATION">Probation</option>
              <option value="RESIGNED">Resigned</option>
              <option value="TERMINATED">Terminated</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>EMPLOYEE &amp; USER</th>
                <th>DEPARTMENT &amp; TITLE</th>
                <th>EMPLOYMENT</th>
                <th>LICENSURE &amp; CREDENTIALS</th>
                <th>CONTACT &amp; EMERGENCY</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge bg-light text-dark border font-monospace fw-bold">
                        {emp.employeeNo}
                      </span>
                      <div>
                        <div className="fw-bold text-dark">{emp.userName}</div>
                        <div className="small text-muted font-monospace">{emp.userEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="fw-semibold text-dark">{emp.jobTitle}</div>
                    <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle small">
                      {emp.department}
                    </span>
                    {emp.specialization ? (
                      <div className="small text-muted">{emp.specialization}</div>
                    ) : null}
                  </td>
                  <td>
                    <div>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle me-1">
                        {emp.employmentType.replace("_", " ")}
                      </span>
                      <StatusPill
                        tone={emp.status === "ACTIVE" ? "normal" : emp.status === "ON_LEAVE" ? "pending" : "neutral"}
                        label={emp.status}
                      />
                    </div>
                    {emp.hireDate ? (
                      <div className="small text-muted mt-1">Hired: {emp.hireDate}</div>
                    ) : null}
                  </td>
                  <td>
                    {emp.prcLicenseNo || emp.ptrNo || emp.s2LicenseNo ? (
                      <div className="d-flex flex-column gap-1">
                        {emp.prcLicenseNo ? (
                          <div className="small">
                            <span className="text-muted">PRC: </span>
                            <span className="font-monospace fw-bold">{emp.prcLicenseNo}</span>
                          </div>
                        ) : null}
                        {emp.ptrNo ? (
                          <div className="small">
                            <span className="text-muted">PTR: </span>
                            <span className="font-monospace">{emp.ptrNo}</span>
                          </div>
                        ) : null}
                        {emp.s2LicenseNo ? (
                          <div className="small">
                            <span className="badge bg-warning-subtle text-warning-emphasis border">
                              S2: {emp.s2LicenseNo}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="small text-muted fst-italic">No licenses recorded</span>
                    )}
                  </td>
                  <td>
                    {emp.phone ? <div className="small">📞 {emp.phone}</div> : null}
                    {emp.emergencyContactName ? (
                      <div className="small text-muted">
                        🚨 {emp.emergencyContactName}{" "}
                        {emp.emergencyContactRelationship ? `(${emp.emergencyContactRelationship})` : ""}{" "}
                        {emp.emergencyContactPhone ? `• ${emp.emergencyContactPhone}` : ""}
                      </div>
                    ) : (
                      <span className="small text-muted">—</span>
                    )}
                  </td>
                  <td className="text-end">
                    <div className="d-flex gap-1 justify-content-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        disabled={!canUpdate}
                        onClick={() => openEdit(emp)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        disabled={!canUpdate}
                        onClick={() => setDeleteTarget(emp)}
                      >
                        Unlink
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-5">
                    No employee records match the selected filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Employee Modal */}
      {editTarget ? (
        <Modal show animation={false} onHide={() => setEditTarget(null)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>
              Edit Employee Profile: {editTarget.userName} ({editTarget.employeeNo})
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="row g-3">
              <div className="col-md-6">
                <Form.Group controlId="emp-no">
                  <Form.Label className="fw-semibold small">Employee ID / Staff No *</Form.Label>
                  <Form.Control
                    value={editEmployeeNo}
                    onChange={(e) => setEditEmployeeNo(e.target.value)}
                    placeholder="e.g. EMP-1002"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="emp-title">
                  <Form.Label className="fw-semibold small">Job Title / Designation *</Form.Label>
                  <Form.Control
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                    placeholder="e.g. Attending Physician"
                  />
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="emp-dept">
                  <Form.Label className="fw-semibold small">Department</Form.Label>
                  <Form.Select
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="emp-type">
                  <Form.Label className="fw-semibold small">Employment Type</Form.Label>
                  <Form.Select
                    value={editEmploymentType}
                    onChange={(e) => setEditEmploymentType(e.target.value as any)}
                  >
                    <option value="FULL_TIME">Full Time</option>
                    <option value="PART_TIME">Part Time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="CONSULTANT">Consultant</option>
                    <option value="INTERN">Intern</option>
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="emp-status">
                  <Form.Label className="fw-semibold small">HR Status</Form.Label>
                  <Form.Select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="PROBATION">Probation</option>
                    <option value="RESIGNED">Resigned</option>
                    <option value="TERMINATED">Terminated</option>
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-spec">
                  <Form.Label className="fw-semibold small">Medical Specialization</Form.Label>
                  <Form.Control
                    value={editSpecialization}
                    onChange={(e) => setEditSpecialization(e.target.value)}
                    placeholder="e.g. Pediatrics, Cardiology"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-prc">
                  <Form.Label className="fw-semibold small">PRC License Number</Form.Label>
                  <Form.Control
                    value={editPrcLicenseNo}
                    onChange={(e) => setEditPrcLicenseNo(e.target.value)}
                    placeholder="e.g. PRC-0123456"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-ptr">
                  <Form.Label className="fw-semibold small">PTR Number</Form.Label>
                  <Form.Control
                    value={editPtrNo}
                    onChange={(e) => setEditPtrNo(e.target.value)}
                    placeholder="e.g. PTR-789012"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-s2">
                  <Form.Label className="fw-semibold small">S2 Narcotics License</Form.Label>
                  <Form.Control
                    value={editS2LicenseNo}
                    onChange={(e) => setEditS2LicenseNo(e.target.value)}
                    placeholder="e.g. S2-345678"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-phone">
                  <Form.Label className="fw-semibold small">Contact Phone Number</Form.Label>
                  <Form.Control
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="e.g. +63 917 123 4567"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="emp-hire">
                  <Form.Label className="fw-semibold small">Hire / Joining Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={editHireDate}
                    onChange={(e) => setEditHireDate(e.target.value)}
                  />
                </Form.Group>
              </div>

              <div className="col-12 border-top pt-3">
                <h6 className="small text-uppercase fw-bold text-secondary mb-2">Emergency Contact</h6>
                <div className="row g-2">
                  <div className="col-md-5">
                    <Form.Control
                      placeholder="Emergency Contact Name"
                      value={editEmergencyName}
                      onChange={(e) => setEditEmergencyName(e.target.value)}
                    />
                  </div>
                  <div className="col-md-3">
                    <Form.Control
                      placeholder="Relationship"
                      value={editEmergencyRel}
                      onChange={(e) => setEditEmergencyRel(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4">
                    <Form.Control
                      placeholder="Emergency Phone"
                      value={editEmergencyPhone}
                      onChange={(e) => setEditEmergencyPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="col-12 border-top pt-3">
                <h6 className="small text-uppercase fw-bold text-secondary mb-2">Government &amp; Tax IDs</h6>
                <div className="row g-2">
                  <div className="col-md-4">
                    <Form.Control
                      placeholder="TIN"
                      value={editTin}
                      onChange={(e) => setEditTin(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4">
                    <Form.Control
                      placeholder="SSS Number"
                      value={editSss}
                      onChange={(e) => setEditSss(e.target.value)}
                    />
                  </div>
                  <div className="col-md-4">
                    <Form.Control
                      placeholder="PhilHealth Number"
                      value={editPhilhealth}
                      onChange={(e) => setEditPhilhealth(e.target.value)}
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
              onClick={() => setEditTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-cerulean"
              disabled={isSaving}
              onClick={() => handleSave(editTarget.userId, editTarget.rowVersion)}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </Modal.Footer>
        </Modal>
      ) : null}

      {/* Link to New User Modal */}
      {showLinkModal ? (
        <Modal show animation={false} onHide={() => setShowLinkModal(false)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>Link Employee Record to Staff Account</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="mb-3">
              <Form.Label className="fw-semibold small">Select Staff Member *</Form.Label>
              <Form.Select
                value={linkUserId}
                onChange={(e) => setLinkUserId(e.target.value)}
              >
                {unlinkedUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </Form.Select>
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <Form.Group controlId="link-emp-no">
                  <Form.Label className="fw-semibold small">Employee ID *</Form.Label>
                  <Form.Control
                    value={editEmployeeNo}
                    onChange={(e) => setEditEmployeeNo(e.target.value)}
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="link-emp-title">
                  <Form.Label className="fw-semibold small">Job Title *</Form.Label>
                  <Form.Control
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="link-emp-dept">
                  <Form.Label className="fw-semibold small">Department</Form.Label>
                  <Form.Select
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="link-emp-prc">
                  <Form.Label className="fw-semibold small">PRC License Number</Form.Label>
                  <Form.Control
                    value={editPrcLicenseNo}
                    onChange={(e) => setEditPrcLicenseNo(e.target.value)}
                  />
                </Form.Group>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setShowLinkModal(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-cerulean"
              disabled={isSaving || !linkUserId}
              onClick={() => handleSave(linkUserId)}
            >
              {isSaving ? "Linking..." : "Establish Employee Record"}
            </button>
          </Modal.Footer>
        </Modal>
      ) : null}

      {/* Delete / Unlink Modal */}
      {deleteTarget ? (
        <Modal show animation={false} onHide={() => setDeleteTarget(null)}>
          <Modal.Header closeButton>
            <Modal.Title>Unlink Employee Profile</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              Are you sure you want to unlink and remove the HR employee record for{" "}
              <strong>{deleteTarget.userName}</strong> ({deleteTarget.employeeNo})?
            </p>
            <p className="small text-muted mb-0">
              The user login account and credentials will remain active, but HR and licensure details will be deleted.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              {isDeleting ? "Unlinking..." : "Unlink Record"}
            </button>
          </Modal.Footer>
        </Modal>
      ) : null}
    </div>
  );
}
