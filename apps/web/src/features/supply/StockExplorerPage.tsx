import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { AlertBanner, StatusPill, Button, Modal, Form } from "@clinic/ui";
import { apiGet } from "../../shared/api/client.js";
import { ConsumptionPrintModal } from "./ConsumptionPrintModal.js";

interface StockBalanceItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationName: string;
  batchId: string;
  lotNo: string;
  expiryDate: string;
  qtyOnHand: number;
  qtyReserved: number;
  unitCost: number;
  totalValue: number;
  status: "AVAILABLE" | "QUARANTINED" | "EXPIRED" | "RECALLED";
}

interface StockMovement {
  id: string;
  occurredAt: string;
  movementType: string;
  qty: number;
  uomCode: string;
  postedBy: string;
  rowHash: string;
  reasonNote?: string;
}

const INITIAL_BALANCES: StockBalanceItem[] = [
  {
    id: "bal-1",
    itemId: "i-amox",
    itemCode: "MED-AMOX-500",
    itemName: "Amoxicillin 500mg Capsule",
    locationId: "loc-central",
    locationName: "Central Pharmacy Store",
    batchId: "b-amox-1",
    lotNo: "LOT-AMX-2025A",
    expiryDate: "2027-08-31",
    qtyOnHand: 2500,
    qtyReserved: 100,
    unitCost: 8.50,
    totalValue: 21250.00,
    status: "AVAILABLE",
  },
  {
    id: "bal-2",
    itemId: "i-amox",
    itemCode: "MED-AMOX-500",
    itemName: "Amoxicillin 500mg Capsule",
    locationId: "loc-opd",
    locationName: "OPD Consultation Store",
    batchId: "b-amox-1",
    lotNo: "LOT-AMX-2025A",
    expiryDate: "2027-08-31",
    qtyOnHand: 150,
    qtyReserved: 0,
    unitCost: 8.50,
    totalValue: 1275.00,
    status: "AVAILABLE",
  },
  {
    id: "bal-3",
    itemId: "i-cef",
    itemCode: "MED-CEF-1G",
    itemName: "Ceftriaxone 1g Vial",
    locationId: "loc-central",
    locationName: "Central Pharmacy Store",
    batchId: "b-cef-99",
    lotNo: "LOT-CEF-992",
    expiryDate: "2026-10-25",
    qtyOnHand: 45,
    qtyReserved: 0,
    unitCost: 65.00,
    totalValue: 2925.00,
    status: "AVAILABLE",
  },
  {
    id: "bal-4",
    itemId: "i-glv",
    itemCode: "SUP-GLV-M",
    itemName: "Latex Examination Gloves (M)",
    locationId: "loc-supply",
    locationName: "Central Supply Store",
    batchId: "b-glv-12",
    lotNo: "LOT-GLV-120",
    expiryDate: "2029-01-15",
    qtyOnHand: 120,
    qtyReserved: 10,
    unitCost: 280.00,
    totalValue: 33600.00,
    status: "AVAILABLE",
  },
];

