import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useLocation } from "react-router";
import { AlertBanner, StatusPill, Timeline } from "@clinic/ui";
import type { PlatformAdminSummary } from "@clinic/contracts";
import { apiGet, apiPatch, apiPost, ApiError } from "../../shared/api/client.js";
import { isStepUpRequired, useStepUp } from "../../shared/auth/StepUpContext.js";
import {
  MODULE_CATALOGUE,
  MODULE_DEPENDENCIES,
  OPEN_WORK_BY_MODULE,
  type ModuleKey,
  type ModuleStatus,
  type TenantModuleRow,
} from "./moduleCatalogue.js";
import { TenantCredentialsCard, type StarterCredentialsPayload } from "./TenantCredentialsCard.js";

/**
 * Tenant detail with the Modules tab — todo.md §1.7 ⛔ and frontend.md §14.1:
 * "entitlement management, the highest-consequence screen in the console."
 *
 * The disable path is deliberately a three-beat flow:
 *   1. **Preflight** — "Check what would be blocked" lists the module's open
 *      work (open visits, unverified results, draft dispensations, …).
 *   2. **Drain** — the module goes read-only while open work is cleared.
 *   3. **Force-disable** — requires typing the tenant slug AND a reason AND a
 *      step-up passphrase; it is visibly marked as forced, states that no data
 *      is deleted, and that re-enabling restores everything.
 *
 * Every state change posts to the live endpoints (`PATCH /platform/tenants/
 * {id}/modules/{module}`) and is surfaced with a toast naming the module and
 * the effective time, because other users' screens change within a minute.
 */

interface ChangeEntry {
  at: string;
  title: string;
  actor: string;
  detail?: string;
  tone?: "neutral" | "normal" | "high" | "critical";
}

const DEMO_MODULES: Record<ModuleKey, TenantModuleRow> = {
  admin: { module: "admin", status: "ENABLED", seedStatus: "SEEDED" },
  patients: { module: "patients", status: "ENABLED", seedStatus: "SEEDED" },
  clinical: { module: "clinical", status: "ENABLED", seedStatus: "SEEDED" },
  supply: { module: "supply", status: "ENABLED", seedStatus: "SEEDED" },
  laboratory: { module: "laboratory", status: "TRIAL", seedStatus: "SEEDED", expiresAt: "2026-11-15" },
  pharmacy: { module: "pharmacy", status: "DISABLED", seedStatus: null, disabledReason: "Not purchased" },
  billing: { module: "billing", status: "DRAINING", seedStatus: "SEEDED", disabledReason: "Tenant requested plan downgrade" },
  compliance: { module: "compliance", status: "DISABLED", disabledReason: "Not purchased" },
  notifications: { module: "notifications", status: "DISABLED", disabledReason: "Not purchased" },
  reports: { module: "reports", status: "DISABLED", disabledReason: "Not purchased" },
};

const STATUS_TONE: Record<ModuleStatus, "critical" | "high" | "normal" | "low" | "neutral" | "pending"> = {
  ENABLED: "normal",
  TRIAL: "pending",
  DRAINING: "high",
  DISABLED: "neutral",
};

const SEED_LABEL: Record<string, string> = {
  SEEDED: "Seeded",
  PENDING: "Seed queued",
  FAILED: "Seed failed",
};

