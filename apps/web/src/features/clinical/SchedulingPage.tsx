import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertBanner, StatusPill, DateField, MoneyField } from "@clinic/ui";
import { apiGet, apiPost, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

/**
 * Scheduling — frontend.md §14.4 (M4 Clinical), todo.md §3.1.
 *
 * Day view per practitioner: appointment list + slot availability with booking
 * conflict detection (the API's EXCLUDE constraint is the authority — a racing
 * double-book surfaces as APPOINTMENT_CONFLICT, not a silent overwrite).
 * Walk-in mode issues a queue ticket instead of a fixed-time slot.
 */

interface Appointment {
  id: string;
  patientName: string;
  practitionerName: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

interface Slot {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

interface PatientOption {
  id: string;
  name: string;
  patientNo: string;
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
  return iso.slice(11, 16);
}

export function SchedulingPage() {
  const { session } = useAuth();
  const currentBranchId = session?.branchId || session?.assignedBranches?.[0]?.id || "b1000000-0000-4000-8000-000000000001";
  const [date, setDate] = useState(today());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Booking form
  const [patientId, setPatientId] = useState("");
  const [practitionerId, setPractitionerId] = useState("u-doctor-1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:30");
  const [isWalkIn, setIsWalkIn] = useState(false);

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
        const res = await apiGet<{ data?: PatientOption[] }>("/patients");
        if (Array.isArray(res?.data)) {
          setPatientOptions(res.data.slice(0, 50).map((p: any) => ({
            id: p.id,
            name: `${p.last_name ?? p.lastName ?? ""}, ${p.first_name ?? p.firstName ?? ""}`.replace(/^,\s*/, ""),
            patientNo: p.patientNo ?? "",
          })));
        }
      } catch { /* picker stays with the demo options */ }
    })();
  }, []);

  const loadAvailability = useCallback(async (d: string) => {
    try {
      const res = await apiGet<{ slots?: Slot[] }>(
        `/clinical/availability?branchId=" + currentBranchId + "&practitionerId=${practitionerId}&date=${d}`,
      );
      setSlots(res?.slots ?? []);
    } catch {
      setSlots([]);
    }
  }, [practitionerId]);

  useEffect(() => {
    void loadAvailability(date);
  }, [date, loadAvailability]);

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
        patientId: (a as any).patientId ?? "p1000000-0000-4000-8000-000000000001",
        practitionerId: (a as any).practitionerId ?? practitionerId,
        appointmentId: a.id,
        visitType: "OPD",
      });
      setNotice(`Checked in — visit ${visit.visitNo} opened.`);
      await loadDay(date);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Check-in failed.");
    }
  };

  const dayList = useMemo(
    () => [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointments],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments & Scheduling</h1>
          <div className="page-subtitle">Day view, slot booking with conflict detection, and walk-in queue mode</div>
        </div>
        <button type="button" className="btn btn-cerulean" onClick={() => setBookingOpen(true)}>
          + Book / Walk-in
        </button>
      </div>

      {notice ? <div className="mb-3" role="status"><AlertBanner severity="success">{notice}</AlertBanner></div> : null}
      {error ? <div className="mb-3"><AlertBanner severity="danger" title="Booking problem">{error}</AlertBanner></div> : null}

      <div className="clinic-card p-3 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <DateField label="Date" value={date} onChange={setDate} />
          </div>
          <div className="col-md-8 text-md-end small text-muted">
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
                  {dayList.map((a) => (
                    <tr key={a.id}>
                      <td className="tabular">{timeOf(a.startsAt)}–{timeOf(a.endsAt)}</td>
                      <td className="fw-semibold text-dark">{a.patientName}</td>
                      <td className="small">{a.practitionerName}</td>
                      <td><StatusPill tone={STATUS_TONE[a.status] ?? "neutral"} label={a.status} /></td>
                      <td className="text-end">
                        {a.status === "BOOKED" || a.status === "CONFIRMED" ? (
                          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void checkIn(a)}>
                            Check in
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
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

      {bookingOpen ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="book-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="book-title">{isWalkIn ? "Walk-in ticket" : "Book appointment"}</h5>
                <button type="button" className="btn-close" onClick={() => setBookingOpen(false)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="bk-patient">Patient *</label>
                  <select id="bk-patient" className="form-select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                    <option value="">Select patient…</option>
                    {patientOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} {p.patientNo ? `(${p.patientNo})` : ""}</option>
                    ))}
                  </select>
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
                <button type="button" className="btn btn-outline-secondary" onClick={() => setBookingOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-cerulean" disabled={!patientId || busy} onClick={() => void book()}>
                  {busy ? "Working…" : isWalkIn ? "Issue ticket" : "Book"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
