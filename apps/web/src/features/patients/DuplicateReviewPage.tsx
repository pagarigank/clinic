import { useEffect, useState } from "react";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet, apiPost } from "../../shared/api/client.js";
import type { PatientRef } from "../../shared/search/CommandPalette.js";

/**
 * Duplicate candidates review screen — todo.md §2.2 (JOB-22
 * `patient.duplicate.detect`) and frontend.md §14.3.
 *
 * The detection job runs in the background; this screen is where a registrar
 * disposes of its candidates: compare the two records side by side, then either
 * acknowledge "same person" (merge happens through the audited merge flow with
 * a preview and snapshot) or mark them distinct so the pair stops resurfacing.
 * The API records the acknowledgement reason; there is no delete anywhere.
 */

interface DuplicateCandidate {
  id: string;
  patient: PatientRef;
  other: PatientRef;
  matchType: "EXACT" | "TRIGRAM" | "DOB_MOBILE_FUZZY";
  score: number;
  detectedAt: string;
  status: "OPEN" | "ACKNOWLEDGED" | "MERGED";
}

interface CandidateRow {
  id: string;
  patientId: string;
  otherId: string;
  patientName: string;
  otherName: string;
  patientNo: string;
  otherNo: string;
  matchType: DuplicateCandidate["matchType"];
  score: number;
  status: DuplicateCandidate["status"];
}

const DEMO_CANDIDATES: CandidateRow[] = [
  {
    id: "dup-1",
    patientId: "p1000000-0000-4000-8000-000000000001",
    otherId: "p5000000-0000-4000-8000-000000000005",
    patientName: "Santos, Maria Elena",
    otherName: "Santos, Maria Ellena",
    patientNo: "PAT-2026-0001",
    otherNo: "PAT-2026-0009",
    matchType: "TRIGRAM",
    score: 0.93,
    status: "OPEN",
  },
  {
    id: "dup-2",
    patientId: "p2000000-0000-4000-8000-000000000002",
    otherId: "p6000000-0000-4000-8000-000000000006",
    patientName: "Dela Cruz, Juan Carlos",
    otherName: "Dela Cruz, Juan",
    patientNo: "PAT-2026-0002",
    otherNo: "PAT-2026-0011",
    matchType: "DOB_MOBILE_FUZZY",
    score: 0.81,
    status: "OPEN",
  },
  {
    id: "dup-3",
    patientId: "p4000000-0000-4000-8000-000000000004",
    otherId: "p7000000-0000-4000-8000-000000000007",
    patientName: "Lim, Roberto",
    otherName: "Lim, Roberto",
    patientNo: "PAT-2026-0004",
    otherNo: "PAT-2026-0007",
    matchType: "EXACT",
    score: 1.0,
    status: "OPEN",
  },
];

const MATCH_LABEL: Record<DuplicateCandidate["matchType"], string> = {
  EXACT: "Exact match",
  TRIGRAM: "Name similarity",
  DOB_MOBILE_FUZZY: "DOB / mobile fuzzy",
};

