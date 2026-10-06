import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, ApiError } from "../../shared/api/client.js";

export interface MedicalCertificatePrintData {
  id: string;
  doc_no: string;
  cert_type: "FIT_TO_WORK" | "SICK_LEAVE" | "CLEARANCE" | string;
  findings?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  issued_at?: string;
  voided_at?: string | null;
}

export interface MedicalCertificatePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  cert: MedicalCertificatePrintData;
  visit: {
    id: string;
    visitNo?: string;
    patientId?: string;
    patientName?: string;
    dateOfBirth?: string;
    gender?: string;
    clinicName?: string;
    branchName?: string;
    chiefComplaint?: string;
  };
  diagnoses?: Array<{
    icd10Code?: string;
    icd10_code?: string;
    description?: string;
    icd10_description?: string;
  }>;
  practitionerName?: string;
}

export function MedicalCertificatePrintModal({
  isOpen,
  onClose,
  cert,
  visit,
  diagnoses = [],
  practitionerName,
}: MedicalCertificatePrintModalProps) {
  const [showConfig, setShowConfig] = useState(false);

  // Doctor & clinic configuration overrides
  const [doctorName, setDoctorName] = useState(practitionerName || "");
  const [doctorTitle, setDoctorTitle] = useState("Attending Physician");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [prcNo, setPrcNo] = useState("");
  const [ptrNo, setPtrNo] = useState("");
  const [s2No, setS2No] = useState("");
  const [clinicTitle, setClinicTitle] = useState(visit.clinicName || "");
  const [clinicSubtitle, setClinicSubtitle] = useState(visit.branchName || "");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicContact, setClinicContact] = useState("");

  const defaultDx =
    cert.findings?.trim() ||
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
      : visit.chiefComplaint || "");

  const [diagnosis, setDiagnosis] = useState(defaultDx);
  const touched = useRef<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load practitioner profile once
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await apiGet<any>(`/clinical/visits/${visit.id}/print-profile`);
        if (cancelled) return;
        const p = profile?.practitioner;
        if (p?.name && !touched.current.has("doctorName")) {
          setDoctorName(p.name.startsWith("Dr.") ? p.name : `Dr. ${p.name}, MD`);
        }
        if (!touched.current.has("doctorTitle") && p?.jobTitle) setDoctorTitle(p.jobTitle);
        if (!touched.current.has("doctorSpecialty") && p?.specialization) setDoctorSpecialty(p.specialization);
        if (!touched.current.has("prcNo") && p?.prcLicenseNo) setPrcNo(p.prcLicenseNo);
        if (!touched.current.has("ptrNo") && p?.ptrNo) setPtrNo(p.ptrNo);
        if (!touched.current.has("s2No") && p?.s2LicenseNo) setS2No(p.s2LicenseNo);
        if (!touched.current.has("clinicTitle") && (profile?.clinic?.name || visit.clinicName)) {
          setClinicTitle(profile?.clinic?.name || visit.clinicName || "");
        }
        if (!touched.current.has("clinicSubtitle") && (profile?.clinic?.branchName || visit.branchName)) {
          setClinicSubtitle(profile?.clinic?.branchName || visit.branchName || "");
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(
            err instanceof ApiError
              ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim()
              : "Could not load recorded doctor profile.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      touched.current = new Set();
    };
  }, [isOpen, visit.id, visit.clinicName, visit.branchName]);

  // Fetch rendered PDF preview
  const fetchPdfPreview = async () => {
    if (!isOpen || !cert?.id) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const overrides: Record<string, string> = {};
      if (touched.current.has("doctorName") && doctorName.trim()) overrides.doctorName = doctorName.trim();
      if (touched.current.has("doctorTitle") && doctorTitle.trim()) overrides.doctorTitle = doctorTitle.trim();
      if (touched.current.has("doctorSpecialty") && doctorSpecialty.trim()) overrides.specialty = doctorSpecialty.trim();
      if (touched.current.has("prcNo") && prcNo.trim()) overrides.prcNumber = prcNo.trim();
      if (touched.current.has("ptrNo") && ptrNo.trim()) overrides.ptrNumber = ptrNo.trim();
      if (touched.current.has("s2No") && s2No.trim()) overrides.s2Number = s2No.trim();
      if (touched.current.has("clinicTitle") && clinicTitle.trim()) overrides.clinicName = clinicTitle.trim();
      if (touched.current.has("clinicSubtitle") && clinicSubtitle.trim()) overrides.branchName = clinicSubtitle.trim();
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) overrides.clinicAddress = clinicAddress.trim();
      if (touched.current.has("clinicContact") && clinicContact.trim()) overrides.clinicPhone = clinicContact.trim();
      if (touched.current.has("diagnosis") && diagnosis.trim()) overrides.diagnosis = diagnosis.trim();

      const params = new URLSearchParams(overrides);
      const blob = await apiGetBlob(`/clinical/certificates/${cert.id}/pdf?${params.toString()}`);
      const blobUrl = window.URL.createObjectURL(blob);
      setPdfBlobUrl((old) => {
        if (old) window.URL.revokeObjectURL(old);
        return blobUrl;
      });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.problem.title}${err.problem.detail ? ": " + err.problem.detail : ""}`
          : String(err);
      console.error("Failed to load certificate PDF preview:", err);
      setPdfError(msg);
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    void fetchPdfPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    cert.id,
    doctorName,
    doctorTitle,
    doctorSpecialty,
    prcNo,
    ptrNo,
    s2No,
    clinicTitle,
    clinicSubtitle,
    clinicAddress,
    clinicContact,
    diagnosis,
  ]);

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = `MedicalCertificate-${cert.doc_no || cert.id.slice(0, 8)}.pdf`;
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
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    } else if (pdfBlobUrl) {
      window.open(pdfBlobUrl, "_blank");
    }
  };

  if (!isOpen) return null;

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
      <div className="modal-dialog modal-xl modal-dialog-scrollable" style={{ maxHeight: "96vh" }}>
        <div className="modal-content shadow-lg border-0 h-100">
          {/* Header */}
          <div className="modal-header bg-dark text-white clinic-no-print d-flex justify-content-between align-items-center py-2 px-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ fontSize: "1.25rem" }}>📜</span>
              <div>
                <h5 className="modal-title mb-0 fs-6 fw-bold">Official Medical Certificate Print Center</h5>
                <span className="small text-white-50">
                  Certificate: {cert.doc_no} · Patient: {visit.patientName || "Patient"} · Type:{" "}
                  {cert.cert_type === "FIT_TO_WORK"
                    ? "Fit to Work"
                    : cert.cert_type === "SICK_LEAVE"
                      ? "Sick Leave"
                      : "Medical Clearance"}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`btn btn-sm ${showConfig ? "btn-info" : "btn-outline-light"}`}
                onClick={() => setShowConfig(!showConfig)}
                title="Configure Doctor licensure & Letterhead"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Doctor / Header"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={handleDownloadPdf}
                disabled={!pdfBlobUrl}
                title="Download raw server-signed PDF bytes"
              >
                📥 Download PDF
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={handleOpenPdf}
                disabled={!pdfBlobUrl}
                title="Open PDF in a new browser tab"
              >
                ↗️ Open in Tab
              </button>
              <button
                type="button"
                className="btn btn-sm btn-success fw-bold px-3"
                onClick={handlePrint}
                disabled={!pdfBlobUrl || pdfLoading}
                title="Print true server-rendered PDF document"
              >
                🖨️ Print Certificate
              </button>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
                aria-label="Close"
              />
            </div>
          </div>

          {/* Modal Body */}
          <div className="modal-body p-0 d-flex flex-row overflow-hidden" style={{ minHeight: "78vh" }}>
            {/* Live PDF Viewer */}
            <div className="flex-grow-1 bg-secondary bg-opacity-10 d-flex flex-column position-relative">
              {pdfLoading && (
                <div
                  className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75"
                  style={{ zIndex: 10 }}
                >
                  <div className="spinner-border text-primary mb-2" role="status" />
                  <div className="small fw-semibold text-muted">
                    Rendering true tamper-evident Medical Certificate PDF…
                  </div>
                </div>
              )}

              {pdfError ? (
                <div className="p-4 text-center my-auto">
                  <div className="alert alert-danger d-inline-block text-start" style={{ maxWidth: 600 }}>
                    <h6 className="alert-heading fw-bold">⚠️ PDF Rendering Error</h6>
                    <p className="small mb-2">{pdfError}</p>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => void fetchPdfPreview()}
                    >
                      Retry Rendering
                    </button>
                  </div>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  ref={iframeRef}
                  src={pdfBlobUrl}
                  title="Official Medical Certificate PDF Preview"
                  className="w-100 h-100 border-0 flex-grow-1"
                  style={{ minHeight: "78vh" }}
                />
              ) : null}
            </div>

            {/* Configuration Drawer */}
            {showConfig && (
              <div
                className="clinic-print-config-drawer border-start bg-light p-3 overflow-y-auto"
                style={{ width: "340px", flexShrink: 0 }}
              >
                <div className="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
                  <h6 className="fw-bold mb-0 text-dark small text-uppercase">Letterhead &amp; Licensure</h6>
                  <button
                    type="button"
                    className="btn-close btn-sm"
                    onClick={() => setShowConfig(false)}
                    aria-label="Close settings"
                  />
                </div>
                <p className="small text-muted mb-3" style={{ fontSize: "0.78rem" }}>
                  Adjust doctor credentials or clinic letterhead for this certificate printout.
                </p>

                {profileError && (
                  <div className="alert alert-warning py-1 px-2 small mb-2">{profileError}</div>
                )}

                {/* Attending Physician */}
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-doc-name">
                    Attending Physician
                  </label>
                  <input
                    id="cert-doc-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={doctorName}
                    onChange={(e) => {
                      touched.current.add("doctorName");
                      setDoctorName(e.target.value);
                    }}
                  />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="cert-doc-title">
                      Title
                    </label>
                    <input
                      id="cert-doc-title"
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="Attending Physician"
                      value={doctorTitle}
                      onChange={(e) => {
                        touched.current.add("doctorTitle");
                        setDoctorTitle(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="cert-doc-spec">
                      Specialty
                    </label>
                    <input
                      id="cert-doc-spec"
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="e.g. Internal Medicine"
                      value={doctorSpecialty}
                      onChange={(e) => {
                        touched.current.add("doctorSpecialty");
                        setDoctorSpecialty(e.target.value);
                      }}
                    />
                  </div>
                </div>

                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="cert-prc-no">
                      PRC License No.
                    </label>
                    <input
                      id="cert-prc-no"
                      type="text"
                      className="form-control form-control-sm font-monospace"
                      placeholder="0123456"
                      value={prcNo}
                      onChange={(e) => {
                        touched.current.add("prcNo");
                        setPrcNo(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="cert-ptr-no">
                      PTR No.
                    </label>
                    <input
                      id="cert-ptr-no"
                      type="text"
                      className="form-control form-control-sm font-monospace"
                      placeholder="PTR-789012"
                      value={ptrNo}
                      onChange={(e) => {
                        touched.current.add("ptrNo");
                        setPtrNo(e.target.value);
                      }}
                    />
                  </div>
                </div>

                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-s2-no">
                    S2 License No. (if applicable)
                  </label>
                  <input
                    id="cert-s2-no"
                    type="text"
                    className="form-control form-control-sm font-monospace"
                    placeholder="S2-345678"
                    value={s2No}
                    onChange={(e) => {
                      touched.current.add("s2No");
                      setS2No(e.target.value);
                    }}
                  />
                </div>

                {/* Clinic Header */}
                <hr className="my-2" />
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-clinic-title">
                    Clinic / Facility Name
                  </label>
                  <input
                    id="cert-clinic-title"
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicTitle}
                    onChange={(e) => {
                      touched.current.add("clinicTitle");
                      setClinicTitle(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-clinic-branch">
                    Branch / Department
                  </label>
                  <input
                    id="cert-clinic-branch"
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicSubtitle}
                    onChange={(e) => {
                      touched.current.add("clinicSubtitle");
                      setClinicSubtitle(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-clinic-addr">
                    Clinic Address
                  </label>
                  <input
                    id="cert-clinic-addr"
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="e.g. 123 Health Ave, Manila"
                    value={clinicAddress}
                    onChange={(e) => {
                      touched.current.add("clinicAddress");
                      setClinicAddress(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-clinic-phone">
                    Contact Number
                  </label>
                  <input
                    id="cert-clinic-phone"
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="e.g. (02) 8123-4567"
                    value={clinicContact}
                    onChange={(e) => {
                      touched.current.add("clinicContact");
                      setClinicContact(e.target.value);
                    }}
                  />
                </div>

                {/* Clinical Diagnosis override */}
                <hr className="my-2" />
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="cert-dx">
                    Clinical Diagnosis / Impression
                  </label>
                  <textarea
                    id="cert-dx"
                    className="form-control form-control-sm"
                    rows={2}
                    value={diagnosis}
                    onChange={(e) => {
                      touched.current.add("diagnosis");
                      setDiagnosis(e.target.value);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
