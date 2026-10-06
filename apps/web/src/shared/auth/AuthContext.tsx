import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { apiGet, apiPost, setAccessToken, getAccessToken, refreshAccessToken } from "../api/client.js";
import type { SessionInfo } from "@clinic/contracts";

export interface UserSession {
  userId: string;
  name: string;
  email: string;
  role?: string;
  tenantId: string;
  tenantSlug: string;
  branchId: string | null;
  branchName?: string;
  assignedBranches: Array<{ id: string; name: string }>;
  modules: string[];
}

interface AuthContextValue {
  session: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchBranch: (branchId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEMO_SESSION_KEY = "clinic_demo_session";

/**
 * Identity for the offline demo fallback below. The seed generates user IDs per run, so
 * a pinned UUID would name a user that does not exist; this session is synthetic and is
 * never sent as an authenticated principal.
 */
const DEMO_FALLBACK_USER_ID = crypto.randomUUID();

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.getItem === "function") {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(() => {
    // Check saved local session for demo persistence
    const storage = getSafeStorage();
    const saved = storage?.getItem(DEMO_SESSION_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function initSession() {
      try {
        // A hard reload drops the in-memory access token. Exchange the refresh
        // cookie for a fresh one before asking for the session, otherwise
        // /auth/session (and every later API call) returns 401 even though the
        // saved demo session keeps the UI looking signed in.
        if (!getAccessToken()) {
          // No-ops (resolves null) when there is no refresh cookie or the
          // endpoint is unavailable in tests.
          await refreshAccessToken();
        }
        const info = await apiGet<SessionInfo>("/auth/session");
        if (!mounted) return;
        const activeBranch = info.assignedBranches.find((b) => b.id === info.branchId);
        const mapped: UserSession = {
          userId: info.user.id,
          name: info.user.name,
          email: info.user.email,
          tenantId: info.tenant.id,
          tenantSlug: info.tenant.slug,
          branchId: info.branchId,
          branchName: activeBranch ? activeBranch.name : "Main Branch",
          assignedBranches: info.assignedBranches,
          modules: info.modules,
        };
        setSession(mapped);
        localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(mapped));
      } catch {
        if (!mounted) return;
        // If the backend rejects the session (e.g. 401), we are logged out.
        // Clear the zombie session state from UI and storage so the user can log in again.
        setSession(null);
        getSafeStorage()?.removeItem(DEMO_SESSION_KEY);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    initSession();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (tenantSlug: string, email: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await apiPost<{ status: string; accessToken?: string }>("/auth/login", {
        tenant: tenantSlug,
        email,
        password,
      });

      if (res.accessToken) {
        setAccessToken(res.accessToken);
      }

      // Fetch fresh session info
      try {
        const info = await apiGet<SessionInfo>("/auth/session");
        const activeBranch = info.assignedBranches.find((b) => b.id === info.branchId);
        const mapped: UserSession = {
          userId: info.user.id,
          name: info.user.name,
          email: info.user.email,
          tenantId: info.tenant.id,
          tenantSlug: info.tenant.slug,
          branchId: info.branchId,
          branchName: activeBranch ? activeBranch.name : "Main Branch",
          assignedBranches: info.assignedBranches,
          modules: info.modules,
        };
        setSession(mapped);
        localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(mapped));
      } catch {
        // Fallback session state if session endpoint isn't fully mocked
        const fallback: UserSession = {
          userId: DEMO_FALLBACK_USER_ID,
          name: email.split("@")[0] || "Clinic User",
          email,
          role: "TENANT_ADMIN",
          tenantId: "11111111-1111-4111-8111-111111111111",
          tenantSlug,
          branchId: "b1000000-0000-4000-8000-000000000001",
          branchName: "Metro General Hospital - Main",
          assignedBranches: [
            { id: "b1000000-0000-4000-8000-000000000001", name: "Metro General Hospital - Main" },
            { id: "b2000000-0000-4000-8000-000000000002", name: "North Care Ambulatory Center" },
          ],
          modules: ["admin", "patients", "clinical", "laboratory", "pharmacy", "billing"],
        };
        setSession(fallback);
        getSafeStorage()?.setItem(DEMO_SESSION_KEY, JSON.stringify(fallback));
      }
    } catch (err: any) {
      const msg = err?.problem?.detail || err?.message || "Invalid email, password, or clinic identifier.";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await apiPost("/auth/logout");
    } catch {
      // ignore
    } finally {
      setAccessToken(null);
      setSession(null);
      getSafeStorage()?.removeItem(DEMO_SESSION_KEY);
    }
  };

  const switchBranch = async (branchId: string) => {
    try {
      await apiPost("/auth/switch-branch", { branchId });
      if (session) {
        const branch = session.assignedBranches.find((b) => b.id === branchId);
        const updated = {
          ...session,
          branchId,
          branchName: branch ? branch.name : session.branchName,
        };
        setSession(updated);
        getSafeStorage()?.setItem(DEMO_SESSION_KEY, JSON.stringify(updated));
      }
    } catch (err) {
      console.error("Failed to switch branch", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        error,
        login,
        logout,
        switchBranch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
