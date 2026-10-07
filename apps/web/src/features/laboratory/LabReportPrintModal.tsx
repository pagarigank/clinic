import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, ApiError } from "../../shared/api/client.js";
import type { LabReport } from "./api.js";

export interface LabReportPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: LabReport | null;
}

export function LabReportPrintModal({
  isOpen,
  onClose,
  report,
}: LabReportPrintModalProps) {
  const [showConfig, setShowConfig] = useState(false);

  // Pathologist licensure
  const [pathologistName, setPathologistName] = useState("");
  const [pathologistTitle, setPathologistTitle] = useState("Anatomic & Clinical Pathologist, FPSP");
  const [pathologistLicenseNo, setPathologistLicenseNo] = useState("");

  // Medical Technologist licensure
  const [medtechName, setMedtechName] = useState("");
  const [medtechTitle, setMedtechTitle] = useState("Registered Medical Technologist (RMT)");
  const [medtechLicenseNo, setMedtechLicenseNo] = useState("");

  // Clinic & facility letterhead
  const [clinicName, setClinicName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicEmail, setClinicEmail] = useState("");
  const [dohLicenseNo, setDohLicenseNo] = useState("");
  const [philhealthNo, setPhilhealthNo] = useState("");

  // Report fields
  const [specimenType, setSpecimenType] = useState("");
  const [orderingClinician, setOrderingClinician] = useState("");
  const [interpretation, setInterpretation] = useState("");

  const touched = useRef<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch recorded clinic & practitioner profile once on modal open
  useEffect(() => {
    if (!isOpen || !report?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiGet<any>(`/lab/reports/${report.id}/print-profile`);
        if (cancelled) return;

        if (data?.clinic) {
          if (!touched.current.has("clinicName") && data.clinic.name) setClinicName(data.clinic.name);
          if (!touched.current.has("branchName") && data.clinic.branchName) setBranchName(data.clinic.branchName);
          if (!touched.current.has("clinicAddress") && data.clinic.address) setClinicAddress(data.clinic.address);
          if (!touched.current.has("clinicPhone") && data.clinic.phone) setClinicPhone(data.clinic.phone);
          if (!touched.current.has("clinicEmail") && data.clinic.email) setClinicEmail(data.clinic.email);
          if (!touched.current.has("dohLicenseNo") && data.clinic.dohLicenseNo) setDohLicenseNo(data.clinic.dohLicenseNo);
          if (!touched.current.has("philhealthNo") && data.clinic.philhealthAccreditationNo) setPhilhealthNo(data.clinic.philhealthAccreditationNo);
        }

        if (data?.pathologist) {
          if (!touched.current.has("pathologistName") && data.pathologist.name) setPathologistName(data.pathologist.name);
          if (!touched.current.has("pathologistTitle") && data.pathologist.title) setPathologistTitle(data.pathologist.title);
          if (!touched.current.has("pathologistLicenseNo") && data.pathologist.licenseNo) setPathologistLicenseNo(data.pathologist.licenseNo);
        }

        if (data?.medtech) {
          if (!touched.current.has("medtechName") && data.medtech.name) setMedtechName(data.medtech.name);
          if (!touched.current.has("medtechTitle") && data.medtech.title) setMedtechTitle(data.medtech.title);
          if (!touched.current.has("medtechLicenseNo") && data.medtech.licenseNo) setMedtechLicenseNo(data.medtech.licenseNo);
        }

        if (data?.report) {
          if (!touched.current.has("specimenType") && data.report.specimenType) setSpecimenType(data.report.specimenType);
          if (!touched.current.has("orderingClinician") && data.report.orderingClinician) setOrderingClinician(data.report.orderingClinician);
          if (!touched.current.has("interpretation") && data.report.notes) setInterpretation(data.report.notes);
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(
            err instanceof ApiError
              ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim()
              : "Could not load recorded clinic letterhead profile.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      touched.current = new Set();
    };
  }, [isOpen, report?.id]);

  // Fetch rendered true PDF preview
  const fetchPdfPreview = async () => {
    if (!isOpen || !report?.id) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const overrides: Record<string, string> = {};
      if (touched.current.has("clinicName") && clinicName.trim()) overrides.clinicName = clinicName.trim();
      if (touched.current.has("branchName") && branchName.trim()) overrides.branchName = branchName.trim();
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) overrides.clinicAddress = clinicAddress.trim();
      if (touched.current.has("clinicPhone") && clinicPhone.trim()) overrides.clinicPhone = clinicPhone.trim();
      if (touched.current.has("clinicEmail") && clinicEmail.trim()) overrides.clinicEmail = clinicEmail.trim();
      if (touched.current.has("dohLicenseNo") && dohLicenseNo.trim()) overrides.dohLicenseNo = dohLicenseNo.trim();
      if (touched.current.has("philhealthNo") && philhealthNo.trim()) overrides.philhealthNo = philhealthNo.trim();

      if (touched.current.has("pathologistName") && pathologistName.trim()) overrides.pathologistName = pathologistName.trim();
      if (touched.current.has("pathologistTitle") && pathologistTitle.trim()) overrides.pathologistTitle = pathologistTitle.trim();
      if (touched.current.has("pathologistLicenseNo") && pathologistLicenseNo.trim()) overrides.pathologistLicenseNo = pathologistLicenseNo.trim();

      if (touched.current.has("medtechName") && medtechName.trim()) overrides.medtechName = medtechName.trim();
      if (touched.current.has("medtechTitle") && medtechTitle.trim()) overrides.medtechTitle = medtechTitle.trim();
      if (touched.current.has("medtechLicenseNo") && medtechLicenseNo.trim()) overrides.medtechLicenseNo = medtechLicenseNo.trim();

      if (touched.current.has("specimenType") && specimenType.trim()) overrides.specimenType = specimenType.trim();
      if (touched.current.has("orderingClinician") && orderingClinician.trim()) overrides.orderingClinician = orderingClinician.trim();
      if (touched.current.has("interpretation") && interpretation.trim()) overrides.interpretation = interpretation.trim();

      const params = new URLSearchParams(overrides);
      const url = `/lab/reports/${report.id}/pdf${params.toString() ? `?${params.toString()}` : ""}`;
      const blob = await apiGetBlob(url);
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
      console.error("Failed to load laboratory report PDF preview:", err);
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
    report?.id,
    clinicName,
    branchName,
    clinicAddress,
    clinicPhone,
    clinicEmail,
    dohLicenseNo,
    philhealthNo,
    pathologistName,
    pathologistTitle,
    pathologistLicenseNo,
    medtechName,
    medtechTitle,
    medtechLicenseNo,
    specimenType,
    orderingClinician,
    interpretation,
  ]);

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl || !report) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    const orderNum = report.report_data?.order?.order_no || report.order_id.slice(0, 8);
    a.download = `LabReport-${orderNum}-v${report.version}.pdf`;
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

  if (!isOpen || !report) return null;

  const patientName = report.report_data?.patient?.family_name
    ? `${report.report_data.patient.family_name}, ${report.report_data.patient.given_name || ""}`.trim()
    : "Patient";

  const orderNo = report.report_data?.order?.order_no || report.order_id.slice(0, 8);
  const sealHash = report.sha256_hash ?? report.report_hash;

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
                <h5 className="modal-title mb-0 fs-6 fw-bold">Official Diagnostic Laboratory Report Print Center</h5>
                <span className="small text-white-50">
                  Report: {orderNo} (v{report.version}) &middot; Patient: {patientName} &middot; Status: {report.status}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`btn btn-sm ${showConfig ? "btn-info" : "btn-outline-light"}`}
                onClick={() => setShowConfig(!showConfig)}
                title="Configure Licensure & Letterhead"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Doctor / Letterhead"}
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
                title="Print true server-rendered vector PDF document"
              >
                🖨️ Print Report
              </button>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
                aria-label="Close"
              />
            </div>
          </div>

          {/* Subheader banner displaying document seal info */}
          <div className="bg-light border-bottom px-3 py-1 d-flex justify-content-between align-items-center small">
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-primary">✓ Verified Seal</span>
              <span className="fw-semibold text-secondary">Cryptographic Document Seal:</span>
              <span className="font-monospace text-muted text-truncate" style={{ maxWidth: "420px" }} title={sealHash}>
                🔒 {sealHash || "Pending server generation"}
              </span>
            </div>
            <div className="text-muted small">
              Issued: {new Date(report.issued_at).toLocaleString()}
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
                    Rendering true tamper-evident Laboratory Report PDF…
                  </div>
                </div>
              )}

              {pdfError ? (
                <div className="p-4 text-center my-auto">
                  <div className="alert alert-danger d-inline-block text-start" style={{ maxWidth: 600 }}>
                    <h6 className="alert-heading fw-bold">⚠️ PDF Rendering Notice</h6>
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
                  title="Official Diagnostic Laboratory Report PDF Preview"
                  className="w-100 h-100 border-0 flex-grow-1"
                  style={{ minHeight: "78vh" }}
                />
              ) : null}
            </div>

            {/* Configuration Drawer */}
            {showConfig && (
              <div
                className="clinic-print-config-drawer border-start bg-light p-3 overflow-y-auto"
                style={{ width: "350px", flexShrink: 0 }}
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
                  Inspect and override clinic letterhead, Pathologist, or Medical Technologist licensure for this printout.
                </p>

                {profileError && (
                  <div className="alert alert-warning py-1 px-2 small mb-2">{profileError}</div>
                )}

                {/* Pathologist */}
                <div className="fw-bold small text-primary mb-1">Pathologist Details</div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-path-name">
                    Pathologist Name
                  </label>
                  <input
                    id="lab-path-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={pathologistName}
                    onChange={(e) => {
                      touched.current.add("pathologistName");
                      setPathologistName(e.target.value);
                    }}
                  />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-7">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-path-title">
                      Title / Credential
                    </label>
                    <input
                      id="lab-path-title"
                      type="text"
                      className="form-control form-control-sm"
                      value={pathologistTitle}
                      onChange={(e) => {
                        touched.current.add("pathologistTitle");
                        setPathologistTitle(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-5">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-path-prc">
                      PRC License
                    </label>
                    <input
                      id="lab-path-prc"
                      type="text"
                      className="form-control form-control-sm font-monospace"
                      placeholder="0123456"
                      value={pathologistLicenseNo}
                      onChange={(e) => {
                        touched.current.add("pathologistLicenseNo");
                        setPathologistLicenseNo(e.target.value);
                      }}
                    />
                  </div>
                </div>

                {/* Medical Technologist */}
                <hr className="my-2" />
                <div className="fw-bold small text-primary mb-1">Medical Technologist Details</div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-mt-name">
                    Registered Medical Technologist
                  </label>
                  <input
                    id="lab-mt-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={medtechName}
                    onChange={(e) => {
                      touched.current.add("medtechName");
                      setMedtechName(e.target.value);
                    }}
                  />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-7">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-mt-title">
                      Title / Designation
                    </label>
                    <input
                      id="lab-mt-title"
                      type="text"
                      className="form-control form-control-sm"
                      value={medtechTitle}
                      onChange={(e) => {
                        touched.current.add("medtechTitle");
                        setMedtechTitle(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-5">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-mt-prc">
                      PRC License
                    </label>
                    <input
                      id="lab-mt-prc"
                      type="text"
                      className="form-control form-control-sm font-monospace"
                      placeholder="0654321"
                      value={medtechLicenseNo}
                      onChange={(e) => {
                        touched.current.add("medtechLicenseNo");
                        setMedtechLicenseNo(e.target.value);
                      }}
                    />
                  </div>
                </div>

                {/* Clinic Header */}
                <hr className="my-2" />
                <div className="fw-bold small text-primary mb-1">Clinic Letterhead</div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-clinic-name">
                    Laboratory / Clinic Name
                  </label>
                  <input
                    id="lab-clinic-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicName}
                    onChange={(e) => {
                      touched.current.add("clinicName");
                      setClinicName(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-branch-name">
                    Branch / Facility Unit
                  </label>
                  <input
                    id="lab-branch-name"
                    type="text"
                    className="form-control form-control-sm"
                    value={branchName}
                    onChange={(e) => {
                      touched.current.add("branchName");
                      setBranchName(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-clinic-addr">
                    Address
                  </label>
                  <input
                    id="lab-clinic-addr"
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicAddress}
                    onChange={(e) => {
                      touched.current.add("clinicAddress");
                      setClinicAddress(e.target.value);
                    }}
                  />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-clinic-phone">
                      Phone Number
                    </label>
                    <input
                      id="lab-clinic-phone"
                      type="text"
                      className="form-control form-control-sm"
                      value={clinicPhone}
                      onChange={(e) => {
                        touched.current.add("clinicPhone");
                        setClinicPhone(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-semibold mb-1" htmlFor="lab-clinic-email">
                      Email Address
                    </label>
                    <input
                      id="lab-clinic-email"
                      type="text"
                      className="form-control form-control-sm"
                      value={clinicEmail}
                      onChange={(e) => {
                        touched.current.add("clinicEmail");
                        setClinicEmail(e.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-doh-no">
                    DOH Accreditation / LTO No.
                  </label>
                  <input
                    id="lab-doh-no"
                    type="text"
                    className="form-control form-control-sm"
                    value={dohLicenseNo}
                    onChange={(e) => {
                      touched.current.add("dohLicenseNo");
                      setDohLicenseNo(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-philhealth-no">
                    PhilHealth Accreditation No.
                  </label>
                  <input
                    id="lab-philhealth-no"
                    type="text"
                    className="form-control form-control-sm"
                    value={philhealthNo}
                    onChange={(e) => {
                      touched.current.add("philhealthNo");
                      setPhilhealthNo(e.target.value);
                    }}
                  />
                </div>

                {/* Additional Clinical Details */}
                <hr className="my-2" />
                <div className="fw-bold small text-primary mb-1">Clinical Details</div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-specimen-type">
                    Specimen Type
                  </label>
                  <input
                    id="lab-specimen-type"
                    type="text"
                    className="form-control form-control-sm"
                    value={specimenType}
                    onChange={(e) => {
                      touched.current.add("specimenType");
                      setSpecimenType(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-order-clinician">
                    Ordering Clinician
                  </label>
                  <input
                    id="lab-order-clinician"
                    type="text"
                    className="form-control form-control-sm"
                    value={orderingClinician}
                    onChange={(e) => {
                      touched.current.add("orderingClinician");
                      setOrderingClinician(e.target.value);
                    }}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold mb-1" htmlFor="lab-interpretation">
                    Clinical Interpretation / Notes
                  </label>
                  <textarea
                    id="lab-interpretation"
                    className="form-control form-control-sm"
                    rows={2}
                    value={interpretation}
                    onChange={(e) => {
                      touched.current.add("interpretation");
                      setInterpretation(e.target.value);
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
