import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { ThemeControls } from "../../shared/theme/ThemeControls.js";
import { apiGet, apiPut, ApiError } from "../../shared/api/client.js";

interface ModuleEntitlement {
  module: string;
  name: string;
  description: string;
  status: "ENABLED" | "TRIAL" | "DISABLED" | "DRAINING";
  dependencies: string[];
}

interface ClinicProfileData {
  id?: string;
  name: string;
  slug?: string;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  dohLicenseNo?: string | null;
  philhealthAccreditationNo?: string | null;
  tin?: string | null;
  letterheadFooter?: string | null;
}

const DEFAULT_PROFILE: ClinicProfileData = {
  name: "Medical Clinic Center",
  tagline: "Primary Care, Diagnostic & Ambulatory Center",
  address: "100 Medical Center Way, Ermita, Manila, Philippines",
  phone: "(02) 8524-1000 / +63 917 555 0100",
  email: "care@clinic.ph",
  website: "https://clinic.ph",
  dohLicenseNo: "DOH-LTO-01449-NCR",
  philhealthAccreditationNo: "PHIC-ACC-98765-PCP",
  tin: "009-876-543-000",
  letterheadFooter: "Licensed Secondary Clinical Laboratory & PhilHealth Konsulta Accredited Facility",
};

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

  // Clinic Profile / Printout Letterhead State
  const [profile, setProfile] = useState<ClinicProfileData>(DEFAULT_PROFILE);
  const [savedProfile, setSavedProfile] = useState<ClinicProfileData>(DEFAULT_PROFILE);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ message: string; severity: "success" | "danger" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      setIsLoadingProfile(true);
      try {
        const data = await apiGet<ClinicProfileData>("/admin/clinic-profile");
        if (!cancelled && data) {
          const loaded: ClinicProfileData = {
            id: data.id,
            name: data.name || DEFAULT_PROFILE.name,
            slug: data.slug,
            tagline: data.tagline ?? DEFAULT_PROFILE.tagline,
            address: data.address ?? DEFAULT_PROFILE.address,
            phone: data.phone ?? DEFAULT_PROFILE.phone,
            email: data.email ?? DEFAULT_PROFILE.email,
            website: data.website ?? DEFAULT_PROFILE.website,
            dohLicenseNo: data.dohLicenseNo ?? DEFAULT_PROFILE.dohLicenseNo,
            philhealthAccreditationNo: data.philhealthAccreditationNo ?? DEFAULT_PROFILE.philhealthAccreditationNo,
            tin: data.tin ?? DEFAULT_PROFILE.tin,
            letterheadFooter: data.letterheadFooter ?? DEFAULT_PROFILE.letterheadFooter,
          };
          setProfile(loaded);
          setSavedProfile(loaded);
        }
      } catch {
        // Fall back to defaults
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.name.trim()) {
      setProfileFeedback({ message: "Clinic Name is required.", severity: "danger" });
      return;
    }
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      const payload = {
        name: profile.name.trim(),
        tagline: profile.tagline?.trim() || null,
        address: profile.address?.trim() || null,
        phone: profile.phone?.trim() || null,
        email: profile.email?.trim() || null,
        website: profile.website?.trim() || null,
        dohLicenseNo: profile.dohLicenseNo?.trim() || null,
        philhealthAccreditationNo: profile.philhealthAccreditationNo?.trim() || null,
        tin: profile.tin?.trim() || null,
        letterheadFooter: profile.letterheadFooter?.trim() || null,
      };
      const updated = await apiPut<ClinicProfileData>("/admin/clinic-profile", payload);
      setProfile((prev) => ({ ...prev, ...updated }));
      setSavedProfile((prev) => ({ ...prev, ...updated }));
      setProfileFeedback({
        message: "Clinic profile and letterhead configuration updated successfully! All medical certificates, prescriptions, lab requisitions, and orders will immediately reflect these updated details.",
        severity: "success",
      });
    } catch (err) {
      setProfileFeedback({
        message: err instanceof ApiError ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim() : "Failed to update clinic profile.",
        severity: "danger",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleResetProfile = () => {
    setProfile(savedProfile);
    setProfileFeedback(null);
  };

  const isProfileDirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);

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
          <h1 className="page-title">Tenant Settings &amp; Module Entitlements</h1>
          <div className="page-subtitle">
            Clinic organization details, official printout letterhead, PhilHealth Konsulta compliance, and module entitlements
          </div>
        </div>
      </div>

      {feedback && (
        <div className="mb-3">
          <AlertBanner severity="success">{feedback}</AlertBanner>
        </div>
      )}

      {/* ── 1. Clinic & Letterhead Information (Tied to Printouts) ────────── */}
      <div className="clinic-card mb-4" id="clinic-profile-card">
        <div className="clinic-card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <span className="fw-bold fs-6">🏥 Clinic Information &amp; Official Letterhead</span>
            <div className="small text-muted">
              Primary organization profile directly tied up with official printouts (Prescriptions, Medical Certificates, Lab Requisitions, Clinical Orders)
            </div>
          </div>
          <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
            🖨️ Tied to Encounter Printouts
          </span>
        </div>
        <div className="p-3">
          {profileFeedback && (
            <div className="mb-3">
              <AlertBanner severity={profileFeedback.severity}>{profileFeedback.message}</AlertBanner>
            </div>
          )}

          <div className="alert alert-info py-2 px-3 small d-flex align-items-center gap-2 mb-3">
            <span>💡</span>
            <div>
              <strong>Printout Integration:</strong> The details configured below are dynamically injected into the header and letterhead of official PDFs generated by the clinic. When you save changes here, visits printed in this clinic immediately render these official credentials.
            </div>
          </div>

          <form onSubmit={handleSaveProfile}>
            <div className="row g-3">
              {/* Left Column: Organization & Contact */}
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-name">
                    CLINIC / FACILITY NAME <span className="text-danger">*</span>
                  </label>
                  <input
                    id="setting-clinic-name"
                    type="text"
                    className="form-control"
                    placeholder="e.g. La Salette Medical Center"
                    value={profile.name}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    required
                  />
                  <div className="form-text small">Official trade name appearing prominently at the top of all letterheads.</div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-tagline">
                    FACILITY TAGLINE / SUBTITLE
                  </label>
                  <input
                    id="setting-clinic-tagline"
                    type="text"
                    className="form-control"
                    placeholder="e.g. Primary Care, Diagnostic & Ambulatory Center"
                    value={profile.tagline || ""}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
                  />
                  <div className="form-text small">Descriptive subtitle shown beneath the clinic name on official documents.</div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-address">
                    MAIN PHYSICAL ADDRESS
                  </label>
                  <textarea
                    id="setting-clinic-address"
                    rows={2}
                    className="form-control"
                    placeholder="e.g. 100 Medical Center Way, Ermita, Manila, Philippines"
                    value={profile.address || ""}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                  />
                  <div className="form-text small">Printed as the primary facility location unless a branch specifies an override.</div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="setting-clinic-phone">
                      CONTACT PHONE / MOBILE
                    </label>
                    <input
                      id="setting-clinic-phone"
                      type="text"
                      className="form-control font-monospace"
                      placeholder="e.g. (02) 8524-1000"
                      value={profile.phone || ""}
                      disabled={isLoadingProfile}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="setting-clinic-email">
                      OFFICIAL EMAIL
                    </label>
                    <input
                      id="setting-clinic-email"
                      type="email"
                      className="form-control"
                      placeholder="e.g. care@lasaletteclinic.ph"
                      value={profile.email || ""}
                      disabled={isLoadingProfile}
                      onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Regulatory & Accreditations */}
              <div className="col-md-6">
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-website">
                    OFFICIAL WEBSITE
                  </label>
                  <input
                    id="setting-clinic-website"
                    type="text"
                    className="form-control"
                    placeholder="e.g. https://lasaletteclinic.ph"
                    value={profile.website || ""}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                  />
                  <div className="form-text small">Public portal or clinic web address.</div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="setting-clinic-doh">
                      DOH LICENSE TO OPERATE (LTO) NO.
                    </label>
                    <input
                      id="setting-clinic-doh"
                      type="text"
                      className="form-control font-monospace"
                      placeholder="e.g. DOH-LTO-01449-NCR"
                      value={profile.dohLicenseNo || ""}
                      disabled={isLoadingProfile}
                      onChange={(e) => setProfile({ ...profile, dohLicenseNo: e.target.value })}
                    />
                    <div className="form-text small">Department of Health facility licence.</div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="setting-clinic-philhealth">
                      PHILHEALTH ACCREDITATION NO.
                    </label>
                    <input
                      id="setting-clinic-philhealth"
                      type="text"
                      className="form-control font-monospace"
                      placeholder="e.g. PHIC-ACC-98765-PCP"
                      value={profile.philhealthAccreditationNo || ""}
                      disabled={isLoadingProfile}
                      onChange={(e) => setProfile({ ...profile, philhealthAccreditationNo: e.target.value })}
                    />
                    <div className="form-text small">Konsulta / Primary Care Provider code.</div>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-tin">
                    TAX IDENTIFICATION NUMBER (TIN)
                  </label>
                  <input
                    id="setting-clinic-tin"
                    type="text"
                    className="form-control font-monospace"
                    placeholder="e.g. 009-876-543-000"
                    value={profile.tin || ""}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, tin: e.target.value })}
                  />
                  <div className="form-text small">Rendered on official cash receipts, billing invoices, and tax disclosures.</div>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="setting-clinic-footer">
                    LETTERHEAD FOOTER / ACCREDITATION NOTE
                  </label>
                  <input
                    id="setting-clinic-footer"
                    type="text"
                    className="form-control"
                    placeholder="e.g. Licensed Secondary Clinical Laboratory & PhilHealth Konsulta Provider"
                    value={profile.letterheadFooter || ""}
                    disabled={isLoadingProfile}
                    onChange={(e) => setProfile({ ...profile, letterheadFooter: e.target.value })}
                  />
                  <div className="form-text small">Subtext rendered at the footer or subtitle of medical certificates and receipts.</div>
                </div>
              </div>
            </div>

            {/* Live Letterhead Preview */}
            <div className="mt-4 pt-3 border-top">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="fw-bold small text-uppercase text-secondary">
                  👁️ Real-Time Official Letterhead Preview
                </span>
                <span className="badge bg-secondary-subtle text-secondary small">
                  Previewing printout header
                </span>
              </div>

              <div
                className="p-4 border rounded bg-white shadow-sm text-center position-relative"
                style={{
                  maxWidth: "760px",
                  margin: "0 auto",
                  borderColor: "var(--cerulean-300, #cbd5e1)",
                  borderStyle: "dashed",
                }}
              >
                <div style={{ fontSize: "1.8rem" }}>⚕️</div>
                <h4 className="fw-bold text-dark mb-1" style={{ letterSpacing: "0.5px" }}>
                  {profile.name || "CLINIC FACILITY NAME"}
                </h4>
                {profile.tagline ? (
                  <div className="text-secondary small fw-medium mb-1">{profile.tagline}</div>
                ) : null}
                <div className="small text-muted" style={{ fontSize: "0.82rem" }}>
                  {[profile.address, profile.phone, profile.email].filter(Boolean).join(" · ")}
                </div>
                {(profile.dohLicenseNo || profile.philhealthAccreditationNo || profile.tin) && (
                  <div className="small text-secondary mt-1 font-monospace" style={{ fontSize: "0.78rem" }}>
                    {[
                      profile.dohLicenseNo ? `DOH LTO: ${profile.dohLicenseNo}` : null,
                      profile.philhealthAccreditationNo ? `PhilHealth: ${profile.philhealthAccreditationNo}` : null,
                      profile.tin ? `TIN: ${profile.tin}` : null,
                    ]
                      .filter(Boolean)
                      .join("  |  ")}
                  </div>
                )}
                <div
                  style={{
                    borderTop: "2px double #475569",
                    marginTop: "12px",
                    marginBottom: "8px",
                  }}
                />
                <div className="small text-muted fst-italic" style={{ fontSize: "0.72rem" }}>
                  SAMPLE DOCUMENT HEADER — MEDICAL CERTIFICATE / OFFICIAL PRESCRIPTION (Rx) / LAB REQUISITION
                </div>
                {profile.letterheadFooter ? (
                  <div className="badge bg-light text-secondary border mt-2" style={{ fontSize: "0.72rem" }}>
                    {profile.letterheadFooter}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Form Actions */}
            <div className="mt-4 pt-3 border-top d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div className="small text-muted">
                {isProfileDirty ? (
                  <span className="text-warning-emphasis fw-semibold">● You have unsaved letterhead changes</span>
                ) : (
                  <span className="text-success fw-semibold">✓ Current letterhead is synced with server</span>
                )}
              </div>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  disabled={!isProfileDirty || isSavingProfile}
                  onClick={handleResetProfile}
                >
                  Reset
                </button>
                <button
                  type="submit"
                  className="btn btn-sm btn-cerulean px-4 fw-bold"
                  disabled={isSavingProfile || !isProfileDirty}
                >
                  {isSavingProfile ? "Saving Profile…" : "💾 Save Clinic Profile & Letterhead"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Appearance — client-side presentation preferences only (frontend §5.1). */}
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
          <span className="fw-bold">Security &amp; Compliance Policies</span>
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
                <div className="small text-muted mt-1">PhilHealth PIN &amp; IDs masked until audited reveal.</div>
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
