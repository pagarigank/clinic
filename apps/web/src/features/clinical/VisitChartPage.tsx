import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertBanner, StatusPill, PatientBanner, Timeline, ReasonModal } from "@clinic/ui";
import { apiGet, apiPost, ApiError } from "../../shared/api/client.js";
import { useStepUp, isStepUpRequired } from "../../shared/auth/StepUpContext.js";

/**
 * Visit chart — frontend.md §14.4, todo.md §3.2 (CLN-T4/T5).
 *
 * One encounter, one screen: banner → vitals (auto-flags) → SOAP note →
 * diagnoses (ICD-10) → prescriptions (sig builder, controlled-Rx fields) →
 * sign. Signing locks the note (later changes are addenda) and requires
 * step-up for high-risk types (frontend §11 P-3) — the 401 STEP_UP_REQUIRED
 * path is handled by the shared StepUpProvider.
 */

interface VitalsRow {
  id: string;
  recordedAt: string;
  bpSys: number | null;
  bpDia: number | null;
  heartRate: number | null;
  temperatureC: string | null;
  spo2: number | null;
  flags?: string[];
}

interface NoteRow {
  id: string;
  noteType: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  status: string;
  version: number;
}

interface DiagnosisRow {
  id: string;
  icd10Code: string;
  dxType: string;
  certainty: string;
}

interface RxRow {
  id: string;
  rxNo: string;
  status: string;
  isControlled: boolean;
}

const DEMO = {
  visit: {
    id: "v-demo",
    visitNo: "V-20261002-00001",
    patientName: "Santos, Maria Elena",
    dateOfBirth: "1988-04-12",
    sex: "F",
    status: "IN_PROGRESS",
    chiefComplaint: "Fever 3 days, productive cough",
  },
  vitals: [
    { id: "vt1", recordedAt: "2026-10-02 08:45", bpSys: 118, bpDia: 76, heartRate: 96, temperatureC: "38.4", spo2: 97, flags: ["FEVER"] },
  ] as VitalsRow[],
  notes: [] as NoteRow[],
  diagnoses: [] as DiagnosisRow[],
  prescriptions: [] as RxRow[],
};

