import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, ApiError } from "../../shared/api/client.js";

export interface PrescriptionPrintItem {
  id?: string;
  generic_name?: string;
  genericName?: string;
  brand_name?: string;
  brandName?: string;
  strength?: string;
  form?: string;
  route?: string;
  sig_dose?: string;
  sigDose?: string;
  sig_frequency?: string;
  sigFrequency?: string;
  sig_duration?: string;
  sigDuration?: string;
  qty_prescribed?: number;
  qtyPrescribed?: number;
  dispense_as_written?: boolean;
}

export interface PrescriptionPrintData {
  id: string;
  rxNo: string;
  status: string;
  isControlled: boolean;
  specialRxNo?: string | null;
  qtyWords?: string | null;
  validUntil?: string | null;
  issuedAt?: string | null;
  prescriberName?: string | null;
  notes?: string | null;
  items?: PrescriptionPrintItem[];
}

export interface LabOrderPrintItem {
  id?: string;
  test_id?: string;
  test_name?: string;
  testName?: string;
  test_code?: string;
  testCode?: string;
  specimen_type?: string;
  specimenType?: string;
  container_type?: string;
  fasting_required?: boolean;
  fasting_hours?: number;
  instructions?: string;
  status?: string;
}

export interface LabOrderPrintData {
  id: string;
  orderNo?: string;
  order_no?: string;
  status: string;
  priority: string;
  clinicalInfo?: string | null;
  clinical_info?: string | null;
  orderedAt?: string;
  ordered_at?: string;
  items?: LabOrderPrintItem[];
}

export interface PrescriptionPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "RX" | "LAB" | "ALL";
  visit: {
    id: string;
    visitNo: string;
    patientId: string;
    patientName: string;
    dateOfBirth?: string;
    sex?: string;
    branchId?: string;
    branchName?: string;
    clinicName?: string;
    chiefComplaint?: string;
  };
  vitals?: Array<{
    bpSys?: number | null;
    bpDia?: number | null;
    heartRate?: number | null;
    temperatureC?: string | null;
    spo2?: number | null;
  }>;
  diagnoses?: Array<{
    icd10Code: string;
    dxType?: string;
    certainty?: string;
  }>;
  notes?: Array<{
    noteType?: string;
    subjective?: string | null;
    objective?: string | null;
    assessment?: string | null;
    plan?: string | null;
    status?: string;
  }>;
  prescriptions: PrescriptionPrintData[];
  labOrders: LabOrderPrintData[];
  allergies?: Array<{
    substance: string;
    severity?: string;
  }>;
  practitionerName?: string;
  diagnosis?: string;
  diagnosisDescription?: string;
  specialInstruction?: string;
  clinicalNotes?: string;
  clinicalMemo?: string;
}

