import React, { useState } from "react";
import { AlertBanner, StatusPill, Button, Modal, Form } from "@clinic/ui";

interface ItemMasterRecord {
  id: string;
  code: string;
  name: string;
  itemType: "MEDICINE" | "CONSUMABLE" | "REAGENT" | "EQUIPMENT";
  baseUom: string;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  minShelfLifeDays: number;
  standardCost: number;
  status: "ACTIVE" | "INACTIVE";
}

const INITIAL_ITEMS: ItemMasterRecord[] = [
  {
    id: "item-1",
    code: "MED-AMOX-500",
    name: "Amoxicillin 500mg Capsule",
    itemType: "MEDICINE",
    baseUom: "CAP",
    isBatchTracked: true,
    isExpiryTracked: true,
    minShelfLifeDays: 30,
    standardCost: 8.50,
    status: "ACTIVE",
  },
  {
    id: "item-2",
    code: "MED-PCM-500",
    name: "Paracetamol 500mg Tablet",
    itemType: "MEDICINE",
    baseUom: "TAB",
    isBatchTracked: true,
    isExpiryTracked: true,
    minShelfLifeDays: 30,
    standardCost: 1.50,
    status: "ACTIVE",
  },
  {
    id: "item-3",
    code: "MED-CEF-1G",
    name: "Ceftriaxone 1g Powder for Injection",
    itemType: "MEDICINE",
    baseUom: "VIAL",
    isBatchTracked: true,
    isExpiryTracked: true,
    minShelfLifeDays: 60,
    standardCost: 65.00,
    status: "ACTIVE",
  },
  {
    id: "item-4",
    code: "SUP-GLV-M",
    name: "Latex Examination Gloves (M)",
    itemType: "CONSUMABLE",
    baseUom: "BOX",
    isBatchTracked: true,
    isExpiryTracked: true,
    minShelfLifeDays: 90,
    standardCost: 280.00,
    status: "ACTIVE",
  },
  {
    id: "item-5",
    code: "SUP-SYR-5ML",
    name: "Disposable Syringe 5mL w/ 23G Needle",
    itemType: "CONSUMABLE",
    baseUom: "PCS",
    isBatchTracked: false,
    isExpiryTracked: true,
    minShelfLifeDays: 180,
    standardCost: 12.00,
    status: "ACTIVE",
  },
];

