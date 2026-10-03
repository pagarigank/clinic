import React, { useState, useEffect } from "react";

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
}: PrescriptionPrintModalProps) {
  const [activeTab, setActiveTab] = useState<"RX" | "LAB" | "ALL">(defaultTab);
  const [showConfig, setShowConfig] = useState(false);

  // Editable Doctor & Clinic Header fields (pre-populated with realistic standards)
  const [doctorName, setDoctorName] = useState(
    practitionerName || "Dr. Maria Elena Reyes, MD, FPCP"
  );
  const [doctorSpecialty, setDoctorSpecialty] = useState(
    "Internal Medicine / Adult & Family Health"
  );
  const [prcNo, setPrcNo] = useState("0108942");
  const [ptrNo, setPtrNo] = useState("PTR-8492019 / Manila");
  const [s2No, setS2No] = useState("S2-2026-9812A");
  const [clinicTitle, setClinicTitle] = useState(
    visit.clinicName || "METRO HEALTH CLINIC & DIAGNOSTIC CENTER"
  );
  const [clinicSubtitle, setClinicSubtitle] = useState(
    "Primary Care, Multi-Specialty & Laboratory Services"
  );
  const [clinicAddress, setClinicAddress] = useState(
    "Unit 402 Medical Arts Bldg., Ermita, Manila, Philippines"
  );
  const [clinicContact, setClinicContact] = useState(
    "Tel: (02) 8524-1000 · Mobile: 0917-555-4321 · info@metrohealth.ph"
  );
  const [rxNotesAdvice, setRxNotesAdvice] = useState(
    "Take medications strictly as instructed. Drink plenty of water and complete the full prescribed antibiotic course."
  );

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    if (practitionerName) {
      setDoctorName(practitionerName.startsWith("Dr.") ? practitionerName : `Dr. ${practitionerName}, MD`);
    }
  }, [practitionerName]);

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

  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const getPdfEndpoint = () => {
    const params = new URLSearchParams({
      doctorName,
      doctorTitle: doctorSpecialty,
      prcNumber: prcNo,
      ptrNumber: ptrNo,
      s2Number: s2No,
      clinicName: clinicTitle,
      clinicAddress,
      clinicPhone: clinicContact,
      advice: rxNotesAdvice,
    });
    if (activeTab === "RX") return `/api/v1/clinical/visits/${visit.id}/prescription-pdf?${params.toString()}`;
    if (activeTab === "LAB") return `/api/v1/clinical/visits/${visit.id}/lab-request-pdf?${params.toString()}`;
    return `/api/v1/clinical/visits/${visit.id}/orders-pdf?${params.toString()}`;
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const url = getPdfEndpoint();
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const prefix = activeTab === "RX" ? "Prescription-Rx" : activeTab === "LAB" ? "Lab-Requisition" : "Clinical-Orders";
      a.download = `${prefix}-${visit.visitNo || visit.id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("Direct PDF download fallback to window.print():", err);
      window.print();
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleOpenPdf = () => {
    window.open(getPdfEndpoint(), "_blank");
  };

  const handlePrint = () => {
    window.print();
  };

  return (
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
                disabled={isDownloadingPdf}
                title="Download true vector PDF rendered via server print pipeline"
              >
                {isDownloadingPdf ? (
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
              <div className="row g-2 small">
                <div className="col-md-3">
                  <label className="form-label mb-0 fw-semibold">Doctor Name &amp; Title</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-0 fw-semibold">Specialization</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={doctorSpecialty}
                    onChange={(e) => setDoctorSpecialty(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold">PRC License No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={prcNo}
                    onChange={(e) => setPrcNo(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold">PTR No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={ptrNo}
                    onChange={(e) => setPtrNo(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label mb-0 fw-semibold">S2 License No.</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={s2No}
                    onChange={(e) => setS2No(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold">Clinic Name</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicTitle}
                    onChange={(e) => setClinicTitle(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold">Clinic Address</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicAddress}
                    onChange={(e) => setClinicAddress(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-0 fw-semibold">Contact Details</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={clinicContact}
                    onChange={(e) => setClinicContact(e.target.value)}
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

          {/* Document Preview & Printable Area */}
          <div className="modal-body p-4 bg-secondary bg-opacity-10 d-flex justify-content-center">
            {/* The printable document container */}
            <div
              className="clinic-printable-surface shadow-sm bg-white p-4 p-md-5"
              style={{
                width: "100%",
                maxWidth: "820px",
                minHeight: "1000px",
                color: "#111827",
                fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
                position: "relative",
              }}
            >
              {/* Header Letterhead */}
              <div className="border-bottom pb-3 mb-3" style={{ borderColor: "#0284c7", borderWidth: "2px" }}>
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-3">
                    <div
                      style={{
                        width: "50px",
                        height: "50px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, #0f2942 0%, #0284c7 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v20M2 12h20" />
                        <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
                      </svg>
                    </div>
                    <div>
                      <div
                        className="fw-bold tracking-wide"
                        style={{ fontSize: "1.3rem", letterSpacing: "0.3px", color: "#0f2942", lineHeight: "1.2" }}
                      >
                        {clinicTitle}
                      </div>
                      <div className="small fw-semibold text-primary text-uppercase" style={{ letterSpacing: "0.5px" }}>
                        {clinicSubtitle}
                      </div>
                      <div className="small text-secondary" style={{ fontSize: "0.82rem" }}>
                        {clinicAddress} · {clinicContact}
                      </div>
                    </div>
                  </div>
                  <div className="text-md-end d-none d-sm-block">
                    <span className="badge bg-dark text-white px-3 py-1 text-uppercase fw-bold" style={{ letterSpacing: "0.5px" }}>
                      {activeTab === "RX" ? "Medical Prescription (Rx)" : activeTab === "LAB" ? "Laboratory Requisition" : "Clinical Orders Summary"}
                    </span>
                    <div className="clinic-mono fw-bold text-dark mt-1 small">
                      {activeTab === "RX" ? (prescriptions[0]?.rxNo || `RX-${visit.visitNo}`) : activeTab === "LAB" ? (labOrders[0]?.orderNo || `LAB-${visit.visitNo}`) : `VISIT-${visit.visitNo}`}
                    </div>
                  </div>
                </div>
              </div>


              {/* Physician Details Banner */}
              <div className="d-flex justify-content-between align-items-start border-bottom pb-2 mb-3 flex-wrap">
                <div>
                  <h4 className="fw-bold mb-0 text-dark" style={{ fontSize: "1.15rem" }}>
                    {doctorName}
                  </h4>
                  <div className="text-muted small">{doctorSpecialty}</div>
                </div>
                <div className="text-end small clinic-mono" style={{ fontSize: "0.8rem", lineHeight: "1.4" }}>
                  <div>
                    <strong>PRC Lic. No:</strong> {prcNo}
                  </div>
                  <div>
                    <strong>PTR No:</strong> {ptrNo}
                  </div>
                  {s2No && (
                    <div className="text-danger fw-semibold">
                      <strong>S2 Lic. No:</strong> {s2No}
                    </div>
                  )}
                </div>
              </div>

              {/* Patient Demographics Box */}
              <div
                className="p-2 mb-3 rounded"
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  fontSize: "0.85rem",
                }}
              >
                <div className="row g-1">
                  <div className="col-7 col-md-5">
                    <span className="text-muted">Patient Name: </span>
                    <strong className="text-dark">{visit.patientName}</strong>
                  </div>
                  <div className="col-5 col-md-3">
                    <span className="text-muted">Age / Sex: </span>
                    <strong>
                      {patientAge !== null ? `${patientAge} yrs` : "Adult"} / {visit.sex === "F" ? "Female" : visit.sex === "M" ? "Male" : visit.sex || "—"}
                    </strong>
                  </div>
                  <div className="col-6 col-md-4 text-md-end">
                    <span className="text-muted">Date: </span>
                    <strong>{new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}</strong>
                  </div>

                  <div className="col-7 col-md-5">
                    <span className="text-muted">Encounter / Visit: </span>
                    <span className="clinic-mono fw-semibold">{visit.visitNo}</span>
                  </div>
                  <div className="col-5 col-md-3">
                    <span className="text-muted">DOB: </span>
                    <span>{visit.dateOfBirth ? visit.dateOfBirth.split("T")[0] : "—"}</span>
                  </div>
                  <div className="col-6 col-md-4 text-md-end">
                    {latestVitals && (
                      <span className="clinic-mono text-muted" style={{ fontSize: "0.8rem" }}>
                        BP: {latestVitals.bpSys && latestVitals.bpDia ? `${latestVitals.bpSys}/${latestVitals.bpDia} mmHg` : "—"}
                        {latestVitals.temperatureC ? ` · T: ${latestVitals.temperatureC}°C` : ""}
                      </span>
                    )}
                  </div>

                  {/* Allergy Banner / Warning */}
                  <div className="col-12 mt-1 pt-1 border-top">
                    <span className="text-muted">Allergies: </span>
                    {allergies.length > 0 ? (
                      <span className="badge bg-danger-subtle text-danger border border-danger-subtle fw-semibold px-2">
                        ⚠️ ALLERGIC TO: {allergies.map((a) => `${a.substance}${a.severity ? ` (${a.severity})` : ""}`).join(", ")}
                      </span>
                    ) : (
                      <span className="text-success fw-medium">No Known Drug Allergies (NKDA)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 1: PRESCRIPTION SLIP (Rx)                                 */}
              {/* ───────────────────────────────────────────────────────────── */}
              {(activeTab === "RX" || activeTab === "ALL") && (
                <div className="mb-4">
                  {/* Section Title & Rx Insignia */}
                  <div className="d-flex align-items-baseline gap-2 mb-2">
                    <span
                      style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        fontSize: "2.4rem",
                        fontWeight: "bold",
                        lineHeight: "1",
                        color: "#0f172a",
                      }}
                    >
                      ℞
                    </span>
                    <span
                      className="fw-bold text-uppercase tracking-wider small text-muted"
                      style={{ letterSpacing: "1px" }}
                    >
                      Medical Prescription / Reseta
                    </span>
                  </div>

                  {/* Prescribed Items List */}
                  {prescriptions.length === 0 ? (
                    <div className="p-3 text-center text-muted border border-dashed rounded my-3">
                      No prescriptions recorded for this encounter yet. Add medications in the visit chart prescribe section.
                    </div>
                  ) : (
                    <div className="ps-3 ps-md-4">
                      {prescriptions.map((rx, rxIndex) => (
                        <div key={rx.id || rxIndex} className="mb-4">
                          {rx.isControlled && (
                            <div className="alert alert-warning py-1 px-2 mb-2 small d-flex justify-content-between align-items-center">
                              <span>
                                <strong>⚠️ DOH/PDEA S2 CONTROLLED SUBSTANCE PRESCRIPTION</strong> — "NO REFILL" ENFORCED
                              </span>
                              {rx.specialRxNo && (
                                <span className="clinic-mono fw-bold">Serial No: {rx.specialRxNo}</span>
                              )}
                            </div>
                          )}

                          {rx.items && rx.items.length > 0 ? (
                            rx.items.map((item, itemIdx) => {
                              const genName = item.generic_name || item.genericName || "Medication";
                              const brandName = item.brand_name || item.brandName;
                              const dose = item.sig_dose || item.sigDose;
                              const freq = item.sig_frequency || item.sigFrequency;
                              const dur = item.sig_duration || item.sigDuration;
                              const qty = item.qty_prescribed ?? item.qtyPrescribed;
                              const strength = item.strength;
                              const form = item.form;

                              return (
                                <div key={item.id || itemIdx} className="mb-3 pb-2 border-bottom">
                                  <div className="d-flex justify-content-between align-items-baseline flex-wrap">
                                    <div className="d-flex align-items-baseline gap-2">
                                      <span className="fw-bold text-dark fs-6">
                                        {rxIndex + 1}.{itemIdx + 1} {genName.toUpperCase()}
                                      </span>
                                      {strength && <span className="fw-semibold text-secondary">{strength}</span>}
                                      {form && <span className="text-muted small">({form})</span>}
                                      {brandName && <span className="text-muted small fst-italic">[{brandName}]</span>}
                                    </div>
                                    <div className="clinic-mono fw-bold text-primary">
                                      Dispense: # {qty || "—"}{" "}
                                      {rx.qtyWords ? `(${rx.qtyWords})` : form ? `${form}s` : "units"}
                                    </div>
                                  </div>

                                  {/* Sig / Directions */}
                                  <div className="mt-1 ps-3" style={{ fontSize: "0.92rem" }}>
                                    <span className="fw-semibold text-dark">Sig. </span>
                                    <span>
                                      {dose ? `${dose}` : ""} {freq ? `, ${freq}` : ""} {dur ? ` for ${dur}` : ""}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-muted small fst-italic">Prescription #{rx.rxNo} issued (details recorded).</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Doctor's Prescription Advice */}
                  {rxNotesAdvice && (
                    <div
                      className="p-2 rounded mt-2 mb-3"
                      style={{
                        backgroundColor: "#f1f5f9",
                        borderLeft: "4px solid #0284c7",
                        fontSize: "0.82rem",
                      }}
                    >
                      <strong>Doctor's Advice / Reminders: </strong>
                      <span>{rxNotesAdvice}</span>
                    </div>
                  )}

                  {/* Philippine Generics Act Notice */}
                  <div
                    className="text-muted text-center pt-2 border-top"
                    style={{ fontSize: "0.72rem" }}
                  >
                    In compliance with Republic Act No. 6675 (Generics Act of 1988) and DOH Administrative Order No. 62.
                    Generic substitution is permitted unless marked "Dispense As Written" (DAW).
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 2: LABORATORY EXAMINATION REQUEST SLIP                     */}
              {/* ───────────────────────────────────────────────────────────── */}
              {(activeTab === "LAB" || activeTab === "ALL") && (
                <div className="mb-4 pt-2">
                  {activeTab === "ALL" && <hr className="my-4" style={{ borderTop: "2px dashed #94a3b8" }} />}

                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <span style={{ fontSize: "1.4rem" }}>🔬</span>
                      <h5 className="fw-bold text-uppercase mb-0 tracking-wide text-dark" style={{ fontSize: "1.05rem" }}>
                        Laboratory &amp; Diagnostic Requisition Slip
                      </h5>
                    </div>
                    <span className="badge bg-secondary-subtle text-secondary border">
                      DOH CLINICAL LAB LTO # 13-0948-26-CL
                    </span>
                  </div>

                  {/* Clinical Impression & Priority */}
                  <div
                    className="p-2 mb-3 rounded"
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div className="row g-2">
                      <div className="col-md-7">
                        <span className="text-muted">Clinical Impression / Diagnoses: </span>
                        {diagnoses.length > 0 ? (
                          <div className="d-inline-flex flex-wrap gap-1 align-items-center">
                            {diagnoses.map((d, i) => (
                              <span key={i} className="badge bg-primary-subtle text-primary border border-primary-subtle">
                                {d.icd10Code} ({d.dxType || "PRIMARY"})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <strong>Routine Check / Triage Evaluation</strong>
                        )}
                      </div>
                      <div className="col-md-5 text-md-end">
                        <span className="text-muted">Requisition Priority: </span>
                        {labOrders.some((o) => o.priority === "STAT") ? (
                          <span className="badge bg-danger text-white fw-bold">⚡ STAT / EMERGENCY</span>
                        ) : labOrders.some((o) => o.priority === "URGENT") ? (
                          <span className="badge bg-warning text-dark fw-bold">URGENT</span>
                        ) : (
                          <span className="badge bg-light text-dark border">ROUTINE</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Laboratory Orders Table */}
                  {labOrders.length === 0 ? (
                    <div className="p-3 text-center text-muted border border-dashed rounded my-3">
                      No laboratory tests requested for this encounter yet. Add lab orders in the visit chart laboratory section.
                    </div>
                  ) : (
                    <div className="table-responsive mb-3">
                      <table className="table table-sm table-bordered mb-0" style={{ fontSize: "0.84rem" }}>
                        <thead className="table-light">
                          <tr>
                            <th style={{ width: "5%" }}>#</th>
                            <th style={{ width: "35%" }}>Requested Test / Panel</th>
                            <th style={{ width: "15%" }}>Code</th>
                            <th style={{ width: "25%" }}>Specimen Required</th>
                            <th style={{ width: "20%" }}>Preparation / Fasting</th>
                          </tr>
                        </thead>
                        <tbody>
                          {labOrders.flatMap((order, orderIdx) =>
                            (order.items && order.items.length > 0 ? order.items : [{ test_name: "Laboratory Examination", test_code: "LAB" }]).map(
                              (item: any, itemIdx: number) => {
                                const testName = item.test_name || item.testName || "Laboratory Test";
                                const testCode = item.test_code || item.testCode || "LAB";
                                const specimen = item.specimen_type || item.specimenType || "Whole Blood / Serum";
                                const isFasting = item.fasting_required || item.fastingRequired;
                                const fastingHours = item.fasting_hours || item.fastingHours || 10;
                                const prep = isFasting
                                  ? `Fasting ${fastingHours} hrs (Water only)`
                                  : item.instructions || "Standard collection";

                                return (
                                  <tr key={`${order.id}-${item.id || itemIdx}`}>
                                    <td className="text-center">{orderIdx + 1}.{itemIdx + 1}</td>
                                    <td>
                                      <strong>{testName}</strong>
                                      {order.clinicalInfo && (
                                        <div className="small text-muted fst-italic">Note: {order.clinicalInfo}</div>
                                      )}
                                    </td>
                                    <td className="clinic-mono">{testCode}</td>
                                    <td>{specimen}</td>
                                    <td>
                                      {isFasting ? (
                                        <span className="badge bg-warning-subtle text-dark border border-warning-subtle">
                                          ⚠️ {prep}
                                        </span>
                                      ) : (
                                        <span className="text-muted">{prep}</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Specimen Collection Checklist Box (For Phlebotomist / Lab Staff) */}
                  <div
                    className="p-2 border rounded mb-2 bg-light text-muted small"
                    style={{ fontSize: "0.75rem", lineHeight: "1.5" }}
                  >
                    <div className="row g-2">
                      <div className="col-4">
                        [ &nbsp; ] Specimen Collected: ____ / ____ / 2026 __:__
                      </div>
                      <div className="col-4">
                        [ &nbsp; ] Phlebotomist: ______________________
                      </div>
                      <div className="col-4">
                        [ &nbsp; ] Accession Barcode: _________________
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* TAB 3 EXTRA: CLINICAL PLAN & HOME CARE (Shown in ALL mode)     */}
              {/* ───────────────────────────────────────────────────────────── */}
              {activeTab === "ALL" && latestNote && latestNote.plan && (
                <div className="mb-4 pt-2">
                  <hr className="my-3" style={{ borderTop: "2px dashed #94a3b8" }} />
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span style={{ fontSize: "1.2rem" }}>📝</span>
                    <h6 className="fw-bold text-uppercase mb-0 tracking-wide text-dark" style={{ fontSize: "0.95rem" }}>
                      Physician's Clinical Management &amp; Follow-Up Plan
                    </h6>
                  </div>
                  <div
                    className="p-3 rounded mb-2"
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.86rem",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {latestNote.plan}
                  </div>
                </div>
              )}

              {/* Physician Signature Block */}
              <div className="row mt-4 pt-3 border-top align-items-end">
                <div className="col-6 col-md-7">
                  <div className="small text-muted" style={{ fontSize: "0.74rem", lineHeight: "1.4" }}>
                    <div>
                      <strong>Document Reference:</strong> {visit.visitNo} · Generated: {new Date().toLocaleString("en-PH")}
                    </div>
                    <div>
                      Valid for 30 days from date of issuance. Not valid if altered or erased.
                    </div>
                    <div>
                      Verify official electronic record at: <span className="clinic-mono text-primary">/clinical/visits/{visit.id}</span>
                    </div>
                  </div>
                </div>
                <div className="col-6 col-md-5 text-end">
                  <div
                    className="d-inline-block text-center"
                    style={{ minWidth: "220px" }}
                  >
                    <div
                      className="border-bottom pb-1 mb-1 fw-bold text-dark"
                      style={{ fontSize: "0.95rem", minHeight: "40px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
                    >
                      {doctorName}
                    </div>
                    <div className="text-muted" style={{ fontSize: "0.78rem" }}>
                      Attending Physician
                    </div>
                    <div className="clinic-mono fw-medium" style={{ fontSize: "0.75rem" }}>
                      PRC: {prcNo} · PTR: {ptrNo}
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
                disabled={isDownloadingPdf}
              >
                {isDownloadingPdf ? (
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
}