export function PrescriptionPrintModal({
  isOpen,
  onClose,
  defaultTab = "RX",
  visit,
  vitals = [],
  diagnoses = [],
  notes = [],
  prescriptions = [],
  labOrders = [],
  allergies = [],
  practitionerName,
  diagnosis,
  diagnosisDescription,
  specialInstruction,
  clinicalNotes,
  clinicalMemo: propClinicalMemo,
}: PrescriptionPrintModalProps) {
  const [activeTab, setActiveTab] = useState<"RX" | "LAB" | "ALL">(defaultTab);
  const [showConfig, setShowConfig] = useState(false);

  // ── Doctor & clinic header ────────────────────────────────────────────────
  const [doctorName, setDoctorName] = useState(practitionerName || "");
  const [doctorTitle, setDoctorTitle] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [prcNo, setPrcNo] = useState("");
  const [ptrNo, setPtrNo] = useState("");
  const [s2No, setS2No] = useState("");
  const [clinicTitle, setClinicTitle] = useState(visit.clinicName || "");
  const [clinicSubtitle, setClinicSubtitle] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicContact, setClinicContact] = useState("");

  const defaultDx =
    diagnosis ||
    (diagnoses.length > 0
      ? diagnoses
          .map((d: any) => {
            const code = (d.icd10Code || d.icd10_code || "").trim();
            const desc = (d.description || d.icd10_description || "").trim();
            if (desc && code && desc.toLowerCase() !== code.toLowerCase()) {
              return `${desc} (${code})`;
            }
            return desc || code;
          })
          .join("; ")
      : diagnosisDescription || (notes.length > 0 && notes[0]?.assessment ? notes[0].assessment : ""));

  const defaultAdvice =
    specialInstruction ||
    (notes.length > 0 && notes[0]?.plan ? notes[0].plan : "");

  const defaultMemo =
    clinicalNotes ||
    propClinicalMemo ||
    (notes.length > 0 && (notes[0]?.plan || notes[0]?.assessment)
      ? [notes[0]?.assessment ? `Assessment: ${notes[0].assessment}` : "", notes[0]?.plan ? `Plan: ${notes[0].plan}` : ""].filter(Boolean).join("\n")
      : "");

  const [rxDiagnosis, setRxDiagnosis] = useState(defaultDx);
  const [rxNotesAdvice, setRxNotesAdvice] = useState(defaultAdvice);
  const [clinicalMemo, setClinicalMemo] = useState(defaultMemo);
  const touched = useRef<Set<string>>(new Set());
  const markTouched = (key: string) => touched.current.add(key);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  // Hydrate the print profile once per open: recorded doctor credentials and
  // clinic identity from the server. Fail-soft — the PDF endpoint still renders
  // from the same recorded profile, the drawer just stays blank.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setProfileError(null);
    (async () => {
      try {
        const profile = await apiGet<{
          clinic?: {
            name?: string | null;
            tagline?: string | null;
            branchName?: string | null;
            address?: string | null;
            phone?: string | null;
            email?: string | null;
          };
          practitioner?: {
            name?: string | null;
            jobTitle?: string | null;
            specialization?: string | null;
            prcLicenseNo?: string | null;
            ptrNo?: string | null;
            s2LicenseNo?: string | null;
          } | null;
        }>(`/clinical/visits/${visit.id}/print-profile`);
        if (cancelled) return;
        const p = profile?.practitioner;
        if (!touched.current.has("doctorName")) {
          setDoctorName(p?.name ? (p.name.startsWith("Dr.") ? p.name : `Dr. ${p.name}`) : practitionerName || "");
        }
        if (!touched.current.has("doctorTitle")) setDoctorTitle(p?.jobTitle || "");
        if (!touched.current.has("doctorSpecialty")) setDoctorSpecialty(p?.specialization || "");
        if (!touched.current.has("prcNo")) setPrcNo(p?.prcLicenseNo || "");
        if (!touched.current.has("ptrNo")) setPtrNo(p?.ptrNo || "");
        if (!touched.current.has("s2No")) setS2No(p?.s2LicenseNo || "");
        if (!touched.current.has("clinicTitle")) setClinicTitle(profile?.clinic?.name || visit.clinicName || "");
        if (!touched.current.has("clinicSubtitle")) setClinicSubtitle(profile?.clinic?.branchName || profile?.clinic?.tagline || "");
        if (!touched.current.has("clinicAddress") && profile?.clinic?.address) setClinicAddress(profile.clinic.address);
        if (!touched.current.has("clinicContact") && (profile?.clinic?.phone || profile?.clinic?.email)) {
          setClinicContact(profile.clinic.phone || profile.clinic.email || "");
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(
            err instanceof ApiError ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim() : "Could not load the recorded doctor profile.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      touched.current = new Set();
    };
  }, [isOpen, visit.id]);

  useEffect(() => {
    if (practitionerName && !touched.current.has("doctorName")) {
      setDoctorName(practitionerName.startsWith("Dr.") ? practitionerName : `Dr. ${practitionerName}, MD`);
    }
  }, [practitionerName]);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("print-modal-open");
    } else {
      document.body.classList.remove("print-modal-open");
    }
    return () => document.body.classList.remove("print-modal-open");
  }, [isOpen]);

  if (!isOpen) return null;

  // Calculate age from DOB
  const calculateAge = (dobString?: string) => {
    if (!dobString) return null;
    const dob = new Date(dobString);
    if (isNaN(dob.getTime())) return null;
    const diffMs = Date.now() - dob.getTime();
    const ageDt = new Date(diffMs);
    return Math.abs(ageDt.getUTCFullYear() - 1970);
  };

  const patientAge = calculateAge(visit.dateOfBirth);
  const latestVitals = vitals.length > 0 ? vitals[0] : null;
  const latestNote = notes.length > 0 ? notes[0] : null;

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);




  const fetchPdfPreview = async () => {

    setPdfLoading(true);
    setPdfError(null);
    try {
      // Only fields actually edited in the settings drawer are sent as
      // overrides — everything else is rendered server-side from the recorded
      // practitioner profile (employees) and branch/tenant identity.
      const override: Record<string, string> = {};
      if (touched.current.has("doctorName") && doctorName.trim()) override.doctorName = doctorName.trim();
    if (touched.current.has("doctorTitle") && doctorTitle.trim()) override.doctorTitle = doctorTitle.trim();
      if (touched.current.has("doctorSpecialty") && doctorSpecialty.trim()) override.specialty = doctorSpecialty.trim();
      if (touched.current.has("prcNo") && prcNo.trim()) override.prcNumber = prcNo.trim();
      if (touched.current.has("ptrNo") && ptrNo.trim()) override.ptrNumber = ptrNo.trim();
      if (touched.current.has("s2No") && s2No.trim()) override.s2Number = s2No.trim();
      if (touched.current.has("clinicTitle") && clinicTitle.trim()) override.clinicName = clinicTitle.trim();
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) override.clinicAddress = clinicAddress.trim();
      if (touched.current.has("clinicContact") && clinicContact.trim()) override.clinicPhone = clinicContact.trim();
      if (touched.current.has("rxDiagnosis") && rxDiagnosis.trim()) override.diagnosis = rxDiagnosis.trim();
      if (touched.current.has("rxNotesAdvice") && rxNotesAdvice.trim()) override.advice = rxNotesAdvice.trim();
      if (touched.current.has("clinicalMemo") && clinicalMemo.trim()) override.clinicalNotes = clinicalMemo.trim();
      else if (clinicalMemo.trim()) override.clinicalNotes = clinicalMemo.trim();
      const params = new URLSearchParams(override);
      // apiGetBlob prepends /api/v1 and attaches the Bearer token automatically
      let path: string;
      if (activeTab === "RX") path = `/clinical/visits/${visit.id}/prescription-pdf?${params.toString()}`;
      else if (activeTab === "LAB") path = `/clinical/visits/${visit.id}/lab-request-pdf?${params.toString()}`;
      else path = `/clinical/visits/${visit.id}/orders-pdf?${params.toString()}`;

      const blob = await apiGetBlob(path);
      const blobUrl = window.URL.createObjectURL(blob);
      setPdfBlobUrl(old => {
        if (old) window.URL.revokeObjectURL(old);
        return blobUrl;
      });
    } catch (err) {
      const msg = err instanceof ApiError
        ? `${err.problem.title}${err.problem.detail ? ": " + err.problem.detail : ""}`
        : String(err);
      console.error("Failed to load PDF preview:", err);
      setPdfError(msg);
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    void fetchPdfPreview();
  }, [
    activeTab,
    visit.id,
    doctorName,
    doctorTitle,
    doctorSpecialty,
    prcNo,
    ptrNo,
    s2No,
    clinicTitle,
    clinicAddress,
    clinicContact,
    rxDiagnosis,
    rxNotesAdvice,
    clinicalMemo,
  ]);



  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    const prefix = activeTab === "RX" ? "Prescription-Rx" : activeTab === "LAB" ? "Lab-Requisition" : "Clinical-Orders";
    a.download = `${prefix}-${visit.visitNo || visit.id.slice(0, 8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenPdf = () => {
    if (!pdfBlobUrl) return;
    window.open(pdfBlobUrl, "_blank");
  };

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    } else {
      window.print();
    }
  };

  const modalContent = (
    <div
      className="modal show d-block clinic-rx-print-modal-backdrop"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      style={{
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        zIndex: 1050,
      }}
    >
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content shadow-lg border-0">
          {/* Modal Header (Hidden during Print) */}
          <div className="modal-header bg-dark text-white clinic-no-print d-flex justify-content-between align-items-center py-2 px-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ fontSize: "1.25rem" }}>🖨️</span>
              <div>
                <h5 className="modal-title mb-0 fs-6 fw-bold">
                  Doctor's Prescription &amp; Clinical Order Print Center
                </h5>
                <span className="small text-white-50">
                  Encounter: {visit.visitNo} · Patient: {visit.patientName}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={() => setShowConfig(!showConfig)}
                title="Customize Doctor Credentials and Clinic Header"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Doctor / Clinic Info"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-info text-dark fw-bold px-3 d-flex align-items-center gap-1"
                onClick={handleDownloadPdf}
                disabled={pdfLoading || !pdfBlobUrl}
                title="Download true vector PDF rendered via server print pipeline"
              >
                {pdfLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    <span>Rendering PDF...</span>
                  </>
                ) : (
                  <span>📥 Download Official PDF</span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-info text-white"
                onClick={handleOpenPdf}
                title="Open PDF in new browser tab"
              >
                ↗️ View PDF
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary px-3 fw-semibold"
                onClick={handlePrint}
              >
                🖨️ Print (Ctrl+P)
              </button>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
                aria-label="Close"
              />
            </div>
          </div>


          {/* Configuration drawer (Screen-only) */}
          {showConfig && (
            <div className="clinic-no-print p-3 bg-light border-bottom">
              {profileError ? (
                <div className="alert alert-warning py-2 small mb-2">{profileError}</div>
              ) : (
                <div className="text-muted small mb-2">
                  Pre-filled from the staff directory&rsquo;s recorded licensure (PRC / PTR / S2). Edit a field to override it on the printed document only — edits never change the recorded profile.
                </div>
              )}
              <div className="row g-2 small">
                <div className="col-md-3">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-doctor-name">Doctor Name &amp; Title</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-doctor-name"
                    value={doctorName}
                    onChange={(e) => {
                      markTouched("doctorName");
                      setDoctorName(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-doctor-title">Professional Title</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="e.g. Consultant, Internal Medicine"
                    id="pp-doctor-title"
                    value={doctorTitle}
                    onChange={(e) => {
                      markTouched("doctorTitle");
                      setDoctorTitle(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-specialty">Specialization</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-specialty"
                    value={doctorSpecialty}
                    onChange={(e) => {
                      markTouched("doctorSpecialty");
                      setDoctorSpecialty(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-prc">PRC License No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-prc"
                    value={prcNo}
                    onChange={(e) => {
                      markTouched("prcNo");
                      setPrcNo(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-ptr">PTR No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-ptr"
                    value={ptrNo}
                    onChange={(e) => {
                      markTouched("ptrNo");
                      setPtrNo(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-s2">S2 License No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-s2"
                    value={s2No}
                    onChange={(e) => {
                      markTouched("s2No");
                      setS2No(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-clinic-name">Clinic Name</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-clinic-name"
                    value={clinicTitle}
                    onChange={(e) => {
                      markTouched("clinicTitle");
                      setClinicTitle(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-clinic-address">Clinic Address</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-clinic-address"
                    value={clinicAddress}
                    onChange={(e) => {
                      markTouched("clinicAddress");
                      setClinicAddress(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold" htmlFor="pp-clinic-contact">Contact Details</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-clinic-contact"
                    value={clinicContact}
                    onChange={(e) => {
                      markTouched("clinicContact");
                      setClinicContact(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label mb-0 fw-semibold text-success" htmlFor="pp-rx-diagnosis">
                    Clinical Diagnosis / Impression (Printed on Rx Pad)
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-rx-diagnosis"
                    placeholder="e.g. Acute Bronchitis (J20.9)"
                    value={rxDiagnosis}
                    onChange={(e) => {
                      markTouched("rxDiagnosis");
                      setRxDiagnosis(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label mb-0 fw-semibold text-primary" htmlFor="pp-rx-advice">
                    Physician's Instructions & Care Advice (Printed on Rx Pad)
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    id="pp-rx-advice"
                    placeholder="e.g. Take with meals. Increase water intake. Follow up in 3 days."
                    value={rxNotesAdvice}
                    onChange={(e) => {
                      markTouched("rxNotesAdvice");
                      setRxNotesAdvice(e.target.value);
                    }}
                  />
                </div>
                <div className="col-md-12">
                  <label className="form-label mb-0 fw-semibold text-secondary" htmlFor="pp-rx-clinical-memo">
                    Clinical Notes / Memo Entry (Printed on prescription pad just before footer)
                  </label>
                  <textarea
                    className="form-control form-control-sm"
                    id="pp-rx-clinical-memo"
                    rows={2}
                    placeholder="e.g. Patient advised on strict lifestyle and dietary control. Return for repeat evaluation in 5 days."
                    value={clinicalMemo}
                    onChange={(e) => {
                      markTouched("clinicalMemo");
                      setClinicalMemo(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Subheader / Tabs selector (Screen-only) */}
          <div className="clinic-no-print bg-white px-3 pt-2 border-bottom d-flex justify-content-between align-items-center flex-wrap gap-2">
            <ul className="nav nav-pills small fw-semibold">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link py-1 px-3 ${activeTab === "RX" ? "active" : ""}`}
                  onClick={() => setActiveTab("RX")}
                >
                  💊 Prescription Slip (Rx) {prescriptions.length > 0 ? `(${prescriptions.length})` : ""}
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link py-1 px-3 ${activeTab === "LAB" ? "active" : ""}`}
                  onClick={() => setActiveTab("LAB")}
                >
                  🔬 Laboratory Request Slip {labOrders.length > 0 ? `(${labOrders.length})` : ""}
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link py-1 px-3 ${activeTab === "ALL" ? "active" : ""}`}
                  onClick={() => setActiveTab("ALL")}
                >
                  📋 Combined Encounter Orders (Rx + Labs + Plan)
                </button>
              </li>
            </ul>

            <div className="text-muted small">
              Print format: <strong>Standard 8.5" x 11" / Half-Sheet Clean Monochrome</strong>
            </div>
          </div>

          {/* Quick Doctor's Notes & Diagnosis Bar (Screen-only, instantly updates print preview) */}
          <div className="clinic-no-print bg-light px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap">
            <div className="d-flex align-items-center gap-1 flex-grow-1" style={{ minWidth: "260px" }}>
              <span className="badge bg-success-subtle text-success border border-success-subtle small text-nowrap">
                🩺 Diagnosis on Rx
              </span>
              <input
                type="text"
                className="form-control form-control-sm bg-white"
                placeholder="Clinical diagnosis / impression..."
                value={rxDiagnosis}
                onChange={(e) => {
                  markTouched("rxDiagnosis");
                  setRxDiagnosis(e.target.value);
                }}
              />
            </div>
            <div className="d-flex align-items-center gap-1 flex-grow-1" style={{ minWidth: "280px" }}>
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle small text-nowrap">
                📝 Notes / Instructions on Rx
              </span>
              <input
                type="text"
                className="form-control form-control-sm bg-white"
                placeholder="Doctor's instructions / advice for patient..."
                value={rxNotesAdvice}
                onChange={(e) => {
                  markTouched("rxNotesAdvice");
                  setRxNotesAdvice(e.target.value);
                }}
              />
            </div>
            <div className="d-flex align-items-center gap-1 flex-grow-1" style={{ minWidth: "280px" }}>
              <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle small text-nowrap">
                📋 Clinical Memo (pre-footer)
              </span>
              <input
                type="text"
                className="form-control form-control-sm bg-white"
                placeholder="Clinical notes / memo before footer..."
                value={clinicalMemo}
                onChange={(e) => {
                  markTouched("clinicalMemo");
                  setClinicalMemo(e.target.value);
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm py-0 px-2 text-nowrap"
              style={{ fontSize: "0.8rem", height: "30px" }}
              onClick={() => void fetchPdfPreview()}
              title="Apply edits to PDF preview"
            >
              🔄 Refresh Preview
            </button>
          </div>

          {/* Document Preview & Printable Area */}
          <div className="modal-body p-0 bg-secondary d-flex flex-column align-items-center justify-content-center" style={{ minHeight: "600px" }}>
            {pdfLoading ? (
              <div className="text-white d-flex flex-column align-items-center gap-2 py-5">
                <span className="spinner-border" style={{ width: "2.5rem", height: "2.5rem" }} />
                <span className="mt-2">Generating secure PDF via server print pipeline…</span>
                <small className="text-white-50">This may take a few seconds on first load</small>
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                ref={iframeRef}
                src={pdfBlobUrl}
                style={{ width: "100%", height: "100%", minHeight: "75vh", border: "none" }}
                title="PDF Preview"
              />
            ) : (
              <div className="d-flex flex-column align-items-center gap-3 py-5 text-white">
                <span style={{ fontSize: "2.5rem" }}>📄</span>
                <div className="fw-semibold">PDF Preview Unavailable</div>
                {pdfError && (
                  <div className="alert alert-warning text-dark text-start" style={{ maxWidth: "480px", fontSize: "0.85rem" }}>
                    {pdfError}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-outline-light btn-sm"
                  onClick={() => void fetchPdfPreview()}
                >
                  🔄 Retry
                </button>
              </div>
            )}
          </div>

          {/* Modal Footer (Screen-only) */}
          <div className="modal-footer bg-light clinic-no-print d-flex justify-content-between align-items-center py-2 px-3">
            <div className="text-muted small">
              📄 Official format: <strong>A4 / Letter Vector PDF with Deterministic Hash</strong>.
            </div>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-info text-dark btn-sm fw-bold px-3 d-flex align-items-center gap-1"
                onClick={handleDownloadPdf}
                disabled={pdfLoading || !pdfBlobUrl}
              >
                {pdfLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    <span>Rendering PDF...</span>
                  </>
                ) : (
                  <span>📥 Download Official PDF</span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-cerulean btn-sm px-4 fw-semibold"
                onClick={handlePrint}
              >
                🖨️ Print Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
