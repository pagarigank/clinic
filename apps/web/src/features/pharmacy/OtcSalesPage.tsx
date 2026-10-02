import React, { useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  ScanInput,
} from "@clinic/ui";
import { apiPost } from "../../shared/api/client.js";

interface AvailableOtcItem {
  id: string;
  code: string;
  name: string;
  genericName: string;
  isControlled: boolean;
  requiresPrescription: boolean;
  unitPrice: number;
  uom: string;
  stockQty: number;
}

interface BasketLine {
  item: AvailableOtcItem;
  qty: number;
}

export function OtcSalesPage() {
  const [catalog] = useState<AvailableOtcItem[]>([
    {
      id: "item-pcm-500",
      code: "MED-PCM-500",
      name: "Paracetamol 500mg Tablet",
      genericName: "Paracetamol",
      isControlled: false,
      requiresPrescription: false,
      unitPrice: 5.5,
      uom: "TAB",
      stockQty: 420,
    },
    {
      id: "item-vit-c",
      code: "MED-VIT-C",
      name: "Ascorbic Acid + Zinc 500mg Capsule",
      genericName: "Ascorbic Acid + Zinc",
      isControlled: false,
      requiresPrescription: false,
      unitPrice: 8.0,
      uom: "CAP",
      stockQty: 300,
    },
    {
      id: "item-antacid",
      code: "MED-ANT-CHEW",
      name: "Aluminum Hydroxide + Magnesium Chewable",
      genericName: "Antacid Double Action",
      isControlled: false,
      requiresPrescription: false,
      unitPrice: 10.0,
      uom: "TAB",
      stockQty: 180,
    },
    {
      id: "item-betadine",
      code: "MED-BET-60",
      name: "Povidone Iodine 10% Antiseptic Solution 60mL",
      genericName: "Povidone Iodine",
      isControlled: false,
      requiresPrescription: false,
      unitPrice: 145.0,
      uom: "BTL",
      stockQty: 45,
    },
    // Controlled / Rx items to test hard rejection
    {
      id: "item-amox-500",
      code: "MED-AMX-500",
      name: "Amoxicillin 500mg Capsule",
      genericName: "Amoxicillin",
      isControlled: false,
      requiresPrescription: true, // Antibiotic, Rx required!
      unitPrice: 12.0,
      uom: "CAP",
      stockQty: 150,
    },
    {
      id: "item-morph-10",
      code: "MED-MOR-10",
      name: "Morphine Sulfate 10mg/mL Ampoule",
      genericName: "Morphine Sulfate",
      isControlled: true, // Controlled dangerous drug!
      requiresPrescription: true,
      unitPrice: 85.0,
      uom: "AMP",
      stockQty: 24,
    },
  ]);

  const [scanQuery, setScanQuery] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([
    {
      item: catalog[0]!,
      qty: 10,
    },
    {
      item: catalog[1]!,
      qty: 20,
    },
  ]);

  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [hasSeniorPwdDiscount, setHasSeniorPwdDiscount] = useState(false);
  const [seniorPwdId, setSeniorPwdId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD" | "E_WALLET">("CASH");
  const [amountTendered, setAmountTendered] = useState<number>(300);

  const [rejectionAlert, setRejectionAlert] = useState<string | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [completedSaleRef, setCompletedSaleRef] = useState<string | null>(null);

  const subtotal = basket.reduce((acc, b) => acc + b.qty * b.item.unitPrice, 0);
  const discountAmount = hasSeniorPwdDiscount ? subtotal * 0.2 : 0;
  const netTotal = subtotal - discountAmount;
  const changeDue = Math.max(0, amountTendered - netTotal);

  const handleAddItem = (item: AvailableOtcItem) => {
    setRejectionAlert(null);

    // Hard client-side check rejecting controlled & Rx-only items
    if (item.isControlled) {
      setRejectionAlert(
        `⛔ RESTRICTED: "${item.name}" is an AC-7 Controlled Substance. Over-the-counter dispensing is strictly prohibited by law. It requires an official PDEA Yellow Prescription Slip and pharmacist verification.`
      );
      return;
    }

    if (item.requiresPrescription) {
      setRejectionAlert(
        `⚠️ PRESCRIPTION REQUIRED: "${item.name}" is an Rx-only medication (e.g. antibiotic or ethical drug). It cannot be sold OTC without a validated doctor's prescription.`
      );
      return;
    }

    // Add to basket or increment qty
    setBasket((prev) => {
      const existing = prev.find((b) => b.item.id === item.id);
      if (existing) {
        return prev.map((b) => (b.item.id === item.id ? { ...b, qty: b.qty + 1 } : b));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const handleScanSubmit = () => {
    if (!scanQuery.trim()) return;
    const found = catalog.find(
      (c) =>
        c.code.toLowerCase() === scanQuery.toLowerCase().trim() ||
        c.name.toLowerCase().includes(scanQuery.toLowerCase().trim())
    );

    if (found) {
      handleAddItem(found);
      setScanQuery("");
    } else {
      setRejectionAlert(`Item not found with barcode or code "${scanQuery}".`);
    }
  };

  const handleCompleteSale = async () => {
    if (basket.length === 0) return;
    const saleId = `OTC-2026-${Date.now().toString().slice(-6)}`;

    try {
      await apiPost("/pharmacy/sales", {
        customerName,
        paymentMethod,
        isSeniorOrPwd: hasSeniorPwdDiscount,
        seniorPwdId: hasSeniorPwdDiscount ? seniorPwdId : undefined,
        items: basket.map((b) => ({
          itemId: b.item.id,
          qty: b.qty,
          unitPrice: b.item.unitPrice,
        })),
      });
    } catch {
      // offline / mock fallback
    }

    setCompletedSaleRef(saleId);
    setIsReceiptModalOpen(true);
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
              <li className="breadcrumb-item active" aria-current="page">OTC Sales</li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary)" }}>
            🛒 Over-The-Counter (OTC) Pharmacy POS
          </h1>
          <p className="text-secondary mb-0" style={{ fontSize: "0.9rem" }}>
            Scan-first POS basket for non-prescription medicines with hard rejection of controlled substances.
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Link to="/pharmacy/queue">
            <Button variant="outline-primary" size="sm">
              💊 Prescription Queue
            </Button>
          </Link>
          <Link to="/pharmacy/dispenses">
            <Button variant="outline-secondary" size="sm">
              ⚖️ Dispense Workbench
            </Button>
          </Link>
        </div>
      </div>

      {/* Safety Rejection Alert Banner */}
      {rejectionAlert && (
        <div className="mb-4">
          <AlertBanner
            tone="danger"
            title="Dispensing Blocked by Clinical Policy"
          >
            {rejectionAlert}
          </AlertBanner>
        </div>
      )}

      <div className="row g-4">
        {/* Left Column: Barcode Scan & Quick Items */}
        <div className="col-lg-7">
          <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
            <div className="card-header bg-white py-3 border-bottom">
              <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
                <span>🔍</span>
                <span>Scan or Search Medication</span>
              </h5>
            </div>
            <div className="card-body p-3">
              <div className="d-flex gap-2 mb-4">
                <div className="flex-grow-1">
                  <ScanInput
                    id="scanQuery"
                    label="Barcode / Product Code"
                    value={scanQuery}
                    onChange={setScanQuery}
                    onScan={() => handleScanSubmit()}
                    placeholder="Scan product barcode (e.g. MED-PCM-500)..."
                  />
                </div>
                <div className="d-flex align-items-end">
                  <Button variant="primary" onClick={handleScanSubmit} style={{ height: "42px" }}>
                    Add
                  </Button>
                </div>
              </div>

              <h6 className="fw-bold text-muted small text-uppercase mb-2">Available Pharmacy Items</h6>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Stock</th>
                      <th>Price</th>
                      <th className="text-end">Add</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="fw-semibold">{item.name}</div>
                          <div className="text-muted small">{item.code} · {item.genericName}</div>
                        </td>
                        <td>
                          {item.isControlled ? (
                            <Badge bg="danger">AC-7 CONTROLLED</Badge>
                          ) : item.requiresPrescription ? (
                            <Badge bg="warning" text="dark">Rx ONLY</Badge>
                          ) : (
                            <Badge bg="success">OTC APPROVED</Badge>
                          )}
                        </td>
                        <td className="font-monospace">{item.stockQty} {item.uom}</td>
                        <td className="fw-bold">₱{item.unitPrice.toFixed(2)}</td>
                        <td className="text-end">
                          <Button
                            variant={item.isControlled || item.requiresPrescription ? "outline-danger" : "outline-primary"}
                            size="sm"
                            onClick={() => handleAddItem(item)}
                          >
                            {item.isControlled || item.requiresPrescription ? "Test Block" : "+ Add"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: POS Cart & Checkout */}
        <div className="col-lg-5">
          <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)" }}>
            <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
              <h5 className="mb-0 fw-bold">Cart / Basket</h5>
              <span className="badge bg-primary rounded-pill">{basket.length} items</span>
            </div>

            <div className="card-body p-3">
              {/* Customer info */}
              <div className="mb-3">
                <Form.Label className="small fw-bold">Customer Name</Form.Label>
                <Form.Control
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  size="sm"
                />
              </div>

              {/* Basket line items */}
              <div className="border rounded p-2 mb-3 bg-light" style={{ maxHeight: 240, overflowY: "auto" }}>
                {basket.length === 0 ? (
                  <div className="text-center py-4 text-muted small">Cart is empty. Scan an OTC product to begin.</div>
                ) : (
                  basket.map((line) => (
                    <div
                      key={line.item.id}
                      className="d-flex justify-content-between align-items-center p-2 bg-white rounded border mb-2 shadow-xs"
                      style={{ fontSize: "0.85rem" }}
                    >
                      <div style={{ maxWidth: 180 }}>
                        <div className="fw-semibold text-truncate">{line.item.name}</div>
                        <div className="text-muted small">₱{line.item.unitPrice.toFixed(2)} / {line.item.uom}</div>
                      </div>

                      <div className="d-flex align-items-center gap-2">
                        <Form.Control
                          type="number"
                          min={1}
                          max={line.item.stockQty}
                          value={line.qty}
                          size="sm"
                          style={{ width: 65 }}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setBasket((prev) =>
                              prev.map((b) => (b.item.id === line.item.id ? { ...b, qty: val } : b))
                            );
                          }}
                        />
                        <span className="fw-bold font-monospace" style={{ minWidth: 65, textAlign: "right" }}>
                          ₱{(line.qty * line.item.unitPrice).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-danger p-0"
                          onClick={() => setBasket((prev) => prev.filter((b) => b.item.id !== line.item.id))}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Statutory Discount Toggle */}
              <div className="p-3 bg-light rounded border mb-3">
                <Form.Check
                  type="checkbox"
                  id="seniorPwdDiscount"
                  label="Senior Citizen / PWD 20% Statutory Discount"
                  className="fw-semibold mb-2"
                  checked={hasSeniorPwdDiscount}
                  onChange={(e) => setHasSeniorPwdDiscount(e.target.checked)}
                />
                {hasSeniorPwdDiscount && (
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="Enter Senior Citizen / PWD ID Number..."
                    value={seniorPwdId}
                    onChange={(e) => setSeniorPwdId(e.target.value)}
                  />
                )}
              </div>

              {/* Totals Breakdown */}
              <div className="p-3 bg-white border rounded mb-3 font-monospace" style={{ fontSize: "0.9rem" }}>
                <div className="d-flex justify-content-between mb-1">
                  <span>Subtotal:</span>
                  <span>₱{subtotal.toFixed(2)}</span>
                </div>
                {hasSeniorPwdDiscount && (
                  <div className="d-flex justify-content-between mb-1 text-danger">
                    <span>Senior / PWD 20% Discount:</span>
                    <span>-₱{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="d-flex justify-content-between pt-2 border-top fw-bold h5 text-primary mb-0">
                  <span>Net Payable:</span>
                  <span>₱{netTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Tender & Payment Method */}
              <div className="mb-3">
                <Form.Label className="small fw-bold">Payment Method</Form.Label>
                <div className="btn-group w-100 mb-2" role="group">
                  {(["CASH", "CARD", "E_WALLET"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`btn btn-sm ${paymentMethod === m ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => setPaymentMethod(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {paymentMethod === "CASH" && (
                  <div className="row g-2 align-items-center">
                    <div className="col-6">
                      <Form.Label className="small text-muted mb-1">Cash Tendered:</Form.Label>
                      <Form.Control
                        type="number"
                        size="sm"
                        value={amountTendered}
                        onChange={(e) => setAmountTendered(Number(e.target.value))}
                      />
                    </div>
                    <div className="col-6 text-end">
                      <div className="small text-muted">Change Due:</div>
                      <div className="fw-bold font-monospace text-success h6 mb-0">
                        ₱{changeDue.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button
                variant="success"
                size="lg"
                className="w-100 fw-bold d-flex justify-content-center align-items-center gap-2 py-3 shadow-sm"
                disabled={basket.length === 0}
                onClick={handleCompleteSale}
              >
                <span>✓</span>
                <span>Complete Sale (₱{netTotal.toFixed(2)})</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* POS Receipt Modal */}
      <Modal show={isReceiptModalOpen} onHide={() => setIsReceiptModalOpen(false)} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Official Sales Receipt</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-light p-3 font-monospace" style={{ fontSize: "0.8rem" }}>
          <div className="bg-white p-3 border rounded shadow-xs text-center">
            <div className="fw-bold" style={{ fontSize: "0.95rem" }}>METROPOLIS CLINIC PHARMACY</div>
            <div className="text-muted" style={{ fontSize: "0.7rem" }}>
              TIN: 123-456-789-000 · VAT REG
            </div>
            <div className="text-muted mb-2" style={{ fontSize: "0.7rem" }}>
              Quezon City · Tel: (02) 8888-1234
            </div>
            <div className="border-top border-bottom py-1 my-2 text-start small">
              <div>Ref: {completedSaleRef}</div>
              <div>Date: {new Date().toLocaleString()}</div>
              <div>Customer: {customerName}</div>
              {hasSeniorPwdDiscount && <div>Senior/PWD ID: {seniorPwdId}</div>}
            </div>

            <div className="text-start mb-2">
              {basket.map((b) => (
                <div key={b.item.id} className="d-flex justify-content-between">
                  <span>{b.item.name} x {b.qty}</span>
                  <span>₱{(b.qty * b.item.unitPrice).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-top pt-2 text-end">
              <div>Subtotal: ₱{subtotal.toFixed(2)}</div>
              {hasSeniorPwdDiscount && <div className="text-danger">Discount (20%): -₱{discountAmount.toFixed(2)}</div>}
              <div className="fw-bold h6 mt-1">TOTAL: ₱{netTotal.toFixed(2)}</div>
              <div>Tendered ({paymentMethod}): ₱{amountTendered.toFixed(2)}</div>
              <div>Change: ₱{changeDue.toFixed(2)}</div>
            </div>

            <div className="text-muted mt-3 small">
              Thank you for choosing Metropolis Clinic!
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsReceiptModalOpen(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            🖨️ Print Receipt
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
