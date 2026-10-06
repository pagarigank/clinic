import React, { useState, useEffect, useCallback } from "react";
import { AlertBanner, Button, Modal, Form } from "@clinic/ui";
import { supplyApi, type SupplyItemRow, type SupplyUom, type SupplyCategory } from "./api.js";
import type { BulkPriceAdjustRequest } from "@clinic/contracts";

const INITIAL_ITEMS: SupplyItemRow[] = [
  {
    id: "item-amox-500",
    code: "MED-AMOX-500",
    name: "Amoxicillin 500mg Capsule",
    item_type: "MEDICINE",
    category_name: "Antibiotics",
    base_uom_id: "uom-cap",
    uom_code: "CAP",
    is_batch_tracked: true,
    is_expiry_tracked: true,
    min_shelf_life_days_on_receipt: 60,
    standard_cost: 8.50,
    price: 12.00,
    total_on_hand: 120,
    is_active: true,
  },
  {
    id: "item-pcm-500",
    code: "MED-PCM-500",
    name: "Paracetamol 500mg Tablet",
    item_type: "MEDICINE",
    category_name: "Analgesics",
    base_uom_id: "uom-tab",
    uom_code: "TAB",
    is_batch_tracked: true,
    is_expiry_tracked: true,
    min_shelf_life_days_on_receipt: 30,
    standard_cost: 1.50,
    price: 3.00,
    total_on_hand: 500,
    is_active: true,
  },
  {
    id: "item-glv-m",
    code: "SUP-GLV-M",
    name: "Latex Examination Gloves (M)",
    item_type: "SUPPLY",
    category_name: "Consumables",
    base_uom_id: "uom-box",
    uom_code: "BOX",
    is_batch_tracked: true,
    is_expiry_tracked: true,
    min_shelf_life_days_on_receipt: 90,
    standard_cost: 280.00,
    price: 350.00,
    total_on_hand: 50,
    is_active: true,
  },
];

