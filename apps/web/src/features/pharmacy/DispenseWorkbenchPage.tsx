import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Form,
  Modal,
  PatientBanner,
  SkeletonTable,
  StatusPill,
} from "@clinic/ui";
import { ApiError, printBlob } from "../../shared/api/client.js";
import { pharmacyApi } from "./api.js";
import type {
  DispenseDetail,
  PharmacyQueueRow,
  PharmacyStockRow,
  PrescriptionDetail,
  StockLocation,
} from "./api.js";
import { supplyApi } from "../supply/api.js";
import type { SupplyItemRow, SupplyStockRow } from "../supply/api.js";
import type { DispenseItemInput } from "@clinic/contracts";
import { PatientGroupedRequestList, type PatientGroup } from "../../shared/dispensing/PatientGroupedRequestList.js";

interface LineState {
  prescriptionItemId: string;
  itemId: string;
  itemCode?: string;
  itemName: string;
  genericName: string;
  sig: string;
  prescribedQty: number;
  qty: number;
  controlled: boolean;
  batches: PharmacyStockRow[];
  batchId: string;
  overrideReason?: string;
}

interface ControlledDetails {
  specialRxSerial: string;
  prescriberS2No: string;
  qtyWords: string;
  witnessId: string;
}

interface IssuedItemRecord {
  id: string;
  name: string;
  code?: string;
  lot: string;
  qty: number;
  uom?: string;
  time: string;
  type: "PROCEDURE" | "SUPPLY";
}

