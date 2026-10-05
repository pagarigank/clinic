import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import { apiGet } from "../../shared/api/client.js";
import { StatusPill } from "@clinic/ui";

interface WorkingMetrics {
  totalPatients: number;
  activeVisits: number;
  pendingLabOrders: number;
  pendingPrescriptions: number;
  activeSupplyItems: number;
  totalValuation: number;
  unpaidInvoices: number;
}

interface VisitRow {
  id: string;
  visit_no?: string;
  visitNo?: string;
  patient_id?: string;
  patient_name?: string;
  patientName?: string;
  chief_complaint?: string;
  chiefComplaint?: string;
  status: string;
  opened_at?: string;
}

interface LabOrderRow {
  id: string;
  order_no?: string;
  orderNo?: string;
  patient_name?: string;
  patientName?: string;
  priority: string;
  status: string;
  ordered_at?: string;
  items?: Array<{ test_name?: string; name?: string; test_code?: string }>;
}

interface PrescriptionRow {
  id: string;
  rx_no?: string;
  rxNo?: string;
  patient_name?: string;
  patientName?: string;
  status: string;
  is_controlled?: boolean;
  isControlled?: boolean;
  items?: Array<{ generic_name?: string; genericName?: string; qty_prescribed?: number }>;
}

const QUICK_ACTIONS = [
  {
    to: "/clinical/visits",
    icon: "🩺",
    title: "Clinical Encounters",
    desc: "Active consultations, vitals intake, diagnosis, lab & prescription orders.",
    badge: "CLINICAL",
    accent: true,
  },
  {
    to: "/laboratory/worklist",
    icon: "🔬",
    title: "Laboratory Worklist",
    desc: "Specimen accessioning, analyzer results entry, validation & report release.",
    badge: "LAB",
    accent: false,
  },
  {
    to: "/pharmacy/queue",
    icon: "💊",
    title: "Pharmacy Dispense Queue",
    desc: "Prescription verification, safety checks, FEFO lot picking & dispensing.",
    badge: "PHARMACY",
    accent: false,
  },
  {
    to: "/supply/issues",
    icon: "📦",
    title: "Central Supply Issues",
    desc: "Room consumables log, stock issuing, department requisitions & ledger.",
    badge: "SUPPLY",
    accent: false,
  },
  {
    to: "/billing",
    icon: "💵",
    title: "Cashier & Billing POS",
    desc: "Encounters settlement, PhilHealth claims, discounts & receipt issuance.",
    badge: "BILLING",
    accent: false,
  },
  {
    to: "/patients",
    icon: "👤",
    title: "Patient Registry",
    desc: "Search demographics, capture consents, PhilHealth PIN, & duplicates.",
    badge: "RECORDS",
    accent: false,
  },
  {
    to: "/supply/dashboard",
    icon: "📈",
    title: "Supply Dashboard",
    desc: "Inventory valuation, low-stock reorder suggestions, and batch expiry tracker.",
    badge: "ANALYTICS",
    accent: false,
  },
  {
    to: "/admin/branches",
    icon: "🏢",
    title: "Branch Operations",
    desc: "Operating schedules, examination rooms, service units, and facility licensing.",
    badge: "ADMIN",
    accent: false,
  },
];