export function ItemMasterPage() {
  const [items, setItems] = useState<ItemMasterRecord[]>(INITIAL_ITEMS);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importReport, setImportReport] = useState<{
    totalRows: number;
    importedCount: number;
    failedCount: number;
    errors: { rowNumber: number; locationCode?: string; itemCode?: string; reason: string }[];
  } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  // Form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<"MEDICINE" | "CONSUMABLE" | "REAGENT" | "EQUIPMENT">("MEDICINE");
  const [baseUom, setBaseUom] = useState("PCS");
  const [isBatchTracked, setIsBatchTracked] = useState(true);
  const [isExpiryTracked, setIsExpiryTracked] = useState(true);
  const [minShelfLifeDays, setMinShelfLifeDays] = useState(30);
  const [standardCost, setStandardCost] = useState(10.00);

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "ALL" || item.itemType === typeFilter;
    return matchesSearch && matchesType;
  });

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name) return;

    const newItem: ItemMasterRecord = {
      id: `item-${Date.now()}`,
      code: code.toUpperCase(),
      name,
      itemType,
      baseUom,
      isBatchTracked,
      isExpiryTracked,
      minShelfLifeDays,
      standardCost,
      status: "ACTIVE",
    };

    setItems((prev) => [newItem, ...prev]);
    setIsModalOpen(false);
    setAlert(`Item ${newItem.code} (${newItem.name}) registered in item master.`);

    // Reset form
    setCode("");
    setName("");
    setStandardCost(10.00);
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
      setAlert(`Successfully imported ${imported} location parameter records.`);
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
            Item definitions, UOM configurations, batch &amp; shelf-life rules, and pricing parameters.
          </p>
        </div>
        <div className="d-flex gap-2">
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
          <AlertBanner tone="success">{alert}</AlertBanner>
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
                <option value="MEDICINE">Medicines &amp; Pharmaceuticals</option>
                <option value="CONSUMABLE">Medical Supplies &amp; Consumables</option>
                <option value="REAGENT">Laboratory Reagents</option>
                <option value="EQUIPMENT">Equipment &amp; Assets</option>
              </select>
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
                  <th className="text-center">Batch / Expiry</th>
                  <th className="text-end">Min Shelf Life</th>
                  <th className="text-end">Std. Cost</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <code>{item.code}</code>
                    </td>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>
                      <span className="badge bg-light text-dark border">{item.itemType}</span>
                    </td>
                    <td>{item.baseUom}</td>
                    <td className="text-center">
                      {item.isBatchTracked && (
                        <span className="badge bg-info-subtle text-info me-1" title="Batch tracked">
                          BATCH
                        </span>
                      )}
                      {item.isExpiryTracked && (
                        <span className="badge bg-secondary-subtle text-secondary" title="Expiry tracked">
                          EXPIRY
                        </span>
                      )}
                    </td>
                    <td className="text-end text-muted">{item.minShelfLifeDays} days</td>
                    <td className="text-end font-weight-bold">₱{item.standardCost.toFixed(2)}</td>
                    <td className="text-center">
                      <StatusPill tone="normal" label={item.status} />
                    </td>
                  </tr>
                ))}
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
                    placeholder="e.g. MED-AMX-500"
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
                    placeholder="e.g. Amoxicillin 500mg Capsule"
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
                    <option value="MEDICINE">Medicine / Drug</option>
                    <option value="CONSUMABLE">Medical Supply / Consumable</option>
                    <option value="REAGENT">Laboratory Reagent</option>
                    <option value="EQUIPMENT">Equipment / Asset</option>
                  </Form.Select>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Base Unit of Measure</Form.Label>
                  <Form.Select
                    size="sm"
                    value={baseUom}
                    onChange={(e) => setBaseUom(e.target.value)}
                  >
                    <option value="PCS">Pieces (PCS)</option>
                    <option value="CAP">Capsule (CAP)</option>
                    <option value="TAB">Tablet (TAB)</option>
                    <option value="VIAL">Vial (VIAL)</option>
                    <option value="BOTTLE">Bottle (BOTTLE)</option>
                    <option value="BOX">Box (BOX)</option>
                  </Form.Select>
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">Standard Cost (₱)</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    step="0.01"
                    value={standardCost}
                    onChange={(e) => setStandardCost(parseFloat(e.target.value) || 0)}
                    required
                  />
                </div>
                <div className="col-12 col-md-6">
                  <Form.Label className="small font-weight-bold">
                    Min Remaining Shelf-Life on Receipt (days) *
                  </Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    value={minShelfLifeDays}
                    onChange={(e) => setMinShelfLifeDays(parseInt(e.target.value, 10) || 30)}
                    required
                  />
                </div>
                <div className="col-12">
                  <div className="d-flex gap-4">
                    <Form.Check
                      type="checkbox"
                      id="batchCheck"
                      label="Batch / Lot Tracked"
                      checked={isBatchTracked}
                      onChange={(e) => setIsBatchTracked(e.target.checked)}
                    />
                    <Form.Check
                      type="checkbox"
                      id="expiryCheck"
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
              <Button variant="primary" size="sm" type="submit">
                Register Item
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {/* Bulk CSV Import Modal */}
      {isCsvModalOpen && (
        <Modal show={isCsvModalOpen} onHide={() => setIsCsvModalOpen(false)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title className="h5 font-weight-bold">
              Bulk CSV Import — Location Item Parameters (todo §4.1)
            </Modal.Title>
          </Modal.Header>
          <form onSubmit={handleImportCsv}>
            <Modal.Body>
              <p className="text-muted small mb-3">
                Bulk configure min, max, par, and reorder levels across locations.
                Format: <code>location_code,item_code,min_qty,max_qty,par_qty,reorder_point</code>
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
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="Paste CSV lines here..."
                  required
                />
              </div>

              {importReport && (
                <div className="mt-3">
                  <h6 className="font-weight-bold mb-2">Import Summary & Error Report</h6>
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
