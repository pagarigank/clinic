import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, EmptyState, Form, SkeletonTable, StatusPill } from "@clinic/ui";
import { ApiError, apiGetBlob } from "../../shared/api/client.js";
import { supplyApi } from "./api.js";
import type { SupplyItemRow, SupplyLocation, SupplyStockRow } from "./api.js";
import { ConsumptionPrintModal } from "./ConsumptionPrintModal.js";

type RefType = "VISIT" | "LAB" | "PROCEDURE" | "HOUSE_USE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const base = e.problem.title || e.problem.code;
    return e.problem.detail ? `${base} — ${e.problem.detail}` : base;
  }
  return e instanceof Error ? e.message : "Unexpected error";
}

function batchesFor(stock: SupplyStockRow[], locationId: string): SupplyStockRow[] {
  return stock
    .filter(
      (s) =>
        s.batch_status === "AVAILABLE" &&
        num(s.qty_on_hand) > 0 &&
        (!locationId || s.location_id === locationId),
    )
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
}

function fefoBatchId(batches: SupplyStockRow[], qty: number): string {
  const enough = batches.find((b) => num(b.qty_on_hand) >= qty);
  return (enough ?? batches[0])?.batch_id ?? "";
}

export function SupplyIssueWorkbenchPage() {
  const [items, setItems] = useState<SupplyItemRow[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [itemLoading, setItemLoading] = useState(false);

  const [locations, setLocations] = useState<SupplyLocation[]>([]);

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [stock, setStock] = useState<SupplyStockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [refType, setRefType] = useState<RefType>("HOUSE_USE");
  const [refId, setRefId] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const selectedItem = items.find((i) => i.id === itemId) ?? null;
  const selectedLocation = locations.find((l) => l.id === locationId) ?? null;

  useEffect(() => {
    supplyApi
      .listLocations()
      .then((locs) => {
        setLocations(locs);
        const first = locs[0];
        if (first) setLocationId((prev) => prev || first.id);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItemLoading(true);
    const handle = setTimeout(() => {
      supplyApi
        .listItems(itemQuery.trim() ? { search: itemQuery.trim() } : undefined)
        .then((rows) => !cancelled && setItems(rows))
        .catch((e) => !cancelled && setError(errText(e)))
        .finally(() => !cancelled && setItemLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [itemQuery]);

  const loadStock = useCallback(
    async (nextItemId: string) => {
      if (!nextItemId) {
        setStock([]);
        return;
      }
      setStockLoading(true);
      try {
        const rows = await supplyApi.getStock({ itemId: nextItemId });
        setStock(rows);
        const available = batchesFor(rows, locationId);
        setBatchId(fefoBatchId(available, qty || 1));
      } catch (e) {
        setError(errText(e));
      } finally {
        setStockLoading(false);
      }
    },
    [locationId, qty],
  );

  const onSelectItem = useCallback(
    (nextItemId: string) => {
      setItemId(nextItemId);
      setQty(0);
      setNotice(null);
      setError(null);
      void loadStock(nextItemId);
    },
    [loadStock],
  );

  const batches = useMemo(() => batchesFor(stock, locationId), [stock, locationId]);

  const onLocationChange = useCallback(
    (nextLoc: string) => {
      setLocationId(nextLoc);
      const available = batchesFor(stock.filter((s) => s.location_id === nextLoc), nextLoc);
      setBatchId(fefoBatchId(available, qty || 1));
    },
    [stock, qty],
  );

  const selectedBatch = batches.find((b) => b.batch_id === batchId) ?? null;
  const shortfall = !!selectedBatch && qty > num(selectedBatch.qty_on_hand);

  const reset = useCallback(() => {
    setQty(0);
    setRefId("");
    setNotes("");
  }, []);

  const handlePost = useCallback(async () => {
    setError(null);
    setNotice(null);

    if (!selectedItem) {
      setError("Select an item to issue.");
      return;
    }
    if (!selectedLocation) {
      setError("Select a stock location.");
      return;
    }
    if (qty <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (refType !== "HOUSE_USE" && refId.trim() && !UUID_RE.test(refId.trim())) {
      setError("Reference ID must be a valid UUID (or left blank).");
      return;
    }
    const available = batches.reduce((sum, b) => sum + num(b.qty_on_hand), 0);
    if (available < qty) {
      setError(
        `Insufficient stock in ${selectedLocation.name}: ${available} available, ${qty} requested.`,
      );
      return;
    }

    setBusy(true);
    try {
      const result = await supplyApi.postConsumption({
        locationId: selectedLocation.id,
        itemId: selectedItem.id,
        batchId: batchId || undefined,
        qty,
        uomId: selectedItem.base_uom_id,
        refType,
        refId: refType !== "HOUSE_USE" && refId.trim() ? refId.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      const allocated = num((result as { allocatedCount?: number }).allocatedCount);
      setNotice(
        `Issued ${qty} ${selectedItem.uom_code ?? ""} of ${selectedItem.name} from ${selectedLocation.name}.` +
          (allocated > 1 ? ` Allocated across ${allocated} FEFO batches.` : ""),
      );
      reset();
      await loadStock(selectedItem.id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [
    selectedItem,
    selectedLocation,
    qty,
    refType,
    refId,
    notes,
    batchId,
    batches,
    reset,
    loadStock,
  ]);

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1200 }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item">
                <Link to="/supply">Supply &amp; Inventory</Link>
              </li>
              <li className="breadcrumb-item active" aria-current="page">
                Issue / Consumption
              </li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-0" style={{ color: "var(--brand-primary)" }}>
            Supply Issue Workbench
          </h1>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => setIsPrintModalOpen(true)}
          >
            🖨️ Print Consumption List
          </Button>
          <Link to="/supply/stock">
            <Button variant="outline-secondary" size="sm">
              Stock Explorer
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <div className="row g-3">
        {/* Item picker */}
        <div className="col-lg-5">
          <div className="card h-100 shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
            <div className="card-header bg-white border-bottom py-3">
              <h2 className="h6 fw-bold mb-2">1. Select Item</h2>
              <Form.Control
                type="search"
                placeholder="Search item name or code…"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                aria-label="Search items"
              />
            </div>
            {itemLoading ? (
              <SkeletonTable rows={4} />
            ) : items.length === 0 ? (
              <EmptyState
                headline="No items found"
                explanation="Try a different search term or add items in the Item Master."
              />
            ) : (
              <div className="list-group list-group-flush" style={{ maxHeight: 420, overflowY: "auto" }}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`list-group-item list-group-item-action d-flex justify-content-between align-items-start ${
                      item.id === itemId ? "active" : ""
                    }`}
                    onClick={() => onSelectItem(item.id)}
                    aria-pressed={item.id === itemId}
                  >
                    <span>
                      <span className="fw-semibold d-block">{item.name}</span>
                      <span
                        className={`small ${item.id === itemId ? "text-white-50" : "text-muted"}`}
                      >
                        {item.code} · {item.category_name ?? "Uncategorised"}
                      </span>
                    </span>
                    <Badge bg={item.id === itemId ? "light" : "secondary"} text={item.id === itemId ? "dark" : undefined}>
                      {Number(item.total_on_hand).toLocaleString()} {item.uom_code ?? ""}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Issue form */}
        <div className="col-lg-7">
          <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
            <div className="card-header bg-white border-bottom py-3">
              <h2 className="h6 fw-bold mb-0">2. Issue Details</h2>
            </div>
            <div className="card-body">
              {!selectedItem ? (
                <EmptyState
                  headline="No item selected"
                  explanation="Choose an item on the left to configure the issue."
                />
              ) : (
                <>
                  <div className="d-flex align-items-center justify-content-between mb-3 p-3 rounded bg-light">
                    <div>
                      <div className="fw-bold">{selectedItem.name}</div>
                      <div className="small text-muted">
                        {selectedItem.code} · Unit: {selectedItem.uom_code ?? "—"}
                      </div>
                    </div>
                    <div className="text-end small text-muted">
                      Total on hand
                      <div className="fw-bold text-dark">
                        {Number(selectedItem.total_on_hand).toLocaleString()} {selectedItem.uom_code ?? ""}
                      </div>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <Form.Label htmlFor="issueLocation" className="fw-semibold">
                        Source Location
                      </Form.Label>
                      <Form.Select
                        id="issueLocation"
                        value={locationId}
                        onChange={(e) => onLocationChange(e.target.value)}
                      >
                        {locations.length === 0 && <option value="">No locations configured</option>}
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.type})
                          </option>
                        ))}
                      </Form.Select>
                    </div>
                    <div className="col-md-6">
                      <Form.Label htmlFor="issueRefType" className="fw-semibold">
                        Issue Purpose
                      </Form.Label>
                      <Form.Select
                        id="issueRefType"
                        value={refType}
                        onChange={(e) => setRefType(e.target.value as RefType)}
                      >
                        <option value="HOUSE_USE">House Use</option>
                        <option value="VISIT">Patient Visit</option>
                        <option value="LAB">Laboratory</option>
                        <option value="PROCEDURE">Procedure</option>
                      </Form.Select>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Form.Label className="fw-semibold">Batch (FEFO auto-suggested)</Form.Label>
                    {stockLoading ? (
                      <SkeletonTable rows={1} />
                    ) : batches.length === 0 ? (
                      <Alert variant="warning" className="mb-0">
                        No available stock for this item at{" "}
                        {selectedLocation?.name ?? "the selected location"}.
                      </Alert>
                    ) : (
                      <Form.Select
                        value={batchId}
                        onChange={(e) => setBatchId(e.target.value)}
                        aria-label="Batch"
                      >
                        {batches.map((b) => (
                          <option key={b.batch_id} value={b.batch_id}>
                            Lot {b.lot_no} · Exp {String(b.expiry_date).slice(0, 10)} · Avail{" "}
                            {num(b.qty_on_hand)}
                          </option>
                        ))}
                      </Form.Select>
                    )}
                  </div>

                  <div className="row g-3 mt-1">
                    <div className="col-md-4">
                      <Form.Label htmlFor="issueQty" className="fw-semibold">
                        Quantity
                      </Form.Label>
                      <Form.Control
                        id="issueQty"
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => setQty(Number(e.target.value))}
                      />
                    </div>
                    <div className="col-md-8">
                      <Form.Label htmlFor="issueRefId" className="fw-semibold">
                        Reference ID {refType !== "HOUSE_USE" ? "(visit/lab/procedure)" : ""}
                      </Form.Label>
                      <Form.Control
                        id="issueRefId"
                        placeholder={refType === "HOUSE_USE" ? "Not required" : "UUID (optional)"}
                        value={refId}
                        disabled={refType === "HOUSE_USE"}
                        onChange={(e) => setRefId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <Form.Label htmlFor="issueNotes" className="fw-semibold">
                      Notes
                    </Form.Label>
                    <Form.Control
                      id="issueNotes"
                      as="textarea"
                      rows={2}
                      maxLength={500}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>

                  {shortfall && (
                    <Alert variant="danger" className="mt-3 mb-0">
                      Requested quantity exceeds the selected batch. Post will fail unless more stock
                      is available across FEFO batches.
                    </Alert>
                  )}
                </>
              )}
            </div>
            <div className="card-footer bg-light p-3 d-flex justify-content-between align-items-center">
              <div className="small text-muted">
                {selectedBatch ? (
                  <>
                    Pick: Lot {selectedBatch.lot_no} · Exp{" "}
                    {String(selectedBatch.expiry_date).slice(0, 10)}
                  </>
                ) : (
                  "FEFO allocation runs on the server when no batch is chosen."
                )}
              </div>
              <Button
                variant="primary"
                onClick={handlePost}
                disabled={busy || !selectedItem || batches.length === 0 || qty <= 0}
              >
                {busy ? "Issuing…" : "Issue Stock"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {selectedItem && stock.length > 0 && (
        <div className="card shadow-sm border-0 mt-4" style={{ background: "var(--surface-raised)" }}>
          <div className="card-header bg-white border-bottom py-3">
            <h2 className="h6 fw-bold mb-0">Available Batches for {selectedItem.name}</h2>
          </div>
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle mb-0">
              <thead className="table-light">
                <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                  <th>Location</th>
                  <th>Lot</th>
                  <th>Expiry</th>
                  <th className="text-end">Qty on Hand</th>
                  <th className="text-end">Reserved</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.batch_id}>
                    <td>{s.location_name}</td>
                    <td className="font-monospace">{s.lot_no}</td>
                    <td>{String(s.expiry_date).slice(0, 10)}</td>
                    <td className="text-end fw-semibold">{num(s.qty_on_hand)}</td>
                    <td className="text-end text-muted">{num(s.qty_reserved)}</td>
                    <td>
                      <StatusPill
                        tone={s.batch_status === "AVAILABLE" ? "normal" : "high"}
                        label={s.batch_status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConsumptionPrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        defaultLocationId={locationId}
        defaultLocationName={selectedLocation?.name}
      />
    </div>
  );
}