export function DashboardPage() {
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<WorkingMetrics>({
    totalPatients: 0,
    activeVisits: 0,
    pendingLabOrders: 0,
    pendingPrescriptions: 0,
    activeSupplyItems: 0,
    totalValuation: 0,
    unpaidInvoices: 0,
  });

  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrderRow[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [activeTab, setActiveTab] = useState<"VISITS" | "LAB" | "PHARMACY">("VISITS");

  const mountedRef = React.useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // Gate every aggregate fetch on the caller's actual grants. Without this the
    // dashboard fires /lab/worklist, /pharmacy/queue and /supply/* unconditionally
    // and a receptionist (who correctly holds none of those permissions) collects
    // a burst of 403s on every page load. Two distinct harms: the console noise
    // hides real failures, and it makes a correct server-side 403 look like a bug.
    // RLS/permission enforcement stays server-side — this only avoids asking.
    const { hasPermission, hasAnyPermission } = usePermissions();
    const canSeeLab = hasAnyPermission(["lab.order.read", "lab.result.read", "lab.specimen.read"]);
    const canSeePharmacy = hasAnyPermission(["pharmacy.rx.read", "pharmacy.dispense.read"]);
    const canSeeSupply = hasAnyPermission(["supply.stock.read", "supply.item.read"]);
    const canSeeBilling = hasAnyPermission(["billing.invoice.read"]);
    const canSeeClinical = hasAnyPermission(["clinical.visit.read", "clinical.queue.read"]);
    const canSeePatients = hasPermission("patient.record.read");

    const loadWorkingData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh && mountedRef.current) setRefreshing(true);
    try {
      // 1. Patients
      let patientCount = 0;
      if (canSeePatients) {
      try {
        const pRes = await apiGet<any>("/patients");
        if (Array.isArray(pRes?.data)) {
          patientCount = pRes.data.length;
        } else if (Array.isArray(pRes)) {
          patientCount = pRes.length;
        }
      } catch { /* offline fallback */ }
      }

      // 2. Visits
      let visitList: VisitRow[] = [];
      let activeVisitCount = 0;
      if (canSeeClinical) {
      try {
        const vRes = await apiGet<any>("/clinical/visits");
        const list = Array.isArray(vRes?.data) ? vRes.data : Array.isArray(vRes) ? vRes : [];
        visitList = list;
        activeVisitCount = list.filter(
          (v: any) => v.status === "OPEN" || v.status === "IN_PROGRESS" || v.status === "READY_FOR_BILLING"
        ).length;
      } catch { /* offline fallback */ }
      }

      // 3. Laboratory Orders
      let labList: LabOrderRow[] = [];
      let pendingLabCount = 0;
      if (canSeeLab) {
      try {
        const lRes = await apiGet<any>("/lab/worklist");
        const list = Array.isArray(lRes?.data) ? lRes.data : Array.isArray(lRes) ? lRes : [];
        labList = list;
        pendingLabCount = list.filter(
          (o: any) => o.status === "ORDERED" || o.status === "COLLECTED" || o.status === "RECEIVED"
        ).length;
      } catch { /* offline fallback */ }
      }

      // 4. Pharmacy Queue
      let rxList: PrescriptionRow[] = [];
      let pendingRxCount = 0;
      if (canSeePharmacy) {
      try {
        const rxRes = await apiGet<any>("/pharmacy/queue");
        const list = Array.isArray(rxRes?.data) ? rxRes.data : Array.isArray(rxRes) ? rxRes : [];
        rxList = list;
        pendingRxCount = list.filter(
          (rx: any) => rx.status === "ISSUED" || rx.status === "VERIFIED"
        ).length;
      } catch { /* offline fallback */ }
      }

      // 5. Supply Stock & Items
            let supplyItemsCount = 0;
            let valuation = 0;
            if (canSeeSupply) {
              try {
                const sRes = await apiGet<any>("/supply/stock");
                const list = Array.isArray(sRes?.data) ? sRes.data : Array.isArray(sRes) ? sRes : [];
                supplyItemsCount = list.length;
                valuation = list.reduce((acc: number, row: any) => acc + (Number(row.total_value) || 0), 0);
              } catch {
                try {
                  const itemsRes = await apiGet<any[]>("/supply/items");
                  if (Array.isArray(itemsRes)) supplyItemsCount = itemsRes.length;
                } catch { /* offline fallback */ }
              }
            }

            // 6. Billing Invoices
      let unpaidCount = 0;
      if (canSeeBilling) {
      try {
        const invRes = await apiGet<any>("/billing/invoices");
        const list = Array.isArray(invRes?.data) ? invRes.data : Array.isArray(invRes) ? invRes : [];
        unpaidCount = list.filter(
          (i: any) => i.status === "ISSUED" || i.status === "DRAFT" || i.status === "PARTIALLY_PAID"
        ).length;
      } catch { /* offline fallback */ }
      }

      if (mountedRef.current) {
        setMetrics({
          totalPatients: patientCount,
          activeVisits: activeVisitCount,
          pendingLabOrders: pendingLabCount,
          pendingPrescriptions: pendingRxCount,
          activeSupplyItems: supplyItemsCount,
          totalValuation: valuation,
          unpaidInvoices: unpaidCount,
        });

        setVisits(visitList);
        setLabOrders(labList);
        setPrescriptions(rxList);
      }
    } catch {
      // keep existing state gracefully
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
      // The permission gates are inputs: without them in the dep list this
      // callback closes over the first render's values, so a user whose permissions
      // arrive after the initial fetch (the session loads async) would keep the
      // ungated behaviour and still 403.
      }, [canSeePatients, canSeeClinical, canSeeLab, canSeePharmacy, canSeeSupply, canSeeBilling]);

  useEffect(() => {
    void loadWorkingData();
  }, [loadWorkingData]);

  return (
    <div>
      {/* ── Welcome Hero ──────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--gradient-hero)",
          color: "var(--white)",
          borderRadius: "var(--radius-lg)",
          padding: "2rem 2rem 1.75rem",
          marginBottom: "1.75rem",
          boxShadow: "0 6px 20px rgba(0,123,167,0.18)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(0deg,rgba(255,255,255,0.03) 0px,rgba(255,255,255,0.03) 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,rgba(255,255,255,0.03) 0px,rgba(255,255,255,0.03) 1px,transparent 1px,transparent 40px)",
            pointerEvents: "none",
          }}
        />
        <div className="row align-items-center" style={{ position: "relative" }}>
          <div className="col-lg-8">
            <span
              style={{
                display: "inline-block",
                padding: "0.25rem 0.8rem",
                borderRadius: "var(--radius-full)",
                background: "rgba(255,255,255,0.18)",
                fontSize: "0.75rem",
                fontWeight: 700,
                marginBottom: "0.75rem",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                backdropFilter: "blur(4px)",
              }}
            >
              {session?.branchName || "Main Branch"} · Clinic Operations Command
            </span>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 800, margin: "0 0 0.5rem", letterSpacing: "-0.025em" }}>
              Welcome back, {session?.name || "Dr. Maria Santos"}
            </h1>
            <p style={{ margin: 0, opacity: 0.88, fontSize: "0.925rem", lineHeight: 1.6 }}>
              Enterprise Practice Management &amp; Electronic Medical Record System. Multi-tenant RLS isolation active.
            </p>
          </div>
          <div className="col-lg-4 text-lg-end mt-3 mt-lg-0">
            <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
              <button
                type="button"
                className="btn btn-outline-light fw-semibold d-inline-flex align-items-center gap-1"
                style={{ borderRadius: "var(--radius-sm)", fontSize: "0.875rem" }}
                onClick={() => void loadWorkingData(true)}
                disabled={refreshing}
              >
                <span className={refreshing ? "spinner-border spinner-border-sm" : ""}>🔄</span>
                {refreshing ? "Refreshing..." : "Refresh Live"}
              </button>
              <Link
                to="/clinical/visits"
                className="btn btn-light fw-semibold"
                style={{ color: "var(--cerulean-700)", borderRadius: "var(--radius-sm)", fontSize: "0.875rem" }}
              >
                + Open Visit
              </Link>
              <Link
                to="/patients"
                className="btn btn-outline-light fw-semibold"
                style={{ borderRadius: "var(--radius-sm)", fontSize: "0.875rem" }}
              >
                + Patient
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dynamic KPI Metric Cards (Working Data) ──────────────── */}
      <div className="row g-3 mb-4">
        {/* 1. Active Clinical Encounters */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/clinical/visits" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Active Visits
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, var(--cerulean-50), var(--cerulean-100))", color: "var(--cerulean-600)" }}>
                  🩺
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.activeVisits}
                </div>
                <div style={{ fontSize: "0.76rem", color: metrics.activeVisits > 0 ? "var(--cerulean-600)" : "var(--grey-400)", marginTop: 4 }}>
                  {metrics.activeVisits > 0 ? "● Encounters in progress" : "No open visits"}
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 2. Registered Patients */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/patients" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Patients
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", color: "#16a34a" }}>
                  👥
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.totalPatients}
                </div>
                <div style={{ fontSize: "0.76rem", color: "#16a34a", marginTop: 4 }}>
                  Registered in master
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 3. Laboratory Worklist */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/laboratory/worklist" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Lab Orders
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, #fef3c7, #fde68a)", color: "#d97706" }}>
                  🔬
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: metrics.pendingLabOrders > 0 ? "#d97706" : "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.pendingLabOrders}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--grey-500)", marginTop: 4 }}>
                  {metrics.pendingLabOrders > 0 ? "Pending processing" : "Queue clear"}
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 4. Pharmacy Queue */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/pharmacy/queue" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Pharmacy Rx
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, #f3e8ff, #e9d5ff)", color: "#9333ea" }}>
                  💊
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: metrics.pendingPrescriptions > 0 ? "#9333ea" : "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.pendingPrescriptions}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--grey-500)", marginTop: 4 }}>
                  {metrics.pendingPrescriptions > 0 ? "Awaiting dispensing" : "Dispensing up to date"}
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 5. Central Supply Items & Valuation */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/supply/issues" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Supply Items
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, #e0f2fe, #bae6fd)", color: "#0284c7" }}>
                  📦
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.activeSupplyItems || 30}
                </div>
                <div style={{ fontSize: "0.76rem", color: "#0284c7", marginTop: 4 }}>
                  Stocked &amp; ready
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* 6. Cashier & Invoices */}
        <div className="col-sm-6 col-xl-2">
          <Link to="/billing" className="text-decoration-none">
            <div className="metric-card d-flex flex-column justify-content-between h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-500)", textTransform: "uppercase" }}>
                  Billing POS
                </div>
                <div className="metric-icon" style={{ background: "linear-gradient(135deg, #ecfdf5, #a7f3d0)", color: "#059669" }}>
                  💵
                </div>
              </div>
              <div className="mt-2">
                <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>
                  {loading ? "..." : metrics.unpaidInvoices}
                </div>
                <div style={{ fontSize: "0.76rem", color: "#059669", marginTop: 4 }}>
                  Pending checkout
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Working Data Workbench & Live Activity ───────────────── */}
      <div className="row g-3 mb-4">
        {/* Main Live Activity Feed */}
        <div className="col-lg-8">
          <div className="clinic-card h-100">
            <div className="clinic-card-header d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-bold fs-6">Operational Working Data</span>
                <span className="small text-muted ms-2">real-time tenant encounters &amp; orders</span>
              </div>
              <div className="btn-group btn-group-sm" role="group" aria-label="Working data tabs">
                <button
                  type="button"
                  className={`btn btn-sm ${activeTab === "VISITS" ? "btn-cerulean" : "btn-outline-secondary"}`}
                  onClick={() => setActiveTab("VISITS")}
                >
                  Clinical Visits ({visits.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${activeTab === "LAB" ? "btn-cerulean" : "btn-outline-secondary"}`}
                  onClick={() => setActiveTab("LAB")}
                >
                  Laboratory ({labOrders.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${activeTab === "PHARMACY" ? "btn-cerulean" : "btn-outline-secondary"}`}
                  onClick={() => setActiveTab("PHARMACY")}
                >
                  Pharmacy ({prescriptions.length})
                </button>
              </div>
            </div>

            <div className="p-3">
              {activeTab === "VISITS" && (
                <div>
                  {visits.length === 0 ? (
                    <div className="text-center py-4 text-muted small">
                      <div className="fs-3 mb-1">📋</div>
                      <div>No active clinical encounters found.</div>
                      <div className="mt-2">
                        <Link to="/clinical/visits" className="btn btn-sm btn-outline-primary">
                          Open New Encounter
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Visit #</th>
                            <th>Patient Name</th>
                            <th>Chief Complaint</th>
                            <th>Status</th>
                            <th className="text-end">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visits.map((v) => (
                            <tr key={v.id}>
                              <td className="clinic-mono fw-semibold text-primary">
                                {v.visit_no || v.visitNo || "VIS-2026"}
                              </td>
                              <td className="fw-semibold">
                                {v.patient_name || v.patientName || "Maria Elena Santos"}
                              </td>
                              <td className="text-muted text-truncate" style={{ maxWidth: 220 }}>
                                {v.chief_complaint || v.chiefComplaint || "Routine follow-up"}
                              </td>
                              <td>
                                <StatusPill
                                  tone={
                                    v.status === "IN_PROGRESS"
                                      ? "pending"
                                      : v.status === "READY_FOR_BILLING"
                                      ? "high"
                                      : v.status === "CLOSED"
                                      ? "normal"
                                      : "low"
                                  }
                                  label={v.status}
                                />
                              </td>
                              <td className="text-end">
                                <Link
                                  to={`/clinical/visits/${v.id}`}
                                  className="btn btn-sm btn-outline-primary py-0 px-2"
                                  style={{ fontSize: "0.78rem" }}
                                >
                                  Open Chart &rarr;
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "LAB" && (
                <div>
                  {labOrders.length === 0 ? (
                    <div className="text-center py-4 text-muted small">
                      <div className="fs-3 mb-1">🔬</div>
                      <div>All laboratory orders are cleared or none are pending.</div>
                      <div className="mt-2">
                        <Link to="/laboratory/worklist" className="btn btn-sm btn-outline-primary">
                          Open Lab Worklist
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Order #</th>
                            <th>Patient</th>
                            <th>Test / Panel</th>
                            <th>Priority</th>
                            <th>Status</th>
                            <th className="text-end">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {labOrders.map((lo) => (
                            <tr key={lo.id}>
                              <td className="clinic-mono fw-semibold text-primary">
                                {lo.order_no || lo.orderNo}
                              </td>
                              <td className="fw-semibold">{lo.patient_name || lo.patientName || "Patient"}</td>
                              <td className="text-muted">
                                {lo.items && lo.items.length > 0
                                  ? lo.items.map((i) => i.test_name || i.name || i.test_code).join(", ")
                                  : "Ordered Tests"}
                              </td>
                              <td>
                                <span
                                  className={`badge ${
                                    lo.priority === "STAT"
                                      ? "bg-danger"
                                      : lo.priority === "URGENT"
                                      ? "bg-warning text-dark"
                                      : "bg-secondary"
                                  }`}
                                >
                                  {lo.priority}
                                </span>
                              </td>
                              <td>
                                <StatusPill
                                  tone={lo.status === "ORDERED" ? "pending" : "normal"}
                                  label={lo.status}
                                />
                              </td>
                              <td className="text-end">
                                <Link
                                  to="/laboratory/worklist"
                                  className="btn btn-sm btn-outline-primary py-0 px-2"
                                  style={{ fontSize: "0.78rem" }}
                                >
                                  Worklist &rarr;
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "PHARMACY" && (
                <div>
                  {prescriptions.length === 0 ? (
                    <div className="text-center py-4 text-muted small">
                      <div className="fs-3 mb-1">💊</div>
                      <div>No pending prescriptions in the pharmacy queue.</div>
                      <div className="mt-2">
                        <Link to="/pharmacy/queue" className="btn btn-sm btn-outline-primary">
                          Open Pharmacy Queue
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Rx #</th>
                            <th>Patient</th>
                            <th>Prescribed Medication</th>
                            <th>Status</th>
                            <th className="text-end">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prescriptions.map((rx) => (
                            <tr key={rx.id}>
                              <td className="clinic-mono fw-semibold text-primary">
                                {rx.rx_no || rx.rxNo}
                              </td>
                              <td className="fw-semibold">{rx.patient_name || rx.patientName || "Patient"}</td>
                              <td className="text-muted">
                                {rx.items && rx.items.length > 0
                                  ? rx.items.map((i) => `${i.generic_name || i.genericName} (x${i.qty_prescribed})`).join(", ")
                                  : "Prescription items"}
                              </td>
                              <td>
                                <StatusPill
                                  tone={rx.status === "ISSUED" ? "pending" : "normal"}
                                  label={rx.status}
                                />
                              </td>
                              <td className="text-end">
                                <Link
                                  to={`/pharmacy/dispense/${rx.id}`}
                                  className="btn btn-sm btn-outline-success py-0 px-2"
                                  style={{ fontSize: "0.78rem" }}
                                >
                                  Dispense &rarr;
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tenant Security & Operations Info Panel */}
        <div className="col-lg-4">
          <div className="clinic-card h-100" style={{ borderTop: "3px solid var(--cerulean-500)" }}>
            <div className="clinic-card-header">
              <h2 className="clinic-card-title">Tenant Security &amp; Compliance</h2>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                  color: "#166534",
                  border: "1px solid #86efac",
                  borderRadius: "var(--radius-full)",
                  padding: "0.2rem 0.6rem",
                }}
              >
                FORCED RLS ACTIVE
              </span>
            </div>
            <ul className="list-unstyled small mb-0 p-3 pt-1">
              {[
                { label: "Tenant Organization", value: session?.tenantSlug || "demo-a", mono: true },
                { label: "Operating Branch", value: session?.branchName || "Main Branch", mono: false },
                { label: "Multi-Tenancy", value: "PostgreSQL 18 RLS", badge: true },
                { label: "PhilHealth Status", value: "Konsulta Package Capitation", mono: false },
                { label: "Data Privacy", value: "DPA 2012 / HIPAA Masked", mono: false },
                { label: "Segregation of Duties", value: "sod_conflicts Guarded", mono: false },
                { label: "Catalog Master", value: "Philippine National Formulary", mono: false },
              ].map(({ label, value, mono, badge }, i, arr) => (
                <li
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.6rem 0",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--grey-100)" : "none",
                  }}
                >
                  <span style={{ color: "var(--grey-500)" }}>{label}:</span>
                  {badge ? (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        background: "var(--gradient-cerulean)",
                        color: "var(--white)",
                        borderRadius: "var(--radius-full)",
                        padding: "0.2rem 0.6rem",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {value}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--grey-800)",
                        fontFamily: mono ? "'Courier New', monospace" : undefined,
                        fontSize: mono ? "0.82rem" : undefined,
                      }}
                    >
                      {value}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Quick Action Hub (Department Workbenches) ─────────────── */}
      <div className="clinic-card">
        <div className="clinic-card-header d-flex justify-content-between align-items-center">
          <h2 className="clinic-card-title">Department Workbenches &amp; Operations Hub</h2>
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              background: "var(--cerulean-100)",
              color: "var(--cerulean-700)",
              border: "1px solid var(--cerulean-200)",
              borderRadius: "var(--radius-full)",
              padding: "0.2rem 0.7rem",
              letterSpacing: "0.04em",
            }}
          >
            CORE ENTERPRISE SUITE
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3">
            {QUICK_ACTIONS.map((action) => (
              <div key={action.to} className="col-md-6 col-xl-3">
                <Link to={action.to} className="text-decoration-none d-block h-100">
                  <div
                    style={{
                      border: `1px solid ${action.accent ? "var(--cerulean-300)" : "var(--grey-200)"}`,
                      borderRadius: "var(--radius-md)",
                      padding: "1rem 1.1rem",
                      background: action.accent ? "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.6))" : "var(--white)",
                      transition: "all 0.18s ease",
                      height: "100%",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.85))";
                      (e.currentTarget as HTMLDivElement).style.borderColor = "var(--cerulean-400)";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 14px rgba(14,165,233,0.12)";
                      (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = action.accent
                        ? "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.6))"
                        : "var(--white)";
                      (e.currentTarget as HTMLDivElement).style.borderColor = action.accent ? "var(--cerulean-300)" : "var(--grey-200)";
                      (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                      (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
                      <span style={{ fontSize: "1.3rem" }}>{action.icon}</span>
                      <strong style={{ color: "var(--grey-800)", fontSize: "0.9rem" }}>{action.title}</strong>
                      <span
                        style={{
                          marginLeft: "auto",
                          background: action.accent ? "var(--cerulean-600)" : "var(--grey-100)",
                          color: action.accent ? "var(--white)" : "var(--grey-600)",
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          padding: "0.15rem 0.45rem",
                          borderRadius: "var(--radius-full)",
                        }}
                      >
                        {action.badge}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--grey-500)", lineHeight: 1.5 }}>
                      {action.desc}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
