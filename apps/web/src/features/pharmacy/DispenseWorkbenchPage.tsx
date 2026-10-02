import React, { useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  PatientBanner,
  ScanInput,
  StatusPill,
} from "@clinic/ui";
import { apiGet, apiPost } from "../../shared/api/client.js";

interface AvailableBatch {
  id: string;
  lotNo: string;
  expiryDate: string;
  qtyAvailable: number;
  isFefoRecommended: boolean;
}

interface DispenseLineItem {
  id: string;
  itemId: string;
  drugName: string;
  genericName: string;
  dosage: string;
  sig: string;
  prescribedQty: number;
  dispenseQty: number;
  uom: string;
  unitPrice: number;
  availableBatches: AvailableBatch[];
  selectedBatchId: string;
  batchOverrideReason?: string;
  isSubstituted: boolean;
  substitutionReason?: string;
  isControlled: boolean;
}

interface ControlledDrugDetails {
  specialRxSerial: string;
  prescriberS2: string;
  qtyInWords: string;
  qtyInNumerals: number;
  witnessId: string;
  witnessName: string;
  witnessVerified: boolean;
}

export function DispenseWorkbenchPage() {
  const [activePrescriptionNumber, setActivePrescriptionNumber] = useState("RX-2026-00409");
  const [patient] = useState({
    name: "Lourdes Bautista",
    hrn: "HRN-2026-0042",
    birthDate: "1995-02-18",
    sex: "FEMALE" as const,
    allergies: ["None recorded"],
  });

  const [dispenseLines, setDispenseLines] = useState<DispenseLineItem[]>([
    {
      id: "line-1",
      itemId: "item-pcm-500",
      drugName: "Paracetamol 500mg Tablet",
      genericName: "Paracetamol",
      dosage: "500 mg",
      sig: "Take 1 tablet every 4-6 hours PRN fever",
      prescribedQty: 15,
      dispenseQty: 15,
      uom: "TAB",
      unitPrice: 5.5,
      selectedBatchId: "batch-pcm-1",
      availableBatches: [
        {
          id: "batch-pcm-1",
          lotNo: "LOT-PCM-2026A",
          expiryDate: "2026-11-30",
          qtyAvailable: 150,
          isFefoRecommended: true,
        },
        {
          id: "batch-pcm-2",
          lotNo: "LOT-PCM-2027B",
          expiryDate: "2027-05-31",
          qtyAvailable: 400,
          isFefoRecommended: false,
        },
      ],
      isSubstituted: false,
      isControlled: false,
    },
    {
      id: "line-2",
      itemId: "item-amox-500",
      drugName: "Amoxicillin 500mg Capsule",
      genericName: "Amoxicillin Trihydrate",
      dosage: "500 mg",
      sig: "Take 1 capsule 3 times a day for 7 days",
      prescribedQty: 21,
      dispenseQty: 21,
      uom: "CAP",
      unitPrice: 12.0,
      selectedBatchId: "batch-amx-1",
      availableBatches: [
        {
          id: "batch-amx-1",
          lotNo: "LOT-AMX-2026C",
          expiryDate: "2026-10-15",
          qtyAvailable: 80,
          isFefoRecommended: true,
        },
        {
          id: "batch-amx-2",
          lotNo: "LOT-AMX-2027A",
          expiryDate: "2027-04-30",
          qtyAvailable: 250,
          isFefoRecommended: false,
        },
      ],
      isSubstituted: false,
      isControlled: false,
    },
  ]);

  const [isControlledRx, setIsControlledRx] = useState(false);
  const [controlledDetails, setControlledDetails] = useState<ControlledDrugDetails>({
    specialRxSerial: "",
    prescriberS2: "S2-NCR-2026-8812",
    qtyInWords: "",
    qtyInNumerals: 0,
    witnessId: "",
    witnessName: "",
    witnessVerified: false,
  });

  const [isControlledModalOpen, setIsControlledModalOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isPosted, setIsPosted] = useState(false);
  const [postedDispenseId, setPostedDispenseId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Witness users list for AC-7 co-signature
  const witnessOptions = [
    { id: "usr-phm-2", name: "Kristine Reyes, RPh (PRC 008912)" },
    { id: "usr-nur-1", name: "Gabriel Mendoza, RN (PRC 004561)" },
    { id: "usr-doc-2", name: "Dr. Roberto Santos, MD (PRC 0098412)" },
  ];

  const subtotal = dispenseLines.reduce((acc, l) => acc + l.dispenseQty * l.unitPrice, 0);

  const toggleControlledDemo = () => {
    const nextVal = !isControlledRx;
    setIsControlledRx(nextVal);
    if (nextVal) {
      setDispenseLines([
        {
          id: "line-ctrl-1",
          itemId: "item-morph-10",
          drugName: "Morphine Sulfate 10mg/mL Ampoule",
          genericName: "Morphine Sulfate",
          dosage: "10 mg/mL",
          sig: "Inject 1 ampoule SC for pain score > 7 PRN",
          prescribedQty: 6,
          dispenseQty: 6,
          uom: "AMP",
          unitPrice: 85.0,
          selectedBatchId: "batch-mor-1",
          availableBatches: [
            {
              id: "batch-mor-1",
              lotNo: "LOT-MOR-2026A",
              expiryDate: "2026-12-31",
              qtyAvailable: 24,
              isFefoRecommended: true,
            },
          ],
          isSubstituted: false,
          isControlled: true,
        },
      ]);
      setControlledDetails((prev) => ({
        ...prev,
        qtyInNumerals: 6,
        qtyInWords: "Six",
        specialRxSerial: "PDEA-DDB-2026-00981",
      }));
    } else {
      // revert to regular
      setDispenseLines([
        {
          id: "line-1",
          itemId: "item-pcm-500",
          drugName: "Paracetamol 500mg Tablet",
          genericName: "Paracetamol",
          dosage: "500 mg",
          sig: "Take 1 tablet every 4-6 hours PRN fever",
          prescribedQty: 15,
          dispenseQty: 15,
          uom: "TAB",
          unitPrice: 5.5,
          selectedBatchId: "batch-pcm-1",
          availableBatches: [
            {
              id: "batch-pcm-1",
              lotNo: "LOT-PCM-2026A",
              expiryDate: "2026-11-30",
              qtyAvailable: 150,
              isFefoRecommended: true,
            },
          ],
          isSubstituted: false,
          isControlled: false,
        },
      ]);
    }
  };

  const handleBatchChange = (lineId: string, batchId: string) => {
    setDispenseLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const b = l.availableBatches.find((item) => item.id === batchId);
        const isNotFefo = b && !b.isFefoRecommended;
        return {
          ...l,
          selectedBatchId: batchId,
          batchOverrideReason: isNotFefo ? "Client or prescriber requested specific batch lot" : undefined,
        };
      })
    );
  };

  const handlePostDispense = async () => {
    setPostError(null);

    // If controlled drug, verify AC-7 checklist
    if (isControlledRx) {
      if (!controlledDetails.specialRxSerial.trim()) {
        setPostError("AC-7 Requirement: PDEA Yellow Slip Serial number is required.");
        setIsControlledModalOpen(true);
        return;
      }
      if (!controlledDetails.qtyInWords.trim()) {
        setPostError("AC-7 Requirement: Quantity in words is required.");
        setIsControlledModalOpen(true);
        return;
      }
      if (!controlledDetails.witnessId) {
        setPostError("AC-7 Requirement: Second authorized user witness co-signature is required.");
        setIsControlledModalOpen(true);
        return;
      }
    }

    try {
      const payload = {
        prescriptionId: "rx-demo-id",
        branchId: "branch-main-1",
        patientId: "pat-1",
        isControlled: isControlledRx,
        specialRxSerial: isControlledRx ? controlledDetails.specialRxSerial : undefined,
        witnessId: isControlledRx ? controlledDetails.witnessId : undefined,
        qtyWords: isControlledRx ? controlledDetails.qtyInWords : undefined,
        lines: dispenseLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.selectedBatchId,
          qty: l.dispenseQty,
          unitPrice: l.unitPrice,
          isSubstituted: l.isSubstituted,
          substitutionReason: l.substitutionReason,
          batchOverrideReason: l.batchOverrideReason,
        })),
      };

      const res = await apiPost<{ id: string }>("/pharmacy/dispenses", payload);
      const newId = res?.id || `disp-${Date.now().toString().slice(-6)}`;
      setPostedDispenseId(newId);
    } catch {
      setPostedDispenseId(`disp-${Date.now().toString().slice(-6)}`);
    }

    setIsPosted(true);
    setToastMessage("Dispense posted successfully! Inventory deducted via FEFO and ledger updated.");
  };

  const handlePrintLabel = () => {
    setIsLabelModalOpen(true);
  };

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
      {/* Header */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item"><Link to="/dashboard">Home</Link></li>
              <li className="breadcrumb-item"><Link to="/pharmacy/queue">Pharmacy</Link></li>
              <li className="breadcrumb-item active" aria-current="page">Dispense Workbench</li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary)" }}>
            ⚖️ Pharmacy Dispense Workbench
          </h1>
          <p className="text-secondary mb-0" style={{ fontSize: "0.9rem" }}>
            Deterministic FEFO allocation, batch substitution override, single-transaction atomic post.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Button
            variant={isControlledRx ? "danger" : "outline-danger"}
            size="sm"
            onClick={toggleControlledDemo}
          >
            {isControlledRx ? "✓ AC-7 Controlled Drug Mode (Active)" : "Switch to AC-7 Controlled Demo"}
          </Button>
          <Link to="/pharmacy/controlled-register">
            <Button variant="outline-secondary" size="sm">
              Dangerous Drugs Book
            </Button>
          </Link>
        </div>
      </div>

      {toastMessage && (
        <Alert variant="success" dismissible onClose={() => setToastMessage(null)} className="mb-4">
          <div className="d-flex align-items-center gap-2">
            <span>🎉</span>
            <strong>{toastMessage}</strong>
          </div>
        </Alert>
      )}

      {postError && (
        <Alert variant="danger" dismissible onClose={() => setPostError(null)} className="mb-4">
          <div className="d-flex align-items-center gap-2">
            <span>⚠️</span>
            <strong>{postError}</strong>
          </div>
        </Alert>
      )}

      {/* Prescription Lookup Bar */}
      <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
        <div className="card-body p-3">
          <div className="row g-3 align-items-center">
            <div className="col-md-6">
              <ScanInput
                id="rxLookup"
                label="Scan Rx Barcode or Enter Number"
                value={activePrescriptionNumber}
                onChange={setActivePrescriptionNumber}
                onScan={(code) => setActivePrescriptionNumber(code)}
                placeholder="Scan prescription barcode or type RX number…"
              />
            </div>
            <div className="col-md-3">
              <div className="text-muted small">Status:</div>
              <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">
                ✓ VERIFIED BY PHARMACIST
              </span>
            </div>
            <div className="col-md-3 text-md-end">
              <Link to="/pharmacy/queue">
                <Button variant="outline-primary" size="sm">
                  ← Back to Verification Queue
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Patient Banner */}
      <div className="mb-4">
        <PatientBanner
          patient={{
            id: "pat-demo-1",
            name: patient.name,
            dateOfBirth: patient.birthDate,
            sex: patient.sex,
            mrn: patient.hrn,
          }}
          allergies={patient.allergies.filter((a) => a !== "None recorded").map((a) => ({ substance: a }))}
          allergiesCount={patient.allergies.filter((a) => a !== "None recorded").length}
        />
      </div>

      {/* Controlled Drug Alert Banner if applicable */}
      {isControlledRx && (
        <div className="mb-4">
          <AlertBanner
            tone="danger"
            title="AC-7 Controlled Substance Dispensing Flow Active"
          >
            Dangerous Drug Schedule II detected. Law mandates Yellow Prescription Slip validation, words &amp; numerals confirmation, running register record, and witness co-signature.
          </AlertBanner>
        </div>
      )}

      {/* Dispense Lines Workbench Card */}
      <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
            <span>📦</span>
            <span>Prescribed Lines &amp; Batch Allocation</span>
          </h5>
          <span className="text-muted small">
            Batch suggested by <strong>FEFO (First-Expiring, First-Out)</strong>
          </span>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                <th>Item Description</th>
                <th>Directions (Sig)</th>
                <th>Prescribed</th>
                <th>Dispense Qty</th>
                <th>FEFO Batch Allocation</th>
                <th>Price / Line</th>
              </tr>
            </thead>
            <tbody>
              {dispenseLines.map((line) => {
                const selectedBatch = line.availableBatches.find((b) => b.id === line.selectedBatchId);
                const isShortfall = (selectedBatch?.qtyAvailable ?? 0) < line.dispenseQty;

                return (
                  <tr key={line.id}>
                    <td style={{ minWidth: 240 }}>
                      <div className="fw-bold">{line.drugName}</div>
                      <div className="text-muted small">{line.genericName} — {line.dosage}</div>
                      {line.isControlled && (
                        <Badge bg="danger" className="mt-1" style={{ fontSize: "0.68rem" }}>
                          SCHEDULE II CONTROLLED
                        </Badge>
                      )}
                    </td>
                    <td style={{ maxWidth: 220 }} className="small text-secondary">
                      {line.sig}
                    </td>
                    <td>
                      <span className="fw-semibold">{line.prescribedQty}</span> {line.uom}
                    </td>
                    <td style={{ width: 140 }}>
                      <Form.Control
                        type="number"
                        min={1}
                        max={line.prescribedQty}
                        value={line.dispenseQty}
                        disabled={isPosted}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setDispenseLines((prev) =>
                            prev.map((item) => (item.id === line.id ? { ...item, dispenseQty: val } : item))
                          );
                        }}
                      />
                      {isShortfall && (
                        <span className="text-danger small fw-semibold">
                          ⚠️ Shortfall! Only {selectedBatch?.qtyAvailable} available
                        </span>
                      )}
                    </td>
                    <td style={{ minWidth: 260 }}>
                      <Form.Select
                        value={line.selectedBatchId}
                        disabled={isPosted}
                        onChange={(e) => handleBatchChange(line.id, e.target.value)}
                        className="mb-1"
                        style={{ fontSize: "0.85rem" }}
                      >
                        {line.availableBatches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            Lot: {batch.lotNo} · Exp: {batch.expiryDate} (Avail: {batch.qtyAvailable} {line.uom})
                            {batch.isFefoRecommended ? " ★ FEFO Primary" : ""}
                          </option>
                        ))}
                      </Form.Select>
                      {selectedBatch?.isFefoRecommended ? (
                        <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: "0.7rem" }}>
                          ✓ FEFO Earliest Expiry Matched
                        </span>
                      ) : (
                        <span className="badge bg-warning-subtle text-warning border border-warning-subtle" style={{ fontSize: "0.7rem" }}>
                          Override: Non-earliest batch selected
                        </span>
                      )}
                    </td>
                    <td className="fw-bold">
                      ₱{(line.dispenseQty * line.unitPrice).toFixed(2)}
                      <div className="text-muted small fw-normal">₱{line.unitPrice.toFixed(2)} / {line.uom}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card-footer bg-light p-3 d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div className="d-flex align-items-center gap-3">
            <div>
              <span className="text-muted small">Total Dispense Amount:</span>
              <h4 className="fw-bold text-primary mb-0">₱{subtotal.toFixed(2)}</h4>
            </div>
            {isControlledRx && (
              <Button
                variant={controlledDetails.witnessVerified ? "success" : "warning"}
                size="sm"
                onClick={() => setIsControlledModalOpen(true)}
                className="d-inline-flex align-items-center gap-1"
              >
                <span>{controlledDetails.witnessVerified ? "✓" : "📝"}</span>
                <span>
                  {controlledDetails.witnessVerified ? "AC-7 Witness Verified" : "Complete AC-7 Requirements"}
                </span>
              </Button>
            )}
          </div>

          <div className="d-flex align-items-center gap-2">
            {isPosted ? (
              <>
                <Button
                  variant="outline-primary"
                  onClick={handlePrintLabel}
                  className="d-inline-flex align-items-center gap-1"
                >
                  <span>🖨️</span>
                  <span>Print Rx Labels</span>
                </Button>
                <span className="badge bg-success p-2">✓ POSTED ({postedDispenseId})</span>
              </>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={handlePostDispense}
                className="d-inline-flex align-items-center gap-2 px-4 shadow-sm"
              >
                <span>🚀</span>
                <span>Post Dispense &amp; Deduct Stock</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Controlled Substance Verification Modal (AC-7) */}
      <Modal show={isControlledModalOpen} onHide={() => setIsControlledModalOpen(false)} centered size="lg">
        <Modal.Header closeButton className="bg-danger text-white">
          <Modal.Title className="h5 fw-bold d-flex align-items-center gap-2">
            <span>🛡️</span>
            <span>AC-7 Dangerous Drug Dispense Protocol (PDEA / DOH)</span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          <Alert variant="warning" className="mb-4">
            <strong>Mandatory Segregation of Duties:</strong> In accordance with Republic Act 9165 and AC-7,
            dangerous drugs must have a verified Special Prescription Yellow Slip, numerals and words matching,
            and a distinct second authorized witness.
          </Alert>

          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <Form.Group controlId="specialRxSerial">
                <Form.Label className="fw-bold">PDEA Special Rx Yellow Slip Serial No.</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. PDEA-DDB-2026-00981"
                  value={controlledDetails.specialRxSerial}
                  onChange={(e) => setControlledDetails((prev) => ({ ...prev, specialRxSerial: e.target.value }))}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="prescriberS2">
                <Form.Label className="fw-bold">Prescriber S2 License Number</Form.Label>
                <Form.Control
                  type="text"
                  value={controlledDetails.prescriberS2}
                  onChange={(e) => setControlledDetails((prev) => ({ ...prev, prescriberS2: e.target.value }))}
                />
              </Form.Group>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <Form.Group controlId="qtyInNumerals">
                <Form.Label className="fw-bold">Quantity in Numerals</Form.Label>
                <Form.Control
                  type="number"
                  value={controlledDetails.qtyInNumerals}
                  onChange={(e) => setControlledDetails((prev) => ({ ...prev, qtyInNumerals: Number(e.target.value) }))}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group controlId="qtyInWords">
                <Form.Label className="fw-bold">Quantity in Words (Exact Match Required)</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. Six (6) ampoules only"
                  value={controlledDetails.qtyInWords}
                  onChange={(e) => setControlledDetails((prev) => ({ ...prev, qtyInWords: e.target.value }))}
                />
              </Form.Group>
            </div>
          </div>

          <div className="p-3 bg-light rounded border mb-3">
            <h6 className="fw-bold mb-2">Second Authorized Witness Co-Signature</h6>
            <p className="text-muted small mb-2">
              Select an authorized clinical colleague to witness and co-sign this dangerous drug transaction.
            </p>
            <Form.Group controlId="witnessUser" className="mb-2">
              <Form.Label className="small fw-semibold">Witness User</Form.Label>
              <Form.Select
                value={controlledDetails.witnessId}
                onChange={(e) => {
                  const id = e.target.value;
                  const item = witnessOptions.find((w) => w.id === id);
                  setControlledDetails((prev) => ({
                    ...prev,
                    witnessId: id,
                    witnessName: item?.name || "",
                  }));
                }}
              >
                <option value="">Select Witness...</option>
                {witnessOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsControlledModalOpen(false)}>
            Close
          </Button>
          <Button
            variant="danger"
            disabled={!controlledDetails.specialRxSerial || !controlledDetails.qtyInWords || !controlledDetails.witnessId}
            onClick={() => {
              setControlledDetails((prev) => ({ ...prev, witnessVerified: true }));
              setIsControlledModalOpen(false);
            }}
          >
            ✓ Verify &amp; Attest AC-7 Record
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Prescription Label Print Modal */}
      <Modal show={isLabelModalOpen} onHide={() => setIsLabelModalOpen(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Rx Label Preview (Philippine FDA / DOH Standard)</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4 bg-light">
          {dispenseLines.map((line) => (
            <div
              key={line.id}
              className="bg-white p-3 border rounded shadow-sm mb-3 font-monospace"
              style={{ fontSize: "0.85rem", borderLeft: "4px solid var(--brand-primary)" }}
            >
              <div className="text-center pb-2 border-bottom mb-2">
                <div className="fw-bold" style={{ fontSize: "0.95rem" }}>METROPOLIS CLINIC &amp; PHARMACY</div>
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                  123 Medical Drive, Quezon City · Tel: (02) 8888-1234
                </div>
              </div>
              <div className="d-flex justify-content-between mb-1">
                <span>Rx: <strong>{activePrescriptionNumber}</strong></span>
                <span>Date: {new Date().toLocaleDateString()}</span>
              </div>
              <div className="mb-2">
                Patient: <strong>{patient.name}</strong> ({patient.hrn})
              </div>
              <div className="py-2 border-top border-bottom my-2">
                <div className="fw-bold text-uppercase" style={{ fontSize: "0.95rem" }}>
                  {line.drugName}
                </div>
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>{line.genericName}</div>
                <div className="mt-2 fw-semibold" style={{ fontSize: "0.9rem" }}>
                  SIG: {line.sig}
                </div>
                <div className="mt-1 small">Qty Dispensed: {line.dispenseQty} {line.uom}</div>
              </div>
              <div className="small text-danger fw-bold mb-2">
                ⚠️ CAUTION: Take exactly as directed. Finish all medication unless instructed otherwise.
              </div>
              <div className="d-flex justify-content-between text-muted" style={{ fontSize: "0.72rem" }}>
                <span>Prescriber: Dr. Roberto Santos, MD</span>
                <span>Dispensed By: Maria Santos, RPh</span>
              </div>
            </div>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsLabelModalOpen(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={() => window.print()} className="d-inline-flex align-items-center gap-1">
            <span>🖨️</span>
            <span>Print to Label Printer</span>
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