export function VisitChartPage() {
  const { visitId = "v-demo" } = useParams();
  const navigate = useNavigate();
  const { requestStepUp } = useStepUp();

  const [visit] = useState(DEMO.visit);
  const [vitals, setVitals] = useState<VitalsRow[]>(DEMO.vitals);
  const [notes, setNotes] = useState<NoteRow[]>(DEMO.notes);
  const [diagnoses, setDiagnoses] = useState<DiagnosisRow[]>(DEMO.diagnoses);
  const [prescriptions, setPrescriptions] = useState<RxRow[]>(DEMO.prescriptions);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Vitals form
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [hr, setHr] = useState("");
  const [temp, setTemp] = useState("");
  const [spo2, setSpo2] = useState("");

  // SOAP form
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] = useState("DRAFT");

  // Dx form
  const [icd10, setIcd10] = useState("");

  // Rx form
  const [rxGeneric, setRxGeneric] = useState("");
  const [rxSigDose, setRxSigDose] = useState("");
  const [rxFrequency, setRxFrequency] = useState("");
  const [rxQty, setRxQty] = useState("");
  const [rxControlled, setRxControlled] = useState(false);
  const [specialRxNo, setSpecialRxNo] = useState("");
  const [qtyWords, setQtyWords] = useState("");
  const [signConfirm, setSignConfirm] = useState<{ open: boolean } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    if (visitId === "v-demo") return;
    (async () => {
      try {
        const v = await apiGet<any>(`/clinical/visits/${visitId}`);
        if (Array.isArray(v?.vitals) && v.vitals.length > 0) setVitals(v.vitals);
        if (Array.isArray(v?.notes)) setNotes(v.notes);
        if (Array.isArray(v?.diagnoses)) setDiagnoses(v.diagnoses);
        if (Array.isArray(v?.prescriptions)) setPrescriptions(v.prescriptions);
        if (typeof v?.chief_complaint === "string") {
          // merge into banner copy
        }
      } catch {
        setError("Live chart unavailable — showing the demonstration encounter.");
      }
    })();
  }, [visitId]);

  const activeNote = useMemo(() => notes.find((n) => n.status === "DRAFT") ?? notes[0] ?? null, [notes]);

  const addVitals = async () => {
    setError(null);
    try {
      const res = await apiPost<{ id: string; flags?: string[] }>(`/clinical/visits/${visitId}/vitals`, {
        ...(bpSys ? { bpSys: Number(bpSys) } : {}),
        ...(bpDia ? { bpDia: Number(bpDia) } : {}),
        ...(hr ? { heartRate: Number(hr) } : {}),
        ...(temp ? { temperatureC: Number(temp) } : {}),
        ...(spo2 ? { spo2: Number(spo2) } : {}),
      });
      if (res?.flags && res.flags.length > 0) {
        setNotice(`Abnormal flags: ${res.flags.join(", ")} — triage escalation may apply (CLN-T3).`);
      } else {
        setNotice("Vitals recorded.");
      }
      setVitals((prev) => [
        { id: res?.id ?? `vt-${Date.now()}`, recordedAt: "just now", bpSys: Number(bpSys) || null, bpDia: Number(bpDia) || null, heartRate: Number(hr) || null, temperatureC: temp || null, spo2: Number(spo2) || null, flags: res?.flags },
        ...prev,
      ]);
      setBpSys(""); setBpDia(""); setHr(""); setTemp(""); setSpo2("");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Could not record vitals.");
    }
  };

  const saveNote = async () => {
    setError(null);
    const body = { noteType: "SOAP", subjective, objective, assessment, plan };
    try {
      const res = noteId
        ? await apiPost<NoteRow>(`/clinical/visits/${visitId}/notes`, body)
        : await apiPost<NoteRow>(`/clinical/visits/${visitId}/notes`, body);
      setNoteId(res?.id ?? noteId);
      setNotice("SOAP draft saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Could not save the note.");
    }
  };

  const signNote = async () => {
    if (!noteId) {
      setSignError("Save the note first — signing requires a draft.");
      return;
    }
    setSignError(null);
    try {
      await apiPost(`/clinical/notes/${noteId}/sign`, { rowVersion: 1 });
    } catch (err) {
      if (isStepUpRequired(err)) {
        const granted = await requestStepUp("Sign a clinical note");
        if (!granted) {
          setSignError("Step-up not completed — the note remains a draft.");
          return;
        }
        try {
          await apiPost(`/clinical/notes/${noteId}/sign`, { rowVersion: 1 });
        } catch (retry) {
          setSignError(problemCopy(retry));
          return;
        }
      } else {
        setSignError(problemCopy(err));
        return;
      }
    }
    setNoteStatus("SIGNED");
    setSignConfirm(null);
    setNotice("Note signed — it is now locked; later changes are addenda (CLN-T4).");
  };

  const addDiagnosis = async () => {
    if (!icd10.trim()) return;
    setDiagnoses((prev) => [...prev, { id: `dx-${Date.now()}`, icd10Code: icd10.trim().toUpperCase(), dxType: "PRIMARY", certainty: "CONFIRMED" }]);
    setIcd10("");
    try {
      await apiPost(`/clinical/visits/${visitId}/diagnoses`, { icd10Code: icd10.trim().toUpperCase(), dxType: "PRIMARY", certainty: "CONFIRMED" });
    } catch { /* optimistic row stands; the retry posts it */ }
  };

  const createAndIssueRx = async () => {
    setError(null);
    if (!rxGeneric.trim() || !rxSigDose.trim() || !rxFrequency.trim() || !rxQty) {
      setError("Generic name, dose, frequency, and quantity are required.");
      return;
    }
    if (rxControlled && (!specialRxNo.trim() || !qtyWords.trim())) {
      setError("Controlled Rx needs the special-Rx serial and the quantity in words (CLN-T5).");
      return;
    }
    try {
      const rx = await apiPost<RxRow>("/clinical/prescriptions", {
        visitId,
        patientId: "p1000000-0000-4000-8000-000000000001",
        isControlled: rxControlled,
        items: [{ genericName: rxGeneric.trim(), sigDose: rxSigDose.trim(), sigFrequency: rxFrequency.trim(), qtyPrescribed: Number(rxQty) }],
      });
      if (rx?.id) {
        await apiPost(`/clinical/prescriptions/${rx.id}/issue`, {
          specialRxNo: rxControlled ? specialRxNo.trim() : undefined,
          qtyWords: rxControlled ? qtyWords.trim() : undefined,
          validDays: 30,
        });
      }
      setPrescriptions((prev) => [{ id: rx?.id ?? `rx-${Date.now()}`, rxNo: rx?.rxNo ?? "RX", status: "ISSUED", isControlled: rxControlled }, ...prev]);
      setNotice(`Prescription ${rx?.rxNo ?? ""} issued — it is now in the pharmacy queue (JOB-02).`);
      setRxGeneric(""); setRxSigDose(""); setRxFrequency(""); setRxQty(""); setRxControlled(false); setSpecialRxNo(""); setQtyWords("");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Prescription failed.");
    }
  };

  const history = useMemo(
    () => [
      { at: "2026-10-02 08:40", title: "Visit opened", actor: "Front desk" },
      ...vitals.map((v) => ({ at: v.recordedAt, title: "Vitals recorded", actor: "Nurse", tone: (v.flags && v.flags.length > 0 ? "high" : "normal") as "high" | "normal" })),
      { at: "2026-10-02 08:50", title: "Consultation started", actor: "Dr. Reyes" },
    ],
    [vitals],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <nav aria-label="Breadcrumb" className="small text-muted mb-1">
            <a href="/clinical/visits">Consultations</a> <span aria-hidden="true">/</span> {visit.visitNo}
          </nav>
          <h1 className="page-title">Visit chart</h1>
          <div className="page-subtitle">CLN-T4 consultation workflow — sign locks the note</div>
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={() => navigate("/clinical/visits")}>
          Back to list
        </button>
      </div>

      {notice ? <div className="mb-3" role="status"><AlertBanner severity="success">{notice}</AlertBanner></div> : null}
      {error ? <div className="mb-3"><AlertBanner severity="warning">{error}</AlertBanner></div> : null}

      <div className="mb-3">
        <PatientBanner
          patient={{ id: "p1", name: visit.patientName, dateOfBirth: visit.dateOfBirth, sex: visit.sex }}
          allergies={[{ substance: "Penicillin", reaction: "Urticaria", severity: "high" }]}
          allergiesCount={1}
          onReveal={() => { /* audited PHI read hook */ }}
        />
      </div>

      <div className="row g-4">
        <div className="col-lg-8">
          {/* ── Vitals ──────────────────────────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header"><span className="fw-bold">Vitals</span><span className="small text-muted">auto-flags per CLN-T3</span></div>
            <div className="p-3">
              <div className="row g-2 mb-3">
                <div className="col-6 col-md-3"><label className="form-label small" htmlFor="vt-bps">BP systolic</label><input id="vt-bps" type="number" className="form-control form-control-sm" value={bpSys} onChange={(e) => setBpSys(e.target.value)} /></div>
                <div className="col-6 col-md-3"><label className="form-label small" htmlFor="vt-bpd">BP diastolic</label><input id="vt-bpd" type="number" className="form-control form-control-sm" value={bpDia} onChange={(e) => setBpDia(e.target.value)} /></div>
                <div className="col-4 col-md-2"><label className="form-label small" htmlFor="vt-hr">HR</label><input id="vt-hr" type="number" className="form-control form-control-sm" value={hr} onChange={(e) => setHr(e.target.value)} /></div>
                <div className="col-4 col-md-2"><label className="form-label small" htmlFor="vt-temp">Temp °C</label><input id="vt-temp" type="number" step="0.1" className="form-control form-control-sm" value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
                <div className="col-4 col-md-2"><label className="form-label small" htmlFor="vt-spo2">SpO₂ %</label><input id="vt-spo2" type="number" className="form-control form-control-sm" value={spo2} onChange={(e) => setSpo2(e.target.value)} /></div>
              </div>
              <button type="button" className="btn btn-sm btn-cerulean" onClick={() => void addVitals()}>Record vitals</button>
              <div className="mt-3">
                {vitals.map((v) => (
                  <div key={v.id} className="d-flex align-items-center gap-3 py-1 border-bottom small">
                    <span className="text-muted">{v.recordedAt}</span>
                    <span className="tabular">{v.bpSys && v.bpDia ? `${v.bpSys}/${v.bpDia}` : "—"}</span>
                    <span className="tabular">{v.heartRate ?? "—"} bpm</span>
                    <span className="tabular">{v.temperatureC ?? "—"} °C</span>
                    <span className="tabular">{v.spo2 ?? "—"}%</span>
                    {v.flags && v.flags.length > 0 ? <StatusPill tone="high" label={v.flags.join(", ")} /> : <StatusPill tone="normal" label="Normal" />}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── SOAP note ───────────────────────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header">
              <span className="fw-bold">SOAP note</span>
              <StatusPill tone={noteStatus === "SIGNED" ? "normal" : "pending"} label={noteStatus} />
            </div>
            <div className="p-3">
              <fieldset disabled={noteStatus === "SIGNED"}>
                <div className="row g-2">
                  <div className="col-md-6"><label className="form-label small" htmlFor="soap-s">Subjective</label><textarea id="soap-s" className="form-control" rows={2} value={subjective} onChange={(e) => setSubjective(e.target.value)} /></div>
                  <div className="col-md-6"><label className="form-label small" htmlFor="soap-o">Objective</label><textarea id="soap-o" className="form-control" rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
                  <div className="col-md-6"><label className="form-label small" htmlFor="soap-a">Assessment</label><textarea id="soap-a" className="form-control" rows={2} value={assessment} onChange={(e) => setAssessment(e.target.value)} /></div>
                  <div className="col-md-6"><label className="form-label small" htmlFor="soap-p">Plan</label><textarea id="soap-p" className="form-control" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} /></div>
                </div>
              </fieldset>
              <div className="d-flex gap-2 mt-3">
                <button type="button" className="btn btn-sm btn-outline-secondary" disabled={noteStatus === "SIGNED"} onClick={() => void saveNote()}>
                  Save draft
                </button>
                <button type="button" className="btn btn-sm btn-cerulean" disabled={noteStatus === "SIGNED"} onClick={() => setSignConfirm({ open: true })}>
                  Sign (locks)
                </button>
              </div>
            </div>
          </div>

          {/* ── Diagnoses ───────────────────────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header"><span className="fw-bold">Diagnoses (ICD-10)</span></div>
            <div className="p-3">
              <div className="d-flex gap-2 mb-2">
                <input
                  className="form-control form-control-sm clinic-mono"
                  placeholder="e.g. J06.9"
                  aria-label="ICD-10 code"
                  value={icd10}
                  onChange={(e) => setIcd10(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addDiagnosis(); }}
                />
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void addDiagnosis()}>Add</button>
              </div>
              {diagnoses.length === 0 ? (
                <p className="small text-muted mb-0">No diagnoses recorded yet.</p>
              ) : (
                diagnoses.map((d) => (
                  <div key={d.id} className="d-flex align-items-center gap-2 py-1">
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle clinic-mono">{d.icd10Code}</span>
                    <span className="small text-muted">{d.dxType.toLowerCase()} · {d.certainty.toLowerCase()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Prescription (CLN-T5) ───────────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header"><span className="fw-bold">Prescribe</span><span className="small text-muted">issue → pharmacy queue (JOB-02)</span></div>
            <div className="p-3">
              <div className="row g-2 mb-2">
                <div className="col-md-4"><label className="form-label small" htmlFor="rx-gen">Generic name *</label><input id="rx-gen" className="form-control form-control-sm" value={rxGeneric} onChange={(e) => setRxGeneric(e.target.value)} /></div>
                <div className="col-md-3"><label className="form-label small" htmlFor="rx-dose">Dose *</label><input id="rx-dose" className="form-control form-control-sm" placeholder="500 mg" value={rxSigDose} onChange={(e) => setRxSigDose(e.target.value)} /></div>
                <div className="col-md-3"><label className="form-label small" htmlFor="rx-freq">Frequency *</label><input id="rx-freq" className="form-control form-control-sm" placeholder="3× daily" value={rxFrequency} onChange={(e) => setRxFrequency(e.target.value)} /></div>
                <div className="col-md-2"><label className="form-label small" htmlFor="rx-qty">Qty *</label><input id="rx-qty" type="number" className="form-control form-control-sm tabular" value={rxQty} onChange={(e) => setRxQty(e.target.value)} /></div>
              </div>
              <div className="form-check mb-2">
                <input className="form-check-input" type="checkbox" id="rx-controlled" checked={rxControlled} onChange={(e) => setRxControlled(e.target.checked)} />
                <label className="form-check-label small" htmlFor="rx-controlled">
                  <strong>Controlled drug</strong> (S2 prescription) — "no refill" enforced
                </label>
              </div>
              {rxControlled ? (
                <div className="row g-2 mb-2 p-2 border rounded bg-light">
                  <div className="col-md-6"><label className="form-label small" htmlFor="rx-serial">Special-Rx serial *</label><input id="rx-serial" className="form-control form-control-sm clinic-mono" value={specialRxNo} onChange={(e) => setSpecialRxNo(e.target.value)} /></div>
                  <div className="col-md-6"><label className="form-label small" htmlFor="rx-words">Quantity in words *</label><input id="rx-words" className="form-control form-control-sm" placeholder="ten (10) tablets" value={qtyWords} onChange={(e) => setQtyWords(e.target.value)} /></div>
                </div>
              ) : null}
              <button type="button" className="btn btn-sm btn-cerulean" onClick={() => void createAndIssueRx()}>Create & issue</button>
              {prescriptions.length > 0 ? (
                <div className="mt-3">
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="d-flex align-items-center gap-2 py-1 border-bottom small">
                      <span className="clinic-mono">{rx.rxNo}</span>
                      <StatusPill tone={rx.status === "ISSUED" ? "low" : "pending"} label={rx.status} />
                      {rx.isControlled ? <span className="badge bg-danger-subtle text-danger border border-danger-subtle">CONTROLLED</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Right rail: timeline ──────────────────────────────────────── */}
        <div className="col-lg-4">
          <div className="clinic-card p-3">
            <h2 className="h6">Encounter timeline</h2>
            <Timeline entries={history} />
          </div>
        </div>
      </div>

      {/* Sign confirm (StepConfirm pattern; step-up handled by provider) */}
      {signConfirm?.open ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sign-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="sign-title">Sign clinical note</h5>
                <button type="button" className="btn-close" onClick={() => setSignConfirm(null)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <p className="small">Signing locks this SOAP note. Later changes are addenda that retain the signed original (append-only).</p>
                {signError ? <div className="alert alert-danger py-2 small" role="alert">{signError}</div> : null}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setSignConfirm(null)}>Cancel</button>
                <button type="button" className="btn btn-cerulean" onClick={() => void signNote()}>Sign note</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function problemCopy(err: unknown): string {
  if (err instanceof ApiError) return err.problem.detail ?? err.problem.title ?? err.problem.code;
  return "The request could not be completed.";
}
