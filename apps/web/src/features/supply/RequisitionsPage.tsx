import React, { useState } from "react";
import { AlertBanner, StatusPill, Button, Modal, Form } from "@clinic/ui";

interface RequisitionItem {
  id: string;
  reqNo: string;
  fromLocation: string; // requesting department
  toLocation: string;   // fulfilling store
  itemSummary: string;
  qtyRequested: number;
  qtyIssued: number;
  qtyReceived: number;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "ISSUED" | "ACKNOWLEDGED" | "DISCREPANCY";
  createdAt: string;
}

const INITIAL_REQUISITIONS: RequisitionItem[] = [
  {
    id: "req-1",
    reqNo: "REQ-2026-0045",
    fromLocation: "OPD Consultation Store",
    toLocation: "Central Pharmacy Store",
    itemSummary: "Amoxicillin 500mg (100 CAP)",
    qtyRequested: 100,
    qtyIssued: 100,
    qtyReceived: 0,
    status: "ISSUED",
    createdAt: "2026-10-01 09:30",
  },
  {
    id: "req-2",
    reqNo: "REQ-2026-0046",
    fromLocation: "Emergency Pharmacy Store",
    toLocation: "Central Pharmacy Store",
    itemSummary: "Ceftriaxone 1g Vial (20 VIAL)",
    qtyRequested: 20,
    qtyIssued: 0,
    qtyReceived: 0,
    status: "SUBMITTED",
    createdAt: "2026-10-01 11:15",
  },
  {
    id: "req-3",
    reqNo: "REQ-2026-0042",
    fromLocation: "Pediatric Ward Store",
    toLocation: "Central Supply Store",
    itemSummary: "Disposable Syringe 5mL (50 PCS)",
    qtyRequested: 50,
    qtyIssued: 50,
    qtyReceived: 48,
    status: "DISCREPANCY",
    createdAt: "2026-09-30 15:40",
  },
];