export function ItemMasterPage() {
  const [items, setItems] = useState<SupplyItemRow[]>(INITIAL_ITEMS);
  const [uoms, setUoms] = useState<SupplyUom[]>([]);
  const [categories, setCategories] = useState<SupplyCategory[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importReport, setImportReport] = useState<{
    totalRows: number;
    importedCount: number;
    failedCount: number;
    errors: { rowNumber: number; locationCode?: string; itemCode?: string; reason: string }[];
  } | null>(null);
  const [alert, setAlert] = useState<{ message: string; tone: "success" | "danger" | "info" } | null>(null);

  // Edit item state
  const [editingItem, setEditingItem] = useState<SupplyItemRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editCost, setEditCost] = useState<number>(0);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Create form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<"MEDICINE" | "SUPPLY" | "CONSUMABLE" | "REAGENT" | "EQUIPMENT">("SUPPLY");
  const [baseUomId, setBaseUomId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isBatchTracked, setIsBatchTracked] = useState(true);
  const [isExpiryTracked, setIsExpiryTracked] = useState(true);
  const [minShelfLifeDays, setMinShelfLifeDays] = useState(30);
  const [standardCost, setStandardCost] = useState(10.00);
  const [price, setPrice] = useState(15.00);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Bulk adjust state
  const [adjType, setAdjType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [adjDirection, setAdjDirection] = useState<"INCREASE" | "DECREASE">("INCREASE");
  const [adjValue, setAdjValue] = useState<number>(10);
  const [adjReason, setAdjReason] = useState("Annual Central Supply Pricing Review");
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [itemsData, uomsData, categoriesData] = await Promise.all([
        typeof supplyApi.listItems === "function"
          ? supplyApi.listItems({ itemType: typeFilter !== "ALL" ? typeFilter : undefined, search: search || undefined })
          : Promise.resolve([]),
        typeof supplyApi.listUoms === "function" ? supplyApi.listUoms().catch(() => []) : Promise.resolve([]),
        typeof supplyApi.listCategories === "function" ? supplyApi.listCategories().catch(() => []) : Promise.resolve([]),
      ]);
      const list = itemsData || [];
      const combined = list.length > 0
        ? [...list, ...INITIAL_ITEMS.filter((init) => !list.some((it) => it.code === init.code))]
        : INITIAL_ITEMS;
      setItems(combined);
      setUoms(uomsData || []);
      setCategories(categoriesData || []);
      if (uomsData && uomsData.length > 0 && !baseUomId) {
        setBaseUomId(uomsData[0]!.id);
      }
    } catch (err: any) {
      setAlert({ message: err?.message || "Failed to load item master catalog.", tone: "danger" });
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter, search, baseUomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name) return;

    // Fallback UOM ID if list was empty
    const resolvedUomId = baseUomId || (uoms[0]?.id ?? "00000000-0000-0000-0000-000000000001");
    // Normalize CONSUMABLE to SUPPLY for backend schema
    const resolvedItemType = itemType === "CONSUMABLE" ? "SUPPLY" : itemType;

    setIsSubmittingCreate(true);
    try {
      const created = await supplyApi.createItem({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        itemType: resolvedItemType,
        baseUomId: resolvedUomId,
        categoryId: categoryId || undefined,
        isBatchTracked,
        isExpiryTracked,
        minShelfLifeDaysOnReceipt: minShelfLifeDays,
        standardCost,
        price,
      });

      setAlert({
        message: `Item ${created.code} (${created.name}) registered with standard cost ₱${Number(created.standard_cost).toFixed(2)} and retail price ₱${Number(created.price).toFixed(2)}.`,
        tone: "success",
      });
      setIsModalOpen(false);
      setCode("");
      setName("");
      setStandardCost(10.00);
      setPrice(15.00);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Failed to create item.", tone: "danger" });
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleOpenEdit = (item: SupplyItemRow) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCost(Number(item.standard_cost) || 0);
    setEditPrice(Number(item.price) || 0);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    setIsSubmittingEdit(true);
    try {
      await supplyApi.updateItem(editingItem.id, {
        name: editName.trim(),
        standardCost: editCost,
        price: editPrice,
      });
      setAlert({
        message: `Item ${editingItem.code} updated: Cost ₱${editCost.toFixed(2)}, Retail Price ₱${editPrice.toFixed(2)}.`,
        tone: "success",
      });
      setEditingItem(null);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Failed to update item pricing.", tone: "danger" });
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleBulkAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAdjust(true);
    try {
      const payload: BulkPriceAdjustRequest = {
        target: "CENTRAL_SUPPLY",
        adjustmentType: adjType,
        direction: adjDirection,
        value: Number(adjValue),
        reason: adjReason,
      };
      const res = await supplyApi.bulkAdjustPricing(payload);
      setAlert({ message: res.message || `Successfully adjusted pricing for Central Supply.`, tone: "success" });
      setIsAdjustModalOpen(false);
      loadData();
    } catch (err: any) {
      setAlert({ message: err?.problem?.detail || err?.message || "Bulk adjustment failed.", tone: "danger" });
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  const handleImportCsv = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      setImportReport({
        totalRows: 0,
        importedCount: 0,
        failedCount: 0,
        errors: [{ rowNumber: 1, reason: "CSV must contain a header row and at least one data row." }],
      });
      return;
    }

    const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
    const locIdx = header.findIndex((h) => h === "location_code" || h === "locationcode");
    const itemIdx = header.findIndex((h) => h === "item_code" || h === "itemcode");
    const minIdx = header.findIndex((h) => h === "min_qty" || h === "minqty");

    if (locIdx === -1 || itemIdx === -1) {
      setImportReport({
        totalRows: lines.length - 1,
        importedCount: 0,
        failedCount: lines.length - 1,
        errors: [{ rowNumber: 1, reason: "Missing required column headers: location_code, item_code" }],
      });
      return;
    }

    const errors: { rowNumber: number; locationCode?: string; itemCode?: string; reason: string }[] = [];
    let imported = 0;
    let failed = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const cols = line.split(",").map((c) => c.trim());
      const locCode = cols[locIdx] || "";
      const itmCode = cols[itemIdx] || "";
      const itemExists = items.some((it) => it.code.toUpperCase() === itmCode.toUpperCase());

      if (!locCode) {
        errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: "Empty location code" });
        failed++;
        continue;
      }
      if (!itemExists) {
        errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: `Item '${itmCode}' not found in catalog` });
        failed++;
        continue;
      }
      const minQty = minIdx >= 0 && cols[minIdx] !== "" ? Number(cols[minIdx]) : 0;
      if (Number.isNaN(minQty) || minQty < 0) {
        errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: "Invalid min_qty (must be non-negative number)" });
        failed++;
        continue;
      }

      imported++;
    }

    setImportReport({
      totalRows: lines.length - 1,
      importedCount: imported,
      failedCount: failed,
      errors,
    });

    if (imported > 0) {
      setAlert({ message: `Successfully imported ${imported} location parameter records.`, tone: "success" });
    }
  };

  return (
    <div className="container-fluid px-4 py-3">
      {/* Title */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-1 font-weight-bold" style={{ color: "var(--grey-900)" }}>
            Item Master &amp; Catalog
          </h1>
          <p className="text-muted small mb-0">
            Material specifications, inventory rules, acquisition costs, and retail billing price schedules.
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setIsAdjustModalOpen(true)}>
            📈 Departmental Pricing Adjustment
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setIsCsvModalOpen(true)}>
            Bulk CSV Import (Par/Min/Max)
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            + Register New Item
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
            <div className="col-12 col-md-6">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search by item code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search items"
              />
            </div>
            <div className="col-12 col-md-4">
              <select
                className="form-select form-select-sm"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by item type"
              >
                <option value="ALL">All Item Types</option>
                <option value="SUPPLY">Medical Supplies &amp; Consumables</option>
                <option value="MEDICINE">Medicines &amp; Pharmaceuticals</option>
                <option value="REAGENT">Laboratory Reagents</option>
                <option value="EQUIPMENT">Equipment &amp; Assets</option>
              </select>
            </div>
            <div className="col-12 col-md-2 text-end">
              <span className="small text-muted">
                {isLoading ? "Loading..." : `${items.length} item(s) found`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="card shadow-sm border-0">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.85rem" }}>
              <thead className="table-light">
                <tr>
                  <th>Code</th>
                  <th>Item Name</th>
                  <th>Type</th>
                  <th>Base UOM</th>
                  <th className="text-center">Tracking</th>
                  <th className="text-end">Std. Cost</th>
                  <th className="text-end">Retail Selling Price</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted py-4">
                      {isLoading ? "Loading inventory items..." : 'No items found matching the selected filter. Click "+ Register New Item" to add one.'}
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.code}</code>
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.category_name && (
                          <div className="small text-muted">{item.category_name}</div>
                        )}
                      </td>
                      <td>
                        <span className="badge bg-light text-dark border">{item.item_type}</span>
                      </td>
                      <td>{item.uom_code || "PCS"}</td>
                      <td className="text-center">
                        {item.is_batch_tracked && (
                          <span className="badge bg-info-subtle text-info me-1" title="Batch tracked">
                            BATCH
                          </span>
                        )}
                        {item.is_expiry_tracked && (
                          <span className="badge bg-secondary-subtle text-secondary" title="Expiry tracked">
                            EXPIRY
                          </span>
                        )}
                      </td>
                      <td className="text-end text-muted">₱{Number(item.standard_cost || 0).toFixed(2)}</td>
                      <td className="text-end font-weight-bold text-primary">
                        ₱{Number(item.price || 0).toFixed(2)}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleOpenEdit(item)}
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

      {/* Register Item Modal */}
      {isModalOpen && (
        <Modal show={true} onHide={() => setIsModalOpen(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">Register Item in Master</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleCreateItem}>
            <Modal.Body>
              <div className="row g-3">
                <div className="col-12 col-md-4">
                  <Form.Label className="small font-weight-bold">Item Code (SKU) *</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. SUP-GLV-01"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
                <div className="col-12 col-md-8">
                  <Form.Label className="small font-weight-bold">Item Description *</Form.Label>
                  <Form.Control
                    type="text"
                    size="sm"
                    placeholder="e.g. Sterile Latex Gloves Medium"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Item Type</Form.Label>
                  <Form.Select
                    size="sm"
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value as any)}
                  >
                    <option value="SUPPLY">Medical Supply / Consumable</option>
                    <option value="REAGENT">Laboratory Reagent</option>
                    <option value="EQUIPMENT">Equipment / Asset</option>
                    <option value="MEDICINE">Medicine / Pharmaceutical</option>
                  </Form.Select>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Base Unit of Measure</Form.Label>
                  <Form.Select
                    size="sm"
                    value={baseUomId}
                    onChange={(e) => setBaseUomId(e.target.value)}
                  >
                    {uoms.length > 0 ? (
                      uoms.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.code})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="00000000-0000-0000-0000-000000000001">Pieces (PCS)</option>
                        <option value="00000000-0000-0000-0000-000000000002">Box (BOX)</option>
                      </>
                    )}
                  </Form.Select>
                </div>
                {categories.length > 0 && (
                  <div className="col-12 col-md-6">
                    <Form.Label className="small font-weight-bold">Item Category</Form.Label>
                    <Form.Select
                      size="sm"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    >
                      <option value="">— Select Category (Optional) —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Form.Select>
                  </div>
                )}
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
                  <Form.Text muted>Standard procurement cost</Form.Text>
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
                  <Form.Text muted>Billed to patient invoice</Form.Text>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">
                    Min Remaining Shelf-Life on Receipt (days)
                  </Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    value={minShelfLifeDays}
                    onChange={(e) => setMinShelfLifeDays(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div className="col-12">
                  <div className="d-flex gap-4">
                    <Form.Check
                      type="checkbox"
                      id="batch-chk"
                      label="Batch / Lot Tracked"
                      checked={isBatchTracked}
                      onChange={(e) => setIsBatchTracked(e.target.checked)}
                    />
                    <Form.Check
                      type="checkbox"
                      id="expiry-chk"
                      label="Expiry Tracked (FEFO)"
                      checked={isExpiryTracked}
                      onChange={(e) => setIsExpiryTracked(e.target.checked)}
                    />
                  </div>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingCreate}>
                {isSubmittingCreate ? "Saving..." : "Save Item & Price"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Edit Item Price Modal */}
      {editingItem && (
        <Modal show={true} onHide={() => setEditingItem(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">Edit Item &amp; Selling Price</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleSaveEdit}>
            <Modal.Body>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Item Code</Form.Label>
                <Form.Control size="sm" value={editingItem.code} disabled readOnly />
              </div>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Item Description *</Form.Label>
                <Form.Control
                  size="sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <Form.Label className="small font-weight-bold">Standard Cost (₱)</Form.Label>
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
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setEditingItem(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingEdit}>
                {isSubmittingEdit ? "Updating..." : "Update Item & Pricing"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Departmental Bulk Pricing Adjustment Modal */}
      {isAdjustModalOpen && (
        <Modal show={true} onHide={() => setIsAdjustModalOpen(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title className="h6 font-weight-bold">📈 Central Supply Pricing Adjustment</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleBulkAdjust}>
            <Modal.Body>
              <p className="small text-muted mb-3">
                Batch adjust retail selling prices across Central Supply &amp; Consumables. This will create updated
                effective price list entries and update fallback catalog pricing.
              </p>
              <div className="mb-3">
                <Form.Label className="small font-weight-bold">Adjustment Direction</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    id="dir-inc"
                    name="adj-direction"
                    label="Increase Price (+)"
                    checked={adjDirection === "INCREASE"}
                    onChange={() => setAdjDirection("INCREASE")}
                  />
                  <Form.Check
                    type="radio"
                    id="dir-dec"
                    name="adj-direction"
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
                  placeholder="e.g. Q4 Supply inflation adjustment"
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsAdjustModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={isSubmittingAdjust}>
                {isSubmittingAdjust ? "Applying..." : "Apply Price Adjustment"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* CSV Bulk Import Modal */}
      {isCsvModalOpen && (
        <Modal show={true} onHide={() => setIsCsvModalOpen(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title className="h5 font-weight-bold">Bulk CSV Import — Location Item Parameters</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleImportCsv}>
            <Modal.Body>
              <p className="small text-muted mb-2">
                Paste CSV data containing location parameters. Required headers: <code>location_code, item_code, min_qty</code>.
              </p>
              <div className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <Form.Label className="small font-weight-bold mb-0">CSV Data</Form.Label>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setCsvText(
                        `location_code,item_code,min_qty,max_qty,par_qty,reorder_point\nMAIN_STORE,MED-AMOX-500,20,200,100,50\nPHARMACY_1,MED-PCM-500,50,500,250,100\nMAIN_STORE,INVALID-ITEM-CODE,10,100,50,20`
                      )
                    }
                  >
                    Load Sample CSV
                  </Button>
                </div>
                <Form.Control
                  as="textarea"
                  rows={6}
                  className="font-monospace small"
                  placeholder="location_code,item_code,min_qty&#10;MAIN-PHARM,SUP-GLV-01,100"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  required
                />
              </div>

              {importReport && (
                <div className="mt-3">
                  <h6 className="font-weight-bold mb-2">Import Summary &amp; Error Report</h6>
                  <div className="d-flex gap-3 mb-2 small">
                    <span className="badge bg-secondary">Total: {importReport.totalRows}</span>
                    <span className="badge bg-success">Success: {importReport.importedCount}</span>
                    <span className="badge bg-danger">Failed: {importReport.failedCount}</span>
                  </div>

                  {importReport.errors.length > 0 && (
                    <div className="table-responsive border rounded">
                      <table className="table table-sm table-striped mb-0 small">
                        <thead className="table-light">
                          <tr>
                            <th>Row #</th>
                            <th>Location</th>
                            <th>Item Code</th>
                            <th>Error Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importReport.errors.map((err, idx) => (
                            <tr key={idx} className="table-danger">
                              <td>{err.rowNumber}</td>
                              <td>{err.locationCode || "—"}</td>
                              <td>{err.itemCode || "—"}</td>
                              <td>{err.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setIsCsvModalOpen(false)}>
                Close
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Process CSV Import
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
