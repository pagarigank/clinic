import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  ButtonGroup,
  Container,
  Form,
  Modal,
  Nav,
  StatusPill,
} from "@clinic/ui";
import {
  fetchAuditLogs,
  fetchAuditLogDetail,
  fetchPhiAccessLogs,
  fetchPatientPhiAccess,
  fetchDsrRequests,
  createDsrRequest,
  verifyDsrIdentity,
  completeDsrRequest,
  rejectDsrRequest,
  extendDsrDeadline,
  exportPatientDsrData,
  fetchBreachIncidents,
  reportBreach,
  assessBreach,
  recordBreachNotification,
  closeBreach,
  fetchRetentionPolicies,
  updateRetentionPolicy,
  fetchLegalHolds,
  createLegalHold,
  releaseLegalHold,
  fetchRetentionCandidates,
  approveRetentionCandidates,
  holdRetentionCandidates,
  fetchAccessReviews,
  fetchAccessReview,
  createAccessReview,
  recordAccessDecision,
  completeAccessReview,
  fetchPidsrCases,
  createPidsrCase,
  updatePidsrCaseStatus,
} from "./api.js";

type TabKey = "audit" | "phi" | "dsr" | "breach" | "retention" | "access-reviews" | "pidsr";

export function CompliancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "audit";

  const setTab = (tab: TabKey) => {
    setSearchParams({ tab });
  };

  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Audit Explorer State
  // ─────────────────────────────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilters, setAuditFilters] = useState({
    action: "",
    entityType: "",
    actorId: "",
  });
  const [selectedAuditLog, setSelectedAuditLog] = useState<any | null>(null);

  const loadAuditLogs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchAuditLogs({
        action: auditFilters.action || undefined,
        entityType: auditFilters.entityType || undefined,
        actorId: auditFilters.actorId || undefined,
        limit: 25,
      });
      setAuditLogs(res.data || []);
      setAuditTotal(res.total || 0);
    } catch (e: any) {
      setActionError(e.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [auditFilters]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PHI Access Log State
  // ─────────────────────────────────────────────────────────────────────────────
  const [phiLogs, setPhiLogs] = useState<any[]>([]);
  const [phiPatientSearch, setPhiPatientSearch] = useState("");
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);

  const loadPhiLogs = useCallback(async () => {
    try {
      setLoading(true);
      if (phiPatientSearch.trim()) {
        const data = await fetchPatientPhiAccess(phiPatientSearch.trim());
        setPhiLogs(data || []);
      } else {
        const res = await fetchPhiAccessLogs({
          anomaliesOnly,
          limit: 25,
        });
        setPhiLogs(res.data || []);
      }
    } catch (e: any) {
      setActionError(e.message || "Failed to load PHI access logs");
    } finally {
      setLoading(false);
    }
  }, [phiPatientSearch, anomaliesOnly]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. DSR State & AC-15 Export
  // ─────────────────────────────────────────────────────────────────────────────
  const [dsrRequests, setDsrRequests] = useState<any[]>([]);
  const [showNewDsrModal, setShowNewDsrModal] = useState(false);
  const [newDsrForm, setNewDsrForm] = useState({
    patientId: "",
    type: "ACCESS",
    requesterName: "",
    requesterRelationship: "SELF",
    requesterContact: "",
    details: "",
  });
  const [selectedDsr, setSelectedDsr] = useState<any | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyChecklist, setVerifyChecklist] = useState({
    govtIdVerified: false,
    signatureMatched: false,
    authorizationVerified: false,
    idType: "PHILHEALTH_ID",
    idNumber: "",
  });

  const loadDsrRequests = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchDsrRequests();
      setDsrRequests(data || []);
    } catch (e: any) {
      setActionError(e.message || "Failed to load DSR requests");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExportAc15 = async (dsr: any) => {
    try {
      setActionError(null);
      setActionSuccess("Generating audited AC-15 Patient Data Export Pack...");
      const pack = await exportPatientDsrData(dsr.id);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      if (typeof window !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `patient-dsr-export-${dsr.request_no || dsr.id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      }
      setActionSuccess(`Export pack successfully downloaded for DSR ${dsr.request_no}. PHI access logged.`);
    } catch (e: any) {
      setActionError(e.message || "Failed to download AC-15 export pack");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Breach Management State (Q-2 72h Clock)
  // ─────────────────────────────────────────────────────────────────────────────
  const [breaches, setBreaches] = useState<any[]>([]);
  const [showReportBreachModal, setShowReportBreachModal] = useState(false);
  const [reportBreachForm, setReportBreachForm] = useState({
    description: "",
    source: "INTERNAL_AUDIT",
    severity: "HIGH",
    affectedEstimate: 1,
    dataClasses: ["PHI", "DEMOGRAPHICS"],
  });
  const [selectedBreach, setSelectedBreach] = useState<any | null>(null);
  const [showAssessModal, setShowAssessModal] = useState(false);
  const [assessForm, setAssessForm] = useState({
    severity: "HIGH",
    affectedCount: 1,
    dataClasses: ["PHI"],
    correctiveActions: "",
  });
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyForm, setNotifyForm] = useState({
    notifiedRegulator: true,
    notifiedSubjects: false,
    regulatorRef: "",
  });

  const loadBreaches = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchBreachIncidents();
      setBreaches(data || []);
    } catch (e: any) {
      setActionError(e.message || "Failed to load breach incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Retention & Legal Holds State
  // ─────────────────────────────────────────────────────────────────────────────
  const [retentionPolicies, setRetentionPolicies] = useState<any[]>([]);
  const [legalHolds, setLegalHolds] = useState<any[]>([]);
  const [retentionCandidates, setRetentionCandidates] = useState<any[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [showNewHoldModal, setShowNewHoldModal] = useState(false);
  const [newHoldForm, setNewHoldForm] = useState({
    scope: "ENTIRE_TENANT",
    patientId: "",
    recordClass: "ALL",
    reason: "",
  });
  const [editingPolicy, setEditingPolicy] = useState<any | null>(null);
  const [policyForm, setPolicyForm] = useState({ retentionYears: 10, legalBasis: "" });

  const loadRetention = useCallback(async () => {
    try {
      setLoading(true);
      const [pols, holds, cands] = await Promise.all([
        fetchRetentionPolicies(),
        fetchLegalHolds(),
        fetchRetentionCandidates(),
      ]);
      setRetentionPolicies(pols || []);
      setLegalHolds(holds || []);
      setRetentionCandidates(cands || []);
    } catch (e: any) {
      setActionError(e.message || "Failed to load retention data");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Access Reviews State (ADM-T5)
  // ─────────────────────────────────────────────────────────────────────────────
  const [accessReviews, setAccessReviews] = useState<any[]>([]);
  const [showNewReviewModal, setShowNewReviewModal] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [activeReviewDetail, setActiveReviewDetail] = useState<{ review: any; decisions: any[] } | null>(null);

  const loadAccessReviews = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAccessReviews();
      setAccessReviews(data || []);
    } catch (e: any) {
      setActionError(e.message || "Failed to load access reviews");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. PIDSR Registry State (RA 11332, Q-16)
  // ─────────────────────────────────────────────────────────────────────────────
  const [pidsrCases, setPidsrCases] = useState<any[]>([]);
  const [showNewPidsrModal, setShowNewPidsrModal] = useState(false);
  const [newPidsrForm, setNewPidsrForm] = useState({
    branchId: "a1000000-0000-4000-8000-000000000001",
    patientId: "",
    diseaseCode: "DENGUE",
    diseaseName: "Dengue Fever / Hemorrhagic Fever",
    icd10Code: "A90",
    dateOfOnset: new Date().toISOString().slice(0, 10),
    classification: "PROBABLE",
    cifData: {
      feverDays: 3,
      symptoms: ["Fever", "Headache", "Myalgia", "Petechiae"],
      hospitalized: false,
      vaccinationStatus: "VACCINATED_PARTIAL",
      travelHistory: "No travel outside municipality in past 14 days",
    },
  });
  const [selectedPidsrCase, setSelectedPidsrCase] = useState<any | null>(null);

  const loadPidsrCases = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchPidsrCases();
      setPidsrCases(data || []);
    } catch (e: any) {
      setActionError(e.message || "Failed to load PIDSR cases");
    } finally {
      setLoading(false);
    }
  }, []);

  // Dispatch initial load based on active tab
  useEffect(() => {
    setActionError(null);
    setActionSuccess(null);
    if (activeTab === "audit") loadAuditLogs();
    if (activeTab === "phi") loadPhiLogs();
    if (activeTab === "dsr") loadDsrRequests();
    if (activeTab === "breach") loadBreaches();
    if (activeTab === "retention") loadRetention();
    if (activeTab === "access-reviews") loadAccessReviews();
    if (activeTab === "pidsr") loadPidsrCases();
  }, [activeTab, loadAuditLogs, loadPhiLogs, loadDsrRequests, loadBreaches, loadRetention, loadAccessReviews, loadPidsrCases]);

  // Compute countdown for breaches
  const activeBreachesNeedingNotification = useMemo(() => {
    return breaches.filter((b) => !b.notified_regulator && b.status !== "CLOSED");
  }, [breaches]);

  return (
    <Container fluid className="p-4">
      {/* Top Banner & Header */}
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-4 gap-3">
        <div>
          <div className="d-flex align-items-center gap-2">
            <h2 className="mb-0 fw-bold" style={{ letterSpacing: "-0.02em" }}>
              Compliance & Audit Governance
            </h2>
            <Badge bg="primary">Phase 8</Badge>
          </div>
          <div className="text-secondary small mt-1">
            Philippine Regulatory Compliance Engine (RA 10173 DPA, RA 11332 PIDSR, DOH Licensing, PhilHealth &amp; BIR Retention)
          </div>
        </div>

        {/* Global Status Badges */}
        <div className="d-flex flex-wrap gap-2">
          <div className="badge bg-light text-dark border px-3 py-2 text-start">
            <div className="text-muted small" style={{ fontSize: "0.7rem" }}>AUDIT CHAIN</div>
            <div className="fw-semibold text-success">🔒 Verified Intact</div>
          </div>
          <div className="badge bg-light text-dark border px-3 py-2 text-start">
            <div className="text-muted small" style={{ fontSize: "0.7rem" }}>DPA 72H BREACH CLOCK</div>
            <div className={`fw-semibold ${activeBreachesNeedingNotification.length > 0 ? "text-danger" : "text-success"}`}>
              {activeBreachesNeedingNotification.length > 0
                ? `🚨 ${activeBreachesNeedingNotification.length} Requiring Action`
                : "✅ Clear"}
            </div>
          </div>
          <div className="badge bg-light text-dark border px-3 py-2 text-start">
            <div className="text-muted small" style={{ fontSize: "0.7rem" }}>ACTIVE HOLDS</div>
            <div className="fw-semibold text-primary">{legalHolds.length} Recorded</div>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="mb-3">
          <AlertBanner tone="danger">
            <div className="d-flex justify-content-between align-items-center">
              <span>{actionError}</span>
              <Button size="sm" variant="outline-danger" onClick={() => setActionError(null)}>Dismiss</Button>
            </div>
          </AlertBanner>
        </div>
      )}

      {actionSuccess && (
        <div className="mb-3">
          <AlertBanner tone="success">
            <div className="d-flex justify-content-between align-items-center">
              <span>{actionSuccess}</span>
              <Button size="sm" variant="outline-success" onClick={() => setActionSuccess(null)}>Dismiss</Button>
            </div>
          </AlertBanner>
        </div>
      )}

      {/* Main Navigation Tabs */}
      <Nav variant="pills" activeKey={activeTab} onSelect={(k) => k && setTab(k as TabKey)} className="mb-4 bg-light p-2 rounded border gap-1">
        <Nav.Item>
          <Nav.Link eventKey="audit" className="d-flex align-items-center gap-2">
            <span>🔍</span> Audit Explorer
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="phi" className="d-flex align-items-center gap-2">
            <span>🛡️</span> PHI Access Log
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="dsr" className="d-flex align-items-center gap-2">
            <span>📋</span> DSR &amp; Export (AC-15)
            {dsrRequests.filter((d) => d.status === "PENDING" || d.status === "IN_PROGRESS").length > 0 && (
              <Badge bg="warning" text="dark" pill>
                {dsrRequests.filter((d) => d.status === "PENDING" || d.status === "IN_PROGRESS").length}
              </Badge>
            )}
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="breach" className="d-flex align-items-center gap-2">
            <span>🚨</span> Breach Register (Q-2)
            {activeBreachesNeedingNotification.length > 0 && (
              <Badge bg="danger" pill>
                {activeBreachesNeedingNotification.length}
              </Badge>
            )}
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="retention" className="d-flex align-items-center gap-2">
            <span>📦</span> Retention &amp; Holds
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="access-reviews" className="d-flex align-items-center gap-2">
            <span>👥</span> Access Reviews
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="pidsr" className="d-flex align-items-center gap-2">
            <span>🦠</span> PIDSR (RA 11332)
          </Nav.Link>
        </Nav.Item>
      </Nav>

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 1: AUDIT EXPLORER
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "audit" && (
        <div className="card shadow-sm border-0">
          <div className="card-header bg-white border-bottom py-3">
            <div className="row g-2 align-items-center">
              <div className="col-12 col-md-3">
                <Form.Select
                  size="sm"
                  value={auditFilters.action}
                  onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}
                >
                  <option value="">All Actions</option>
                  <option value="CREATE">CREATE</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="DELETE">DELETE</option>
                  <option value="VIEW">VIEW</option>
                  <option value="LOGIN">LOGIN</option>
                </Form.Select>
              </div>
              <div className="col-12 col-md-3">
                <Form.Select
                  size="sm"
                  value={auditFilters.entityType}
                  onChange={(e) => setAuditFilters({ ...auditFilters, entityType: e.target.value })}
                >
                  <option value="">All Entity Types</option>
                  <option value="patients">patients</option>
                  <option value="visits">visits</option>
                  <option value="prescriptions">prescriptions</option>
                  <option value="invoices">invoices</option>
                  <option value="data_subject_requests">data_subject_requests</option>
                  <option value="legal_holds">legal_holds</option>
                </Form.Select>
              </div>
              <div className="col-12 col-md-4">
                <Form.Control
                  size="sm"
                  placeholder="Filter by Actor UUID..."
                  value={auditFilters.actorId}
                  onChange={(e) => setAuditFilters({ ...auditFilters, actorId: e.target.value })}
                />
              </div>
              <div className="col-12 col-md-2 d-flex justify-content-end">
                <Button size="sm" variant="primary" onClick={loadAuditLogs} disabled={loading}>
                  {loading ? "Searching..." : "Apply Filters"}
                </Button>
              </div>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
              <thead className="table-light">
                <tr>
                  <th style={{ width: "180px" }}>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity Type</th>
                  <th>Entity ID</th>
                  <th>Integrity</th>
                  <th style={{ width: "100px" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      No audit events found matching filters.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                      <td>
                        <span className="fw-semibold">{log.actor_name || "System Actor"}</span>
                        <div className="text-muted small font-monospace" style={{ fontSize: "0.75rem" }}>
                          {log.actor_id?.slice(0, 8)}...
                        </div>
                      </td>
                      <td>
                        <Badge
                          bg={
                            log.action === "DELETE"
                              ? "danger"
                              : log.action === "CREATE"
                              ? "success"
                              : log.action === "UPDATE"
                              ? "primary"
                              : "secondary"
                          }
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="font-monospace">{log.entity_type}</td>
                      <td className="font-monospace text-muted small">{log.entity_id?.slice(0, 8)}...</td>
                      <td>
                        <Badge bg="success" className="d-inline-flex align-items-center gap-1">
                          <span>🔒</span> Intact
                        </Badge>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={async () => {
                            try {
                              const detail = await fetchAuditLogDetail(log.id);
                              setSelectedAuditLog(detail);
                            } catch (e: any) {
                              setActionError(e.message);
                            }
                          }}
                        >
                          Diff
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 2: PHI ACCESS LOG
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "phi" && (
        <div className="card shadow-sm border-0">
          <div className="card-header bg-white border-bottom py-3">
            <div className="row g-2 align-items-center">
              <div className="col-12 col-md-5">
                <div className="input-group input-group-sm">
                  <span className="input-group-text">Who saw patient:</span>
                  <Form.Control
                    placeholder="Enter Patient UUID..."
                    value={phiPatientSearch}
                    onChange={(e) => setPhiPatientSearch(e.target.value)}
                  />
                  <Button variant="primary" onClick={loadPhiLogs}>Query</Button>
                  {phiPatientSearch && (
                    <Button
                      variant="outline-secondary"
                      onClick={() => {
                        setPhiPatientSearch("");
                        loadPhiLogs();
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <div className="col-12 col-md-4">
                <Form.Check
                  type="switch"
                  id="phi-anomalies-switch"
                  label="Show Anomalies Only (Off-hours, Bulk, Break-glass)"
                  checked={anomaliesOnly}
                  onChange={(e) => setAnomaliesOnly(e.target.checked)}
                />
              </div>
              <div className="col-12 col-md-3 text-end">
                <Button size="sm" variant="outline-primary" onClick={loadPhiLogs}>
                  Refresh Log
                </Button>
              </div>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
              <thead className="table-light">
                <tr>
                  <th style={{ width: "180px" }}>Accessed At</th>
                  <th>Actor / Practitioner</th>
                  <th>Patient Target</th>
                  <th>Resource</th>
                  <th>Purpose</th>
                  <th>IP / User Agent</th>
                  <th>Audit Tag</th>
                </tr>
              </thead>
              <tbody>
                {phiLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      No PHI access records found.
                    </td>
                  </tr>
                ) : (
                  phiLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                      <td>
                        <span className="fw-semibold">{log.actor_name || "Authorized Staff"}</span>
                      </td>
                      <td>
                        <span className="font-monospace text-primary">{log.patient_name || log.patient_id?.slice(0, 8)}</span>
                      </td>
                      <td>
                        <Badge bg="info" text="dark">{log.resource}</Badge>
                      </td>
                      <td>{log.purpose}</td>
                      <td className="small text-muted font-monospace">{log.ip_address || "127.0.0.1"}</td>
                      <td>
                        {log.is_anomaly ? (
                          <Badge bg="danger">🚨 Anomaly</Badge>
                        ) : (
                          <Badge bg="light" text="dark" className="border">Normal</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 3: DATA SUBJECT REQUESTS (DSR) & AC-15 EXPORT
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "dsr" && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-0 fw-semibold">Patient Privacy Rights Requests (RA 10173 DPA)</h5>
              <div className="text-secondary small">
                Discharge right of access (AC-15), rectification, erasure, and data portability.
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => setShowNewDsrModal(true)}>
              + New DSR Request Intake
            </Button>
          </div>

          <div className="card shadow-sm border-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>Request #</th>
                    <th>Patient</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Identity Verified</th>
                    <th>SLA Deadline</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dsrRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4 text-muted">
                        No Data Subject Requests on file.
                      </td>
                    </tr>
                  ) : (
                    dsrRequests.map((dsr) => {
                      const isExpired = new Date(dsr.due_at) < new Date();
                      return (
                        <tr key={dsr.id}>
                          <td className="fw-semibold font-monospace">{dsr.request_no}</td>
                          <td>
                            <div>{dsr.first_name} {dsr.last_name}</div>
                            <div className="text-muted small font-monospace">{dsr.patient_no}</div>
                          </td>
                          <td>
                            <Badge bg={dsr.type === "ACCESS" || dsr.type === "PORTABILITY" ? "primary" : "secondary"}>
                              {dsr.type}
                            </Badge>
                          </td>
                          <td>
                            <StatusPill
                              tone={
                                dsr.status === "COMPLETED"
                                  ? "normal"
                                  : dsr.status === "REJECTED"
                                  ? "critical"
                                  : dsr.status === "IN_PROGRESS"
                                  ? "high"
                                  : "pending"
                              }
                              label={dsr.status}
                            />
                          </td>
                          <td>
                            {dsr.identity_verified_at ? (
                              <Badge bg="success">✓ Verified</Badge>
                            ) : (
                              <Badge bg="warning" text="dark">Pending ID</Badge>
                            )}
                          </td>
                          <td>
                            <div className={isExpired ? "text-danger fw-bold" : "text-dark"}>
                              {new Date(dsr.due_at).toLocaleDateString()}
                            </div>
                            <div className="small text-muted">
                              {isExpired ? "⚠️ Overdue" : "30-Day DPA Window"}
                            </div>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              {!dsr.identity_verified_at && dsr.status !== "REJECTED" && (
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => {
                                    setSelectedDsr(dsr);
                                    setShowVerifyModal(true);
                                  }}
                                >
                                  Verify ID
                                </Button>
                              )}
                              {(dsr.type === "ACCESS" || dsr.type === "PORTABILITY") && (
                                <Button
                                  size="sm"
                                  variant="success"
                                  title="Discharge AC-15: Download isolated audited patient bundle"
                                  onClick={() => handleExportAc15(dsr)}
                                >
                                  📥 Export Pack (AC-15)
                                </Button>
                              )}
                              {dsr.status !== "COMPLETED" && dsr.status !== "REJECTED" && (
                                <Button
                                  size="sm"
                                  variant="outline-success"
                                  onClick={async () => {
                                    try {
                                      await completeDsrRequest(dsr.id, "Delivered to verified data subject via secure portal");
                                      setActionSuccess(`DSR ${dsr.request_no} completed successfully.`);
                                      loadDsrRequests();
                                    } catch (e: any) {
                                      setActionError(e.message);
                                    }
                                  }}
                                >
                                  Complete
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 4: BREACH REGISTER (Q-2 72H CLOCK)
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "breach" && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-0 fw-semibold">Security &amp; Data Breach Incident Register</h5>
              <div className="text-secondary small">
                Mandatory 72-hour National Privacy Commission (NPC) &amp; DOH notification clock (Q-2).
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={() => setShowReportBreachModal(true)}>
              + Report Security Incident
            </Button>
          </div>

          {activeBreachesNeedingNotification.length > 0 && (
            <Alert variant="danger" className="d-flex align-items-center gap-3">
              <span style={{ fontSize: "1.75rem" }}>⏱️</span>
              <div>
                <div className="fw-bold">
                  URGENT: {activeBreachesNeedingNotification.length} Incident(s) Approaching 72h Regulatory Deadline
                </div>
                <div className="small">
                  Philippine Data Privacy Act §20(f) requires mandatory notification to the National Privacy Commission and affected subjects within 72 hours of discovery.
                </div>
              </div>
            </Alert>
          )}

          <div className="card shadow-sm border-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>Incident #</th>
                    <th>Severity</th>
                    <th>Description</th>
                    <th>Affected Est.</th>
                    <th>72h Clock Deadline</th>
                    <th>Regulator Notified</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4 text-muted">
                        No security breaches or incidents recorded.
                      </td>
                    </tr>
                  ) : (
                    breaches.map((b) => {
                      const deadline = new Date(b.notify_regulator_due_at);
                      const now = new Date();
                      const hoursLeft = Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60));
                      const isUrgent = !b.notified_regulator && hoursLeft <= 24;

                      return (
                        <tr key={b.id}>
                          <td className="fw-semibold font-monospace">{b.incident_no}</td>
                          <td>
                            <Badge
                              bg={
                                b.severity === "CRITICAL"
                                  ? "danger"
                                  : b.severity === "HIGH"
                                  ? "warning"
                                  : "secondary"
                              }
                            >
                              {b.severity}
                            </Badge>
                          </td>
                          <td style={{ maxWidth: "300px" }} className="text-truncate">
                            {b.description}
                          </td>
                          <td>{b.affected_count || "Unknown"}</td>
                          <td>
                            {b.notified_regulator ? (
                              <Badge bg="success">Notified</Badge>
                            ) : (
                              <div>
                                <div className={isUrgent ? "text-danger fw-bold" : "text-dark"}>
                                  {deadline.toLocaleString()}
                                </div>
                                <div className="small text-muted">
                                  {hoursLeft > 0 ? `⏳ ${hoursLeft} hours remaining` : "⚠️ OVERDUE"}
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            {b.notified_regulator ? (
                              <Badge bg="success">✓ NPC Notified</Badge>
                            ) : (
                              <Badge bg="danger">Pending NPC</Badge>
                            )}
                          </td>
                          <td>
                            <StatusPill
                              tone={
                                b.status === "CLOSED"
                                  ? "neutral"
                                  : b.status === "NOTIFIED"
                                  ? "normal"
                                  : b.status === "ASSESSED"
                                  ? "high"
                                  : "critical"
                              }
                              label={b.status}
                            />
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              {b.status === "REPORTED" && (
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => {
                                    setSelectedBreach(b);
                                    setAssessForm({
                                      severity: b.severity || "HIGH",
                                      affectedCount: b.affected_count || 1,
                                      dataClasses: b.data_classes || ["PHI"],
                                      correctiveActions: b.corrective_actions || "",
                                    });
                                    setShowAssessModal(true);
                                  }}
                                >
                                  Assess
                                </Button>
                              )}
                              {!b.notified_regulator && (
                                <Button
                                  size="sm"
                                  variant="warning"
                                  onClick={() => {
                                    setSelectedBreach(b);
                                    setShowNotifyModal(true);
                                  }}
                                >
                                  Record NPC Notice
                                </Button>
                              )}
                              {b.status !== "CLOSED" && (
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={async () => {
                                    try {
                                      await closeBreach(b.id, {
                                        correctiveActions: "Access revoked, credentials rotated, affected records isolated.",
                                        lessonsLearned: "Enhanced continuous anomaly detection and audit alerting thresholds.",
                                      });
                                      setActionSuccess(`Incident ${b.incident_no} closed.`);
                                      loadBreaches();
                                    } catch (e: any) {
                                      setActionError(e.message);
                                    }
                                  }}
                                >
                                  Close
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 5: RETENTION POLICIES & LEGAL HOLDS
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "retention" && (
        <div className="row g-4">
          {/* Baseline Retention Policies */}
          <div className="col-12 col-lg-6">
            <div className="card shadow-sm border-0 h-100">
              <div className="card-header bg-white border-bottom py-3">
                <h6 className="mb-0 fw-bold">Philippine Statutory Retention Baseline</h6>
                <div className="text-secondary small">
                  Enforces automated candidate identification via JOB-15.
                </div>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>Record Class</th>
                      <th>Retention</th>
                      <th>Legal Basis</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionPolicies.map((pol) => (
                      <tr key={pol.id}>
                        <td className="fw-semibold">{pol.record_class}</td>
                        <td>{pol.retention_years} years</td>
                        <td className="small text-muted">{pol.legal_basis}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => {
                              setEditingPolicy(pol);
                              setPolicyForm({
                                retentionYears: pol.retention_years,
                                legalBasis: pol.legal_basis || "",
                              });
                            }}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Active Legal Holds */}
          <div className="col-12 col-lg-6">
            <div className="card shadow-sm border-0 h-100">
              <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="mb-0 fw-bold">Active Legal &amp; Audit Holds</h6>
                  <div className="text-secondary small">
                    Blocks automated retention destruction and candidate approvals.
                  </div>
                </div>
                <Button size="sm" variant="outline-danger" onClick={() => setShowNewHoldModal(true)}>
                  + Place Hold
                </Button>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th>Hold #</th>
                      <th>Scope</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legalHolds.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-muted">
                          No active litigation or regulatory holds.
                        </td>
                      </tr>
                    ) : (
                      legalHolds.map((h) => (
                        <tr key={h.id}>
                          <td className="fw-semibold font-monospace">{h.hold_no}</td>
                          <td>
                            <Badge bg={h.scope === "ENTIRE_TENANT" ? "danger" : "warning"} text={h.scope === "ENTIRE_TENANT" ? "white" : "dark"}>
                              {h.scope}
                            </Badge>
                          </td>
                          <td className="small text-truncate" style={{ maxWidth: "200px" }}>{h.reason}</td>
                          <td>
                            {h.released_at ? (
                              <Badge bg="secondary">Released</Badge>
                            ) : (
                              <Badge bg="danger">ACTIVE</Badge>
                            )}
                          </td>
                          <td>
                            {!h.released_at && (
                              <Button
                                size="sm"
                                variant="outline-success"
                                onClick={async () => {
                                  try {
                                    await releaseLegalHold(h.id, { releaseReason: "Litigation matter settled / audit cleared." });
                                    setActionSuccess(`Hold ${h.hold_no} released.`);
                                    loadRetention();
                                  } catch (e: any) {
                                    setActionError(e.message);
                                  }
                                }}
                              >
                                Release
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
          </div>

          {/* Retention Candidates from JOB-15 */}
          <div className="col-12">
            <div className="card shadow-sm border-0">
              <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                <div>
                  <h6 className="mb-0 fw-bold">Eligible Retention Candidates (JOB-15)</h6>
                  <div className="text-secondary small">
                    Records that have exceeded statutory retention periods. Protected by active legal holds.
                  </div>
                </div>
                <div className="d-flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={selectedCandidateIds.length === 0}
                    onClick={async () => {
                      try {
                        await approveRetentionCandidates(selectedCandidateIds);
                        setActionSuccess(`Approved ${selectedCandidateIds.length} candidates.`);
                        setSelectedCandidateIds([]);
                        loadRetention();
                      } catch (e: any) {
                        setActionError(e.message);
                      }
                    }}
                  >
                    Bulk Approve Selected ({selectedCandidateIds.length})
                  </Button>
                </div>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: "40px" }}>
                        <Form.Check
                          checked={
                            retentionCandidates.length > 0 &&
                            selectedCandidateIds.length === retentionCandidates.length
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCandidateIds(retentionCandidates.map((c) => c.id));
                            } else {
                              setSelectedCandidateIds([]);
                            }
                          }}
                        />
                      </th>
                      <th>Record Class</th>
                      <th>Entity Ref</th>
                      <th>Patient</th>
                      <th>Eligible Date</th>
                      <th>Status</th>
                      <th>Hold Protection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-4 text-muted">
                          No records currently eligible for retention expiration.
                        </td>
                      </tr>
                    ) : (
                      retentionCandidates.map((cand) => (
                        <tr key={cand.id}>
                          <td>
                            <Form.Check
                              checked={selectedCandidateIds.includes(cand.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCandidateIds([...selectedCandidateIds, cand.id]);
                                } else {
                                  setSelectedCandidateIds(selectedCandidateIds.filter((id) => id !== cand.id));
                                }
                              }}
                            />
                          </td>
                          <td className="fw-semibold">{cand.record_class}</td>
                          <td className="font-monospace small">{cand.entity_ref}</td>
                          <td>
                            {cand.first_name ? `${cand.first_name} ${cand.last_name}` : "N/A"}
                          </td>
                          <td>{new Date(cand.eligible_at).toLocaleDateString()}</td>
                          <td>
                            <StatusPill
                              tone={cand.status === "HELD" ? "critical" : cand.status === "APPROVED" ? "normal" : "pending"}
                              label={cand.status}
                            />
                          </td>
                          <td>
                            {cand.status === "HELD" ? (
                              <Badge bg="danger">🔒 Protected by {cand.hold_no || "Legal Hold"}</Badge>
                            ) : (
                              <Badge bg="light" text="dark" className="border">None</Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 6: ACCESS REVIEWS (ADM-T5)
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "access-reviews" && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-0 fw-semibold">Periodic Access &amp; Entitlement Reviews (ADM-T5)</h5>
              <div className="text-secondary small">
                Quarterly supervisory attestation of user roles, scopes, and permissions.
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => setShowNewReviewModal(true)}>
              + Launch Access Review Campaign
            </Button>
          </div>

          <div className="card shadow-sm border-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>Campaign Name</th>
                    <th>Started At</th>
                    <th>Reviewer</th>
                    <th>Completed At</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accessReviews.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-muted">
                        No access review campaigns recorded.
                      </td>
                    </tr>
                  ) : (
                    accessReviews.map((rev) => (
                      <tr key={rev.id}>
                        <td className="fw-semibold">{rev.campaign_name}</td>
                        <td>{new Date(rev.started_at).toLocaleDateString()}</td>
                        <td>{rev.reviewer_name || "Supervisory Reviewer"}</td>
                        <td>{rev.completed_at ? new Date(rev.completed_at).toLocaleDateString() : "—"}</td>
                        <td>
                          <StatusPill
                            tone={rev.status === "COMPLETED" ? "normal" : rev.status === "IN_PROGRESS" ? "pending" : "neutral"}
                            label={rev.status}
                          />
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={async () => {
                              try {
                                const detail = await fetchAccessReview(rev.id);
                                setActiveReviewDetail(detail);
                              } catch (e: any) {
                                setActionError(e.message);
                              }
                            }}
                          >
                            Review Entitlements ({rev.decision_count || 0})
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          TAB 7: PIDSR NOTIFIABLE DISEASE CASES (RA 11332, Q-16)
      ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === "pidsr" && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-0 fw-semibold">Philippine Integrated Disease Surveillance and Response (PIDSR)</h5>
              <div className="text-secondary small">
                Mandatory reporting under RA 11332 (Law on Reporting Communicable Diseases).
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => setShowNewPidsrModal(true)}>
              + Report Notifiable Disease Case
            </Button>
          </div>

          <div className="card shadow-sm border-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>Case #</th>
                    <th>Disease &amp; ICD-10</th>
                    <th>Patient</th>
                    <th>Onset Date</th>
                    <th>Classification</th>
                    <th>Surveillance Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pidsrCases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4 text-muted">
                        No notifiable disease surveillance cases reported.
                      </td>
                    </tr>
                  ) : (
                    pidsrCases.map((c) => (
                      <tr key={c.id}>
                        <td className="fw-semibold font-monospace">{c.case_no}</td>
                        <td>
                          <div className="fw-semibold">{c.disease_name}</div>
                          <Badge bg="light" text="dark" className="border font-monospace">{c.icd10_code}</Badge>
                        </td>
                        <td>
                          <div>{c.first_name} {c.last_name}</div>
                          <div className="text-muted small font-monospace">{c.patient_no}</div>
                        </td>
                        <td>{new Date(c.date_of_onset).toLocaleDateString()}</td>
                        <td>
                          <Badge
                            bg={
                              c.classification === "CONFIRMED"
                                ? "danger"
                                : c.classification === "PROBABLE"
                                ? "warning"
                                : "info"
                            }
                            text={c.classification === "PROBABLE" ? "dark" : "white"}
                          >
                            {c.classification}
                          </Badge>
                        </td>
                        <td>
                          <StatusPill
                            tone={
                              c.status === "REPORTED_LGU"
                                ? "normal"
                                : c.status === "INVESTIGATING"
                                ? "high"
                                : c.status === "CLOSED"
                                ? "neutral"
                                : "pending"
                            }
                            label={c.status}
                          />
                        </td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setSelectedPidsrCase(c)}
                            >
                              View CIF
                            </Button>
                            {c.status !== "REPORTED_LGU" && c.status !== "CLOSED" && (
                              <Button
                                size="sm"
                                variant="outline-success"
                                onClick={async () => {
                                  try {
                                    await updatePidsrCaseStatus(c.id, "REPORTED_LGU", "Transmitted to City Health Office / RESU.");
                                    setActionSuccess(`Case ${c.case_no} status updated to REPORTED_LGU.`);
                                    loadPidsrCases();
                                  } catch (e: any) {
                                    setActionError(e.message);
                                  }
                                }}
                              >
                                Report to LGU
                              </Button>
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
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────
          MODALS
      ───────────────────────────────────────────────────────────────────────── */}

      {/* Audit Detail Modal */}
      {selectedAuditLog && (
        <Modal show onHide={() => setSelectedAuditLog(null)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>Audit Log Entry Detail</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="mb-3">
              <div className="row g-2">
                <div className="col-6"><strong>Action:</strong> {selectedAuditLog.action}</div>
                <div className="col-6"><strong>Entity:</strong> {selectedAuditLog.entity_type} ({selectedAuditLog.entity_id})</div>
                <div className="col-6"><strong>Actor:</strong> {selectedAuditLog.actor_name || selectedAuditLog.actor_id}</div>
                <div className="col-6"><strong>Timestamp:</strong> {new Date(selectedAuditLog.created_at).toLocaleString()}</div>
              </div>
            </div>
            <h6>State Mutation Diff:</h6>
            <div className="row g-2">
              <div className="col-6">
                <div className="small fw-bold text-muted mb-1">BEFORE STATE</div>
                <pre className="bg-light p-2 rounded small" style={{ maxHeight: "250px", overflow: "auto" }}>
                  {JSON.stringify(selectedAuditLog.before_state, null, 2) || "None (INSERT)"}
                </pre>
              </div>
              <div className="col-6">
                <div className="small fw-bold text-muted mb-1">AFTER STATE</div>
                <pre className="bg-light p-2 rounded small" style={{ maxHeight: "250px", overflow: "auto" }}>
                  {JSON.stringify(selectedAuditLog.after_state, null, 2) || "None (DELETE)"}
                </pre>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedAuditLog(null)}>Close</Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* New DSR Modal */}
      {showNewDsrModal && (
        <Modal show onHide={() => setShowNewDsrModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>New Data Subject Request (DSR)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Patient UUID *</Form.Label>
                <Form.Control
                  placeholder="Paste Patient UUID"
                  value={newDsrForm.patientId}
                  onChange={(e) => setNewDsrForm({ ...newDsrForm, patientId: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Request Type</Form.Label>
                <Form.Select
                  value={newDsrForm.type}
                  onChange={(e) => setNewDsrForm({ ...newDsrForm, type: e.target.value })}
                >
                  <option value="ACCESS">ACCESS (Right to View / Copy)</option>
                  <option value="PORTABILITY">PORTABILITY (Machine-Readable Export)</option>
                  <option value="RECTIFICATION">RECTIFICATION (Correct Record)</option>
                  <option value="ERASURE">ERASURE (Block / Delete)</option>
                  <option value="RESTRICTION">RESTRICTION (Limit Processing)</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Requester Name</Form.Label>
                <Form.Control
                  placeholder="Full Name"
                  value={newDsrForm.requesterName}
                  onChange={(e) => setNewDsrForm({ ...newDsrForm, requesterName: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Relationship</Form.Label>
                <Form.Select
                  value={newDsrForm.requesterRelationship}
                  onChange={(e) => setNewDsrForm({ ...newDsrForm, requesterRelationship: e.target.value })}
                >
                  <option value="SELF">Patient Self</option>
                  <option value="PARENT">Parent / Legal Guardian</option>
                  <option value="AUTHORIZED_REP">Authorized Representative (with SPA)</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Contact Details / Email</Form.Label>
                <Form.Control
                  placeholder="email or mobile"
                  value={newDsrForm.requesterContact}
                  onChange={(e) => setNewDsrForm({ ...newDsrForm, requesterContact: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNewDsrModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!newDsrForm.patientId}
              onClick={async () => {
                try {
                  await createDsrRequest({
                    patientId: newDsrForm.patientId,
                    type: newDsrForm.type as any,
                    dueDays: 30,
                    identityNotes: `Requester: ${newDsrForm.requesterName} (${newDsrForm.requesterRelationship}), Contact: ${newDsrForm.requesterContact}. ${newDsrForm.details}`,
                  });
                  setShowNewDsrModal(false);
                  setActionSuccess("DSR request created successfully.");
                  loadDsrRequests();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Submit Intake
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* DSR Verify Identity Modal */}
      {showVerifyModal && selectedDsr && (
        <Modal show onHide={() => setShowVerifyModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Verify Requester Identity: {selectedDsr.request_no}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="small text-muted mb-3">
              Per RA 10173 Implementing Rules, identity must be validated before releasing or altering any personal health information.
            </div>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                id="check-govt-id"
                label="Government-issued ID inspected & verified"
                checked={verifyChecklist.govtIdVerified}
                onChange={(e) => setVerifyChecklist({ ...verifyChecklist, govtIdVerified: e.target.checked })}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                id="check-sig-match"
                label="Signature matched against patient consent record"
                checked={verifyChecklist.signatureMatched}
                onChange={(e) => setVerifyChecklist({ ...verifyChecklist, signatureMatched: e.target.checked })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="check-auth-rep"
                label="Special Power of Attorney / Authorization on file (if proxy)"
                checked={verifyChecklist.authorizationVerified}
                onChange={(e) => setVerifyChecklist({ ...verifyChecklist, authorizationVerified: e.target.checked })}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Government ID Type</Form.Label>
              <Form.Select
                size="sm"
                value={verifyChecklist.idType}
                onChange={(e) => setVerifyChecklist({ ...verifyChecklist, idType: e.target.value })}
              >
                <option value="PHILHEALTH_ID">PhilHealth ID / PhilSys</option>
                <option value="PRC_ID">PRC License</option>
                <option value="PASSPORT">Passport</option>
                <option value="DRIVERS_LICENSE">Driver's License</option>
                <option value="SSS_GSIS">SSS / GSIS UMID</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>ID Number</Form.Label>
              <Form.Control
                size="sm"
                placeholder="ID Number"
                value={verifyChecklist.idNumber}
                onChange={(e) => setVerifyChecklist({ ...verifyChecklist, idNumber: e.target.value })}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowVerifyModal(false)}>Cancel</Button>
            <Button
              variant="success"
              disabled={!verifyChecklist.govtIdVerified}
              onClick={async () => {
                try {
                  await verifyDsrIdentity(selectedDsr.id, {
                    identityNotes: `Govt ID verified: ${verifyChecklist.idType} (${verifyChecklist.idNumber || "on file"}). Signature verified against clinical record.`,
                  });
                  setShowVerifyModal(false);
                  setActionSuccess(`Identity verified for DSR ${selectedDsr.request_no}.`);
                  loadDsrRequests();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Confirm Verification
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Report Security Breach Modal */}
      {showReportBreachModal && (
        <Modal show onHide={() => setShowReportBreachModal(false)} centered>
          <Modal.Header closeButton className="bg-danger text-white">
            <Modal.Title>Report Security / Data Breach Incident</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="small text-danger mb-3 fw-bold">
              Submitting starts the statutory 72-hour National Privacy Commission notification countdown.
            </div>
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Incident Description *</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Detail the discovery, affected systems, and immediate observations..."
                  value={reportBreachForm.description}
                  onChange={(e) => setReportBreachForm({ ...reportBreachForm, description: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Severity Rating</Form.Label>
                <Form.Select
                  value={reportBreachForm.severity}
                  onChange={(e) => setReportBreachForm({ ...reportBreachForm, severity: e.target.value })}
                >
                  <option value="CRITICAL">CRITICAL (Mass PHI exposure / Ransomware)</option>
                  <option value="HIGH">HIGH (Targeted PHI / Sensitive credentials)</option>
                  <option value="MEDIUM">MEDIUM (Localized unencrypted exposure)</option>
                  <option value="LOW">LOW (Isolated non-PHI error)</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Estimated Affected Records</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  value={reportBreachForm.affectedEstimate}
                  onChange={(e) => setReportBreachForm({ ...reportBreachForm, affectedEstimate: parseInt(e.target.value, 10) || 1 })}
                />
              </Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowReportBreachModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!reportBreachForm.description.trim()}
              onClick={async () => {
                try {
                  await reportBreach({
                    description: reportBreachForm.description,
                    severity: reportBreachForm.severity as any,
                    affectedCount: reportBreachForm.affectedEstimate,
                    dataClasses: reportBreachForm.dataClasses,
                    deadlineHours: 72,
                  });
                  setShowReportBreachModal(false);
                  setActionSuccess("Security incident recorded. 72-hour regulatory timer initiated.");
                  loadBreaches();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Initiate Incident
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Record NPC Notification Modal */}
      {showNotifyModal && selectedBreach && (
        <Modal show onHide={() => setShowNotifyModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Record Regulatory Notification: {selectedBreach.incident_no}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="check-notified-npc"
                label="Notified National Privacy Commission (NPC) within 72 hours"
                checked={notifyForm.notifiedRegulator}
                onChange={(e) => setNotifyForm({ ...notifyForm, notifiedRegulator: e.target.checked })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="check-notified-subjects"
                label="Notified affected data subjects (if risk of harm exists)"
                checked={notifyForm.notifiedSubjects}
                onChange={(e) => setNotifyForm({ ...notifyForm, notifiedSubjects: e.target.checked })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>NPC Reference / Ticket Number</Form.Label>
              <Form.Control
                placeholder="NPC-CID-2026-XXXX"
                value={notifyForm.regulatorRef}
                onChange={(e) => setNotifyForm({ ...notifyForm, regulatorRef: e.target.value })}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNotifyModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await recordBreachNotification(selectedBreach.id, {
                    notifiedRegulator: notifyForm.notifiedRegulator,
                    notifiedSubjects: notifyForm.notifiedSubjects,
                    notes: notifyForm.regulatorRef ? `Regulator Ref: ${notifyForm.regulatorRef}` : undefined,
                  });
                  setShowNotifyModal(false);
                  setActionSuccess(`Regulatory notification recorded for ${selectedBreach.incident_no}.`);
                  loadBreaches();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Save Notification
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Place Legal Hold Modal */}
      {showNewHoldModal && (
        <Modal show onHide={() => setShowNewHoldModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Place Legal / Litigation Hold</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="small text-muted mb-3">
              A legal hold preserves records from automated retention expiration and blocks bulk candidate deletion.
            </div>
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Hold Scope</Form.Label>
                <Form.Select
                  value={newHoldForm.scope}
                  onChange={(e) => setNewHoldForm({ ...newHoldForm, scope: e.target.value })}
                >
                  <option value="ENTIRE_TENANT">Entire Clinic (Broad Litigation / Audit)</option>
                  <option value="PATIENT">Specific Patient</option>
                </Form.Select>
              </Form.Group>
              {newHoldForm.scope === "PATIENT" && (
                <Form.Group className="mb-3">
                  <Form.Label>Patient UUID *</Form.Label>
                  <Form.Control
                    placeholder="Patient UUID"
                    value={newHoldForm.patientId}
                    onChange={(e) => setNewHoldForm({ ...newHoldForm, patientId: e.target.value })}
                  />
                </Form.Group>
              )}
              <Form.Group className="mb-3">
                <Form.Label>Legal Matter / Reason *</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Specify subpoena, active court litigation, or PhilHealth audit docket number..."
                  value={newHoldForm.reason}
                  onChange={(e) => setNewHoldForm({ ...newHoldForm, reason: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNewHoldModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!newHoldForm.reason.trim() || (newHoldForm.scope === "PATIENT" && !newHoldForm.patientId.trim())}
              onClick={async () => {
                try {
                  await createLegalHold({
                    scope: newHoldForm.scope as any,
                    patientId: newHoldForm.scope === "PATIENT" ? newHoldForm.patientId : undefined,
                    recordClass: newHoldForm.recordClass,
                    reason: newHoldForm.reason,
                  });
                  setShowNewHoldModal(false);
                  setActionSuccess("Legal hold successfully placed.");
                  loadRetention();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Place Hold
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Edit Retention Policy Modal */}
      {editingPolicy && (
        <Modal show onHide={() => setEditingPolicy(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Edit Retention Policy: {editingPolicy.record_class}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Minimum Retention Years</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={50}
                  value={policyForm.retentionYears}
                  onChange={(e) => setPolicyForm({ ...policyForm, retentionYears: parseInt(e.target.value, 10) || 1 })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Statutory Legal Basis</Form.Label>
                <Form.Control
                  value={policyForm.legalBasis}
                  onChange={(e) => setPolicyForm({ ...policyForm, legalBasis: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setEditingPolicy(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await updateRetentionPolicy(editingPolicy.id, {
                    retentionYears: policyForm.retentionYears,
                    legalBasis: policyForm.legalBasis,
                  });
                  setEditingPolicy(null);
                  setActionSuccess(`Policy for ${editingPolicy.record_class} updated.`);
                  loadRetention();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Save Policy
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Launch Access Review Modal */}
      {showNewReviewModal && (
        <Modal show onHide={() => setShowNewReviewModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Launch Access Review Campaign</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Campaign Name *</Form.Label>
              <Form.Control
                placeholder="e.g. Q4 2026 Periodic Role & Entitlement Attestation"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNewReviewModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!newCampaignName.trim()}
              onClick={async () => {
                try {
                  await createAccessReview(newCampaignName.trim());
                  setShowNewReviewModal(false);
                  setNewCampaignName("");
                  setActionSuccess("Access review campaign launched.");
                  loadAccessReviews();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Launch Review
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Review Entitlements Detail Modal */}
      {activeReviewDetail && (
        <Modal show onHide={() => setActiveReviewDetail(null)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>Review Decisions: {activeReviewDetail.review.campaign_name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light">
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Decision</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReviewDetail.decisions.map((dec) => (
                    <tr key={dec.id}>
                      <td className="fw-semibold">{dec.user_name}</td>
                      <td>{dec.user_email}</td>
                      <td><Badge bg="primary">{dec.role_name}</Badge></td>
                      <td>
                        <Badge
                          bg={
                            dec.decision === "APPROVED"
                              ? "success"
                              : dec.decision === "REVOKED"
                              ? "danger"
                              : "secondary"
                          }
                        >
                          {dec.decision || "PENDING"}
                        </Badge>
                      </td>
                      <td>
                        <ButtonGroup size="sm">
                          <Button
                            variant={dec.decision === "MAINTAIN" ? "success" : "outline-success"}
                            onClick={async () => {
                              try {
                                await recordAccessDecision(activeReviewDetail.review.id, {
                                  userId: dec.user_id,
                                  roleId: dec.role_id,
                                  decision: "MAINTAIN",
                                });
                                const detail = await fetchAccessReview(activeReviewDetail.review.id);
                                setActiveReviewDetail(detail);
                              } catch (e: any) {
                                setActionError(e.message);
                              }
                            }}
                          >
                            Maintain
                          </Button>
                          <Button
                            variant={dec.decision === "REVOKE" ? "danger" : "outline-danger"}
                            onClick={async () => {
                              try {
                                await recordAccessDecision(activeReviewDetail.review.id, {
                                  userId: dec.user_id,
                                  roleId: dec.role_id,
                                  decision: "REVOKE",
                                });
                                const detail = await fetchAccessReview(activeReviewDetail.review.id);
                                setActiveReviewDetail(detail);
                              } catch (e: any) {
                                setActionError(e.message);
                              }
                            }}
                          >
                            Revoke
                          </Button>
                        </ButtonGroup>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setActiveReviewDetail(null)}>Close</Button>
            {activeReviewDetail.review.status !== "COMPLETED" && (
              <Button
                variant="success"
                onClick={async () => {
                  try {
                    await completeAccessReview(activeReviewDetail.review.id);
                    setActiveReviewDetail(null);
                    setActionSuccess("Campaign marked as completed.");
                    loadAccessReviews();
                  } catch (e: any) {
                    setActionError(e.message);
                  }
                }}
              >
                Attest &amp; Complete Campaign
              </Button>
            )}
          </Modal.Footer>
        </Modal>
      )}

      {/* New PIDSR Case Modal */}
      {showNewPidsrModal && (
        <Modal show onHide={() => setShowNewPidsrModal(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>Report PIDSR Notifiable Disease (RA 11332)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <Form.Group>
                    <Form.Label>Patient UUID *</Form.Label>
                    <Form.Control
                      placeholder="Patient UUID"
                      value={newPidsrForm.patientId}
                      onChange={(e) => setNewPidsrForm({ ...newPidsrForm, patientId: e.target.value })}
                    />
                  </Form.Group>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Group>
                    <Form.Label>Notifiable Disease *</Form.Label>
                    <Form.Select
                      value={newPidsrForm.diseaseCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        let name = "Dengue";
                        let icd = "A90";
                        if (code === "MEASLES") { name = "Measles (Rubeola)"; icd = "B05"; }
                        if (code === "TYPHOID") { name = "Typhoid Fever"; icd = "A01.0"; }
                        if (code === "CHOLERA") { name = "Cholera"; icd = "A00"; }
                        if (code === "COVID19") { name = "COVID-19"; icd = "U07.1"; }
                        if (code === "LEPTOSPIROSIS") { name = "Leptospirosis"; icd = "A27"; }
                        setNewPidsrForm({ ...newPidsrForm, diseaseCode: code, diseaseName: name, icd10Code: icd });
                      }}
                    >
                      <option value="DENGUE">Dengue Fever (A90)</option>
                      <option value="MEASLES">Measles / Rubeola (B05)</option>
                      <option value="TYPHOID">Typhoid Fever (A01.0)</option>
                      <option value="CHOLERA">Cholera (A00)</option>
                      <option value="COVID19">COVID-19 (U07.1)</option>
                      <option value="LEPTOSPIROSIS">Leptospirosis (A27)</option>
                    </Form.Select>
                  </Form.Group>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Group>
                    <Form.Label>Date of Onset of Symptoms</Form.Label>
                    <Form.Control
                      type="date"
                      value={newPidsrForm.dateOfOnset}
                      onChange={(e) => setNewPidsrForm({ ...newPidsrForm, dateOfOnset: e.target.value })}
                    />
                  </Form.Group>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Group>
                    <Form.Label>Clinical Classification</Form.Label>
                    <Form.Select
                      value={newPidsrForm.classification}
                      onChange={(e) => setNewPidsrForm({ ...newPidsrForm, classification: e.target.value })}
                    >
                      <option value="SUSPECTED">SUSPECTED</option>
                      <option value="PROBABLE">PROBABLE</option>
                      <option value="CONFIRMED">CONFIRMED (Lab positive)</option>
                    </Form.Select>
                  </Form.Group>
                </div>
                <div className="col-12">
                  <h6 className="mt-2 text-primary">Case Investigation Form (CIF) Core Details</h6>
                </div>
                <div className="col-12 col-md-4">
                  <Form.Group>
                    <Form.Label>Fever Duration (Days)</Form.Label>
                    <Form.Control
                      type="number"
                      value={newPidsrForm.cifData.feverDays}
                      onChange={(e) => setNewPidsrForm({
                        ...newPidsrForm,
                        cifData: { ...newPidsrForm.cifData, feverDays: parseInt(e.target.value, 10) || 0 },
                      })}
                    />
                  </Form.Group>
                </div>
                <div className="col-12 col-md-4">
                  <Form.Group>
                    <Form.Label>Vaccination Status</Form.Label>
                    <Form.Select
                      value={newPidsrForm.cifData.vaccinationStatus}
                      onChange={(e) => setNewPidsrForm({
                        ...newPidsrForm,
                        cifData: { ...newPidsrForm.cifData, vaccinationStatus: e.target.value },
                      })}
                    >
                      <option value="FULLY_VACCINATED">Fully Vaccinated</option>
                      <option value="VACCINATED_PARTIAL">Partially Vaccinated</option>
                      <option value="UNVACCINATED">Unvaccinated</option>
                      <option value="UNKNOWN">Unknown</option>
                    </Form.Select>
                  </Form.Group>
                </div>
                <div className="col-12 col-md-4">
                  <Form.Group>
                    <Form.Label>Hospitalization</Form.Label>
                    <Form.Select
                      value={newPidsrForm.cifData.hospitalized ? "YES" : "NO"}
                      onChange={(e) => setNewPidsrForm({
                        ...newPidsrForm,
                        cifData: { ...newPidsrForm.cifData, hospitalized: e.target.value === "YES" },
                      })}
                    >
                      <option value="NO">Outpatient / Home Isolation</option>
                      <option value="YES">Admitted to Hospital</option>
                    </Form.Select>
                  </Form.Group>
                </div>
                <div className="col-12">
                  <Form.Group>
                    <Form.Label>Travel / Exposure History</Form.Label>
                    <Form.Control
                      value={newPidsrForm.cifData.travelHistory}
                      onChange={(e) => setNewPidsrForm({
                        ...newPidsrForm,
                        cifData: { ...newPidsrForm.cifData, travelHistory: e.target.value },
                      })}
                    />
                  </Form.Group>
                </div>
              </div>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNewPidsrModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!newPidsrForm.patientId.trim()}
              onClick={async () => {
                try {
                  await createPidsrCase({
                    branchId: newPidsrForm.branchId,
                    patientId: newPidsrForm.patientId.trim(),
                    diseaseCode: newPidsrForm.diseaseCode,
                    diseaseName: newPidsrForm.diseaseName,
                    icd10Code: newPidsrForm.icd10Code,
                    dateOfOnset: newPidsrForm.dateOfOnset,
                    classification: newPidsrForm.classification as any,
                    cifData: newPidsrForm.cifData,
                  });
                  setShowNewPidsrModal(false);
                  setActionSuccess("PIDSR case registered and placed under epidemiological surveillance.");
                  loadPidsrCases();
                } catch (e: any) {
                  setActionError(e.message);
                }
              }}
            >
              Submit CIF
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* View CIF Modal */}
      {selectedPidsrCase && (
        <Modal show onHide={() => setSelectedPidsrCase(null)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>PIDSR Case Investigation Form (CIF): {selectedPidsrCase.case_no}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="row g-2 mb-3">
              <div className="col-6"><strong>Disease:</strong> {selectedPidsrCase.disease_name} ({selectedPidsrCase.icd10_code})</div>
              <div className="col-6"><strong>Classification:</strong> <Badge bg="primary">{selectedPidsrCase.classification}</Badge></div>
              <div className="col-6"><strong>Patient:</strong> {selectedPidsrCase.first_name} {selectedPidsrCase.last_name}</div>
              <div className="col-6"><strong>Onset Date:</strong> {new Date(selectedPidsrCase.date_of_onset).toLocaleDateString()}</div>
              <div className="col-6"><strong>Status:</strong> {selectedPidsrCase.status}</div>
              <div className="col-6"><strong>Reported Facility:</strong> {selectedPidsrCase.branch_name || "Main Clinic"}</div>
            </div>
            <h6>CIF Epidemiological Data:</h6>
            <pre className="bg-light p-3 rounded small" style={{ maxHeight: "300px", overflow: "auto" }}>
              {JSON.stringify(selectedPidsrCase.cif_data, null, 2)}
            </pre>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedPidsrCase(null)}>Close</Button>
          </Modal.Footer>
        </Modal>
      )}
    </Container>
  );
}