interface PatientQueueGroup {
  patientId: string;
  patientName: string;
  hrn?: string | null;
  birthDate?: string | null;
  patientSex?: string | null;
  visitId: string;
  visitNo: string;
  prescriberName: string;
  prescriptions: PharmacyQueueRow[];
  totalItems: number;
  hasControlled: boolean;
  status: string;
  latestIssuedAt?: string | null;
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function batchesFor(
  stock: PharmacyStockRow[],
  itemId: string,
  locationId: string,
): PharmacyStockRow[] {
  return stock
    .filter(
      (s) =>
        s.item_id === itemId &&
        s.batch_status === "AVAILABLE" &&
        num(s.qty_on_hand) > 0 &&
        (!locationId || s.location_id === locationId),
    )
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
}

/** Earliest-expiring batch with enough quantity, else the earliest available. */
function fefoBatchId(batches: PharmacyStockRow[], qty: number): string {
  const enough = batches.find((b) => num(b.qty_on_hand) >= qty);
  return (enough ?? batches[0])?.batch_id ?? "";
}

function buildLines(
  rx: PrescriptionDetail,
  stock: PharmacyStockRow[],
  locationId: string,
): LineState[] {
  return rx.items
    .filter((it) => !!it.item_id)
    .map((it) => {
      const remaining = Math.max(0, num(it.qty_prescribed) - num(it.qty_dispensed));
      const batches = batchesFor(stock, it.item_id as string, locationId);
      return {
        prescriptionItemId: it.id,
        itemId: it.item_id as string,
        itemCode: it.item_code ?? undefined,
        itemName: it.item_name || it.brand_name || it.generic_name,
        genericName: [it.generic_name, it.strength].filter(Boolean).join(" "),
        sig: [it.sig_dose, it.sig_frequency, it.sig_duration].filter(Boolean).join(" · "),
        prescribedQty: remaining,
        qty: remaining,
        controlled: !!it.controlled_schedule,
        batches,
        batchId: fefoBatchId(batches, remaining),
      };
    })
    .filter((l) => l.prescribedQty > 0);
}

const SEXES = new Set(["MALE", "FEMALE", "OTHER"]);

export function DispenseWorkbenchPage() {
  const { id: rxId } = useParams();
  const navigate = useNavigate();

  // Queue state
  const [queue, setQueue] = useState<PharmacyQueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState("");
  const [viewMode, setViewMode] = useState<"PATIENT" | "PRESCRIPTION">("PATIENT");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "CONTROLLED" | "NORMAL">("ALL");

  // Selected Prescription & Pharmacy Lines
  const [rx, setRx] = useState<PrescriptionDetail | null>(null);
  const [stock, setStock] = useState<PharmacyStockRow[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<LineState[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DispenseDetail | null>(null);
  const [posted, setPosted] = useState<DispenseDetail | null>(null);
  const [busy, setBusy] = useState<"allocate" | "post" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Active Tab for Patient Workbench
  const [activeTab, setActiveTab] = useState<"DRUGS" | "PROCEDURE" | "SUPPLIES" | "SUMMARY">("DRUGS");

  // Controlled Substance state (AC-7)
  const [controlled, setControlled] = useState<ControlledDetails>({
    specialRxSerial: "",
    prescriberS2No: "",
    qtyWords: "",
    witnessId: "",
  });
  const [isControlledOpen, setIsControlledOpen] = useState(false);
  const [isLabelOpen, setIsLabelOpen] = useState(false);
  const [isPrintingLabels, setIsPrintingLabels] = useState(false);

  // Procedure & Supply Consumables state
  const [procedureItems, setProcedureItems] = useState<SupplyItemRow[]>([]);
  const [procedureQuery, setProcedureQuery] = useState("");
  const [selectedProcItem, setSelectedProcItem] = useState<SupplyItemRow | null>(null);
  const [procStock, setProcStock] = useState<SupplyStockRow[]>([]);
  const [procBatchId, setProcBatchId] = useState("");
  const [procQty, setProcQty] = useState<number>(1);
  const [procNotes, setProcNotes] = useState("");
  const [procBusy, setProcBusy] = useState(false);
  const [procNotice, setProcNotice] = useState<string | null>(null);
  const [procError, setProcError] = useState<string | null>(null);
  const [issuedHistory, setIssuedHistory] = useState<IssuedItemRecord[]>([]);

  // Print Summary Slip Modal
  const [isSlipOpen, setIsSlipOpen] = useState(false);

  // ── Load the ready-to-dispense queue when no Rx is selected ────────────────
  useEffect(() => {
    if (rxId) return;
    let cancelled = false;
    setQueueLoading(true);
    setQueueError(null);
    Promise.all([pharmacyApi.getQueue("VERIFIED"), pharmacyApi.getQueue("ISSUED")])
      .then(([verified, issued]) => {
        if (cancelled) return;
        const merged = [...(verified || []), ...(issued || [])].filter(
          (row, idx, arr) => arr.findIndex((r) => r.id === row.id) === idx,
        );
        merged.sort((a, b) => String(a.issued_at ?? "").localeCompare(String(b.issued_at ?? "")));
        setQueue(merged);
      })
      .catch((e) => !cancelled && setQueueError(errText(e)))
      .finally(() => !cancelled && setQueueLoading(false));
    return () => {
      cancelled = true;
    };
  }, [rxId]);

  // ── Load the selected prescription + pharmacy locations + stock ────────────
  useEffect(() => {
    if (!rxId) {
      setRx(null);
      setLines([]);
      setDraft(null);
      setPosted(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setPosted(null);
    setDraft(null);
    setNotice(null);
    setActionError(null);
    Promise.all([
      pharmacyApi.getPrescription(rxId),
      pharmacyApi.listLocations(),
      pharmacyApi.getStock(),
      supplyApi.listItems().catch(() => []),
    ])
      .then(([rxData, locs, stockData, supItems]) => {
        if (cancelled) return;
        setRx(rxData);
        setStock(stockData || []);
        setLocations(locs || []);
        const firstLoc = locs?.[0]?.id ?? "";
        setLocationId(firstLoc);
        setLines(buildLines(rxData, stockData || [], firstLoc));
        setControlled((prev) => ({
          ...prev,
          specialRxSerial: "",
          qtyWords: "",
          witnessId: "",
        }));
        if (Array.isArray(supItems)) {
          setProcedureItems(supItems);
        }
      })
      .catch((e) => !cancelled && setLoadError(errText(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [rxId]);

  const onLocationChange = useCallback(
    (nextLoc: string) => {
      setLocationId(nextLoc);
      setLines((prev) =>
        prev.map((l) => {
          const batches = batchesFor(stock, l.itemId, nextLoc);
          return { ...l, batches, batchId: fefoBatchId(batches, l.qty), overrideReason: undefined };
        }),
      );
    },
    [stock],
  );

  const controlledRx = useMemo(
    () => !!rx?.is_controlled || lines.some((l) => l.controlled),
    [rx, lines],
  );

  const selectedLocation = locations.find((l) => l.id === locationId);

  const filteredQueue = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    let rows = queue;
    if (categoryFilter === "CONTROLLED") {
      rows = rows.filter((r) => r.is_controlled);
    } else if (categoryFilter === "NORMAL") {
      rows = rows.filter((r) => !r.is_controlled);
    }
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = `${row.rx_no} ${row.patient_first_name} ${row.patient_last_name} ${row.hrn ?? ""} ${row.prescriber_name ?? ""} ${row.visit_no ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [queue, queueFilter, categoryFilter]);

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // Group queue by Patient (Unified Concept)
  const pharmacyPatientGroups = useMemo((): PatientGroup<PharmacyQueueRow>[] => {
    const map = new Map<string, PatientGroup<PharmacyQueueRow>>();
    for (const row of filteredQueue) {
      if (!row.patient_id) continue;
      const existing = map.get(row.patient_id);
      const fullName = `${row.patient_first_name || ""} ${row.patient_last_name || ""}`.trim() || "Unknown Patient";
      if (!existing) {
        map.set(row.patient_id, {
          patientId: row.patient_id,
          patientName: fullName,
          patientIdDisplay: row.hrn || null,
          pendingCount: 1,
          oldestRequestAt: row.issued_at || null,
          requests: [row],
          meta: {
            visitNo: row.visit_no,
            isControlled: !!row.is_controlled,
            prescriberName: row.prescriber_name,
          },
        });
      } else {
        existing.requests.push(row);
        existing.pendingCount += 1;
        if (row.issued_at && (!existing.oldestRequestAt || row.issued_at < existing.oldestRequestAt)) {
          existing.oldestRequestAt = row.issued_at;
        }
        if (row.is_controlled) {
          existing.meta = { ...existing.meta, isControlled: true };
        }
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.oldestRequestAt ?? "").localeCompare(String(b.oldestRequestAt ?? "")),
    );
  }, [filteredQueue]);

  const buildLineInputs = useCallback(
    (): DispenseItemInput[] =>
      lines
        .filter((l) => l.qty > 0)
        .map((l) => ({
          prescriptionItemId: l.prescriptionItemId,
          itemId: l.itemId,
          batchId: l.batchId || undefined,
          qty: l.qty,
          overrideReason: l.overrideReason,
        })),
    [lines],
  );

  const handleAllocate = useCallback(async () => {
    if (!rx || !selectedLocation) return;
    setActionError(null);
    setNotice(null);
    setBusy("allocate");
    try {
      let current = draft;
      if (!current) {
        current = await pharmacyApi.createDispense({
          branchId: selectedLocation.branch_id,
          patientId: rx.patient_id,
          rxId: rx.id,
          isControlled: controlledRx,
          lines: buildLineInputs(),
        });
        setDraft(current);
      }
      const allocated = await pharmacyApi.allocateFefo(current.id, selectedLocation.id);
      setDraft(allocated);
      setLines((prev) =>
        prev.map((l) => {
          const allocatedLine = allocated.items.find(
            (ai) => ai.prescription_item_id === l.prescriptionItemId,
          );
          return allocatedLine?.batch_id
            ? { ...l, batchId: allocatedLine.batch_id }
            : l;
        }),
      );
      const unresolved = allocated.items.filter((ai) => !ai.batch_id).length;
      setNotice(
        unresolved > 0
          ? `FEFO allocation ran, but ${unresolved} line(s) have insufficient stock in ${selectedLocation.name}.`
          : `FEFO batches allocated from ${selectedLocation.name}. Review and post.`,
      );
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(null);
    }
  }, [rx, selectedLocation, draft, controlledRx, buildLineInputs]);

  const handlePost = useCallback(async () => {
    if (!rx || !selectedLocation) return;
    setActionError(null);
    setNotice(null);

    if (lines.length === 0 || lines.every((l) => l.qty <= 0)) {
      setActionError("Add at least one line with a quantity greater than zero.");
      return;
    }
    if (controlledRx) {
      if (!controlled.specialRxSerial.trim()) {
        setActionError("AC-7: the PDEA Yellow Slip serial number is required for controlled drugs.");
        setIsControlledOpen(true);
        return;
      }
      if (!controlled.qtyWords.trim()) {
        setActionError("AC-7: the quantity in words is required for controlled drugs.");
        setIsControlledOpen(true);
        return;
      }
      if (!UUID_RE.test(controlled.witnessId.trim())) {
        setActionError("AC-7: a valid witness user ID is required for co-signature.");
        setIsControlledOpen(true);
        return;
      }
    }

    setBusy("post");
    try {
      let current = draft;
      if (!current) {
        current = await pharmacyApi.createDispense({
          branchId: selectedLocation.branch_id,
          patientId: rx.patient_id,
          rxId: rx.id,
          isControlled: controlledRx,
          lines: buildLineInputs(),
        });
        setDraft(current);
      }
      const result = await pharmacyApi.postDispense(current.id, {
        locationId: selectedLocation.id,
        counsellingDone: true,
        lines: buildLineInputs(),
        specialRxSerial: controlledRx ? controlled.specialRxSerial.trim() : undefined,
        prescriberS2No: controlledRx ? controlled.prescriberS2No.trim() || undefined : undefined,
        qtyWords: controlledRx ? controlled.qtyWords.trim() : undefined,
        witnessId: controlledRx ? controlled.witnessId.trim() : undefined,
      });
      setPosted(result);
      setDraft(result);
      setNotice(`Dispense ${result.dispense_no} posted. Inventory and charges updated.`);
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(null);
    }
  }, [rx, selectedLocation, lines, controlledRx, controlled, draft, buildLineInputs]);

  const resetForNew = useCallback(() => {
    pharmacyApi.getStock().then(setStock).catch(() => undefined);
    setDraft(null);
    setPosted(null);
    setNotice(null);
    setActionError(null);
    if (rx) setLines(buildLines(rx, stock, locationId));
  }, [rx, stock, locationId]);

  // Procedure / Supply Selection & Stock Loading
  const onSelectProcedureItem = useCallback(
    async (item: SupplyItemRow) => {
      setSelectedProcItem(item);
      setProcQty(1);
      setProcError(null);
      setProcNotice(null);
      try {
        const rows = await supplyApi.getStock({ itemId: item.id });
        setProcStock(rows || []);
        const avail = (rows || []).filter(
          (s) => s.batch_status === "AVAILABLE" && num(s.qty_on_hand) > 0,
        );
        const best = avail[0];
        setProcBatchId(best?.batch_id ?? "");
      } catch {
        setProcStock([]);
      }
    },
    [],
  );

  const handleIssueProcedureItem = useCallback(
    async (type: "PROCEDURE" | "SUPPLY") => {
      if (!selectedProcItem || !rx || !selectedLocation) return;
      if (procQty <= 0) {
        setProcError("Quantity must be greater than zero.");
        return;
      }
      setProcBusy(true);
      setProcError(null);
      setProcNotice(null);
      try {
        await supplyApi.postConsumption({
          locationId: selectedLocation.id,
          itemId: selectedProcItem.id,
          batchId: procBatchId || undefined,
          qty: procQty,
          uomId: selectedProcItem.base_uom_id,
          refType: type === "PROCEDURE" ? "PROCEDURE" : "VISIT",
          refId: rx.visit_id || undefined,
          notes: procNotes.trim() || `Issued for ${rx.patient_first_name} ${rx.patient_last_name} (${rx.visit_no || "Visit"})`,
        });

        const record: IssuedItemRecord = {
          id: `${Date.now()}-${selectedProcItem.id}`,
          name: selectedProcItem.name,
          code: selectedProcItem.code,
          lot: procStock.find((s) => s.batch_id === procBatchId)?.lot_no || "FEFO",
          qty: procQty,
          uom: selectedProcItem.uom_code || "unit",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type,
        };
        setIssuedHistory((prev) => [record, ...prev]);
        setProcNotice(`Successfully issued ${procQty} ${selectedProcItem.uom_code || ""} of ${selectedProcItem.name} to patient.`);
        setProcQty(1);
        setProcNotes("");
        // Reload stock
        void onSelectProcedureItem(selectedProcItem);
      } catch (e) {
        setProcError(errText(e));
      } finally {
        setProcBusy(false);
      }
    },
    [selectedProcItem, rx, selectedLocation, procQty, procBatchId, procNotes, procStock, onSelectProcedureItem],
  );

  // ── Queue picker (no Rx selected) ─────────────────────────────────────────
  if (!rxId) {
    const totalPatients = pharmacyPatientGroups.length;
    const totalRxs = filteredQueue.length;
    const totalControlled = filteredQueue.filter((r) => r.is_controlled).length;
    const totalMedications = filteredQueue.reduce((acc, r) => acc + num(r.item_count), 0);

    const metricsHeader = (
      <div className="row g-3">
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm p-3 h-100" style={{ borderLeft: "4px solid #0284c7" }}>
            <div className="text-muted small fw-semibold text-uppercase">Patients Waiting</div>
            <div className="h3 fw-bold mb-0 text-primary">{totalPatients}</div>
            <div className="small text-muted">Awaiting dispense</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm p-3 h-100" style={{ borderLeft: "4px solid #059669" }}>
            <div className="text-muted small fw-semibold text-uppercase">Prescriptions</div>
            <div className="h3 fw-bold mb-0 text-success">{totalRxs}</div>
            <div className="small text-muted">{totalMedications} total medication lines</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm p-3 h-100" style={{ borderLeft: "4px solid #f59e0b" }}>
            <div className="text-muted small fw-semibold text-uppercase">Controlled Drugs (S2)</div>
            <div className="h3 fw-bold mb-0 text-warning">{totalControlled}</div>
            <div className="small text-muted">Requires yellow slip co-sign</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card border-0 shadow-sm p-3 h-100" style={{ borderLeft: "4px solid #6366f1" }}>
            <div className="text-muted small fw-semibold text-uppercase">Issue Channels</div>
            <div className="h4 fw-bold mb-0 text-dark">Pharma + Procedure</div>
            <div className="small text-muted">FEFO batch integrated</div>
          </div>
        </div>
      </div>
    );

    const headerActions = (
      <div className="d-flex align-items-center gap-2">
        <Link to="/pharmacy/queue">
          <Button variant="outline-secondary" size="sm">
            ← Verification Queue
          </Button>
        </Link>
        <Link to="/supply/issue">
          <Button variant="outline-primary" size="sm">
            📦 Central Supply Issue
          </Button>
        </Link>
      </div>
    );

    return (
      <div className="container-fluid py-4" style={{ maxWidth: 1280 }}>
        {/* Breadcrumb Navigation */}
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-2 text-muted" style={{ fontSize: "0.85rem" }}>
            <li className="breadcrumb-item">
              <Link to="/pharmacy/queue">Pharmacy</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Dispense Workbench
            </li>
          </ol>
        </nav>

        {queueError && <Alert variant="danger">{queueError}</Alert>}

        <PatientGroupedRequestList<PharmacyQueueRow>
          module="PHARMACY"
          title="Patient Dispensing & Issue Workbench"
          subtitle="Unified patient-centric workbench for issuing prescribed pharmaceuticals, clinical procedure items, and supplies."
          groups={pharmacyPatientGroups}
          loading={queueLoading}
          selectedPatientId={selectedPatientId}
          onSelectPatient={setSelectedPatientId}
          headerActions={headerActions}
          metricsHeader={metricsHeader}
          selectButtonLabel="Select Patient & Dispense"
          renderRequests={(group) => (
            <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
              <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
                <h3 className="h6 fw-bold mb-0 text-dark">
                  Medication Prescriptions for {group.patientName}
                </h3>
                <span className="badge bg-primary-subtle text-primary">
                  {group.requests.length} Prescription{group.requests.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
                      <th>Rx Number</th>
                      <th>Attending Prescriber</th>
                      <th>Encounter / Visit</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>Ordered Date</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.requests.map((rxRow) => (
                      <tr key={rxRow.id}>
                        <td>
                          <span className="font-monospace fw-bold text-primary">{rxRow.rx_no}</span>
                          {rxRow.is_controlled && (
                            <span className="badge bg-danger ms-2" style={{ fontSize: "0.68rem" }}>
                              ⚠️ PDEA S2 CONTROLLED
                            </span>
                          )}
                        </td>
                        <td>{rxRow.prescriber_name || "Medical Staff"}</td>
                        <td>
                          {rxRow.visit_no ? (
                            <span className="badge bg-light text-dark border">{rxRow.visit_no}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className="badge bg-secondary-subtle text-secondary">
                            {rxRow.item_count} medication{rxRow.item_count === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td>
                          <StatusPill
                            tone={rxRow.status === "VERIFIED" ? "normal" : "pending"}
                            label={rxRow.status}
                          />
                        </td>
                        <td className="small text-muted">
                          {rxRow.issued_at ? new Date(rxRow.issued_at).toLocaleString() : "—"}
                        </td>
                        <td className="text-end">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => navigate(`/pharmacy/dispenses/${rxRow.id}`)}
                          >
                            Dispense Rx →
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        />
      </div>
    );
  }

  // ── Workbench for the selected patient & prescription ──────────────────────
  const undispensable = rx?.items.filter((it) => !it.item_id) ?? [];

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
      {/* Top Header & Navigation */}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 text-muted" style={{ fontSize: "0.85rem" }}>
              <li className="breadcrumb-item">
                <Link to="/pharmacy/queue">Pharmacy</Link>
              </li>
              <li className="breadcrumb-item">
                <Link to="/pharmacy/dispenses">Dispense Workbench</Link>
              </li>
              <li className="breadcrumb-item active" aria-current="page">
                {rx?.rx_no ?? "…"}
              </li>
            </ol>
          </nav>
          <h1 className="h3 fw-bold mb-0" style={{ color: "var(--brand-primary)" }}>
            Dispense {rx?.rx_no ?? ""}
          </h1>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => setIsSlipOpen(true)}
          >
            📄 Print Patient Issue Slip
          </Button>
          <Link to="/pharmacy/dispenses">
            <Button variant="outline-secondary" size="sm">
              Change prescription
            </Button>
          </Link>
        </div>
      </div>

      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert
          variant={posted ? "success" : "info"}
          dismissible
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}

      {loading ? (
        <SkeletonTable rows={5} />
      ) : rx ? (
        <>
          {/* Patient Banner */}
          <div className="row g-3 mb-4">
            <div className="col-lg-8">
              <PatientBanner
                patient={{
                  id: rx.patient_id,
                  name: `${rx.patient_first_name} ${rx.patient_last_name}`,
                  dateOfBirth: rx.birth_date,
                  sex: rx.patient_sex && SEXES.has(rx.patient_sex.toUpperCase()) ? rx.patient_sex.toUpperCase() : undefined,
                  mrn: rx.hrn,
                }}
                allergiesCount={0}
              />
            </div>
            <div className="col-lg-4">
              <div className="card h-100 shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
                <div className="card-body">
                  <Form.Label htmlFor="dispenseLocation" className="fw-bold">
                    Dispensing Location
                  </Form.Label>
                  <Form.Select
                    id="dispenseLocation"
                    value={locationId}
                    onChange={(e) => onLocationChange(e.target.value)}
                    disabled={!!posted || busy !== null}
                  >
                    {locations.length === 0 && <option value="">No pharmacy locations configured</option>}
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.type})
                      </option>
                    ))}
                  </Form.Select>
                  <div className="small text-muted mt-2">
                    Prescriber: {rx.prescriber_name ?? "—"}
                    {rx.visit_no ? ` · Visit ${rx.visit_no}` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Categorized Tabs: Drugs / Procedures / Supplies / Summary */}
          <div className="mb-4">
            <ul className="nav nav-tabs fw-semibold" style={{ fontSize: "0.95rem" }}>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "DRUGS" ? "active text-primary" : "text-secondary"}`}
                  onClick={() => setActiveTab("DRUGS")}
                >
                  💊 1. Prescribed Medications ({lines.length})
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "PROCEDURE" ? "active text-primary" : "text-secondary"}`}
                  onClick={() => setActiveTab("PROCEDURE")}
                >
                  🩺 2. Procedure Supplies &amp; Clinical Items
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "SUPPLIES" ? "active text-primary" : "text-secondary"}`}
                  onClick={() => setActiveTab("SUPPLIES")}
                >
                  📦 3. General Clinic Consumables
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "SUMMARY" ? "active text-primary" : "text-secondary"}`}
                  onClick={() => setActiveTab("SUMMARY")}
                >
                  🧾 4. Consolidated Patient Dispense Summary
                </button>
              </li>
            </ul>
          </div>

          {/* TAB 1: DRUGS & PHARMACEUTICALS */}
          {activeTab === "DRUGS" && (
            <div>
              {undispensable.length > 0 && (
                <Alert variant="warning">
                  {undispensable.length} prescribed line(s) have no linked pharmacy drug product and
                  cannot be dispensed here:{" "}
                  {undispensable.map((it) => it.generic_name).join(", ")}.
                </Alert>
              )}

              <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)" }}>
                <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
                  <h2 className="h5 mb-0 fw-bold">Prescribed Lines &amp; FEFO Allocation</h2>
                  <span className="text-muted small">Batch suggested by earliest expiry</span>
                </div>
                {lines.length === 0 ? (
                  <EmptyState
                    headline="Nothing left to dispense"
                    explanation="All prescribed quantities have already been dispensed."
                  />
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                          <th>Item</th>
                          <th>Directions</th>
                          <th>Prescribed</th>
                          <th style={{ width: 130 }}>Dispense Qty</th>
                          <th style={{ minWidth: 280 }}>Batch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const sel = line.batches.find((b) => b.batch_id === line.batchId);
                          const short = !sel || num(sel.qty_on_hand) < line.qty;
                          return (
                            <tr key={line.prescriptionItemId}>
                              <td style={{ minWidth: 220 }}>
                                <div className="fw-bold">{line.itemName}</div>
                                <div className="text-muted small">{line.genericName}</div>
                                {line.controlled && (
                                  <Badge bg="danger" className="mt-1" style={{ fontSize: "0.66rem" }}>
                                    CONTROLLED
                                  </Badge>
                                )}
                              </td>
                              <td className="small text-secondary" style={{ maxWidth: 220 }}>
                                {line.sig}
                              </td>
                              <td className="fw-semibold">{line.prescribedQty}</td>
                              <td>
                                <Form.Control
                                  type="number"
                                  min={0}
                                  max={line.prescribedQty}
                                  value={line.qty}
                                  disabled={!!posted}
                                  onChange={(e) =>
                                    setLines((prev) =>
                                      prev.map((l) =>
                                        l.prescriptionItemId === line.prescriptionItemId
                                          ? { ...l, qty: Number(e.target.value) }
                                          : l,
                                      ),
                                    )
                                  }
                                />
                              </td>
                              <td>
                                {line.batches.length === 0 ? (
                                  <span className="text-danger small fw-semibold">
                                    No available stock at this location
                                  </span>
                                ) : (
                                  <>
                                    <Form.Select
                                      size="sm"
                                      value={line.batchId}
                                      disabled={!!posted}
                                      onChange={(e) => {
                                        const batchId = e.target.value;
                                        const isFefo = batchId === fefoBatchId(line.batches, line.qty);
                                        setLines((prev) =>
                                          prev.map((l) =>
                                            l.prescriptionItemId === line.prescriptionItemId
                                              ? {
                                                  ...l,
                                                  batchId,
                                                  overrideReason: isFefo
                                                    ? undefined
                                                    : "Non-FEFO batch selected by operator",
                                                }
                                              : l,
                                          ),
                                        );
                                      }}
                                    >
                                      {line.batches.map((b) => (
                                        <option key={b.batch_id} value={b.batch_id}>
                                          Lot {b.batch_no} · Exp {String(b.expiry_date).slice(0, 10)} (Avail{" "}
                                          {num(b.qty_on_hand)})
                                        </option>
                                      ))}
                                    </Form.Select>
                                    {short ? (
                                      <span className="text-danger small fw-semibold">
                                        Insufficient quantity in selected batch
                                      </span>
                                    ) : (
                                      <span className="badge bg-success-subtle text-success border border-success-subtle mt-1">
                                        ✓ FEFO earliest expiry
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="card-footer bg-light p-3 d-flex flex-wrap justify-content-between align-items-center gap-3">
                  <div className="small text-muted">
                    Line charges are computed and posted by the server from item price rules.
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {posted ? (
                      <>
                        <Button variant="outline-primary" onClick={() => setIsLabelOpen(true)}>
                          Print Rx Labels
                        </Button>
                        <Button variant="outline-secondary" onClick={resetForNew}>
                          New dispense
                        </Button>
                        <Badge bg="success" className="p-2">
                          POSTED · {posted.dispense_no}
                        </Badge>
                      </>
                    ) : (
                      <>
                        {controlledRx && (
                          <Button variant="outline-danger" onClick={() => setIsControlledOpen(true)}>
                            AC-7 Requirements
                          </Button>
                        )}
                        <Button
                          variant="outline-primary"
                          onClick={handleAllocate}
                          disabled={busy !== null || !selectedLocation || lines.length === 0}
                        >
                          {busy === "allocate" ? "Allocating…" : "Allocate FEFO"}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={handlePost}
                          disabled={busy !== null || !selectedLocation || lines.length === 0}
                        >
                          {busy === "post" ? "Posting…" : "Post Dispense"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {controlledRx && (
                <Alert variant="danger">
                  <strong>AC-7:</strong> {rx.is_controlled ? "This prescription is flagged controlled." : "One or more lines are controlled drugs."}{" "}
                  Complete the Yellow Slip, quantity-in-words, and witness co-signature before posting.
                </Alert>
              )}
            </div>
          )}

          {/* TAB 2 & 3: PROCEDURE SUPPLIES & GENERAL CONSUMABLES */}
          {(activeTab === "PROCEDURE" || activeTab === "SUPPLIES") && (
            <div className="row g-4 mb-4">
              {/* Left Column: Item Selection */}
              <div className="col-lg-6">
                <div className="card shadow-sm border-0 h-100" style={{ background: "var(--surface-raised)" }}>
                  <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
                    <h2 className="h6 mb-0 fw-bold">
                      {activeTab === "PROCEDURE" ? "Select Clinical Procedure Supply" : "Select Clinic Consumable"}
                    </h2>
                    <span className="badge bg-primary-subtle text-primary">
                      {activeTab === "PROCEDURE" ? "Procedure Channel" : "General Supply"}
                    </span>
                  </div>
                  <div className="card-body p-3">
                    <Form.Control
                      type="search"
                      placeholder="Search supplies, kits, sterile items, PPE…"
                      value={procedureQuery}
                      onChange={(e) => setProcedureQuery(e.target.value)}
                      className="mb-3"
                    />

                    {/* Quick Picks for Procedure Items */}
                    {activeTab === "PROCEDURE" && (
                      <div className="mb-3">
                        <div className="small fw-bold text-muted text-uppercase mb-2">Common Procedure Materials</div>
                        <div className="d-flex flex-wrap gap-2">
                          {[
                            "Suture Kit",
                            "Sterile Gauze",
                            "IV Cannula",
                            "Syringe 5ml",
                            "Antiseptic",
                            "Dressing Pack",
                          ].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => {
                                setProcedureQuery(tag);
                                const found = procedureItems.find((it) =>
                                  it.name.toLowerCase().includes(tag.toLowerCase()),
                                );
                                if (found) void onSelectProcedureItem(found);
                              }}
                            >
                              + {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Items List */}
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      {procedureItems
                        .filter((it) =>
                          procedureQuery.trim()
                            ? it.name.toLowerCase().includes(procedureQuery.toLowerCase()) ||
                              it.code.toLowerCase().includes(procedureQuery.toLowerCase())
                            : true,
                        )
                        .slice(0, 15)
                        .map((item) => (
                          <div
                            key={item.id}
                            className={`p-2 mb-2 rounded border cursor-pointer d-flex justify-content-between align-items-center transition-all ${
                              selectedProcItem?.id === item.id
                                ? "border-primary bg-primary-subtle text-primary fw-semibold"
                                : "bg-white hover-bg-light"
                            }`}
                            onClick={() => void onSelectProcedureItem(item)}
                            role="button"
                            tabIndex={0}
                          >
                            <div>
                              <div>{item.name}</div>
                              <div className="small text-muted font-monospace">{item.code} · {item.uom_code || "unit"}</div>
                            </div>
                            <Button size="sm" variant={selectedProcItem?.id === item.id ? "primary" : "outline-secondary"}>
                              {selectedProcItem?.id === item.id ? "Selected" : "Select"}
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Issue Details & Stock Allocation */}
              <div className="col-lg-6">
                <div className="card shadow-sm border-0 h-100" style={{ background: "var(--surface-raised)" }}>
                  <div className="card-header bg-white py-3 border-bottom">
                    <h2 className="h6 mb-0 fw-bold">Issue Stock to Patient</h2>
                  </div>
                  <div className="card-body p-3">
                    {procNotice && (
                      <Alert variant="success" dismissible onClose={() => setProcNotice(null)}>
                        {procNotice}
                      </Alert>
                    )}
                    {procError && (
                      <Alert variant="danger" dismissible onClose={() => setProcError(null)}>
                        {procError}
                      </Alert>
                    )}

                    {!selectedProcItem ? (
                      <div className="text-center py-5 text-muted">
                        <div style={{ fontSize: "2rem" }}>📦</div>
                        <div className="fw-semibold mt-2">Select an item from the list on the left to issue</div>
                      </div>
                    ) : (
                      <div>
                        <div className="alert alert-light border mb-3">
                          <div className="fw-bold h6 mb-1 text-primary">{selectedProcItem.name}</div>
                          <div className="small text-muted">
                            Code: <strong>{selectedProcItem.code}</strong> · UOM: <strong>{selectedProcItem.uom_code || "unit"}</strong>
                          </div>
                        </div>

                        <div className="row g-3 mb-3">
                          <div className="col-sm-6">
                            <Form.Label className="small fw-bold">Stock Batch (FEFO)</Form.Label>
                            <Form.Select
                              value={procBatchId}
                              onChange={(e) => setProcBatchId(e.target.value)}
                            >
                              {procStock.length === 0 ? (
                                <option value="">No stock batches available</option>
                              ) : (
                                procStock.map((b) => (
                                  <option key={b.batch_id} value={b.batch_id}>
                                    Lot {b.lot_no} · Exp {String(b.expiry_date).slice(0, 10)} (Qty {b.qty_on_hand})
                                  </option>
                                ))
                              )}
                            </Form.Select>
                          </div>
                          <div className="col-sm-6">
                            <Form.Label className="small fw-bold">Quantity to Issue</Form.Label>
                            <Form.Control
                              type="number"
                              min={1}
                              value={procQty}
                              onChange={(e) => setProcQty(Math.max(1, Number(e.target.value)))}
                            />
                          </div>
                        </div>

                        <div className="mb-3">
                          <Form.Label className="small fw-bold">Procedure / Clinical Notes</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={2}
                            placeholder="e.g. Wound debridement dressing, IV hydration setup…"
                            value={procNotes}
                            onChange={(e) => setProcNotes(e.target.value)}
                          />
                        </div>

                        <Button
                          variant="primary"
                          className="w-100 py-2 fw-semibold"
                          disabled={procBusy || !procBatchId || procQty <= 0}
                          onClick={() => handleIssueProcedureItem(activeTab === "PROCEDURE" ? "PROCEDURE" : "SUPPLY")}
                        >
                          {procBusy ? "Recording Issue…" : `Issue ${procQty} ${selectedProcItem.uom_code || "units"} to Patient`}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Encounter Issue History */}
              <div className="col-12">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
                    <h3 className="h6 mb-0 fw-bold">Items Issued to Patient in this Encounter</h3>
                    <span className="badge bg-secondary">{issuedHistory.length} Recorded</span>
                  </div>
                  {issuedHistory.length === 0 ? (
                    <div className="p-4 text-center text-muted small">
                      No additional supplies issued yet for this encounter.
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                          <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                            <th>Item Name</th>
                            <th>Code</th>
                            <th>Lot No.</th>
                            <th>Qty</th>
                            <th>Channel</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issuedHistory.map((item) => (
                            <tr key={item.id}>
                              <td className="fw-semibold">{item.name}</td>
                              <td className="font-monospace small text-muted">{item.code || "—"}</td>
                              <td className="font-monospace small">{item.lot}</td>
                              <td className="fw-bold">{item.qty} {item.uom}</td>
                              <td>
                                <Badge bg={item.type === "PROCEDURE" ? "primary" : "info"}>
                                  {item.type}
                                </Badge>
                              </td>
                              <td className="small text-muted">{item.time}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONSOLIDATED SUMMARY */}
          {activeTab === "SUMMARY" && (
            <div className="card shadow-sm border-0 mb-4" style={{ background: "var(--surface-raised)" }}>
              <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
                <h2 className="h5 mb-0 fw-bold">Consolidated Patient Dispensing Bill of Materials</h2>
                <Button variant="outline-primary" size="sm" onClick={() => setIsSlipOpen(true)}>
                  📄 Print Official Issue Slip
                </Button>
              </div>
              <div className="card-body p-4">
                <div className="row g-3 mb-4">
                  <div className="col-md-6">
                    <div className="p-3 border rounded bg-white">
                      <div className="text-muted small fw-semibold text-uppercase">Patient Details</div>
                      <div className="h5 fw-bold mb-1">{rx.patient_first_name} {rx.patient_last_name}</div>
                      <div className="small text-muted">
                        HRN: <strong>{rx.hrn || "N/A"}</strong> · Visit: <strong>{rx.visit_no || "N/A"}</strong> · Physician: <strong>{rx.prescriber_name || "N/A"}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="p-3 border rounded bg-white">
                      <div className="text-muted small fw-semibold text-uppercase">Dispensing Status</div>
                      <div className="h5 fw-bold mb-1 text-primary">
                        {posted ? `Posted (${posted.dispense_no})` : "Draft / In Progress"}
                      </div>
                      <div className="small text-muted">
                        Medications: <strong>{lines.length} lines</strong> · Supplies Issued: <strong>{issuedHistory.length} lines</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="h6 fw-bold text-uppercase text-secondary mb-2">1. Prescribed Pharmaceuticals</h3>
                <div className="table-responsive mb-4">
                  <table className="table table-bordered align-middle">
                    <thead className="table-light">
                      <tr>
                        <th>Medication</th>
                        <th>Sig / Directions</th>
                        <th>Qty Prescribed</th>
                        <th>Qty Dispensed</th>
                        <th>Batch / Lot</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.prescriptionItemId}>
                          <td className="fw-semibold">{l.itemName}</td>
                          <td className="small text-muted">{l.sig}</td>
                          <td>{l.prescribedQty}</td>
                          <td className="fw-bold">{l.qty}</td>
                          <td className="font-monospace small">
                            {l.batches.find((b) => b.batch_id === l.batchId)?.batch_no || "Auto-FEFO"}
                          </td>
                          <td>
                            <Badge bg={posted ? "success" : "warning"}>
                              {posted ? "DISPENSED" : "PENDING POST"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="h6 fw-bold text-uppercase text-secondary mb-2">2. Clinical Procedure &amp; Clinic Supplies Issued</h3>
                {issuedHistory.length === 0 ? (
                  <div className="p-3 border rounded bg-light text-muted small mb-4">
                    No procedure supplies issued yet. Switch to Tab 2 to add procedure items.
                  </div>
                ) : (
                  <div className="table-responsive mb-4">
                    <table className="table table-bordered align-middle">
                      <thead className="table-light">
                        <tr>
                          <th>Item</th>
                          <th>Code</th>
                          <th>Lot</th>
                          <th>Quantity</th>
                          <th>Purpose</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issuedHistory.map((it) => (
                          <tr key={it.id}>
                            <td className="fw-semibold">{it.name}</td>
                            <td className="font-monospace small text-muted">{it.code || "—"}</td>
                            <td className="font-monospace small">{it.lot}</td>
                            <td className="fw-bold">{it.qty} {it.uom}</td>
                            <td><Badge bg="info">{it.type}</Badge></td>
                            <td className="small text-muted">{it.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* AC-7 Controlled Dispense Modal */}
      <Modal show={isControlledOpen} onHide={() => setIsControlledOpen(false)} centered size="lg">
        <Modal.Header closeButton className="bg-danger text-white">
          <Modal.Title className="h5 fw-bold">AC-7 Dangerous Drug Dispense Protocol</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="specialRxSerial">
            <Form.Label className="fw-bold">PDEA Special Rx Yellow Slip Serial No.</Form.Label>
            <Form.Control
              placeholder="e.g. YS-2026-00412"
              value={controlled.specialRxSerial}
              onChange={(e) => setControlled((p) => ({ ...p, specialRxSerial: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="prescriberS2No">
            <Form.Label className="fw-bold">Prescriber S2 License No.</Form.Label>
            <Form.Control
              placeholder="e.g. S2-998877"
              value={controlled.prescriberS2No}
              onChange={(e) => setControlled((p) => ({ ...p, prescriberS2No: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="qtyWords">
            <Form.Label className="fw-bold">Quantity in Words</Form.Label>
            <Form.Control
              placeholder="e.g. Six (6) ampoules only"
              value={controlled.qtyWords}
              onChange={(e) => setControlled((p) => ({ ...p, qtyWords: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="witnessId">
            <Form.Label className="fw-bold">Witness User ID (co-signer)</Form.Label>
            <Form.Control
              placeholder="UUID of the second authorized user"
              value={controlled.witnessId}
              onChange={(e) => setControlled((p) => ({ ...p, witnessId: e.target.value }))}
            />
            <Form.Text className="text-muted">
              A distinct authorized user must witness and co-sign the transaction.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsControlledOpen(false)}>
            Close
          </Button>
          <Button
            variant="danger"
            disabled={
              !controlled.specialRxSerial.trim() ||
              !controlled.qtyWords.trim() ||
              !UUID_RE.test(controlled.witnessId.trim())
            }
            onClick={() => setIsControlledOpen(false)}
          >
            Attest AC-7 Record
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Rx Label Preview Modal */}
      <Modal show={isLabelOpen} onHide={() => setIsLabelOpen(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="h6 fw-bold">Rx Label Preview</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4 bg-light">
          {(posted?.items ?? []).map((item) => (
            <div
              key={item.id}
              className="bg-white p-3 border rounded shadow-sm mb-3 font-monospace"
              style={{ fontSize: "0.85rem", borderLeft: "4px solid var(--brand-primary)" }}
            >
              <div className="fw-bold text-uppercase">{item.item_name}</div>
              <div className="mt-2">
                Qty Dispensed: {num(item.qty)} {item.uom_code}
              </div>
              {item.batch_no && (
                <div className="small text-muted">
                  Lot {item.batch_no} · Exp {String(item.expiry_date ?? "").slice(0, 10)}
                </div>
              )}
            </div>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsLabelOpen(false)}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={isPrintingLabels}
            onClick={async () => {
              if (posted?.id) {
                setIsPrintingLabels(true);
                try {
                  await printBlob(`/pharmacy/dispenses/${posted.id}/label-pdf`);
                  setIsPrintingLabels(false);
                  return;
                } catch {
                  setIsPrintingLabels(false);
                }
              }
              window.print();
            }}
          >
            {isPrintingLabels ? "Preparing label PDF…" : "🖨️ Print Label Sheet (PDF)"}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Printable Patient Dispensing Slip Modal */}
      <Modal show={isSlipOpen} onHide={() => setIsSlipOpen(false)} centered size="lg">
        <Modal.Header closeButton className="bg-light">
          <Modal.Title className="h6 fw-bold">Official Patient Dispensing Slip</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4" id="printable-dispense-slip">
          <div className="border p-4 bg-white rounded shadow-sm font-monospace" style={{ fontSize: "0.9rem" }}>
            <div className="text-center pb-3 border-bottom mb-3">
              <div className="fw-bold h5 mb-0">CLINIC HEALTHCARE SYSTEM</div>
              <div className="small text-muted">Pharmacy &amp; Supply Dispensing Service</div>
              <div className="fw-bold mt-1 text-primary">PATIENT DISPENSE &amp; ISSUE SLIP</div>
            </div>

            <div className="row g-2 mb-3 small">
              <div className="col-6">
                <div>Patient: <strong>{rx?.patient_first_name} {rx?.patient_last_name}</strong></div>
                <div>HRN: <strong>{rx?.hrn || "N/A"}</strong></div>
              </div>
              <div className="col-6 text-end">
                <div>Rx Ref: <strong>{rx?.rx_no || "N/A"}</strong></div>
                <div>Date: <strong>{new Date().toLocaleDateString()}</strong></div>
              </div>
            </div>

            <div className="fw-bold small text-uppercase border-bottom pb-1 mb-2">Prescribed Items Dispensed</div>
            <table className="table table-sm table-borderless small mb-3">
              <thead>
                <tr className="border-bottom">
                  <th>Item</th>
                  <th>Sig</th>
                  <th className="text-end">Qty</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.prescriptionItemId}>
                    <td>{l.itemName}</td>
                    <td className="text-muted">{l.sig}</td>
                    <td className="text-end fw-bold">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {issuedHistory.length > 0 && (
              <>
                <div className="fw-bold small text-uppercase border-bottom pb-1 mb-2">Procedure &amp; Consumables Issued</div>
                <table className="table table-sm table-borderless small mb-3">
                  <thead>
                    <tr className="border-bottom">
                      <th>Item</th>
                      <th>Lot</th>
                      <th className="text-end">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issuedHistory.map((it) => (
                      <tr key={it.id}>
                        <td>{it.name}</td>
                        <td className="text-muted">{it.lot}</td>
                        <td className="text-end fw-bold">{it.qty} {it.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="pt-3 border-top d-flex justify-content-between text-muted small">
              <div>Dispensed by: <strong>Licensed Pharmacist / Supply Custodian</strong></div>
              <div>Attending: <strong>{rx?.prescriber_name || "Doctor"}</strong></div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsSlipOpen(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            🖨️ Print Slip
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
