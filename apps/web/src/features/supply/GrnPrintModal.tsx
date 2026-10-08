import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, apiPostBlob, ApiError } from "../../shared/api/client.js";

export interface GrnPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  grnId?: string | null;
  draftGrn?: {
    grnNo?: string;
    supplierName?: string;
    locationName?: string;
    deliveryNoteNo?: string;
    poNo?: string;
    receivedBy?: string;
    lines: Array<{
      itemCode?: string;
      itemName: string;
      lotNo: string;
      expiryDate: string;
      qtyReceived: number;
      uomCode?: string;
      unitCost?: number;
      inspectionResult?: string;
      overrideReason?: string;
    }>;
    notes?: string;
  } | null;
}

export function GrnPrintModal({
  isOpen,
  onClose,
  grnId,
  draftGrn,
}: GrnPrintModalProps) {
  const [showConfig, setShowConfig] = useState(false);

  // Letterhead and signoff fields
  const [clinicName, setClinicName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicEmail, setClinicEmail] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [verifiedBy, setVerifiedBy] = useState("");
  const [notes, setNotes] = useState("");

  const touched = useRef<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch clinic profile on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const url = grnId
          ? `/supply/goods-receipts/${grnId}/print-profile`
          : "/supply/consumption/print-profile";
        const data = await apiGet<any>(url);
        if (cancelled) return;

        if (data?.clinic) {
          if (!touched.current.has("clinicName") && data.clinic.name) setClinicName(data.clinic.name);
          if (!touched.current.has("branchName") && data.clinic.branchName) setBranchName(data.clinic.branchName);
          if (!touched.current.has("clinicAddress") && data.clinic.address) setClinicAddress(data.clinic.address);
          if (!touched.current.has("clinicPhone") && data.clinic.phone) setClinicPhone(data.clinic.phone);
          if (!touched.current.has("clinicEmail") && data.clinic.email) setClinicEmail(data.clinic.email);
        }

        if (data?.officer?.name && !touched.current.has("receivedBy")) {
          setReceivedBy(data.officer.name);
        }

        if (data?.grn) {
          if (data.grn.received_by_name && !touched.current.has("receivedBy")) {
            setReceivedBy(data.grn.received_by_name);
          }
          if (data.grn.notes && !touched.current.has("notes")) {
            setNotes(data.grn.notes);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(
            err instanceof ApiError
              ? `${err.problem.title}: ${err.problem.detail ?? ""}`.trim()
              : "Could not load clinic letterhead profile.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      touched.current = new Set();
    };
  }, [isOpen, grnId]);

  // Fetch rendered true PDF preview
  const fetchPdfPreview = async () => {
    if (!isOpen || (!grnId && !draftGrn)) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const params = new URLSearchParams();
      if (touched.current.has("clinicName") && clinicName.trim()) params.set("clinicName", clinicName.trim());
      if (touched.current.has("branchName") && branchName.trim()) params.set("branchName", branchName.trim());
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) params.set("clinicAddress", clinicAddress.trim());
      if (touched.current.has("clinicPhone") && clinicPhone.trim()) params.set("clinicPhone", clinicPhone.trim());
      if (touched.current.has("clinicEmail") && clinicEmail.trim()) params.set("clinicEmail", clinicEmail.trim());
      if (touched.current.has("receivedBy") && receivedBy.trim()) params.set("receivedBy", receivedBy.trim());
      if (touched.current.has("verifiedBy") && verifiedBy.trim()) params.set("verifiedBy", verifiedBy.trim());
      if (touched.current.has("notes") && notes.trim()) params.set("notes", notes.trim());

      let blob: Blob;
      if (grnId) {
        const url = `/supply/goods-receipts/${grnId}/pdf${params.toString() ? `?${params.toString()}` : ""}`;
        blob = await apiGetBlob(url);
      } else {
        const url = `/supply/goods-receipts/preview-pdf${params.toString() ? `?${params.toString()}` : ""}`;
        blob = await apiPostBlob(url, draftGrn);
      }

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
      console.error("Failed to load Goods Receipt Note PDF preview:", err);
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
    grnId,
    draftGrn,
    clinicName,
    branchName,
    clinicAddress,
    clinicPhone,
    clinicEmail,
    receivedBy,
    verifiedBy,
    notes,
  ]);

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    const docNo = draftGrn?.grnNo || (grnId ? grnId.slice(0, 8) : "Draft");
    a.download = `GoodsReceiptNote-${docNo}.pdf`;
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

  if (!isOpen || (!grnId && !draftGrn)) return null;

  const displayNo = draftGrn?.grnNo || (grnId ? `GRN-${grnId.slice(0, 8)}` : "GRN Draft");

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
              <span style={{ fontSize: "1.25rem" }}>📋</span>
              <div>
                <h5 className="modal-title mb-0 fs-6 fw-bold">Official Goods Receipt Note (GRN) Print Center</h5>
                <span className="small text-white-50">
                  Document: {displayNo} &middot; Supplier: {draftGrn?.supplierName || "Supplier Delivery"} &middot; Store:{" "}
                  {draftGrn?.locationName || "Central Supply Store"}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`btn btn-sm ${showConfig ? "btn-info" : "btn-outline-light"}`}
                onClick={() => setShowConfig(!showConfig)}
                title="Configure Letterhead and Signatories"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Letterhead / Signoffs"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={handleDownloadPdf}
                disabled={!pdfBlobUrl}
                title="Download raw server-rendered PDF bytes"
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
                🖨️ Print GRN
              </button>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
                aria-label="Close"
              />
            </div>
          </div>

          {/* Subheader banner */}
          <div className="bg-light border-bottom px-3 py-1 d-flex justify-content-between align-items-center small">
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-success">✓ Official Receiving Document</span>
              <span className="fw-semibold text-secondary">Document Number:</span>
              <span className="font-monospace text-muted">{displayNo}</span>
            </div>
            <div className="text-muted small">
              Date: {new Date().toLocaleDateString()}
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
                    Rendering true tamper-evident Goods Receipt Note PDF…
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
                  title="Official Goods Receipt Note Preview"
                  className="w-100 h-100 border-0 flex-grow-1"
                />
              ) : (
                <div className="p-4 text-center my-auto text-muted">Preparing Goods Receipt Note document…</div>
              )}
            </div>

            {/* Config & Letterhead Drawer */}
            {showConfig && (
              <div
                className="bg-white border-start p-3 overflow-y-auto"
                style={{ width: "340px", minWidth: "340px", fontSize: "0.85rem" }}
              >
                <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                  <h6 className="fw-bold mb-0">Letterhead &amp; Signatories</h6>
                  <button
                    type="button"
                    className="btn-close btn-sm"
                    onClick={() => setShowConfig(false)}
                    aria-label="Close settings"
                  />
                </div>

                {profileError && (
                  <div className="alert alert-warning py-1 px-2 small mb-3">
                    {profileError}
                  </div>
                )}

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Clinic / Facility Name</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicName}
                    placeholder="e.g. Central Clinic"
                    onChange={(e) => {
                      touched.current.add("clinicName");
                      setClinicName(e.target.value);
                    }}
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Receiving Warehouse / Branch</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={branchName}
                    placeholder="e.g. Central Supply Store"
                    onChange={(e) => {
                      touched.current.add("branchName");
                      setBranchName(e.target.value);
                    }}
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Facility Address</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicAddress}
                    placeholder="Facility Address"
                    onChange={(e) => {
                      touched.current.add("clinicAddress");
                      setClinicAddress(e.target.value);
                    }}
                  />
                </div>

                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label fw-bold mb-1">Telephone</label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={clinicPhone}
                      placeholder="(02) 8000-0000"
                      onChange={(e) => {
                        touched.current.add("clinicPhone");
                        setClinicPhone(e.target.value);
                      }}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-bold mb-1">Email</label>
                    <input
                      type="email"
                      className="form-control form-control-sm"
                      value={clinicEmail}
                      placeholder="supply@clinic.ph"
                      onChange={(e) => {
                        touched.current.add("clinicEmail");
                        setClinicEmail(e.target.value);
                      }}
                    />
                  </div>
                </div>

                <hr className="my-2" />

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Received By (Officer)</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={receivedBy}
                    placeholder="Warehouse Receiving Officer"
                    onChange={(e) => {
                      touched.current.add("receivedBy");
                      setReceivedBy(e.target.value);
                    }}
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Inspected &amp; Verified By</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={verifiedBy}
                    placeholder="Pharmacist / Store Supervisor"
                    onChange={(e) => {
                      touched.current.add("verifiedBy");
                      setVerifiedBy(e.target.value);
                    }}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label fw-bold mb-1">Remarks / Inspection Notes</label>
                  <textarea
                    rows={2}
                    className="form-control form-control-sm"
                    value={notes}
                    placeholder="Optional remarks or quality notes..."
                    onChange={(e) => {
                      touched.current.add("notes");
                      setNotes(e.target.value);
                    }}
                  />
                </div>

                <div className="d-grid mt-3">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => void fetchPdfPreview()}
                  >
                    🔄 Update Preview
                  </button>
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
