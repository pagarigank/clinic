import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { apiGet } from "../api/client.js";
import { useAuth } from "./AuthContext.js";

/**
 * Client mirror of the server's RBAC/entitlement model (architecture §5.3,
 * specification §2.3). The PermissionGuard/ModuleGuard on the API remain the
 * authority — this context only decides what the shell renders and which
 * routes are reachable, so a stale or missing payload degrades to "hide the
 * thing", never to "allow the thing" (the server still refuses the call).
 */

export interface AccessState {
  /** Permission codes held by the caller (from GET /auth/session). */
  permissions: ReadonlySet<string>;
  /** Modules the tenant is entitled to and that are active (TRIAL/ENABLED). */
  modules: ReadonlySet<string>;
  isLoading: boolean;
}

interface PermissionsContextValue extends AccessState {
  hasPermission: (code: string) => boolean;
  hasAnyPermission: (codes: readonly string[]) => boolean;
  hasAllPermissions: (codes: readonly string[]) => boolean;
  hasModule: (module: string) => boolean;
  /** Convenience: module active AND at least one of the codes held. */
  canAccess: (module: string, codes: readonly string[]) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | undefined>(undefined);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { session, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<AccessState>({
    permissions: new Set(),
    modules: new Set(),
    isLoading: true,
  });

  const load = useCallback(async () => {
    if (!session) {
      setState({ permissions: new Set(), modules: new Set(), isLoading: false });
      return;
    }
    try {
      const info = await apiGet<{ modules: string[]; permissions: string[] }>("/auth/session");
      setState({
        permissions: new Set(info.permissions ?? []),
        modules: new Set(info.modules ?? []),
        isLoading: false,
      });
    } catch {
      // Server unreachable: render nothing extra rather than guessing grants.
      // The API still enforces every check, so this is a visual-only degrade.
      setState({ permissions: new Set(), modules: new Set(), isLoading: false });
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<PermissionsContextValue>(
    () => ({
      ...state,
      hasPermission: (code) => state.permissions.has(code),
      hasAnyPermission: (codes) => codes.some((c) => state.permissions.has(c)),
      hasAllPermissions: (codes) => codes.every((c) => state.permissions.has(c)),
      hasModule: (mod) => state.modules.has(mod),
      canAccess: (mod, codes) => state.modules.has(mod) && codes.some((c) => state.permissions.has(c)),
      refresh: load,
    }),
    [state, load],
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (ctx) return ctx;
  // Fail-soft default for mounts without a provider (isolated component tests,
  // future islands): "no grants known" hides gated chrome but never grants
  // access — the API's guards remain authoritative for every real call.
  return {
    permissions: new Set(),
    modules: new Set(),
    isLoading: false,
    hasPermission: () => false,
    hasAnyPermission: () => false,
    hasAllPermissions: () => false,
    hasModule: () => false,
    canAccess: () => false,
    refresh: async () => {},
  };
}

/**
 * Route guard: renders children only when the tenant has the module and the
 * caller holds at least one of `codes`; otherwise shows a compact denial (or
 * redirects when `redirectTo` is given). Purely presentational — the API
 * rejects unauthorized calls regardless.
 */
export function RequirePermission({
  module,
  codes,
  children,
  redirectTo,
}: {
  module?: string;
  codes: readonly string[];
  children: ReactNode;
  redirectTo?: string;
}) {
  const { hasModule, hasAnyPermission, isLoading } = usePermissions();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center py-5" role="status" aria-live="polite">
        <span className="spinner-border text-secondary" aria-hidden="true" />
        <span className="visually-hidden">Checking access…</span>
      </div>
    );
  }

  const moduleOk = !module || hasModule(module);
  const permOk = hasAnyPermission(codes);

  if (!moduleOk || !permOk) {
    if (redirectTo) return <Navigate to={redirectTo} replace />;
    return (
      <div className="clinic-card p-5 text-center" role="alert">
        <h2 className="h4">Access restricted</h2>
        <p className="text-secondary mb-1">
          Your role does not include permission for this area{module && !moduleOk ? " (module not enabled for this clinic)" : ""}.
        </p>
        <p className="small text-muted mb-0">
          Ask a tenant administrator to grant{" "}
          <span className="font-monospace">{codes.join(" · ")}</span>
          {module ? (
            <>
              {" "}in the <span className="font-monospace">{module}</span> module
            </>
          ) : null}
          .
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
