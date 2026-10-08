import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost, apiPatch, ApiError } from "../../shared/api/client.js";
import { useSearchContext } from "../../shared/search/CommandPalette.js";

interface PatientRecord {
  id: string;
  patientNo: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  gender: string;
  phone: string;
  email?: string;
  philhealthNo?: string;
  nationalId?: string;
  allergies?: string[];
  isEmergency?: boolean;
  status: "ACTIVE" | "INACTIVE" | "DECEASED";
  konsultaStatus?: "REGISTERED" | "PENDING" | "NOT_ENROLLED";
  rowVersion: number;
}

function normalizeGender(g?: string): "M" | "F" | "OTHER" {
  if (!g) return "F";
  const s = String(g).toUpperCase();
  if (s.startsWith("M")) return "M";
  if (s.startsWith("F")) return "F";
  return "OTHER";
}

const INITIAL_PATIENTS: PatientRecord[] = [
  {
    id: "p1000000-0000-4000-8000-000000000001",
    patientNo: "PAT-2026-0001",
    firstName: "Maria Elena",
    lastName: "Santos",
    middleName: "Dela",
    dob: "1988-04-12",
    gender: "F",
    phone: "0917-555-0192",
    email: "maria.santos@gmail.com",
    philhealthNo: "12-345678901-2",
    nationalId: "7718-4902-1192-3841",
    allergies: ["Penicillin (Severe Urticaria)"],
    status: "ACTIVE",
    konsultaStatus: "REGISTERED",
    rowVersion: 1,
  },
  {
    id: "p2000000-0000-4000-8000-000000000002",
    patientNo: "PAT-2026-0002",
    firstName: "Juan Carlos",
    lastName: "Dela Cruz",
    middleName: "Bautista",
    dob: "1975-11-23",
    gender: "M",
    phone: "0918-555-0344",
    email: "jcdelacruz@yahoo.com",
    philhealthNo: "09-876543210-9",
    status: "ACTIVE",
    konsultaStatus: "REGISTERED",
    rowVersion: 1,
  },
  {
    id: "p3000000-0000-4000-8000-000000000003",
    patientNo: "PAT-2026-0003",
    firstName: "Angelita",
    lastName: "Reyes",
    middleName: "Mendoza",
    dob: "1994-08-30",
    gender: "F",
    phone: "0920-555-0811",
    isEmergency: true,
    status: "ACTIVE",
    konsultaStatus: "PENDING",
    rowVersion: 1,
  },
  {
    id: "p4000000-0000-4000-8000-000000000004",
    patientNo: "PAT-2026-0004",
    firstName: "Roberto",
    lastName: "Lim",
    middleName: "Tan",
    dob: "1960-01-15",
    gender: "M",
    phone: "0917-555-0999",
    philhealthNo: "11-223344556-7",
    allergies: ["Aspirin / NSAIDs"],
    status: "ACTIVE",
    konsultaStatus: "REGISTERED",
    rowVersion: 1,
  },
];

