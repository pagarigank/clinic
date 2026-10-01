import { useEffect, useState } from "react";
import { PingResponseSchema, type PingResponse } from "@clinic/contracts";
import { AlertBanner, EmptyState, SkeletonTable, StatusPill } from "@clinic/ui";
import { ApiError, apiGet } from "../../shared/api/client.js";

type ViewState =
  | { kind: "loading" }
  | { kind: "success"; data: PingResponse }
  | { kind: "error"; message: string; offline?: boolean }
  | { kind: "forbidden" }
  | { kind: "empty" };

/**
 * Sample screen implementing the six standard states (frontend §19):
 * loading, success, empty, forbidden, error, offline. Phase 1 replaces this
 * with real feature screens that follow the same contract.
 */
export function PingPage() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    apiGet<PingResponse>("/ping", controller.signal)
      .then((raw) => setState({ kind: "success", data: PingResponseSchema.parse(raw) }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) {
          setState({ kind: "forbidden" });
        } else if (!navigator.onLine) {
          setState({ kind: "error", message: "You appear to be offline.", offline: true });
        } else {
          setState({
            kind: "error",
            message:
              e instanceof ApiError
                ? e.problem.code
                : e instanceof Error
                  ? e.message
                  : "Request failed",
          });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="ping-title">
      <h1 id="ping-title" className="h4">
        Platform smoke check
      </h1>
      <p className="text-body-secondary">
        Proves the API, Postgres (RLS app role), and the UI round trip end to end.
      </p>

      {state.kind === "loading" && <SkeletonTable rows={2} />}

      {state.kind === "success" && (
        <AlertBanner severity="success">
          <div className="d-flex align-items-center gap-2">
            <StatusPill tone="normal" label="Connected" />
            <span>
              API + DB round trip OK · server time <code>{state.data.dbTime}</code> · request{" "}
              <code>{state.data.request_id.slice(0, 8)}</code>
            </span>
          </div>
        </AlertBanner>
      )}

      {state.kind === "empty" && (
        <EmptyState headline="Nothing to show" explanation="The server returned no payload." />
      )}

      {state.kind === "forbidden" && (
        <AlertBanner severity="warning">
          Forbidden — your session lacks permission for this action.
        </AlertBanner>
      )}

      {state.kind === "error" && state.offline && (
        <AlertBanner severity="info">Offline — showing the last synced state.</AlertBanner>
      )}
      {state.kind === "error" && !state.offline && (
        <AlertBanner severity="danger">
          Error: {state.message}. Retry or report with the correlation id.
        </AlertBanner>
      )}
    </section>
  );
}
