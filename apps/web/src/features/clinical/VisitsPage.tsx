import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

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

interface PatientOption {
  id: string;
  name: string;
  patientNo: string;
  dob?: string;
}


const STATUS_TONE: Record<string, "critical" | "high" | "normal" | "low" | "neutral" | "pending"> = {
  OPEN: "pending",
  IN_PROGRESS: "low",
  READY_FOR_BILLING: "high",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

/** The API returns raw snake_case visit rows joined with `patient_name`. */
function mapVisit(r: Record<string, unknown>): VisitRow {
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  return {
    id: str(r.id),
    visitNo: str(r.visitNo ?? r.visit_no),
    patientName: str(r.patientName ?? r.patient_name),
    visitType: str(r.visitType ?? r.visit_type, "OPD"),
    status: str(r.status, "OPEN"),
    chiefComplaint: (r.chiefComplaint ?? r.chief_complaint ?? null) as string | null,
    openedAt: str(r.openedAt ?? r.opened_at),
  };
}

const DEMO_VISITS: VisitRow[] = [
  { id: "v1", visitNo: "V-20261002-00001", patientName: "Santos, Maria Elena", visitType: "OPD", status: "IN_PROGRESS", chiefComplaint: "Fever x 3 days, cough", openedAt: "2026-10-02 08:30" },
  { id: "v2", visitNo: "V-20261002-00002", patientName: "Dela Cruz, Juan Carlos", visitType: "WALK_IN", status: "OPEN", chiefComplaint: "Routine hypertension check", openedAt: "2026-10-02 09:15" },
  { id: "v3", visitNo: "V-20261001-00012", patientName: "Lim, Roberto", visitType: "FOLLOW_UP", status: "CLOSED", chiefComplaint: "Post-op wound check — clean", openedAt: "2026-10-01 14:00" },
];

export function VisitsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [visits, setVisits] = useState<VisitRow[]>(DEMO_VISITS);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);

  // Quick Register Form State
  const [showRegister, setShowRegister] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState("OPD");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadVisits = async () => {
    setVisitsLoading(true);
    try {
      const res = await apiGet<{ data?: Array<Record<string, unknown>> }>("/clinical/visits");
      if (Array.isArray(res?.data) && res.data.length > 0) {
        setVisits(res.data.map(mapVisit));
      }
      setError(null);
    } catch {
      setError("Live visit list unavailable — showing the demonstration set.");
    } finally {
      setVisitsLoading(false);
    }
  };

  useEffect(() => {
    void loadVisits();
  }, []);

  // Fetch patients dynamically for quick search
  useEffect(() => {
    const handler = setTimeout(async () => {
      try {
        const query = patientSearch ? `?q=${encodeURIComponent(patientSearch)}` : "";
        const res = await apiGet<{ data?: any[] }>(`/patients${query}`);
        if (Array.isArray(res?.data)) {
          setPatients(res.data.slice(0, 50).map((p: any) => ({
            id: p.id,
            name: `${p.first_name ?? p.firstName ?? ""} ${p.last_name ?? p.lastName ?? ""}`.trim(),
            patientNo: p.patientNo ?? p.patient_no ?? "",
            dob: p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : undefined,
          })));
        }
      } catch { /* ignore */ }
    }, 300); // 300ms debounce
    return () => clearTimeout(handler);
  }, [patientSearch]);

  const filteredPatients = patients; // No longer filtered in frontend

  const handleRegisterVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) {
      setFormError("Please select a patient.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const branchId = session?.branchId || "b1000000-0000-4000-8000-000000000001";
      const practitionerId = session?.userId || "u-doctor-1";
      const res = await apiPost<{ id: string; visitNo: string }>("/clinical/visits", {
        branchId,
        patientId: selectedPatientId,
        practitionerId,
        visitType,
        chiefComplaint: chiefComplaint.trim() || undefined,
      });
      // Redirect to the chart
      navigate(`/clinical/visits/${res.id}`);
    } catch (err: any) {
      setFormError(err?.problem?.detail || err?.message || "Failed to register visit.");
      setIsSubmitting(false);
    }
  };

  const filtered = statusFilter === "ALL" ? visits : visits.filter((v) => v.status === statusFilter);

  return (
    <div>
      <div className="page-header d-flex justify-content-between align-items-center">
        <div>
          <h1 className="page-title">Consultations & Chart</h1>
          <div className="page-subtitle">Encounters, vitals, SOAP notes, diagnoses, prescriptions, and orders</div>
        </div>
        <button className="btn btn-cerulean" onClick={() => setShowRegister(!showRegister)}>
          {showRegister ? "Cancel" : "Register Visit"}
        </button>
      </div>

      {error && !showRegister ? (
        <div className="mb-3"><AlertBanner severity="warning" title="Offline data">{error}</AlertBanner></div>
      ) : null}

      {showRegister && (
        <div className="clinic-card p-4 mb-4 shadow-sm border-cerulean">
          <h5 className="mb-3 fw-bold text-cerulean">Register New Visit</h5>
          {formError && <AlertBanner severity="danger">{formError}</AlertBanner>}
          
          <form onSubmit={handleRegisterVisit}>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label fw-semibold small text-secondary">Quick Search Patient</label>
                <input
                  type="text"
                  className="form-control mb-2"
                  placeholder="Search by name or ID..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                />
                <select 
                  className="form-select" 
                  size={4}
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  required
                >
                  {filteredPatients.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.patientNo ? `(${p.patientNo})` : p.dob ? `(DOB: ${p.dob})` : ''}
                    </option>
                  ))}
                  {filteredPatients.length === 0 && <option disabled>No matching patients found.</option>}
                </select>
              </div>

              <div className="col-md-6">
                <div className="mb-3">
                  <label className="form-label fw-semibold small text-secondary">Visit Type</label>
                  <select className="form-select" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                    <option value="OPD">OPD</option>
                    <option value="WALK_IN">Walk-In</option>
                    <option value="FOLLOW_UP">Follow-Up</option>
                    <option value="PROCEDURE">Procedure</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold small text-secondary">Chief Complaint</label>
                  <textarea 
                    className="form-control" 
                    rows={3} 
                    placeholder="Brief description of the visit purpose..."
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                  />
                </div>
              </div>
            </div>
            
            <div className="d-flex justify-content-end mt-3">
              <button type="submit" className="btn btn-primary px-4" disabled={isSubmitting || !selectedPatientId}>
                {isSubmitting ? "Registering..." : "Create Visit & Open Chart"}
              </button>
            </div>
          </form>
        </div>
      )}

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
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/clinical/visits/${v.id}`)}>Open chart</button>
                  </td>
                </tr>
              ))}
              {visitsLoading ? (
                <tr><td colSpan={6} className="text-center text-muted py-4">
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Loading visits…
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted py-4">No visits match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
