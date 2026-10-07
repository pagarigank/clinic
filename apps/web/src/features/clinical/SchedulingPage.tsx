import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertBanner, StatusPill, DateField } from "@clinic/ui";
import { apiGet, apiPost, apiPatch, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

/**
 * Scheduling — frontend.md §14.4 (M4 Clinical), todo.md §3.1, specification.md §CLN-T1.
 *
 * Day view per practitioner: appointment list + slot availability with booking
 * conflict detection (the API's EXCLUDE constraint is the authority — a racing
 * double-book surfaces as APPOINTMENT_CONFLICT, not a silent overwrite).
 * Includes complete appointment lifecycle: booking, rescheduling/schedule modification,
 * check-in, and cancellation with reason.
 * Walk-in mode issues a queue ticket instead of a fixed-time slot.
 */

interface Appointment {
  id: string;
  patientId?: string;
  patient_id?: string;
  patientName?: string;
  patient_name?: string;
  practitionerId?: string;
  practitioner_id?: string;
  practitionerName?: string;
  practitioner_name?: string;
  branchId?: string;
  branch_id?: string;
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
  status: string;
  notes?: string;
  rowVersion?: number;
  row_version?: number;
  channel?: string;
}

interface Slot {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

interface PatientOption {
  id: string;
  name: string;
  patientNo?: string;
  dob?: string;
  gender?: string;
  mobile?: string;
}

interface PractitionerOption {
  id: string;
  name: string;
  title?: string;
  specialization?: string;
}

const STATUS_TONE: Record<string, "critical" | "high" | "normal" | "low" | "neutral" | "pending"> = {
  BOOKED: "pending",
  CONFIRMED: "low",
  CHECKED_IN: "normal",
  IN_CONSULT: "normal",
  COMPLETED: "neutral",
  CANCELLED: "neutral",
  NO_SHOW: "high",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  if (!iso) return "--:--";
  return iso.slice(11, 16);
}

export function SchedulingPage() {
  const { session } = useAuth();
  const currentBranchId = session?.branchId || session?.assignedBranches?.[0]?.id || "";
  const [date, setDate] = useState(today());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDateJump, setNewDateJump] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Booking form
  const [patientId, setPatientId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:30");
  const [isWalkIn, setIsWalkIn] = useState(false);

  // Fuzzy patient search state for booking modal
  const [serverPatientResults, setServerPatientResults] = useState<PatientOption[]>([]);
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Reschedule / Modify Schedule modal
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(today());
  const [rescheduleStart, setRescheduleStart] = useState("09:00");
  const [rescheduleEnd, setRescheduleEnd] = useState("09:30");
  const [reschedulePractitionerId, setReschedulePractitionerId] = useState("");
  const [rescheduleNotes, setRescheduleNotes] = useState("");
  const [rescheduleSlots, setRescheduleSlots] = useState<Slot[]>([]);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("Patient requested cancellation");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const loadDay = useCallback(async (d: string) => {
    try {
      const res = await apiGet<{ data?: Appointment[] }>(`/clinical/appointments?date=${d}`);
      if (Array.isArray(res?.data)) setAppointments(res.data);
    } catch {
      /* empty on error */
    }
  }, []);

  useEffect(() => {
    void loadDay(date);
  }, [date, loadDay]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ data?: any[]; patients?: any[] }>("/patients?limit=50");
        const list = res?.data ?? res?.patients;
        if (Array.isArray(list)) {
          setPatientOptions(list.map((p: any) => ({
            id: p.id,
            name: `${p.last_name ?? p.lastName ?? ""}, ${p.first_name ?? p.firstName ?? ""}`.replace(/^,\s*/, "").trim() || "Unnamed Patient",
            patientNo: p.patientNo ?? p.patient_no ?? p.mrn ?? "",
            dob: p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : (p.dob ?? ""),
            gender: p.gender ?? p.sex ?? "",
            mobile: p.phone ?? p.mobile ?? "",
          })));
        }
      } catch { /* picker stays with empty/cached options */ }
    })();
  }, []);

  // Click-outside listener to close fuzzy patient dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsPatientDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Debounced server fuzzy query when searching
  useEffect(() => {
    const q = patientSearchQuery.trim();
    if (!bookingOpen || q.length < 2) {
      setServerPatientResults([]);
      setIsSearchingServer(false);
      return;
    }

    let active = true;
    setIsSearchingServer(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<{ data?: any[]; patients?: any[] }>(
          `/patients?q=${encodeURIComponent(q)}&limit=25`,
        );
        if (!active) return;
        const list = res?.data ?? res?.patients;
        if (Array.isArray(list)) {
          const mapped: PatientOption[] = list.map((p: any) => ({
            id: p.id,
            name: `${p.last_name ?? p.lastName ?? ""}, ${p.first_name ?? p.firstName ?? ""}`.replace(/^,\s*/, "").trim() || "Unnamed Patient",
            patientNo: p.patientNo ?? p.patient_no ?? p.mrn ?? "",
            dob: p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : (p.dob ?? ""),
            gender: p.gender ?? p.sex ?? "",
            mobile: p.phone ?? p.mobile ?? "",
          }));
          setServerPatientResults(mapped);
          setPatientOptions((prev) => {
            const map = new Map(prev.map((item) => [item.id, item]));
            for (const item of mapped) {
              map.set(item.id, item);
            }
            return Array.from(map.values());
          });
        }
      } catch {
        if (active) setServerPatientResults([]);
      } finally {
        if (active) setIsSearchingServer(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [patientSearchQuery, bookingOpen]);

  // Combined candidates & multi-level fuzzy scoring
  const combinedCandidates = useMemo(() => {
    const map = new Map<string, PatientOption>();
    for (const p of patientOptions) map.set(p.id, p);
    for (const p of serverPatientResults) map.set(p.id, p);
    return Array.from(map.values());
  }, [patientOptions, serverPatientResults]);

  // Keep selectedPatient in sync with patientId
  useEffect(() => {
    if (patientId) {
      if (!selectedPatient || selectedPatient.id !== patientId) {
        const found = combinedCandidates.find((p) => p.id === patientId);
        if (found) {
          setSelectedPatient(found);
        }
      }
    } else if (selectedPatient) {
      setSelectedPatient(null);
    }
  }, [patientId, selectedPatient, combinedCandidates]);

  const filteredPatients = useMemo(() => {
    const q = patientSearchQuery.trim().toLowerCase();
    if (!q) {
      return combinedCandidates.slice(0, 10);
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    return combinedCandidates
      .map((p) => {
        const name = p.name.toLowerCase();
        const no = (p.patientNo || "").toLowerCase();
        const full = `${name} ${no}`;
        let score = 0;

        if (name === q || no === q) {
          score += 500;
        } else if (name.startsWith(q) || no.startsWith(q)) {
          score += 300;
        } else if (full.includes(q)) {
          score += 150;
        } else if (tokens.length > 1 && tokens.every((t) => full.includes(t))) {
          score += 120;
        } else {
          // Subsequence fuzzy match (e.g. "snt" -> "santos")
          let tIdx = 0;
          let qIdx = 0;
          let streak = 0;
          let subScore = 0;
          while (tIdx < full.length && qIdx < q.length) {
            if (full[tIdx] === q[qIdx]) {
              subScore += 10 + streak * 5;
              streak++;
              qIdx++;
            } else {
              streak = 0;
            }
            tIdx++;
          }
          if (qIdx === q.length) {
            score += subScore;
          }
        }

        return { patient: p, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.patient)
      .slice(0, 15);
  }, [combinedCandidates, patientSearchQuery]);

  const selectPatient = (p: PatientOption) => {
    setPatientId(p.id);
    setSelectedPatient(p);
    setPatientSearchQuery("");
    setIsPatientDropdownOpen(false);
  };

  const clearSelectedPatient = () => {
    setPatientId("");
    setSelectedPatient(null);
    setPatientSearchQuery("");
    setIsPatientDropdownOpen(true);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ data?: PractitionerOption[] }>("/clinical/practitioners");
        if (Array.isArray(res?.data) && res.data.length > 0) {
          // Ensure only doctors/physicians are selectable (exclude administrators/managers)
          const docsOnly = res.data.filter((p) => {
            const titleLower = (p.title || "").toLowerCase();
            const nameLower = (p.name || "").toLowerCase();
            const isManager = titleLower.includes("manager") || titleLower.includes("admin") || nameLower.includes("admin");
            const isDoc = nameLower.startsWith("dr.") || titleLower.includes("doctor") || titleLower.includes("physician");
            return !isManager || isDoc;
          });
          const list = docsOnly.length > 0 ? docsOnly : res.data;
          setPractitioners(list);
          if (session?.userId && list.some((p) => p.id === session.userId)) {
            setPractitionerId(session.userId);
          } else if (list[0]) {
            setPractitionerId(list[0].id);
          }
        }
      } catch {
        /* fallback */
      }
    })();
  }, [session?.userId]);

  const loadAvailability = useCallback(async (d: string) => {
    if (!currentBranchId || !practitionerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(practitionerId)) {
      setSlots([]);
      return;
    }
    try {
      const res = await apiGet<{ slots?: Slot[] }>(
        `/clinical/availability?branchId=${currentBranchId}&practitionerId=${practitionerId}&date=${d}`,
      );
      setSlots(res?.slots ?? []);
    } catch {
      setSlots([]);
    }
  }, [currentBranchId, practitionerId]);

  useEffect(() => {
    void loadAvailability(date);
  }, [date, loadAvailability]);

  // Load slot availability for reschedule modal whenever target practitioner or date changes
  useEffect(() => {
    if (!rescheduleTarget || !reschedulePractitionerId || !rescheduleDate || !currentBranchId) {
      setRescheduleSlots([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<{ slots?: Slot[] }>(
          `/clinical/availability?branchId=${currentBranchId}&practitionerId=${reschedulePractitionerId}&date=${rescheduleDate}`,
        );
        if (!cancelled) setRescheduleSlots(res?.slots ?? []);
      } catch {
        if (!cancelled) setRescheduleSlots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rescheduleTarget, reschedulePractitionerId, rescheduleDate, currentBranchId]);

  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isWalkIn) {
        // Walk-in: queue ticket, not a fixed slot (todo §3.1).
        const ticket = await apiPost<{ ticketNo?: string }>("/clinical/queue", {
          branchId: currentBranchId,
          patientId,
          priority: 0,
        });
        setNotice(`Walk-in ticket ${ticket.ticketNo ?? "issued"} — patient joins the sequential queue.`);
      } else {
        const startsAt = new Date(`${date}T${start}:00`).toISOString();
        const endsAt = new Date(`${date}T${end}:00`).toISOString();
        await apiPost("/clinical/appointments", {
          branchId: currentBranchId,
          patientId,
          practitionerId,
          startsAt,
          endsAt,
        });
        setNotice(`Booked ${start}–${end}.`);
      }
      setBookingOpen(false);
      setPatientId("");
      setSelectedPatient(null);
      setPatientSearchQuery("");
      await loadDay(date);
      await loadAvailability(date);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.code === "APPOINTMENT_CONFLICT"
            ? "That slot is already booked — pick another."
            : err.problem.detail ?? err.problem.title
          : "Booking failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async (a: Appointment) => {
    try {
      const visit = await apiPost<{ id: string; visitNo: string }>("/clinical/visits", {
        branchId: currentBranchId,
        patientId: a.patientId ?? a.patient_id ?? "p1000000-0000-4000-8000-000000000001",
        practitionerId: a.practitionerId ?? a.practitioner_id ?? practitionerId,
        appointmentId: a.id,
        visitType: "OPD",
      });
      setNotice(`Checked in — visit ${visit.visitNo} opened.`);
      await loadDay(date);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Check-in failed.");
    }
  };

  const openReschedule = (a: Appointment) => {
    const rawStart = a.startsAt || a.starts_at || "";
    const rawEnd = a.endsAt || a.ends_at || "";
    const aDate = rawStart ? rawStart.slice(0, 10) : date;
    const aStart = rawStart ? timeOf(rawStart) : "09:00";
    const aEnd = rawEnd ? timeOf(rawEnd) : "09:30";
    const aPractitionerId = a.practitionerId || a.practitioner_id || practitionerId;

    setRescheduleTarget(a);
    setRescheduleDate(aDate);
    setRescheduleStart(aStart);
    setRescheduleEnd(aEnd);
    setReschedulePractitionerId(aPractitionerId);
    setRescheduleNotes(a.notes || "");
    setRescheduleError(null);
  };

  const submitReschedule = async () => {
    if (!rescheduleTarget) return;
    setRescheduleBusy(true);
    setRescheduleError(null);
    try {
      if (rescheduleStart >= rescheduleEnd) {
        setRescheduleError("Start time must be before end time.");
        setRescheduleBusy(false);
        return;
      }

      const startsAt = new Date(`${rescheduleDate}T${rescheduleStart}:00`).toISOString();
      const endsAt = new Date(`${rescheduleDate}T${rescheduleEnd}:00`).toISOString();
      const rowVersion = rescheduleTarget.rowVersion || rescheduleTarget.row_version || 1;

      await apiPatch(`/clinical/appointments/${rescheduleTarget.id}/reschedule`, {
        startsAt,
        endsAt,
        rowVersion,
        practitionerId: reschedulePractitionerId || undefined,
        notes: rescheduleNotes.trim() || undefined,
      });

      const pName = rescheduleTarget.patientName || rescheduleTarget.patient_name || "Patient";
      setNotice(`Schedule modified for ${pName}: updated to ${rescheduleDate} (${rescheduleStart}–${rescheduleEnd}).`);
      if (rescheduleDate !== date) {
        setNewDateJump(rescheduleDate);
      }
      setRescheduleTarget(null);
      await loadDay(date);
      await loadAvailability(date);
    } catch (err) {
      setRescheduleError(
        err instanceof ApiError
          ? err.problem.code === "APPOINTMENT_CONFLICT"
            ? "That slot is already booked for this doctor — please pick an open slot."
            : err.problem.code === "STALE_ROW_VERSION"
              ? "Appointment was updated elsewhere. Please refresh and retry."
              : err.problem.detail ?? err.problem.title
          : "Reschedule failed.",
      );
    } finally {
      setRescheduleBusy(false);
    }
  };

  const openCancel = (a: Appointment) => {
    setCancelTarget(a);
    setCancelReason("Patient requested cancellation");
    setCancelError(null);
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      setCancelError("A cancellation reason is required.");
      return;
    }
    setCancelBusy(true);
    setCancelError(null);
    try {
      const rowVersion = cancelTarget.rowVersion || cancelTarget.row_version || 1;
      await apiPatch(`/clinical/appointments/${cancelTarget.id}/cancel`, {
        reason: cancelReason.trim(),
        rowVersion,
      });
      const pName = cancelTarget.patientName || cancelTarget.patient_name || "Patient";
      setNotice(`Appointment for ${pName} has been cancelled.`);
      setCancelTarget(null);
      await loadDay(date);
      await loadAvailability(date);
    } catch (err) {
      setCancelError(
        err instanceof ApiError
          ? err.problem.detail ?? err.problem.title
          : "Cancellation failed.",
      );
    } finally {
      setCancelBusy(false);
    }
  };

  const dayList = useMemo(
    () => [...appointments].sort((a, b) => {
      const aStart = a.startsAt || a.starts_at || "";
      const bStart = b.startsAt || b.starts_at || "";
      return aStart.localeCompare(bStart);
    }),
    [appointments],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments & Scheduling</h1>
          <div className="page-subtitle">Day view, slot booking with conflict detection, reschedule modification, and walk-in queue mode</div>
        </div>
        <button
          type="button"
          className="btn btn-cerulean"
          onClick={() => {
            setPatientId("");
            setSelectedPatient(null);
            setPatientSearchQuery("");
            setIsPatientDropdownOpen(false);
            setBookingOpen(true);
          }}
        >
          + Book / Walk-in
        </button>
      </div>

      {notice ? (
        <div className="mb-3" role="status">
          <AlertBanner severity="success">
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <span>{notice}</span>
              {newDateJump && newDateJump !== date ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-success"
                  onClick={() => {
                    setDate(newDateJump);
                    setNewDateJump(null);
                  }}
                >
                  View {newDateJump} →
                </button>
              ) : null}
            </div>
          </AlertBanner>
        </div>
      ) : null}
      {error ? <div className="mb-3"><AlertBanner severity="danger" title="Booking problem">{error}</AlertBanner></div> : null}

      <div className="clinic-card p-3 mb-3">
        <div className="row g-3 align-items-end">
          <div className="col-md-3">
            <DateField label="Date" value={date} onChange={setDate} />
          </div>
          <div className="col-md-4">
            <label className="form-label small fw-semibold" htmlFor="sch-practitioner">Doctor / Practitioner</label>
            <select
              id="sch-practitioner"
              className="form-select form-select-sm"
              value={practitionerId}
              onChange={(e) => setPractitionerId(e.target.value)}
            >
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.title ? `(${p.title})` : ""}
                </option>
              ))}
              {practitioners.length === 0 && !practitionerId && (
                <option value="">Select practitioner...</option>
              )}
              {!practitioners.some((p) => p.id === practitionerId) && practitionerId ? (
                <option value={practitionerId}>{practitionerId}</option>
              ) : null}
            </select>
          </div>
          <div className="col-md-5 text-md-end small text-muted">
            {dayList.length} appointments · {slots.filter((s) => s.available).length} open slots
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="clinic-card">
            <div className="clinic-card-header"><span className="fw-bold">Day view</span></div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <caption className="visually-hidden">Appointments for the selected day</caption>
                <thead className="table-light small text-secondary">
                  <tr><th>TIME</th><th>PATIENT</th><th>PRACTITIONER</th><th>STATUS</th><th className="text-end">ACTION</th></tr>
                </thead>
                <tbody>
                  {dayList.map((a) => {
                    const startsAt = a.startsAt || a.starts_at || "";
                    const endsAt = a.endsAt || a.ends_at || "";
                    const patientName = a.patientName || a.patient_name || "Unknown Patient";
                    const practitionerName = a.practitionerName || a.practitioner_name || "Doctor";
                    const channel = a.channel || "FRONT_DESK";
                    const isBookedOrConfirmed = a.status === "BOOKED" || a.status === "CONFIRMED";

                    return (
                      <tr key={a.id}>
                        <td className="tabular fw-medium">{timeOf(startsAt)}–{timeOf(endsAt)}</td>
                        <td>
                          <div className="d-flex align-items-center flex-wrap gap-1">
                            <span className="fw-semibold text-dark">{patientName}</span>
                            {channel === "ONLINE" && (
                              <span className="badge bg-info-subtle text-info border border-info-subtle" style={{ fontSize: "0.72rem" }}>
                                🌐 Online
                              </span>
                            )}
                          </div>
                          {a.notes ? (
                            <div className="small text-muted fst-italic text-truncate" style={{ maxWidth: "240px" }} title={a.notes}>
                              📝 {a.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="small">{practitionerName}</td>
                        <td><StatusPill tone={STATUS_TONE[a.status] ?? "neutral"} label={a.status} /></td>
                        <td className="text-end">
                          <div className="d-flex gap-1 justify-content-end flex-wrap">
                            {isBookedOrConfirmed ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => void checkIn(a)}
                                  title="Check in patient and create encounter visit"
                                >
                                  Check in
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => openReschedule(a)}
                                  title="Modify schedule or reschedule this appointment"
                                >
                                  ✏️ Reschedule
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => openCancel(a)}
                                  title="Cancel appointment"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <span className="small text-muted">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {dayList.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted py-4">No appointments this day.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="clinic-card">
            <div className="clinic-card-header"><span className="fw-bold">Availability</span><span className="small text-muted">slots from schedule − bookings − leave</span></div>
            <div className="p-3 d-flex flex-wrap gap-2">
              {slots.length === 0 ? (
                <p className="small text-muted mb-0">No schedule template for this practitioner/day, or the API is unreachable.</p>
              ) : (
                slots.map((s) => (
                  <button
                    key={s.startsAt}
                    type="button"
                    className={`btn btn-sm ${s.available ? "btn-outline-success" : "btn-outline-secondary text-decoration-line-through"}`}
                    disabled={!s.available}
                    title={s.available ? "Available" : "Booked or blocked"}
                    onClick={() => {
                      setStart(timeOf(s.startsAt));
                      setEnd(timeOf(s.endsAt));
                      setPatientId("");
                      setSelectedPatient(null);
                      setPatientSearchQuery("");
                      setIsPatientDropdownOpen(false);
                      setBookingOpen(true);
                    }}
                  >
                    {timeOf(s.startsAt)}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Book / Walk-in Modal */}
      {bookingOpen ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="book-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="book-title">{isWalkIn ? "Walk-in ticket" : "Book appointment"}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setBookingOpen(false);
                    setPatientSearchQuery("");
                    setIsPatientDropdownOpen(false);
                  }}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="bk-practitioner">Doctor *</label>
                  <select
                    id="bk-practitioner"
                    className="form-select"
                    value={practitionerId}
                    onChange={(e) => setPractitionerId(e.target.value)}
                  >
                    {practitioners.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.title || "Physician"})</option>
                    ))}
                    {!practitioners.some((p) => p.id === practitionerId) && (
                      <option value={practitionerId}>{practitionerId}</option>
                    )}
                  </select>
                </div>

                <div className="mb-3">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="form-label small fw-semibold mb-0" htmlFor="bk-patient-input">
                      Patient *
                    </label>
                    <span className="small text-muted" style={{ fontSize: "0.75rem" }}>
                      Fuzzy search by name, MRN, or ID
                    </span>
                  </div>

                  {selectedPatient ? (
                    <div className="border border-primary-subtle rounded-3 p-2 px-3 bg-primary-subtle bg-opacity-10 d-flex align-items-center justify-content-between shadow-sm">
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-success-subtle text-success border border-success-subtle">
                          ✓ Selected
                        </span>
                        <div>
                          <div className="fw-semibold text-dark">{selectedPatient.name}</div>
                          <div className="small text-muted">
                            {selectedPatient.patientNo && (
                              <span className="badge bg-light text-dark border me-1">
                                {selectedPatient.patientNo}
                              </span>
                            )}
                            {selectedPatient.dob && <span className="me-2">DOB: {selectedPatient.dob}</span>}
                            {selectedPatient.gender && <span>{selectedPatient.gender}</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={clearSelectedPatient}
                        aria-label="Change patient"
                      >
                        Change
                      </button>
                      <input type="hidden" id="bk-patient" data-testid="bk-patient" value={patientId} readOnly />
                    </div>
                  ) : (
                    <div className="position-relative" ref={searchContainerRef}>
                      <div className="input-group">
                        <span className="input-group-text bg-white text-muted">🔍</span>
                        <input
                          id="bk-patient-input"
                          data-testid="bk-patient-input"
                          type="text"
                          className="form-control"
                          placeholder="Type patient name, ID, or MRN…"
                          value={patientSearchQuery}
                          onChange={(e) => {
                            setPatientSearchQuery(e.target.value);
                            setIsPatientDropdownOpen(true);
                          }}
                          onFocus={() => setIsPatientDropdownOpen(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setIsPatientDropdownOpen(false);
                            } else if (e.key === "Enter" && filteredPatients[0]) {
                              e.preventDefault();
                              selectPatient(filteredPatients[0]);
                            }
                          }}
                          autoComplete="off"
                        />
                        {patientSearchQuery && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => {
                              setPatientSearchQuery("");
                              setIsPatientDropdownOpen(true);
                            }}
                            aria-label="Clear search query"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <input type="hidden" id="bk-patient" data-testid="bk-patient" value={patientId} readOnly />

                      {isPatientDropdownOpen && (
                        <div
                          className="dropdown-menu show w-100 mt-1 shadow-lg border rounded-3 p-0"
                          style={{
                            maxHeight: "260px",
                            overflowY: "auto",
                            zIndex: 1055,
                            position: "absolute",
                            top: "100%",
                            left: 0,
                          }}
                        >
                          <div className="p-2 px-3 bg-light border-bottom d-flex justify-content-between align-items-center">
                            <span className="small text-muted fw-semibold">
                              {patientSearchQuery.trim()
                                ? `Matching Patients (${filteredPatients.length})`
                                : "Available Patients"}
                            </span>
                            {isSearchingServer && (
                              <span className="small text-primary fst-italic">Searching DB…</span>
                            )}
                          </div>

                          {filteredPatients.length === 0 ? (
                            <div className="p-3 text-center text-muted small">
                              {isSearchingServer
                                ? "Searching database..."
                                : `No patients matching "${patientSearchQuery}"`}
                            </div>
                          ) : (
                            <div className="list-group list-group-flush">
                              {filteredPatients.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className="list-group-item list-group-item-action px-3 py-2 text-start d-flex justify-content-between align-items-center"
                                  onClick={() => selectPatient(p)}
                                >
                                  <div>
                                    <div className="fw-semibold text-dark">{p.name}</div>
                                    <div className="small text-muted">
                                      {p.patientNo ? (
                                        <span className="badge bg-light text-dark border me-1">
                                          {p.patientNo}
                                        </span>
                                      ) : null}
                                      {p.dob ? <span className="me-2">DOB: {p.dob}</span> : null}
                                      {p.gender ? <span>{p.gender}</span> : null}
                                    </div>
                                  </div>
                                  <span
                                    className="btn btn-xs btn-outline-primary py-0 px-2"
                                    style={{ fontSize: "0.75rem" }}
                                  >
                                    Select
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-check mb-3">
                  <input className="form-check-input" type="checkbox" id="bk-walkin" checked={isWalkIn} onChange={(e) => setIsWalkIn(e.target.checked)} />
                  <label className="form-check-label small" htmlFor="bk-walkin">
                    <strong>Walk-in / sequential mode</strong> — issue a queue ticket instead of a fixed time.
                  </label>
                </div>
                {!isWalkIn ? (
                  <div className="row g-2">
                    <div className="col-6">
                      <label className="form-label small fw-semibold" htmlFor="bk-start">Start *</label>
                      <input id="bk-start" type="time" className="form-control" value={start} onChange={(e) => setStart(e.target.value)} />
                    </div>
                    <div className="col-6">
                      <label className="form-label small fw-semibold" htmlFor="bk-end">End *</label>
                      <input id="bk-end" type="time" className="form-control" value={end} onChange={(e) => setEnd(e.target.value)} />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setBookingOpen(false);
                    setPatientSearchQuery("");
                    setIsPatientDropdownOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-cerulean" disabled={!patientId || busy} onClick={() => void book()}>
                  {busy ? "Working…" : isWalkIn ? "Issue ticket" : "Book"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modify Schedule / Reschedule Modal */}
      {rescheduleTarget ? (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="resched-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
        >
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-light">
                <div>
                  <h5 className="modal-title fw-bold" id="resched-title">
                    Modify Appointment Schedule
                  </h5>
                  <div className="small text-muted">
                    Patient: <strong>{rescheduleTarget.patientName || rescheduleTarget.patient_name || "Patient"}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRescheduleTarget(null)}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body p-4">
                {rescheduleError && (
                  <div className="mb-3">
                    <AlertBanner severity="danger" title="Cannot update schedule">
                      {rescheduleError}
                    </AlertBanner>
                  </div>
                )}

                <div className="alert alert-info py-2 px-3 small mb-3 d-flex align-items-center gap-2">
                  <span>ℹ️</span>
                  <div>
                    <strong>Current schedule:</strong>{" "}
                    {timeOf(rescheduleTarget.startsAt || rescheduleTarget.starts_at || "")}–
                    {timeOf(rescheduleTarget.endsAt || rescheduleTarget.ends_at || "")} with{" "}
                    {rescheduleTarget.practitionerName || rescheduleTarget.practitioner_name || "Assigned Doctor"}
                    <span className="ms-2 badge bg-secondary">{rescheduleTarget.status}</span>
                  </div>
                </div>

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="rs-practitioner">
                      Doctor / Practitioner *
                    </label>
                    <select
                      id="rs-practitioner"
                      className="form-select"
                      value={reschedulePractitionerId}
                      onChange={(e) => setReschedulePractitionerId(e.target.value)}
                    >
                      {practitioners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.title ? `(${p.title})` : ""}
                        </option>
                      ))}
                      {!practitioners.some((p) => p.id === reschedulePractitionerId) && reschedulePractitionerId ? (
                        <option value={reschedulePractitionerId}>{reschedulePractitionerId}</option>
                      ) : null}
                    </select>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="rs-date">
                      New Appointment Date *
                    </label>
                    <input
                      id="rs-date"
                      type="date"
                      className="form-control"
                      value={rescheduleDate}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                    />
                  </div>

                  {/* Quick availability slots */}
                  <div className="col-12">
                    <label className="form-label small fw-semibold d-flex justify-content-between mb-1">
                      <span>Available Slots for Selected Date</span>
                      <span className="text-muted fw-normal">Click any slot to apply</span>
                    </label>
                    <div
                      className="p-2 border rounded bg-light d-flex flex-wrap gap-1"
                      style={{ maxHeight: "110px", overflowY: "auto" }}
                    >
                      {rescheduleSlots.length === 0 ? (
                        <span className="small text-muted p-1">
                          No slot templates configured or fully booked for this date.
                        </span>
                      ) : (
                        rescheduleSlots.map((s) => (
                          <button
                            key={s.startsAt}
                            type="button"
                            className={`btn btn-sm py-1 px-2 ${
                              s.available
                                ? "btn-outline-success"
                                : "btn-outline-secondary text-decoration-line-through opacity-50"
                            }`}
                            disabled={!s.available}
                            title={s.available ? "Click to set start/end time" : "Slot taken"}
                            onClick={() => {
                              setRescheduleStart(timeOf(s.startsAt));
                              setRescheduleEnd(timeOf(s.endsAt));
                            }}
                          >
                            {timeOf(s.startsAt)}
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="rs-start">
                      Start Time *
                    </label>
                    <input
                      id="rs-start"
                      type="time"
                      className="form-control"
                      value={rescheduleStart}
                      onChange={(e) => setRescheduleStart(e.target.value)}
                      required
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label small fw-semibold" htmlFor="rs-end">
                      End Time *
                    </label>
                    <input
                      id="rs-end"
                      type="time"
                      className="form-control"
                      value={rescheduleEnd}
                      onChange={(e) => setRescheduleEnd(e.target.value)}
                      required
                    />
                  </div>

                  <div className="col-12">
                    <label className="form-label small fw-semibold" htmlFor="rs-notes">
                      Schedule Modification Notes (Optional)
                    </label>
                    <input
                      id="rs-notes"
                      type="text"
                      className="form-control"
                      placeholder="e.g. Patient requested schedule change, follow-up time adjusted..."
                      value={rescheduleNotes}
                      onChange={(e) => setRescheduleNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer bg-light">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setRescheduleTarget(null)}
                  disabled={rescheduleBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-cerulean"
                  onClick={() => void submitReschedule()}
                  disabled={rescheduleBusy || !rescheduleStart || !rescheduleEnd || !rescheduleDate}
                >
                  {rescheduleBusy ? "Updating schedule…" : "Save New Schedule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cancel Appointment Modal */}
      {cancelTarget ? (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-danger-subtle">
                <h5 className="modal-title fw-bold text-danger" id="cancel-title">
                  Cancel Appointment
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setCancelTarget(null)}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body p-4">
                {cancelError && (
                  <div className="mb-3">
                    <AlertBanner severity="danger">{cancelError}</AlertBanner>
                  </div>
                )}
                <p className="mb-2">
                  Are you sure you want to cancel the appointment for{" "}
                  <strong>
                    {cancelTarget.patientName || cancelTarget.patient_name || "Patient"}
                  </strong>
                  ?
                </p>
                <div className="small text-muted mb-3">
                  Scheduled for {timeOf(cancelTarget.startsAt || cancelTarget.starts_at || "")}–
                  {timeOf(cancelTarget.endsAt || cancelTarget.ends_at || "")} with{" "}
                  {cancelTarget.practitionerName || cancelTarget.practitioner_name || "Doctor"}.
                </div>

                <label className="form-label small fw-semibold" htmlFor="cancel-reason">
                  Reason for Cancellation *
                </label>
                <select
                  id="cancel-reason-preset"
                  className="form-select mb-2 form-select-sm"
                  onChange={(e) => {
                    if (e.target.value) setCancelReason(e.target.value);
                  }}
                >
                  <option value="Patient requested cancellation">Patient requested cancellation</option>
                  <option value="Doctor unavailable / emergency">Doctor unavailable / emergency</option>
                  <option value="Patient illness / unable to attend">Patient illness / unable to attend</option>
                  <option value="Duplicate booking">Duplicate booking</option>
                  <option value="">Other (type custom reason below)</option>
                </select>
                <input
                  id="cancel-reason"
                  type="text"
                  className="form-control"
                  placeholder="Type reason here..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  required
                />
              </div>
              <div className="modal-footer bg-light">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelBusy}
                >
                  Keep Appointment
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void submitCancel()}
                  disabled={cancelBusy || !cancelReason.trim()}
                >
                  {cancelBusy ? "Cancelling…" : "Confirm Cancellation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
