import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, apiPost, ApiError } from "../../shared/api/client.js";

export interface ReceiptPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: {
    id: string;
    payment_no?: string;
    paymentNo?: string;
    receiptNumber?: string;
    amount?: number | string;
    amountPaid?: number | string;
    tendered_amount?: number | string;
    tendered?: number | string;
    change_amount?: number | string;
    change?: number | string;
    method_name?: string;
    paymentMethod?: string;
    reprint_count?: number;
    reprintCount?: number;
    isReprint?: boolean;
    receipt_file_id?: string;
    receipt_sha256?: string;
    invoice_no?: string;
    invoiceNo?: string;
    received_at?: string;
    date?: string;
    patient_first_name?: string;
    patient_last_name?: string;
    patientName?: string;
    cashier?: string;
    cashier_name?: string;
  } | null;
  onReprintSuccess?: (updated: any) => void;
}

export function ReceiptPrintModal({
  isOpen,
  onClose,
  payment,
  onReprintSuccess,
}: ReceiptPrintModalProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [showReprintModal, setShowReprintModal] = useState(false);
  const [reprintReason, setReprintReason] = useState("");
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprintAlert, setReprintAlert] = useState<{ tone: string; message: string } | null>(null);

  // Clinic & facility letterhead
  const [clinicName, setClinicName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicEmail, setClinicEmail] = useState("");
  const [tin, setTin] = useState("");
  const [dohAccreditationNo, setDohAccreditationNo] = useState("");
  const [philhealthAccreditationNo, setPhilhealthAccreditationNo] = useState("");

  // Cashier particulars
  const [cashierName, setCashierName] = useState("");

  const touched = useRef<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch recorded clinic & cashier profile once on modal open
  useEffect(() => {
    if (!isOpen || !payment?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiGet<any>(`/billing/payments/${payment.id}/print-profile`);
        if (cancelled) return;

        if (data?.clinic) {
          if (!touched.current.has("clinicName") && data.clinic.name) setClinicName(data.clinic.name);
          if (!touched.current.has("branchName") && data.clinic.branchName) setBranchName(data.clinic.branchName);
          if (!touched.current.has("clinicAddress") && data.clinic.address) setClinicAddress(data.clinic.address);
          if (!touched.current.has("clinicPhone") && data.clinic.phone) setClinicPhone(data.clinic.phone);
          if (!touched.current.has("clinicEmail") && data.clinic.email) setClinicEmail(data.clinic.email);
          if (!touched.current.has("tin") && data.clinic.tin) setTin(data.clinic.tin);
          if (!touched.current.has("dohAccreditationNo") && data.clinic.dohAccreditationNo) setDohAccreditationNo(data.clinic.dohAccreditationNo);
          if (!touched.current.has("philhealthAccreditationNo") && data.clinic.philhealthAccreditationNo) setPhilhealthAccreditationNo(data.clinic.philhealthAccreditationNo);
        }

        if (data?.cashier?.name) {
          if (!touched.current.has("cashierName")) setCashierName(data.cashier.name);
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
  }, [isOpen, payment?.id]);

  // Fetch rendered true PDF preview
  const fetchPdfPreview = async () => {
    if (!isOpen || !payment?.id) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const overrides: Record<string, string> = {};
      if (touched.current.has("clinicName") && clinicName.trim()) overrides.clinicName = clinicName.trim();
      if (touched.current.has("branchName") && branchName.trim()) overrides.branchName = branchName.trim();
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) overrides.clinicAddress = clinicAddress.trim();
      if (touched.current.has("clinicPhone") && clinicPhone.trim()) overrides.clinicPhone = clinicPhone.trim();
      if (touched.current.has("clinicEmail") && clinicEmail.trim()) overrides.clinicEmail = clinicEmail.trim();
      if (touched.current.has("tin") && tin.trim()) overrides.tin = tin.trim();
      if (touched.current.has("dohAccreditationNo") && dohAccreditationNo.trim()) overrides.dohAccreditationNo = dohAccreditationNo.trim();
      if (touched.current.has("philhealthAccreditationNo") && philhealthAccreditationNo.trim()) overrides.philhealthAccreditationNo = philhealthAccreditationNo.trim();
      if (touched.current.has("cashierName") && cashierName.trim()) overrides.cashierName = cashierName.trim();

      const params = new URLSearchParams(overrides);
      const url = `/billing/payments/${payment.id}/receipt-pdf${params.toString() ? `?${params.toString()}` : ""}`;
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
      console.error("Failed to load receipt PDF preview:", err);
      setPdfError(msg);
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    void fetchPdfPreview();
  }, [
    isOpen,
    payment?.id,
    clinicName,
    branchName,
    clinicAddress,
    clinicPhone,
    clinicEmail,
    tin,
    dohAccreditationNo,
    philhealthAccreditationNo,
    cashierName,
  ]);

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl || !payment) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    const rcptNo = payment.payment_no || payment.paymentNo || payment.receiptNumber || payment.id.slice(0, 8);
    a.download = `Receipt-${rcptNo}.pdf`;
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

  const handleExecuteReprint = async () => {
    if (!payment?.id || !reprintReason.trim()) return;
    setReprintLoading(true);
    setReprintAlert(null);
    try {
      const updated = await apiPost<any>(`/billing/payments/${payment.id}/reprint`, {
        reason: reprintReason.trim(),
      });
      setShowReprintModal(false);
      setReprintReason("");
      if (onReprintSuccess) onReprintSuccess(updated);
      void fetchPdfPreview();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim()
          : String(err);
      setReprintAlert({ tone: "danger", message: msg });
    } finally {
      setReprintLoading(false);
    }
  };

  if (!isOpen || !payment) return null;

  const patientName = payment.patientName || (
    payment.patient_first_name || payment.patient_last_name
      ? `${payment.patient_last_name || ""}, ${payment.patient_first_name || ""}`.trim().replace(/^,|,$/g, "")
      : "Patient"
  );

  const receiptNo = payment.receiptNumber || payment.payment_no || payment.paymentNo || payment.id.slice(0, 8);
  const sealHash = payment.receipt_sha256;
  const isReprint = Boolean(payment.isReprint || (payment.reprint_count && payment.reprint_count > 0) || (payment.reprintCount && payment.reprintCount > 0));
  const reprintCount = payment.reprint_count ?? payment.reprintCount ?? 0;

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
              <span style={{ fontSize: "1.25rem" }}>🧾</span>
              <div>
                <h5 className="modal-title mb-0 fs-6 fw-bold">Official Receipt (OR) Print Center</h5>
                <span className="small text-white-50">
                  Receipt: {receiptNo} {isReprint ? `(Reprint #${reprintCount})` : ""} &middot; Patient: {patientName}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-sm btn-outline-warning"
                onClick={() => setShowReprintModal(true)}
                title="Log Audited Re-issue / Reprint under BIR regulations"
              >
                📋 Audited Reprint
              </button>
              <button
                type="button"
                className={`btn btn-sm ${showConfig ? "btn-info" : "btn-outline-light"}`}
                onClick={() => setShowConfig(!showConfig)}
                title="Configure Letterhead & Cashier Particulars"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Letterhead / Cashier"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={handleDownloadPdf}
                disabled={!pdfBlobUrl}
                title="Download raw server-signed vector PDF"
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
                🖨️ Print Receipt
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
              <span className="badge bg-primary">✓ BIR-Compliant Receipt</span>
              <span className="fw-semibold text-secondary">Cryptographic Receipt Seal:</span>
              <span className="font-monospace text-muted text-truncate" style={{ maxWidth: "420px" }} title={sealHash || "Deterministic Vector PDF"}>
                🔒 {sealHash || "Deterministic SHA-256 Vector PDF"}
              </span>
            </div>
            <div className="text-muted small">
              Date: {new Date(payment.received_at || payment.date || Date.now()).toLocaleString()}
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
                    Rendering true tamper-evident Official Receipt PDF…
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
                  title="Official Receipt PDF Preview"
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
                  <h6 className="fw-bold mb-0 text-dark small text-uppercase">Letterhead &amp; Cashier</h6>
                  <button
                    type="button"
                    className="btn-close btn-sm"
                    onClick={() => setShowConfig(false)}
                    aria-label="Close settings"
                  />
                </div>
                <p className="small text-muted mb-3" style={{ fontSize: "0.78rem" }}>
                  Inspect and override clinic letterhead, BIR particulars, or cashier officer for this printout.
                </p>

                {profileError && (
                  <div className="alert alert-warning py-1 px-2 small mb-2" style={{ fontSize: "0.75rem" }}>
                    {profileError}
                  </div>
                )}

                {/* Facility / Tenant Letterhead */}
                <div className="card mb-3 border-0 shadow-sm">
                  <div className="card-header bg-white py-1 px-2 fw-bold text-dark small">
                    Facility / Clinic Information
                  </div>
                  <div className="card-body p-2">
                    <div className="mb-2">
                      <label className="form-label small mb-0 fw-semibold">Clinic / Facility Name</label>
                      <input
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
                      <label className="form-label small mb-0 fw-semibold">Branch / Division</label>
                      <input
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
                      <label className="form-label small mb-0 fw-semibold">Facility Address</label>
                      <textarea
                        rows={2}
                        className="form-control form-control-sm"
                        value={clinicAddress}
                        onChange={(e) => {
                          touched.current.add("clinicAddress");
                          setClinicAddress(e.target.value);
                        }}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0 fw-semibold">Phone Number(s)</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={clinicPhone}
                        onChange={(e) => {
                          touched.current.add("clinicPhone");
                          setClinicPhone(e.target.value);
                        }}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0 fw-semibold">Email Address</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={clinicEmail}
                        onChange={(e) => {
                          touched.current.add("clinicEmail");
                          setClinicEmail(e.target.value);
                        }}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0 fw-semibold">Tax Identification No. (TIN)</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={tin}
                        onChange={(e) => {
                          touched.current.add("tin");
                          setTin(e.target.value);
                        }}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0 fw-semibold">DOH Accreditation / License No.</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={dohAccreditationNo}
                        onChange={(e) => {
                          touched.current.add("dohAccreditationNo");
                          setDohAccreditationNo(e.target.value);
                        }}
                      />
                    </div>
                    <div className="mb-1">
                      <label className="form-label small mb-0 fw-semibold">PhilHealth Accreditation No.</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={philhealthAccreditationNo}
                        onChange={(e) => {
                          touched.current.add("philhealthAccreditationNo");
                          setPhilhealthAccreditationNo(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Cashier Particulars */}
                <div className="card mb-3 border-0 shadow-sm">
                  <div className="card-header bg-white py-1 px-2 fw-bold text-dark small">
                    Cashier Details
                  </div>
                  <div className="card-body p-2">
                    <div className="mb-1">
                      <label className="form-label small mb-0 fw-semibold">Issuing Cashier</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={cashierName}
                        onChange={(e) => {
                          touched.current.add("cashierName");
                          setCashierName(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="text-muted small text-center" style={{ fontSize: "0.72rem" }}>
                  Changes reactively refresh the PDF preview.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Audited Reprint Dialog */}
      {showReprintModal && (
        <div
          className="modal show d-block"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1060 }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-warning text-dark py-2 px-3">
                <h5 className="modal-title fs-6 fw-bold mb-0">Audited Receipt Reprint</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowReprintModal(false)}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body p-3">
                <p className="small text-muted mb-2">
                  Under BIR regulations and internal financial controls, every reprint increments the audit counter and logs the operator, timestamp, and business justification.
                </p>
                {reprintAlert && (
                  <div className={`alert alert-${reprintAlert.tone} small py-1 mb-2`}>
                    {reprintAlert.message}
                  </div>
                )}
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Reason for Reprint *</label>
                  <textarea
                    rows={3}
                    className="form-control form-control-sm"
                    placeholder="e.g., Customer requested duplicate copy for insurance reimbursement / tax filing"
                    value={reprintReason}
                    onChange={(e) => setReprintReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer py-2 px-3">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowReprintModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-warning fw-bold"
                  disabled={!reprintReason.trim() || reprintLoading}
                  onClick={handleExecuteReprint}
                >
                  {reprintLoading ? "Logging…" : "Confirm & Log Reprint"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
