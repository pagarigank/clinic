import React, { useCallback, useEffect, useState } from "react";
import { AlertBanner, Button, Modal, Form } from "@clinic/ui";
import { labApi, type LabAnalyte, type LabReferenceRange, type LabTest } from "./api.js";

/**
 * Analyte + reference-range editor for a laboratory test (specification §4,
 * lab configuration). Each test owns ordered analytes; each analyte owns
 * sex/age-banded reference ranges with normal and critical thresholds. Created
 * from the Lab Catalog. No money or stock is computed here.
 */

interface LaboratoryAnalytesModalProps {
  show: boolean;
  test: LabTest | null;
  canCreate: boolean;
  canUpdate: boolean;
  onClose: () => void;
}

type Sex = "ALL" | "MALE" | "FEMALE";

function rangeSummary(r: LabReferenceRange): string {
  const normal =
    r.normal_min != null || r.normal_max != null
      ? `${r.normal_min ?? "—"} – ${r.normal_max ?? "—"}`
      : r.text_range || "—";
  return normal;
}

export function LaboratoryAnalytesModal({
  show,
  test,
  canCreate,
  canUpdate,
  onClose,
}: LaboratoryAnalytesModalProps) {
  const [analytes, setAnalytes] = useState<LabAnalyte[]>([]);
  const [analytesLoading, setAnalytesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [selected, setSelected] = useState<LabAnalyte | null>(null);
  const [ranges, setRanges] = useState<LabReferenceRange[]>([]);
  const [rangesLoading, setRangesLoading] = useState(false);

  // Add-analyte form
  const [analyteCode, setAnalyteCode] = useState("");
  const [analyteName, setAnalyteName] = useState("");
  const [analyteUnit, setAnalyteUnit] = useState("");
  const [analytePrecision, setAnalytePrecision] = useState("2");
  const [analyteSort, setAnalyteSort] = useState("0");
  const [analyteBusy, setAnalyteBusy] = useState(false);

  // Add-reference-range form
  const [rangeSex, setRangeSex] = useState<Sex>("ALL");
  const [rangeAgeMin, setRangeAgeMin] = useState("0");
  const [rangeAgeMax, setRangeAgeMax] = useState("36500");
  const [rangeNormalMin, setRangeNormalMin] = useState("");
  const [rangeNormalMax, setRangeNormalMax] = useState("");
  const [rangeCriticalLow, setRangeCriticalLow] = useState("");
  const [rangeCriticalHigh, setRangeCriticalHigh] = useState("");
  const [rangeText, setRangeText] = useState("");
  const [rangeBusy, setRangeBusy] = useState(false);

  const loadAnalytes = useCallback(async () => {
    if (!test) return;
    setAnalytesLoading(true);
    try {
      const list = await labApi.listAnalytes(test.id);
      setAnalytes(Array.isArray(list) ? list : []);
    } catch {
      setAnalytes([]);
      setError("Unable to load analytes for this test.");
    } finally {
      setAnalytesLoading(false);
    }
  }, [test]);

  useEffect(() => {
    if (show && test) void loadAnalytes();
  }, [show, test, loadAnalytes]);

  useEffect(() => {
    if (!show) return;
    setSelected(null);
    setRanges([]);
    setError(null);
    setInfo(null);
    setAnalyteCode("");
    setAnalyteName("");
    setAnalyteUnit("");
    setAnalytePrecision("2");
    setAnalyteSort("0");
    setRangeSex("ALL");
    setRangeAgeMin("0");
    setRangeAgeMax("36500");
    setRangeNormalMin("");
    setRangeNormalMax("");
    setRangeCriticalLow("");
    setRangeCriticalHigh("");
    setRangeText("");
  }, [show]);

  const loadRanges = useCallback(async (analyte: LabAnalyte) => {
    setSelected(analyte);
    setRangesLoading(true);
    try {
      const list = await labApi.listReferenceRanges(analyte.id);
      setRanges(Array.isArray(list) ? list : []);
    } catch {
      setRanges([]);
    } finally {
      setRangesLoading(false);
    }
  }, []);

  const toNum = (v: string): number | undefined => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleAddAnalyte = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!test) return;
    if (!analyteCode.trim() || !analyteName.trim() || !analyteUnit.trim()) {
      setError("Analyte code, name, and unit are required.");
      return;
    }
    setAnalyteBusy(true);
    setError(null);
    try {
      await labApi.createAnalyte(test.id, {
        testId: test.id,
        code: analyteCode.trim(),
        name: analyteName.trim(),
        defaultUnit: analyteUnit.trim(),
        precisionDigits: Number(analytePrecision) || 0,
        sortOrder: Number(analyteSort) || 0,
        isActive: true,
        isCalculated: false,
      });
      setInfo(`Analyte ${analyteCode.trim()} added.`);
      setAnalyteCode("");
      setAnalyteName("");
      setAnalyteUnit("");
      setAnalytePrecision("2");
      setAnalyteSort("0");
      await loadAnalytes();
    } catch (err: unknown) {
      const problem = (err as { problem?: { detail?: string } })?.problem;
      setError(problem?.detail || "Could not add analyte.");
    } finally {
      setAnalyteBusy(false);
    }
  };

  const handleAddRange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setRangeBusy(true);
    setError(null);
    try {
      await labApi.createReferenceRange(selected.id, {
        analyteId: selected.id,
        sex: rangeSex,
        ageMinDays: Number(rangeAgeMin) || 0,
        ageMaxDays: Number(rangeAgeMax) || 36500,
        normalMin: toNum(rangeNormalMin),
        normalMax: toNum(rangeNormalMax),
        criticalLow: toNum(rangeCriticalLow),
        criticalHigh: toNum(rangeCriticalHigh),
        textRange: rangeText.trim() || undefined,
      });
      setInfo(`Reference range added for ${selected.name}.`);
      setRangeNormalMin("");
      setRangeNormalMax("");
      setRangeCriticalLow("");
      setRangeCriticalHigh("");
      setRangeText("");
      await loadRanges(selected);
    } catch (err: unknown) {
      const problem = (err as { problem?: { detail?: string } })?.problem;
      setError(problem?.detail || "Could not add reference range.");
    } finally {
      setRangeBusy(false);
    }
  };

  const handleDeleteAnalyte = async (analyte: LabAnalyte) => {
    setError(null);
    try {
      await labApi.deleteAnalyte(analyte.id);
      if (selected?.id === analyte.id) {
        setSelected(null);
        setRanges([]);
      }
      setInfo(`Analyte ${analyte.code} removed.`);
      await loadAnalytes();
    } catch (err: unknown) {
      const problem = (err as { problem?: { detail?: string } })?.problem;
      setError(problem?.detail || "Could not remove analyte.");
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered size="lg" aria-labelledby="lab-analytes-title">
      <Modal.Header closeButton>
        <Modal.Title id="lab-analytes-title">
          Analytes &amp; Reference Ranges — {test?.code}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <div className="mb-3">
            <AlertBanner severity="danger">{error}</AlertBanner>
          </div>
        )}
        {info && (
          <div className="mb-3">
            <AlertBanner severity="success">{info}</AlertBanner>
          </div>
        )}

        <div className="row g-3">
          <div className="col-md-5">
            <h6 className="fw-bold text-secondary text-uppercase small">Analytes</h6>
            {analytesLoading ? (
              <div className="text-muted small py-3" role="status">
                Loading analytes…
              </div>
            ) : analytes.length === 0 ? (
              <div className="text-muted small py-3">No analytes configured for this test yet.</div>
            ) : (
              <ul className="list-group" aria-label="Test analytes">
                {analytes.map((a) => (
                  <li
                    key={a.id}
                    className={`list-group-item d-flex justify-content-between align-items-center ${
                      selected?.id === a.id ? "active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="btn btn-link p-0 text-start text-decoration-none flex-grow-1"
                      style={selected?.id === a.id ? { color: "inherit" } : undefined}
                      onClick={() => void loadRanges(a)}
                      aria-label={`Manage ranges for ${a.name}`}
                    >
                      <span className="fw-semibold">{a.name}</span>
                      <span className="small d-block opacity-75">
                        {a.code} · {a.default_unit}
                      </span>
                    </button>
                    {canUpdate && (
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => void handleDeleteAnalyte(a)}
                        aria-label={`Remove analyte ${a.name}`}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canCreate && (
              <form className="mt-3 border-top pt-3" onSubmit={handleAddAnalyte}>
                <h6 className="fw-bold text-secondary text-uppercase small">Add analyte</h6>
                <Form.Group controlId="new-analyte-code" className="mb-2">
                  <Form.Label className="small mb-1">Code *</Form.Label>
                  <Form.Control
                    size="sm"
                    value={analyteCode}
                    onChange={(e) => setAnalyteCode(e.target.value)}
                    placeholder="e.g. HGB"
                  />
                </Form.Group>
                <Form.Group controlId="new-analyte-name" className="mb-2">
                  <Form.Label className="small mb-1">Name *</Form.Label>
                  <Form.Control
                    size="sm"
                    value={analyteName}
                    onChange={(e) => setAnalyteName(e.target.value)}
                    placeholder="e.g. Hemoglobin"
                  />
                </Form.Group>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <Form.Group controlId="new-analyte-unit">
                      <Form.Label className="small mb-1">Unit *</Form.Label>
                      <Form.Control
                        size="sm"
                        value={analyteUnit}
                        onChange={(e) => setAnalyteUnit(e.target.value)}
                        placeholder="g/dL"
                      />
                    </Form.Group>
                  </div>
                  <div className="col-3">
                    <Form.Group controlId="new-analyte-precision">
                      <Form.Label className="small mb-1">Decimals</Form.Label>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        max={6}
                        value={analytePrecision}
                        onChange={(e) => setAnalytePrecision(e.target.value)}
                      />
                    </Form.Group>
                  </div>
                  <div className="col-3">
                    <Form.Group controlId="new-analyte-sort">
                      <Form.Label className="small mb-1">Order</Form.Label>
                      <Form.Control
                        size="sm"
                        type="number"
                        value={analyteSort}
                        onChange={(e) => setAnalyteSort(e.target.value)}
                      />
                    </Form.Group>
                  </div>
                </div>
                <Button type="submit" variant="cerulean" size="sm" disabled={analyteBusy}>
                  {analyteBusy ? "Adding…" : "Add analyte"}
                </Button>
              </form>
            )}
          </div>

          <div className="col-md-7">
            <h6 className="fw-bold text-secondary text-uppercase small">Reference ranges</h6>
            {!selected ? (
              <div className="text-muted small py-3">Select an analyte to view and add reference ranges.</div>
            ) : (
              <>
                <div className="mb-2 small text-dark">
                  <span className="fw-semibold">{selected.name}</span> ({selected.code})
                </div>
                {rangesLoading ? (
                  <div className="text-muted small py-2" role="status">
                    Loading ranges…
                  </div>
                ) : ranges.length === 0 ? (
                  <div className="text-muted small py-2">No reference ranges yet.</div>
                ) : (
                  <div className="table-responsive mb-3">
                    <table className="table table-sm align-middle">
                      <caption className="visually-hidden">Reference ranges for {selected.name}</caption>
                      <thead className="table-light small text-secondary">
                        <tr>
                          <th>SEX</th>
                          <th>AGE (days)</th>
                          <th>NORMAL</th>
                          <th>CRITICAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranges.map((r) => (
                          <tr key={r.id}>
                            <td>{r.sex}</td>
                            <td className="small">
                              {r.age_min_days} – {r.age_max_days}
                            </td>
                            <td className="small">{rangeSummary(r)}</td>
                            <td className="small">
                              {r.critical_low ?? "—"} / {r.critical_high ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canCreate && (
                  <form className="border-top pt-3" onSubmit={handleAddRange}>
                    <h6 className="fw-bold text-secondary text-uppercase small">Add range</h6>
                    <div className="row g-2 mb-2">
                      <div className="col-4">
                        <Form.Group controlId="new-range-sex">
                          <Form.Label className="small mb-1">Sex</Form.Label>
                          <Form.Select
                            size="sm"
                            value={rangeSex}
                            onChange={(e) => setRangeSex(e.target.value as Sex)}
                          >
                            <option value="ALL">All</option>
                            <option value="MALE">Male</option>
                            <option value="FEMALE">Female</option>
                          </Form.Select>
                        </Form.Group>
                      </div>
                      <div className="col-4">
                        <Form.Group controlId="new-range-age-min">
                          <Form.Label className="small mb-1">Age min (days)</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            value={rangeAgeMin}
                            onChange={(e) => setRangeAgeMin(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                      <div className="col-4">
                        <Form.Group controlId="new-range-age-max">
                          <Form.Label className="small mb-1">Age max (days)</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            value={rangeAgeMax}
                            onChange={(e) => setRangeAgeMax(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-6">
                        <Form.Group controlId="new-range-normal-min">
                          <Form.Label className="small mb-1">Normal min</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            step="any"
                            value={rangeNormalMin}
                            onChange={(e) => setRangeNormalMin(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                      <div className="col-6">
                        <Form.Group controlId="new-range-normal-max">
                          <Form.Label className="small mb-1">Normal max</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            step="any"
                            value={rangeNormalMax}
                            onChange={(e) => setRangeNormalMax(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                      <div className="col-6">
                        <Form.Group controlId="new-range-critical-low">
                          <Form.Label className="small mb-1">Critical low</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            step="any"
                            value={rangeCriticalLow}
                            onChange={(e) => setRangeCriticalLow(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                      <div className="col-6">
                        <Form.Group controlId="new-range-critical-high">
                          <Form.Label className="small mb-1">Critical high</Form.Label>
                          <Form.Control
                            size="sm"
                            type="number"
                            step="any"
                            value={rangeCriticalHigh}
                            onChange={(e) => setRangeCriticalHigh(e.target.value)}
                          />
                        </Form.Group>
                      </div>
                      <div className="col-12">
                        <Form.Group controlId="new-range-text">
                          <Form.Label className="small mb-1">Text range (when not numeric)</Form.Label>
                          <Form.Control
                            size="sm"
                            value={rangeText}
                            onChange={(e) => setRangeText(e.target.value)}
                            placeholder="e.g. Negative"
                          />
                        </Form.Group>
                      </div>
                    </div>
                    <Button type="submit" variant="cerulean" size="sm" disabled={rangeBusy}>
                      {rangeBusy ? "Adding…" : "Add reference range"}
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
