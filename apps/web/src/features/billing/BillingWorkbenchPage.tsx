import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
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
  createInvoice,
  voidInvoice,
  applyDiscount,
  revokeDiscount,
  fetchDiscountTypes,
  fetchPatientStatement,
} from "./api.js";

export function BillingWorkbenchPage() {
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementData, setStatementData] = useState<any | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [invoices, setInvoices] = useState<any[]>([
    {
      id: "inv-demo-1",
      invoice_no: "INV-2026-000101",
      patient_first_name: "Juan",
      patient_last_name: "Dela Cruz",
      patient_number: "P-000123",
      payer_type: "PRIVATE_CASH",
      status: "OPEN",
      subtotal: 1500,
      discount_total: 300,
      total: 1200,
      paid_amount: 0,
      balance: 1200,
      issued_at: new Date().toISOString(),
      lines: [
        {
          id: "l1",
          description: "Consultation (Dr. Jose Rizal)",
          qty: 1,
          unit_price: 1000,
          net_amount: 800,
          is_professional_fee: true,
        },
        {
          id: "l2",
          description: "Complete Blood Count (CBC)",
          qty: 1,
          unit_price: 500,
          net_amount: 400,
          is_professional_fee: false,
        },
      ],
      discounts: [
        {
          id: "d1",
          discount_code: "SENIOR",
          discount_name: "Senior Citizen (RA 9994)",
          percentage: 20,
          amount: 300,
          id_type: "OSCA_ID",
          id_number: "OSCA-MNL-2019-994",
        },
      ],
    },
    {
      id: "inv-demo-2",
      invoice_no: "INV-2026-000102",
      patient_first_name: "Maria",
      patient_last_name: "Clara",
      patient_number: "P-000124",
      payer_type: "HMO",
      status: "PAID",
      subtotal: 2500,
      discount_total: 0,
      total: 2500,
      paid_amount: 2500,
      balance: 0,
      issued_at: new Date().toISOString(),
      lines: [
        {
          id: "l3",
          description: "Cardiology Specialist Evaluation",
          qty: 1,
          unit_price: 2500,
          net_amount: 2500,
          is_professional_fee: true,
        },
      ],
      discounts: [],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [alert, setAlert] = useState<{ tone: "success" | "danger" | "warning"; message: string } | null>(null);

  // Selected Invoice for Detail Modal
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // New Invoice Modal
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);
  const [newInvoicePatientId, setNewInvoicePatientId] = useState("");
  const [newInvoicePayerType, setNewInvoicePayerType] = useState("PRIVATE_CASH");
  const [newInvoiceLines, setNewInvoiceLines] = useState<
    Array<{ description: string; qty: number; unitPrice: number; isProfessionalFee: boolean }>
  >([{ description: "General Consultation", qty: 1, unitPrice: 500, isProfessionalFee: true }]);

  // Apply Discount Modal
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountTypes, setDiscountTypes] = useState<any[]>([
    {
      id: "disc-senior",
      code: "SENIOR",
      name: "Senior Citizen Discount (20%)",
      percentage: 20,
      requires_id: true,
      legal_basis: "RA 9994 Expanded Senior Citizens Act of 2010",
    },
    {
      id: "disc-pwd",
      code: "PWD",
      name: "Persons with Disability (20%)",
      percentage: 20,
      requires_id: true,
      legal_basis: "RA 10754 Act Expanding Benefits of PWDs",
    },
    {
      id: "disc-employee",
      code: "EMPLOYEE",
      name: "Employee Welfare (50%)",
      percentage: 50,
      requires_id: true,
      legal_basis: "Clinic Staff Health Benefit",
    },
  ]);
  const [selectedDiscountTypeId, setSelectedDiscountTypeId] = useState("");
  const [discountIdType, setDiscountIdType] = useState("");
  const [discountIdNumber, setDiscountIdNumber] = useState("");

  // Void Modal
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchInvoices({
        status: statusFilter === "ALL" ? undefined : statusFilter,
      });
      if (Array.isArray(res?.data)) {
        setInvoices(res.data);
      }
    } catch {
      // keep current demo/fallback invoices
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchDiscountTypes()
      .then((res) => {
        if (Array.isArray(res?.data)) setDiscountTypes(res.data);
      })
      .catch(() => {});
  }, [statusFilter]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = searchQuery.toLowerCase();
      const numMatch = inv.invoice_no?.toLowerCase().includes(q);
      const nameMatch = `${inv.patient_first_name || ""} ${inv.patient_last_name || ""}`.toLowerCase().includes(q);
      return !q || numMatch || nameMatch;
    });
  }, [invoices, searchQuery]);

  const summary = useMemo(() => {
    const totalInvoiced = invoices.reduce((acc, i) => acc + Number(i.total || 0), 0);
    const totalBalance = invoices.reduce((acc, i) => acc + Number(i.balance || 0), 0);
    const totalPaid = invoices.reduce((acc, i) => acc + Number(i.paid_amount || 0), 0);
    const openCount = invoices.filter((i) => i.status === "OPEN" || i.status === "PARTIAL").length;
    return { totalInvoiced, totalBalance, totalPaid, openCount };
  }, [invoices]);

  const handleCreateInvoice = async () => {
    try {
      await createInvoice({
        branchId: "a1000000-0000-4000-8000-000000000001",
        payerType: newInvoicePayerType as any,
        lines: newInvoiceLines,
      });
      setAlert({ tone: "success", message: "Invoice successfully created." });
      setShowNewInvoiceModal(false);
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to create invoice." });
    }
  };

  const handleApplyDiscount = async () => {
    if (!selectedInvoice || !selectedDiscountTypeId) return;
    const dt = discountTypes.find((d) => d.id === selectedDiscountTypeId);
    if (dt?.requires_id && (!discountIdType || !discountIdNumber)) {
      setAlert({ tone: "warning", message: "ID Type and ID Number are mandatory for this statutory discount (RA 9994 / RA 10754)." });
      return;
    }

    try {
      await applyDiscount(selectedInvoice.id, {
        discountTypeId: selectedDiscountTypeId,
        idType: discountIdType || undefined,
        idNumber: discountIdNumber || undefined,
      });
      setAlert({ tone: "success", message: "Statutory discount applied and invoice balance updated." });
      setShowDiscountModal(false);
      const updated = await fetchInvoice(selectedInvoice.id);
      setSelectedInvoice(updated);
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to apply discount." });
    }
  };

  const handleRevokeDiscount = async (discountAppId: string) => {
    if (!selectedInvoice) return;
    try {
      await revokeDiscount(selectedInvoice.id, discountAppId);
      setAlert({ tone: "success", message: "Discount revoked." });
      const updated = await fetchInvoice(selectedInvoice.id);
      setSelectedInvoice(updated);
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to revoke discount." });
    }
  };

  const handleVoidInvoice = async () => {
    if (!selectedInvoice || !voidReason) return;
    try {
      await voidInvoice(selectedInvoice.id, voidReason);
      setAlert({ tone: "success", message: `Invoice ${selectedInvoice.invoice_no} has been voided.` });
      setShowVoidModal(false);
      setShowDetailModal(false);
      loadData();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to void invoice." });
    }
  };

  const handleOpenStatement = async (patientId?: string, fallbackPatientName?: string) => {
    setShowStatementModal(true);
    setStatementLoading(true);
    if (patientId) {
      try {
        const res = await fetchPatientStatement(patientId);
        if (res?.patient) {
          setStatementData(res);
          setStatementLoading(false);
          return;
        }
      } catch {
        // fallback
      }
    }
    const name = fallbackPatientName || "Juan Dela Cruz";
    const patientInvoices = invoices.filter(
      (i) => `${i.patient_first_name || ""} ${i.patient_last_name || ""}`.trim() === name.trim() || !patientId,
    );
    const totalBilled = patientInvoices.reduce((a, b) => a + Number(b.total || 0), 0);
    const totalPaid = patientInvoices.reduce((a, b) => a + Number(b.paid_amount || 0), 0);
    const totalBalance = patientInvoices.reduce((a, b) => a + Number(b.balance || 0), 0);

    setStatementData({
      patient: {
        id: patientId || "p-demo-1",
        name,
        patientNumber: "P-000123",
        dateOfBirth: "1980-06-19",
        sex: "MALE",
        phone: "+63 917 123 4567",
        email: "juan.delacruz@example.ph",
      },
      asOfDate: new Date().toISOString(),
      totalBilled,
      totalPaid,
      totalBalance,
      aging: {
        current_0_30: totalBalance,
        days_31_60: 0,
        days_61_90: 0,
        over_90: 0,
      },
      invoices: patientInvoices,
    });
    setStatementLoading(false);
  };

  const selectedDiscountTypeObj = discountTypes.find((d) => d.id === selectedDiscountTypeId);

  return (
    <div className="container-fluid py-3">
      {/* Page Title & Actions */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h2 className="h4 fw-bold mb-1" style={{ color: "var(--grey-900, #0f172a)" }}>
            Billing Workbench &amp; Invoices
          </h2>
          <p className="text-muted small mb-0">
            Phase 7: Invoice lifecycle, statutory discounts (RA 9994/10754), charge capture, and official receipts.
          </p>
        </div>
        <div className="d-flex gap-2">

          <Link to="/billing/pos" className="btn btn-outline-primary btn-sm fw-semibold">
            🛒 Open Cashier POS
          </Link>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setNewInvoiceLines([{ description: "General Consultation", qty: 1, unitPrice: 500, isProfessionalFee: true }]);
              setShowNewInvoiceModal(true);
            }}
          >
            ➕ New Invoice
          </Button>
        </div>
      </div>


      {alert && (
        <AlertBanner tone={alert.tone}>
          {alert.message}
        </AlertBanner>
      )}

      {/* KPI Overview Cards */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-xl-3">
          <div className="card shadow-sm border-0 h-100 p-3" style={{ background: "linear-gradient(135deg, #f8fafc, #edf2f7)" }}>
            <span className="text-muted small fw-medium text-uppercase">Total Invoiced</span>
            <div className="h4 fw-bold mb-0 text-primary">
              <Money amount={summary.totalInvoiced} />
            </div>
            <small className="text-muted mt-1">{invoices.length} active invoices</small>
          </div>
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <div className="card shadow-sm border-0 h-100 p-3" style={{ background: "linear-gradient(135deg, #fff7ed, #ffedd5)" }}>
            <span className="text-warning-emphasis small fw-medium text-uppercase">Outstanding Receivables</span>
            <div className="h4 fw-bold mb-0 text-warning-emphasis">
              <Money amount={summary.totalBalance} />
            </div>
            <small className="text-muted mt-1">{summary.openCount} unpaid / partial</small>
          </div>
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <div className="card shadow-sm border-0 h-100 p-3" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)" }}>
            <span className="text-success small fw-medium text-uppercase">Collected Revenue</span>
            <div className="h4 fw-bold mb-0 text-success">
              <Money amount={summary.totalPaid} />
            </div>
            <small className="text-muted mt-1">Confirmed payments</small>
          </div>
        </div>
        <div className="col-12 col-sm-6 col-xl-3">
          <div className="card shadow-sm border-0 h-100 p-3" style={{ background: "linear-gradient(135deg, #eff6ff, #dbeafe)" }}>
            <span className="text-info small fw-medium text-uppercase">Collection Status</span>
            <div className="h4 fw-bold mb-0 text-info">
              {summary.totalInvoiced > 0
                ? `${Math.round((summary.totalPaid / summary.totalInvoiced) * 100)}%`
                : "100%"}
            </div>
            <small className="text-muted mt-1">Settlement rate</small>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card shadow-sm border-0 mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-12 col-md-5">
            <Form.Control
              type="search"
              placeholder="Search by Invoice No (INV-...) or Patient Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search invoices"
            />
          </div>
          <div className="col-12 col-md-7 d-flex justify-content-md-end gap-1 flex-wrap">
            {["ALL", "OPEN", "PARTIAL", "PAID", "VOID"].map((st) => (
              <Button
                key={st}
                size="sm"
                variant={statusFilter === st ? "primary" : "outline-secondary"}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="card shadow-sm border-0">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th>Invoice No</th>
                <th>Patient</th>
                <th>Payer Type</th>
                <th>Subtotal</th>
                <th>Discount</th>
                <th>Total</th>
                <th>Balance Due</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    Loading invoices...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    No invoices match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <span className="fw-semibold text-primary">{inv.invoice_no}</span>
                      <div className="text-muted small">
                        {new Date(inv.issued_at || inv.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td>
                      <div className="fw-medium">
                        {inv.patient_first_name
                          ? `${inv.patient_first_name} ${inv.patient_last_name}`
                          : "Walk-in Patient"}
                      </div>
                      {inv.patient_number && (
                        <div className="text-muted small">{inv.patient_number}</div>
                      )}
                    </td>
                    <td>
                      <Badge bg="secondary" style={{ fontSize: "0.72rem" }}>
                        {inv.payer_type || "PRIVATE_CASH"}
                      </Badge>
                    </td>
                    <td>
                      <Money amount={Number(inv.subtotal || 0)} />
                    </td>
                    <td className="text-danger">
                      {Number(inv.discount_total) > 0 ? (
                        <span>- <Money amount={Number(inv.discount_total)} /></span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="fw-semibold">
                      <Money amount={Number(inv.total || 0)} />
                    </td>
                    <td className="fw-bold">
                      {Number(inv.balance) > 0 ? (
                        <span className="text-warning-emphasis">
                          <Money amount={Number(inv.balance)} />
                        </span>
                      ) : (
                        <span className="text-success">₱0.00</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        label={inv.status}
                        tone={
                          inv.status === "PAID"
                            ? "normal"
                            : inv.status === "PARTIAL" || inv.status === "OPEN"
                            ? "pending"
                            : inv.status === "VOID"
                            ? "critical"
                            : "neutral"
                        }
                      />
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <Button
                          variant="outline-secondary"
                          onClick={async () => {
                            try {
                              const detailed = await fetchInvoice(inv.id);
                              if (detailed?.id && detailed?.invoice_no) {
                                setSelectedInvoice(detailed);
                              } else {
                                setSelectedInvoice(inv);
                              }
                            } catch {
                              setSelectedInvoice(inv);
                            }
                            setShowDetailModal(true);
                          }}
                        >
                          Details
                        </Button>
                        <Button
                          variant="outline-secondary"
                          onClick={() =>
                            handleOpenStatement(
                              inv.patient_id,
                              `${inv.patient_first_name || ""} ${inv.patient_last_name || ""}`.trim(),
                            )
                          }
                        >
                          SOA
                        </Button>
                        {inv.status !== "PAID" && inv.status !== "VOID" && (
                          <Link
                            to={`/billing/pos?invoiceId=${inv.id}`}
                            className="btn btn-outline-success"
                          >
                            Pay
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <Modal
          show={showDetailModal}
          onHide={() => setShowDetailModal(false)}
          size="lg"
          centered
        >
          <Modal.Header closeButton>
            <Modal.Title className="h5 fw-bold">
              Invoice #{selectedInvoice.invoice_no}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="row g-2 mb-3">
              <div className="col-sm-6">
                <span className="text-muted small d-block">Patient</span>
                <strong>
                  {selectedInvoice.patient_first_name
                    ? `${selectedInvoice.patient_first_name} ${selectedInvoice.patient_last_name}`
                    : "Walk-in Patient"}
                </strong>
                {selectedInvoice.patient_number && (
                  <span className="text-muted small d-block">
                    ID: {selectedInvoice.patient_number}
                  </span>
                )}
              </div>
              <div className="col-sm-6 text-sm-end">
                <span className="text-muted small d-block">Current Status</span>
                <StatusPill
                  label={selectedInvoice.status}
                  tone={
                    selectedInvoice.status === "PAID"
                      ? "normal"
                      : selectedInvoice.status === "PARTIAL" || selectedInvoice.status === "OPEN"
                      ? "pending"
                      : selectedInvoice.status === "VOID"
                      ? "critical"
                      : "neutral"
                  }
                />
              </div>
            </div>

            {/* Line Items Table (Q-17 Invariant) */}
            <h6 className="fw-semibold mt-3 mb-2">Itemized Charges &amp; Services</h6>
            <div className="table-responsive border rounded mb-3">
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light">
                  <tr style={{ fontSize: "0.75rem" }}>
                    <th>Description</th>
                    <th>Type</th>
                    <th className="text-center">Qty</th>
                    <th className="text-end">Unit Price</th>
                    <th className="text-end">Net Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedInvoice.lines || []).map((l: any, idx: number) => (
                    <tr key={l.id || idx}>
                      <td>
                        <span className="fw-medium">{l.description}</span>
                        {l.is_professional_fee && (
                          <Badge bg="info" className="ms-2" style={{ fontSize: "0.65rem" }}>
                            Professional Fee (Q-17)
                          </Badge>
                        )}
                      </td>
                      <td>
                        <small className="text-muted">{l.source_type || "MANUAL"}</small>
                      </td>
                      <td className="text-center">{l.qty}</td>
                      <td className="text-end">
                        <Money amount={Number(l.unit_price)} />
                      </td>
                      <td className="text-end fw-semibold">
                        <Money amount={Number(l.net_amount)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Statutory Discounts Applied */}
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-semibold mb-0">Applied Discounts (RA 9994 / RA 10754)</h6>
              {selectedInvoice.status !== "PAID" && selectedInvoice.status !== "VOID" && (
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={() => setShowDiscountModal(true)}
                >
                  ➕ Apply Discount
                </Button>
              )}
            </div>
            {selectedInvoice.discounts && selectedInvoice.discounts.length > 0 ? (
              <div className="border rounded p-2 mb-3 bg-light">
                {selectedInvoice.discounts.map((d: any) => (
                  <div
                    key={d.id}
                    className="d-flex justify-content-between align-items-center py-1 border-bottom last-border-0"
                  >
                    <div>
                      <strong className="text-danger me-2">
                        {d.discount_name || d.discount_code} ({d.percentage}%)
                      </strong>
                      <small className="text-muted d-block">
                        ID: {d.id_type || "N/A"} - {d.id_number || "N/A"}
                      </small>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-danger fw-semibold">
                        - <Money amount={Number(d.amount)} />
                      </span>
                      {selectedInvoice.status !== "PAID" && selectedInvoice.status !== "VOID" && (
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={() => handleRevokeDiscount(d.id)}
                          title="Revoke discount"
                        >
                          ✕
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted small mb-3">No discounts applied to this invoice.</p>
            )}

            {/* Financial Totals Summary */}
            <div className="border rounded p-3 bg-white">
              <div className="d-flex justify-content-between py-1">
                <span className="text-muted">Subtotal:</span>
                <span><Money amount={Number(selectedInvoice.subtotal || 0)} /></span>
              </div>
              <div className="d-flex justify-content-between py-1 text-danger">
                <span>Discounts:</span>
                <span>- <Money amount={Number(selectedInvoice.discount_total || 0)} /></span>
              </div>
              <div className="d-flex justify-content-between py-1 fw-bold border-top pt-2">
                <span>Total Amount:</span>
                <span className="text-primary"><Money amount={Number(selectedInvoice.total || 0)} /></span>
              </div>
              <div className="d-flex justify-content-between py-1 text-success">
                <span>Amount Paid:</span>
                <span><Money amount={Number(selectedInvoice.paid_amount || 0)} /></span>
              </div>
              <div className="d-flex justify-content-between py-1 fw-bold fs-5 text-warning-emphasis border-top pt-2">
                <span>Balance Due:</span>
                <span><Money amount={Number(selectedInvoice.balance || 0)} /></span>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer className="d-flex justify-content-between">
            <div>
              {selectedInvoice.status !== "PAID" && selectedInvoice.status !== "VOID" && (
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => setShowVoidModal(true)}
                >
                  Void Invoice
                </Button>
              )}
            </div>
            <div className="d-flex gap-2">
              {selectedInvoice.status !== "PAID" && selectedInvoice.status !== "VOID" && (
                <Link
                  to={`/billing/pos?invoiceId=${selectedInvoice.id}`}
                  className="btn btn-success btn-sm"
                  onClick={() => setShowDetailModal(false)}
                >
                  Proceed to Cashier POS
                </Link>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowDetailModal(false)}>
                Close
              </Button>
            </div>
          </Modal.Footer>
        </Modal>
      )}

      {/* Apply Discount Modal */}
      <Modal show={showDiscountModal} onHide={() => setShowDiscountModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Apply Statutory Discount</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <Form.Label htmlFor="discount-program-select" className="small fw-semibold">Discount Program</Form.Label>
            <Form.Select
              id="discount-program-select"
              aria-label="Discount Program"
              value={selectedDiscountTypeId}
              onChange={(e) => setSelectedDiscountTypeId(e.target.value)}
            >
              <option value="">-- Select Discount Type --</option>
              {discountTypes.map((dt) => (
                <option key={dt.id} value={dt.id}>
                  {dt.name} ({dt.percentage}%) {dt.requires_id ? "— Requires Valid ID" : ""}
                </option>
              ))}
            </Form.Select>
            {selectedDiscountTypeObj?.legal_basis && (
              <small className="text-info d-block mt-1">
                Legal Basis: {selectedDiscountTypeObj.legal_basis}
              </small>
            )}
          </div>

          {selectedDiscountTypeObj?.requires_id && (
            <div className="border rounded p-3 bg-light mb-3">
              <span className="badge bg-warning text-dark mb-2">
                Mandatory ID Verification (RA 9994 / RA 10754)
              </span>
              <div className="mb-2">
                <Form.Label className="small fw-semibold">ID Type *</Form.Label>
                <Form.Select
                  value={discountIdType}
                  onChange={(e) => setDiscountIdType(e.target.value)}
                >
                  <option value="">-- Select ID Type --</option>
                  <option value="OSCA_ID">Senior Citizen OSCA ID</option>
                  <option value="PWD_ID">Persons with Disability (PWD) ID</option>
                  <option value="EMPLOYEE_ID">Clinic Employee ID</option>
                  <option value="PASSPORT">Philippine Passport (60+ yrs)</option>
                  <option value="OTHER_GOVT_ID">Other Government Issued ID</option>
                </Form.Select>
              </div>
              <div>
                <Form.Label className="small fw-semibold">ID / Card Number *</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., OSCA-MNL-2024-884"
                  value={discountIdNumber}
                  onChange={(e) => setDiscountIdNumber(e.target.value)}
                />
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowDiscountModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApplyDiscount}
            disabled={!selectedDiscountTypeId}
          >
            Apply Discount
          </Button>
        </Modal.Footer>
      </Modal>

      {/* New Invoice Modal */}
      <Modal
        show={showNewInvoiceModal}
        onHide={() => setShowNewInvoiceModal(false)}
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 fw-bold">Create New Invoice</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="row g-3 mb-3">
            <div className="col-sm-6">
              <Form.Label className="small fw-semibold">Payer Type</Form.Label>
              <Form.Select
                value={newInvoicePayerType}
                onChange={(e) => setNewInvoicePayerType(e.target.value)}
              >
                <option value="PRIVATE_CASH">Private / Out-of-Pocket Cash</option>
                <option value="HMO">HMO / Private Insurance</option>
                <option value="PHILHEALTH">PhilHealth Konsulta</option>
                <option value="CORPORATE">Corporate Retainer Account</option>
              </Form.Select>
            </div>
          </div>

          <h6 className="fw-semibold mb-2">Itemized Charges</h6>
          {newInvoiceLines.map((line, idx) => (
            <div key={idx} className="row g-2 align-items-center mb-2">
              <div className="col-5">
                <Form.Control
                  size="sm"
                  placeholder="Service / Item Description"
                  value={line.description}
                  onChange={(e) => {
                    const copy = [...newInvoiceLines];
                    copy[idx]!.description = e.target.value;
                    setNewInvoiceLines(copy);
                  }}
                />
              </div>
              <div className="col-2">
                <Form.Control
                  size="sm"
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => {
                    const copy = [...newInvoiceLines];
                    copy[idx]!.qty = Number(e.target.value) || 1;
                    setNewInvoiceLines(copy);
                  }}
                />
              </div>
              <div className="col-3">
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="Unit Price"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const copy = [...newInvoiceLines];
                    copy[idx]!.unitPrice = Number(e.target.value) || 0;
                    setNewInvoiceLines(copy);
                  }}
                />
              </div>
              <div className="col-2 d-flex align-items-center gap-1">
                <Form.Check
                  type="checkbox"
                  id={`pf-${idx}`}
                  label="PF"
                  title="Professional Fee"
                  checked={line.isProfessionalFee}
                  onChange={(e) => {
                    const copy = [...newInvoiceLines];
                    copy[idx]!.isProfessionalFee = e.target.checked;
                    setNewInvoiceLines(copy);
                  }}
                />
                {newInvoiceLines.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => setNewInvoiceLines(newInvoiceLines.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </Button>
                )}
              </div>
            </div>
          ))}

          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() =>
              setNewInvoiceLines([
                ...newInvoiceLines,
                { description: "", qty: 1, unitPrice: 0, isProfessionalFee: false },
              ])
            }
          >
            ➕ Add Line
          </Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowNewInvoiceModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreateInvoice}>
            Create Invoice
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Void Modal */}
      <Modal show={showVoidModal} onHide={() => setShowVoidModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold text-danger">Void Invoice Confirmation</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            Voiding an invoice cancels remaining balances and releases consumed visit charges. A mandatory reason is required.
          </p>
          <Form.Label className="small fw-semibold">Reason for Voiding *</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            placeholder="e.g., Billing error in consultation fee; re-issuing correct itemization"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowVoidModal(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleVoidInvoice}
            disabled={!voidReason.trim()}
          >
            Confirm Void
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Statement of Account (SOA) Modal */}
      <Modal
        show={showStatementModal}
        onHide={() => setShowStatementModal(false)}
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 fw-bold">
            Patient Statement of Account (SOA)
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {statementLoading ? (
            <div className="text-center py-4 text-muted">
              Generating Statement of Account...
            </div>
          ) : statementData ? (
            <div>
              {/* Header */}
              <div className="border-bottom pb-3 mb-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h5 className="fw-bold mb-1">{statementData.patient?.name}</h5>
                    <div className="text-muted small">
                      Patient No: <strong>{statementData.patient?.patientNumber}</strong> · DOB: {statementData.patient?.dateOfBirth || "—"} · Phone: {statementData.patient?.phone || "—"}
                    </div>
                  </div>
                  <div className="text-end">
                    <span className="badge bg-secondary text-uppercase">Statement of Account</span>
                    <div className="text-muted small mt-1">
                      As of {new Date(statementData.asOfDate).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary KPIs */}
              <div className="row g-2 mb-3">
                <div className="col-4">
                  <div className="p-2 border rounded bg-light">
                    <span className="text-muted small d-block">Total Billed</span>
                    <strong className="fs-6 text-primary"><Money amount={statementData.totalBilled} /></strong>
                  </div>
                </div>
                <div className="col-4">
                  <div className="p-2 border rounded bg-light">
                    <span className="text-muted small d-block">Total Payments</span>
                    <strong className="fs-6 text-success"><Money amount={statementData.totalPaid} /></strong>
                  </div>
                </div>
                <div className="col-4">
                  <div className="p-2 border rounded bg-light">
                    <span className="text-muted small d-block">Net Balance Due</span>
                    <strong className="fs-6 text-danger"><Money amount={statementData.totalBalance} /></strong>
                  </div>
                </div>
              </div>

              {/* Aging Breakdown */}
              <div className="card border-0 bg-light p-2 mb-3">
                <span className="small fw-semibold text-muted text-uppercase mb-1">Aging Schedule</span>
                <div className="row g-2 text-center small">
                  <div className="col-3">
                    <span className="d-block text-muted">0–30 Days</span>
                    <strong className="text-dark"><Money amount={statementData.aging?.current_0_30 || 0} /></strong>
                  </div>
                  <div className="col-3">
                    <span className="d-block text-muted">31–60 Days</span>
                    <strong className="text-warning-emphasis"><Money amount={statementData.aging?.days_31_60 || 0} /></strong>
                  </div>
                  <div className="col-3">
                    <span className="d-block text-muted">61–90 Days</span>
                    <strong className="text-danger"><Money amount={statementData.aging?.days_61_90 || 0} /></strong>
                  </div>
                  <div className="col-3">
                    <span className="d-block text-muted">&gt; 90 Days</span>
                    <strong className="text-danger"><Money amount={statementData.aging?.over_90 || 0} /></strong>
                  </div>
                </div>
              </div>

              {/* Invoices List */}
              <h6 className="fw-bold mb-2">Itemized Invoices &amp; Ledger</h6>
              <div className="table-responsive">
                <table className="table table-sm table-bordered align-middle small mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Invoice No</th>
                      <th>Date</th>
                      <th>Payer</th>
                      <th>Status</th>
                      <th className="text-end">Total</th>
                      <th className="text-end">Paid</th>
                      <th className="text-end">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementData.invoices?.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-2 text-muted">No invoices found for this patient.</td>
                      </tr>
                    ) : (
                      statementData.invoices?.map((inv: any) => (
                        <tr key={inv.id}>
                          <td className="fw-semibold text-primary">{inv.invoice_no}</td>
                          <td>{new Date(inv.issued_at).toLocaleDateString()}</td>
                          <td><span className="badge bg-light text-dark">{inv.payer_type}</span></td>
                          <td><span className="badge bg-secondary">{inv.status}</span></td>
                          <td className="text-end"><Money amount={Number(inv.total || 0)} /></td>
                          <td className="text-end text-success"><Money amount={Number(inv.paid_amount || 0)} /></td>
                          <td className="text-end fw-bold text-danger"><Money amount={Number(inv.balance || 0)} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowStatementModal(false)}>
            Close
          </Button>
          <Button variant="outline-primary" size="sm" onClick={() => window.print()}>
            🖨️ Print Statement
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
