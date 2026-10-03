import React, { useState, useEffect, useCallback } from "react";
import { AlertBanner, Button, Modal, Form, StatusPill } from "@clinic/ui";
import {
  pharmacyApi,
  type DrugProductRow,
  type GenericNameRow,
} from "./api.js";
import { supplyApi, type SupplyUom } from "../supply/api.js";
import type { BulkPriceAdjustRequest } from "@clinic/contracts";

export function DrugCatalogPage() {
  const [products, setProducts] = useState<DrugProductRow[]>([]);
  const [generics, setGenerics] = useState<GenericNameRow[]>([]);
  const [uoms, setUoms] = useState<SupplyUom[]>([]);
  const [search, setSearch] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState("ALL");
  const [formularyOnly, setFormularyOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState<{ message: string; tone: "success" | "danger" | "info" } | null>(null);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [genericId, setGenericId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [strength, setStrength] = useState("");
  const [dosageForm, setDosageForm] = useState("Capsule");
  const [route, setRoute] = useState("Oral");
  const [packSize, setPackSize] = useState(1);
  const [baseUomId, setBaseUomId] = useState("");
  const [fdaRegNo, setFdaRegNo] = useState("");
  const [rxRequired, setRxRequired] = useState<"OTC" | "RX" | "CONTROLLED">("RX");
  const [controlledSchedule, setControlledSchedule] = useState("");
  const [storage, setStorage] = useState<"ROOM" | "COLD">("ROOM");
  const [isFormulary, setIsFormulary] = useState(true);
  const [highAlert, setHighAlert] = useState(false);
  const [standardCost, setStandardCost] = useState(5.00);
  const [price, setPrice] = useState(12.00);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Edit modal state
  const [editingProd, setEditingProd] = useState<DrugProductRow | null>(null);
  const [editBrandName, setEditBrandName] = useState("");
  const [editFdaRegNo, setEditFdaRegNo] = useState("");
  const [editFormulary, setEditFormulary] = useState(true);
  const [editHighAlert, setEditHighAlert] = useState(false);
  const [editCost, setEditCost] = useState<number>(0);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Bulk adjust modal state
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [adjType, setAdjType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [adjDirection, setAdjDirection] = useState<"INCREASE" | "DECREASE">("INCREASE");
  const [adjValue, setAdjValue] = useState<number>(5);
  const [adjReason, setAdjReason] = useState("Quarterly Pharmacy Formulary Markup Update");
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [prodsData, gensData, uomsData] = await Promise.all([
        pharmacyApi.listProducts().catch(() => []),
        pharmacyApi.listGenerics().catch(() => []),
        supplyApi.listUoms().catch(() => []),
      ]);
      setProducts(prodsData || []);
      setGenerics(gensData || []);
      setUoms(uomsData || []);

      if (gensData && gensData.length > 0 && !genericId) {
        setGenericId(gensData[0]!.id);
      }
      if (uomsData && uomsData.length > 0 && !baseUomId) {
        setBaseUomId(uomsData[0]!.id);
      }
    } catch (err: any) {
      setAlert({ message: err?.message || "Failed to load drug formulary.", tone: "danger" });
    } finally {
      setIsLoading(false);
    }
  }, [genericId, baseUomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredProducts = products.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      p.brand_name.toLowerCase().includes(q) ||
      p.generic_name.toLowerCase().includes(q) ||
      p.item_code.toLowerCase().includes(q) ||
      (p.fda_reg_no && p.fda_reg_no.toLowerCase().includes(q));

    const matchesSchedule = scheduleFilter === "ALL" || p.rx_required === scheduleFilter;
    const matchesFormulary = !formularyOnly || p.is_formulary;

    return matchesSearch && matchesSchedule && matchesFormulary;
  });

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !brandName || !genericId) return;

    const resolvedUomId = baseUomId || (uoms[0]?.id ?? "00000000-0000-0000-0000-000000000001");
    const productName = name.trim() || `${brandName.trim()} (${strength.trim()})`.trim();

    setIsSubmittingCreate(true);
    try {
      const created = await pharmacyApi.createProduct({
        code: code.trim().toUpperCase(),
        name: productName,
        genericId,
        brandName: brandName.trim(),
        strength: strength.trim(),
        dosageForm: dosageForm.trim(),
        route: route.trim(),
        packSize: Number(packSize) || 1,
        baseUomId: resolvedUomId,
        fdaRegNo: fdaRegNo.trim() || undefined,
        rxRequired,
        controlledSchedule: (rxRequired === "CONTROLLED" && controlledSchedule) ? (controlledSchedule as any) : undefined,
        storage,
        isFormulary,
        highAlert,
        standardCost,
        price,
      });

      setAlert({
        message: `Drug product "${created.brand_name}" (${created.item_code}) added to formulary with price ₱${Number(created.price).toFixed(2)}.`,
        tone: "success",
      });
      setIsCreateOpen(false);
      setCode("");
      setName("");
      setBrandName("");
      setStrength("");
      setFdaRegNo("");
      setStandardCost(5.00);
      setPrice(12.00);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Failed to create drug product.", tone: "danger" });
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleOpenEdit = (p: DrugProductRow) => {
    setEditingProd(p);
    setEditBrandName(p.brand_name);
    setEditFdaRegNo(p.fda_reg_no || "");
    setEditFormulary(p.is_formulary);
    setEditHighAlert(p.high_alert);
    setEditCost(Number(p.standard_cost) || 0);
    setEditPrice(Number(p.price) || 0);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProd) return;

    setIsSubmittingEdit(true);
    try {
      await pharmacyApi.updateProduct(editingProd.id, {
        brandName: editBrandName.trim(),
        fdaRegNo: editFdaRegNo.trim() || undefined,
        isFormulary: editFormulary,
        highAlert: editHighAlert,
        standardCost: editCost,
        price: editPrice,
      });

      setAlert({
        message: `Drug product "${editingProd.brand_name}" updated: Cost ₱${editCost.toFixed(2)}, Retail Price ₱${editPrice.toFixed(2)}.`,
        tone: "success",
      });
      setEditingProd(null);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Failed to update drug product.", tone: "danger" });
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleBulkAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAdjust(true);
    try {
      const payload: BulkPriceAdjustRequest = {
        target: "PHARMACY",
        adjustmentType: adjType,
        direction: adjDirection,
        value: Number(adjValue),
        reason: adjReason,
      };
      const res = await pharmacyApi.bulkAdjustPricing(payload);
      setAlert({ message: res.message || "Successfully adjusted pharmacy retail prices.", tone: "success" });
      setIsAdjustOpen(false);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Bulk adjustment failed.", tone: "danger" });
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  return (
    <div className="container-fluid px-4 py-3">
      {/* Title */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-1 font-weight-bold" style={{ color: "var(--grey-900)" }}>
            Pharmacy Drug Formulary &amp; Pricing Catalog
          </h1>
          <p className="text-muted small mb-0">
            Regulated pharmaceutical master: generic bindings, dosage routes, prescription schedules, and dispensing prices.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setIsAdjustOpen(true)}>
            📈 Departmental Pricing Adjustment
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
            + Register Drug Product
          </Button>
        </div>
      </div>

      {alert && (
        <div className="mb-3">
          <AlertBanner severity={alert.tone === "danger" ? "danger" : "success"}>{alert.message}</AlertBanner>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="card shadow-sm border-0 mb-3 bg-light">
        <div className="card-body py-2">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search by brand, generic, SKU, or FDA reg..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search drugs"
              />
            </div>
            <div className="col-12 col-md-3">
              <select
                className="form-select form-select-sm"
                value={scheduleFilter}
                onChange={(e) => setScheduleFilter(e.target.value)}
                aria-label="Filter by schedule"
              >
                <option value="ALL">All Prescription Schedules</option>
                <option value="OTC">OTC (Over the Counter)</option>
                <option value="RX">RX (Prescription Required)</option>
                <option value="CONTROLLED">CONTROLLED (Dangerous Drugs)</option>
              </select>
            </div>
            <div className="col-12 col-md-2">
              <div className="form-check form-switch pt-1">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="formulary-switch"
                  checked={formularyOnly}
                  onChange={(e) => setFormularyOnly(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="formulary-switch">
                  Formulary Only
                </label>
              </div>
            </div>
            <div className="col-12 col-md-2 text-end">
              <span className="small text-muted">
                {isLoading ? "Loading..." : `${filteredProducts.length} product(s)`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Drug Catalog Table */}
      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Code</th>
                  <th>Brand &amp; Generic</th>
                  <th>Strength &amp; Form</th>
                  <th>Schedule</th>
                  <th>Storage</th>
                  <th className="text-center">Formulary</th>
                  <th className="text-end">Acq. Cost</th>
                  <th className="text-end">Retail Selling Price</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      Loading pharmacy drug products...
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      No drug products match the selected criteria. Click "+ Register Drug Product" to add to formulary.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <code>{p.item_code}</code>
                        {p.fda_reg_no && <div className="small text-muted font-monospace">{p.fda_reg_no}</div>}
                      </td>
                      <td>
                        <strong className="text-dark">{p.brand_name}</strong>
                        <div className="small text-muted">
                          {p.generic_name} {p.atc_code ? `[${p.atc_code}]` : ""}
                        </div>
                      </td>
                      <td>
                        <div>{p.strength}</div>
                        <div className="small text-muted">{p.dosage_form} · {p.route}</div>
                      </td>
                      <td>
                        {p.rx_required === "CONTROLLED" ? (
                          <span className="badge bg-danger-subtle text-danger border border-danger-subtle">
                            CONTROLLED
                          </span>
                        ) : p.rx_required === "RX" ? (
                          <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                            RX
                          </span>
                        ) : (
                          <span className="badge bg-success-subtle text-success border border-success-subtle">
                            OTC
                          </span>
                        )}
                        {p.high_alert && (
                          <span className="badge bg-warning text-dark ms-1" title="High Alert Medication">
                            ⚠️ HIGH ALERT
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="badge bg-light text-dark border">
                          {p.storage === "COLD" ? "❄️ 2°C–8°C" : "🌡️ Room Temp"}
                        </span>
                      </td>
                      <td className="text-center">
                        <StatusPill
                          tone={p.is_formulary ? "normal" : "neutral"}
                          label={p.is_formulary ? "FORMULARY" : "NON-FORMULARY"}
                        />
                      </td>
                      <td className="text-end text-muted">₱{Number(p.standard_cost || 0).toFixed(2)}</td>
                      <td className="text-end font-weight-bold text-primary">
                        ₱{Number(p.price || 0).toFixed(2)}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleOpenEdit(p)}
                        >
                          Edit Price
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Drug Product Modal */}
      {isCreateOpen && (
        <Modal show={true} onHide={() => setIsCreateOpen(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">Register Drug Product in Formulary</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleCreateProduct}>
            <Modal.Body>
              <div className="row g-3">
                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Item / SKU Code *</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. MED-AMX-500"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
                <div className="col-12 col-md-8">
                  <Form.Label className="small font-weight-bold">Brand Name *</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. Amoxil, Biogesic"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    required
                  />
                </div>

                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Generic Name Binding *</Form.Label>
                  <Form.Select
                    size="sm"
                    value={genericId}
                    onChange={(e) => setGenericId(e.target.value)}
                    required
                  >
                    {generics.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} {g.atc_code ? `(${g.atc_code})` : ""}
                      </option>
                    ))}
                  </Form.Select>
                </div>

                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Strength / Concentration *</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. 500mg, 125mg/5mL, 1g"
                    value={strength}
                    onChange={(e) => setStrength(e.target.value)}
                    required
                  />
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Dosage Form</Form.Label>
                  <Form.Select
                    size="sm"
                    value={dosageForm}
                    onChange={(e) => setDosageForm(e.target.value)}
                  >
                    <option value="Capsule">Capsule</option>
                    <option value="Tablet">Tablet</option>
                    <option value="Syrup / Suspension">Syrup / Suspension</option>
                    <option value="Vial (Injection)">Vial (Injection)</option>
                    <option value="Ampoule">Ampoule</option>
                    <option value="Ointment / Cream">Ointment / Cream</option>
                    <option value="Inhaler">Inhaler</option>
                    <option value="Suppository">Suppository</option>
                  </Form.Select>
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Route</Form.Label>
                  <Form.Select
                    size="sm"
                    value={route}
                    onChange={(e) => setRoute(e.target.value)}
                  >
                    <option value="Oral">Oral</option>
                    <option value="Intravenous (IV)">Intravenous (IV)</option>
                    <option value="Intramuscular (IM)">Intramuscular (IM)</option>
                    <option value="Subcutaneous (SC)">Subcutaneous (SC)</option>
                    <option value="Topical">Topical</option>
                    <option value="Inhalation">Inhalation</option>
                    <option value="Ophthalmic">Ophthalmic</option>
                  </Form.Select>
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Base Dispensing UOM</Form.Label>
                  <Form.Select
                    size="sm"
                    value={baseUomId}
                    onChange={(e) => setBaseUomId(e.target.value)}
                  >
                    {uoms.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </Form.Select>
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Schedule *</Form.Label>
                  <Form.Select
                    size="sm"
                    value={rxRequired}
                    onChange={(e) => setRxRequired(e.target.value as any)}
                  >
                    <option value="RX">RX (Prescription Required)</option>
                    <option value="OTC">OTC (Over the Counter)</option>
                    <option value="CONTROLLED">CONTROLLED (DDB Schedule)</option>
                  </Form.Select>
                </div>

                {rxRequired === "CONTROLLED" && (
                  <div className="col-12 col-md-4">
                    <Form.Label className="small font-weight-bold text-danger">DDB Schedule *</Form.Label>
                    <Form.Select
                      size="sm"
                      value={controlledSchedule}
                      onChange={(e) => setControlledSchedule(e.target.value)}
                      required
                    >
                      <option value="">— Select Schedule —</option>
                      <option value="DDB_SCHEDULE_1">Schedule 1 (Forbidden)</option>
                      <option value="DDB_SCHEDULE_2">Schedule 2 (Strict Yellow Pad)</option>
                      <option value="DDB_SCHEDULE_3">Schedule 3 (Regulated)</option>
                      <option value="DDB_SCHEDULE_4">Schedule 4</option>
                      <option value="DDB_SCHEDULE_5">Schedule 5</option>
                    </Form.Select>
                  </div>
                )}

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Storage Condition</Form.Label>
                  <Form.Select
                    size="sm"
                    value={storage}
                    onChange={(e) => setStorage(e.target.value as any)}
                  >
                    <option value="ROOM">Room Temperature (15°C–25°C)</option>
                    <option value="COLD">Cold Chain / Refrigerator (2°C–8°C)</option>
                  </Form.Select>
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Pack Size</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    min="1"
                    value={packSize}
                    onChange={(e) => setPackSize(parseInt(e.target.value, 10) || 1)}
                  />
                </div>

                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">FDA Registration No.</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. DRP-10492"
                    value={fdaRegNo}
                    onChange={(e) => setFdaRegNo(e.target.value)}
                  />
                </div>

                <div className="col-12 col-md-3">
                  <Form.Label className="small font-weight-bold">Acquisition Cost (₱) *</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    value={standardCost}
                    onChange={(e) => setStandardCost(parseFloat(e.target.value) || 0)}
                    required
                  />
                  <Form.Text muted>Procurement unit cost</Form.Text>
                </div>

                <div className="col-12 col-md-3">
                  <Form.Label className="small font-weight-bold text-primary">Retail Selling Price (₱) *</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    required
                  />
                  <Form.Text muted>Patient billing / OTC price</Form.Text>
                </div>

                <div className="col-12">
                  <div className="d-flex gap-4">
                    <Form.Check
                      type="checkbox"
                      id="formulary-chk"
                      label="Approved In Formulary"
                      checked={isFormulary}
                      onChange={(e) => setIsFormulary(e.target.checked)}
                    />
                    <Form.Check
                      type="checkbox"
                      id="highalert-chk"
                      label="High Alert Medication (Dual Signoff)"
                      checked={highAlert}
                      onChange={(e) => setHighAlert(e.target.checked)}
                    />
                  </div>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingCreate}>
                {isSubmittingCreate ? "Registering..." : "Register Product & Price"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Edit Drug Product Modal */}
      {editingProd && (
        <Modal show={true} onHide={() => setEditingProd(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">Edit Drug Product &amp; Selling Price</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleSaveEdit}>
            <Modal.Body>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">SKU Code</Form.Label>
                <Form.Control size="sm" value={editingProd.item_code} disabled readOnly />
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Brand Name *</Form.Label>
                <Form.Control
                  size="sm"
                  value={editBrandName}
                  onChange={(e) => setEditBrandName(e.target.value)}
                  required
                />
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">FDA Registration No.</Form.Label>
                <Form.Control
                  size="sm"
                  value={editFdaRegNo}
                  onChange={(e) => setEditFdaRegNo(e.target.value)}
                />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <Form.Label className="small font-weight-bold">Acquisition Cost (₱)</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    value={editCost}
                    onChange={(e) => setEditCost(parseFloat(e.target.value) || 0)}
                    required
                  />
                  <Form.Text muted>Inventory cost</Form.Text>
                </div>
                <div className="col-6">
                  <Form.Label className="small font-weight-bold text-primary">Retail Selling Price (₱) *</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(parseFloat(e.target.value) || 0)}
                    required
                  />
                  <Form.Text muted>Service catalog price</Form.Text>
                </div>
              </div>
              <div className="d-flex gap-4">
                <Form.Check
                  type="checkbox"
                  id="edit-form-chk"
                  label="In Formulary"
                  checked={editFormulary}
                  onChange={(e) => setEditFormulary(e.target.checked)}
                />
                <Form.Check
                  type="checkbox"
                  id="edit-ha-chk"
                  label="High Alert"
                  checked={editHighAlert}
                  onChange={(e) => setEditHighAlert(e.target.checked)}
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setEditingProd(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingEdit}>
                {isSubmittingEdit ? "Updating..." : "Update Drug & Price"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Departmental Bulk Pricing Adjustment Modal */}
      {isAdjustOpen && (
        <Modal show={true} onHide={() => setIsAdjustOpen(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">📈 Pharmacy Pricing Adjustment</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleBulkAdjust}>
            <Modal.Body>
              <p className="small text-muted mb-3">
                Batch adjust retail dispensing prices across all Pharmacy medications and products. Updates both active price list entries and fallback catalog prices.
              </p>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Adjustment Direction</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    id="ph-dir-inc"
                    name="ph-adj-direction"
                    label="Increase Price (+)"
                    checked={adjDirection === "INCREASE"}
                    onChange={() => setAdjDirection("INCREASE")}
                  />
                  <Form.Check
                    type="radio"
                    id="ph-dir-dec"
                    name="ph-adj-direction"
                    label="Decrease Price (-)"
                    checked={adjDirection === "DECREASE"}
                    onChange={() => setAdjDirection("DECREASE")}
                  />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <Form.Label className="small font-weight-bold">Adjustment Type</Form.Label>
                  <Form.Select
                    size="sm"
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as any)}
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (₱)</option>
                  </Form.Select>
                </div>
                <div className="col-6">
                  <Form.Label className="small font-weight-bold">
                    {adjType === "PERCENTAGE" ? "Percentage Rate (%)" : "Flat Amount (₱)"}
                  </Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    min="0.01"
                    value={adjValue}
                    onChange={(e) => setAdjValue(parseFloat(e.target.value) || 0)}
                    required
                  />
                </div>
              </div>
              <div className="mb-2">
                <Form.Label className="small font-weight-bold">Reason / Memo</Form.Label>
                <Form.Control
                  size="sm"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. Annual pharmaceutical adjustment"
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsAdjustOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingAdjust}>
                {isSubmittingAdjust ? "Applying..." : "Apply Price Adjustment"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
