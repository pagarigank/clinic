import { useEffect, useState } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet } from "../../shared/api/client.js";

/**
 * Visits list — frontend.md §14.4, todo.md §3.2. Entry point to the encounter
 * chart; the worklist distinguishes open visits (actionable) from closed ones
 * (immutable, read-only per §7.2).
 */

interface VisitRow {
  id: string;
  visitNo: string;
  patientName: string;
  visitType: string;
  status: string;
  chiefComplaint: string | null;
  openedAt: string;
}

const DEMO_VISITS: VisitRow[] = [
  { id: "v1", visitNo: "V-20261002-00001", patientName: "Santos, Maria Elena", visitType: "OPD", status: "IN_PROGRESS", chiefComplaint: "Fever 3 days, productive cough", openedAt: "2026-10-02 08:40" },
  { id: "v2", visitNo: "V-20261002-00002", patientName: "Lim, Roberto", visitType: "FOLLOW_UP", status: "READY_FOR_BILLING", chiefComplaint: "BP follow-up", openedAt: "2026-10-02 09:15" },
  { id: "v3", visitNo: "V-20261001-00012", patientName: "Dela Cruz, Juan", visitType: "OPD", status: "CLOSED", chiefComplaint: "Annual physical", openedAt: "2026-10-01 14:00" },
];

const STATUS_TONE: Record<string, "critical" | "high" | "normal" | "low" | "neutral" | "pending"> = {
  OPEN: "pending",
  IN_PROGRESS: "low",
  READY_FOR_BILLING: "high",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

export function VisitsPage() {
  const [visits, setVisits] = useState<VisitRow[]>(DEMO_VISITS);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ data?: VisitRow[] }>("/clinical/visits");
        if (Array.isArray(res?.data) && res.data.length > 0) setVisits(res.data);
      } catch {
        setError("Live visit list unavailable — showing the demonstration set.");
      }
    })();
  }, []);

  const filtered = statusFilter === "ALL" ? visits : visits.filter((v) => v.status === statusFilter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Consultations & Chart</h1>
          <div className="page-subtitle">Encounters, vitals, SOAP notes, diagnoses, prescriptions, and orders</div>
        </div>
      </div>

      {error ? (
        <div className="mb-3"><AlertBanner severity="warning" title="Offline data">{error}</AlertBanner></div>
      ) : null}

      <div className="clinic-card p-3 mb-3">
        <div className="btn-group btn-group-sm" role="group" aria-label="Filter by visit status">
          {["ALL", "OPEN", "IN_PROGRESS", "READY_FOR_BILLING", "CLOSED"].map((s) => (
            <button
              key={s}
              type="button"
              className={`btn ${statusFilter === s ? "btn-cerulean" : "btn-outline-secondary"}`}
              onClick={() => setStatusFilter(s)}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="clinic-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <caption className="visually-hidden">Visits with status filter</caption>
            <thead className="table-light small text-secondary">
              <tr><th>VISIT NO.</th><th>PATIENT</th><th>TYPE</th><th>CHIEF COMPLAINT</th><th>STATUS</th><th className="text-end">ACTION</th></tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td className="clinic-mono small">{v.visitNo}</td>
                  <td className="fw-semibold text-dark">{v.patientName}</td>
                  <td className="small">{v.visitType.replace("_", " ")}</td>
                  <td className="small text-muted">{v.chiefComplaint ?? "—"}</td>
                  <td><StatusPill tone={STATUS_TONE[v.status] ?? "neutral"} label={v.status.replace("_", " ")} /></td>
                  <td className="text-end">
                    <button type="button" className="btn btn-sm btn-outline-primary">Open chart</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted py-4">No visits match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
