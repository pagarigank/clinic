import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertBanner, StatusPill } from "@clinic/ui";
import { apiGet } from "../../shared/api/client.js";
import type { StatusTone } from "@clinic/ui";

/**
 * Tenants list — frontend.md §14.1 (platform console, M1).
 *
 * Platform scope shows metadata only: counts, plans, module chips. No PHI is
 * ever fetched or rendered here (frontend §20 hard-blocks patient-scoped
 * surfaces in platform scope), and every page states that plainly.
 */

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan?: string | null;
  modules?: string[];
  branchCount?: number;
  activeUsers?: number;
  createdAt?: string;
  provisioningFailed?: boolean;
}

/** Demo rows follow the test-data convention (frontend §22): two shaped tenants. */
const DEMO_TENANTS: PlatformTenant[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Northwind Clinic",
    slug: "northwind",
    status: "ACTIVE",
    plan: "Growth",
    modules: ["admin", "patients", "clinical", "supply", "laboratory", "pharmacy", "billing"],
    branchCount: 2,
    activeUsers: 14,
    createdAt: "2026-09-12",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Southgate Medical",
    slug: "southgate",
    status: "ACTIVE",
    plan: "Starter",
    // The module-gating shape: deliberately admin + patients + supply only.
    modules: ["admin", "patients", "supply"],
    branchCount: 1,
    activeUsers: 4,
    createdAt: "2026-09-20",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Bonifacio Health Hub",
    slug: "bonifacio",
    status: "PROVISIONING_FAILED",
    plan: "Starter",
    modules: ["admin", "patients"],
    branchCount: 1,
    activeUsers: 0,
    createdAt: "2026-10-01",
    provisioningFailed: true,
  },
];

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "normal",
  PROVISIONING: "pending",
  PROVISIONING_FAILED: "critical",
  SUSPENDED: "high",
};

export function TenantsPage() {
  const [tenants, setTenants] = useState<PlatformTenant[]>(DEMO_TENANTS);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<{ tenants?: PlatformTenant[] }>("/platform/tenants");
        if (!cancelled && Array.isArray(res?.tenants) && res.tenants.length > 0) {
          setTenants(res.tenants);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.includes(q) || (t.plan ?? "").toLowerCase().includes(q),
    );
  }, [tenants, filter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenants</h1>
          <div className="page-subtitle">
            Platform scope — no patient data is available here.
          </div>
        </div>
        <Link to="/platform/tenants/new" className="btn btn-cerulean">
          + New tenant
        </Link>
      </div>

      {loadError ? (
        <div className="mb-3">
          <AlertBanner severity="warning" title="Live tenant list unavailable">
            Showing the local demonstration set. The platform API did not respond.
          </AlertBanner>
        </div>
      ) : null}

      <div className="clinic-card mb-3 p-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-6">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Filter by name, slug, or plan…"
              aria-label="Filter tenants"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="col-md-6 text-md-end text-muted small">
            {filtered.length} of {tenants.length} tenants
          </div>
        </div>
      </div>

      <div className="clinic-card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <caption className="visually-hidden">Platform tenants with plan, status, and entitled modules</caption>
            <thead className="table-light small text-secondary">
              <tr>
                <th>TENANT</th>
                <th>PLAN</th>
                <th>STATUS</th>
                <th>MODULES</th>
                <th className="text-end">BRANCHES</th>
                <th className="text-end">USERS</th>
                <th className="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="fw-semibold text-dark">{t.name}</div>
                    <div className="small text-muted font-monospace">{t.slug}</div>
                  </td>
                  <td>{t.plan ?? "—"}</td>
                  <td>
                    <StatusPill tone={STATUS_TONE[t.status] ?? "neutral"} label={t.status} />
                  </td>
                  <td>
                    <div className="d-flex gap-1 flex-wrap">
                      {(t.modules ?? []).map((m) => (
                        <span key={m} className="badge bg-light text-dark border" style={{ fontSize: "0.68rem" }}>
                          {m}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-end tabular">{t.branchCount ?? 0}</td>
                  <td className="text-end tabular">{t.activeUsers ?? 0}</td>
                  <td className="text-end">
                    <Link
                      to={`/platform/tenants/${t.id}`}
                      state={{ tenant: t }}
                      className="btn btn-sm btn-outline-primary"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
                    No tenants match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
