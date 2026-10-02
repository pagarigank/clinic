import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertBanner } from "@clinic/ui";
import { apiPost, ApiError } from "../../shared/api/client.js";
import { MODULE_CATALOGUE, MODULE_DEPENDENCIES, type ModuleKey } from "./moduleCatalogue.js";

/**
 * New tenant wizard — todo.md §1.7 / frontend.md §14.1.
 *
 * Steps: profile (name, slug with live format check) → modules → confirm.
 * The module step is the one that needs care:
 *   - a grid of module cards with plain-language descriptions and dependencies;
 *   - `Admin` is on and locked (everything depends on it);
 *   - ticking a dependent module auto-ticks its dependency and says why;
 *   - the right-hand live summary names what the tenant will run;
 *   - nothing is created until Confirm posts `modules[]` with the tenant.
 */

interface WizardTenant {
  id: string;
  name?: string;
  slug?: string;
  status?: string;
}

const SLUG_RE = /^[a-z0-9-]{2,60}$/;

export function NewTenantWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Manila");
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set(["admin", "patients"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValid = SLUG_RE.test(slug);

  const toggle = (key: ModuleKey) => {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Removing a module that others depend on is allowed here — the server
        // validates the final set and the summary surfaces the consequence.
        next.delete(key);
      } else {
        next.add(key);
        // Auto-tick hard dependencies with the reason shown beside the card.
        for (const dep of MODULE_DEPENDENCIES[key]) next.add(dep);
      }
      return next;
    });
  };

  const unmetDependencies = useMemo(() => {
    const problems: string[] = [];
    for (const key of selected) {
      for (const dep of MODULE_DEPENDENCIES[key]) {
        if (!selected.has(dep)) {
          problems.push(`${key} needs ${dep}`);
        }
      }
    }
    return problems;
  }, [selected]);

  const summary = useMemo(() => {
    const labels = MODULE_CATALOGUE.filter((m) => selected.has(m.key)).map((m) => m.label);
    if (labels.length <= 1) return "No additional modules selected yet.";
    return `This tenant will run ${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}.`;
  }, [selected]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ tenant: WizardTenant }>("/platform/tenants", {
        name: name.trim(),
        slug: slug.trim(),
        planId: "00000000-0000-4000-8000-000000000001",
        timezone,
        modules: Array.from(selected),
      });
      navigate(`/platform/tenants/${res.tenant?.id ?? ""}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.problem.title ?? err.problem.code
          : "The platform API could not create the tenant.",
      );
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <nav aria-label="Breadcrumb" className="small text-muted mb-1">
            <a href="/platform/tenants">Tenants</a> <span aria-hidden="true">/</span> New
          </nav>
          <h1 className="page-title">New tenant wizard</h1>
          <div className="page-subtitle">Platform scope — no patient data is available here.</div>
        </div>
      </div>

      <ol className="breadcrumb">
        <li className={`breadcrumb-item ${step === 1 ? "active" : ""}`} aria-current={step === 1 ? "step" : undefined}>Profile</li>
        <li className={`breadcrumb-item ${step === 2 ? "active" : ""}`} aria-current={step === 2 ? "step" : undefined}>Modules</li>
        <li className={`breadcrumb-item ${step === 3 ? "active" : ""}`} aria-current={step === 3 ? "step" : undefined}>Confirm</li>
      </ol>

      {error ? (
        <div className="mb-3">
          <AlertBanner severity="danger" title="Could not create tenant">{error}</AlertBanner>
        </div>
      ) : null}

      <div className="row g-4">
        <div className="col-lg-8">
          {step === 1 ? (
            <div className="clinic-card p-3">
              <h2 className="h5">Profile</h2>
              <div className="row g-3 mt-1">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold" htmlFor="wz-name">Clinic name *</label>
                  <input id="wz-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Makati Family Clinic" />
                </div>
                <div className="col-md-6">
                  <label className="form-label small fw-semibold" htmlFor="wz-legal">Legal entity name</label>
                  <input id="wz-legal" className="form-control" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Registered business name" />
                </div>
                <div className="col-md-6">
                  <label className="form-label small fw-semibold" htmlFor="wz-slug">Slug * <span className="text-muted">(subdomain + login identifier)</span></label>
                  <input
                    id="wz-slug"
                    className={`form-control font-monospace ${slug && !slugValid ? "is-invalid" : ""}`}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="makati-family"
                  />
                  {slug && !slugValid ? (
                    <div className="invalid-feedback">Lowercase letters, numbers, and hyphens (2–60 chars).</div>
                  ) : null}
                </div>
                <div className="col-md-6">
                  <label className="form-label small fw-semibold" htmlFor="wz-tz">Timezone</label>
                  <select id="wz-tz" className="form-select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    <option value="Asia/Manila">Asia/Manila (PHT)</option>
                  </select>
                </div>
              </div>
              <div className="d-flex justify-content-end mt-3">
                <button type="button" className="btn btn-cerulean" disabled={!name.trim() || !slugValid} onClick={() => setStep(2)}>
                  Next: modules
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="clinic-card p-3">
              <h2 className="h5">Modules</h2>
              <p className="small text-body-secondary">
                Ticking a dependent module auto-ticks its dependency and shows why. Admin and
                Patients are always on — every workflow starts from a registered patient.
              </p>
              <div className="row g-2">
                {MODULE_CATALOGUE.map((m) => {
                  const isOn = selected.has(m.key);
                  const locked = m.key === "admin";
                  const deps = MODULE_DEPENDENCIES[m.key];
                  return (
                    <div className="col-md-6" key={m.key}>
                      <div
                        className={`border rounded p-2 h-100 ${isOn ? "border-primary bg-primary-subtle" : ""}`}
                      >
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`mod-${m.key}`}
                            checked={isOn}
                            disabled={locked}
                            onChange={() => toggle(m.key)}
                          />
                          <label className="form-check-label fw-semibold" htmlFor={`mod-${m.key}`}>
                            {m.label}
                            {locked ? <span className="badge bg-secondary ms-1" title="Everything depends on Administration">locked</span> : null}
                          </label>
                          <div className="small text-muted">{m.description}</div>
                          {deps.length > 0 && isOn ? (
                            <div className="small text-warning-emphasis">
                              {deps.map((d) => MODULE_CATALOGUE.find((c) => c.key === d)?.label).join(" + ")} needed — auto-enabled
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {unmetDependencies.length > 0 ? (
                <div className="alert alert-warning py-2 small mt-3" role="alert">
                  Missing dependencies: {unmetDependencies.join("; ")}.
                </div>
              ) : null}
              <div className="d-flex justify-content-between mt-3">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="btn btn-cerulean" disabled={unmetDependencies.length > 0 || selected.size < 2} onClick={() => setStep(3)}>
                  Next: confirm
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="clinic-card p-3">
              <h2 className="h5">Confirm</h2>
              <dl className="row small mt-2 mb-3">
                <dt className="col-sm-4">Clinic name</dt>
                <dd className="col-sm-8">{name}</dd>
                <dt className="col-sm-4">Slug</dt>
                <dd className="col-sm-8 font-monospace">{slug}</dd>
                <dt className="col-sm-4">Timezone</dt>
                <dd className="col-sm-8">{timezone}</dd>
                <dt className="col-sm-4">Modules</dt>
                <dd className="col-sm-8">{Array.from(selected).join(", ")}</dd>
              </dl>
              <p className="small text-body-secondary">
                Creating puts the tenant in <strong>PROVISIONING</strong>; JOB-03 seeds only the
                entitled modules and activates the tenant when each is SEEDED. A failure compensates
                to PROVISIONING_FAILED and can be retried from the tenant page.
              </p>
              <div className="d-flex justify-content-between">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setStep(2)}>Back</button>
                <button type="button" className="btn btn-cerulean" disabled={busy} onClick={() => void submit()}>
                  {busy ? "Creating…" : "Create tenant"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right-hand live summary (frontend §14.1) */}
        <div className="col-lg-4">
          <div className="clinic-card p-3">
            <h2 className="h6">Live summary</h2>
            <p className="small">{summary}</p>
            <p className="small text-muted mb-0">
              Each module choice implies the seeded masters (service catalog, drug schedules, report
              templates) that JOB-03 will install for the branch service profile.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
