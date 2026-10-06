import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router";
import { apiGet, apiPost, getAccessToken, refreshPlatformAccessToken, setAccessToken } from "../api/client.js";
import { useAuth } from "./AuthContext.js";

/**
 * Platform console identity (frontend.md §14, architecture §10). This is a
 * *different* principal from the tenant user in AuthContext: platform staff are
 * global (`platform_users`, no tenant) and hold a `platform` access token. The
 * two providers coexist so a tenant session and a platform session are never
 * confused — RequirePlatform renders the console only for the latter.
 */
export interface PlatformSession {
  platformUserId: string;
  email: string;
  name: string;
  sessionId: string;
  amr: string[];
}

interface PlatformAuthContextValue {
  platformSession: PlatformSession | null;
  isPlatformAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | undefined>(undefined);

interface PlatformSessionResponse {
  user?: { id: string; email: string; name: string } | null;
  sessionId?: string;
  amr?: string[];
}

function toSession(info: PlatformSessionResponse | null | undefined): PlatformSession | null {
  if (!info?.user?.id) return null;
  return {
    platformUserId: info.user.id,
    email: info.user.email,
    name: info.user.name,
    sessionId: info.sessionId ?? "",
    amr: info.amr ?? [],
  };
}

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [platformSession, setPlatformSession] = useState<PlatformSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // A hard reload drops the in-memory platform access token; exchange the
        // platform refresh cookie for a fresh one first. No-ops (null) when the
        // caller has no platform session, so this never touches the tenant flow.
        if (!getAccessToken()) {
          await refreshPlatformAccessToken();
        }
        const info = await apiGet<PlatformSessionResponse>("/auth/platform/session");
        if (!mounted) return;
        setPlatformSession(toSession(info));
      } catch {
        if (mounted) setPlatformSession(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await apiPost<{ accessToken?: string }>("/auth/platform/login", {
        email,
        password,
        ...(totp ? { totp } : {}),
      });
      if (res.accessToken) setAccessToken(res.accessToken);
      const info = await apiGet<PlatformSessionResponse>("/auth/platform/session");
      const next = toSession(info);
      if (!next) {
        // Login succeeded but the session could not be confirmed — treat as
        // signed out rather than showing a half-authenticated console.
        setAccessToken(null);
        throw new Error("Platform session could not be established.");
      }
      setPlatformSession(next);
    } catch (err: unknown) {
      const problem = (err as { problem?: { detail?: string; title?: string } })?.problem;
      setError(problem?.detail || problem?.title || (err as Error)?.message || "Invalid email or password.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/platform/logout");
    } catch {
      // ignore — clearing local state is what matters
    } finally {
      setAccessToken(null);
      setPlatformSession(null);
    }
  }, []);

  const value = useMemo<PlatformAuthContextValue>(
    () => ({
      platformSession,
      isPlatformAuthenticated: !!platformSession,
      isLoading,
      error,
      login,
      logout,
    }),
    [platformSession, isLoading, error, login, logout],
  );

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) {
    throw new Error("usePlatformAuth must be used within a PlatformAuthProvider");
  }
  return ctx;
}

/**
 * Route guard for `/platform/*` (frontend.md §14). A tenant user who reaches the
 * console gets a 403-style denial; an unauthenticated operator is sent to the
 * platform login. Purely presentational — the API's platform permissions are the
 * authority and reject tenant callers regardless.
 */
export function RequirePlatform({ children }: { children: ReactNode }) {
  const { platformSession, isLoading } = usePlatformAuth();
  const { isAuthenticated: tenantAuthenticated, isLoading: tenantLoading } = useAuth();
  const location = useLocation();

  if (isLoading || tenantLoading) {
    return (
      <div className="d-flex justify-content-center py-5" role="status" aria-live="polite">
        <span className="spinner-border text-secondary" aria-hidden="true" />
        <span className="visually-hidden">Checking platform access…</span>
      </div>
    );
  }

  if (platformSession) {
    return <>{children}</>;
  }

  if (tenantAuthenticated) {
    return (
      <div className="clinic-card p-5 text-center" role="alert">
        <h2 className="h4">403 — Platform access only</h2>
        <p className="text-secondary mb-1">
          This console is reserved for platform operators, not clinic users.
        </p>
        <p className="small text-muted mb-0">
          Sign in with a platform account to continue.
        </p>
      </div>
    );
  }

  return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />;
}