export function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<RequisitionItem[]>(INITIAL_REQUISITIONS);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [alert, setAlert] = useState<string | null>(null);

  // New Requisition Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newFromLoc, setNewFromLoc] = useState("OPD Consultation Store");
  const [newToLoc, setNewToLoc] = useState("Central Pharmacy Store");
  const [newItemName, setNewItemName] = useState("Amoxicillin 500mg Capsule");
  const [newQty, setNewQty] = useState(50);

  // Acknowledge Receipt Modal (AC-9 Discrepancy flow)
  const [ackItem, setAckItem] = useState<RequisitionItem | null>(null);
  const [qtyReceivedInput, setQtyReceivedInput] = useState(0);
  const [discrepancyReason, setDiscrepancyReason] = useState("");

  const filtered = requisitions.filter(
    (r) => filterStatus === "ALL" || r.status === filterStatus
  );

  const handleCreateRequisition = (e: React.FormEvent) => {
    e.preventDefault();
    const newReq: RequisitionItem = {
      id: `req-${Date.now()}`,
      reqNo: `REQ-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      fromLocation: newFromLoc,
      toLocation: newToLoc,
      itemSummary: `${newItemName} (${newQty})`,
      qtyRequested: newQty,
      qtyIssued: 0,
      qtyReceived: 0,
      status: "SUBMITTED",
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };
    setRequisitions((prev) => [newReq, ...prev]);
    setIsCreateOpen(false);
    setAlert(`Requisition ${newReq.reqNo} created and submitted for supervisor approval.`);
  };

  const handleApprove = (id: string) => {
    setRequisitions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "APPROVED" } : r))
    );
    setAlert(`Requisition approved. Ready for central store picking and issue.`);
  };

  const handleIssue = (id: string) => {
    setRequisitions((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: "ISSUED", qtyIssued: r.qtyRequested } : r
      )
    );
    setAlert(`Stock issued via FEFO pick. Movement posted to in-transit ledger.`);
  };

  const handleOpenAcknowledge = (req: RequisitionItem) => {
    setAckItem(req);
    setQtyReceivedInput(req.qtyIssued);
    setDiscrepancyReason("");
  };

  const handleConfirmAcknowledge = () => {
    if (!ackItem) return;
    const hasDiscrepancy = qtyReceivedInput !== ackItem.qtyIssued;
    const newStatus = hasDiscrepancy ? "DISCREPANCY" : "ACKNOWLEDGED";

    setRequisitions((prev) =>
      prev.map((r) =>
        r.id === ackItem.id
          ? {
              ...r,
              status: newStatus,
              qtyReceived: qtyReceivedInput,
            }
          : r
      )
    );

    setAlert(
      hasDiscrepancy
        ? `AC-9 Discrepancy logged: Expected ${ackItem.qtyIssued}, received ${qtyReceivedInput}. Reason: "${discrepancyReason}". Balance updated.`
        : `Requisition ${ackItem.reqNo} successfully received and acknowledged. Destination balance updated.`
    );
    setAckItem(null);
  };

  return (
    <div className="container-fluid px-4 py-3">
      {/* Title */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-1 font-weight-bold" style={{ color: "var(--grey-900)" }}>
            Department Requisitions &amp; Stock Issues
          </h1>
          <p className="text-muted small mb-0">
            SUP-T3 &amp; AC-9: Internal supply orders, FEFO issue pick, in-transit movements, and receiving discrepancy capture.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
          + New Department Requisition
        </Button>
      </div>

      {alert && (
        <div className="mb-3">
          <AlertBanner tone="info">{alert}</AlertBanner>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="btn-group btn-group-sm mb-3">
        {["ALL", "SUBMITTED", "APPROVED", "ISSUED", "DISCREPANCY", "ACKNOWLEDGED"].map((st) => (
          <button
            key={st}
            type="button"
            className={`btn ${filterStatus === st ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setFilterStatus(st)}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Requisitions Table */}
      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Req. No</th>
                  <th>Requesting Location</th>
                  <th>Fulfilling Store</th>
                  <th>Items Requested</th>
                  <th className="text-end">Requested</th>
                  <th className="text-end">Issued</th>
                  <th className="text-end">Received</th>
                  <th className="text-center">Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.reqNo}</strong>
                      <div className="text-muted small">{r.createdAt}</div>
                    </td>
                    <td>{r.fromLocation}</td>
                    <td>{r.toLocation}</td>
                    <td>{r.itemSummary}</td>
                    <td className="text-end font-weight-bold">{r.qtyRequested}</td>
                    <td className="text-end">{r.qtyIssued}</td>
                    <td className="text-end font-weight-bold">
                      {r.status === "DISCREPANCY" ? (
                        <span className="text-danger">{r.qtyReceived} (Variance)</span>
                      ) : (
                        r.qtyReceived
                      )}
                    </td>
                    <td className="text-center">
                      <StatusPill
                        tone={
                          r.status === "ACKNOWLEDGED"
                            ? "normal"
                            : r.status === "DISCREPANCY"
                            ? "critical"
                            : r.status === "ISSUED"
                            ? "pending"
                            : "neutral"
                        }
                        label={r.status}
                      />
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        {r.status === "SUBMITTED" && (
                          <Button
                            variant="outline-success"
                            size="sm"
                            onClick={() => handleApprove(r.id)}
                            aria-label={`Approve ${r.reqNo}`}
                          >
                            Approve
                          </Button>
                        )}
                        {r.status === "APPROVED" && (
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleIssue(r.id)}
                            aria-label={`FEFO Issue ${r.reqNo}`}
                          >
                            FEFO Issue
                          </Button>
                        )}
                        {r.status === "ISSUED" && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleOpenAcknowledge(r)}
                            aria-label={`Receive ${r.reqNo}`}
                          >
                            Receive &amp; Verify
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Requisition Modal */}
      {isCreateOpen && (
        <Modal show={true} onHide={() => setIsCreateOpen(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">Draft Department Requisition</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleCreateRequisition}>
            <Modal.Body>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Requesting Department</Form.Label>
                <Form.Select
                  size="sm"
                  value={newFromLoc}
                  onChange={(e) => setNewFromLoc(e.target.value)}
                >
                  <option value="OPD Consultation Store">OPD Consultation Store</option>
                  <option value="Emergency Pharmacy Store">Emergency Pharmacy Store</option>
                  <option value="Pediatric Ward Store">Pediatric Ward Store</option>
                </Form.Select>
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Fulfilling Store</Form.Label>
                <Form.Select
                  size="sm"
                  value={newToLoc}
                  onChange={(e) => setNewToLoc(e.target.value)}
                >
                  <option value="Central Pharmacy Store">Central Pharmacy Store</option>
                  <option value="Central Supply Store">Central Supply Store</option>
                </Form.Select>
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Item</Form.Label>
                <Form.Select
                  size="sm"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                >
                  <option value="Amoxicillin 500mg Capsule">Amoxicillin 500mg Capsule</option>
                  <option value="Paracetamol 500mg Tablet">Paracetamol 500mg Tablet</option>
                  <option value="Ceftriaxone 1g Vial">Ceftriaxone 1g Vial</option>
                  <option value="Latex Examination Gloves (M)">Latex Examination Gloves (M)</option>
                </Form.Select>
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Quantity Needed</Form.Label>
                <Form.Control
                  size="sm"
                  type="number"
                  min="1"
                  value={newQty}
                  onChange={(e) => setNewQty(parseInt(e.target.value, 10) || 1)}
                  required
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Submit Requisition
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Acknowledge Receipt with AC-9 Discrepancy Flow */}
      {ackItem && (
        <Modal show={true} onHide={() => setAckItem(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">
              Receive Goods &amp; Discrepancy Verification (AC-9)
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="mb-3 small">
              Requisition: <strong>{ackItem.reqNo}</strong> ({ackItem.itemSummary})
              <br />
              Issued Quantity: <strong>{ackItem.qtyIssued}</strong>
            </div>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="actualQtyReceived" className="small font-weight-bold">Actual Quantity Received *</Form.Label>
              <Form.Control
                id="actualQtyReceived"
                type="number"
                size="sm"
                value={qtyReceivedInput}
                onChange={(e) => setQtyReceivedInput(parseInt(e.target.value, 10) || 0)}
                min="0"
                max={ackItem.qtyIssued}
                required
                aria-label="Actual Quantity Received"
              />
            </Form.Group>

            {qtyReceivedInput !== ackItem.qtyIssued && (
              <div className="alert alert-warning py-2 small mb-3">
                ⚠️ <strong>AC-9 Discrepancy Detected:</strong> You received {qtyReceivedInput} of {ackItem.qtyIssued} issued units (Variance: {ackItem.qtyIssued - qtyReceivedInput}). A discrepancy reason is required.
                <div className="mt-2">
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="Reason (e.g., '2 ampoules broken/damaged in transit')..."
                    value={discrepancyReason}
                    onChange={(e) => setDiscrepancyReason(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setAckItem(null)}>
              Cancel
            </Button>
            <Button
              variant={qtyReceivedInput !== ackItem.qtyIssued ? "warning" : "success"}
              size="sm"
              onClick={handleConfirmAcknowledge}
              disabled={qtyReceivedInput !== ackItem.qtyIssued && !discrepancyReason.trim()}
            >
              {qtyReceivedInput !== ackItem.qtyIssued ? "Log Discrepancy & Receive" : "Acknowledge Full Receipt"}
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