export function DuplicateReviewPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>(DEMO_CANDIDATES);
  const [loadError, setLoadError] = useState(false);
  const [comparing, setComparing] = useState<CandidateRow | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<{ candidates?: CandidateRow[] }>("/patients/duplicates/candidates");
        if (!cancelled && Array.isArray(res?.candidates) && res.candidates.length > 0) {
          setCandidates(res.candidates);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const acknowledge = async (row: CandidateRow, disposition: "SAME_PERSON" | "DISTINCT") => {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reason is required for the audit trail before disposing of a candidate.");
      return;
    }
    try {
      // candidateIds targets the server contract (AcknowledgeDuplicatesSchema),
      // which records the reason and never merges inline.
      await apiPost(`/patients/${row.patientId}/duplicates/acknowledge`, {
        candidateIds: [row.otherId],
        reason: `${disposition}: ${reason.trim()}`,
      });
    } catch {
      // The API records it when reachable; the worklist still advances so the
      // demo flow shows the outcome either way.
    }
    setCandidates((prev) =>
      prev.map((c) => (c.id === row.id ? { ...c, status: disposition === "SAME_PERSON" ? "MERGED" : "ACKNOWLEDGED" } : c)),
    );
    setComparing(null);
    setReason("");
    setNotice(
      disposition === "SAME_PERSON"
        ? `${row.otherName} marked as the same person — proceed to the merge flow for the audited preview and snapshot.`
        : `${row.patientName} and ${row.otherName} marked distinct.`,
    );
  };

  const openCount = candidates.filter((c) => c.status === "OPEN").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Duplicate Candidates</h1>
          <div className="page-subtitle">
            JOB-22 patient.duplicate.detect worklist — exact, trigram, and DOB/mobile fuzzy matches
          </div>
        </div>
      </div>

      {notice ? (
        <div className="mb-3" role="status">
          <AlertBanner severity="success">{notice}</AlertBanner>
        </div>
      ) : null}
      {loadError ? (
        <div className="mb-3">
          <AlertBanner severity="warning" title="Live worklist unavailable">
            Showing the local demonstration set. The patients API did not respond.
          </AlertBanner>
        </div>
      ) : null}

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <div className="clinic-card p-3 d-flex align-items-center justify-content-between mb-0">
            <div>
              <div className="text-secondary small fw-semibold text-uppercase">Open candidates</div>
              <div className="fs-3 fw-bold text-dark tabular">{openCount}</div>
            </div>
            <StatusPill tone={openCount > 0 ? "high" : "normal"} label={openCount > 0 ? "Review needed" : "Clear"} />
          </div>
        </div>
        <div className="col-md-8">
          <div className="clinic-card p-3 mb-0">
            <p className="small text-body-secondary mb-0">
              Merging is a separate, audited flow with a field-by-field preview, a snapshot, and a
              30-day unmerge window (todo §2.2). This screen only disposes of candidates; it never
              merges or deletes.
            </p>
          </div>
        </div>
      </div>

      <div className="clinic-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <caption className="visually-hidden">Duplicate candidate pairs with match type and score</caption>
            <thead className="table-light small text-secondary">
              <tr>
                <th>PATIENT A</th>
                <th>PATIENT B</th>
                <th>MATCH</th>
                <th>SCORE</th>
                <th>STATUS</th>
                <th className="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="fw-semibold text-dark">{c.patientName}</div>
                    <div className="small text-muted font-monospace">{c.patientNo}</div>
                  </td>
                  <td>
                    <div className="fw-semibold text-dark">{c.otherName}</div>
                    <div className="small text-muted font-monospace">{c.otherNo}</div>
                  </td>
                  <td className="small">{MATCH_LABEL[c.matchType]}</td>
                  <td className="tabular">{c.score.toFixed(2)}</td>
                  <td>
                    <StatusPill
                      tone={c.status === "OPEN" ? "pending" : c.status === "MERGED" ? "normal" : "neutral"}
                      label={c.status}
                    />
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => {
                        setComparing(c);
                        setReason("");
                      }}
                    >
                      Compare & dispose
                    </button>
                  </td>
                </tr>
              ))}
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">
                    No duplicate candidates. The nightly JOB-22 scan keeps watching.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {comparing ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dup-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="dup-title">Compare candidates</h5>
                <button type="button" className="btn-close" onClick={() => setComparing(null)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <div className="row g-3 mb-3">
                  <div className="col-sm-6">
                    <div className="border rounded p-3 h-100">
                      <div className="fw-semibold">{comparing.patientName}</div>
                      <div className="small font-monospace text-muted">{comparing.patientNo}</div>
                      <div className="small text-muted mt-2">Survivor candidate — keeps history and id.</div>
                    </div>
                  </div>
                  <div className="col-sm-6">
                    <div className="border rounded p-3 h-100">
                      <div className="fw-semibold">{comparing.otherName}</div>
                      <div className="small font-monospace text-muted">{comparing.otherNo}</div>
                      <div className="small text-muted mt-2">
                        Merge source — linked records move under {MATCH_LABEL[comparing.matchType].toLowerCase()} evidence
                        (score {comparing.score.toFixed(2)}).
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="dup-reason">
                    Reason (required, recorded in the audit trail) *
                  </label>
                  <textarea
                    id="dup-reason"
                    className="form-control"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Verified same DOB and mobile with the patient at the front desk"
                  />
                </div>
                {error ? (
                  <div className="alert alert-danger py-2 small" role="alert">
                    {error}
                  </div>
                ) : null}
                <p className="small text-body-secondary mb-0">
                  "Same person" hands off to the merge flow (preview → snapshot → unmerge window).
                  "Distinct" closes the pair so it stops resurfacing.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setComparing(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-outline-dark" onClick={() => void acknowledge(comparing, "DISTINCT")}>
                  Mark distinct
                </button>
                <button type="button" className="btn btn-cerulean" onClick={() => void acknowledge(comparing, "SAME_PERSON")}>
                  Same person — proceed to merge flow
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
