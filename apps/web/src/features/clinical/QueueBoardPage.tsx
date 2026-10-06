import { useCallback, useEffect, useState } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost, ApiError } from "../../shared/api/client.js";
import { useAuth } from "../../shared/auth/AuthContext.js";

/**
 * Queue board — frontend.md §14.4, todo.md §3.1 (CLN-T2, SSE live).
 *
 * v1 polls every 15 s; the SSE stream (frontend §16) replaces the interval
 * without changing this component's shape — the fetch simply becomes the
 * fallback. Branch-scoped; a cashier or nurse sees their branch's queue only.
 */

interface QueueEntry {
  id: string;
  ticketNo: string;
  patientName: string;
  priority: number;
  status: "WAITING" | "CALLED" | "SERVING" | "DONE" | "SKIPPED";
  issuedAt: string;
}



const STATUS_TONE: Record<QueueEntry["status"], "critical" | "high" | "normal" | "low" | "neutral" | "pending"> = {
  WAITING: "pending",
  CALLED: "low",
  SERVING: "normal",
  DONE: "neutral",
  SKIPPED: "neutral",
};

export function QueueBoardPage() {
  const { session } = useAuth();
  const branchId = session?.branchId || session?.assignedBranches?.[0]?.id;
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const url = branchId ? `/clinical/queue?branchId=${branchId}` : `/clinical/queue`;
      const res = await apiGet<{ data?: QueueEntry[] }>(url);
      if (Array.isArray(res?.data)) setEntries(res.data);
    } catch {
      /* queue fetch failed or empty */
    }
  }, [branchId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (entry: QueueEntry, action: "CALL" | "RECALL" | "SKIP" | "COMPLETE") => {
    setError(null);
    try {
      await apiPost(`/clinical/queue/${entry.id}/action`, { action });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Queue action failed.");
    }
  };

  const waiting = entries.filter((e) => e.status === "WAITING");
  const active = entries.find((e) => e.status === "SERVING" || e.status === "CALLED");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Queue Board</h1>
          <div className="page-subtitle">Live branch queue — now serving, waiting list, skip/recall</div>
        </div>
      </div>

      {error ? <div className="mb-3"><AlertBanner severity="danger">{error}</AlertBanner></div> : null}

      <div className="row g-4">
        <div className="col-lg-4">
          <div className="clinic-card p-4 text-center">
            <div className="text-secondary small fw-semibold text-uppercase">Now serving</div>
            <div className="fs-1 fw-bold text-dark clinic-mono">{active?.ticketNo ?? "—"}</div>
            <div className="text-muted">{active?.patientName ?? "No active ticket"}</div>
            {active ? (
              <div className="d-flex justify-content-center gap-2 mt-3">
                <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => void act(active, "COMPLETE")}>
                  Complete
                </button>
                <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => void act(active, "SKIP")}>
                  Skip
                </button>
              </div>
            ) : null}
          </div>
          <div className="clinic-card p-3 mt-3">
            <p className="small text-body-secondary mb-0">
              Display-board view refreshes every 15 s. Priority tickets (elderly, PWD,
              emergency) sort first.
            </p>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="clinic-card">
            <div className="clinic-card-header">
              <span className="fw-bold">Waiting ({waiting.length})</span>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <caption className="visually-hidden">Waiting queue tickets for this branch</caption>
                <thead className="table-light small text-secondary">
                  <tr><th>TICKET</th><th>PATIENT</th><th>PRIORITY</th><th>STATUS</th><th className="text-end">ACTION</th></tr>
                </thead>
                <tbody>
                  {entries.filter((e) => e.status !== "DONE").map((e) => (
                    <tr key={e.id}>
                      <td className="clinic-mono fw-semibold">{e.ticketNo}</td>
                      <td>{e.patientName}</td>
                      <td className="tabular">{e.priority > 0 ? `P${e.priority}` : "—"}</td>
                      <td><StatusPill tone={STATUS_TONE[e.status]} label={e.status} /></td>
                      <td className="text-end">
                        {e.status === "WAITING" ? (
                          <div className="d-flex gap-1 justify-content-end">
                            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void act(e, "CALL")}>Call</button>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void act(e, "SKIP")}>Skip</button>
                          </div>
                        ) : e.status === "SKIPPED" ? (
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void act(e, "RECALL")}>Recall</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted py-4">Queue is empty.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
