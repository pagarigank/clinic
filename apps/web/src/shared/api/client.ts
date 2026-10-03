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

let inMemoryAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

// Single-flight refresh: concurrent callers (e.g. React StrictMode's double
// effect invocation) share one request. The server rotates refresh tokens with
// reuse detection, so two concurrent presentations of the same cookie would
// revoke the whole session family.
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = apiPost<{ accessToken?: string }>("/auth/refresh")
      .then((res) => {
        const token = res?.accessToken ?? null;
        if (token) setAccessToken(token);
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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

function buildHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers(customHeaders);
  if (inMemoryAccessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryAccessToken}`);
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let problem: ApiProblem | undefined;
    try {
      problem = (await res.json()) as ApiProblem;
    } catch {
      // non-JSON error body — fall through to generic problem
    }
    throw new ApiError(
      problem ?? {
        type: "about:blank",
        title: res.statusText || "Request Failed",
        status: res.status,
        code: "UPSTREAM_UNAVAILABLE",
      },
      res.status,
    );
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const res = await fetch(`${apiBase()}${path}`, {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
    ...(signal && !isJsdom ? { signal } : {}),
  });
  return handleResponse<T>(res);
}

export async function apiPost<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  // Only advertise a JSON body when we actually send one: the API rejects an
  // empty body with Content-Type: application/json (e.g. POST /auth/refresh).
  const headers = buildHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined);
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(signal && !isJsdom ? { signal } : {}),
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const headers = buildHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined);
  const res = await fetch(`${apiBase()}${path}`, {
    method: "PATCH",
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(signal && !isJsdom ? { signal } : {}),
  });
  return handleResponse<T>(res);
}

export async function apiPut<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const headers = buildHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined);
  const res = await fetch(`${apiBase()}${path}`, {
    method: "PUT",
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(signal && !isJsdom ? { signal } : {}),
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const res = await fetch(`${apiBase()}${path}`, {
    method: "DELETE",
    headers: buildHeaders(),
    credentials: "include",
    ...(signal && !isJsdom ? { signal } : {}),
  });
  return handleResponse<T>(res);
}