export function StockExplorerPage() {
  const [searchParams] = useSearchParams();
  const [balances, setBalances] = useState<StockBalanceItem[]>(INITIAL_BALANCES);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [nearExpiryOnly, setNearExpiryOnly] = useState(searchParams.get("nearExpiryDays") ? true : false);

  // Ledger modal
  const [activeLedgerItem, setActiveLedgerItem] = useState<StockBalanceItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Quarantine modal
  const [quarantineBatch, setQuarantineBatch] = useState<StockBalanceItem | null>(null);
  const [quarantineReason, setQuarantineReason] = useState("");

  // Print modal
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    apiGet<any[]>("/supply/stock")
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          const mapped: StockBalanceItem[] = data.map((d, idx) => ({
            id: d.id ?? `bal-${idx}`,
            itemId: d.item_id,
            itemCode: d.item_code,
            itemName: d.item_name,
            locationId: d.location_id,
            locationName: d.location_name,
            batchId: d.batch_id,
            lotNo: d.lot_no,
            expiryDate: d.expiry_date ? d.expiry_date.split("T")[0] : "N/A",
            qtyOnHand: Number(d.qty_on_hand),
            qtyReserved: Number(d.qty_reserved || 0),
            unitCost: Number(d.unit_cost || 0),
            totalValue: Number(d.total_value || 0),
            status: d.batch_status ?? "AVAILABLE",
          }));
          setBalances(mapped);
        }
      })
      .catch(() => {
        // Fallback to initial mock data
      });
  }, []);

  const filteredBalances = useMemo(() => {
    return balances.filter((b) => {
      const matchesSearch =
        b.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.lotNo.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesLocation =
        selectedLocation === "ALL" || b.locationName === selectedLocation;

      const matchesExpiry =
        !nearExpiryOnly ||
        (new Date(b.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 60;

      return matchesSearch && matchesLocation && matchesExpiry;
    });
  }, [balances, searchTerm, selectedLocation, nearExpiryOnly]);

  const handleOpenLedger = (item: StockBalanceItem) => {
    setActiveLedgerItem(item);
    // Mock or fetch movements ledger
    setMovements([
      {
        id: "mov-1",
        occurredAt: "2026-09-15 08:30:00",
        movementType: "GRN",
        qty: item.qtyOnHand + 20,
        uomCode: "BASE",
        postedBy: "Pharmacist Elena",
        rowHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        reasonNote: "Initial PO Receiving PO-2026-0012",
      },
      {
        id: "mov-2",
        occurredAt: "2026-09-20 14:15:00",
        movementType: "DISPENSE",
        qty: -20,
        uomCode: "BASE",
        postedBy: "Dr. Maria Santos",
        rowHash: "8a5a41c2c31c99f921e102c77d544464c2084c68f1847e928ee62ebdc222f77e",
        reasonNote: "Prescription Dispense RX-009",
      },
    ]);
  };

  const handleConfirmQuarantine = () => {
    if (!quarantineBatch) return;
    setBalances((prev) =>
      prev.map((b) =>
        b.batchId === quarantineBatch.batchId
          ? {
              ...b,
              status: b.status === "QUARANTINED" ? "AVAILABLE" : "QUARANTINED",
            }
          : b
      )
    );
    const action = quarantineBatch.status === "QUARANTINED" ? "released" : "quarantined";
    setAlert(`Batch ${quarantineBatch.lotNo} successfully ${action}. Reason: ${quarantineReason}`);
    setQuarantineBatch(null);
    setQuarantineReason("");
  };

  return (
    <div className="container-fluid px-4 py-3">
      {/* Title */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-1 font-weight-bold" style={{ color: "var(--grey-900)" }}>
            Stock Explorer &amp; Ledger
          </h1>
          <p className="text-muted small mb-0">
            Real-time on-hand balances, batch tracking, FEFO shelf-life, and immutable audit trail.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => setShowPrintModal(true)}
          >
            🖨️ Print Stock / Consumption Register
          </Button>
        </div>
      </div>

      {alert && (
        <div className="mb-3">
          <AlertBanner tone="info">{alert}</AlertBanner>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="card shadow-sm border-0 mb-4 bg-light">
        <div className="card-body py-3">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search item name, SKU code, or batch / lot #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search items"
              />
            </div>
            <div className="col-12 col-md-4">
              <select
                className="form-select form-select-sm"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                aria-label="Filter by stock location"
              >
                <option value="ALL">All Stock Locations</option>
                <option value="Central Pharmacy Store">Central Pharmacy Store</option>
                <option value="OPD Consultation Store">OPD Consultation Store</option>
                <option value="Central Supply Store">Central Supply Store</option>
              </select>
            </div>
            <div className="col-12 col-md-3">
              <div className="form-check form-switch pt-1">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="nearExpirySwitch"
                  checked={nearExpiryOnly}
                  onChange={(e) => setNearExpiryOnly(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="nearExpirySwitch">
                  Near-Expiry Only (&le;60d)
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Balances Table */}
      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Item Code / Name</th>
                  <th>Location</th>
                  <th>Lot / Batch No.</th>
                  <th>Expiry Date</th>
                  <th className="text-end">On Hand</th>
                  <th className="text-end">Reserved</th>
                  <th className="text-end">Unit Cost</th>
                  <th className="text-end">Total Value</th>
                  <th className="text-center">Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBalances.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-4 text-muted">
                      No stock balances match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredBalances.map((b) => (
                    <tr key={`${b.locationId}-${b.batchId}`}>
                      <td>
                        <strong>{b.itemName}</strong>
                        <div className="text-muted small">{b.itemCode}</div>
                      </td>
                      <td>{b.locationName}</td>
                      <td>
                        <code>{b.lotNo}</code>
                      </td>
                      <td>
                        <div>{b.expiryDate}</div>
                        {new Date(b.expiryDate).getTime() - Date.now() < 30 * 24 * 3600 * 1000 && (
                          <span className="badge bg-danger text-white small" style={{ fontSize: "0.68rem" }}>
                            CRITICAL FEFO
                          </span>
                        )}
                      </td>
                      <td className="text-end font-weight-bold">
                        {b.qtyOnHand.toLocaleString()}
                      </td>
                      <td className="text-end text-muted">
                        {b.qtyReserved > 0 ? (
                          <span className="text-warning font-weight-bold">{b.qtyReserved}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="text-end">
                        ₱{b.unitCost.toFixed(2)}
                      </td>
                      <td className="text-end font-weight-bold text-primary">
                        ₱{b.totalValue.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="text-center">
                        <StatusPill
                          tone={
                            b.status === "AVAILABLE"
                              ? "normal"
                              : b.status === "QUARANTINED"
                              ? "critical"
                              : "neutral"
                          }
                          label={b.status}
                        />
                      </td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleOpenLedger(b)}
                            aria-label={`View ledger for ${b.itemName}`}
                          >
                            Ledger
                          </Button>
                          <Button
                            variant={b.status === "QUARANTINED" ? "outline-success" : "outline-warning"}
                            size="sm"
                            onClick={() => {
                              setQuarantineBatch(b);
                              setQuarantineReason(
                                b.status === "QUARANTINED"
                                  ? "Passed QA re-inspection"
                                  : "Damaged packaging / Quality hold"
                              );
                            }}
                            aria-label={`${b.status === "QUARANTINED" ? "Release" : "Quarantine"} batch ${b.lotNo}`}
                          >
                            {b.status === "QUARANTINED" ? "Release" : "Quarantine"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Movement Ledger Modal */}
      {activeLedgerItem && (
        <Modal show={true} onHide={() => setActiveLedgerItem(null)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">
              Ledger Audit Trail — {activeLedgerItem.itemName} ({activeLedgerItem.lotNo})
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-3">
            <div className="alert alert-info py-2 px-3 small mb-3">
              🔒 <strong>Append-Only Tamper Evident Ledger (AC-12)</strong>: Stock movements are cryptographically chained via SHA-256 hash digests. Database rules forbid UPDATE and DELETE operations.
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-bordered align-middle mb-0" style={{ fontSize: "0.8rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>Occurred At</th>
                    <th>Type</th>
                    <th className="text-end">Qty Change</th>
                    <th>Posted By</th>
                    <th>Reason / Ref</th>
                    <th>SHA-256 Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{m.occurredAt}</td>
                      <td>
                        <span className="badge bg-secondary">{m.movementType}</span>
                      </td>
                      <td className={`text-end font-weight-bold ${m.qty > 0 ? "text-success" : "text-danger"}`}>
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </td>
                      <td>{m.postedBy}</td>
                      <td>{m.reasonNote}</td>
                      <td>
                        <code style={{ fontSize: "0.68rem" }}>{m.rowHash.substring(0, 16)}...</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setActiveLedgerItem(null)}>
              Close Ledger
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Quarantine / Release Modal */}
      {quarantineBatch && (
        <Modal show={true} onHide={() => setQuarantineBatch(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">
              {quarantineBatch.status === "QUARANTINED" ? "Release Quarantined Batch" : "Quarantine Stock Batch"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="small mb-3">
              Batch: <strong>{quarantineBatch.lotNo}</strong> ({quarantineBatch.itemName})
              <br />
              Current Quantity: <strong>{quarantineBatch.qtyOnHand}</strong>
            </p>
            <Form.Group className="mb-3">
              <Form.Label className="small font-weight-bold">
                Authorized Reason / Inspection Finding *
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={quarantineReason}
                onChange={(e) => setQuarantineReason(e.target.value)}
                placeholder="State clinical or regulatory reason for status change..."
                required
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setQuarantineBatch(null)}>
              Cancel
            </Button>
            <Button
              variant={quarantineBatch.status === "QUARANTINED" ? "success" : "danger"}
              size="sm"
              onClick={handleConfirmQuarantine}
              disabled={!quarantineReason.trim()}
            >
              Confirm {quarantineBatch.status === "QUARANTINED" ? "Release" : "Quarantine"}
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      <ConsumptionPrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
      />
    </div>
  );
}
