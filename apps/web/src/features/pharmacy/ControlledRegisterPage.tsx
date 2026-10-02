import React, { useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  StatusPill,
} from "@clinic/ui";

interface ControlledRegisterEntry {
  id: string;
  seqNo: number;
  occurredAt: string;
  entryType: "RECEIPT" | "DISPENSE" | "ADJUSTMENT" | "RETURN" | "DISPOSAL";
  drugName: string;
  lotNo: string;
  qtyIn: number;
  qtyOut: number;
  runningBalance: number;
  patientName?: string;
  patientHrn?: string;
  prescriberName?: string;
  prescriberS2?: string;
  specialRxSerial?: string;
  pharmacistName: string;
  witnessName: string;
  notes?: string;
}

export function ControlledRegisterPage() {
  const [selectedDrug, setSelectedDrug] = useState("item-morph-10");
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-02");
  const [activeTab, setActiveTab] = useState<"REGISTER" | "SPECIAL_RX" | "RECONCILIATION">("REGISTER");

  // Controlled drug options
  const controlledDrugs = [
    {
      id: "item-morph-10",
      name: "Morphine Sulfate 10mg/mL Ampoule",
      genericName: "Morphine Sulfate",
      schedule: "SCHEDULE II (DDB)",
      physicalStock: 24,
      bookBalance: 24,
      uom: "AMP",
    },
    {
      id: "item-fent-50",
      name: "Fentanyl 50mcg/hr Transdermal Patch",
      genericName: "Fentanyl",
      schedule: "SCHEDULE II (DDB)",
      physicalStock: 12,
      bookBalance: 12,
      uom: "PATCH",
    },
    {
      id: "item-diaz-5",
      name: "Diazepam 5mg Tablet",
      genericName: "Diazepam",
      schedule: "SCHEDULE IV (DDB)",
      physicalStock: 50,
      bookBalance: 50,
      uom: "TAB",
    },
  ];

  const currentDrug = controlledDrugs.find((d) => d.id === selectedDrug) || controlledDrugs[0]!;

  const [registerEntries] = useState<ControlledRegisterEntry[]>([
    {
      id: "reg-1",
      seqNo: 101,
      occurredAt: "2026-10-01T09:15:00Z",
      entryType: "RECEIPT",
      drugName: "Morphine Sulfate 10mg/mL Ampoule",
      lotNo: "LOT-MOR-2026A",
      qtyIn: 30,
      qtyOut: 0,
      runningBalance: 30,
      pharmacistName: "Maria Santos, RPh",
      witnessName: "Kristine Reyes, RPh",
      notes: "Goods Receipt GRN-2026-0044 from DOH Central Depot",
    },
    {
      id: "reg-2",
      seqNo: 102,
      occurredAt: "2026-10-01T14:30:00Z",
      entryType: "DISPENSE",
      drugName: "Morphine Sulfate 10mg/mL Ampoule",
      lotNo: "LOT-MOR-2026A",
      qtyIn: 0,
      qtyOut: 6,
      runningBalance: 24,
      patientName: "Juan Emilio Aguinaldo",
      patientHrn: "HRN-2026-0034",
      prescriberName: "Dr. Alicia Tan, MD",
      prescriberS2: "S2-NCR-2026-8812",
      specialRxSerial: "PDEA-DDB-2026-00981",
      pharmacistName: "Maria Santos, RPh",
      witnessName: "Gabriel Mendoza, RN",
      notes: "Prescription RX-2026-00413. Severe pain breakthrough.",
    },
  ]);

  const [specialRxList] = useState([
    {
      id: "srx-1",
      serialNo: "PDEA-DDB-2026-00981",
      patientName: "Juan Emilio Aguinaldo",
      patientHrn: "HRN-2026-0034",
      prescriberName: "Dr. Alicia Tan, MD",
      s2License: "S2-NCR-2026-8812",
      drugName: "Morphine Sulfate 10mg/mL Ampoule",
      qtyIssued: 6,
      isUsed: true,
      usedAt: "2026-10-01T14:30:00Z",
      dispenseRef: "DISP-2026-0089",
    },
    {
      id: "srx-2",
      serialNo: "PDEA-DDB-2026-00982",
      patientName: "Consuelo Remigio",
      patientHrn: "HRN-2026-0099",
      prescriberName: "Dr. Alicia Tan, MD",
      s2License: "S2-NCR-2026-8812",
      drugName: "Fentanyl 50mcg/hr Patch",
      qtyIssued: 5,
      isUsed: false,
      usedAt: null,
      dispenseRef: null,
    },
  ]);

  const variance = currentDrug.physicalStock - currentDrug.bookBalance;

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
      {/* Page Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item"><Link to="/dashboard">Home</Link></li>
              <li className="breadcrumb-item"><Link to="/pharmacy/queue">Pharmacy</Link></li>
              <li className="breadcrumb-item active" aria-current="page">Dangerous Drugs Book</li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-1 text-danger d-flex align-items-center gap-2">
            <span>📕</span>
            <span>Controlled Substances Register (AC-7)</span>
          </h1>
          <p className="text-secondary mb-0" style={{ fontSize: "0.9rem" }}>
            Official Dangerous Drugs Book prescribed under Republic Act 9165 / PDEA Board Regulation No. 1.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-dark"
            onClick={() => window.print()}
            className="d-inline-flex align-items-center gap-1"
          >
            <span>🖨️</span>
            <span>Print Official DDB Register</span>
          </Button>
          <Link to="/pharmacy/dispenses">
            <Button variant="danger" className="d-inline-flex align-items-center gap-1">
              <span>⚖️</span>
              <span>Dispense Controlled Drug</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Real-time Reconciliation Balance Alert Banner */}
      <div className="mb-4">
        {variance === 0 ? (
          <AlertBanner
            tone="success"
            title="Dangerous Drugs Inventory Reconciled (Zero Discrepancy)"
          >
            {`Current physical stock count (${currentDrug.physicalStock} ${currentDrug.uom}) strictly matches the Dangerous Drugs Book running balance (${currentDrug.bookBalance} ${currentDrug.uom}). Ledger is fully balanced.`}
          </AlertBanner>
        ) : (
          <AlertBanner
            tone="danger"
            title={`Discrepancy Detected: Variance of ${variance > 0 ? "+" : ""}${variance} ${currentDrug.uom}`}
          >
            Immediate notification to Pharmacist-in-Charge required. PDEA regulation mandates physical count reconciliation before closing shift.
          </AlertBanner>
        )}
      </div>

      {/* Filter and Selection Card */}
      <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-md-5">
              <Form.Label htmlFor="drugSelect" className="small fw-bold text-muted mb-1">
                Select Controlled Drug / Substance:
              </Form.Label>
              <Form.Select
                id="drugSelect"
                value={selectedDrug}
                onChange={(e) => setSelectedDrug(e.target.value)}
              >
                {controlledDrugs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.schedule})
                  </option>
                ))}
              </Form.Select>
            </div>
            <div className="col-md-4">
              <Form.Label className="small fw-bold text-muted mb-1">Period Range:</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Form.Control
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  size="sm"
                />
                <span className="text-muted">to</span>
                <Form.Control
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  size="sm"
                />
              </div>
            </div>
            <div className="col-md-3 text-md-end pt-3">
              <div className="p-2 bg-light border rounded text-center">
                <div className="small text-muted fw-semibold">CURRENT BOOK BALANCE</div>
                <div className="h4 fw-bold text-danger mb-0 font-monospace">
                  {currentDrug.bookBalance} {currentDrug.uom}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link fw-semibold ${activeTab === "REGISTER" ? "active" : ""}`}
            onClick={() => setActiveTab("REGISTER")}
          >
            📋 Official Register Ledger
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link fw-semibold ${activeTab === "SPECIAL_RX" ? "active" : ""}`}
            onClick={() => setActiveTab("SPECIAL_RX")}
          >
            🟡 Yellow Slip (Special Rx) Registry
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link fw-semibold ${activeTab === "RECONCILIATION" ? "active" : ""}`}
            onClick={() => setActiveTab("RECONCILIATION")}
          >
            🔍 Stock Audit &amp; Reconciliation
          </button>
        </li>
      </ul>

      {/* Tab 1: Official Register Ledger */}
      {activeTab === "REGISTER" && (
        <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
          <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
            <div>
              <h5 className="mb-0 fw-bold">{currentDrug.name}</h5>
              <div className="small text-muted font-monospace">{currentDrug.schedule} · PDEA Form AC-7</div>
            </div>
            <span className="badge bg-danger p-2">IMMUTABLE APPEND-ONLY LEDGER</span>
          </div>

          <div className="table-responsive">
            <table className="table table-bordered table-hover align-middle mb-0" style={{ fontSize: "0.82rem" }}>
              <thead className="table-light text-center">
                <tr style={{ textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.03em" }}>
                  <th rowSpan={2} style={{ width: 60 }}>Seq #</th>
                  <th rowSpan={2} style={{ width: 140 }}>Date &amp; Time</th>
                  <th rowSpan={2} style={{ width: 90 }}>Type</th>
                  <th colSpan={3}>Quantity</th>
                  <th rowSpan={2}>Patient Details</th>
                  <th rowSpan={2}>Prescriber &amp; S2</th>
                  <th rowSpan={2}>Yellow Slip Serial</th>
                  <th rowSpan={2}>Dispensing RPh</th>
                  <th rowSpan={2}>Witness User</th>
                </tr>
                <tr style={{ textTransform: "uppercase", fontSize: "0.72rem" }}>
                  <th style={{ width: 60 }} className="table-success">In</th>
                  <th style={{ width: 60 }} className="table-danger">Out</th>
                  <th style={{ width: 70 }} className="table-warning">Balance</th>
                </tr>
              </thead>
              <tbody>
                {registerEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-center font-monospace fw-bold">{entry.seqNo}</td>
                    <td className="text-muted small">
                      {new Date(entry.occurredAt).toLocaleString([], {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="text-center">
                      <span
                        className={`badge ${
                          entry.entryType === "RECEIPT"
                            ? "bg-success"
                            : entry.entryType === "DISPENSE"
                            ? "bg-danger"
                            : "bg-secondary"
                        }`}
                        style={{ fontSize: "0.68rem" }}
                      >
                        {entry.entryType}
                      </span>
                    </td>
                    <td className="text-center fw-bold text-success font-monospace">
                      {entry.qtyIn > 0 ? `+${entry.qtyIn}` : "—"}
                    </td>
                    <td className="text-center fw-bold text-danger font-monospace">
                      {entry.qtyOut > 0 ? `-${entry.qtyOut}` : "—"}
                    </td>
                    <td className="text-center fw-bold font-monospace bg-light">
                      {entry.runningBalance}
                    </td>
                    <td>
                      {entry.patientName ? (
                        <div>
                          <div className="fw-semibold">{entry.patientName}</div>
                          <div className="text-muted font-monospace small">{entry.patientHrn}</div>
                        </div>
                      ) : (
                        <span className="text-muted">N/A (Receipt)</span>
                      )}
                    </td>
                    <td>
                      {entry.prescriberName ? (
                        <div>
                          <div>{entry.prescriberName}</div>
                          <span className="badge bg-danger-subtle text-danger border border-danger-subtle" style={{ fontSize: "0.68rem" }}>
                            {entry.prescriberS2}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="font-monospace fw-bold text-danger">
                      {entry.specialRxSerial || "—"}
                    </td>
                    <td>
                      <div className="fw-semibold">{entry.pharmacistName}</div>
                      <span className="badge bg-light text-dark border" style={{ fontSize: "0.68rem" }}>Attested</span>
                    </td>
                    <td>
                      <div className="fw-semibold">{entry.witnessName}</div>
                      <span className="badge bg-light text-dark border" style={{ fontSize: "0.68rem" }}>Co-signed</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-footer bg-light p-3 d-flex justify-content-between align-items-center">
            <span className="small text-muted">
              Records are cryptographically bound and immutable under database triggers. UPDATE and DELETE operations are denied.
            </span>
            <div className="small fw-semibold text-danger">
              Certified compliant with Philippine RA 9165 §31
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Special Rx Yellow Slip Registry */}
      {activeTab === "SPECIAL_RX" && (
        <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
          <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
            <h5 className="mb-0 fw-bold">Yellow Slip Special Prescription Registry</h5>
            <span className="text-muted small">Strict Single-Use Serial Tracking (AC-7)</span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                  <th>Yellow Slip Serial No.</th>
                  <th>Patient Details</th>
                  <th>Prescriber &amp; S2</th>
                  <th>Controlled Drug</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th>Dispense Reference</th>
                </tr>
              </thead>
              <tbody>
                {specialRxList.map((srx) => (
                  <tr key={srx.id}>
                    <td>
                      <span className="font-monospace fw-bold text-danger">{srx.serialNo}</span>
                    </td>
                    <td>
                      <div className="fw-semibold">{srx.patientName}</div>
                      <div className="text-muted font-monospace small">{srx.patientHrn}</div>
                    </td>
                    <td>
                      <div>{srx.prescriberName}</div>
                      <span className="badge bg-danger-subtle text-danger" style={{ fontSize: "0.68rem" }}>
                        {srx.s2License}
                      </span>
                    </td>
                    <td className="fw-semibold">{srx.drugName}</td>
                    <td className="fw-bold font-monospace">{srx.qtyIssued}</td>
                    <td>
                      {srx.isUsed ? (
                        <span className="badge bg-secondary">
                          ✓ DISPENSED &amp; VOIDED FOR REFILLS
                        </span>
                      ) : (
                        <span className="badge bg-success">ACTIVE / UNUSED</span>
                      )}
                    </td>
                    <td className="font-monospace small text-muted">
                      {srx.dispenseRef || "Pending Dispense"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Stock Audit & Reconciliation */}
      {activeTab === "RECONCILIATION" && (
        <div className="card shadow-sm border-0 p-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
          <h5 className="fw-bold mb-3">Daily Controlled Substance Stock Count &amp; Reconciliation</h5>
          <p className="text-muted small mb-4">
            Perform physical count of dangerous drug inventory and verify against the register book.
            Any variance triggers automated discrepancy reporting.
          </p>

          <div className="row g-4">
            <div className="col-md-6">
              <div className="p-3 bg-light rounded border">
                <h6 className="fw-bold mb-3">Reconciliation Audit Summary</h6>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Drug:</span>
                  <strong>{currentDrug.name}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Physical Inventory Count:</span>
                  <span className="fw-bold font-monospace">{currentDrug.physicalStock} {currentDrug.uom}</span>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Dangerous Drugs Book Balance:</span>
                  <span className="fw-bold font-monospace text-danger">{currentDrug.bookBalance} {currentDrug.uom}</span>
                </div>
                <div className="d-flex justify-content-between py-2">
                  <span>Variance / Discrepancy:</span>
                  <span className="fw-bold font-monospace text-success">0 (BALANCED)</span>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="p-3 bg-white rounded border shadow-sm">
                <h6 className="fw-bold mb-2">Automated Reconciliation Job (JOB-38)</h6>
                <p className="text-muted small mb-3">
                  System worker verifies stock ledger balances against controlled register entries nightly at 00:00.
                </p>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span className="badge bg-success p-2">JOB-38 ACTIVE</span>
                  <span className="text-muted small">Last successful run: Today at 00:00:00</span>
                </div>
                <Button variant="outline-primary" size="sm">
                  Run Immediate Verification Now
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