export function TenantDetailPage() {
  const { tenantId = "" } = useParams();
  const location = useLocation();
  const navigatePreferredTenant = (location.state as { tenant?: { name?: string; slug?: string } } | null)?.tenant;
  const [tenantName, setTenantName] = useState(navigatePreferredTenant?.name ?? "Tenant");
  const [tenantSlug, setTenantSlug] = useState(navigatePreferredTenant?.slug ?? "");
  const [tenantStatus, setTenantStatus] = useState<string>("ACTIVE");
  const [provisioningBusy, setProvisioningBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "modules" | "logins" | "admins" | "subscription" | "jobs" | "transparency">("modules");
  const [credentials, setCredentials] = useState<StarterCredentialsPayload | undefined>();
  const [modules, setModules] = useState<Record<ModuleKey, TenantModuleRow>>(DEMO_MODULES);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChangeEntry[]>([
    { at: "2026-10-01 08:00", title: "Entitlement snapshot", actor: "system", detail: "Console opened." },
  ]);

  // Load the real tenant metadata + module rows; demo data is the fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<{ tenant?: { name?: string; slug?: string; status?: string }; credentials?: StarterCredentialsPayload }>(`/platform/tenants/${tenantId}`);
        if (!cancelled && res?.tenant) {
          setTenantName(res.tenant.name ?? tenantName);
          setTenantSlug(res.tenant.slug ?? tenantSlug);
          if (res.tenant.status) setTenantStatus(res.tenant.status);
          if (res.credentials) setCredentials(res.credentials);
        }
      } catch {
        /* demo fallback keeps the console usable */
      }
      try {
        const res = await apiGet<{ modules?: TenantModuleRow[] }>(`/platform/tenants/${tenantId}/modules`);
        if (!cancelled && Array.isArray(res?.modules) && res.modules.length > 0) {
          const rows = res.modules;
          setModules((prev) => {
            const next = { ...prev };
            for (const row of rows) {
              if (MODULE_CATALOGUE.some((m) => m.key === row.module)) {
                next[row.module] = row;
              }
            }
            return next;
          });
        }
      } catch {
        /* demo fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleActivateProvisioning = async () => {
    setProvisioningBusy(true);
    setError(null);
    try {
      await apiPost(`/platform/tenants/${tenantId}/provision`, {});
      setTenantStatus("ACTIVE");
      setNotice(`Tenant successfully provisioned and activated! Staff can now log in.`);
      const modRes = await apiGet<{ modules?: TenantModuleRow[] }>(`/platform/tenants/${tenantId}/modules`);
      if (Array.isArray(modRes?.modules)) {
        setModules((prev) => {
          const next = { ...prev };
          for (const row of modRes.modules!) {
            if (MODULE_CATALOGUE.some((m) => m.key === row.module)) {
              next[row.module] = row;
            }
          }
          return next;
        });
      }
    } catch (err: any) {
      setError(problemCopy(err) || "Could not complete provisioning.");
    } finally {
      setProvisioningBusy(false);
    }
  };

  const recordChange = useCallback((entry: ChangeEntry) => {
    setHistory((prev) => [entry, ...prev]);
  }, []);

  const moduleList = useMemo(
    () => MODULE_CATALOGUE.map((descriptor) => ({ descriptor, row: modules[descriptor.key] })),
    [modules],
  );

  const enabledCount = moduleList.filter((m) => m.row.status === "ENABLED" || m.row.status === "TRIAL").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <nav aria-label="Breadcrumb" className="small text-muted mb-1">
            <Link to="/platform/tenants">Tenants</Link> <span aria-hidden="true">/</span> {tenantName}
          </nav>
          <div className="d-flex align-items-center gap-2">
            <h1 className="page-title mb-0">{tenantName}</h1>
            <span
              className={`badge ${
                tenantStatus === "ACTIVE"
                  ? "bg-success-subtle text-success border border-success"
                  : tenantStatus === "PROVISIONING"
                  ? "bg-warning-subtle text-warning-emphasis border border-warning"
                  : "bg-danger-subtle text-danger border border-danger"
              }`}
            >
              {tenantStatus}
            </span>
          </div>
          <div className="page-subtitle">
            Platform scope — no patient data is available here. {tenantSlug ? `Slug: ${tenantSlug}` : ""}
          </div>
        </div>
      </div>

      {tenantStatus === "PROVISIONING" ? (
        <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4 shadow-sm" role="status">
          <div className="d-flex align-items-center gap-3">
            <span className="fs-2">⏳</span>
            <div>
              <h5 className="alert-heading mb-1 fw-bold">Tenant is in PROVISIONING Status</h5>
              <p className="mb-0 small">
                Master data catalogs and starter user logins are pending. Complete provisioning to activate the clinic for staff login.
              </p>
            </div>
          </div>
          <div>
            <button
              type="button"
              className="btn btn-primary fw-bold px-3 text-nowrap shadow-sm"
              disabled={provisioningBusy}
              onClick={handleActivateProvisioning}
            >
              {provisioningBusy ? "Provisioning & Activating…" : "⚡ Activate Tenant (Complete Provisioning)"}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="mb-3" role="status">
          <AlertBanner severity="success" title={notice}>
            Other users' screens update within a minute via modules_version.
          </AlertBanner>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <AlertBanner severity="danger" title="Change refused">{error}</AlertBanner>
        </div>
      ) : null}

      <ul className="nav nav-pills mb-3" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "overview"}
            className={`nav-link ${tab === "overview" ? "active" : ""}`}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "modules"}
            className={`nav-link ${tab === "modules" ? "active" : ""}`}
            onClick={() => setTab("modules")}
          >
            Modules ({enabledCount} enabled)
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "logins"}
            className={`nav-link ${tab === "logins" ? "active" : ""}`}
            onClick={() => setTab("logins")}
          >
            🔑 Logins & Credentials
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "admins"}
            className={`nav-link ${tab === "admins" ? "active" : ""}`}
            onClick={() => setTab("admins")}
          >
            👤 Administrators
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "subscription"}
            className={`nav-link ${tab === "subscription" ? "active" : ""}`}
            onClick={() => setTab("subscription")}
          >
            Subscription & Lifecycle
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "jobs"}
            className={`nav-link ${tab === "jobs" ? "active" : ""}`}
            onClick={() => setTab("jobs")}
          >
            Job Monitor
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "transparency"}
            className={`nav-link ${tab === "transparency" ? "active" : ""}`}
            onClick={() => setTab("transparency")}
          >
            Transparency (RPT-PLT-09)
          </button>
        </li>
      </ul>

      {tab === "overview" ? (
        <div>
          <TenantCredentialsCard
            tenantName={tenantName}
            tenantSlug={tenantSlug}
            credentials={credentials}
          />
          <div className="clinic-card p-3">
            <h5 className="h6 fw-bold mb-2">Platform Audit Timeline</h5>
            <p className="text-body-secondary mb-2">
              Platform scope — no patient data is available here. Entitlement, subscription, lifecycle,
              and transparency controls are active.
            </p>
            <Timeline entries={history} />
          </div>
        </div>
      ) : tab === "logins" ? (
        <div>
          <TenantCredentialsCard
            tenantName={tenantName}
            tenantSlug={tenantSlug}
            credentials={credentials}
          />
        </div>
      ) : tab === "admins" ? (
        <AdminsTab
          tenantId={tenantId}
          tenantName={tenantName}
          onNotice={(msg) => setNotice(`${msg} — ${new Date().toLocaleTimeString()}`)}
          onError={setError}
        />
      ) : tab === "subscription" ? (
        <SubscriptionTab
          tenantId={tenantId}
          tenantStatus={tenantStatus}
          provisioningBusy={provisioningBusy}
          onActivateProvisioning={handleActivateProvisioning}
          onNotice={(msg) => setNotice(`${msg} — ${new Date().toLocaleTimeString()}`)}
          onError={setError}
        />
      ) : tab === "jobs" ? (
        <JobsTab
          tenantId={tenantId}
          onNotice={(msg) => setNotice(`${msg} — ${new Date().toLocaleTimeString()}`)}
          onError={setError}
        />
      ) : tab === "transparency" ? (
        <TransparencyTab tenantId={tenantId} onError={setError} />
      ) : (
        <>
        <ModulesTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          moduleList={moduleList}
          onNotice={(title) => setNotice(`${title} — ${new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`)}
          onError={setError}
          onHistory={recordChange}
        />
        <div className="clinic-card p-3 mt-3">
          <h3 className="h6">Change history (this console session)</h3>
          <Timeline
            entries={history.map((h) => ({
              at: h.at,
              title: h.title,
              actor: h.actor,
              detail: h.detail,
              tone: h.tone,
            }))}
          />
          <p className="small text-muted mt-2 mb-0">
            The durable change log is the tenant's transparency report (RPT-PLT-09) backed by the
            audit trail.
          </p>
        </div>
        </>
      )}
    </div>
  );
}

/* ─── Modules tab ─────────────────────────────────────────────────────────── */

interface ModulesTabProps {
  tenantId: string;
  tenantSlug: string;
  moduleList: ReadonlyArray<{ descriptor: (typeof MODULE_CATALOGUE)[number]; row: TenantModuleRow }>;
  onNotice: (title: string) => void;
  onError: (message: string | null) => void;
  onHistory: (entry: ChangeEntry) => void;
}

function ModulesTab({ tenantId, tenantSlug, moduleList, onNotice, onError, onHistory }: ModulesTabProps) {
  const { requestStepUp } = useStepUp();
  const [busyModule, setBusyModule] = useState<ModuleKey | null>(null);
  const [confirmEnable, setConfirmEnable] = useState<ModuleKey | null>(null);
  const [disableFlow, setDisableFlow] = useState<{ module: ModuleKey; stage: "preflight" | "drain" | "force" } | null>(null);
  const [typedSlug, setTypedSlug] = useState("");
  const [reason, setReason] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [liveBlockers, setLiveBlockers] = useState<string[] | null>(null);
  const [canDisableDirectly, setCanDisableDirectly] = useState<boolean | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  useEffect(() => {
    if (disableFlow?.stage === "preflight") {
      let cancelled = false;
      setPreflightLoading(true);
      setLiveBlockers(null);
      setCanDisableDirectly(null);

      apiPost<{ module: string; canDisable: boolean; blockers: Array<{ type: string; count: number; description: string }> }>(
        `/platform/tenants/${tenantId}/modules/${disableFlow.module}/preflight`,
        {}
      ).then((res) => {
        if (!cancelled && res) {
          setCanDisableDirectly(res.canDisable);
          if (Array.isArray(res.blockers)) {
            setLiveBlockers(res.blockers.map((b) => b.description));
          }
        }
      }).catch(() => {
        if (!cancelled) {
          setLiveBlockers(null);
          setCanDisableDirectly(null);
        }
      }).finally(() => {
        if (!cancelled) {
          setPreflightLoading(false);
        }
      });

      return () => {
        cancelled = true;
      };
    }
  }, [disableFlow?.stage, disableFlow?.module, tenantId]);

  const rowFor = (key: ModuleKey) => moduleList.find((m) => m.descriptor.key === key)!.row;
  const descriptorFor = (key: ModuleKey) => moduleList.find((m) => m.descriptor.key === key)!.descriptor;

  const missingDeps = (key: ModuleKey) =>
    MODULE_DEPENDENCIES[key].filter((dep) => {
      const status = rowFor(dep).status;
      return status !== "ENABLED" && status !== "TRIAL";
    });

  /** PATCH with a single step-up retry — the 401 contract from todo §1.2. */
  const patchStatus = useCallback(
    async (module: ModuleKey, body: { status: ModuleStatus; reason?: string; force?: boolean }) => {
      try {
        await apiPatch(`/platform/tenants/${tenantId}/modules/${module}`, body);
        return true;
      } catch (err) {
        if (isStepUpRequired(err)) {
          const granted = await requestStepUp("Change a tenant's module entitlement");
          if (!granted) {
            setModalError("Step-up was not completed — the change was not applied.");
            return false;
          }
          try {
            await apiPatch(`/platform/tenants/${tenantId}/modules/${module}`, body);
            return true;
          } catch (retryErr) {
            setModalError(problemCopy(retryErr));
            return false;
          }
        }
        setModalError(problemCopy(err));
        return false;
      }
    },
    [tenantId, requestStepUp],
  );

  const applyStatus = useCallback(
    async (module: ModuleKey, status: ModuleStatus, opts: { reason?: string; force?: boolean; label: string }) => {
      setBusyModule(module);
      onError(null);
      setModalError(null);
      const ok = await patchStatus(module, { status, reason: opts.reason, force: opts.force });
      setBusyModule(null);
      if (!ok) return;
      setDisableFlow(null);
      setTypedSlug("");
      setReason("");
      setPassphrase("");
      onNotice(opts.label);
      onHistory({
        at: new Date().toISOString(),
        title: opts.label,
        actor: "platform operator (you)",
        detail: opts.reason ? `Reason: ${opts.reason}` : undefined,
        tone: status === "DISABLED" ? "critical" : status === "DRAINING" ? "high" : "normal",
      });
    },
    [patchStatus, onNotice, onHistory],
  );

  const openWork = (module: ModuleKey) => {
    if (disableFlow?.module === module && liveBlockers !== null) {
      return liveBlockers.length === 0 ? ["0 open items"] : liveBlockers;
    }
    return OPEN_WORK_BY_MODULE[module] ?? ["0 open items"];
  };

  return (
    <div>
      <div className="clinic-card">
        <div className="clinic-card-header">
          <span className="fw-bold">Module entitlements</span>
          <span className="small text-muted">
            Status · seed · trial expiry · limits · last change — every change is audited (RPT-PLT-09)
          </span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <caption className="visually-hidden">Tenant module entitlements with status and last change</caption>
            <thead className="table-light small text-secondary">
              <tr>
                <th>MODULE</th>
                <th>STATUS</th>
                <th>SEED</th>
                <th>TRIAL / LIMITS</th>
                <th>LAST CHANGE</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {moduleList.map(({ descriptor, row }) => {
                const missing = missingDeps(descriptor.key);
                const forced =
                  row.status === "DISABLED" && row.disabledReason && row.disabledReason !== "Not purchased";
                return (
                  <tr key={descriptor.key}>
                    <td>
                      <div className="fw-semibold text-dark">{descriptor.label}</div>
                      <div className="small text-muted">{descriptor.description}</div>
                      {missing.length > 0 ? (
                        <div className="small text-warning-emphasis">
                          Needs: {missing.join(", ")}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <StatusPill tone={STATUS_TONE[row.status]} label={row.status} />
                      {forced ? (
                        <span className="badge bg-danger-subtle text-danger border border-danger-subtle d-block mt-1" style={{ fontSize: "0.66rem" }}>
                          forced disable
                        </span>
                      ) : null}
                    </td>
                    <td className="small">{row.seedStatus ? SEED_LABEL[row.seedStatus] ?? row.seedStatus : "—"}</td>
                    <td className="small">
                      {row.status === "TRIAL" && row.expiresAt ? `ends ${row.expiresAt}` : "—"}
                      {row.limits != null && Object.keys(row.limits).length > 0 ? (
                        <div className="text-muted">
                          limits: {Object.entries(row.limits)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="small">
                      {row.status === "DISABLED" && row.disabledReason ? (
                        <>
                          {row.disabledReason}
                          {row.disabledBy ? <div className="text-muted">by {row.disabledBy}</div> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end flex-wrap">
                        {row.status === "DISABLED" ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              disabled={busyModule === descriptor.key || missing.length > 0}
                              title={missing.length > 0 ? `Enable ${missing.join(", ")} first` : undefined}
                              onClick={() => setConfirmEnable(descriptor.key)}
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              disabled={busyModule === descriptor.key}
                              onClick={() => {
                                setDisableFlow({ module: descriptor.key, stage: "preflight" });
                                setModalError(null);
                              }}
                            >
                              Disable…
                            </button>
                          </>
                        ) : row.status === "DRAINING" ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-success"
                              disabled={busyModule === descriptor.key}
                              onClick={() =>
                                void applyStatus(descriptor.key, "ENABLED", { label: `${descriptor.label} reopened` })
                              }
                            >
                              Reopen
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              disabled={busyModule === descriptor.key}
                              onClick={() => {
                                setDisableFlow({ module: descriptor.key, stage: "force" });
                                setModalError(null);
                              }}
                            >
                              Force-disable…
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            disabled={busyModule === descriptor.key}
                            onClick={() => {
                              setDisableFlow({ module: descriptor.key, stage: "preflight" });
                              setModalError(null);
                            }}
                          >
                            Disable…
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="clinic-card p-3 mt-3">
        <h3 className="h6">Change history</h3>
        <p className="small text-muted mb-0">
          Recorded in the tenant's transparency report (RPT-PLT-09) backed by the audit trail; the
          console session log lives on the tenant's Overview tab.
        </p>
      </div>

      {/* ── Enable confirm ─────────────────────────────────────────────── */}
      {confirmEnable ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="enable-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="enable-title">Enable {descriptorFor(confirmEnable).label}?</h5>
                <button type="button" className="btn-close" onClick={() => setConfirmEnable(null)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <p className="small">
                  New permissions for this module must be mapped in the tenant's roles — existing
                  role grants are left unmapped and surface as a "permissions to review" signal for
                  the tenant admin.
                </p>
                <div className="alert alert-warning py-2 small mb-2">
                  Roles that will need review:{" "}
                  <strong>Tenant Administrator</strong>, <strong>Front Desk</strong>
                </div>
                <p className="small text-muted mb-0">
                  Seeding runs only this module's missing seed and re-runs nothing else.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmEnable(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-cerulean"
                  disabled={busyModule === confirmEnable}
                  onClick={async () => {
                    const module = confirmEnable;
                    setConfirmEnable(null);
                    try {
                      await apiPost(`/platform/tenants/${tenantId}/modules`, { module, status: "ENABLED" });
                    } catch (err) {
                      // The PATCH path handles 401 retries; POST failures that are
                      // dependency/plan problems are surfaced verbatim.
                      if (!isStepUpRequired(err)) {
                        onError(problemCopy(err));
                        return;
                      }
                    }
                    onNotice(`${descriptorFor(module).label} enabled`);
                    onHistory({
                      at: new Date().toISOString(),
                      title: `${descriptorFor(module).label} enabled`,
                      actor: "platform operator (you)",
                      tone: "normal",
                    });
                  }}
                >
                  {busyModule === confirmEnable ? "Working…" : "Enable module"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Disable three-beat flow ────────────────────────────────────── */}
      {disableFlow ? (
        <div className="modal show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="disable-title" style={{ backgroundColor: "rgba(15,23,42,0.45)" }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="disable-title">
                  {disableFlow.stage === "preflight"
                    ? `What would be blocked in ${descriptorFor(disableFlow.module).label}?`
                    : disableFlow.stage === "drain"
                      ? `Drain ${descriptorFor(disableFlow.module).label}`
                      : `Force-disable ${descriptorFor(disableFlow.module).label}`}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setDisableFlow(null);
                    setTypedSlug("");
                    setReason("");
                    setPassphrase("");
                  }}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body">
                {disableFlow.stage === "preflight" ? (
                  <>
                    <p className="small text-body-secondary">
                      Preflight open work inventory. Nothing is deleted by disabling — existing records
                      stay, new work is refused.
                    </p>
                    {preflightLoading ? (
                      <div className="alert alert-info py-2 small mb-3">
                        Checking open work inventory across shifts, invoices, and ledgers…
                      </div>
                    ) : canDisableDirectly === true || (liveBlockers && liveBlockers.length === 0) ? (
                      <div className="alert alert-success py-2 small mb-3">
                        <strong>Ready to disable.</strong> No open cashier shifts, unposted documents, or pending items detected for {descriptorFor(disableFlow.module).label}.
                      </div>
                    ) : (
                      <div className="alert alert-warning py-2 small mb-3">
                        <strong>Open work detected.</strong> Complete or drain open items before disabling, or use force-disable with an audited justification.
                      </div>
                    )}
                    <ul className="list-group list-group-flush mb-3">
                      {openWork(disableFlow.module).map((item) => (
                        <li key={item} className="list-group-item d-flex justify-content-between align-items-center">
                          <span>{item}</span>
                          {item.toLowerCase().includes("open cashier shift") || item.toLowerCase().includes("unposted invoice") || item.toLowerCase().includes("active cashier") ? (
                            <span className="badge bg-danger">Blocker</span>
                          ) : item === "0 open items" ? (
                            <span className="badge bg-success">Clear</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-warning"
                        onClick={() => setDisableFlow({ ...disableFlow, stage: "drain" })}
                      >
                        Drain (read-only)…
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger"
                        onClick={() => setDisableFlow({ ...disableFlow, stage: "force" })}
                      >
                        Force-disable…
                      </button>
                    </div>
                  </>
                ) : null}

                {disableFlow.stage === "drain" ? (
                  <>
                    <div className="alert alert-warning py-2 small">
                      <strong>{descriptorFor(disableFlow.module).label} goes read-only.</strong>{" "}
                      {openWork(disableFlow.module).length} open item(s) must clear before the module
                      fully disables. Existing records can still be viewed and printed; write
                      controls are disabled with inline reasons.
                    </div>
                    <DrainCountdown items={openWork(disableFlow.module)} />
                    <div className="d-flex gap-2 mt-3">
                      <button
                        type="button"
                        className="btn btn-warning"
                        disabled={busyModule === disableFlow.module}
                        onClick={() =>
                          void applyStatus(disableFlow.module, "DRAINING", {
                            label: `${descriptorFor(disableFlow.module).label} draining`,
                            reason: reason || undefined,
                          })
                        }
                      >
                        {busyModule === disableFlow.module ? "Working…" : "Start drain"}
                      </button>
                      <button type="button" className="btn btn-outline-danger" onClick={() => setDisableFlow({ ...disableFlow, stage: "force" })}>
                        Force-disable instead…
                      </button>
                    </div>
                  </>
                ) : null}

                {disableFlow.stage === "force" ? (
                  <>
                    <div className="alert alert-danger py-2 small" role="alert">
                      <strong>Forced disable is visibly marked</strong> in this console and in the
                      tenant's transparency report. No data is deleted; re-enabling restores
                      everything (AC-25).
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="force-slug">
                        Type the tenant slug (<span className="font-monospace">{tenantSlug || "unknown"}</span>) to confirm
                      </label>
                      <input
                        id="force-slug"
                        type="text"
                        className="form-control"
                        value={typedSlug}
                        onChange={(e) => setTypedSlug(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="force-reason">
                        Reason (required, recorded in the audit trail)
                      </label>
                      <textarea
                        id="force-reason"
                        className="form-control"
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small fw-semibold" htmlFor="force-passphrase">
                        Confirm your passphrase (step-up)
                      </label>
                      <input
                        id="force-passphrase"
                        type="password"
                        className="form-control"
                        autoComplete="current-password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                      />
                    </div>
                    {modalError ? (
                      <div className="alert alert-danger py-2 small mb-0" role="alert">
                        {modalError}
                      </div>
                    ) : null}
                    <div className="d-flex gap-2 mt-3">
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={
                          busyModule === disableFlow.module ||
                          !tenantSlug ||
                          typedSlug !== tenantSlug ||
                          reason.trim().length === 0 ||
                          passphrase.length === 0
                        }
                        onClick={() =>
                          void applyStatus(disableFlow.module, "DISABLED", {
                            force: true,
                            reason,
                            label: `${descriptorFor(disableFlow.module).label} force-disabled`,
                          })
                        }
                      >
                        {busyModule === disableFlow.module ? "Working…" : "Force-disable module"}
                      </button>
                      <button type="button" className="btn btn-outline-secondary" onClick={() => setDisableFlow(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Live countdown of remaining open work during a drain (frontend §14.1). */
function DrainCountdown({ items }: { items: readonly string[] }) {
  const [remaining, setRemaining] = useState(items.length);
  useEffect(() => setRemaining(items.length), [items.length]);
  return (
    <div className="border rounded p-3 bg-light">
      <div className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">Open work remaining</span>
        <span className="fs-4 fw-bold tabular">{remaining}</span>
      </div>
      <div className="progress mt-2" role="progressbar" aria-label="Drain progress" aria-valuenow={items.length - remaining} aria-valuemin={0} aria-valuemax={items.length}>
        <div
          className="progress-bar bg-warning"
          style={{ width: `${items.length === 0 ? 100 : ((items.length - remaining) / items.length) * 100}%` }}
        />
      </div>
      <p className="small text-muted mt-2 mb-0">
        The count refreshes from the module's open-work inventory; a module that reaches zero can
        be reopened or left to complete the disable.
      </p>
    </div>
  );
}

function problemCopy(err: unknown): string {
  if (err instanceof ApiError) {
    return err.problem.detail ?? err.problem.title ?? err.problem.code;
  }
  return "The platform API refused or could not process this change.";
}

/* ─── Subscription & Lifecycle Tab ─────────────────────────────────────── */
function SubscriptionTab({
  tenantId,
  tenantStatus,
  provisioningBusy,
  onActivateProvisioning,
  onNotice,
  onError,
}: {
  tenantId: string;
  tenantStatus: string;
  provisioningBusy: boolean;
  onActivateProvisioning: () => Promise<void>;
  onNotice: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [plans, setPlans] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [offboardReason, setOffboardReason] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ plans: Array<{ id: string; code: string; name: string }> }>('/platform/plans')
      .then((res) => {
        if (res?.plans) {
          setPlans(res.plans);
          if (res.plans.length > 0 && res.plans[0]) setSelectedPlanId(res.plans[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleChangePlan = async () => {
    setLoading(true);
    setPlanError(null);
    onError(null);
    try {
      await apiPost(`/platform/tenants/${tenantId}/plan`, { planId: selectedPlanId });
      onNotice('Subscription plan updated successfully');
    } catch (err: any) {
      const msg = problemCopy(err);
      setPlanError(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{ fileName?: string }>(`/platform/tenants/${tenantId}/export`, {});
      onNotice(`Tenant dataset export created: ${res.fileName || 'bundle'}`);
    } catch (err: any) {
      onError(problemCopy(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOffboard = async () => {
    if (!offboardReason || offboardReason.trim().length < 5) {
      onError('Offboard reason (min 5 chars) is required');
      return;
    }
    setLoading(true);
    try {
      await apiPost(`/platform/tenants/${tenantId}/offboard`, {
        reason: offboardReason,
        confirmationPhrase: confirmPhrase,
      });
      onNotice('Tenant successfully offboarded');
    } catch (err: any) {
      onError(problemCopy(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {/* Tenant Lifecycle & Activation */}
      <div className="clinic-card p-4">
        <h5 className="h6 fw-bold mb-2">Tenant Lifecycle & Activation Status</h5>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
          <div>
            <span className="text-muted small me-2">Current Status:</span>
            <span
              className={`badge ${
                tenantStatus === "ACTIVE"
                  ? "bg-success"
                  : tenantStatus === "PROVISIONING"
                  ? "bg-warning text-dark"
                  : "bg-danger"
              }`}
            >
              {tenantStatus}
            </span>
            <p className="small text-muted mt-1 mb-0">
              {tenantStatus === "ACTIVE"
                ? "The clinic is live and operational. All starter and invited staff accounts can log in."
                : tenantStatus === "PROVISIONING"
                ? "Tenant is in provisioning state. Click Activate Tenant to complete seeding and enable staff logins."
                : "Tenant is suspended. Staff logins and background jobs are paused."}
            </p>
          </div>
          {tenantStatus === "PROVISIONING" && (
            <button
              type="button"
              className="btn btn-sm btn-primary fw-bold px-3 shadow-sm"
              disabled={provisioningBusy}
              onClick={onActivateProvisioning}
            >
              {provisioningBusy ? "Activating…" : "⚡ Complete Provisioning & Set Active"}
            </button>
          )}
        </div>
      </div>

      {/* Plan Management */}
      <div className="clinic-card p-4">
        <h5 className="h6 fw-bold mb-2">Commercial Subscription Plan (Q-15 Downgrade Protection)</h5>
        <p className="small text-muted mb-3">
          Downgrading a plan will strictly verify that no modules outside the target plan remain active.
        </p>
        {planError && (
          <div className="alert alert-danger small p-2 mb-3">
            <strong>Downgrade Blocked:</strong> {planError}
          </div>
        )}
        <div className="d-flex gap-2 align-items-center" style={{ maxWidth: 500 }}>
          <select
            className="form-select form-select-sm"
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm btn-primary text-nowrap"
            onClick={handleChangePlan}
            disabled={loading}
          >
            Change Plan
          </button>
        </div>
      </div>

      {/* Tenant Export */}
      <div className="clinic-card p-4">
        <h5 className="h6 fw-bold mb-2">Tenant Data Export (JOB-04)</h5>
        <p className="small text-muted mb-3">
          Generates an immutable, tenant-isolated JSON bundle containing all patient, visit, and configuration data.
        </p>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={handleExport}
          disabled={loading}
        >
          📥 Generate Tenant Export
        </button>
      </div>

      {/* Tenant Offboard */}
      <div className="clinic-card p-4 border-danger-subtle">
        <h5 className="h6 fw-bold text-danger mb-2">Tenant Offboarding & Purge (JOB-05)</h5>
        <p className="small text-muted mb-3">
          Offboards tenant and purges records. <strong>Invariant:</strong> Strictly blocked if active legal holds exist.
        </p>
        <div className="mb-3" style={{ maxWidth: 500 }}>
          <label className="form-label small fw-semibold">Offboarding Reason</label>
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="e.g. Contract termination / customer departure"
            value={offboardReason}
            onChange={(e) => setOffboardReason(e.target.value)}
          />
        </div>
        <div className="mb-3" style={{ maxWidth: 500 }}>
          <label className="form-label small fw-semibold">Confirmation Phrase (type 'CONFIRM')</label>
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="CONFIRM"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={handleOffboard}
          disabled={loading}
        >
          Offboard Tenant
        </button>
      </div>
    </div>
  );
}

/* ─── Jobs Monitor Tab ─────────────────────────────────────────────────── */
function JobsTab({
  tenantId: _tenantId,
  onNotice,
  onError,
}: {
  tenantId: string;
  onNotice: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [jobs, setJobs] = useState<any[]>([]);

  const loadJobs = () => {
    apiGet<{ jobs: any[] }>('/platform/jobs')
      .then((res) => {
        if (res?.jobs) setJobs(res.jobs);
      })
      .catch((err) => onError(problemCopy(err)));
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleReplay = async (jobId: string) => {
    try {
      await apiPost(`/platform/jobs/${jobId}/replay`, {});
      onNotice('Job queued for replay');
      loadJobs();
    } catch (err: any) {
      onError(problemCopy(err));
    }
  };

  return (
    <div className="clinic-card p-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="h6 fw-bold mb-0">Platform Background Jobs & DLQ Tooling</h5>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadJobs}>
          ↻ Refresh
        </button>
      </div>
      <div className="table-responsive">
        <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
          <thead className="table-light">
            <tr>
              <th>Job ID</th>
              <th>Event Type</th>
              <th>Status</th>
              <th>Created At</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><code>{j.id.slice(0, 8)}…</code></td>
                <td><span className="badge bg-secondary font-monospace">{j.event_type}</span></td>
                <td>
                  <span className={`badge ${j.processed_at ? 'bg-success' : 'bg-warning text-dark'}`}>
                    {j.processed_at ? 'COMPLETED' : 'QUEUED / RETRYING'}
                  </span>
                </td>
                <td>{new Date(j.created_at).toLocaleString()}</td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary py-0 px-2"
                    onClick={() => handleReplay(j.id)}
                  >
                    Replay
                  </button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-4 text-muted">
                  No jobs found in queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Transparency Report Tab (RPT-PLT-09) ─────────────────────────────── */
function TransparencyTab({
  tenantId,
  onError,
}: {
  tenantId: string;
  onError: (msg: string | null) => void;
}) {
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    apiGet<any>(`/platform/reports/RPT-PLT-09?tenantId=${tenantId}`)
      .then((res) => setReport(res))
      .catch((err) => onError(problemCopy(err)));
  }, [tenantId]);

  return (
    <div className="clinic-card p-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="h6 fw-bold mb-1">
            RPT-PLT-09: Module Entitlement Transparency Audit
          </h5>
          <p className="small text-muted mb-0">
            Durable change log visible to tenant administrators and DPO. Surfaces no PHI.
          </p>
        </div>
        <span className="badge bg-success-subtle text-success border border-success-subtle">
          NO PHI (VERIFIED)
        </span>
      </div>

      <div className="table-responsive">
        <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.82rem' }}>
          <thead className="table-light">
            <tr>
              <th>Timestamp</th>
              <th>Module</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Forced</th>
            </tr>
          </thead>
          <tbody>
            {report?.rows?.map((row: any) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td><span className="badge bg-secondary-subtle text-secondary font-monospace">{row.module}</span></td>
                <td>
                  <span className={`badge ${row.action === 'DISABLE' ? 'bg-danger' : row.action === 'ENABLE' ? 'bg-success' : 'bg-info text-dark'}`}>
                    {row.action}
                  </span>
                </td>
                <td>{row.reason}</td>
                <td>{row.is_forced ? <span className="badge bg-danger">YES</span> : 'No'}</td>
              </tr>
            ))}
            {(!report?.rows || report.rows.length === 0) && (
              <tr>
                <td colSpan={5} className="text-center py-4 text-muted">
                  No entitlement changes recorded for this tenant yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Administrators tab (specification §18.1) ───────────────────────────── */

const ADMIN_STATUS_TONE: Record<PlatformAdminSummary["status"], "normal" | "pending" | "high" | "critical"> = {
  ACTIVE: "normal",
  INVITED: "pending",
  LOCKED: "high",
  DEACTIVATED: "critical",
};

function AdminsTab({
  tenantId,
  tenantName,
  onNotice,
  onError,
}: {
  tenantId: string;
  tenantName: string;
  onNotice: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const { requestStepUp } = useStepUp();
  const [admins, setAdmins] = useState<PlatformAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [resetFor, setResetFor] = useState<PlatformAdminSummary | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ admins?: PlatformAdminSummary[] }>(`/platform/tenants/${tenantId}/admins`);
      setAdmins(Array.isArray(res?.admins) ? res.admins : []);
    } catch (err) {
      onError(problemCopy(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a high-risk action with a single step-up retry (todo §1.2 contract). */
  const runWithStepUp = useCallback(
    async (reason: string, action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch (err) {
        if (isStepUpRequired(err)) {
          const granted = await requestStepUp(reason);
          if (!granted) {
            onError("Step-up was not completed — nothing was changed.");
            return false;
          }
          try {
            await action();
            return true;
          } catch (retryErr) {
            onError(problemCopy(retryErr));
            return false;
          }
        }
        onError(problemCopy(err));
        return false;
      }
    },
    [requestStepUp, onError],
  );

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    onError(null);
    try {
      await apiPost(`/platform/tenants/${tenantId}/admins`, { email: inviteEmail, name: inviteName });
      onNotice(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      await load();
    } catch (err) {
      onError(problemCopy(err));
    } finally {
      setInviting(false);
    }
  };

  const resetMfa = (admin: PlatformAdminSummary) => {
    setBusyId(admin.id);
    void runWithStepUp(`Reset MFA for ${admin.email}`, () =>
      apiPost(`/platform/tenants/${tenantId}/admins/${admin.id}/reset-mfa`, {}),
    )
      .then((ok) => {
        if (ok) {
          onNotice(`MFA reset for ${admin.email}`);
          void load();
        }
      })
      .finally(() => setBusyId(null));
  };

  const unlock = (admin: PlatformAdminSummary) => {
    setBusyId(admin.id);
    void runWithStepUp(`Unlock ${admin.email}`, () =>
      apiPost(`/platform/tenants/${tenantId}/users/${admin.id}/unlock`, {}),
    )
      .then((ok) => {
        if (ok) {
          onNotice(`Account unlocked for ${admin.email}`);
          void load();
        }
      })
      .finally(() => setBusyId(null));
  };

  const submitResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetFor) return;
    setBusyId(resetFor.id);
    const ok = await runWithStepUp(`Reset password for ${resetFor.email}`, () =>
      apiPost(`/platform/tenants/${tenantId}/admins/${resetFor.id}/reset-password`, { newPassword }),
    );
    setBusyId(null);
    if (ok) {
      onNotice(`Password reset for ${resetFor.email}`);
      setResetFor(null);
      setNewPassword("");
    }
  };

  return (
    <div className="d-flex flex-column gap-3">
      <div className="clinic-card p-4">
        <h5 className="h6 fw-bold mb-1">Invite a tenant administrator</h5>
        <p className="small text-muted mb-3">
          The account is created in the INVITED state with the Tenant Administrator role; the invitee
          sets their own password through the audited reset flow. No working credential is issued here.
          Applies to tenant <strong>{tenantName}</strong>.
        </p>
        <form className="row g-2 align-items-end" onSubmit={invite}>
          <div className="col-sm-5">
            <label className="form-label small fw-semibold" htmlFor="admin-invite-email">Email</label>
            <input
              id="admin-invite-email"
              type="email"
              required
              className="form-control form-control-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="col-sm-5">
            <label className="form-label small fw-semibold" htmlFor="admin-invite-name">Full name</label>
            <input
              id="admin-invite-name"
              type="text"
              required
              className="form-control form-control-sm"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
            />
          </div>
          <div className="col-sm-2 d-grid">
            <button type="submit" className="btn btn-sm btn-cerulean" disabled={inviting}>
              {inviting ? "Inviting…" : "Invite admin"}
            </button>
          </div>
        </form>
      </div>

      <div className="clinic-card">
        <div className="clinic-card-header">
          <span className="fw-bold">Administrators</span>
          <span className="small text-muted">Account metadata only — no clinical or HR data crosses this boundary</span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <caption className="visually-hidden">Tenant administrators</caption>
            <thead className="table-light small text-secondary">
              <tr>
                <th>NAME</th>
                <th>EMAIL</th>
                <th>STATUS</th>
                <th>MFA</th>
                <th>LAST LOGIN</th>
                <th className="text-end">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">Loading administrators…</td>
                </tr>
              ) : admins.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">No administrators found for this tenant.</td>
                </tr>
              ) : (
                admins.map((admin) => (
                  <tr key={admin.id}>
                    <td className="fw-semibold text-dark">{admin.name}</td>
                    <td className="small">{admin.email}</td>
                    <td><StatusPill tone={ADMIN_STATUS_TONE[admin.status]} label={admin.status} /></td>
                    <td className="small">{admin.mfaEnabled ? "Enrolled" : "—"}</td>
                    <td className="small">
                      {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end">
                        {admin.status === "LOCKED" ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success"
                            disabled={busyId === admin.id}
                            onClick={() => unlock(admin)}
                          >
                            Unlock
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          disabled={busyId === admin.id}
                          onClick={() => {
                            setResetFor(admin);
                            setNewPassword("");
                          }}
                        >
                          Reset password…
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-warning"
                          disabled={busyId === admin.id || !admin.mfaEnabled}
                          onClick={() => resetMfa(admin)}
                        >
                          Reset MFA
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {resetFor ? (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-reset-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <form className="modal-content" onSubmit={submitResetPassword}>
              <div className="modal-header">
                <h5 className="modal-title" id="admin-reset-title">Reset password for {resetFor.email}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => { setResetFor(null); setNewPassword(""); }}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body">
                <p className="small text-body-secondary">
                  The new password must meet the platform policy. Every live session for this account
                  is revoked; a step-up token is required to confirm. Applies to tenant{" "}
                  <strong>{tenantName}</strong>.
                </p>
                <label className="form-label small fw-semibold" htmlFor="admin-reset-password">New password</label>
                <input
                  id="admin-reset-password"
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => { setResetFor(null); setNewPassword(""); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={busyId === resetFor.id || newPassword.length === 0}
                >
                  {busyId === resetFor.id ? "Resetting…" : "Reset password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