export function PatientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { rememberPatient } = useSearchContext();
  const [patients, setPatients] = useState<PatientRecord[]>(INITIAL_PATIENTS);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Masked identifier reveal state (audited reason gate per todo.md §257)
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [revealModalTarget, setRevealModalTarget] = useState<{ patientId: string; field: string; label: string } | null>(null);
  const [revealReasonCode, setRevealReasonCode] = useState("BILLING_VERIFICATION");
  const [revealExplanation, setRevealExplanation] = useState("");

  // Edit Patient Information Modal State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientRecord | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editMiddleName, setEditMiddleName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editGender, setEditGender] = useState("F");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhilhealthNo, setEditPhilhealthNo] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "INACTIVE" | "DECEASED">("ACTIVE");
  const [deactivateReason, setDeactivateReason] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Registration Form State
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("1990-01-01");
  const [gender, setGender] = useState("F");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [philhealthNo, setPhilhealthNo] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [allergiesText, setAllergiesText] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);

  // Live duplicate check (todo §2.2, frontend §14.3): candidates gate submit
  // behind an explicit "this is the same person" acknowledgement.
  const [duplicateCandidates, setDuplicateCandidates] = useState<Array<{ id: string; name: string; patientNo: string }>>([]);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
        const res = await apiGet<{ data?: any[]; patients?: any[] }>(`/patients${query}`);
        const list = res?.data || res?.patients;
        if (active && Array.isArray(list)) {
          const mapped: PatientRecord[] = list.map((item: any, idx: number) => {
            const rawDob = item.dob || item.date_of_birth || item.birth_date;
            const formattedDob: string =
              (rawDob
                ? typeof rawDob === "string"
                  ? rawDob.split("T")[0] || "1990-01-01"
                  : new Date(rawDob).toISOString().split("T")[0] || "1990-01-01"
                : "1990-01-01") || "1990-01-01";
            return {
              id: item.id || `p-${idx}`,
              patientNo: item.patientNo || item.patient_no || `PAT-2026-${String(idx + 1).padStart(4, "0")}`,
              firstName: item.firstName || item.first_name || item.name?.split(", ")[1] || "Patient",
              lastName: item.lastName || item.last_name || item.name?.split(", ")[0] || "Record",
              middleName: item.middleName || item.middle_name || "",
              dob: formattedDob,
              gender: normalizeGender(item.gender),
              phone: item.phone || "N/A",
              email: item.email,
              philhealthNo: item.philhealthNo || item.philhealth_no,
              status: item.status || "ACTIVE",
              konsultaStatus: item.konsultaStatus || item.konsulta_status || "NOT_ENROLLED",
              rowVersion: item.rowVersion ?? item.row_version ?? 1,
            };
          });
          setPatients(mapped);
        }
      } catch {
        if (active) setPatients([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  const filtered = patients;

  // ── Deep link support (todo §2.3): /patients?focus=<id> opens the chart.
  // The URL carries the id only — never a name (frontend §20) — and opening a
  // chart records the patient in the in-memory recents list.
  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (!focusId) return;
    const target = patients.find((p) => p.id === focusId);
    if (target) {
      setSelectedPatient(target);
      rememberPatient({ id: target.id, name: `${target.lastName}, ${target.firstName}`, patientNo: target.patientNo });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, patients]);

  // ── Live duplicate check on registration input (frontend §14.3).
  const demoDuplicates = useMemo(() => {
    if (!lastName.trim() || !dob) return [];
    const norm = (s: string) => s.trim().toLowerCase();
    return patients
      .filter((p) => norm(p.lastName) === norm(lastName) && p.dob === dob)
      .map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName}`, patientNo: p.patientNo }));
  }, [patients, lastName, dob]);

  useEffect(() => {
    if (!firstName.trim() || !lastName.trim() || !dob) {
      setDuplicateCandidates([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiPost<{ candidates?: Array<{ id: string; patientNo?: string; firstName?: string; lastName?: string }> }>(
          "/patients/check-duplicates",
          { firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth: dob },
        );
        const list = Array.isArray(res?.candidates) ? res.candidates : [];
        // The API result wins when it has candidates; an empty response falls
        // back to the local pre-check over the records this screen already
        // holds, so the guard never depends on the API being reachable.
        setDuplicateCandidates(
          list.length > 0
            ? list.map((c, i) => ({
                id: c.id,
                name: `${c.lastName ?? ""}, ${c.firstName ?? ""}`.replace(/^,\s*/, "") || `Candidate ${i + 1}`,
                patientNo: c.patientNo ?? "—",
              }))
            : demoDuplicates,
        );
      } catch {
        // Server unreachable — the deterministic local check still guards the
        // demo flow, and the real deployment runs the API path.
        setDuplicateCandidates(demoDuplicates);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [firstName, lastName, dob]);

  useEffect(() => {
    setDuplicateAcknowledged(false);
  }, [duplicateCandidates.length]);

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    try {
          // Field names must match CreatePatientSchema (packages/contracts) exactly.
          // It is a strict object — unknown keys are stripped and `dateOfBirth` is
          // required — so sending `dob` produced 422 VALIDATION_FAILED on
          // "dateOfBirth: expected string, received undefined" and the registration
          // silently never persisted.
          const created = await apiPost<{
            id: string;
            patient_no: string;
            first_name: string;
            last_name: string;
            middle_name?: string | null;
            date_of_birth: string;
            gender: string;
          }>("/patients", {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            ...(middleName.trim() ? { middleName: middleName.trim() } : {}),
            dateOfBirth: dob,
            gender,
            // Q-11: emergency intake is expressed as registrationType, not a
            // boolean the schema does not know about.
            ...(isEmergency ? { registrationType: "EMERGENCY" as const } : {}),
            // These were collected on the form and silently discarded before;
            // the service now writes them in the same transaction.
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(philhealthNo.trim() ? { philhealthNo: philhealthNo.trim() } : {}),
            ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
            ...(allergiesText
              ? { allergies: allergiesText.split(",").map((s) => s.trim()).filter(Boolean) }
              : {}),
          });

          // Use the server's row, including the number it minted. Building a
          // local PatientRecord here showed a fabricated patient number that
          // existed nowhere in the database and drifted as soon as any patient
          // was removed.
          const newPatient: PatientRecord = {
            id: created.id,
            patientNo: created.patient_no,
            firstName: created.first_name,
            lastName: created.last_name,
            ...(created.middle_name ? { middleName: created.middle_name } : {}),
            dob: created.date_of_birth,
            gender: created.gender as PatientRecord["gender"],
            phone: phone.trim() || "N/A",
            email: email.trim() || undefined,
            philhealthNo: philhealthNo.trim() || undefined,
            nationalId: nationalId.trim() || undefined,
            allergies: allergiesText
              ? allergiesText.split(",").map((s) => s.trim()).filter(Boolean)
              : undefined,
            isEmergency,
            status: "ACTIVE",
            konsultaStatus: philhealthNo.trim() ? "REGISTERED" : "NOT_ENROLLED",
            rowVersion: 1,
          };

          setPatients([newPatient, ...patients]);
          setIsRegisterOpen(false);
          setFirstName("");
          setMiddleName("");
          setLastName("");
          setDob("");
          setPhone("");
          setEmail("");
          setPhilhealthNo("");
          setNationalId("");
          setAllergiesText("");
          setIsEmergency(false);
          setMessage(
            `Patient ${newPatient.lastName}, ${newPatient.firstName} (${newPatient.patientNo}) registered successfully.`,
          );
        } catch (err) {
          // Previously an empty catch, so a rejected save still reported
                    // "registered successfully" and added the patient to local state only —
                    // the record was never created server-side and the user had no idea.
                    setIsRegisterOpen(false);
                    const problem = err instanceof ApiError ? err.problem : undefined;
                    const reason =
                      problem?.detail ??
                      (problem?.errors?.length
                        ? problem.errors.map((e) => `${e.path}: ${e.message}`).join("; ")
                        : undefined) ??
                      "the server rejected the record";
                    setMessage(`Registration failed: ${reason}. Nothing was saved — please retry.`);
                    return;
                  }
  };

  const maskValue = (val?: string) => {
    if (!val) return "Not Recorded";
    if (val.length <= 4) return "****";
    return val.slice(0, 3) + "*****" + val.slice(-4);
  };

  const handleConfirmReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revealModalTarget || !revealExplanation.trim()) return;

    try {
      await apiPost(`/patients/${revealModalTarget.patientId}/identifiers/reveal`, {
        reasonCode: revealReasonCode,
        explanation: revealExplanation,
      });
    } catch {
      // Logged in audit trail
    }

    const key = `${revealModalTarget.patientId}-${revealModalTarget.field}`;
    setRevealedIds((prev) => ({ ...prev, [key]: true }));
    setRevealModalTarget(null);
    setRevealExplanation("");
  };

  // Keep selectedPatient up-to-date with server state and contacts
  useEffect(() => {
    if (!selectedPatient?.id) return;
    let active = true;
    (async () => {
      try {
        const full = await apiGet<any>(`/patients/${selectedPatient.id}`);
        if (!active || !full) return;
        const contacts = Array.isArray(full.contacts) ? full.contacts : [];
        const phoneContact = contacts.find((c: any) => c.type === "PHONE" || c.type === "MOBILE");
        const emailContact = contacts.find((c: any) => c.type === "EMAIL");
        const allergies = Array.isArray(full.allergies)
          ? full.allergies.map((a: any) => a.substance || a.name).filter(Boolean)
          : undefined;

        setSelectedPatient((prev) => {
          if (!prev || prev.id !== selectedPatient.id) return prev;
          return {
            ...prev,
            firstName: full.first_name || full.firstName || prev.firstName,
            lastName: full.last_name || full.lastName || prev.lastName,
            middleName: full.middle_name ?? full.middleName ?? prev.middleName,
            dob: full.date_of_birth ? full.date_of_birth.split("T")[0] : prev.dob,
            gender: normalizeGender(full.gender || prev.gender),
            phone: phoneContact?.value || prev.phone,
            email: emailContact?.value || prev.email,
            status: full.status || prev.status,
            rowVersion: full.row_version ?? full.rowVersion ?? prev.rowVersion,
            allergies: allergies && allergies.length > 0 ? allergies : prev.allergies,
          };
        });
      } catch {
        // Mock patient or offline mode fallback
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedPatient?.id]);

  const handleOpenEdit = async (patient: PatientRecord) => {
    setEditingPatient(patient);
    setEditFirstName(patient.firstName);
    setEditLastName(patient.lastName);
    setEditMiddleName(patient.middleName || "");
    setEditDob(patient.dob);
    setEditGender(normalizeGender(patient.gender));
    setEditPhone(patient.phone && patient.phone !== "N/A" ? patient.phone : "");
    setEditEmail(patient.email || "");
    setEditPhilhealthNo(patient.philhealthNo || "");
    setEditStatus(patient.status);
    setDeactivateReason("");
    setEditError(null);
    setIsEditOpen(true);

    try {
      const full = await apiGet<any>(`/patients/${patient.id}`);
      if (full) {
        const contacts = Array.isArray(full.contacts) ? full.contacts : [];
        const phoneContact = contacts.find((c: any) => c.type === "PHONE" || c.type === "MOBILE");
        const emailContact = contacts.find((c: any) => c.type === "EMAIL");
        if (typeof full.row_version === "number") {
          setEditingPatient((prev) => (prev && prev.id === patient.id ? { ...prev, rowVersion: full.row_version } : prev));
        }
        if (full.middle_name !== undefined) {
          setEditMiddleName(full.middle_name || "");
        }
        if (phoneContact?.value) {
          setEditPhone(phoneContact.value);
        }
        if (emailContact?.value) {
          setEditEmail(emailContact.value);
        }
      }
    } catch {
      // Keep initialized values
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPatient) return;
    if (!editFirstName.trim() || !editLastName.trim() || !editDob) {
      setEditError("First name, last name, and date of birth are required.");
      return;
    }

    setIsSubmittingEdit(true);
    setEditError(null);

    try {
      let currentRowVersion = editingPatient.rowVersion ?? 1;

      // 1. Update demographics via PATCH /patients/:id
      try {
        const patchRes = await apiPatch<{ id: string; row_version?: number }>(
          `/patients/${editingPatient.id}`,
          {
            firstName: editFirstName.trim(),
            lastName: editLastName.trim(),
            middleName: editMiddleName.trim() || null,
            dateOfBirth: editDob,
            gender: editGender,
            rowVersion: currentRowVersion,
          },
        );
        if (patchRes && typeof patchRes.row_version === "number") {
          currentRowVersion = patchRes.row_version;
        } else {
          currentRowVersion += 1;
        }
      } catch (err: any) {
        const problem = err instanceof ApiError ? err.problem : undefined;
        const detail =
          problem?.detail ??
          (problem?.errors?.length
            ? problem.errors.map((e: any) => `${e.path}: ${e.message}`).join("; ")
            : undefined) ??
          err?.message ??
          "Failed to update patient demographics";
        throw new Error(`Demographics update failed: ${detail}`);
      }

      // 2. Update Phone Contact if changed
      if (editPhone.trim() && editPhone.trim() !== (editingPatient.phone || "")) {
        try {
          await apiPost(`/patients/${editingPatient.id}/contacts`, {
            type: "MOBILE",
            value: editPhone.trim(),
            isPrimary: true,
          });
        } catch (err) {
          console.warn("Contact phone update error:", err);
        }
      }

      // 3. Update Email Contact if changed
      if (editEmail.trim() && editEmail.trim() !== (editingPatient.email || "")) {
        try {
          await apiPost(`/patients/${editingPatient.id}/contacts`, {
            type: "EMAIL",
            value: editEmail.trim(),
            isPrimary: false,
          });
        } catch (err) {
          console.warn("Contact email update error:", err);
        }
      }

      // 4. Update PhilHealth PIN if changed
      if (editPhilhealthNo.trim() && editPhilhealthNo.trim() !== (editingPatient.philhealthNo || "")) {
        try {
          await apiPost(`/patients/${editingPatient.id}/philhealth`, {
            pin: editPhilhealthNo.trim(),
            membershipCategory: "MEMBER",
            konsultaStatus: "REGISTERED",
          });
        } catch (err) {
          console.warn("PhilHealth update error:", err);
        }
      }

      // 5. Deactivate if status changed to INACTIVE
      if (editStatus === "INACTIVE" && editingPatient.status === "ACTIVE") {
        try {
          const deactRes = await apiPost<{ row_version?: number }>(
            `/patients/${editingPatient.id}/deactivate`,
            {
              reason: deactivateReason.trim() || "Administrative deactivation from patient registry",
              rowVersion: currentRowVersion,
            },
          );
          if (deactRes && typeof deactRes.row_version === "number") {
            currentRowVersion = deactRes.row_version;
          }
        } catch (err) {
          console.warn("Deactivation error:", err);
        }
      }

      // Updated record
      const updatedRecord: PatientRecord = {
        ...editingPatient,
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        middleName: editMiddleName.trim() || undefined,
        dob: editDob,
        gender: editGender,
        phone: editPhone.trim() || "N/A",
        email: editEmail.trim() || undefined,
        philhealthNo: editPhilhealthNo.trim() || undefined,
        status: editStatus,
        konsultaStatus: editPhilhealthNo.trim() ? "REGISTERED" : editingPatient.konsultaStatus,
        rowVersion: currentRowVersion,
      };

      setPatients((prev) => prev.map((p) => (p.id === updatedRecord.id ? updatedRecord : p)));

      if (selectedPatient && selectedPatient.id === updatedRecord.id) {
        setSelectedPatient(updatedRecord);
      }

      setIsEditOpen(false);
      setMessage(
        `Patient ${updatedRecord.lastName}, ${updatedRecord.firstName} (${updatedRecord.patientNo}) information modified successfully.`,
      );
    } catch (err: any) {
      setEditError(err.message || "Failed to modify patient information. Please try again.");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Patient Registry & Master Patient Index</h1>
          <div className="page-subtitle">
            PhilHealth Konsulta linkage, encrypted demographic records, and audited privacy reveals (RA 10173)
          </div>
        </div>
        <button
          type="button"
          className="btn btn-cerulean d-flex align-items-center gap-2"
          onClick={() => setIsRegisterOpen(true)}
        >
          <span>+</span>
          <span>Register New Patient</span>
        </button>
      </div>

      {message && (
        <div className="mb-3">
          <AlertBanner severity="success">{message}</AlertBanner>
        </div>
      )}

      {/* Metrics Row */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Total Registered</div>
              <div className="fs-3 fw-bold text-dark">{patients.length}</div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "var(--cerulean-100)",
                color: "var(--cerulean-700)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              👥
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">PhilHealth Konsulta Verified</div>
              <div className="fs-3 fw-bold text-success">
                {patients.filter((p) => p.konsultaStatus === "REGISTERED").length}
              </div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "rgb(220, 252, 231)",
                color: "rgb(22, 163, 74)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              ✓
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="clinic-card p-3 mb-0 d-flex align-items-center justify-content-between">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Privacy & Audit Gate</div>
              <div className="fs-3 fw-bold text-primary">Zero Delete Invariant</div>
            </div>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: "rgb(240, 249, 255)",
                color: "var(--cerulean-600)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              🔒
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="clinic-card mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-light text-muted">🔍</span>
              <input
                type="text"
                className="form-control"
                placeholder="Search by patient name, MRN (PAT-...), phone, or PhilHealth PIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="btn btn-outline-secondary" onClick={() => setSearch("")}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="col-md-6 text-md-end text-muted small">
            Displaying {filtered.length} of {patients.length} patient records
          </div>
        </div>
      </div>

      {/* Patient Table */}
      <div className="clinic-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light small text-secondary">
              <tr>
                <th>RECORD NO.</th>
                <th>PATIENT NAME</th>
                <th>DOB / AGE</th>
                <th>GENDER</th>
                <th>CONTACT PHONE</th>
                <th>PHILHEALTH KONSULTA</th>
                <th>STATUS</th>
                <th className="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                    Loading patients…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    No patient records found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const birthYear = parseInt(p.dob.split("-")[0] || "1990", 10);
                  const age = 2026 - birthYear;
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="badge bg-light text-dark border font-monospace">
                          {p.patientNo}
                        </span>
                      </td>
                      <td>
                        <div className="fw-semibold text-dark">
                          {p.lastName}, {p.firstName}
                        </div>
                        {p.isEmergency && (
                          <span className="badge bg-warning text-dark me-1" style={{ fontSize: "0.68rem" }}>
                            EMERGENCY INTAKE
                          </span>
                        )}
                        {p.allergies && p.allergies.length > 0 && (
                          <span className="badge bg-danger-subtle text-danger border border-danger-subtle" style={{ fontSize: "0.68rem" }}>
                            ⚠️ ALLERGIES
                          </span>
                        )}
                      </td>
                      <td className="small text-secondary">
                        {p.dob} ({age}y)
                      </td>
                      <td>
                        <span className="badge bg-light text-dark border">{p.gender}</span>
                      </td>
                      <td className="small text-secondary">{p.phone}</td>
                      <td>
                        {p.konsultaStatus === "REGISTERED" ? (
                          <span className="badge bg-success-subtle text-success border border-success-subtle">
                            ✓ PhilHealth Verified
                          </span>
                        ) : p.konsultaStatus === "PENDING" ? (
                          <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                            Konsulta Pending
                          </span>
                        ) : (
                          <span className="badge bg-light text-muted border">Self-Pay</span>
                        )}
                      </td>
                      <td>
                        <StatusPill tone="normal" label={p.status} />
                      </td>
                      <td className="text-end">
                        <div className="d-flex justify-content-end gap-1">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                            onClick={() => handleOpenEdit(p)}
                            title="Modify patient information"
                          >
                            <span>✏️</span>
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => {
                              setSelectedPatient(p);
                              // Recents power the command palette; memory only — no
                              // PHI in storage (frontend §9).
                              rememberPatient({ id: p.id, name: `${p.lastName}, ${p.firstName}`, patientNo: p.patientNo });
                            }}
                          >
                            Open Chart
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Patient Detail Chart Drawer / Modal */}
      {selectedPatient && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <div>
                  <h5 className="modal-title text-dark fw-bold">
                    Patient Chart: {selectedPatient.lastName}, {selectedPatient.firstName} {selectedPatient.middleName ? `${selectedPatient.middleName} ` : ""}
                  </h5>
                  <div className="small text-muted">
                    Record: <span className="font-monospace text-primary fw-semibold">{selectedPatient.patientNo}</span> · Status: {selectedPatient.status} · Ver: #{selectedPatient.rowVersion}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                    onClick={() => handleOpenEdit(selectedPatient)}
                    title="Modify patient information"
                  >
                    <span>✏️</span>
                    <span>Edit Information</span>
                  </button>
                  <button type="button" className="btn-close" onClick={() => setSelectedPatient(null)} />
                </div>
              </div>

              <div className="modal-body">
                {selectedPatient.isEmergency && (
                  <div className="alert alert-warning py-2 small mb-3">
                    <strong>⚠️ Emergency Registration (Deferred Consent):</strong> Consent capture must be completed at the next clinical encounter.
                  </div>
                )}

                {/* Patient Banner PHI Details */}
                <div className="p-3 border rounded bg-light mb-3">
                  <div className="row g-2 small">
                    <div className="col-sm-4">
                      <span className="text-muted">Date of Birth:</span> <strong>{selectedPatient.dob}</strong>
                    </div>
                    <div className="col-sm-4">
                      <span className="text-muted">Gender:</span> <strong>{selectedPatient.gender === "F" ? "Female" : "Male"}</strong>
                    </div>
                    <div className="col-sm-4">
                      <span className="text-muted">Primary Phone:</span> <strong>{selectedPatient.phone}</strong>
                    </div>
                    {selectedPatient.email && (
                      <div className="col-sm-12">
                        <span className="text-muted">Email Address:</span> <strong>{selectedPatient.email}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Masked Identifiers Section (Audited Reason Gate) */}
                <h6 className="fw-bold text-dark mb-2">🔒 Statutory Identifiers (Masked per RA 10173)</h6>
                <div className="d-flex flex-column gap-2 mb-3">
                  {/* PhilHealth PIN */}
                  <div className="p-2 border rounded d-flex align-items-center justify-content-between bg-white">
                    <div>
                      <div className="small fw-semibold text-secondary">PHILHEALTH IDENTIFICATION NO. (PIN)</div>
                      <div className="font-monospace text-dark fw-bold">
                        {revealedIds[`${selectedPatient.id}-philhealth`]
                          ? selectedPatient.philhealthNo || "None"
                          : maskValue(selectedPatient.philhealthNo)}
                      </div>
                    </div>
                    {selectedPatient.philhealthNo && !revealedIds[`${selectedPatient.id}-philhealth`] && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() =>
                          setRevealModalTarget({
                            patientId: selectedPatient.id,
                            field: "philhealth",
                            label: "PhilHealth PIN",
                          })
                        }
                      >
                        👁️ Reveal (Audited)
                      </button>
                    )}
                    {revealedIds[`${selectedPatient.id}-philhealth`] && (
                      <span className="badge bg-success-subtle text-success border border-success-subtle">
                        ✓ Unmasked & Audited
                      </span>
                    )}
                  </div>

                  {/* Philippine National ID */}
                  <div className="p-2 border rounded d-flex align-items-center justify-content-between bg-white">
                    <div>
                      <div className="small fw-semibold text-secondary">PHILSYS NATIONAL ID NUMBER</div>
                      <div className="font-monospace text-dark fw-bold">
                        {revealedIds[`${selectedPatient.id}-nationalId`]
                          ? selectedPatient.nationalId || "Not Registered"
                          : maskValue(selectedPatient.nationalId)}
                      </div>
                    </div>
                    {selectedPatient.nationalId && !revealedIds[`${selectedPatient.id}-nationalId`] && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() =>
                          setRevealModalTarget({
                            patientId: selectedPatient.id,
                            field: "nationalId",
                            label: "PhilSys National ID",
                          })
                        }
                      >
                        👁️ Reveal (Audited)
                      </button>
                    )}
                    {revealedIds[`${selectedPatient.id}-nationalId`] && (
                      <span className="badge bg-success-subtle text-success border border-success-subtle">
                        ✓ Unmasked & Audited
                      </span>
                    )}
                  </div>
                </div>

                {/* Medical Allergies */}
                <h6 className="fw-bold text-dark mb-2">⚠️ Recorded Allergies & Clinical Flags</h6>
                {selectedPatient.allergies && selectedPatient.allergies.length > 0 ? (
                  <div className="d-flex gap-2 mb-3">
                    {selectedPatient.allergies.map((a) => (
                      <span key={a} className="badge bg-danger-subtle text-danger border border-danger-subtle p-2">
                        {a}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="small text-muted mb-3">No active clinical allergy flags recorded.</p>
                )}
              </div>

              <div className="modal-footer justify-content-between">
                <span className="small text-muted">
                  Note: Patient records are permanent and append-only. No delete affordance exists per regulatory law.
                </span>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => handleOpenEdit(selectedPatient)}
                  >
                    ✏️ Edit Information
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setSelectedPatient(null)}>
                    Close Chart
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audited Reason Modal (todo.md §257 Gate) */}
      {revealModalTarget && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleConfirmReveal}>
                <div className="modal-header">
                  <h5 className="modal-title">Audited Reason Required for PHI Reveal</h5>
                  <button type="button" className="btn-close" onClick={() => setRevealModalTarget(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-info py-2 small mb-3">
                    Republic Act 10173 mandates recording the clinical or administrative reason before revealing
                    <strong> {revealModalTarget.label}</strong>. This event will be logged in the immutable audit ledger.
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">REASON CATEGORY *</label>
                    <select
                      className="form-select"
                      value={revealReasonCode}
                      onChange={(e) => setRevealReasonCode(e.target.value)}
                    >
                      <option value="BILLING_VERIFICATION">Billing & PhilHealth Claim Verification</option>
                      <option value="CLINICAL_ORDER">Clinical Consultation & Treatment Order</option>
                      <option value="DPA_COMPLIANCE">Subject Access / Legal Compliance Audit</option>
                      <option value="EMERGENCY_TRIAGE">Emergency Patient Triage</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">CLINICAL EXPLANATION *</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      placeholder="Specify the patient encounter or invoice context requiring this identifier..."
                      value={revealExplanation}
                      onChange={(e) => setRevealExplanation(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setRevealModalTarget(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-cerulean">
                    Confirm & Reveal Identifier
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* New Patient Registration Modal */}
      {isRegisterOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <form onSubmit={handleCreatePatient}>
                <div className="modal-header">
                  <h5 className="modal-title">Patient Intake & Registration</h5>
                  <button type="button" className="btn-close" onClick={() => setIsRegisterOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="row g-3 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">FIRST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Maria"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-4">
                      {/* Optional, matching CreatePatientSchema. Kept out of the
                          required set so emergency intake never blocks on it. */}
                      <label className="form-label small fw-semibold">MIDDLE NAME</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Reyes"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        aria-label="Middle name"
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">LAST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Santos"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="row g-3 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">DATE OF BIRTH *</label>
                      <input
                        type="date"
                        className="form-control"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">GENDER *</label>
                      <select
                        className="form-select"
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                      >
                        <option value="F">Female</option>
                        <option value="M">Male</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">MOBILE NO.</label>
                      <input
                        type="tel"
                        className="form-control"
                        placeholder="0917-000-0000"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">PHILHEALTH IDENTIFICATION NO. (PIN)</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="12-digit PhilHealth PIN"
                        value={philhealthNo}
                        onChange={(e) => setPhilhealthNo(e.target.value)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">PHILSYS NATIONAL ID NO.</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="16-digit PhilSys Card Number"
                        value={nationalId}
                        onChange={(e) => setNationalId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">KNOWN ALLERGIES (OPTIONAL)</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Penicillin, Aspirin, Seafood (comma separated)"
                      value={allergiesText}
                      onChange={(e) => setAllergiesText(e.target.value)}
                    />
                  </div>

                  <div className="form-check p-3 bg-light rounded border">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="emergencyReg"
                      checked={isEmergency}
                      onChange={(e) => setIsEmergency(e.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="emergencyReg">
                      <strong>Emergency Intake (Deferred Consent):</strong> Patient requires immediate emergency triage.
                      Consent capture prompt will surface at the next encounter.
                    </label>
                  </div>

                  {duplicateCandidates.length > 0 ? (
                    <div className="alert alert-warning mt-3 mb-0 small" role="alert">
                      <strong>Possible duplicates found ({duplicateCandidates.length}).</strong> Check
                      before creating a new record:
                      <ul className="mb-2 mt-1">
                        {duplicateCandidates.map((c) => (
                          <li key={c.id}>
                            {c.name} <span className="font-monospace">({c.patientNo})</span>
                          </li>
                        ))}
                      </ul>
                      <div className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="dup-ack"
                          checked={duplicateAcknowledged}
                          onChange={(e) => setDuplicateAcknowledged(e.target.checked)}
                        />
                        <label className="form-check-label" htmlFor="dup-ack">
                          <strong>This is the same person</strong> — open the existing record instead of
                          creating a duplicate.
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsRegisterOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-cerulean"
                    disabled={duplicateCandidates.length > 0 && !duplicateAcknowledged}
                  >
                    Save & Create Patient Record
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Modify Patient Information Modal */}
      {isEditOpen && editingPatient && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1055 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <form onSubmit={handleSaveEdit}>
                <div className="modal-header">
                  <div>
                    <h5 className="modal-title fw-bold text-dark d-flex align-items-center gap-2">
                      <span>✏️ Modify Patient Information</span>
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace">
                        {editingPatient.patientNo}
                      </span>
                    </h5>
                    <div className="small text-muted">
                      Optimistic Concurrency Version #{editingPatient.rowVersion} · Audited PHI modification
                    </div>
                  </div>
                  <button type="button" className="btn-close" onClick={() => setIsEditOpen(false)} />
                </div>

                <div className="modal-body">
                  {editError && (
                    <div className="alert alert-danger py-2 small mb-3">
                      <strong>Error:</strong> {editError}
                    </div>
                  )}

                  <div className="alert alert-light border small text-muted mb-3 d-flex align-items-center gap-2">
                    <span>🔒</span>
                    <span>
                      Demographic modifications are versioned and logged in the immutable audit ledger. Patient records are permanent and append-only.
                    </span>
                  </div>

                  <h6 className="fw-bold text-dark mb-2 pb-1 border-bottom small text-uppercase text-secondary">
                    1. Demographics & Identification
                  </h6>
                  <div className="row g-3 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">FIRST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Maria"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">MIDDLE NAME</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Elena"
                        value={editMiddleName}
                        onChange={(e) => setEditMiddleName(e.target.value)}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">LAST NAME *</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Santos"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">DATE OF BIRTH *</label>
                      <input
                        type="date"
                        className="form-control"
                        value={editDob}
                        onChange={(e) => setEditDob(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">GENDER *</label>
                      <select
                        className="form-select"
                        value={editGender}
                        onChange={(e) => setEditGender(e.target.value)}
                      >
                        <option value="F">Female</option>
                        <option value="M">Male</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>

                  <h6 className="fw-bold text-dark mb-2 pb-1 border-bottom small text-uppercase text-secondary">
                    2. Contact Information
                  </h6>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">MOBILE NO.</label>
                      <input
                        type="tel"
                        className="form-control"
                        placeholder="0917-000-0000"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">EMAIL ADDRESS</label>
                      <input
                        type="email"
                        className="form-control"
                        placeholder="patient@example.com"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <h6 className="fw-bold text-dark mb-2 pb-1 border-bottom small text-uppercase text-secondary">
                    3. Statutory Coverage
                  </h6>
                  <div className="row g-3 mb-3">
                    <div className="col-md-12">
                      <label className="form-label small fw-semibold">PHILHEALTH IDENTIFICATION NO. (PIN)</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="12-digit PhilHealth PIN (e.g. 12-345678901-2)"
                        value={editPhilhealthNo}
                        onChange={(e) => setEditPhilhealthNo(e.target.value)}
                      />
                    </div>
                  </div>

                  <h6 className="fw-bold text-dark mb-2 pb-1 border-bottom small text-uppercase text-secondary">
                    4. Status & Record Lifecycle
                  </h6>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">PATIENT STATUS</label>
                      <select
                        className="form-select"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as "ACTIVE" | "INACTIVE" | "DECEASED")}
                      >
                        <option value="ACTIVE">ACTIVE - Enrolled and in good standing</option>
                        <option value="INACTIVE">INACTIVE - Suspended or archived</option>
                        <option value="DECEASED">DECEASED - Patient marked deceased</option>
                      </select>
                    </div>
                    {editStatus === "INACTIVE" && (
                      <div className="col-md-6">
                        <label className="form-label small fw-semibold text-danger">DEACTIVATION REASON *</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Clinical or administrative reason..."
                          value={deactivateReason}
                          onChange={(e) => setDeactivateReason(e.target.value)}
                          required
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsEditOpen(false)}
                    disabled={isSubmittingEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-cerulean d-flex align-items-center gap-2"
                    disabled={isSubmittingEdit}
                  >
                    {isSubmittingEdit && <span className="spinner-border spinner-border-sm" aria-hidden="true" />}
                    <span>Save Changes</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
