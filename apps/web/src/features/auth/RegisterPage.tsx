import React, { useState } from "react";
import { Link } from "react-router";
import { submitRegistration, type RegistrationRequest } from "../../shared/services/registrationStore.js";
import { AlertBanner } from "@clinic/ui";

export function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("DOCTOR");
  const [licenseNo, setLicenseNo] = useState("");
  const [branch, setBranch] = useState("Metro General Hospital - Main");
  const [notes, setNotes] = useState("");

  const [submittedRequest, setSubmittedRequest] = useState<RegistrationRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      setError("Please complete all required personal and contact fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = submitRegistration({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim(),
        role,
        licenseNo: licenseNo.trim() || undefined,
        branch,
        notes: notes.trim() || undefined,
      });
      setSubmittedRequest(result);
    } catch {
      setError("Failed to submit registration request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card" style={{ maxWidth: "620px" }}>
        {/* Cerulean Header */}
        <div className="auth-header-banner">
          <div
            style={{
              width: "48px",
              height: "48px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 0.75rem",
              fontSize: "1.4rem",
              fontWeight: 700,
            }}
          >
            📋
          </div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
            Staff & Practitioner Registration
          </h1>
          <p style={{ margin: 0, opacity: 0.85, fontSize: "0.85rem" }}>
            Submit your clinical affiliation request for Tenant Admin review
          </p>
        </div>

        <div className="auth-form-body">
          {submittedRequest ? (
            /* Successful Submission Confirmation */
            <div className="text-center py-3">
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  backgroundColor: "#dcfce7",
                  color: "#15803d",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  margin: "0 auto 1.25rem",
                }}
              >
                ✓
              </div>
              <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--grey-900)" }}>
                Registration Submitted
              </h2>
              <p className="text-muted small mb-4">
                Your request has been queued for review by the Clinic Tenant Administrator.
              </p>

              <div
                style={{
                  backgroundColor: "var(--grey-50)",
                  border: "1px solid var(--grey-200)",
                  borderRadius: "8px",
                  padding: "1.25rem",
                  textAlign: "left",
                  marginBottom: "1.5rem",
                }}
              >
                <div className="d-flex justify-content-between mb-2">
                  <span className="small text-muted">Tracking Reference:</span>
                  <span className="small fw-bold text-dark">{submittedRequest.referenceNo}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="small text-muted">Applicant:</span>
                  <span className="small fw-semibold">{submittedRequest.firstName} {submittedRequest.lastName}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="small text-muted">Requested Role:</span>
                  <span className="small fw-semibold text-primary">{submittedRequest.role}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="small text-muted">Assigned Branch:</span>
                  <span className="small">{submittedRequest.branch}</span>
                </div>
                <div className="d-flex justify-content-between pt-2 border-top">
                  <span className="small text-muted">Review Status:</span>
                  <span className="badge bg-warning text-dark px-2 py-1">
                    PENDING TENANT ADMIN APPROVAL
                  </span>
                </div>
              </div>

              <div className="alert alert-info small text-start mb-4">
                <strong>Next Steps:</strong> The tenant administrator will verify your professional credentials. Once approved, an account activation link will be sent to <strong>{submittedRequest.email}</strong>.
              </div>

              <div className="d-flex gap-2">
                <Link to="/login" className="btn btn-cerulean flex-grow-1">
                  Back to Sign In
                </Link>
                <Link to="/admin/approvals" className="btn btn-outline-secondary">
                  View Admin Queue
                </Link>
              </div>
            </div>
          ) : (
            /* Registration Form */
            <form onSubmit={handleSubmit}>
              {/* Approval Notice Banner */}
              <div className="notice-banner">
                <div className="fw-semibold mb-1">Tenant Admin Approval Required</div>
                <div>
                  To maintain data isolation and compliance (DPA 2012 / HIPAA), all user accounts must be authorized and approved by the Tenant Administrator before credentials are activated.
                </div>
              </div>

              {error && (
                <div className="mb-3">
                  <AlertBanner severity="danger">{error}</AlertBanner>
                </div>
              )}

              {/* Name Fields */}
              <div className="row g-2 mb-3">
                <div className="col-sm-5">
                  <label htmlFor="reg-first-name" className="form-label small fw-semibold text-secondary mb-1">
                    FIRST NAME *
                  </label>
                  <input
                    id="reg-first-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="col-sm-5">
                  <label htmlFor="reg-last-name" className="form-label small fw-semibold text-secondary mb-1">
                    LAST NAME *
                  </label>
                  <input
                    id="reg-last-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
                <div className="col-sm-2">
                  <label htmlFor="reg-middle-name" className="form-label small fw-semibold text-secondary mb-1">
                    M.I.
                  </label>
                  <input
                    id="reg-middle-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                  />
                </div>
              </div>

              {/* Contact Fields */}
              <div className="row g-2 mb-3">
                <div className="col-sm-7">
                  <label htmlFor="reg-email" className="form-label small fw-semibold text-secondary mb-1">
                    OFFICIAL / WORK EMAIL *
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    className="form-control form-control-sm"
                    placeholder="doctor@hospital.ph"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="col-sm-5">
                  <label htmlFor="reg-phone" className="form-label small fw-semibold text-secondary mb-1">
                    MOBILE NO. *
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    className="form-control form-control-sm"
                    placeholder="0917-000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Professional Role & License */}
              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <label htmlFor="reg-role" className="form-label small fw-semibold text-secondary mb-1">
                    CLINICAL / STAFF ROLE *
                  </label>
                  <select
                    id="reg-role"
                    className="form-select form-select-sm"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="DOCTOR">Physician / Medical Specialist</option>
                    <option value="NURSE">Clinic / Triage Nurse</option>
                    <option value="PHARMACIST">Registered Pharmacist</option>
                    <option value="MEDTECH">Medical Technologist (Lab)</option>
                    <option value="ENCODER">Receptionist / Encoder</option>
                    <option value="CASHIER">Cashier / Billing Staff</option>
                  </select>
                </div>
                <div className="col-sm-6">
                  <label htmlFor="reg-license" className="form-label small fw-semibold text-secondary mb-1">
                    PRC LICENSE NO. (IF APPLICABLE)
                  </label>
                  <input
                    id="reg-license"
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="PRC-0012345"
                    value={licenseNo}
                    onChange={(e) => setLicenseNo(e.target.value)}
                  />
                </div>
              </div>

              {/* Branch Selection */}
              <div className="mb-3">
                <label htmlFor="reg-branch" className="form-label small fw-semibold text-secondary mb-1">
                  PRIMARY CLINIC BRANCH *
                </label>
                <select
                  id="reg-branch"
                  className="form-select form-select-sm"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option value="Metro General Hospital - Main">Metro General Hospital - Main Branch</option>
                  <option value="North Care Ambulatory Center">North Care Ambulatory Center</option>
                  <option value="East Side Specialty Clinic">East Side Specialty Clinic</option>
                </select>
              </div>

              {/* Notes / Specialization */}
              <div className="mb-4">
                <label htmlFor="reg-notes" className="form-label small fw-semibold text-secondary mb-1">
                  SPECIALIZATION / APPLICATION NOTES
                </label>
                <textarea
                  id="reg-notes"
                  className="form-control form-control-sm"
                  rows={2}
                  placeholder="e.g. Specializes in Pediatrics; requested outpatient consultation schedule."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-cerulean w-100 py-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting Registration..." : "Submit Registration for Admin Approval"}
              </button>

              <div className="text-center mt-3">
                <Link to="/login" className="small text-decoration-none text-muted">
                  Already have an approved account? Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
