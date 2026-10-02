import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  Money,
  StatusPill,
} from "@clinic/ui";
import {
  fetchCreditNotes,
  createCreditNote,
  approveCreditNote,
  fetchInvoices,
} from "./api.js";

export function CreditNotesPage() {
  const [creditNotes, setCreditNotes] = useState<any[]>([
    {
      id: "cn-demo-1",
      credit_note_no: "CN-2026-000001",
      invoice_no: "INV-2026-000101",
      amount: 500,
      reason: "Cancelled lab procedure due to patient rescheduling",
      status: "ISSUED",
      issued_by_name: "Dr. Maria Santos",
      approved_by_name: "Admin User",
      created_at: new Date().toISOString(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ tone: "success" | "danger" | "warning"; message: string } | null>(null);

  // New Credit Note Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<any[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchCreditNotes();
      if (Array.isArray(res?.data) && res.data.length > 0) {
        setCreditNotes(res.data);
      }
    } catch {
      // keep
    } finally {
      setLoading(false);
    }
  };

  const loadInvoices = async () => {
    try {
      const res = await fetchInvoices({ limit: 50 });
      setAvailableInvoices(res.data || []);
    } catch {
      setAvailableInvoices([]);
    }
  };

  useEffect(() => {
    loadData();
    loadInvoices();
  }, []);

  const handleCreate = async () => {
    if (!selectedInvoiceId || amount <= 0 || !reason.trim()) {
      setAlert({ tone: "warning", message: "Please fill out all required fields." });
      return;
    }
    try {
      const targetInv = availableInvoices.find((i) => i.id === selectedInvoiceId);
      const branchId = targetInv?.branch_id || "a1000000-0000-4000-8000-000000000001";
      const res = await createCreditNote({
        branchId,
        invoiceId: selectedInvoiceId,
        amount,
        reason,
      });
      setAlert({ tone: "success", message: `Credit note ${res.credit_note_no} created.` });
      setShowNewModal(false);
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to create credit note." });
    }
  };

  const handleApprove = async (cnId: string) => {
    try {
      await approveCreditNote(cnId, {});
      setAlert({ tone: "success", message: "Credit note approved and posted." });
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Approval failed." });
    }
  };

  return (
    <div className="container-fluid py-3">
      {/* Title & Actions */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h2 className="h4 fw-bold mb-1" style={{ color: "var(--grey-900, #0f172a)" }}>
            Credit Notes &amp; Adjustments
          </h2>
          <p className="text-muted small mb-0">
            Phase 7: Controlled revenue adjustments, partial refunds, and dual-control approvals.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowNewModal(true)}>
            ➕ Issue Credit Note
          </Button>
          <Link to="/billing/invoices" className="btn btn-outline-secondary btn-sm">
            Invoices
          </Link>
        </div>
      </div>

      {alert && (
        <AlertBanner tone={alert.tone}>
          {alert.message}
        </AlertBanner>
      )}

      {/* Credit Notes Table */}
      <div className="card shadow-sm border-0">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th>Credit Note No</th>
                <th>Linked Invoice</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Created By</th>
                <th>Approved By</th>
                <th>Date</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    Loading credit notes...
                  </td>
                </tr>
              ) : creditNotes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    No credit notes recorded.
                  </td>
                </tr>
              ) : (
                creditNotes.map((cn) => (
                  <tr key={cn.id}>
                    <td className="fw-semibold text-primary">{cn.credit_note_no}</td>
                    <td>
                      <span className="badge bg-light text-dark border">
                        {cn.invoice_no || "INV"}
                      </span>
                    </td>
                    <td className="fw-bold text-danger">
                      - <Money amount={Number(cn.amount || 0)} />
                    </td>
                    <td className="small" style={{ maxWidth: 250 }}>
                      {cn.reason}
                    </td>
                    <td className="small">{cn.issued_by_name || "Staff"}</td>
                    <td className="small">{cn.approved_by_name || "—"}</td>
                    <td className="small text-muted">
                      {new Date(cn.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <StatusPill
                        label={cn.status}
                        tone={cn.status === "ISSUED" ? "normal" : cn.status === "DRAFT" ? "pending" : "critical"}
                      />
                    </td>
                    <td className="text-end">
                      {cn.status === "DRAFT" && (
                        <Button
                          size="sm"
                          variant="outline-success"
                          onClick={() => handleApprove(cn.id)}
                        >
                          Approve (Dual Control)
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Credit Note Modal */}
      <Modal show={showNewModal} onHide={() => setShowNewModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Issue New Credit Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <Form.Label htmlFor="target-invoice-select" className="small fw-semibold">Target Invoice *</Form.Label>
            <Form.Select
              id="target-invoice-select"
              aria-label="Target Invoice"
              value={selectedInvoiceId}
              onChange={(e) => setSelectedInvoiceId(e.target.value)}
            >
              <option value="">-- Select Invoice --</option>
              {availableInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_no} ({inv.patient_first_name} {inv.patient_last_name}) — Total: ₱{Number(inv.total).toFixed(2)}
                </option>
              ))}
            </Form.Select>
          </div>

          <div className="mb-3">
            <Form.Label htmlFor="adjustment-amount-input" className="small fw-semibold">Adjustment Amount (₱) *</Form.Label>
            <Form.Control
              id="adjustment-amount-input"
              aria-label="Adjustment Amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
            />
          </div>

          <div className="mb-3">
            <Form.Label htmlFor="credit-note-reason-input" className="small fw-semibold">Reason for Credit Note *</Form.Label>
            <Form.Control
              id="credit-note-reason-input"
              aria-label="Reason for Credit Note"
              as="textarea"
              rows={3}
              placeholder="e.g. Service cancellation or overcharge correction"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowNewModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate}>
            Create Credit Note
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
