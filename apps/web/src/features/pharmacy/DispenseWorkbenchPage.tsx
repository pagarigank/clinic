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
import { ApiError } from "../../shared/api/client.js";
import { pharmacyApi } from "./api.js";
import type {
  DispenseDetail,
  PharmacyQueueRow,
  PharmacyStockRow,
  PrescriptionDetail,
  StockLocation,
} from "./api.js";
import type { DispenseItemInput } from "@clinic/contracts";

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

  const [queue, setQueue] = useState<PharmacyQueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState("");

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

  const [controlled, setControlled] = useState<ControlledDetails>({
    specialRxSerial: "",
    prescriberS2No: "",
    qtyWords: "",
    witnessId: "",
  });
  const [isControlledOpen, setIsControlledOpen] = useState(false);
  const [isLabelOpen, setIsLabelOpen] = useState(false);

  // ── Load the ready-to-dispense queue when no Rx is selected ────────────────
  useEffect(() => {
    if (rxId) return;
    let cancelled = false;
    setQueueLoading(true);
    setQueueError(null);
    Promise.all([pharmacyApi.getQueue("VERIFIED"), pharmacyApi.getQueue("ISSUED")])
      .then(([verified, issued]) => {
        if (cancelled) return;
        const merged = [...verified, ...issued].filter(
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
    Promise.all([pharmacyApi.getPrescription(rxId), pharmacyApi.listLocations(), pharmacyApi.getStock()])
      .then(([rxData, locs, stockData]) => {
        if (cancelled) return;
        setRx(rxData);
        setStock(stockData);
        setLocations(locs);
        const firstLoc = locs[0]?.id ?? "";
        setLocationId(firstLoc);
        setLines(buildLines(rxData, stockData, firstLoc));
        setControlled((prev) => ({
          ...prev,
          specialRxSerial: "",
          qtyWords: "",
          witnessId: "",
        }));
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
    if (!q) return queue;
    return queue.filter((row) => {
      const hay = `${row.rx_no} ${row.patient_first_name} ${row.patient_last_name} ${row.hrn ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [queue, queueFilter]);

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

  // ── Queue picker (no Rx selected) ─────────────────────────────────────────
  if (!rxId) {
    return (
      <div className="container-fluid py-4" style={{ maxWidth: 1200 }}>
        <h1 className="h3 fw-bold mb-1" style={{ color: "var(--brand-primary)" }}>
          Pharmacy Dispense Workbench
        </h1>
        <p className="text-secondary">
          Select a verified prescription to begin FEFO batch allocation.
        </p>

        {queueError && <Alert variant="danger">{queueError}</Alert>}

        <div className="card shadow-sm border-0" style={{ background: "var(--surface-raised)" }}>
          <div className="card-body p-3">
            <Form.Control
              type="search"
              placeholder="Search by Rx number, patient, or HRN…"
              value={queueFilter}
              onChange={(e) => setQueueFilter(e.target.value)}
              aria-label="Search prescriptions"
            />
          </div>
          {queueLoading ? (
            <SkeletonTable rows={4} />
          ) : filteredQueue.length === 0 ? (
            <EmptyState
              headline="No prescriptions awaiting dispensing"
              explanation="Verified and issued prescriptions will appear here."
            />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr style={{ fontSize: "0.78rem", textTransform: "uppercase" }}>
                    <th>Rx No.</th>
                    <th>Patient</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.map((row) => (
                    <tr key={row.id}>
                      <td className="font-monospace fw-bold text-primary">
                        {row.rx_no}
                        {row.is_controlled && (
                          <div>
                            <Badge bg="danger" style={{ fontSize: "0.66rem" }}>
                              CONTROLLED
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="fw-semibold">
                          {row.patient_first_name} {row.patient_last_name}
                        </div>
                        <div className="text-muted small font-monospace">{row.hrn}</div>
                      </td>
                      <td>{row.item_count}</td>
                      <td>
                        <StatusPill
                          tone={row.status === "VERIFIED" ? "normal" : "pending"}
                          label={row.status}
                        />
                      </td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => navigate(`/pharmacy/dispenses/${row.id}`)}
                        >
                          Dispense
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mt-3">
          <Link to="/pharmacy/queue">
            <Button variant="outline-secondary" size="sm">
              ← Verification Queue
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Workbench for the selected prescription ────────────────────────────────
  const undispensable = rx?.items.filter((it) => !it.item_id) ?? [];

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 1440 }}>
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
        <Link to="/pharmacy/dispenses">
          <Button variant="outline-secondary" size="sm">
            Change prescription
          </Button>
        </Link>
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
              value={controlled.specialRxSerial}
              onChange={(e) => setControlled((p) => ({ ...p, specialRxSerial: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="prescriberS2No">
            <Form.Label className="fw-bold">Prescriber S2 License Number</Form.Label>
            <Form.Control
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

      {/* Rx Label Preview */}
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
          <Button variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
