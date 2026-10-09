import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import {
  Alert,
  AlertBanner,
  Badge,
  Button,
  Form,
  Modal,
  ScanInput,
  StatusPill,
  Timeline,
  fuzzyFilter,
} from "@clinic/ui";
import { labApi, type WorklistItem, type LabTest, type LabSpecimenType } from "./api.js";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { PatientGroupedRequestList, type PatientGroup } from "../../shared/dispensing/PatientGroupedRequestList.js";

type StageTab = "ALL" | "ORDERED" | "COLLECTED" | "RECEIVED" | "IN_PROGRESS" | "RESULTED" | "VERIFIED" | "RELEASED";

export function LabWorklistPage() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<StageTab>("ALL");
  const [searchFilter, setSearchFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");

  // Tests & Specimen types catalog for order modal
  const [tests, setTests] = useState<LabTest[]>([]);
  const [specimenTypes, setSpecimenTypes] = useState<LabSpecimenType[]>([]);

  // Modals state
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WorklistItem | null>(null);
  const [specimenEvents, setSpecimenEvents] = useState<any[]>([]);

  // Order Form State
  const [orderPatientId, setOrderPatientId] = useState("");
  const [orderPatientName, setOrderPatientName] = useState("");
  const [orderPriority, setOrderPriority] = useState<"ROUTINE" | "URGENT" | "STAT">("ROUTINE");
  const [orderSelectedTests, setOrderSelectedTests] = useState<string[]>([]);
  const [orderTestSearch, setOrderTestSearch] = useState("");
  const [orderClinicalInfo, setOrderClinicalInfo] = useState("");
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  // Collect Form State
  const [collectSite, setCollectSite] = useState("Left Antecubital Fossa");
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [collectSubmitting, setCollectSubmitting] = useState(false);

  // Receive Form State
  const [receiveCondition, setReceiveCondition] = useState<"OK" | "HEMOLYZED" | "INSUFFICIENT" | "CLOTTED" | "MISLABELED">("OK");
  const [rejectionReason, setRejectionReason] = useState("");
  const [storageLocation, setStorageLocation] = useState("Rack A-1 (Main Lab)");
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await labApi.getWorklist();
      setItems(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load laboratory worklist");
    } finally {
      setLoading(false);
    }
  };

  const loadCatalog = async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        labApi.listTests(),
        labApi.listSpecimenTypes(),
      ]);
      setTests(tRes);
      setSpecimenTypes(sRes);
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    loadData();
    loadCatalog();
  }, []);

  // Fuzzy, client-side search over the loaded test catalogue so large panels
  // lists are searchable by name or code (matches the consultation request
  // picker), instead of an unsearchable scrolling checkbox list.
  const orderTestOptions = useMemo(
    () => fuzzyFilter(tests, orderTestSearch, (t) => `${t.name} (${t.code})`),
    [tests, orderTestSearch],
  );

  // Filtered Items
  const filteredItems = items.filter((item) => {
    // Tab filter
    if (activeTab !== "ALL" && item.item_status !== activeTab) return false;
    // Priority filter
    if (priorityFilter !== "ALL" && item.priority !== priorityFilter) return false;
    // Search query
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matchNo = item.order_no.toLowerCase().includes(q);
      const matchAcc = item.accession_no?.toLowerCase().includes(q) ?? false;
      const patientName = `${item.given_name || (item as any).first_name || ""} ${item.family_name || (item as any).last_name || ""}`;
      const matchPatient = patientName.toLowerCase().includes(q);
      const matchMrn = item.mrn?.toLowerCase().includes(q) ?? false;
      const matchTest = item.test_name.toLowerCase().includes(q) || item.test_code.toLowerCase().includes(q);
      return matchNo || matchAcc || matchPatient || matchMrn || matchTest;
    }
    return true;
  });

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // Group lab items by Patient (Unified Concept)
  const labPatientGroups = useMemo((): PatientGroup<WorklistItem>[] => {
    const map = new Map<string, PatientGroup<WorklistItem>>();
    for (const item of filteredItems) {
      const pId = item.patient_id || item.mrn || "unknown";
      const existing = map.get(pId);
      const pName = `${item.family_name || (item as any).last_name || ""} ${item.given_name || (item as any).first_name || ""}`.trim() || "Unknown Patient";
      if (!existing) {
        map.set(pId, {
          patientId: pId,
          patientName: pName,
          patientIdDisplay: item.mrn || null,
          pendingCount: 1,
          oldestRequestAt: item.ordered_at || null,
          requests: [item],
          meta: {
            hasStat: item.priority === "STAT",
            hasUrgent: item.priority === "URGENT",
            orderNos: [item.order_no],
          },
        });
      } else {
        existing.requests.push(item);
        existing.pendingCount += 1;
        if (item.priority === "STAT") existing.meta!.hasStat = true;
        if (item.priority === "URGENT") existing.meta!.hasUrgent = true;
        if (item.order_no && !existing.meta!.orderNos.includes(item.order_no)) {
          existing.meta!.orderNos.push(item.order_no);
        }
        if (item.ordered_at && (!existing.oldestRequestAt || item.ordered_at < existing.oldestRequestAt)) {
          existing.oldestRequestAt = item.ordered_at;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.meta?.hasStat && !b.meta?.hasStat) return -1;
      if (!a.meta?.hasStat && b.meta?.hasStat) return 1;
      return String(a.oldestRequestAt ?? "").localeCompare(String(b.oldestRequestAt ?? ""));
    });
  }, [filteredItems]);

  // Handle Order Submit
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderPatientId.trim() || orderSelectedTests.length === 0) {
      alert("Please provide a Patient ID and select at least one test.");
      return;
    }
    try {
      setOrderSubmitting(true);
      await labApi.createOrder({
        branchId: session?.branchId || "00000000-0000-0000-0000-000000000001",
        patientId: orderPatientId.trim(),
        priority: orderPriority,
        testIds: orderSelectedTests,
        clinicalInfo: orderClinicalInfo || undefined,
        source: "VISIT",
      });
      setIsOrderModalOpen(false);
      setOrderSelectedTests([]);
      setOrderTestSearch("");
      setOrderClinicalInfo("");
      await loadData();
    } catch (err: any) {
      alert(`Order error: ${err.message}`);
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Handle Specimen Collect
  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!idConfirmed) {
      alert("You must verify two patient identifiers (e.g. Full Name and Date of Birth).");
      return;
    }
    try {
      // Refuse to accession with a made-up specimen type. This used to fall back to
      // the literal "00000000-0000-0000-0000-000000000001", which is not a valid
      // UUID for the contract (version nibble must be 1-8), so Zod rejected it and
      // the request surfaced as an opaque 500. If the test carries no specimen type
      // the honest outcome is a visible message, not a fabricated identifier.
      if (!selectedItem.specimen_type_id) {
        setCollectSubmitting(false);
        alert(
          `Cannot accession ${selectedItem.order_no}: ${selectedItem.test_name} has no ` +
            `specimen type configured. A specimen type must be set on the test before collection.`,
        );
        return;
      }
      setCollectSubmitting(true);
      await labApi.collectSpecimen(selectedItem.order_id, selectedItem.item_id, {
        specimenTypeId: selectedItem.specimen_type_id,
        collectionSite: collectSite,
        twoIdentifiersVerified: true,
      });
      setIsCollectModalOpen(false);
      setSelectedItem(null);
      await loadData();
    } catch (err: any) {
      alert(`Collection error: ${err.message}`);
    } finally {
      setCollectSubmitting(false);
    }
  };

  // Handle Specimen Receive / Reject
  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (receiveCondition !== "OK" && !rejectionReason.trim()) {
      alert("Please provide a rejection reason when marking specimen condition as rejected/compromised.");
      return;
    }
    try {
      setReceiveSubmitting(true);
      await labApi.receiveSpecimen(selectedItem.order_id, selectedItem.item_id, {
        condition: receiveCondition,
        rejectionReason: receiveCondition !== "OK" ? rejectionReason : undefined,
        storageLocation: receiveCondition === "OK" ? storageLocation : undefined,
      });
      setIsReceiveModalOpen(false);
      setSelectedItem(null);
      await loadData();
    } catch (err: any) {
      alert(`Receive error: ${err.message}`);
    } finally {
      setReceiveSubmitting(false);
    }
  };

  // View Chain of Custody Timeline
  const openTimeline = async (item: WorklistItem) => {
    setSelectedItem(item);
    setIsTimelineModalOpen(true);
    setSpecimenEvents([]);
    try {
      // Find specimen by accession
      if (item.accession_no) {
        const specList = await labApi.listSpecimens(item.accession_no);
        if (specList && specList.length > 0) {
          const events = await labApi.getSpecimenEvents(specList[0].id);
          setSpecimenEvents(events);
        }
      }
    } catch {
      // non-blocking
    }
  };

  const headerActions = (
    <div className="d-flex gap-2">
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={loadData}
        title="Refresh worklist"
      >
        🔄 Refresh
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setIsOrderModalOpen(true)}
      >
        ➕ Place Lab Order
      </Button>
    </div>
  );

  const metricsHeader = (
    <div className="card shadow-sm">
      <div className="card-header bg-white border-bottom-0 pb-0 pt-2 px-3">
        <ul className="nav nav-tabs card-header-tabs" role="tablist">
          {(
            [
              { key: "ALL", label: "All Items" },
              { key: "ORDERED", label: "Ordered" },
              { key: "COLLECTED", label: "Collected" },
              { key: "RECEIVED", label: "Received" },
              { key: "IN_PROGRESS", label: "In Progress" },
              { key: "RESULTED", label: "Resulted" },
              { key: "VERIFIED", label: "Verified" },
              { key: "RELEASED", label: "Released" },
            ] as const
          ).map((tab) => {
            const count = items.filter((i) =>
              tab.key === "ALL" ? true : i.item_status === tab.key
            ).length;
            return (
              <li className="nav-item" key={tab.key}>
                <button
                  className={`nav-link ${activeTab === tab.key ? "active fw-bold text-primary" : "text-secondary"}`}
                  onClick={() => setActiveTab(tab.key)}
                  type="button"
                  style={{ cursor: "pointer" }}
                >
                  {tab.label}
                  <span
                    className={`badge ms-2 ${
                      activeTab === tab.key
                        ? "bg-primary text-white"
                        : "bg-light text-dark border"
                    }`}
                    style={{ fontSize: "0.72rem" }}
                  >
                    {count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card-body p-3 bg-light border-top">
        <div className="row g-2 align-items-center">
          <div className="col-12 col-md-5">
            <ScanInput
              label="Accession Scanner"
              placeholder="Scan Accession barcode or search MRN / patient / test…"
              value={searchFilter}
              onChange={setSearchFilter}
              onScan={(val) => setSearchFilter(val)}
              autoFocus
            />
          </div>
          <div className="col-6 col-md-3">
            <Form.Select
              size="sm"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              aria-label="Filter by priority"
            >
              <option value="ALL">All Priorities</option>
              <option value="STAT">⚡ STAT Priority Only</option>
              <option value="URGENT">⚠️ URGENT Only</option>
              <option value="ROUTINE">Routine Only</option>
            </Form.Select>
          </div>
          <div className="col-6 col-md-4 text-end">
            <span className="small text-muted">
              Showing <strong>{filteredItems.length}</strong> items across <strong>{labPatientGroups.length}</strong> patients
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="container-fluid py-3 px-4">
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)} className="mb-3">
          {error}
        </Alert>
      )}

      <PatientGroupedRequestList<WorklistItem>
        module="LAB"
        title="Laboratory Workbench & Worklist"
        subtitle="End-to-end laboratory execution: accessioning, collection, analytical testing, and verification."
        groups={labPatientGroups}
        loading={loading}
        selectedPatientId={selectedPatientId}
        onSelectPatient={setSelectedPatientId}
        headerActions={headerActions}
        metricsHeader={metricsHeader}
        selectButtonLabel="Select Patient"
        searchPlaceholder="Filter patients by name or MRN…"
        renderRequests={(group) => (
          <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
              <h3 className="h6 fw-bold mb-0 text-dark">
                Laboratory Test Requests for {group.patientName}
              </h3>
              <span className="badge bg-primary-subtle text-primary">
                {group.requests.length} Test{group.requests.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.875rem" }}>
                <thead className="table-light text-muted small text-uppercase">
                  <tr>
                    <th style={{ width: "120px" }}>Priority</th>
                    <th>Order / Accession</th>
                    <th>Test / Panel</th>
                    <th>Specimen</th>
                    <th>Status</th>
                    <th>Timeline</th>
                    <th className="text-end" style={{ minWidth: "160px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.requests.map((item) => {
                    const isStat = item.priority === "STAT";
                    const isUrgent = item.priority === "URGENT";

                    return (
                      <tr
                        key={item.item_id || (item as any).order_item_id || `${item.order_id}-${item.test_id}`}
                        className={isStat ? "table-danger" : isUrgent ? "table-warning" : ""}
                      >
                        <td>
                          {isStat && (
                            <span className="badge bg-danger text-white fw-bold px-2 py-1">
                              ⚡ STAT
                            </span>
                          )}
                          {isUrgent && (
                            <span className="badge bg-warning text-dark fw-bold px-2 py-1">
                              ⚠️ URGENT
                            </span>
                          )}
                          {!isStat && !isUrgent && (
                            <span className="badge bg-secondary-subtle text-secondary px-2 py-1">
                              ROUTINE
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="fw-semibold text-primary">{item.order_no}</div>
                          {item.accession_no ? (
                            <div className="small font-monospace text-dark">
                              🏷️ {item.accession_no}
                            </div>
                          ) : (
                            <span className="small text-muted fst-italic">Pending Accession</span>
                          )}
                        </td>
                        <td>
                          <div className="fw-semibold">{item.test_name}</div>
                          <div className="small text-muted font-monospace">
                            {item.test_code}
                            {item.is_panel && <span className="badge bg-info-subtle text-info ms-1">Panel</span>}
                            {item.requires_pathologist_review && (
                              <span className="badge bg-purple-subtle text-purple ms-1" style={{ color: "#6f42c1" }}>
                                Pathologist
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div>{item.specimen_type_name || "Serum / Blood"}</div>
                          {item.tube_top_color && (
                            <span
                              className="badge border"
                              style={{
                                backgroundColor: item.tube_top_color.toLowerCase() === "lavender" ? "#e6e6fa" : "#fff",
                                color: "#333",
                                fontSize: "0.72rem",
                              }}
                            >
                              Top: {item.tube_top_color}
                            </span>
                          )}
                          {item.specimen_condition && item.specimen_condition !== "OK" && (
                            <span className="badge bg-danger ms-1">
                              {item.specimen_condition}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusPill
                            tone={
                              item.item_status === "RELEASED" || item.item_status === "VERIFIED"
                                ? "normal"
                                : item.item_status === "IN_PROGRESS"
                                ? "pending"
                                : item.item_status === "REJECTED"
                                ? "critical"
                                : "neutral"
                            }
                            label={item.item_status}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-decoration-none"
                            onClick={() => openTimeline(item)}
                            title="View chain-of-custody timeline"
                          >
                            🕒 Timeline
                          </button>
                        </td>
                        <td className="text-end">
                          {item.item_status === "ORDERED" && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setSelectedItem(item);
                                setIdConfirmed(false);
                                setIsCollectModalOpen(true);
                              }}
                            >
                              🩸 Collect Specimen
                            </Button>
                          )}

                          {item.item_status === "COLLECTED" && (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => {
                                setSelectedItem(item);
                                setReceiveCondition("OK");
                                setRejectionReason("");
                                setIsReceiveModalOpen(true);
                              }}
                            >
                              📥 Receive at Bench
                            </Button>
                          )}

                          {item.item_status === "RECEIVED" && (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => navigate(`/laboratory/results?orderId=${item.order_id}&itemId=${item.item_id}`)}
                            >
                              📝 Enter Results
                            </Button>
                          )}

                          {item.item_status === "IN_PROGRESS" && (
                            <Button
                              size="sm"
                              variant="warning"
                              onClick={() => navigate(`/laboratory/results?orderId=${item.order_id}&itemId=${item.item_id}`)}
                            >
                              ✍️ Complete Results
                            </Button>
                          )}

                          {item.item_status === "RESULTED" && (
                            <Button
                              size="sm"
                              variant="info"
                              onClick={() => navigate(`/laboratory/verification`)}
                            >
                              🛡️ Review &amp; Verify
                            </Button>
                          )}

                          {(item.item_status === "VERIFIED" || item.item_status === "RELEASED") && (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => navigate(`/laboratory/reports`)}
                            >
                              📄 View Report
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      />

      {/* ── Modal 1: Place Lab Order ────────────────────────────────────────── */}
      <Modal show={isOrderModalOpen} onHide={() => setIsOrderModalOpen(false)} size="lg">
        <form onSubmit={handleCreateOrder}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">Place Laboratory Order</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="row g-3">
              <div className="col-12 col-md-6">
                <Form.Label className="small fw-semibold">Patient ID / MRN *</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. 00000000-0000-0000-0000-000000000001"
                  value={orderPatientId}
                  onChange={(e) => setOrderPatientId(e.target.value)}
                  required
                />
                <Form.Text className="text-muted">Enter registered patient UUID</Form.Text>
              </div>

              <div className="col-12 col-md-6">
                <Form.Label className="small fw-semibold">Clinical Priority *</Form.Label>
                <Form.Select
                  value={orderPriority}
                  onChange={(e: any) => setOrderPriority(e.target.value)}
                >
                  <option value="ROUTINE">ROUTINE (Standard turnaround)</option>
                  <option value="URGENT">URGENT (Expedited review)</option>
                  <option value="STAT">STAT (Immediate life-critical run)</option>
                </Form.Select>
              </div>

              <div className="col-12">
                <Form.Label className="small fw-semibold">Select Tests &amp; Panels *</Form.Label>
                <Form.Control
                  type="search"
                  size="sm"
                  className="mb-2"
                  placeholder="Search tests & panels by name or code…"
                  value={orderTestSearch}
                  onChange={(e) => setOrderTestSearch(e.target.value)}
                  aria-label="Search tests and panels"
                />
                <div
                  className="border rounded p-2"
                  style={{ maxHeight: "200px", overflowY: "auto" }}
                >
                  {orderTestOptions.length === 0 ? (
                    <div className="text-muted small p-2">No matching tests or panels.</div>
                  ) : (
                    orderTestOptions.map((t) => {
                    const checked = orderSelectedTests.includes(t.id);
                    return (
                      <div
                        key={t.id}
                        className="form-check py-1 border-bottom d-flex align-items-center justify-content-between"
                      >
                        <div>
                          <input
                            type="checkbox"
                            className="form-check-input me-2"
                            id={`test-${t.id}`}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setOrderSelectedTests([...orderSelectedTests, t.id]);
                              } else {
                                setOrderSelectedTests(orderSelectedTests.filter((id) => id !== t.id));
                              }
                            }}
                          />
                          <label className="form-check-label fw-semibold" htmlFor={`test-${t.id}`}>
                            {t.name} ({t.code})
                          </label>
                          {t.is_panel && (
                            <span className="badge bg-info-subtle text-info ms-2">
                              Panel
                            </span>
                          )}
                          {t.fasting_required && (
                            <span className="badge bg-warning-subtle text-warning ms-1">
                              Fasting {t.fasting_hours ? `(${t.fasting_hours}h)` : ""}
                            </span>
                          )}
                        </div>
                        <span className="small text-muted">
                          TAT: {t.tat_minutes}m
                        </span>
                      </div>
                    );
                  })
                  )}
                </div>
              </div>

              <div className="col-12">
                <Form.Label className="small fw-semibold">Clinical Indications / Notes</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  placeholder="e.g. Rule out anemia, routine pre-op clearance…"
                  value={orderClinicalInfo}
                  onChange={(e) => setOrderClinicalInfo(e.target.value)}
                />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsOrderModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={orderSubmitting}>
              {orderSubmitting ? "Placing Order…" : "Confirm Order"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ── Modal 2: Specimen Collection ────────────────────────────────────── */}
      <Modal show={isCollectModalOpen} onHide={() => setIsCollectModalOpen(false)}>
        <form onSubmit={handleCollect}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">🩸 Specimen Collection (Phlebotomy)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedItem && (
              <div className="mb-3 p-3 bg-light rounded border">
                <div className="fw-bold">{selectedItem.test_name}</div>
                <div className="small text-muted">
                  Patient: {selectedItem.family_name}, {selectedItem.given_name} (MRN: {selectedItem.mrn || "N/A"})
                </div>
                <div className="small text-muted">
                  Container Top: {selectedItem.tube_top_color || "Standard"}
                </div>
              </div>
            )}

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Anatomical Collection Site</Form.Label>
              <Form.Select
                value={collectSite}
                onChange={(e) => setCollectSite(e.target.value)}
              >
                <option value="Left Antecubital Fossa">Left Antecubital Fossa</option>
                <option value="Right Antecubital Fossa">Right Antecubital Fossa</option>
                <option value="Dorsal Hand Vein">Dorsal Hand Vein</option>
                <option value="Capillary Fingerstick">Capillary Fingerstick</option>
                <option value="Clean Catch Urine">Clean Catch Midstream Urine</option>
                <option value="Nasopharyngeal Swab">Nasopharyngeal Swab</option>
              </Form.Select>
            </div>

            <div className="p-3 border rounded bg-warning-subtle mb-3">
              <div className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="confirm-id"
                  checked={idConfirmed}
                  onChange={(e) => setIdConfirmed(e.target.checked)}
                  required
                />
                <label className="form-check-label fw-bold small text-dark" htmlFor="confirm-id">
                  Two-Identifier Verification Confirmed
                </label>
              </div>
              <p className="small text-muted mb-0 mt-1">
                I have verified the patient identity using two distinct identifiers (Full Name and DOB/MRN) prior to tube labeling.
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsCollectModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={collectSubmitting || !idConfirmed}>
              {collectSubmitting ? "Accessioning…" : "Collect & Print Accession"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ── Modal 3: Specimen Receive / Rejection ─────────────────────────────── */}
      <Modal show={isReceiveModalOpen} onHide={() => setIsReceiveModalOpen(false)}>
        <form onSubmit={handleReceive}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">📥 Specimen Bench Receiving &amp; Quality Check</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedItem && (
              <div className="mb-3 p-3 bg-light rounded border">
                <div className="fw-bold">{selectedItem.test_name}</div>
                <div className="small text-muted">
                  Accession: <strong>{selectedItem.accession_no}</strong>
                </div>
                <div className="small text-muted">
                  Patient: {selectedItem.family_name}, {selectedItem.given_name}
                </div>
              </div>
            )}

            <div className="mb-3">
              <Form.Label className="small fw-semibold">Specimen Condition</Form.Label>
              <Form.Select
                value={receiveCondition}
                onChange={(e: any) => setReceiveCondition(e.target.value)}
              >
                <option value="OK">✅ OK (Adequate volume, non-hemolyzed)</option>
                <option value="HEMOLYZED">❌ Hemolyzed (Gross hemolysis)</option>
                <option value="INSUFFICIENT">❌ Insufficient Volume (QNS)</option>
                <option value="CLOTTED">❌ Clotted Specimen</option>
                <option value="MISLABELED">❌ Mislabeled / Unlabeled Container</option>
              </Form.Select>
            </div>

            {receiveCondition === "OK" ? (
              <div className="mb-3">
                <Form.Label className="small fw-semibold">Bench / Storage Location</Form.Label>
                <Form.Control
                  type="text"
                  value={storageLocation}
                  onChange={(e) => setStorageLocation(e.target.value)}
                  placeholder="e.g. Rack A-1, Chemistry Centrifuge"
                />
              </div>
            ) : (
              <div className="p-3 bg-danger-subtle rounded border mb-3">
                <Form.Label className="small fw-bold text-danger">Rejection Reason *</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Describe specimen condition failure for recollection request…"
                  required
                />
                <Form.Text className="text-danger small mt-1">
                  ⚠️ Rejecting this specimen will automatically create a recollection task.
                </Form.Text>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsReceiveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={receiveCondition === "OK" ? "success" : "danger"}
              type="submit"
              disabled={receiveSubmitting}
            >
              {receiveSubmitting ? "Processing…" : receiveCondition === "OK" ? "Accept & Receive" : "Reject Specimen"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ── Modal 4: Chain-of-Custody Timeline ──────────────────────────────── */}
      <Modal show={isTimelineModalOpen} onHide={() => setIsTimelineModalOpen(false)}>
        <Modal.Header closeButton>
          <Modal.Title className="h5">🕒 Specimen Chain of Custody</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedItem && (
            <div className="mb-3">
              <div className="fw-bold">{selectedItem.test_name}</div>
              <div className="small text-muted font-monospace">
                Accession: {selectedItem.accession_no || "Unaccessioned"}
              </div>
            </div>
          )}

          {specimenEvents.length === 0 ? (
            <p className="text-muted small">No recorded custody events for this specimen.</p>
          ) : (
            <div className="timeline-container ps-2">
              {specimenEvents.map((ev, i) => (
                <div key={ev.id || i} className="d-flex gap-3 mb-3">
                  <div
                    className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center"
                    style={{ width: "28px", height: "28px", minWidth: "28px", fontSize: "0.75rem" }}
                  >
                    ✓
                  </div>
                  <div>
                    <div className="fw-semibold small">{ev.event}</div>
                    <div className="small text-muted">
                      {new Date(ev.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsTimelineModalOpen(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
