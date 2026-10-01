import type { Problem } from "@clinic/contracts";

/** Typed API problem (frontend §10): parse problem+json, map code → copy later. */
export interface ApiProblem extends Problem {
  correlationId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly problem: ApiProblem,
    public readonly status: number,
  ) {
    super(`${problem.code}: ${problem.title}`);
    this.name = "ApiError";
  }
}

// Resolve to an absolute URL: jsdom's fetch rejects relative URLs, while in
// the browser location.origin keeps the Vite proxy behaviour identical to a
// relative "/api/v1". Component tests set API_ORIGIN to a loopback stub.
function apiBase(): string {
  if (typeof process !== "undefined" && process.env.API_ORIGIN) {
    return `${process.env.API_ORIGIN}/api/v1`;
  }
  const origin = typeof location !== "undefined" ? location.origin : "http://localhost:3000";
  return `${origin}/api/v1`;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  // jsdom's fetch rejects undici AbortSignal instances (Node ≥ 20 globals),
  // so the wire-level signal is only wired in real browser environments;
  // callers still abort their own state updates in every environment.
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...(signal && !isJsdom ? { signal } : {}),
  });
  if (!res.ok) {
    let problem: ApiProblem | undefined;
    try {
      problem = (await res.json()) as ApiProblem;
    } catch {
      // non-JSON error body — fall through to generic problem
    }
    throw new ApiError(
      problem ?? { type: "about:blank", title: res.statusText, status: res.status, code: "UPSTREAM_UNAVAILABLE" },
      res.status,
    );
  }
  return (await res.json()) as T;
}
