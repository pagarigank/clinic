import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiGetBlob, ApiError } from "../../shared/api/client.js";

export interface ConsumptionPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultLocationId?: string;
  defaultLocationName?: string;
  defaultFrom?: string;
  defaultTo?: string;
}

export function ConsumptionPrintModal({
  isOpen,
  onClose,
  defaultLocationId,
  defaultLocationName,
  defaultFrom,
  defaultTo,
}: ConsumptionPrintModalProps) {
  const [showConfig, setShowConfig] = useState(false);

  // Filters
  const toDefault = new Date().toISOString().slice(0, 10);
  const fromDefault = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(defaultFrom || fromDefault);
  const [toDate, setToDate] = useState(defaultTo || toDefault);
  const [locationId, setLocationId] = useState(defaultLocationId || "");
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);

  // Letterhead fields
  const [clinicName, setClinicName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicEmail, setClinicEmail] = useState("");
  const [generatedBy, setGeneratedBy] = useState("");
  const [notes, setNotes] = useState("");

  const touched = useRef<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load clinic print profile and stock locations on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiGet<any>("/supply/consumption/print-profile");
        if (cancelled) return;

        if (data?.clinic) {
          if (!touched.current.has("clinicName") && data.clinic.name) setClinicName(data.clinic.name);
          if (!touched.current.has("branchName") && data.clinic.branchName) setBranchName(data.clinic.branchName);
          if (!touched.current.has("clinicAddress") && data.clinic.address) setClinicAddress(data.clinic.address);
          if (!touched.current.has("clinicPhone") && data.clinic.phone) setClinicPhone(data.clinic.phone);
          if (!touched.current.has("clinicEmail") && data.clinic.email) setClinicEmail(data.clinic.email);
        }

        if (data?.officer?.name && !touched.current.has("generatedBy")) {
          setGeneratedBy(data.officer.name);
        }

        if (Array.isArray(data?.locations) && data.locations.length > 0) {
          setLocations(data.locations);
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
  }, [isOpen]);

  // Fetch rendered true PDF preview
  const fetchPdfPreview = async () => {
    if (!isOpen) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (locationId) params.set("locationId", locationId);

      if (touched.current.has("clinicName") && clinicName.trim()) params.set("clinicName", clinicName.trim());
      if (touched.current.has("branchName") && branchName.trim()) params.set("branchName", branchName.trim());
      if (touched.current.has("clinicAddress") && clinicAddress.trim()) params.set("clinicAddress", clinicAddress.trim());
      if (touched.current.has("clinicPhone") && clinicPhone.trim()) params.set("clinicPhone", clinicPhone.trim());
      if (touched.current.has("clinicEmail") && clinicEmail.trim()) params.set("clinicEmail", clinicEmail.trim());
      if (touched.current.has("generatedBy") && generatedBy.trim()) params.set("generatedBy", generatedBy.trim());
      if (touched.current.has("notes") && notes.trim()) params.set("notes", notes.trim());

      const url = `/supply/consumption/pdf?${params.toString()}`;
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
      console.error("Failed to load consumption PDF preview:", err);
      setPdfError(msg);
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    void fetchPdfPreview();
  }, [
    isOpen,
    fromDate,
    toDate,
    locationId,
    clinicName,
    branchName,
    clinicAddress,
    clinicPhone,
    clinicEmail,
    generatedBy,
    notes,
  ]);

  const handleDownloadPdf = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = `Supply-Consumption-${fromDate || "all"}_${toDate || "all"}.pdf`;
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
              <span style={{ fontSize: "1.25rem" }}>📦</span>
              <div>
                <h5 className="modal-title mb-0 fs-6 fw-bold">Central Supply Consumption &amp; Issuance Print Center</h5>
                <span className="small text-white-50">
                  Period: {fromDate || "Start"} to {toDate || "Present"} &middot; Location:{" "}
                  {locations.find((l) => l.id === locationId)?.name || defaultLocationName || "All Locations"}
                </span>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                className={`btn btn-sm ${showConfig ? "btn-info" : "btn-outline-light"}`}
                onClick={() => setShowConfig(!showConfig)}
                title="Configure Letterhead and Filters"
              >
                ⚙️ {showConfig ? "Hide Settings" : "Filters / Letterhead"}
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
                🖨️ Print Document
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
              <span className="badge bg-primary">✓ Official Register</span>
              <span className="fw-semibold text-secondary">Document Type:</span>
              <span className="text-muted">Stock Consumption &amp; Issuance Register (FEFO / Procedure / Ward Use)</span>
            </div>
            <div className="text-muted small">
              Generated: {new Date().toLocaleDateString()}
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
                    Rendering true tamper-evident Consumption List PDF…
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
                  title="Official Consumption List Preview"
                  className="w-100 h-100 border-0 flex-grow-1"
                />
              ) : (
                <div className="p-4 text-center my-auto text-muted">Preparing PDF document…</div>
              )}
            </div>

            {/* Config & Filter Drawer */}
            {showConfig && (
              <div
                className="bg-white border-start p-3 overflow-y-auto"
                style={{ width: "340px", minWidth: "340px", fontSize: "0.85rem" }}
              >
                <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                  <h6 className="fw-bold mb-0">Period &amp; Letterhead</h6>
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

                <div className="mb-3">
                  <label className="form-label fw-bold mb-1">Stock Location</label>
                  <select
                    className="form-select form-select-sm"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    <option value="">All Locations</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <label className="form-label fw-bold mb-1">From Date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-bold mb-1">To Date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </div>
                </div>

                <hr className="my-2" />

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
                  <label className="form-label fw-bold mb-1">Warehouse / Branch</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={branchName}
                    placeholder="e.g. Central Supply & Store"
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

                <div className="mb-2">
                  <label className="form-label fw-bold mb-1">Prepared By (Officer)</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={generatedBy}
                    placeholder="Supply Officer Name"
                    onChange={(e) => {
                      touched.current.add("generatedBy");
                      setGeneratedBy(e.target.value);
                    }}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label fw-bold mb-1">Remarks / Notes</label>
                  <textarea
                    rows={2}
                    className="form-control form-control-sm"
                    value={notes}
                    placeholder="Optional remarks or purpose..."
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
