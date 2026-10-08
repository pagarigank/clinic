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
let inMemoryStepUpToken: string | null = null;

export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setStepUpToken(token: string | null) {
  inMemoryStepUpToken = token;
}

export function getStepUpToken(): string | null {
  return inMemoryStepUpToken;
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

// Platform console refresh: separate single-flight and endpoint (distinct
// `clinic_prt` cookie), so a tenant refresh and a platform refresh can never
// present the same rotating token twice.
let platformRefreshInFlight: Promise<string | null> | null = null;

export function refreshPlatformAccessToken(): Promise<string | null> {
  if (!platformRefreshInFlight) {
    platformRefreshInFlight = apiPost<{ accessToken?: string }>("/auth/platform/refresh")
      .then((res) => {
        const token = res?.accessToken ?? null;
        if (token) setAccessToken(token);
        return token;
      })
      .catch(() => null)
      .finally(() => {
        platformRefreshInFlight = null;
      });
  }
  return platformRefreshInFlight;
}

// Resolve to an absolute URL: jsdom's fetch rejects relative URLs, while in
// the browser location.origin keeps the Vite proxy behaviour identical to a
// relative "/api/v1". Component tests set API_ORIGIN to a loopback stub.
function apiBase(): string {
  if (typeof process !== "undefined" && process.env.API_ORIGIN) {
    return `${process.env.API_ORIGIN}/api/v1`;
  }
  const origin = typeof location !== "undefined" ? location.origin : "http://localhost:3085";
  return `${origin}/api/v1`;
}

function buildHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers(customHeaders);
  if (inMemoryAccessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryAccessToken}`);
  }
  if (inMemoryStepUpToken && !headers.has("X-Step-Up-Token")) {
    headers.set("X-Step-Up-Token", inMemoryStepUpToken);
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

async function fetchWithAuth(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  customHeaders?: HeadersInit,
): Promise<Response> {
  const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const url = `${apiBase()}${path}`;
  const headers = buildHeaders(
    body !== undefined ? { "Content-Type": "application/json", ...customHeaders } : customHeaders,
  );

  let res = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(signal && !isJsdom ? { signal } : {}),
  });

  // Automatic token refresh retry on 401 for non-auth endpoints when token expired
  if (res.status === 401 && !path.startsWith("/auth/") && inMemoryAccessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = buildHeaders(
        body !== undefined ? { "Content-Type": "application/json", ...customHeaders } : customHeaders,
      );
      res = await fetch(url, {
        method,
        headers: retryHeaders,
        credentials: "include",
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...(signal && !isJsdom ? { signal } : {}),
      });
    }
  }

  return res;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetchWithAuth("GET", path, undefined, signal);
  return handleResponse<T>(res);
}

export async function apiPost<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const res = await fetchWithAuth("POST", path, body, signal);
  return handleResponse<T>(res);
}

export async function apiPatch<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const res = await fetchWithAuth("PATCH", path, body, signal);
  return handleResponse<T>(res);
}

export async function apiPut<T, B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<T> {
  const res = await fetchWithAuth("PUT", path, body, signal);
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetchWithAuth("DELETE", path, undefined, signal);
  return handleResponse<T>(res);
}

/**
 * Fetch a server-rendered binary artifact (e.g. a printout PDF) with the same
 * origin resolution and auth as the JSON helpers. Callers open or download the
 * Blob themselves — nothing is generated in the browser (frontend §5.2).
 */
export async function apiGetBlob(path: string): Promise<Blob> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
  });
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
  return res.blob();
}

/**
 * Send a POST payload and receive a binary Blob (e.g. draft preview PDF).
 */
export async function apiPostBlob<B = unknown>(path: string, body?: B, signal?: AbortSignal): Promise<Blob> {
  const headers = buildHeaders();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    let problem: ApiProblem | undefined;
    try {
      problem = (await res.json()) as ApiProblem;
    } catch {
      // non-JSON error body
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
  return res.blob();
}

/**
 * Fetch an official PDF and send it straight to the printer: the bytes are
 * loaded into a hidden iframe as a blob and the *browser's PDF viewer* is
 * what prints, so what lands on paper is the server-rendered document
 * (deterministic SHA-256 bytes), never a print of the app screen. The iframe
 * is removed once the print dialog is dismissed.
 */
export async function printBlob(path: string): Promise<void> {
  const blob = await apiGetBlob(path);
  const url = window.URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = url;
  frame.title = "Official document print frame";
  const cleanup = () => {
    window.URL.revokeObjectURL(url);
    frame.remove();
  };
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // Some browsers refuse programmatic print on cross-origin-ish blob
      // frames — falling back to a visible tab still prints the true PDF.
      window.open(url, "_blank");
    }
    // Give the print dialog time to take the document before disposal.
    window.setTimeout(cleanup, 60_000);
  });
  document.body.appendChild(frame);
}
