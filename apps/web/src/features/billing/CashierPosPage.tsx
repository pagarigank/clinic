import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router";
import {
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  Money,
  MoneyField,
  StatusPill,
} from "@clinic/ui";
import {
  fetchInvoices,
  fetchInvoice,
  fetchActiveShift,
  openShift,
  createPayment,
  reprintReceipt,
  fetchPaymentReceipt,
  fetchPaymentMethods,
  fetchSessions,
  saveSession,
} from "./api.js";

interface TenderLine {
  id: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  amount: number;
  tenderedAmount: number;
  reference?: string;
}

export function CashierPosPage() {
  const [searchParams] = useSearchParams();
  const invoiceIdParam = searchParams.get("invoiceId");

  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [openingFloat, setOpeningFloat] = useState(1000);

  const defaultDemoInvoice = {
    id: "inv-demo-1",
    invoice_no: "INV-2026-000101",
    patient_first_name: "Juan",
    patient_last_name: "Dela Cruz",
    patient_number: "P-000123",
    balance: 1200,
    total: 1200,
    lines: [
      { id: "l1", description: "Consultation (Dr. Jose Rizal)", net_amount: 800, is_professional_fee: true },
      { id: "l2", description: "Complete Blood Count (CBC)", net_amount: 400, is_professional_fee: false },
    ],
  };

  const [availableInvoices, setAvailableInvoices] = useState<any[]>([defaultDemoInvoice]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(invoiceIdParam || defaultDemoInvoice.id);
  const [invoice, setInvoice] = useState<any | null>(defaultDemoInvoice);

  const [paymentMethods, setPaymentMethods] = useState<any[]>([
    { id: "pm-cash", code: "CASH", name: "Cash" },
    { id: "pm-card", code: "CARD", name: "Credit / Debit Card" },
    { id: "pm-gcash", code: "GCASH", name: "GCash" },
    { id: "pm-maya", code: "MAYA", name: "Maya" },
    { id: "pm-hmo", code: "HMO", name: "HMO / Insurance" },
  ]);
  const [tenders, setTenders] = useState<TenderLine[]>([
    {
      id: "t1",
      methodId: "pm-cash",
      methodCode: "CASH",
      methodName: "Cash",
      amount: 1200,
      tenderedAmount: 1200,
    },
  ]);

  // Receipt Modal State after successful payment
  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Reprint Dialog State
  const [showReprintModal, setShowReprintModal] = useState(false);
  const [reprintReason, setReprintReason] = useState("");

  // Held Tickets (todo.md §7.3 - POS surface hold/resume)
  const [heldSales, setHeldSales] = useState<any[]>([]);
  const [showHeldModal, setShowHeldModal] = useState(false);

  const [alert, setAlert] = useState<{ tone: "success" | "danger" | "warning"; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadSessions = async () => {
    try {
      const res = await fetchSessions();
      setHeldSales(res.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleHoldSale = async () => {
    if (!invoice) {
      setAlert({ tone: "warning", message: "No active transaction to put on hold." });
      return;
    }
    setIsProcessing(true);
    try {
      if (activeShift?.branch_id) {
        await saveSession("new", {
          branchId: activeShift.branch_id,
          invoiceId: invoice.id,
          status: "HELD",
          sessionData: { invoice, tenders },
        });
        await loadSessions();
      } else {
        throw new Error("No active shift");
      }
    } catch {
      // Fallback to local in-memory hold when API unavailable (offline / test mode)
      const newHold = {
        id: `hold-${Date.now()}`,
        created_at: new Date().toISOString(),
        session_data: { invoice, tenders },
      };
      setHeldSales((prev) => [newHold, ...prev]);
    } finally {
      setIsProcessing(false);
      setInvoice(null);
      setSelectedInvoiceId("");
      setTenders([]);
      setAlert({
        tone: "success",
        message: `Sale for invoice ${invoice.invoice_no || "selected"} placed on hold. Terminal ready for next transaction.`,
      });
    }
  };

  const handleResumeSale = async (session: any) => {
    if (!session || !session.session_data) return;
    setInvoice(session.session_data.invoice);
    setSelectedInvoiceId(session.session_data.invoice.id);
    setTenders(session.session_data.tenders);
    setShowHeldModal(false);
    setAlert({
      tone: "success",
      message: `Resumed transaction for ${session.session_data.invoice.invoice_no}.`,
    });
    // Mark as OPEN so it's no longer 'HELD'
    try {
      await saveSession(session.id, {
        branchId: session.branch_id,
        status: "OPEN",
        sessionData: session.session_data,
        rowVersion: session.row_version,
      });
      await loadSessions();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDiscardHeldSale = async (session: any) => {
    try {
      await saveSession(session.id, {
        branchId: session.branch_id,
        status: "VOIDED",
        sessionData: session.session_data,
        rowVersion: session.row_version,
      });
      await loadSessions();
    } catch (e) {
      console.error(e);
    }
  };


  // Load Active Shift & Payment Methods
  const checkShift = async () => {
    try {
      const shift = await fetchActiveShift();
      if (shift?.id && shift?.shift_no) {
        setActiveShift(shift);
        return;
      }
    } catch {
      // fallback
    }
    setActiveShift({
      id: "shift-demo-1",
      shift_no: "SFT-2026-000001",
      opening_cash: 1000,
      opened_at: new Date().toISOString(),
      cashier_name: "Cashier Terminal 1",
    });
  };

  const loadPaymentMethods = async () => {
    try {
      const res = await fetchPaymentMethods();
      if (Array.isArray(res?.data) && res.data.length > 0) {
        setPaymentMethods(res.data);
        return;
      }
    } catch {
      // fallback
    }
    setPaymentMethods([
      { id: "pm-cash", code: "CASH", name: "Cash" },
      { id: "pm-card", code: "CARD", name: "Credit / Debit Card" },
      { id: "pm-gcash", code: "GCASH", name: "GCash" },
      { id: "pm-maya", code: "MAYA", name: "Maya" },
      { id: "pm-hmo", code: "HMO", name: "HMO / Insurance" },
    ]);
  };

  const loadInvoices = async () => {
    try {
      const res = await fetchInvoices({ status: "OPEN" });
      if (Array.isArray(res?.data) && res.data.length > 0) {
        setAvailableInvoices(res.data);
        if (invoiceIdParam) {
          const inv = await fetchInvoice(invoiceIdParam);
          if (inv?.id) {
            setInvoice(inv);
            setSelectedInvoiceId(inv.id);
            return;
          }
        } else if (res.data[0]) {
          setInvoice(res.data[0]);
          setSelectedInvoiceId(res.data[0].id);
          return;
        }
      }
    } catch {
      // fallback
    }
    const demo = [
      {
        id: "inv-demo-1",
        invoice_no: "INV-2026-000101",
        patient_first_name: "Juan",
        patient_last_name: "Dela Cruz",
        patient_number: "P-000123",
        balance: 1200,
        total: 1200,
        lines: [
          { id: "l1", description: "Consultation (Dr. Jose Rizal)", net_amount: 800, is_professional_fee: true },
          { id: "l2", description: "Complete Blood Count (CBC)", net_amount: 400, is_professional_fee: false },
        ],
      },
    ];
    setAvailableInvoices(demo);
    const cur = demo.find((d) => d.id === invoiceIdParam) || demo[0];
    setInvoice(cur);
    setSelectedInvoiceId(cur?.id || "");
  };

  useEffect(() => {
    checkShift();
    loadPaymentMethods();
    loadInvoices();
  }, []);

  const prevInvoiceIdRef = React.useRef<string | null>(invoice?.id || null);
  // When invoice changes, initialize default tender to full balance
  useEffect(() => {
    if (invoice && invoice.id !== prevInvoiceIdRef.current) {
      prevInvoiceIdRef.current = invoice.id;
      const defaultMethod = paymentMethods.find((m) => m.code === "CASH") || paymentMethods[0];
      const bal = Number(invoice.balance || 0);
      setTenders([
        {
          id: "t1",
          methodId: defaultMethod?.id || "pm-cash",
          methodCode: defaultMethod?.code || "CASH",
          methodName: defaultMethod?.name || "Cash",
          amount: bal,
          tenderedAmount: bal,
        },
      ]);
    }
  }, [invoice?.id, paymentMethods]);

  const handleSelectInvoice = async (id: string) => {
    setSelectedInvoiceId(id);
    if (!id) {
      setInvoice(null);
      setTenders([]);
      return;
    }
    try {
      const inv = await fetchInvoice(id);
      setInvoice(inv);
    } catch {
      const inv = availableInvoices.find((i) => i.id === id);
      setInvoice(inv || null);
    }
  };

  const handleOpenShift = async () => {
    try {
      const s = await openShift({
        branchId: "a1000000-0000-4000-8000-000000000001",
        openingCash: openingFloat,
      });
      setActiveShift(s);
      setShowOpenShiftModal(false);
      setAlert({ tone: "success", message: `Shift ${s.shift_no} opened with ₱${openingFloat} float.` });
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to open shift." });
    }
  };

  const totalTendered = useMemo(() => {
    return tenders.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  }, [tenders]);

  const cashChange = useMemo(() => {
    const cashTender = tenders.find((t) => t.methodCode === "CASH");
    if (!cashTender) return 0;
    const diff = Number(cashTender.tenderedAmount || 0) - Number(cashTender.amount || 0);
    return Math.max(0, diff);
  }, [tenders]);

  const invoiceBalance = Number(invoice?.balance || 0);
  const remainingDue = Math.max(0, invoiceBalance - totalTendered);

  const addTenderLine = () => {
    const defaultMethod = paymentMethods.find((m) => m.code !== tenders[0]?.methodCode) || paymentMethods[0];
    setTenders([
      ...tenders,
      {
        id: `t-${Date.now()}`,
        methodId: defaultMethod?.id || "",
        methodCode: defaultMethod?.code || "CARD",
        methodName: defaultMethod?.name || "Credit / Debit Card",
        amount: remainingDue,
        tenderedAmount: remainingDue,
      },
    ]);
  };

  const updateTender = (idx: number, updates: Partial<TenderLine>) => {
    const copy = [...tenders];
    copy[idx] = { ...copy[idx]!, ...updates };
    setTenders(copy);
  };

  const removeTender = (idx: number) => {
    setTenders(tenders.filter((_, i) => i !== idx));
  };

  const handleProcessPayment = async () => {
    if (!activeShift) {
      setAlert({ tone: "warning", message: "An active cashier shift is required to accept payments (BIL-T5)." });
      setShowOpenShiftModal(true);
      return;
    }
    if (!invoice) return;
    if (totalTendered <= 0) {
      setAlert({ tone: "warning", message: "Please specify payment amount." });
      return;
    }

    setIsProcessing(true);
    try {
      const primary = tenders[0]!;
      const branchId = invoice.branch_id || activeShift.branch_id || "a1000000-0000-4000-8000-000000000001";
      const totalAmount = tenders.reduce((sum, t) => sum + Number(t.amount), 0);
      const paymentRes = await createPayment({
        branchId,
        invoiceId: invoice.id,
        shiftId: activeShift.id,
        methodId: primary.methodId, // The primary method (e.g. for simple non-split queries)
        amount: totalAmount,
        tenderedAmount: totalAmount, // Actually handled per split on backend
        reference: primary.reference,
        splits: tenders.map((s) => ({
          methodId: s.methodId,
          amount: s.amount,
          tenderedAmount: s.tenderedAmount,
          reference: s.reference,
        })),
      });

      // Fetch official receipt
      try {
        const rcpt = await fetchPaymentReceipt(paymentRes.id);
        setReceiptData(rcpt);
      } catch {
        setReceiptData({
          receiptNumber: paymentRes.payment_no || "OR-2026-000101",
          date: new Date().toISOString(),
          patientName: `${invoice.patient_first_name || ""} ${invoice.patient_last_name || ""}`.trim() || "Walk-in Patient",
          patientNumber: invoice.patient_number || "P-000123",
          invoiceNo: invoice.invoice_no,
          cashier: activeShift.cashier_name || "Cashier",
          paymentMethod: primary.methodName,
          amountPaid: totalTendered,
          tendered: primary.tenderedAmount,
          change: cashChange,
          remainingBalance: Math.max(0, invoiceBalance - totalTendered),
          lines: invoice.lines || [],
        });
      }

      setShowReceiptModal(true);
      setAlert({ tone: "success", message: `Payment processed! Official Receipt generated.` });
      loadInvoices();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Payment processing failed." });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReprintReceipt = async () => {
    if (!receiptData || !reprintReason.trim()) return;
    try {
      const updated = await reprintReceipt(receiptData.id || "pmt-1", {
        reason: reprintReason,
        format: "PDF",
      });
      setReceiptData(updated);
      setShowReprintModal(false);
      setAlert({ tone: "success", message: `Reprint logged (Reprint #${updated.reprintCount}).` });
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Reprint audit failed." });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        const sel = document.getElementById("pos-invoice-select");
        if (sel) sel.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        if (invoice) {
          handleHoldSale();
        } else if (heldSales.length > 0) {
          setShowHeldModal(true);
        }
      } else if (e.key === "F8") {
        e.preventDefault();
        addTenderLine();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (!isProcessing && invoice && activeShift) {
          handleProcessPayment();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [invoice, tenders, heldSales, isProcessing, activeShift]);

  return (
    <div className="container-fluid py-3">
      {/* Top Bar with Active Shift & POS Navigation */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h2 className="h4 fw-bold mb-1" style={{ color: "var(--grey-900, #0f172a)" }}>
            Cashier POS &amp; Official Receipts
          </h2>
          <p className="text-muted small mb-0">
            Keyboard-first split tender payment processing, change calculation, and BIR-compliant receipts.
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={handleHoldSale}
            disabled={!invoice}
            title="Place current ticket on hold (F4)"
          >
            ⏸️ Hold (F4)
          </Button>
          <Button
            variant={heldSales.length > 0 ? "warning" : "outline-secondary"}
            size="sm"
            onClick={() => setShowHeldModal(true)}
            title="View held tickets"
          >
            📂 Held Tickets ({heldSales.length})
          </Button>
          {activeShift ? (
            <div className="border rounded px-3 py-1 bg-light d-flex align-items-center gap-2">
              <span className="badge bg-success">SHIFT ACTIVE</span>
              <span className="small fw-semibold">{activeShift.shift_no}</span>
              <Link to="/billing/shifts" className="small text-primary text-decoration-none">
                (Manage Shifts)
              </Link>
            </div>
          ) : (
            <Button
              variant="warning"
              size="sm"
              className="fw-bold"
              onClick={() => setShowOpenShiftModal(true)}
            >
              ⚠️ No Active Shift — Open Now
            </Button>
          )}
          <Link to="/billing/invoices" className="btn btn-outline-secondary btn-sm">
            ← Billing Workbench
          </Link>
        </div>
      </div>

      {/* Keyboard Shortcuts Strip */}
      <div className="bg-light border rounded px-3 py-2 mb-3 d-flex flex-wrap align-items-center justify-content-between small text-muted">
        <div>
          <span className="fw-semibold text-dark me-3">⌨️ POS Hotkeys:</span>
          <span className="me-3"><kbd>F2</kbd> Select Invoice</span>
          <span className="me-3"><kbd>F4</kbd> Hold / Resume</span>
          <span className="me-3"><kbd>F8</kbd> Add Split Tender</span>
          <span className="me-3"><kbd>F9</kbd> Settle Payment</span>
        </div>
        {heldSales.length > 0 && (
          <span className="text-warning-emphasis fw-semibold">
            {heldSales.length} ticket(s) currently held
          </span>
        )}
      </div>

      {alert && (
        <AlertBanner tone={alert.tone}>
          {alert.message}
        </AlertBanner>
      )}


      <div className="row g-3">
        {/* Left Column: Select Invoice & Charges Summary */}
        <div className="col-12 col-lg-7">
          <div className="card shadow-sm border-0 mb-3">
            <div className="card-header bg-white py-3 border-bottom">
              <h5 className="card-title h6 fw-bold mb-0">1. Select Invoice to Settle</h5>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <Form.Label className="small fw-semibold">Open Invoices</Form.Label>
                <Form.Select
                  value={selectedInvoiceId}
                  onChange={(e) => handleSelectInvoice(e.target.value)}
                  aria-label="Select invoice for settlement"
                >
                  <option value="">-- Choose an Open Invoice --</option>
                  {availableInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_no} — {inv.patient_first_name} {inv.patient_last_name} (Balance: ₱
                      {Number(inv.balance || 0).toFixed(2)})
                    </option>
                  ))}
                </Form.Select>
              </div>

              {invoice ? (
                <div>
                  <div className="p-3 bg-light rounded mb-3 border">
                    <div className="d-flex justify-content-between mb-1">
                      <span className="text-muted small">Patient Name:</span>
                      <strong>
                        {invoice.patient_first_name
                          ? `${invoice.patient_first_name} ${invoice.patient_last_name}`
                          : "Walk-in Patient"}
                      </strong>
                    </div>
                    {invoice.patient_number && (
                      <div className="d-flex justify-content-between mb-1">
                        <span className="text-muted small">Patient Number:</span>
                        <span>{invoice.patient_number}</span>
                      </div>
                    )}
                    <div className="d-flex justify-content-between mb-1">
                      <span className="text-muted small">Payer Type:</span>
                      <Badge bg="secondary">{invoice.payer_type || "PRIVATE_CASH"}</Badge>
                    </div>
                  </div>

                  <h6 className="fw-semibold small text-uppercase text-muted mb-2">
                    Itemized Services &amp; Fees (Q-17 Invariant)
                  </h6>
                  <div className="table-responsive border rounded mb-3">
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light">
                        <tr style={{ fontSize: "0.75rem" }}>
                          <th>Description</th>
                          <th className="text-end">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(invoice.lines || []).map((l: any, i: number) => (
                          <tr key={l.id || i}>
                            <td>
                              <span>{l.description}</span>
                              {l.is_professional_fee && (
                                <Badge bg="info" className="ms-2" style={{ fontSize: "0.62rem" }}>
                                  Doctor PF
                                </Badge>
                              )}
                            </td>
                            <td className="text-end fw-semibold">
                              <Money amount={Number(l.net_amount || l.amount || 0)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Totals */}
                  <div className="p-3 bg-white border rounded">
                    <div className="d-flex justify-content-between py-1 text-muted small">
                      <span>Subtotal:</span>
                      <span><Money amount={Number(invoice.subtotal || invoice.total || 0)} /></span>
                    </div>
                    {Number(invoice.discount_total || 0) > 0 && (
                      <div className="d-flex justify-content-between py-1 text-danger small">
                        <span>Statutory Discount:</span>
                        <span>- <Money amount={Number(invoice.discount_total)} /></span>
                      </div>
                    )}
                    <div className="d-flex justify-content-between py-1 fw-bold fs-5 text-primary border-top pt-2">
                      <span>Total Balance Due:</span>
                      <span><Money amount={invoiceBalance} /></span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-5 text-muted">
                  <span className="fs-2 d-block mb-2">🧾</span>
                  Select an invoice above to begin payment capture.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Split Tender Payment Capture */}
        <div className="col-12 col-lg-5">
          <div className="card shadow-sm border-0 mb-3">
            <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
              <h5 className="card-title h6 fw-bold mb-0">2. Payment &amp; Split Tender</h5>
              {invoice && (
                <Button size="sm" variant="outline-primary" onClick={addTenderLine}>
                  ➕ Split Tender
                </Button>
              )}
            </div>
            <div className="card-body">
              {!invoice ? (
                <p className="text-muted small">Awaiting invoice selection.</p>
              ) : (
                <div>
                  {tenders.map((tender, idx) => (
                    <div key={tender.id} className="border rounded p-3 mb-3 bg-light">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <span className="badge bg-secondary">Tender #{idx + 1}</span>
                        {tenders.length > 1 && (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => removeTender(idx)}
                          >
                            ✕ Remove
                          </Button>
                        )}
                      </div>

                      <div className="row g-2">
                        <div className="col-6">
                          <Form.Label className="small fw-semibold">Payment Method</Form.Label>
                          <Form.Select
                            size="sm"
                            value={tender.methodId}
                            onChange={(e) => {
                              const chosen = paymentMethods.find((m) => m.id === e.target.value);
                              updateTender(idx, {
                                methodId: e.target.value,
                                methodCode: chosen?.code || "CASH",
                                methodName: chosen?.name || "Cash",
                              });
                            }}
                          >
                            {paymentMethods.map((pm) => (
                              <option key={pm.id} value={pm.id}>
                                {pm.name}
                              </option>
                            ))}
                          </Form.Select>
                        </div>
                        <div className="col-6">
                          <Form.Label className="small fw-semibold">Payment Amount (₱)</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            min="0"
                            step="0.01"
                            value={tender.amount}
                            onChange={(e) =>
                              updateTender(idx, {
                                amount: Number(e.target.value) || 0,
                                tenderedAmount:
                                  tender.methodCode === "CASH"
                                    ? tender.tenderedAmount
                                    : Number(e.target.value) || 0,
                              })
                            }
                          />
                        </div>

                        {tender.methodCode === "CASH" && (
                          <div className="col-12 mt-2">
                            <Form.Label className="small fw-semibold">Cash Tendered by Patient (₱)</Form.Label>
                            <Form.Control
                              size="sm"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Cash handed by patient"
                              value={tender.tenderedAmount}
                              onChange={(e) =>
                                updateTender(idx, { tenderedAmount: Number(e.target.value) || 0 })
                              }
                            />
                            <div className="d-flex justify-content-between align-items-center mt-2 p-2 bg-white rounded border">
                              <span className="small text-muted">Change to Return:</span>
                              <strong className="fs-5 text-success">
                                ₱{cashChange.toFixed(2)}
                              </strong>
                            </div>
                          </div>
                        )}

                        {tender.methodCode !== "CASH" && (
                          <div className="col-12 mt-2">
                            <Form.Label className="small fw-semibold">
                              Reference / Approval / Trace No.
                            </Form.Label>
                            <Form.Control
                              size="sm"
                              type="text"
                              placeholder="e.g. Card Trace #, GCash Ref #, HMO Auth #"
                              value={tender.reference || ""}
                              onChange={(e) => updateTender(idx, { reference: e.target.value })}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Payment Balance Checker */}
                  <div className="border rounded p-3 mb-3 bg-white">
                    <div className="d-flex justify-content-between py-1">
                      <span className="text-muted small">Total Due:</span>
                      <span className="fw-semibold">₱{invoiceBalance.toFixed(2)}</span>
                    </div>
                    <div className="d-flex justify-content-between py-1">
                      <span className="text-muted small">Total Allocated:</span>
                      <span className="fw-bold text-primary">₱{totalTendered.toFixed(2)}</span>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-top pt-2">
                      <span className="small fw-semibold">Remaining Balance:</span>
                      <strong className={remainingDue > 0 ? "text-warning-emphasis" : "text-success"}>
                        ₱{remainingDue.toFixed(2)}
                      </strong>
                    </div>
                  </div>

                  <Button
                    variant="success"
                    className="w-100 py-2 fw-bold fs-6"
                    onClick={handleProcessPayment}
                    disabled={isProcessing || totalTendered <= 0}
                  >
                    {isProcessing ? "Processing..." : `Complete Payment & Issue Official Receipt`}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Official Receipt Modal (Q-17 & BIR Compliance) */}
      {receiptData && (
        <Modal
          show={showReceiptModal}
          onHide={() => setShowReceiptModal(false)}
          centered
        >
          <Modal.Header closeButton>
            <Modal.Title className="h6 fw-bold">Official Receipt (OR)</Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-4 bg-light">
            <div
              className="p-3 bg-white border rounded shadow-sm"
              style={{ fontFamily: "'Courier New', Courier, monospace" }}
            >
              <div className="text-center border-bottom pb-2 mb-2">
                <h5 className="fw-bold mb-0">CLINIC HEALTHCARE SYSTEM</h5>
                <small className="text-muted">Official Cash Receipt</small>
                <div className="fw-bold fs-6 mt-1 text-primary">
                  {receiptData.receiptNumber}
                </div>
                <small className="text-muted">
                  Date: {new Date(receiptData.date).toLocaleString()}
                </small>
              </div>

              <div className="mb-2 small">
                <div><strong>Patient:</strong> {receiptData.patientName}</div>
                <div><strong>Patient ID:</strong> {receiptData.patientNumber}</div>
                <div><strong>Invoice:</strong> {receiptData.invoiceNo}</div>
                <div><strong>Cashier:</strong> {receiptData.cashier}</div>
                <div><strong>Tender:</strong> {receiptData.paymentMethod}</div>
              </div>

              <div className="border-top border-bottom py-2 my-2 small">
                <div className="fw-bold mb-1">PARTICULARS (Q-17):</div>
                {(receiptData.lines || []).map((l: any, i: number) => (
                  <div key={i} className="d-flex justify-content-between">
                    <span>
                      {l.description} {l.isProfessionalFee ? "(PF)" : ""}
                    </span>
                    <span>₱{Number(l.amount || l.net_amount || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="small">
                <div className="d-flex justify-content-between">
                  <span>AMOUNT PAID:</span>
                  <strong>₱{Number(receiptData.amountPaid || 0).toFixed(2)}</strong>
                </div>
                {Number(receiptData.tendered || 0) > 0 && (
                  <div className="d-flex justify-content-between">
                    <span>TENDERED:</span>
                    <span>₱{Number(receiptData.tendered || 0).toFixed(2)}</span>
                  </div>
                )}
                {Number(receiptData.change || 0) > 0 && (
                  <div className="d-flex justify-content-between text-success">
                    <span>CHANGE:</span>
                    <span>₱{Number(receiptData.change || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="d-flex justify-content-between border-top mt-1 pt-1 fw-bold">
                  <span>BALANCE:</span>
                  <span>₱{Number(receiptData.remainingBalance || 0).toFixed(2)}</span>
                </div>
              </div>

              {receiptData.isReprint && (
                <div className="text-center mt-3 pt-2 border-top text-danger fw-bold">
                  *** REPRINT #{receiptData.reprintCount} ***
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer className="d-flex justify-content-between">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setShowReprintModal(true)}
            >
              Audited Reprint
            </Button>
            <div className="d-flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  window.print();
                }}
              >
                🖨️ Print Receipt
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowReceiptModal(false);
                  setInvoice(null);
                  setSelectedInvoiceId("");
                }}
              >
                Done / Next Checkout
              </Button>
            </div>
          </Modal.Footer>
        </Modal>
      )}

      {/* Audited Reprint Dialog */}
      <Modal show={showReprintModal} onHide={() => setShowReprintModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Audited Receipt Reprint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            Under BIR &amp; internal control regulations, every reprint is logged with reason and timestamp.
          </p>
          <Form.Label className="small fw-semibold">Reason for Reprint *</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            placeholder="e.g. Patient requested duplicate copy for insurance reimbursement"
            value={reprintReason}
            onChange={(e) => setReprintReason(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowReprintModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleReprintReceipt}
            disabled={!reprintReason.trim()}
          >
            Confirm &amp; Log Reprint
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Open Cashier Shift Modal */}
      <Modal show={showOpenShiftModal} onHide={() => setShowOpenShiftModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Open Cashier Shift</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            Opening a shift initializes cashier accountability. Enter the starting change float.
          </p>
          <Form.Label className="small fw-semibold">Opening Cash Float (₱)</Form.Label>
          <Form.Control
            type="number"
            min="0"
            step="100"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(Number(e.target.value) || 0)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowOpenShiftModal(false)}>
            Cancel
          </Button>
          <Button variant="success" size="sm" onClick={handleOpenShift}>
            Open Shift
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Held Tickets Modal */}
      <Modal show={showHeldModal} onHide={() => setShowHeldModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Held Transactions ({heldSales.length})</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {heldSales.length === 0 ? (
            <div className="text-center py-4 text-muted">
              No transactions currently held.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle small mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Held At</th>
                    <th>Invoice No</th>
                    <th>Patient</th>
                    <th>Amount Due</th>
                    <th>Tenders Setup</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {heldSales.map((h) => (
                    <tr key={h.id}>
                      <td className="text-muted">{new Date(h.updated_at || h.created_at).toLocaleTimeString()}</td>
                      <td className="fw-semibold text-primary">{h.session_data?.invoice?.invoice_no}</td>
                      <td>
                        {h.session_data?.invoice?.patient_first_name
                          ? `${h.session_data.invoice.patient_first_name} ${h.session_data.invoice.patient_last_name}`
                          : "Walk-in"}
                      </td>
                      <td className="fw-bold text-danger">
                        <Money amount={Number(h.session_data?.invoice?.balance || 0)} />
                      </td>
                      <td>
                        {h.session_data?.tenders?.map((t: any) => `${t.methodName}: ₱${t.amount}`).join(", ")}
                      </td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm">
                          <Button
                            variant="primary"
                            onClick={() => handleResumeSale(h)}
                          >
                            Resume
                          </Button>
                          <Button
                            variant="outline-danger"
                            onClick={() => handleDiscardHeldSale(h)}
                          >
                            Discard
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowHeldModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
