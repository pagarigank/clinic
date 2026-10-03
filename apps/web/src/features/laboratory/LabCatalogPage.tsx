import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill, Button, Modal, Form } from "@clinic/ui";
import {
  labApi,
  type LabTest,
  type LabSection,
  type LabSpecimenType,
} from "./api.js";
import { usePermissions } from "../../shared/auth/PermissionsContext.js";
import type { BulkPriceAdjustRequest } from "@clinic/contracts";

export function LabCatalogPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("lab.config.create") || hasPermission("admin.service.create");
  const canUpdate = hasPermission("lab.config.update") || hasPermission("admin.service.update");

  const [tests, setTests] = useState<LabTest[]>([]);
  const [sections, setSections] = useState<LabSection[]>([]);
  const [specimenTypes, setSpecimenTypes] = useState<LabSpecimenType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedSection, setSelectedSection] = useState("ALL");
  const [selectedSpecimen, setSelectedSpecimen] = useState("ALL");
  const [panelFilter, setPanelFilter] = useState<"ALL" | "SINGLE" | "PANEL">("ALL");

  // Create Modal
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formSectionId, setFormSectionId] = useState("");
  const [formSpecimenTypeId, setFormSpecimenTypeId] = useState("");
  const [formPrice, setFormPrice] = useState("0");
  const [formTat, setFormTat] = useState("60");
  const [formLoinc, setFormLoinc] = useState("");
  const [formIsStat, setFormIsStat] = useState(true);
  const [formIsConfidential, setFormIsConfidential] = useState(false);
  const [formFastingRequired, setFormFastingRequired] = useState(false);
  const [formFastingHours, setFormFastingHours] = useState("8");
  const [formIsPanel, setFormIsPanel] = useState(false);
  const [formSelectedChildTestIds, setFormSelectedChildTestIds] = useState<Set<string>>(new Set());
  const [formPathologistReview, setFormPathologistReview] = useState(false);
  const [formInstructions, setFormInstructions] = useState("");

  // Edit Modal
  const [editTarget, setEditTarget] = useState<LabTest | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editPrice, setEditPrice] = useState("0");
  const [editTat, setEditTat] = useState("60");
  const [editInstructions, setEditInstructions] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // Bulk Price Adjustment Modal
  const [showBulkPrice, setShowBulkPrice] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<"LABORATORY" | "PHARMACY" | "CENTRAL_SUPPLY" | "ALL">("LABORATORY");
  const [bulkDirection, setBulkDirection] = useState<"INCREASE" | "DECREASE">("INCREASE");
  const [bulkType, setBulkType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [bulkValue, setBulkValue] = useState("5");
  const [bulkReason, setBulkReason] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [testList, sectionList, specimenList] = await Promise.all([
        labApi.listTests(),
        labApi.listSections().catch(() => []),
        labApi.listSpecimenTypes().catch(() => []),
      ]);
      setTests(testList);
      setSections(sectionList);
      setSpecimenTypes(specimenList);
    } catch (err: any) {
      setError(err?.message || "Failed to load laboratory catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filtered Tests
  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      const q = search.toLowerCase();
      const matchSearch =
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.loinc_code && t.loinc_code.toLowerCase().includes(q));

      const matchSection = selectedSection === "ALL" || t.section_id === selectedSection;
      const matchSpecimen = selectedSpecimen === "ALL" || t.specimen_type_id === selectedSpecimen;
      const matchPanel =
        panelFilter === "ALL" ||
        (panelFilter === "PANEL" && t.is_panel) ||
        (panelFilter === "SINGLE" && !t.is_panel);

      return matchSearch && matchSection && matchSpecimen && matchPanel;
    });
  }, [tests, search, selectedSection, selectedSpecimen, panelFilter]);

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createBusy) return;

    if (!formCode.trim() || !formName.trim() || !formSectionId || !formSpecimenTypeId) {
      setError("Please fill in Code, Name, Section, and Specimen Type.");
      return;
    }

    setCreateBusy(true);
    setError(null);
    try {
      await labApi.createTest({
        code: formCode.trim().toUpperCase(),
        name: formName.trim(),
        sectionId: formSectionId,
        specimenTypeId: formSpecimenTypeId,
        price: Number(formPrice) || 0,
        tatMinutes: Number(formTat) || 60,
        loincCode: formLoinc.trim() || undefined,
        isStatAllowed: formIsStat,
        isConfidential: formIsConfidential,
        fastingRequired: formFastingRequired,
        fastingHours: formFastingRequired ? Number(formFastingHours) || 8 : undefined,
        isPanel: formIsPanel,
        panelTestIds: formIsPanel ? [...formSelectedChildTestIds] : undefined,
        requiresPathologistReview: formPathologistReview,
        instructions: formInstructions.trim() || undefined,
        isActive: true,
      });

      setInfo(`Laboratory test "${formName.trim()}" successfully created and added to fee schedule.`);
      setShowCreate(false);
      resetCreateForm();
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to create laboratory test");
    } finally {
      setCreateBusy(false);
    }
  };

  const resetCreateForm = () => {
    setFormCode("");
    setFormName("");
    setFormSectionId(sections[0]?.id || "");
    setFormSpecimenTypeId(specimenTypes[0]?.id || "");
    setFormPrice("0");
    setFormTat("60");
    setFormLoinc("");
    setFormIsStat(true);
    setFormIsConfidential(false);
    setFormFastingRequired(false);
    setFormFastingHours("8");
    setFormIsPanel(false);
    setFormSelectedChildTestIds(new Set());
    setFormPathologistReview(false);
    setFormInstructions("");
  };

  const openEditModal = (t: LabTest) => {
    setEditTarget(t);
    setEditName(t.name);
    setEditCode(t.code);
    setEditPrice(String(t.price ?? 0));
    setEditTat(String(t.tat_minutes));
    setEditInstructions(t.instructions || "");
    setEditIsActive(t.is_active);
    setError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || editBusy) return;

    setEditBusy(true);
    setError(null);
    try {
      await labApi.updateTest(editTarget.id, {
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
        price: Number(editPrice) || 0,
        tatMinutes: Number(editTat) || 60,
        instructions: editInstructions.trim() || undefined,
        isActive: editIsActive,
      });

      setInfo(`Laboratory test "${editName.trim()}" updated successfully.`);
      setEditTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to update laboratory test");
    } finally {
      setEditBusy(false);
    }
  };

  const handleApplyBulkPricing = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(bulkValue);
    if (isNaN(val) || val <= 0) {
      setError("Please provide a valid adjustment value greater than 0.");
      return;
    }

    setBulkBusy(true);
    setError(null);
    try {
      const payload: BulkPriceAdjustRequest = {
        target: bulkTarget,
        direction: bulkDirection,
        adjustmentType: bulkType,
        value: val,
        reason: bulkReason.trim() || undefined,
      };

      const res = await labApi.bulkAdjustPricing(payload);
      setInfo(res.message);
      setShowBulkPrice(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to apply bulk price adjustment");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">🧪 Laboratory Test Catalog &amp; Pricing</h1>
          <div className="page-subtitle">
            Configure diagnostic test items, reference specimen containers, turnaround times, and billable pricing schedules
          </div>
        </div>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-outline-primary d-flex align-items-center gap-1"
            onClick={() => {
              setBulkTarget("LABORATORY");
              setShowBulkPrice(true);
            }}
          >
            <span>📈</span> Departmental Pricing Settings
          </button>
          <button
            type="button"
            className="btn btn-cerulean d-flex align-items-center gap-1"
            disabled={!canCreate}
            onClick={() => {
              if (sections.length > 0 && !formSectionId) setFormSectionId(sections[0]!.id);
              if (specimenTypes.length > 0 && !formSpecimenTypeId) setFormSpecimenTypeId(specimenTypes[0]!.id);
              setShowCreate(true);
            }}
          >
            <span>+</span> Add New Lab Test
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <AlertBanner severity="danger" title="Error">{error}</AlertBanner>
        </div>
      )}

      {info && (
        <div className="mb-3">
          <AlertBanner severity="success">{info}</AlertBanner>
        </div>
      )}

      {/* KPI Stats */}
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="metric-card">
            <div className="small text-muted text-uppercase fw-bold">Active Tests</div>
            <div className="h3 fw-bold mb-0 text-dark">{tests.filter((t) => t.is_active).length}</div>
            <div className="small text-muted">{tests.filter((t) => t.is_panel).length} Panels &amp; Profiles</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="metric-card">
            <div className="small text-muted text-uppercase fw-bold">Laboratory Sections</div>
            <div className="h3 fw-bold mb-0 text-primary">{sections.length}</div>
            <div className="small text-muted">Specialty units configured</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="metric-card">
            <div className="small text-muted text-uppercase fw-bold">Average Turnaround</div>
            <div className="h3 fw-bold mb-0 text-success">
              {tests.length > 0 ? Math.round(tests.reduce((acc, t) => acc + (t.tat_minutes || 60), 0) / tests.length) : 0} m
            </div>
            <div className="small text-muted">Routine order SLA</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="metric-card">
            <div className="small text-muted text-uppercase fw-bold">Priced Items</div>
            <div className="h3 fw-bold mb-0 text-info">
              {tests.filter((t) => (t.price ?? 0) > 0).length} / {tests.length}
            </div>
            <div className="small text-muted">Billable via Service Catalog</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="clinic-card mb-4">
        <div className="clinic-card-header flex-wrap gap-2">
          <div className="d-flex flex-wrap gap-2 align-items-center flex-grow-1">
            <div className="input-group input-group-sm" style={{ maxWidth: 280 }}>
              <span className="input-group-text bg-light text-muted">🔍</span>
              <input
                type="text"
                className="form-control"
                placeholder="Search test code, name, LOINC..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="form-select form-select-sm"
              style={{ maxWidth: 200 }}
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
            >
              <option value="ALL">All Sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>

            <select
              className="form-select form-select-sm"
              style={{ maxWidth: 200 }}
              value={selectedSpecimen}
              onChange={(e) => setSelectedSpecimen(e.target.value)}
            >
              <option value="ALL">All Specimen Types</option>
              {specimenTypes.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>

            <div className="btn-group btn-group-sm" role="group">
              <button
                type="button"
                className={`btn ${panelFilter === "ALL" ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => setPanelFilter("ALL")}
              >
                All
              </button>
              <button
                type="button"
                className={`btn ${panelFilter === "SINGLE" ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => setPanelFilter("SINGLE")}
              >
                Individual
              </button>
              <button
                type="button"
                className={`btn ${panelFilter === "PANEL" ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => setPanelFilter("PANEL")}
              >
                Panels
              </button>
            </div>
          </div>

          <span className="small text-muted align-self-center">
            {loading ? "Loading…" : `Showing ${filteredTests.length} of ${tests.length} tests`}
          </span>
        </div>

        {/* Tests Table */}
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>CODE</th>
                <th>TEST / PANEL NAME</th>
                <th>SECTION</th>
                <th>SPECIMEN</th>
                <th>TAT</th>
                <th>FLAGS</th>
                <th>BILLABLE PRICE</th>
                <th>STATUS</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTests.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="badge bg-secondary-subtle text-secondary-emphasis font-monospace">
                      {t.code}
                    </span>
                    {t.loinc_code && (
                      <div className="small text-muted font-monospace" style={{ fontSize: "0.72rem" }}>
                        LOINC: {t.loinc_code}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="fw-semibold text-dark">
                      {t.name}
                      {t.is_panel && (
                        <span className="badge bg-info-subtle text-info border ms-2">
                          Panel
                        </span>
                      )}
                    </div>
                    {t.instructions && (
                      <div className="small text-muted text-truncate" style={{ maxWidth: 300 }}>
                        {t.instructions}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                      {t.section_name || "General Lab"}
                    </span>
                  </td>
                  <td>
                    <span className="small text-dark fw-medium">
                      {t.specimen_type_name || "Blood / Serum"}
                    </span>
                  </td>
                  <td>
                    <span className="badge bg-light text-dark border">
                      ⏱ {t.tat_minutes}m
                    </span>
                  </td>
                  <td>
                    <div className="d-flex gap-1 flex-wrap">
                      {t.is_stat_allowed && (
                        <span className="badge bg-danger-subtle text-danger" title="STAT allowed">
                          STAT
                        </span>
                      )}
                      {t.fasting_required && (
                        <span className="badge bg-warning-subtle text-warning-emphasis" title={`Fasting: ${t.fasting_hours ?? 8}h`}>
                          Fasting {t.fasting_hours ? `${t.fasting_hours}h` : ""}
                        </span>
                      )}
                      {t.is_confidential && (
                        <span className="badge bg-dark text-white" title="Confidential (restricted view)">
                          🔒 Conf.
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="fw-bold text-success fs-6">
                      ₱{(Number(t.price) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td>
                    <StatusPill tone={t.is_active ? "normal" : "neutral"} label={t.is_active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td className="text-end">
                    <div className="d-flex gap-1 justify-content-end">
                      {canUpdate && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => openEditModal(t)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filteredTests.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-muted py-5">
                    <div className="mb-2 fs-4">🔬</div>
                    <div className="fw-semibold">No laboratory tests found matching criteria</div>
                    <div className="small">Try adjusting search query or click &ldquo;+ Add New Lab Test&rdquo; to define a new test.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Lab Test Modal ─────────────────────────────────────────── */}
      <Modal show={showCreate} onHide={() => setShowCreate(false)} centered size="lg" aria-labelledby="create-lab-test-title">
        <Modal.Header closeButton>
          <Modal.Title id="create-lab-test-title">Add Diagnostic Test to Laboratory Catalog</Modal.Title>
        </Modal.Header>
        <form onSubmit={handleCreateTest}>
          <Modal.Body>
            <div className="row g-3">
              <div className="col-md-4">
                <Form.Group controlId="lab-code">
                  <Form.Label>Test Code *</Form.Label>
                  <Form.Control
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="e.g. LAB-CBC-01"
                    autoFocus
                  />
                  <Form.Text muted>Unique internal laboratory identifier</Form.Text>
                </Form.Group>
              </div>
              <div className="col-md-8">
                <Form.Group controlId="lab-name">
                  <Form.Label>Test Name *</Form.Label>
                  <Form.Control
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Complete Blood Count (CBC) with Differential"
                  />
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="lab-section">
                  <Form.Label>Laboratory Section *</Form.Label>
                  <Form.Select
                    required
                    value={formSectionId}
                    onChange={(e) => setFormSectionId(e.target.value)}
                  >
                    <option value="">— Select Section —</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group controlId="lab-specimen">
                  <Form.Label>Default Specimen Type *</Form.Label>
                  <Form.Select
                    required
                    value={formSpecimenTypeId}
                    onChange={(e) => setFormSpecimenTypeId(e.target.value)}
                  >
                    <option value="">— Select Specimen Type —</option>
                    {specimenTypes.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name} {sp.tube_top_color ? `(${sp.tube_top_color} top)` : ""}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="lab-price">
                  <Form.Label>Billable Price (₱) *</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                  />
                  <Form.Text muted>Linked to Service Catalog for Cashier &amp; Billing</Form.Text>
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="lab-tat">
                  <Form.Label>Turnaround Time (minutes) *</Form.Label>
                  <Form.Control
                    type="number"
                    min="5"
                    required
                    value={formTat}
                    onChange={(e) => setFormTat(e.target.value)}
                  />
                </Form.Group>
              </div>

              <div className="col-md-4">
                <Form.Group controlId="lab-loinc">
                  <Form.Label>LOINC Code (optional)</Form.Label>
                  <Form.Control
                    value={formLoinc}
                    onChange={(e) => setFormLoinc(e.target.value)}
                    placeholder="e.g. 58410-2"
                  />
                </Form.Group>
              </div>

              <div className="col-12 border-top pt-3">
                <div className="fw-semibold mb-2 text-dark">Clinical &amp; Operational Flags</div>
                <div className="d-flex flex-wrap gap-4">
                  <Form.Check
                    type="checkbox"
                    id="flag-stat"
                    label="STAT / Urgent Orders Allowed"
                    checked={formIsStat}
                    onChange={(e) => setFormIsStat(e.target.checked)}
                  />
                  <Form.Check
                    type="checkbox"
                    id="flag-confidential"
                    label="Confidential (Restricted Result Access)"
                    checked={formIsConfidential}
                    onChange={(e) => setFormIsConfidential(e.target.checked)}
                  />
                  <Form.Check
                    type="checkbox"
                    id="flag-fasting"
                    label="Fasting Required Prior to Collection"
                    checked={formFastingRequired}
                    onChange={(e) => setFormFastingRequired(e.target.checked)}
                  />
                  <Form.Check
                    type="checkbox"
                    id="flag-pathologist"
                    label="Mandatory Pathologist Sign-Off"
                    checked={formPathologistReview}
                    onChange={(e) => setFormPathologistReview(e.target.checked)}
                  />
                </div>
              </div>

              {formFastingRequired && (
                <div className="col-md-4">
                  <Form.Group controlId="lab-fasting-hours">
                    <Form.Label>Fasting Duration (hours)</Form.Label>
                    <Form.Control
                      type="number"
                      min="1"
                      value={formFastingHours}
                      onChange={(e) => setFormFastingHours(e.target.value)}
                    />
                  </Form.Group>
                </div>
              )}

              <div className="col-12">
                <Form.Check
                  type="checkbox"
                  id="flag-panel"
                  label="This is a Test Panel / Battery (Composite of multiple tests)"
                  checked={formIsPanel}
                  onChange={(e) => setFormIsPanel(e.target.checked)}
                />
              </div>

              {formIsPanel && (
                <div className="col-12">
                  <Form.Label className="small fw-semibold">Select Included Child Tests</Form.Label>
                  <div className="border rounded p-2" style={{ maxHeight: 140, overflowY: "auto" }}>
                    {tests
                      .filter((t) => !t.is_panel)
                      .map((t) => (
                        <Form.Check
                          key={t.id}
                          id={`panel-child-${t.id}`}
                          type="checkbox"
                          label={`${t.name} (${t.code})`}
                          checked={formSelectedChildTestIds.has(t.id)}
                          onChange={() => {
                            setFormSelectedChildTestIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            });
                          }}
                        />
                      ))}
                  </div>
                </div>
              )}

              <div className="col-12">
                <Form.Group controlId="lab-instructions">
                  <Form.Label>Special Instructions / Preparation (optional)</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                    placeholder="e.g. Draw red-top tube, centrifuge within 30 minutes, protect from light."
                  />
                </Form.Group>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCreate(false)} disabled={createBusy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-cerulean" disabled={createBusy}>
              {createBusy ? "Creating…" : "Save Test to Catalog"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ── Edit Lab Test Modal ───────────────────────────────────────────── */}
      <Modal show={editTarget !== null} onHide={() => setEditTarget(null)} centered aria-labelledby="edit-lab-test-title">
        <Modal.Header closeButton>
          <Modal.Title id="edit-lab-test-title">Edit Diagnostic Test — {editTarget?.code}</Modal.Title>
        </Modal.Header>
        <form onSubmit={handleSaveEdit}>
          <Modal.Body>
            <Form.Group controlId="edit-test-name" className="mb-3">
              <Form.Label>Test Name *</Form.Label>
              <Form.Control
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </Form.Group>

            <Form.Group controlId="edit-test-code" className="mb-3">
              <Form.Label>Test Code *</Form.Label>
              <Form.Control
                required
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
              />
            </Form.Group>

            <Form.Group controlId="edit-test-price" className="mb-3">
              <Form.Label>Billable Price (₱) *</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                min="0"
                required
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
              />
              <Form.Text muted>Updates Service Catalog default price and creates effective price list history.</Form.Text>
            </Form.Group>

            <Form.Group controlId="edit-test-tat" className="mb-3">
              <Form.Label>Turnaround Time (minutes) *</Form.Label>
              <Form.Control
                type="number"
                min="5"
                required
                value={editTat}
                onChange={(e) => setEditTat(e.target.value)}
              />
            </Form.Group>

            <Form.Group controlId="edit-test-instructions" className="mb-3">
              <Form.Label>Special Instructions</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={editInstructions}
                onChange={(e) => setEditInstructions(e.target.value)}
              />
            </Form.Group>

            <Form.Check
              type="checkbox"
              id="edit-test-active"
              label="Active (visible for doctor ordering & worklists)"
              checked={editIsActive}
              onChange={(e) => setEditIsActive(e.target.checked)}
            />
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEditTarget(null)} disabled={editBusy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-cerulean" disabled={editBusy}>
              {editBusy ? "Saving…" : "Save Changes"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* ── Departmental Bulk Price Adjustment Modal ──────────────────────── */}
      <Modal show={showBulkPrice} onHide={() => setShowBulkPrice(false)} centered aria-labelledby="bulk-price-title">
        <Modal.Header closeButton>
          <Modal.Title id="bulk-price-title">📈 Departmental Bulk Pricing Adjustment</Modal.Title>
        </Modal.Header>
        <form onSubmit={handleApplyBulkPricing}>
          <Modal.Body>
            <p className="small text-muted mb-3">
              Apply a batch percentage or flat fee adjustment across all billable items in a specific department.
              Changes are versioned and logged in <code>price_lists</code> and effective immediately.
            </p>

            <Form.Group controlId="bulk-target" className="mb-3">
              <Form.Label>Target Department *</Form.Label>
              <Form.Select
                value={bulkTarget}
                onChange={(e: any) => setBulkTarget(e.target.value)}
              >
                <option value="LABORATORY">🧪 Laboratory Diagnostic Tests</option>
                <option value="PHARMACY">💊 Pharmacy Medicines &amp; Drugs</option>
                <option value="CENTRAL_SUPPLY">📦 Central Supply &amp; Consumables</option>
                <option value="ALL">🏥 All Departments</option>
              </Form.Select>
            </Form.Group>

            <div className="row g-2 mb-3">
              <div className="col-6">
                <Form.Label>Adjustment Direction</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Check
                    type="radio"
                    id="dir-inc"
                    name="bulk-dir"
                    label="🔺 Increase"
                    checked={bulkDirection === "INCREASE"}
                    onChange={() => setBulkDirection("INCREASE")}
                  />
                  <Form.Check
                    type="radio"
                    id="dir-dec"
                    name="bulk-dir"
                    label="🔻 Decrease"
                    checked={bulkDirection === "DECREASE"}
                    onChange={() => setBulkDirection("DECREASE")}
                  />
                </div>
              </div>

              <div className="col-6">
                <Form.Label>Adjustment Type</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Check
                    type="radio"
                    id="type-pct"
                    name="bulk-type"
                    label="Percentage (%)"
                    checked={bulkType === "PERCENTAGE"}
                    onChange={() => setBulkType("PERCENTAGE")}
                  />
                  <Form.Check
                    type="radio"
                    id="type-fix"
                    name="bulk-type"
                    label="Fixed (₱)"
                    checked={bulkType === "FIXED"}
                    onChange={() => setBulkType("FIXED")}
                  />
                </div>
              </div>
            </div>

            <Form.Group controlId="bulk-val" className="mb-3">
              <Form.Label>
                {bulkType === "PERCENTAGE" ? "Percentage Value (%)" : "Flat Amount (₱)"} *
              </Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                min="0.01"
                required
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                placeholder="e.g. 5 or 50.00"
              />
            </Form.Group>

            <Form.Group controlId="bulk-reason" className="mb-3">
              <Form.Label>Audit Reason / Memo (optional)</Form.Label>
              <Form.Control
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="e.g. Annual fee adjustment or DOH tariff revision"
              />
            </Form.Group>

            <div className="p-3 bg-light rounded border small">
              <div className="fw-semibold text-dark mb-1">Preview:</div>
              <div>
                Will <strong>{bulkDirection === "INCREASE" ? "INCREASE" : "DECREASE"}</strong> all items in{" "}
                <strong>{bulkTarget}</strong> by{" "}
                <strong>
                  {bulkValue}
                  {bulkType === "PERCENTAGE" ? "%" : " ₱"}
                </strong>
                .
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setShowBulkPrice(false)} disabled={bulkBusy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={bulkBusy}>
              {bulkBusy ? "Applying Changes…" : "Apply Price Adjustment"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}
