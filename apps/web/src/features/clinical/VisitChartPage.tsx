import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertBanner, StatusPill, PatientBanner, Timeline } from "@clinic/ui";
import { apiGet, apiPost, apiGetBlob, ApiError } from "../../shared/api/client.js";
import { useStepUp, isStepUpRequired } from "../../shared/auth/StepUpContext.js";
import { PrescriptionPrintModal } from "./PrescriptionPrintModal.js";

/**
 * Visit chart — frontend.md §14.4, todo.md §3.2 (CLN-T4/T5), LAB-T1, SUP-T10.
 *
 * One encounter, one screen:
 *  - Patient banner & vitals (auto-flags per CLN-T3)
 *  - Clinical SOAP notes (sign-locks per CLN-T4)
 *  - Diagnoses (ICD-10)
 *  - Prescriptions (sig builder, S2 controlled-Rx fields, wired to Pharmacy Dispensing Workbench)
 *  - Laboratory requests (tests/panels ordering, wired to Laboratory Worklist)
 *  - Central Supply requests & consumables (wired to Central Supply Issue Workbench)
 *  - Official Doctor's Prescription & Orders Print Center (Rx Pad, Lab Request slip, Combined Orders)
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
  specialRxNo?: string | null;
  qtyWords?: string | null;
  validUntil?: string | null;
  prescriberName?: string | null;
  notes?: string | null;
  items?: Array<{
    id?: string;
    generic_name?: string;
    genericName?: string;
    brand_name?: string;
    brandName?: string;
    strength?: string;
    form?: string;
    route?: string;
    sig_dose?: string;
    sigDose?: string;
    sig_frequency?: string;
    sigFrequency?: string;
    sig_duration?: string;
    sigDuration?: string;
    qty_prescribed?: number;
    qtyPrescribed?: number;
  }>;
}

interface LabOrderRow {
  id: string;
  orderNo?: string;
  order_no?: string;
  status: string;
  priority: string;
  clinicalInfo?: string | null;
  clinical_info?: string | null;
  orderedAt?: string;
  ordered_at?: string;
  items?: Array<{
    id: string;
    test_id: string;
    test_name?: string;
    name?: string;
    test_code?: string;
    code?: string;
    specimen_type?: string;
    fasting_required?: boolean;
    fasting_hours?: number;
    instructions?: string;
    status: string;
  }>;
}

interface SupplyRow {
  id: string;
  itemName?: string;
  item_name?: string;
  itemCode?: string;
  item_code?: string;
  locationName?: string;
  location_name?: string;
  qty: number;
  loggedAt?: string;
  logged_at?: string;
  notes?: string | null;
}

interface CertificateRow {
  id: string;
  doc_no: string;
  cert_type: "FIT_TO_WORK" | "SICK_LEAVE" | "CLEARANCE";
  findings?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  issued_at?: string;
  voided_at?: string | null;
  void_reason?: string | null;
  patient_name?: string;
  issuer_name?: string;
}

export function VisitChartPage() {
  const { visitId = "" } = useParams();
  const navigate = useNavigate();
  const { requestStepUp } = useStepUp();

  const [loading, setLoading] = useState(true);
  const [visit, setVisit] = useState<{
    id: string; visitNo: string; patientId: string; patientName: string;
    dateOfBirth?: string; sex?: string; status?: string;
    branchId?: string; branchName?: string; clinicName?: string;
    chiefComplaint?: string; practitionerName?: string;
    allergies?: Array<{ substance: string; severity?: string }>;
  } | null>(null);
  const [vitals, setVitals] = useState<VitalsRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [diagnoses, setDiagnoses] = useState<DiagnosisRow[]>([]);
  const [prescriptions, setPrescriptions] = useState<RxRow[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrderRow[]>([]);
  const [supplies, setSupplies] = useState<SupplyRow[]>([]);
  const [certificates, setCertificates] = useState<CertificateRow[]>([]);

  // Certificate form (CLN-T8)
  const [certType, setCertType] = useState<CertificateRow["cert_type"]>("FIT_TO_WORK");
  const [certFindings, setCertFindings] = useState("");
  const [certValidFrom, setCertValidFrom] = useState("");
  const [certValidTo, setCertValidTo] = useState("");
  const [certSubmitting, setCertSubmitting] = useState(false);
  const [certPrintingId, setCertPrintingId] = useState<string | null>(null);

  const [printModal, setPrintModal] = useState<{ open: boolean; tab: "RX" | "LAB" | "ALL" } | null>(null);
  const [availableDrugs, setAvailableDrugs] = useState<any[]>([]);

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
  // The matched formulary product id. Without it the prescription item is created
  // with drugProductId = null, and the dispense workbench drops the line
  // (it requires item_id to allocate stock), so a prescription written in the UI
  // can never be dispensed. Selecting from the formulary now records the link.
  const [rxDrugProductId, setRxDrugProductId] = useState<string | null>(null);
  const [rxSigDose, setRxSigDose] = useState("");
  const [rxFrequency, setRxFrequency] = useState("");
  const [rxQty, setRxQty] = useState("");
  const [rxControlled, setRxControlled] = useState(false);
  const [specialRxNo, setSpecialRxNo] = useState("");
  const [qtyWords, setQtyWords] = useState("");
  const [signConfirm, setSignConfirm] = useState<{ open: boolean } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  // Lab form & catalog
  const [availableTests, setAvailableTests] = useState<any[]>([]);
  const [selectedTestId, setSelectedTestId] = useState("");
  const [labPriority, setLabPriority] = useState<"ROUTINE" | "URGENT" | "STAT">("ROUTINE");
  const [labClinicalInfo, setLabClinicalInfo] = useState("");
  const [labSubmitting, setLabSubmitting] = useState(false);

  // Supply form & catalog
  const [availableSupplyItems, setAvailableSupplyItems] = useState<any[]>([]);
  const [availableLocations, setAvailableLocations] = useState<any[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [supplyQty, setSupplyQty] = useState("1");
  const [supplyNotes, setSupplyNotes] = useState("");
  const [supplySubmitting, setSupplySubmitting] = useState(false);

  useEffect(() => {
    // Load catalogs in background (non-blocking)
    void (async () => {
      try {
        const tests = await apiGet<any[]>("/lab/tests");
        if (Array.isArray(tests)) setAvailableTests(tests);
      } catch { /* ignore offline fallback */ }

      try {
        const drugs = await apiGet<any[]>("/pharmacy/products");
        if (Array.isArray(drugs)) setAvailableDrugs(drugs);
      } catch { /* ignore offline fallback */ }

      try {
        const items = await apiGet<any[]>("/supply/items");
        if (Array.isArray(items)) setAvailableSupplyItems(items.filter((i) => i.item_type === "SUPPLY" || i.item_type === "CONSUMABLE" || true));
      } catch { /* ignore offline fallback */ }

      try {
        const locs = await apiGet<any[]>("/supply/locations");
        if (Array.isArray(locs) && locs.length > 0) {
          setAvailableLocations(locs);
          setSelectedLocationId(locs[0].id);
        }
      } catch { /* ignore offline fallback */ }
    })();
  }, []);

  useEffect(() => {
    if (!visitId) return;
    setLoading(true);
    (async () => {
      try {
        const v = await apiGet<any>(`/clinical/visits/${visitId}`);
        if (v?.id) {
          setVisit({
            id: v.id,
            visitNo: v.visit_no || v.visitNo || "",
            patientId: v.patient_id || v.patientId || "",
            patientName: v.patient_name || v.patientName || "",
            dateOfBirth: v.date_of_birth ? v.date_of_birth.split("T")[0] : undefined,
            sex: v.gender || v.sex || undefined,
            status: v.status || "IN_PROGRESS",
            branchId: v.branch_id || v.branchId || undefined,
            branchName: v.branch_name || v.branchName || undefined,
            clinicName: v.clinic_name || v.clinicName || undefined,
            chiefComplaint: v.chief_complaint || v.chiefComplaint || "",
            practitionerName: v.practitioner_name || v.practitionerName || undefined,
            allergies: Array.isArray(v.allergies) ? v.allergies : [],
          } as any);
        }
        if (Array.isArray(v?.vitals) && v.vitals.length > 0) setVitals(v.vitals);
        if (Array.isArray(v?.notes)) setNotes(v.notes);
        if (Array.isArray(v?.diagnoses)) setDiagnoses(v.diagnoses);
        if (Array.isArray(v?.prescriptions)) {
          setPrescriptions(v.prescriptions.map((rx: any) => ({
            id: rx.id,
            rxNo: rx.rx_no || rx.rxNo || "RX",
            status: rx.status || "ISSUED",
            isControlled: Boolean(rx.is_controlled ?? rx.isControlled),
            specialRxNo: rx.special_rx_no || rx.specialRxNo,
            qtyWords: rx.qty_words || rx.qtyWords,
            validUntil: rx.valid_until || rx.validUntil,
            prescriberName: rx.prescriber_name || rx.prescriberName,
            notes: rx.notes,
            items: rx.items,
          })));
        }
        if (Array.isArray(v?.labOrders)) setLabOrders(v.labOrders);
        if (Array.isArray(v?.supplies)) setSupplies(v.supplies);
        try {
          const certs = await apiGet<{ data?: CertificateRow[] }>(`/clinical/visits/${visitId}/certificates`);
          if (Array.isArray(certs?.data)) setCertificates(certs.data);
        } catch { /* certificates are optional on the chart */ }
      } catch {
        setError("Could not load visit chart. The visit may not exist or you may not have access.");
      } finally {
        setLoading(false);
      }
    })();
  }, [visitId]);

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
      const res = await apiPost<NoteRow>(`/clinical/visits/${visitId}/notes`, body);
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
    const code = icd10.trim().toUpperCase();
    setIcd10("");
    try {
      await apiPost(`/clinical/visits/${visitId}/diagnoses`, { icd10Code: code, dxType: "PRIMARY", certainty: "CONFIRMED" });
    } catch { /* optimistic row stands */ }
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
      if (!visit?.patientId) { setError("Patient information is missing for this visit."); return; }
      const patientId = visit.patientId;
      const rx = await apiPost<any>("/clinical/prescriptions", {
        visitId,
        patientId,
        isControlled: rxControlled,
        items: [{
          // drugProductId links the line to the formulary so the dispense
          // workbench can allocate stock against it. Omitted (not null) when
          // the drug was typed free-form and is not in the formulary.
          ...(rxDrugProductId ? { drugProductId: rxDrugProductId } : {}),
          genericName: rxGeneric.trim(),
          sigDose: rxSigDose.trim(),
          sigFrequency: rxFrequency.trim(),
          qtyPrescribed: Number(rxQty),
        }],
      });
      if (rx?.id) {
        await apiPost(`/clinical/prescriptions/${rx.id}/issue`, {
          specialRxNo: rxControlled ? specialRxNo.trim() : undefined,
          qtyWords: rxControlled ? qtyWords.trim() : undefined,
          validDays: 30,
        });
      }
      setPrescriptions((prev) => [
        {
          id: rx?.id ?? `rx-${Date.now()}`,
          rxNo: rx?.rxNo ?? rx?.rx_no ?? "RX",
          status: "ISSUED",
          isControlled: rxControlled,
          specialRxNo: rxControlled ? specialRxNo.trim() : undefined,
          qtyWords: rxControlled ? qtyWords.trim() : undefined,
          prescriberName: visit.practitionerName || "Attending Physician",
          items: [{
            generic_name: rxGeneric.trim(),
            sig_dose: rxSigDose.trim(),
            sig_frequency: rxFrequency.trim(),
            qty_prescribed: Number(rxQty),
          }],
        },
        ...prev,
      ]);
      setNotice(`Prescription ${rx?.rxNo ?? rx?.rx_no ?? ""} issued — it is now in the pharmacy queue (JOB-02).`);
      setRxGeneric(""); setRxSigDose(""); setRxFrequency(""); setRxQty(""); setRxControlled(false); setSpecialRxNo(""); setQtyWords("");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Prescription failed.");
    }
  };

  const createLabOrder = async () => {
    if (!selectedTestId) return;
    setError(null);
    setLabSubmitting(true);
    try {
      const branchId = visit?.branchId || "";
      if (!visit?.patientId) { setError("Patient information is missing for this visit."); return; }
      const patientId = visit.patientId;
      const selectedTest = availableTests.find((t) => t.id === selectedTestId);
      const res = await apiPost<any>("/lab/orders", {
        branchId,
        patientId,
        visitId,
        testIds: [selectedTestId],
        priority: labPriority,
        clinicalInfo: labClinicalInfo.trim() || undefined,
        source: "VISIT",
      });

      const newOrder: LabOrderRow = {
        id: res?.id ?? `ord-${Date.now()}`,
        orderNo: res?.orderNo ?? res?.order_no ?? `LAB-${Date.now().toString().slice(-6)}`,
        status: res?.status ?? "ORDERED",
        priority: labPriority,
        clinicalInfo: labClinicalInfo.trim() || undefined,
        orderedAt: new Date().toISOString(),
        items: res?.items || [
          {
            id: `item-${Date.now()}`,
            test_id: selectedTestId,
            test_name: selectedTest?.name || "Laboratory Test",
            test_code: selectedTest?.code || "LAB",
            specimen_type: selectedTest?.specimen_type || "Whole Blood / Serum",
            fasting_required: selectedTest?.fasting_required,
            fasting_hours: selectedTest?.fasting_hours,
            instructions: selectedTest?.instructions,
            status: "ORDERED",
          },
        ],
      };

      setLabOrders((prev) => [newOrder, ...prev]);
      setNotice(`Laboratory order ${newOrder.orderNo} created — queued in the Laboratory Worklist.`);
      setSelectedTestId("");
      setLabClinicalInfo("");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Failed to order lab test.");
    } finally {
      setLabSubmitting(false);
    }
  };

  const addSupplyConsumption = async () => {
    if (!selectedItemId) return;
    setError(null);
    setSupplySubmitting(true);
    try {
const item = availableSupplyItems.find((i) => i.id === selectedItemId);
        const location = availableLocations.find((l) => l.id === selectedLocationId) || availableLocations[0];
        // No synthetic fallbacks: a made-up location or UOM id is not a "safe
        // default", it is a foreign-key violation that used to surface as an
        // opaque 500 while the chart still showed the row.
        const locId = location?.id;
        const uomId = item?.base_uom_id;
        if (!locId || !uomId) {
          setError(
            !locId
              ? "Choose a stock location before logging consumption."
              : `${item?.name ?? "That item"} has no base unit of measure on file.`,
          );
          setSupplySubmitting(false);
          return;
        }

      await apiPost("/supply/consumption", {
        locationId: locId,
        itemId: selectedItemId,
        qty: Number(supplyQty) || 1,
        uomId,
        refType: "VISIT",
        refId: visitId,
        notes: supplyNotes.trim() || undefined,
      });

      const newSupply: SupplyRow = {
        id: `sup-${Date.now()}`,
        itemName: item?.name || "Supply Item",
        itemCode: item?.code,
        locationName: location?.name || "Consultation Room",
        qty: Number(supplyQty) || 1,
        loggedAt: new Date().toISOString(),
        notes: supplyNotes.trim() || null,
      };

      setSupplies((prev) => [newSupply, ...prev]);
      setNotice(`Supply ${newSupply.itemName} (x${newSupply.qty}) logged for this visit encounter.`);
      setSelectedItemId("");
      setSupplyNotes("");
      setSupplyQty("1");
    } catch (err) {
      // If inventory throws insufficient stock warning, allow optimistic logging for consultation record
      if (err instanceof ApiError && err.problem.code === "STOCK_INSUFFICIENT") {
        const item = availableSupplyItems.find((i) => i.id === selectedItemId);
        const location = availableLocations.find((l) => l.id === selectedLocationId);
        const newSupply: SupplyRow = {
          id: `sup-${Date.now()}`,
          itemName: item?.name || "Supply Item",
          itemCode: item?.code,
          locationName: location?.name || "Clinic Room",
          qty: Number(supplyQty) || 1,
          loggedAt: new Date().toISOString(),
          notes: supplyNotes.trim() || "Used during encounter",
        };
        setSupplies((prev) => [newSupply, ...prev]);
        setNotice(`Supply recorded for encounter (Stock warning: pending store replenishment).`);
        setSelectedItemId("");
        setSupplyNotes("");
        setSupplyQty("1");
      } else {
        setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Failed to record supply usage.");
      }
    } finally {
      setSupplySubmitting(false);
    }
  };

  const loadCertificates = async () => {
    try {
      const certs = await apiGet<{ data?: CertificateRow[] }>(`/clinical/visits/${visitId}/certificates`);
      if (Array.isArray(certs?.data)) setCertificates(certs.data);
    } catch {
      /* certificates are optional on the chart */
    }
  };

  const issueCertificate = async () => {
    setError(null);
    setCertSubmitting(true);
    try {
      await apiPost(`/clinical/visits/${visitId}/certificates`, {
        certType,
        ...(certFindings.trim() ? { findings: certFindings.trim() } : {}),
        ...(certValidFrom ? { validFrom: certValidFrom } : {}),
        ...(certValidTo ? { validTo: certValidTo } : {}),
      });
      setNotice("Medical certificate issued and numbered (MC-…).");
      setCertFindings("");
      setCertValidFrom("");
      setCertValidTo("");
      await loadCertificates();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Could not issue the medical certificate.");
    } finally {
      setCertSubmitting(false);
    }
  };

  const printCertificatePdf = async (cert: CertificateRow) => {
    setError(null);
    setCertPrintingId(cert.id);
    try {
      const blob = await apiGetBlob(`/clinical/certificates/${cert.id}/pdf`);
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = `MedicalCertificate-${cert.doc_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("Certificate PDF download failed, falling back to window.print():", err);
      window.print();
    } finally {
      setCertPrintingId(null);
    }
  };

  const history = useMemo(
    () => [
      ...(visit ? [{ at: "Encounter", title: `Visit ${visit.visitNo} (${visit.status || "IN_PROGRESS"})`, actor: visit.practitionerName || "Attending Physician", tone: "normal" as const }] : []),
      ...vitals.map((v) => ({ at: v.recordedAt, title: "Vitals recorded", actor: "Nurse", tone: (v.flags && v.flags.length > 0 ? "high" : "normal") as "high" | "normal" })),
      ...prescriptions.map((rx) => ({ at: "Today", title: `Rx ${rx.rxNo} issued`, actor: rx.prescriberName || "Doctor", tone: "normal" as const })),
      ...labOrders.map((ord) => ({ at: "Today", title: `Lab Order ${ord.orderNo || ord.order_no} (${ord.priority})`, actor: "Doctor", tone: (ord.priority === "STAT" ? "high" : "normal") as "high" | "normal" })),
      ...supplies.map((s) => ({ at: "Today", title: `Supply: ${s.itemName || s.item_name} (x${s.qty})`, actor: "Clinical Staff", tone: "normal" as const })),
    ],
    [visit, vitals, prescriptions, labOrders, supplies],
  );

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="spinner-border text-primary mb-3" role="status">
          <span className="visually-hidden">Loading visit chart...</span>
        </div>
        <p className="text-muted small">Loading visit chart...</p>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="p-4">
        <div className="page-header d-flex justify-content-between align-items-center mb-3">
          <h1 className="page-title">Visit Not Found</h1>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate("/clinical/visits")}>
            Back to list
          </button>
        </div>
        <AlertBanner severity="warning">
          {error || "Could not load visit chart. The visit may not exist or you may not have access."}
        </AlertBanner>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <nav aria-label="Breadcrumb" className="small text-muted mb-1">
            <Link to="/clinical/visits">Consultations</Link> <span aria-hidden="true">/</span> {visit.visitNo}
          </nav>
          <h1 className="page-title">Visit chart</h1>
          <div className="page-subtitle">CLN-T4 consultation workflow — sign locks the note</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm fw-semibold px-3"
            onClick={() => setPrintModal({ open: true, tab: "ALL" })}
          >
            🖨️ Print Prescription &amp; Orders
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate("/clinical/visits")}>
            Back to list
          </button>
        </div>
      </div>

      {notice ? <div className="mb-3" role="status"><AlertBanner severity="success">{notice}</AlertBanner></div> : null}
      {error ? <div className="mb-3"><AlertBanner severity="warning">{error}</AlertBanner></div> : null}

      <div className="mb-3">
        <PatientBanner
          patient={{ id: visit.patientId, name: visit.patientName, dateOfBirth: visit.dateOfBirth, sex: visit.sex }}
          allergies={(visit.allergies || []).map((a) => ({
            substance: a.substance,
            severity: (a.severity as any) || "medium",
          }))}
          allergiesCount={visit.allergies?.length || 0}
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
            <div className="clinic-card-header d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-bold">Prescribe</span>
                <span className="small text-muted ms-2">issue → pharmacy queue (JOB-02)</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary py-0 px-2"
                  style={{ fontSize: "0.8rem" }}
                  onClick={() => setPrintModal({ open: true, tab: "RX" })}
                >
                  🖨️ Print Prescription
                </button>
                <Link to="/pharmacy/dispense" className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: "0.8rem" }}>
                  💊 Pharmacy Workbench &rarr;
                </Link>
              </div>
            </div>
            <div className="p-3">
              <div className="row g-2 mb-2">
                <div className="col-md-4">
                  <label className="form-label small" htmlFor="rx-gen">Generic name *</label>
                  <input
                    id="rx-gen"
                    list="formulary-drug-list"
                    className="form-control form-control-sm"
                    placeholder="e.g. Amoxicillin 500mg"
                    value={rxGeneric}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRxGeneric(val);
                      const matched = availableDrugs.find(
                        (d) =>
                          d.generic_name === val ||
                          `${d.generic_name || ""} ${d.strength || ""}`.trim().toLowerCase() === val.trim().toLowerCase() ||
                          (d.brand_name && d.brand_name.toLowerCase() === val.trim().toLowerCase())
                      );
                      if (matched) {
                        setRxDrugProductId(matched.id ?? null);
                        if (matched.strength && !rxSigDose) setRxSigDose(matched.strength);
                        if (matched.rx_required === "CONTROLLED") setRxControlled(true);
                      } else {
                        // Free text that is not in the formulary cannot be dispensed
                        // against stock; clear any stale link.
                        setRxDrugProductId(null);
                      }
                    }}
                  />
                  <datalist id="formulary-drug-list">
                    {availableDrugs.map((d) => (
                      <option key={d.id} value={`${d.generic_name || ""} ${d.strength || ""}`.trim()}>
                        {d.brand_name ? `[${d.brand_name}] ` : ""}{d.generic_name} {d.strength} {d.dosage_form} {d.rx_required === "CONTROLLED" ? "(S2)" : ""}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="rx-dose">Dose *</label>
                  <input
                    id="rx-dose"
                    className="form-control form-control-sm"
                    placeholder="500 mg"
                    value={rxSigDose}
                    onChange={(e) => setRxSigDose(e.target.value)}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="rx-freq">Frequency *</label>
                  <input
                    id="rx-freq"
                    className="form-control form-control-sm"
                    placeholder="3× daily"
                    value={rxFrequency}
                    onChange={(e) => setRxFrequency(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="rx-qty">Qty *</label>
                  <input
                    id="rx-qty"
                    type="number"
                    className="form-control form-control-sm tabular"
                    value={rxQty}
                    onChange={(e) => setRxQty(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-check mb-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="rx-controlled"
                  checked={rxControlled}
                  onChange={(e) => setRxControlled(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="rx-controlled">
                  <strong>Controlled drug</strong> (S2 prescription) — "no refill" enforced
                </label>
              </div>
              {rxControlled ? (
                <div className="row g-2 mb-2 p-2 border rounded bg-light">
                  <div className="col-md-6">
                    <label className="form-label small" htmlFor="rx-serial">Special-Rx serial *</label>
                    <input
                      id="rx-serial"
                      className="form-control form-control-sm clinic-mono"
                      value={specialRxNo}
                      onChange={(e) => setSpecialRxNo(e.target.value)}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small" htmlFor="rx-words">Quantity in words *</label>
                    <input
                      id="rx-words"
                      className="form-control form-control-sm"
                      placeholder="ten (10) tablets"
                      value={qtyWords}
                      onChange={(e) => setQtyWords(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
              <button type="button" className="btn btn-sm btn-cerulean" onClick={() => void createAndIssueRx()}>
                Create & issue
              </button>
              {prescriptions.length > 0 ? (
                <div className="mt-3">
                  <div className="small fw-semibold text-muted mb-1">Prescriptions issued for this encounter:</div>
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="d-flex align-items-center justify-content-between py-2 border-bottom small flex-wrap gap-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="clinic-mono fw-semibold text-primary">{rx.rxNo}</span>
                        <StatusPill tone={rx.status === "ISSUED" ? "low" : rx.status === "DISPENSED" ? "normal" : "pending"} label={rx.status} />
                        {rx.isControlled ? <span className="badge bg-danger-subtle text-danger border border-danger-subtle">CONTROLLED</span> : null}
                        {rx.items && rx.items.length > 0 ? (
                          <span className="text-muted">
                            ({rx.items.map((i: any) => `${i.generic_name || i.genericName || ""} ${i.sig_dose || ""} x${i.qty_prescribed || ""}`).join(", ")})
                          </span>
                        ) : null}
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary py-0 px-2"
                          style={{ fontSize: "0.78rem" }}
                          onClick={() => setPrintModal({ open: true, tab: "RX" })}
                        >
                          🖨️ Print Rx
                        </button>
                        <Link
                          to={`/pharmacy/dispense/${rx.id}`}
                          className="btn btn-sm btn-outline-success py-0 px-2"
                          style={{ fontSize: "0.78rem" }}
                        >
                          Dispense in Pharmacy &rarr;
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── Laboratory Requests (LAB-T1) ─────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-bold">Laboratory Orders &amp; Requests</span>
                <span className="small text-muted ms-2">order → laboratory worklist</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary py-0 px-2"
                  style={{ fontSize: "0.8rem" }}
                  onClick={() => setPrintModal({ open: true, tab: "LAB" })}
                >
                  🖨️ Print Lab Requisition
                </button>
                <Link to="/laboratory/worklist" className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: "0.8rem" }}>
                  🔬 Lab Worklist &rarr;
                </Link>
              </div>
            </div>
            <div className="p-3">
              <div className="row g-2 mb-2">
                <div className="col-md-6">
                  <label className="form-label small" htmlFor="lab-test-select">Select Test / Panel *</label>
                  <select
                    id="lab-test-select"
                    className="form-select form-select-sm"
                    value={selectedTestId}
                    onChange={(e) => setSelectedTestId(e.target.value)}
                  >
                    <option value="">-- Choose lab test or panel --</option>
                    {availableTests.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code}) {t.is_panel ? "[Panel]" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="lab-priority">Priority *</label>
                  <select
                    id="lab-priority"
                    className="form-select form-select-sm"
                    value={labPriority}
                    onChange={(e) => setLabPriority(e.target.value as any)}
                  >
                    <option value="ROUTINE">ROUTINE</option>
                    <option value="URGENT">URGENT</option>
                    <option value="STAT">STAT</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="lab-notes">Clinical Indication</label>
                  <input
                    id="lab-notes"
                    className="form-control form-control-sm"
                    placeholder="e.g. Routine check"
                    value={labClinicalInfo}
                    onChange={(e) => setLabClinicalInfo(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-cerulean"
                disabled={!selectedTestId || labSubmitting}
                onClick={() => void createLabOrder()}
              >
                {labSubmitting ? "Submitting..." : "Order Lab Test"}
              </button>

              {labOrders.length > 0 ? (
                <div className="mt-3">
                  <div className="small fw-semibold text-muted mb-1">Laboratory orders for this encounter:</div>
                  {labOrders.map((ord) => (
                    <div key={ord.id} className="d-flex align-items-center justify-content-between py-2 border-bottom small flex-wrap gap-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="clinic-mono fw-semibold text-primary">{ord.orderNo || ord.order_no}</span>
                        <span className={`badge ${ord.priority === "STAT" ? "bg-danger" : ord.priority === "URGENT" ? "bg-warning text-dark" : "bg-secondary"}`}>
                          {ord.priority}
                        </span>
                        <StatusPill
                          tone={ord.status === "ORDERED" ? "pending" : ord.status === "VERIFIED" || ord.status === "RELEASED" ? "normal" : "low"}
                          label={ord.status}
                        />
                        <span className="text-muted">
                          {ord.items && ord.items.length > 0 ? ord.items.map((i: any) => i.test_name || i.name || i.test_code).join(", ") : "Ordered test"}
                        </span>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary py-0 px-2"
                          style={{ fontSize: "0.78rem" }}
                          onClick={() => setPrintModal({ open: true, tab: "LAB" })}
                        >
                          🖨️ Print Slip
                        </button>
                        <Link
                          to="/laboratory/worklist"
                          className="btn btn-sm btn-outline-primary py-0 px-2"
                          style={{ fontSize: "0.78rem" }}
                        >
                          View in Worklist &rarr;
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── Central Supply & Consumables (SUP-T10) ───────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-bold">Central Supply &amp; Consumables</span>
                <span className="small text-muted ms-2">supplies / materials used in encounter</span>
              </div>
              <Link to="/supply/issues" className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: "0.8rem" }}>
                📦 Supply Issues &rarr;
              </Link>
            </div>
            <div className="p-3">
              <div className="row g-2 mb-2">
                <div className="col-md-5">
                  <label className="form-label small" htmlFor="supply-item-select">Select Supply Item *</label>
                  <select
                    id="supply-item-select"
                    className="form-select form-select-sm"
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                  >
                    <option value="">-- Choose supply / consumable --</option>
                    {availableSupplyItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="supply-loc-select">Location / Room *</label>
                  <select
                    id="supply-loc-select"
                    className="form-select form-select-sm"
                    value={selectedLocationId}
                    onChange={(e) => setSelectedLocationId(e.target.value)}
                  >
                    <option value="">-- Choose location --</option>
                    {availableLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="supply-qty">Qty *</label>
                  <input
                    id="supply-qty"
                    type="number"
                    min="1"
                    className="form-control form-control-sm tabular"
                    value={supplyQty}
                    onChange={(e) => setSupplyQty(e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="supply-notes">Usage Note</label>
                  <input
                    id="supply-notes"
                    className="form-control form-control-sm"
                    placeholder="e.g. Dressing change"
                    value={supplyNotes}
                    onChange={(e) => setSupplyNotes(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-cerulean"
                disabled={!selectedItemId || supplySubmitting}
                onClick={() => void addSupplyConsumption()}
              >
                {supplySubmitting ? "Logging..." : "Log Supply Consumption"}
              </button>

              {supplies.length > 0 ? (
                <div className="mt-3">
                  <div className="small fw-semibold text-muted mb-1">Supplies consumed for this encounter:</div>
                  {supplies.map((s) => (
                    <div key={s.id} className="d-flex align-items-center justify-content-between py-2 border-bottom small flex-wrap gap-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="fw-medium text-dark">{s.itemName || s.item_name}</span>
                        {s.itemCode || s.item_code ? (
                          <span className="badge bg-light text-muted border clinic-mono">{s.itemCode || s.item_code}</span>
                        ) : null}
                        <span className="badge bg-secondary-subtle text-secondary">
                          Qty: {s.qty}
                        </span>
                        {s.locationName || s.location_name ? (
                          <span className="text-muted">· {s.locationName || s.location_name}</span>
                        ) : null}
                        {s.notes ? <span className="text-muted italic">({s.notes})</span> : null}
                      </div>
                      <Link
                        to="/supply/issues"
                        className="btn btn-sm btn-outline-secondary py-0 px-2"
                        style={{ fontSize: "0.78rem" }}
                      >
                        Supply Workbench &rarr;
                      </Link>
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

          {/* ── Medical Certificates (CLN-T8) ─────────────────────────────── */}
          <div className="clinic-card mb-4">
            <div className="clinic-card-header d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-bold">Medical Certificates</span>
                <span className="small text-muted ms-2">numbered, signed, printable</span>
              </div>
              <span className="small text-muted">{certificates.length} issued</span>
            </div>
            <div className="p-3">
              <div className="row g-2 mb-2">
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="cert-type">Certificate Type *</label>
                  <select
                    id="cert-type"
                    className="form-select form-select-sm"
                    value={certType}
                    onChange={(e) => setCertType(e.target.value as CertificateRow["cert_type"])}
                  >
                    <option value="FIT_TO_WORK">Fit to Work</option>
                    <option value="SICK_LEAVE">Sick Leave</option>
                    <option value="CLEARANCE">Medical Clearance</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="cert-valid-from">Valid From</label>
                  <input
                    id="cert-valid-from"
                    type="date"
                    className="form-control form-control-sm"
                    value={certValidFrom}
                    onChange={(e) => setCertValidFrom(e.target.value)}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="cert-valid-to">Valid To</label>
                  <input
                    id="cert-valid-to"
                    type="date"
                    className="form-control form-control-sm"
                    value={certValidTo}
                    onChange={(e) => setCertValidTo(e.target.value)}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label small" htmlFor="cert-findings">Findings</label>
                  <input
                    id="cert-findings"
                    className="form-control form-control-sm"
                    placeholder="e.g. Physically fit for employment"
                    value={certFindings}
                    onChange={(e) => setCertFindings(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-cerulean"
                disabled={certSubmitting}
                onClick={() => void issueCertificate()}
              >
                {certSubmitting ? "Issuing…" : "Issue Certificate"}
              </button>

              {certificates.length > 0 ? (
                <div className="mt-3">
                  <div className="small fw-semibold text-muted mb-1">Issued for this encounter:</div>
                  {certificates.map((cert) => (
                    <div key={cert.id} className="d-flex align-items-center justify-content-between py-2 border-bottom small flex-wrap gap-2">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="fw-medium text-dark clinic-mono">{cert.doc_no}</span>
                        <span className="badge bg-light text-muted border">
                          {cert.cert_type === "FIT_TO_WORK" ? "Fit to Work" : cert.cert_type === "SICK_LEAVE" ? "Sick Leave" : "Clearance"}
                        </span>
                        {cert.voided_at ? (
                          <span className="badge bg-secondary-subtle text-secondary">Voided</span>
                        ) : (
                          <span className="badge bg-success-subtle text-success">Valid</span>
                        )}
                        {cert.valid_from ? <span className="text-muted">· from {String(cert.valid_from).slice(0, 10)}</span> : null}
                        {cert.valid_to ? <span className="text-muted">to {String(cert.valid_to).slice(0, 10)}</span> : null}
                        {cert.findings ? <span className="text-muted italic">({cert.findings})</span> : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary py-0 px-2"
                        style={{ fontSize: "0.78rem" }}
                        disabled={certPrintingId === cert.id}
                        onClick={() => void printCertificatePdf(cert)}
                      >
                        {certPrintingId === cert.id ? "Preparing…" : "🖨️ Print PDF"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small text-muted mb-0 mt-3">No certificates issued for this visit.</p>
              )}
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

      {/* Printable Doctor's Prescription & Orders Modal */}
      {printModal?.open ? (
        <PrescriptionPrintModal
          isOpen={true}
          onClose={() => setPrintModal(null)}
          defaultTab={printModal.tab}
          visit={visit as any}
          vitals={vitals}
          diagnoses={diagnoses}
          notes={notes}
          prescriptions={prescriptions as any}
          labOrders={labOrders as any}
          allergies={visit.allergies || []}
          practitionerName={visit.practitionerName}
        />
      ) : null}
    </div>
  );
}

function problemCopy(err: unknown): string {
  if (err instanceof ApiError) return err.problem.detail ?? err.problem.title ?? err.problem.code;
  return "The request could not be completed.";
}
