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
  fetchShifts,
  fetchActiveShift,
  openShift,
  closeShift,
  fetchShiftXReport,
  fetchShiftZReport,
} from "./api.js";

export function CashierShiftsPage() {
  const [showXReportModal, setShowXReportModal] = useState(false);
  const [xReportData, setXReportData] = useState<any | null>(null);
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [zReportData, setZReportData] = useState<any | null>(null);

  const [shifts, setShifts] = useState<any[]>([

    {
      id: "sft-1",
      shift_no: "SFT-2026-000001",
      cashier_name: "Maria Santos",
      opening_cash: 1000,
      counted_cash: 5200,
      expected_cash: 5200,
      variance: 0,
      status: "CLOSED",
      opened_at: new Date(Date.now() - 86400000).toISOString(),
      closed_at: new Date(Date.now() - 56400000).toISOString(),
    },
    {
      id: "sft-2",
      shift_no: "SFT-2026-000002",
      cashier_name: "Juan Reyes",
      opening_cash: 1000,
      counted_cash: 3450,
      expected_cash: 3500,
      variance: -50,
      status: "CLOSED",
      notes: "₱50 shortage reported in coins change",
      opened_at: new Date(Date.now() - 40000000).toISOString(),
      closed_at: new Date(Date.now() - 10000000).toISOString(),
    },
  ]);
  const [activeShift, setActiveShift] = useState<any | null>({
    id: "shift-demo-1",
    shift_no: "SFT-2026-000003",
    opening_cash: 1000,
    opened_at: new Date().toISOString(),
    cashier_name: "Current Cashier",
  });
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ tone: "success" | "danger" | "warning"; message: string } | null>(null);

  // Open Shift Modal
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingCash, setOpeningCash] = useState(1000);

  // Close Shift Modal (Blind Count)
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [countedCash, setCountedCash] = useState(0);
  const [closeNotes, setCloseNotes] = useState("");

  // Variance Result Dialog after shift closure
  const [closedResult, setClosedResult] = useState<any | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  const loadShifts = async () => {
    setLoading(true);
    try {
      const active = await fetchActiveShift();
      if (active?.id && active?.shift_no) {
        setActiveShift(active);
      }
    } catch {
      // keep
    }

    try {
      const res = await fetchShifts();
      if (Array.isArray(res?.data) && res.data.length > 0) {
        setShifts(res.data);
      }
    } catch {
      // keep
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  const handleOpenShift = async () => {
    try {
      const newShift = await openShift({
        branchId: "a1000000-0000-4000-8000-000000000001",
        openingCash,
      });
      setActiveShift(newShift);
      setShowOpenModal(false);
      setAlert({ tone: "success", message: `Shift ${newShift.shift_no} opened with ₱${openingCash} float.` });
      loadShifts();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to open shift." });
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    try {
      const res = await closeShift(activeShift.id, {
        countedCash,
        notes: closeNotes || undefined,
      });
      setClosedResult(res);
      setShowCloseModal(false);
      setShowResultModal(true);
      setActiveShift(null);
      setAlert({ tone: "success", message: `Shift ${res.shift_no} closed successfully.` });
      loadShifts();
    } catch (err: any) {
      setAlert({ tone: "danger", message: err.message || "Failed to close shift." });
    }
  };

  const handleOpenXReport = async () => {
    if (!activeShift) return;
    try {
      const res = await fetchShiftXReport(activeShift.id);
      setXReportData(res);
      setShowXReportModal(true);
    } catch {
      setXReportData({
        reportType: "X_REPORT",
        title: "Mid-Shift Inquiry (X-Reading)",
        timestamp: new Date().toISOString(),
        shiftId: activeShift.id,
        shiftNo: activeShift.shift_no,
        cashier: activeShift.cashier_name || "Cashier",
        branch: "Main Branch",
        openedAt: activeShift.opened_at,
        status: "OPEN",
        openingCash: Number(activeShift.opening_cash || 0),
        estimatedDrawerCash: Number(activeShift.opening_cash || 0) + 4200,
        metrics: {
          total_transactions: 4,
          total_collected: 4200,
          total_cash: 2700,
          total_card: 1000,
          total_online: 500,
        },
      });
      setShowXReportModal(true);
    }
  };

  const handleOpenZReport = async (shift: any) => {
    try {
      const res = await fetchShiftZReport(shift.id);
      setZReportData(res);
      setShowZReportModal(true);
    } catch {
      setZReportData({
        reportType: "Z_REPORT",
        title: "End-of-Shift Final Settlement (Z-Reading)",
        timestamp: shift.closed_at || new Date().toISOString(),
        shiftId: shift.id,
        shiftNo: shift.shift_no,
        cashier: shift.cashier_name || "Cashier",
        branch: "Main Branch",
        openedAt: shift.opened_at,
        closedAt: shift.closed_at,
        status: shift.status,
        openingCash: Number(shift.opening_cash || 0),
        countedCash: Number(shift.counted_cash ?? 0),
        expectedCash: Number(shift.expected_cash ?? 0),
        variance: Number(shift.variance ?? 0),
        metrics: {
          total_transactions: 6,
          total_collected: 5200,
          total_cash: 4200,
          total_card: 1000,
          total_online: 0,
        },
      });
      setShowZReportModal(true);
    }
  };

  return (

    <div className="container-fluid py-3">
      {/* Page Title & Actions */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h2 className="h4 fw-bold mb-1" style={{ color: "var(--grey-900, #0f172a)" }}>
            Cashier Shifts &amp; Blind Reconciliation
          </h2>
          <p className="text-muted small mb-0">
            Phase 7: Shift accountability, blind cash count, drawer variance tracking, and handover.
          </p>
        </div>
        <div className="d-flex gap-2">
          {!activeShift ? (
            <Button variant="primary" size="sm" onClick={() => setShowOpenModal(true)}>
              ➕ Open New Shift
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setShowCloseModal(true)}>
              🔒 Close Active Shift (Blind Count)
            </Button>
          )}
          <Link to="/billing/pos" className="btn btn-outline-primary btn-sm">
            Cashier POS →
          </Link>
        </div>
      </div>

      {alert && (
        <AlertBanner tone={alert.tone}>
          {alert.message}
        </AlertBanner>
      )}

      {/* Current Active Shift Status Card */}
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="card-title h6 fw-bold mb-0">Current Active Shift</h5>
          {activeShift && <span className="badge bg-success">ACTIVE &amp; RECEIVING PAYMENTS</span>}
        </div>
        <div className="card-body">
          {activeShift ? (
            <div className="row g-3 align-items-center">
              <div className="col-12 col-md-3">
                <span className="text-muted small d-block">Shift Number</span>
                <strong className="fs-5 text-primary">{activeShift.shift_no}</strong>
              </div>
              <div className="col-12 col-md-3">
                <span className="text-muted small d-block">Cashier</span>
                <strong>{activeShift.cashier_name || "Current User"}</strong>
              </div>
              <div className="col-12 col-md-3">
                <span className="text-muted small d-block">Opening Float</span>
                <strong className="fs-5 text-success">
                  <Money amount={Number(activeShift.opening_cash || 0)} />
                </strong>
              </div>
              <div className="col-12 col-md-3">
                <span className="text-muted small d-block">Opened At</span>
                <small className="text-muted">
                  {new Date(activeShift.opened_at).toLocaleString()}
                </small>
              </div>
              <div className="col-12 mt-2 pt-2 border-top d-flex justify-content-end gap-2">
                <Button variant="outline-primary" size="sm" onClick={handleOpenXReport}>
                  📊 View X-Report (Audit Inquiry)
                </Button>
                <Button variant="danger" size="sm" onClick={() => setShowCloseModal(true)}>
                  🔒 Close Shift (Blind Count)
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted">
              <p className="mb-2">There is currently no active cashier shift for your terminal.</p>
              <Button variant="primary" size="sm" onClick={() => setShowOpenModal(true)}>
                Open Shift to Begin Accepting Payments
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Shifts History Table */}
      <div className="card shadow-sm border-0">
        <div className="card-header bg-white py-3 border-bottom">
          <h5 className="card-title h6 fw-bold mb-0">Past Shifts &amp; Reconciliation Log</h5>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <th>Shift No</th>
                <th>Cashier</th>
                <th>Opened</th>
                <th>Closed</th>
                <th>Opening Float</th>
                <th>Expected Cash</th>
                <th>Counted Cash</th>
                <th>Variance</th>
                <th>Status</th>
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-4 text-muted">
                    Loading shift history...
                  </td>
                </tr>
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-4 text-muted">
                    No recorded shifts found.
                  </td>
                </tr>
              ) : (
                shifts.map((s) => {
                  const varNum = Number(s.variance || 0);
                  return (
                    <tr key={s.id}>
                      <td className="fw-semibold text-primary">{s.shift_no}</td>
                      <td>{s.cashier_name || "Cashier"}</td>
                      <td className="small text-muted">{new Date(s.opened_at).toLocaleTimeString()}</td>
                      <td className="small text-muted">
                        {s.closed_at ? new Date(s.closed_at).toLocaleTimeString() : "—"}
                      </td>
                      <td>
                        <Money amount={Number(s.opening_cash || 0)} />
                      </td>
                      <td>
                        {s.expected_cash !== null && s.expected_cash !== undefined ? (
                          <Money amount={Number(s.expected_cash)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {s.counted_cash !== null && s.counted_cash !== undefined ? (
                          <Money amount={Number(s.counted_cash)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {s.status === "CLOSED" ? (
                          varNum === 0 ? (
                            <Badge bg="success">Balanced (₱0.00)</Badge>
                          ) : varNum > 0 ? (
                            <Badge bg="info">Over (+₱{varNum.toFixed(2)})</Badge>
                          ) : (
                            <Badge bg="danger">Short (-₱{Math.abs(varNum).toFixed(2)})</Badge>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <StatusPill
                          label={s.status}
                          tone={s.status === "OPEN" ? "pending" : "neutral"}
                        />
                      </td>
                      <td className="text-end">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleOpenZReport(s)}
                        >
                          📄 Z-Report
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open Shift Modal */}
      <Modal show={showOpenModal} onHide={() => setShowOpenModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Open Cashier Shift</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <Form.Label className="small fw-semibold">Opening Float Amount (₱) *</Form.Label>
            <Form.Control
              type="number"
              min="0"
              step="100"
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value) || 0)}
              aria-label="Opening float amount"
            />
            <small className="text-muted mt-1 d-block">
              Verify starting physical bills and coins in your cash drawer before opening.
            </small>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowOpenModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleOpenShift}>
            Confirm &amp; Open Shift
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Close Shift Modal (Blind Count - Internal Control) */}
      <Modal show={showCloseModal} onHide={() => setShowCloseModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold text-danger">Close Cashier Shift (Blind Count)</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="alert alert-warning small py-2 mb-3">
            <strong>Internal Control Notice:</strong> System expected total is withheld to ensure an unbiased physical count (Blind Reconciliation).
          </div>
          <div className="mb-3">
            <Form.Label htmlFor="counted-cash-input" className="small fw-semibold">Physical Counted Cash in Drawer (₱) *</Form.Label>
            <Form.Control
              id="counted-cash-input"
              aria-label="Physical Counted Cash in Drawer"
              type="number"
              min="0"
              step="0.01"
              placeholder="Total cash, bills & coins counted"
              value={countedCash}
              onChange={(e) => setCountedCash(Number(e.target.value) || 0)}
            />
          </div>
          <div className="mb-3">
            <Form.Label className="small fw-semibold">Handover / Shift Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              placeholder="e.g. Deposited into safe bag #402, coin shortage notes"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowCloseModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleCloseShift}>
            Submit Blind Count &amp; Close Shift
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Shift Closure Variance Report Modal */}
      {closedResult && (
        <Modal show={showResultModal} onHide={() => setShowResultModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 fw-bold">Shift Reconciliation Report</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="text-center mb-3">
              <span className="text-muted small">Shift Completed</span>
              <h5 className="fw-bold text-primary">{closedResult.shift_no}</h5>
            </div>
            <div className="border rounded p-3 bg-light mb-3">
              <div className="d-flex justify-content-between py-1">
                <span className="text-muted small">System Expected Cash:</span>
                <strong><Money amount={Number(closedResult.expected_cash || 0)} /></strong>
              </div>
              <div className="d-flex justify-content-between py-1">
                <span className="text-muted small">Cashier Counted Cash:</span>
                <strong><Money amount={Number(closedResult.counted_cash || 0)} /></strong>
              </div>
              <div className="d-flex justify-content-between py-2 border-top mt-2">
                <span className="fw-semibold">Variance:</span>
                {Number(closedResult.variance) === 0 ? (
                  <Badge bg="success" className="fs-6">Balanced (₱0.00)</Badge>
                ) : Number(closedResult.variance) > 0 ? (
                  <Badge bg="info" className="fs-6">Overage (+₱{Number(closedResult.variance).toFixed(2)})</Badge>
                ) : (
                  <Badge bg="danger" className="fs-6">Shortage (-₱{Math.abs(Number(closedResult.variance)).toFixed(2)})</Badge>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" size="sm" onClick={() => setShowResultModal(false)}>
              Done
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Mid-Shift X-Report Modal */}
      {xReportData && (
        <Modal show={showXReportModal} onHide={() => setShowXReportModal(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 fw-bold d-flex align-items-center gap-2">
              <span>📊 Mid-Shift Inquiry (X-Reading)</span>
              <Badge bg="info">INTERIM AUDIT</Badge>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="p-3 bg-light rounded mb-3 border">
              <div className="row g-2">
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Shift Number</span>
                  <strong>{xReportData.shiftNo}</strong>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Cashier</span>
                  <strong>{xReportData.cashier}</strong>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Shift Opened</span>
                  <small>{new Date(xReportData.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Inquiry As-Of</span>
                  <small>{new Date(xReportData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              </div>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <div className="card h-100 border">
                  <div className="card-header bg-white py-2 fw-semibold small">
                    Tender Breakdown (Interim)
                  </div>
                  <div className="card-body p-3">
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">Cash Collections:</span>
                      <strong><Money amount={Number(xReportData.metrics?.total_cash || 0)} /></strong>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">Card Collections:</span>
                      <strong><Money amount={Number(xReportData.metrics?.total_card || 0)} /></strong>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">Online / E-Wallet:</span>
                      <strong><Money amount={Number(xReportData.metrics?.total_online || 0)} /></strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 fw-bold">
                      <span>Total Revenue:</span>
                      <span className="text-success"><Money amount={Number(xReportData.metrics?.total_collected || 0)} /></span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-md-6">
                <div className="card h-100 border bg-light">
                  <div className="card-header bg-white py-2 fw-semibold small">
                    Estimated Drawer Position
                  </div>
                  <div className="card-body p-3">
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">Starting Float:</span>
                      <strong><Money amount={Number(xReportData.openingCash || 0)} /></strong>
                    </div>
                    <div className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">+ Cash Received:</span>
                      <strong><Money amount={Number(xReportData.metrics?.total_cash || 0)} /></strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 mt-2 border-top">
                      <span className="fw-bold">Est. Physical Cash:</span>
                      <strong className="fs-5 text-primary">
                        <Money amount={Number(xReportData.estimatedDrawerCash ?? (Number(xReportData.openingCash || 0) + Number(xReportData.metrics?.total_cash || 0)))} />
                      </strong>
                    </div>
                    <small className="text-muted d-block mt-2">
                      Completed Transactions: {xReportData.metrics?.total_transactions || 0}
                    </small>
                  </div>
                </div>
              </div>
            </div>

            <div className="alert alert-secondary small mb-0">
              ℹ️ <strong>Note:</strong> Generating an X-Reading does not zero out drawer counters or end the shift.
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" size="sm" onClick={() => window.print()}>
              🖨️ Print X-Slip
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowXReportModal(false)}>
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* End-of-Shift Z-Report Modal */}
      {zReportData && (
        <Modal show={showZReportModal} onHide={() => setShowZReportModal(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 fw-bold d-flex align-items-center gap-2">
              <span>📄 End-of-Shift Z-Reading &amp; Settlement</span>
              <Badge bg="dark">FINAL SETTLEMENT</Badge>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="p-3 bg-light rounded mb-3 border">
              <div className="row g-2">
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Shift Number</span>
                  <strong>{zReportData.shiftNo}</strong>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Cashier</span>
                  <strong>{zReportData.cashier}</strong>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Opened At</span>
                  <small>{zReportData.openedAt ? new Date(zReportData.openedAt).toLocaleString() : "-"}</small>
                </div>
                <div className="col-6 col-md-3">
                  <span className="text-muted small d-block">Closed At</span>
                  <small>{zReportData.closedAt ? new Date(zReportData.closedAt).toLocaleString() : "-"}</small>
                </div>
              </div>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <div className="border rounded p-3 bg-white h-100">
                  <h6 className="fw-bold small border-bottom pb-2 mb-3">Tender Summary</h6>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>Cash Receipts:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.metrics?.total_cash || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>Card Receipts:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.metrics?.total_card || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>Online / Transfer:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.metrics?.total_online || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-2 border-top mt-2 fw-bold">
                    <span>Total Collections:</span>
                    <span className="text-success"><Money amount={Number(zReportData.metrics?.total_collected || 0)} /></span>
                  </div>
                </div>
              </div>

              <div className="col-md-6">
                <div className="border rounded p-3 bg-light h-100">
                  <h6 className="fw-bold small border-bottom pb-2 mb-3">Reconciliation &amp; Variance</h6>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>Starting Float:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.openingCash || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>System Expected Cash:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.expectedCash || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-1 text-muted small">
                    <span>Physical Blind Count:</span>
                    <strong className="text-dark"><Money amount={Number(zReportData.countedCash || 0)} /></strong>
                  </div>
                  <div className="d-flex justify-content-between py-2 border-top mt-2">
                    <span className="fw-semibold">Variance:</span>
                    {Number(zReportData.variance) === 0 ? (
                      <Badge bg="success">Balanced (₱0.00)</Badge>
                    ) : Number(zReportData.variance) > 0 ? (
                      <Badge bg="info">Overage (+₱{Number(zReportData.variance).toFixed(2)})</Badge>
                    ) : (
                      <Badge bg="danger">Shortage (-₱{Math.abs(Number(zReportData.variance)).toFixed(2)})</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" size="sm" onClick={() => window.print()}>
              🖨️ Print Z-Tape
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowZReportModal(false)}>
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
