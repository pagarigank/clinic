import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, EmptyState, Form, Modal, SearchCombobox, SkeletonTable, StatusPill, fuzzyFilter } from "@clinic/ui";
import { ApiError } from "../../shared/api/client.js";
import { supplyApi } from "./api.js";
import type { PatientSupplyRequestRow, SupplyItemRow, SupplyLocation, SupplyStockRow } from "./api.js";
import { ConsumptionPrintModal } from "./ConsumptionPrintModal.js";
import { PatientGroupedRequestList, type PatientGroup } from "../../shared/dispensing/PatientGroupedRequestList.js";

type RefType = "VISIT" | "LAB" | "PROCEDURE" | "HOUSE_USE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Label used for a supply-item option in the fuzzy pickers. */
function supplyItemLabel(item: SupplyItemRow): string {
  return `${item.name} (${item.code})`;
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
  // Patient-grouped dispensing is the workbench default for every module
  // (pharmacy, lab, central supply); the toggle still exposes direct stock issue.
  const [viewMode, setViewMode] = useState<"PATIENT" | "DIRECT">("PATIENT");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const [patientRequests, setPatientRequests] = useState<PatientSupplyRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);

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
    supplyApi
      .listItems()
      .then((rows) => !cancelled && setItems(rows))
      .catch((e) => !cancelled && setError(errText(e)))
      .finally(() => !cancelled && setItemLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Fuzzy, client-side search over the one-time-loaded catalogue (bounded —
  // listItems has no server paging), matching the consultation request pickers
  // and ranking subsequence hits that a plain server ILIKE would miss.
  const filteredItems = useMemo(
    () => fuzzyFilter(items, itemQuery, supplyItemLabel),
    [items, itemQuery],
  );

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

  const loadPatientRequests = useCallback(async () => {
    setRequestsLoading(true);
    setRequestsError(null);
    try {
      const rows = await supplyApi.listPatientRequests();
      setPatientRequests(rows || []);
    } catch (e) {
      setRequestsError(errText(e));
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPatientRequests();
  }, [loadPatientRequests]);

  // Group pending request lines by patient: one row per patient, drill down to lines.
  const supplyPatientGroups = useMemo((): PatientGroup<PatientSupplyRequestRow>[] => {
    const map = new Map<string, PatientGroup<PatientSupplyRequestRow>>();
    for (const row of patientRequests) {
      const name =
        `${row.patient_first_name || ""} ${row.patient_last_name || ""}`.trim() || "Unknown Patient";
      const existing = map.get(row.patient_id);
      if (!existing) {
        map.set(row.patient_id, {
          patientId: row.patient_id,
          patientName: name,
          patientIdDisplay: row.hrn || null,
          pendingCount: 1,
          oldestRequestAt: row.requested_at,
          requests: [row],
          meta: { orderNos: [row.request_no] },
        });
      } else {
        existing.requests.push(row);
        existing.pendingCount += 1;
        if (row.requested_at && (!existing.oldestRequestAt || row.requested_at < existing.oldestRequestAt)) {
          existing.oldestRequestAt = row.requested_at;
        }
        if (row.request_no && !existing.meta!.orderNos.includes(row.request_no)) {
          existing.meta!.orderNos.push(row.request_no);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.oldestRequestAt ?? "").localeCompare(String(b.oldestRequestAt ?? ""))
    );
  }, [patientRequests]);

  const handleIssuePatientRequest = useCallback(
    async (row: PatientSupplyRequestRow) => {
      setError(null);
      setNotice(null);
      const targetLoc = locationId || locations[0]?.id;
      if (!targetLoc) {
        setError("Please select a valid stock location to issue supplies from.");
        return;
      }
      const remaining = num(row.qty_requested) - num(row.qty_issued);
      if (remaining <= 0) {
        setError("This request line has already been fully issued.");
        return;
      }
      setBusy(true);
      try {
        await supplyApi.issuePatientRequest(row.id, row.request_item_id, {
          locationId: targetLoc,
          qty: remaining,
        });
        setNotice(
          `Successfully issued ${remaining} ${row.uom_code || ""} of ${row.item_name} to ` +
            `${row.patient_first_name} ${row.patient_last_name}.`,
        );
        await loadPatientRequests();
        if (row.item_id === itemId) {
          await loadStock(row.item_id);
        }
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [locationId, locations, itemId, loadStock, loadPatientRequests],
  );

  // Create a patient supply request so the queue has a real origin (SUP-T10).
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [reqPatientId, setReqPatientId] = useState("");
  const [reqItemId, setReqItemId] = useState("");
  const [reqItemSearch, setReqItemSearch] = useState("");
  const [reqQty, setReqQty] = useState(1);
  const [reqNotes, setReqNotes] = useState("");
  const [reqSubmitting, setReqSubmitting] = useState(false);

  const reqItemOptions = useMemo(
    () => fuzzyFilter(items, reqItemSearch, supplyItemLabel),
    [items, reqItemSearch],
  );

  const handleCreateRequest = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setNotice(null);
      const branchId = selectedLocation?.branch_id || locations[0]?.branch_id;
      const item = items.find((i) => i.id === reqItemId);
      if (!UUID_RE.test(reqPatientId.trim())) {
        setError("Enter a valid patient UUID to create a supply request.");
        return;
      }
      if (!item || reqQty <= 0 || !branchId) {
        setError("Choose an item, a positive quantity, and an issuing branch.");
        return;
      }
      setReqSubmitting(true);
      try {
        await supplyApi.createPatientRequest({
          branchId,
          patientId: reqPatientId.trim(),
          notes: reqNotes.trim() || undefined,
          items: [{ itemId: item.id, uomId: item.base_uom_id, qtyRequested: reqQty }],
        });
        setIsRequestModalOpen(false);
        const created = reqPatientId.trim();
        setReqPatientId("");
        setReqItemId("");
        setReqItemSearch("");
        setReqQty(1);
        setReqNotes("");
        setNotice(`Supply request created for patient ${created.slice(0, 8)}…`);
        await loadPatientRequests();
      } catch (err) {
        setError(errText(err));
      } finally {
        setReqSubmitting(false);
      }
    },
    [selectedLocation, locations, items, reqPatientId, reqItemId, reqQty, reqNotes, loadPatientRequests],
  );

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
                Dispensing &amp; Issue
              </li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-0" style={{ color: "var(--brand-primary)" }}>
            Supply Dispensing &amp; Issue Workbench
          </h1>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsRequestModalOpen(true)}
          >
            ➕ New Supply Request
          </Button>
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
      {requestsError && (
        <Alert variant="warning" dismissible onClose={() => setRequestsError(null)}>
          Could not load patient supply requests: {requestsError}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* Workbench View Mode Switcher */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
        <div className="btn-group" role="group" aria-label="Workbench view mode">
          <button
            type="button"
            className={`btn btn-sm ${viewMode === "PATIENT" ? "btn-primary fw-semibold" : "btn-outline-secondary"}`}
            onClick={() => setViewMode("PATIENT")}
          >
            👥 Group by Patient (Requests Queue)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === "DIRECT" ? "btn-primary fw-semibold" : "btn-outline-secondary"}`}
            onClick={() => setViewMode("DIRECT")}
          >
            📦 Direct Stock Issue
          </button>
        </div>

        {viewMode === "PATIENT" && (
          <span className="small text-muted">
            Filtered strictly to clinical supplies and consumables ordered for patient encounters.
          </span>
        )}
      </div>

      {viewMode === "PATIENT" ? (
        <PatientGroupedRequestList<PatientSupplyRequestRow>
          module="SUPPLY"
          title="Patient Supply Dispensing & Issue"
          subtitle="Review and issue clinical supplies, procedure consumables, and encounter materials grouped by patient."
          groups={supplyPatientGroups}
          loading={requestsLoading}
          selectedPatientId={selectedPatientId}
          onSelectPatient={setSelectedPatientId}
          selectButtonLabel="Select Patient & Issue"
          searchPlaceholder="Filter patients by name or ID…"
          emptyMessage="No patients have pending supply requests."
          renderRequests={(group) => (
            <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
              <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                <h3 className="h6 fw-bold mb-0 text-dark">
                  Supply &amp; Consumable Requests for {group.patientName}
                </h3>
                <span className="badge bg-primary-subtle text-primary">
                  {group.requests.length} Line{group.requests.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
                      <th>Item Description</th>
                      <th>Requested</th>
                      <th>Request No.</th>
                      <th>Visit</th>
                      <th>Requested Date</th>
                      <th>Status</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.requests.map((row) => {
                      const remaining = num(row.qty_requested) - num(row.qty_issued);
                      return (
                        <tr key={row.request_item_id}>
                          <td>
                            <div className="fw-bold text-dark">{row.item_name}</div>
                            <div className="small text-muted font-monospace">{row.item_code}</div>
                            {row.item_notes && (
                              <div className="small text-muted">{row.item_notes}</div>
                            )}
                          </td>
                          <td>
                            <span className="badge bg-secondary px-2 py-1">
                              {remaining} {row.uom_code || ""}
                            </span>
                            {num(row.qty_issued) > 0 && (
                              <div className="small text-muted">
                                of {num(row.qty_requested)} ({num(row.qty_issued)} issued)
                              </div>
                            )}
                          </td>
                          <td className="font-monospace small">{row.request_no}</td>
                          <td>
                            {row.visit_no ? (
                              <span className="badge bg-light text-dark border">{row.visit_no}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="small text-muted">
                            {new Date(row.requested_at).toLocaleString()}
                          </td>
                          <td>
                            <StatusPill
                              tone={row.status === "PENDING" ? "pending" : "normal"}
                              label={row.status}
                            />
                          </td>
                          <td className="text-end">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={busy || remaining <= 0}
                              onClick={() => void handleIssuePatientRequest(row)}
                            >
                              {busy
                                ? "Issuing…"
                                : `Issue ${remaining} ${row.uom_code || ""} →`}
                            </Button>
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
      ) : (
        <>
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
            ) : filteredItems.length === 0 ? (
              <EmptyState
                headline="No items found"
                explanation="Try a different search term or add items in the Item Master."
              />
            ) : (
              <div className="list-group list-group-flush" style={{ maxHeight: 420, overflowY: "auto" }}>
                {filteredItems.map((item) => (
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
    </>
  )}

      <Modal show={isRequestModalOpen} onHide={() => setIsRequestModalOpen(false)}>
        <form onSubmit={handleCreateRequest}>
          <Modal.Header closeButton>
            <Modal.Title className="h5">New Patient Supply Request</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="row g-3">
              <div className="col-12 col-md-6">
                <Form.Label className="small fw-semibold">Patient ID / MRN *</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. 00000000-0000-0000-0000-000000000001"
                  value={reqPatientId}
                  onChange={(e) => setReqPatientId(e.target.value)}
                  required
                />
                <Form.Text className="text-muted">Registered patient UUID</Form.Text>
              </div>
              <div className="col-12 col-md-6">
                <SearchCombobox
                  id="req-item-select"
                  label="Requested Item *"
                  placeholder="Type to search supply or consumable…"
                  value={reqItemSearch}
                  onChange={(v) => {
                    setReqItemSearch(v);
                    const match = items.find((it) => supplyItemLabel(it) === v);
                    setReqItemId(match ? match.id : "");
                  }}
                  onSearch={setReqItemSearch}
                  options={reqItemOptions}
                  getOptionId={(o) => (o as SupplyItemRow).id}
                  getOptionLabel={(o) => supplyItemLabel(o as SupplyItemRow)}
                  getOptionDescription={(o) => (o as SupplyItemRow).category_name ?? null}
                  emptyMessage="No matching supply item"
                />
              </div>
              <div className="col-12 col-md-4">
                <Form.Label className="small fw-semibold">Quantity *</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  value={reqQty}
                  onChange={(e) => setReqQty(Math.max(1, Number(e.target.value)))}
                  required
                />
              </div>
              <div className="col-12">
                <Form.Label className="small fw-semibold">Notes</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  maxLength={1000}
                  placeholder="e.g. Wound dressing for procedure"
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setIsRequestModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={reqSubmitting}>
              {reqSubmitting ? "Creating…" : "Create Request"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      <ConsumptionPrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        defaultLocationId={locationId}
        defaultLocationName={selectedLocation?.name}
      />
    </div>
  );
}
