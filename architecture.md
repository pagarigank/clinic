# Multi-Tenant Clinic Platform — Architecture

**Version:** 1.0 (draft for engineering review) · **Date:** 2026-09-30
**Companion docs:** [specification.md](specification.md) · [frontend.md](frontend.md) · [todo.md](todo.md)

---

## 1. Purpose & Scope

A SaaS platform on which many independent clinic organizations (**tenants**) run their operations on one deployment, with **strict, database-enforced data separation** between tenants.

Modules in scope:

| Module | Summary |
|---|---|
| Platform Console | Superadmin: create/suspend tenants, create tenant admins, enter any clinic (audited), platform reports |
| Tenant Administration | Branches, users, roles, settings, master data |
| Patients & Clinical | Master patient index, appointments, visits, notes, prescriptions, orders |
| **Central Supply** | Item master, suppliers, PR/PO, receiving, requisitions, issues, transfers, counts, disposal, recalls |
| **Laboratory** | Test catalog, orders, specimens, results, verification, critical values, QC, reports |
| **Pharmacy** | Drug master, prescription verification, FEFO dispensing, OTC sales, controlled-drug register |
| Billing (supporting) | Charges, invoices, payments, discounts, cashier shifts |
| Compliance & Audit | Audit trail, PHI access log, consents, data-subject requests, breach register |
| Background Jobs | 50 scheduled/event jobs (catalog in specification §14) |

Out of scope for v1 (tracked in todo.md "Later"): inpatient/ADT, HMO claims engine, BIR-accredited invoicing, imaging/PACS, instrument middleware beyond HL7/ASTM basics.

---

## 2. Design Principles (research-informed)

Findings from the research pass that shaped the design (sources in §22):

1. **Shared schema + `tenant_id` on every row + PostgreSQL Row-Level Security** is the recommended default for a B2B SaaS on Postgres. RLS acts as the infrastructure safety net; application-level filtering still targets the tenant explicitly (defense in depth, not either/or).
2. **Enable `FORCE ROW LEVEL SECURITY`**, run the app as a non-owner, non-`BYPASSRLS` role, and set tenant context with **transaction-local** settings so pooled connections cannot leak a previous tenant's context. Composite PK/FKs should include `tenant_id`, and CI must run cross-tenant negative tests.
3. **Beware `SECURITY DEFINER` functions** — they bypass RLS. We avoid them.
4. **Pharmacy stock is managed at batch level under FEFO** (first-expired-first-out) because expiry varies by batch, not product; alert at 90/60/30 days before expiry and quarantine near-expired stock.
5. **Central supply uses par / min-max replenishment** with requisitions from departments and perpetual inventory with cycle counts; lot-level recall tracing is a first-class need.
6. **Laboratory:** a complete, timestamped audit trail from order to report; two-step entry/verification with delta and critical-value checks; critical-value notification logging; LOINC-coded tests; HL7 v2 (ORM/ORU) and FHIR `DiagnosticReport` for interoperability.
7. **Philippines regulatory context:** health data is *sensitive personal information* under the Data Privacy Act (RA 10173); clinics/labs are Personal Information Controllers and this platform is their Processor. Dangerous drugs (RA 9165) require special-prescription handling, no refills, dispensing/record-keeping and periodic reporting. Specific legal periods and forms **must be confirmed with counsel/DPO** and are therefore configuration, not hard-coded.
8. **Job queue on Postgres (pg-boss 12.30.0)** avoids a Redis dependency and gives transactional enqueue inside the domain transaction (`SKIP LOCKED` claims, cron scheduling, retries, Drizzle adapter). Throughput needs here are modest. We still write idempotent handlers — see §12 for why "exactly-once" is a queue property, not a guarantee we rely on.

**Guiding rules**

- Isolation is enforced in **five layers** (§5), never by one.
- Stock changes are **append-only ledger entries**; balances are derived and reconcilable.
- Posted documents are immutable; corrections are reversals/amendments with reasons.
- Every PHI read and every write is attributable to a user, tenant, request, and (if applicable) a break-glass session.
- Modular monolith first; extract services only when measurements demand it.

---

## 3. Technology Stack & Decisions

| Concern | Choice | Rationale / ADR |
|---|---|---|
| Database | **PostgreSQL 17+** | RLS, partitioning, JSONB, FTS, `pg_trgm`, `SKIP LOCKED` |
| Runtime | **Node.js 22/24 LTS** | Required by Fastify 5.x and NestJS 11 |
| Backend | **Node.js + TypeScript + NestJS 11** (Fastify 5 adapter) | Modular structure, DI, OpenAPI generation, mature ecosystem |
| DB access | `node-postgres` + **Drizzle ORM** for typed queries; SQL-first migrations (dbmate / node-pg-migrate) | Explicit transactions for `SET LOCAL`; RLS DDL written as plain SQL |
| Job queue | **pg-boss 12.30.0** (Postgres-backed) | No extra infrastructure; cron + retries + named queue policies (`singleton`/`short`/`key_strict_fifo`) + Drizzle adapter. Floor: Node 22.12+, PostgreSQL 13+ (we run 17) |
| Frontend | **React 19.2 + TypeScript + Vite 7**, **Bootstrap 5.3.8 + react-bootstrap 2.10.10** — see ADR-8 | Requested stack; mobile-first grid, dark mode via `data-bs-theme` |
| Routing | **React Router 7** (data router / framework mode) | Nested module routes, loaders/actions, zod-validated search params |
| Forms & validation | **React Hook Form + Zod 4** | Shared schemas with backend contracts (`packages/contracts`) |
| Server state | **TanStack Query 5** | Cache keys carry `tenantId`; single-object option API |
| Local (offline) state | **Dexie** (IndexedDB) | See frontend.md §8 — offline outbox, never `localStorage` for data |
| Barcode | `BarcodeDetector` API with ZXing fallback | Camera scanning on mobile; GS1/DataMatrix labels |
| PDF/labels | Headless Chromium (Playwright) in a worker; ZPL/ESC-POS for labels/receipts | Letterhead reports, barcode labels |
| Object storage | S3-compatible (MinIO in dev) | Tenant-prefixed keys, pre-signed URLs |
| Auth | Argon2id passwords, TOTP MFA, short-lived JWT access + rotating refresh (httpOnly cookie) | §10 |
| Observability | OpenTelemetry → Prometheus/Grafana/Loki (or vendor) | `tenant_id` as a label, never PHI |
| Deploy | Docker images; Kubernetes or container platform; managed Postgres + PgBouncer (transaction mode) | §18 |
| Email / SMS | Provider abstraction (SMTP/API; local PH SMS gateway) | Outbox-driven |

**Version policy:** the `major.minor` of every runtime dependency is pinned in `package.json` (no `^` for Postgres-facing libs), Renovate opens PRs, and the full dependency set — plus the DB major version — is re-verified each quarter against security advisories.

**Key ADRs**

| # | Decision | Alternatives rejected |
|---|---|---|
| ADR-1 | Shared DB/schema with RLS | Schema-per-tenant (migration fan-out pain), DB-per-tenant (cost) — kept as *promotion path* for very large/regulated tenants via a tenant routing table |
| ADR-2 | Tenant → Branch → Stock Location hierarchy | Flat "clinic" = tenant (cannot model multi-branch companies) |
| ADR-3 | Single inventory ledger shared by Supply, Pharmacy, Lab | Separate stock tables per module (reconciliation drift) |
| ADR-4 | Superadmin enters a clinic via an audited *context switch* (“break-glass”) rather than a blanket cross-tenant PHI read | Policy `OR is_superadmin` on PHI tables (one bug = cross-tenant leak) |
| ADR-5 | pg-boss over BullMQ | Redis adds an operational dependency with no needed throughput gain |
| ADR-6 | Modular monolith + separate worker process (same codebase) | Microservices (premature) |
| ADR-7 | Append-only `stock_movements` + derived `stock_balances` with `CHECK (qty_on_hand >= 0)` | Mutable quantity column only (no audit, no reconciliation) |
| ADR-8 | Bootstrap **5.3.8 + react-bootstrap 2.10.10** on React 19.2, with every Bootstrap component behind `packages/ui` | Re-checked 2026-09-30: 3.0.0-beta.5 has been stale ~12 months and 2.10.10 is upstream's documented Bootstrap 5 line *and* already carries React 19 internal fixes. The `packages/ui` boundary is what makes this low-risk; 3.0-stable is a later upgrade, not a production bet |
| ADR-9 | **React Router 7** data router over TanStack Router | Ecosystem familiarity, smaller bundle, `zod`-validated search params are achievable either way; revisit if `frontend.md` §4 friction appears |
| ADR-10 | **Dexie + explicit offline outbox** with `Idempotency-Key` on every write, rather than full offline-first replication | Full sync engines (CRDT/vector clocks) are overkill and risky for clinical/financial integrity; we only offline *queue* writes and keep reads network-first |
| ADR-11 | Module entitlements live in a `tenant_modules` table and are enforced by an **application-layer module guard**, not by adding a module predicate to every RLS policy | RLS answers "which tenant"; entitlements answer "which module". Mixing them doubles the policy surface, slows every query, and couples the audited isolation mechanism to a commercial/billing concern. Keeping them orthogonal means a bug in entitlements can only *remove* access — the failure mode is a locked screen, not a data leak. Revocation is `DRAINING` → `DISABLED` (never delete) so re-enable is lossless |

### 3.1 ADR-8 in detail — the React-Bootstrap / React 19 compatibility note

This pairing is the one place where the "obvious" choice has a real caveat, so it is recorded explicitly. **Re-checked 2026-09-30 against the current release state, which reversed the earlier lean toward the beta:**

- **Bootstrap 5.3.8** (Aug 2025) is stable and is the last patch before 5.4.0. It gives us what we need regardless: native color modes via `data-bs-theme`, CSS-variable theming, and the SCSS `color-mode()` mixin. Pin `5.3.x`; treat 5.4 as a planned upgrade, not a surprise.
- **react-bootstrap 2.10.10** is npm `latest` *and* the version the project's own compatibility table still maps to Bootstrap v5. Its September 2025 release went beyond type fixes: "updates internal code for React 19 and removes deprecated methods".
- **react-bootstrap 3.0.0-beta.5** (22 Sep 2025) is the line that targets React 19 internals (drops `prop-types`, `clsx`, exports map, React 18+ only). But it has had **no release in ~12 months**, it is a pre-1.0 beta that does not support `^` ranges, and the upstream README still documents 2.x as the Bootstrap 5 line.

**Decision:** start on **React 19.2.x + Bootstrap 5.3.8 + react-bootstrap 2.10.10**. Take 3.0.0-stable as a scheduled upgrade *after* it ships GA, not as a production bet now.

**Non-negotiable part of this ADR, and the reason the decision is low-risk either way:** every Bootstrap-dependent component is abstracted behind our own design-system package (`packages/ui`). Nothing outside `packages/ui` may `import from 'react-bootstrap'` (enforced by an ESLint `no-restricted-imports` rule and a CI check). Because of that boundary, swapping react-bootstrap major versions is a `packages/ui` change, not an application change — which is what makes it acceptable to start on the stable line rather than waiting for the beta.

**Note on React itself:** React 19.2 is the current major (19.2.8, Jul 2026) and the React Compiler reached 1.0. Because the compiler removes most manual-memoisation need, the frontend does **not** prescribe `useMemo`/`useCallback`/`memo` discipline in review; performance work is measured (Lighthouse budgets, frontend §21) rather than defended with hand-written memoisation.

---

## 4. System Context & Containers

```mermaid
flowchart LR
  subgraph Clients
    SA[Superadmin Console<br/>React]
    TU[Tenant App<br/>React PWA - mobile first]
  end
  CDN[CDN / WAF] --> API
  SA --> CDN
  TU --> CDN
  subgraph Platform
    API[API - NestJS<br/>REST /api/v1]
    WRK[Worker - pg-boss handlers<br/>PDF, notifications, schedulers]
    PGB[PgBouncer<br/>transaction pooling]
    DB[(PostgreSQL<br/>RLS enforced)]
    REP[(Read replica<br/>reports)]
    OBJ[(Object storage<br/>tenant-prefixed)]
  end
  API --> PGB --> DB
  WRK --> PGB
  DB --> REP
  API --> OBJ
  WRK --> OBJ
  WRK --> MAIL[Email / SMS providers]
  LIS[Analyzers / external LIS<br/>HL7 v2, FHIR - later] -.-> API
```

Runtime processes (same repository, different entrypoints): `api` (HTTP), `worker` (queue consumers + schedulers), `migrator` (one-shot, owner role).

---

## 5. Multi-Tenancy Model

### 5.1 Hierarchy

```
Platform
 └── Tenant (company / organization)          ← isolation boundary
      ├── Branch (clinic location)            ← operational scope
      │    └── Stock Location (central store, pharmacy, lab, clinic room, quarantine, waste, in-transit)
      ├── Users (scoped to one tenant; assigned to 1..n branches)
      └── All clinical, inventory, billing data (tenant_id on every row)
```

A branch is more than a location row: it carries a **service profile** (what it operates — consultation only, embedded laboratory, pharmacy, …) and a **licence registry** (business permit, DOH LTO, FDA LTO — optional records; specification §19.8). The profile drives per-branch seeding (JOB-03), which licences JOB-13 reminds about, branch-scoped job behaviour (lab TAT/QC only where a lab exists), and compliance badges; it never gates access — a consultation-only clinic running on a business permit alone is a first-class configuration (Q-18).

### 5.2 Five isolation layers

| # | Layer | Mechanism |
|---|---|---|
| 1 | **Identity** | JWT carries `tenant_id`, `scope` (`tenant` \| `platform`), `user_id`, `branch_ids`, `roles`, `session_id`, optional `breakglass_id`. Tenant is *never* read from body/query/path. Subdomain (`{slug}.app.example`) must match the token tenant or the request is rejected (403). Superadmin uses a separate host (`console.app.example`). |
| 2 | **Application** | `TenantContext` (AsyncLocalStorage) set by guard; all repositories obtained via `withTenant()`; lint rule forbids importing the raw pool outside the DB module; every query also filters `tenant_id` explicitly. |
| 3 | **Database** | `ENABLE` + `FORCE ROW LEVEL SECURITY` on every table with `tenant_id`; runtime role is `NOSUPERUSER NOBYPASSRLS`; composite FKs include `tenant_id`; `WITH CHECK` blocks cross-tenant writes; no `SECURITY DEFINER`. |
| 4 | **Async & storage** | Job payloads always include `tenant_id`; workers re-enter tenant context per job. Object keys `t/{tenant_id}/…`; signed URLs ≤ 60 s; cache keys prefixed with tenant. |
| 5 | **Verification** | CI: auto-generated cross-tenant negative tests per table; schema linter fails the build if a table with `tenant_id` lacks RLS/FORCE/policy/index; production `rls.canary` job (JOB-18) probes with two canary tenants hourly. |

### 5.3 Module entitlements (which modules a tenant has)

Tenancy is not all-or-nothing. A tenant is granted a **set of modules** at creation, and every layer above the database is scoped to that set.

```
tenant_modules (tenant_id, module) → status ∈ { TRIAL, ENABLED, DRAINING, DISABLED }
modules: admin* · patients* · clinical · supply · laboratory · pharmacy · billing · compliance · notifications · reports
        (* always on; the platform console is never a tenant module)
```

| Concern | Decision |
|---|---|
| Where the truth lives | `tenant_modules` (ten rows max per tenant), read through the session builder; `tenants.modules_version` is the cache key. |
| Guard order | **tenant → module → permission → SoD → step-up.** A route declares its module at definition time (`@ModuleGuard('laboratory')`); a non-entitled module returns `403 MODULE_NOT_ENTITLED` before any permission or data access. `DRAINING` returns `403 MODULE_READ_ONLY` on writes. |
| Session shape | JWT carries `modules: [{module, status}]` and `modules_version`; the API revalidates against the cache on every request, so a change takes effect within `modules_cache_ttl` (60 s) or on the next token refresh. |
| Database | Entitlements are **not** re-implemented in RLS. RLS answers "which tenant"; entitlements answer "which module", and no table mixes the two concerns. Job dispatch and the report catalog are the two places that must read the set on the server. |
| Async | A job whose module is not entitled is never enqueued; already-queued jobs for a module being disabled are allowed to finish (that is what `DRAINING` is for) and are re-checked before each execution. |
| Reports | `/reports/catalog` returns only entitled modules' reports, so a supply-only tenant never sees `RPT-LAB-*`. |
| Migrations & jobs | Adding a new module is a deploy (code + catalogue row), never a per-tenant migration; existing tenants default to the module's `seed_status='PENDING'` and it activates when the superadmin ticks it. |
| Revocation | Disabling is `DRAINING` → `DISABLED`, never a delete. Nothing is purged, so re-enable restores every record, posting, and audit entry. Force-disable requires a typed reason and shows up in the tenant's transparency report (RPT-PLT-09). |
| Security posture | Entitlements narrow access; they never widen it. A user with every permission still gets `403` in a module the tenant does not have, and a break-glass session inherits the tenant's set, so the platform cannot reach a non-entitled module either. |
| **Fail-closed** | If the entitlement cache or `tenant_modules` is unreadable, the guard returns `503 UPSTREAM_UNAVAILABLE` and refuses. It never assumes "entitled" on error, and never honours a cached `ENABLED` past `modules_cache_ttl`. A dedicated `entitlement_evaluation_failure` counter + alert makes the outage visible instead of letting it read as a locked screen nobody investigates. |

### 5.4 Entitlements vs feature flags — two different things

`tenant_feature_flags` (M1, `platform.flag.write`) is a **release/rollout** mechanism. Module
entitlements are a **commercial capability**. They are not interchangeable, and the rules below exist
because conflating them is the most common way multi-tenant SaaS ships a data leak.

| | Feature flag | Module entitlement |
|---|---|---|
| Answers | "should this code path run for this user right now?" | "has this tenant bought/is trialling this capability?" |
| Owner | Engineering (rollout, kill switch) | Commercial + platform admin (plan, contract) |
| Lifetime | Minutes → weeks; deleted freely | Permanent; historical (`DRAINING`/`DISABLED` states retained for audit) |
| Namespace | `flag.*` in `tenant_feature_flags` | `module:<tenant>:<module>` in `tenant_modules` |
| Evaluated by | Frontend + backend, best-effort | Backend **authoritatively**; frontend only for nav affordances |
| On evaluator failure | Degrade to the flag's safe default | **Refuse the request** (fail-closed) |

**The three rules that follow from that table:**

1. **A feature flag may never gate a module.** No route's access depends on a flag; hiding a button or
   disabling a nav item is presentation only. Killing the clinical module is an entitlement change,
   because that is the one with a data-retention contract attached.
2. **Payment is not access.** A module becomes `ENABLED` when the entitlement row is written (plan
   change, `JOB-03` provision, or an explicit superadmin action), *not* when a payment webhook lands.
   Webhooks may enqueue that state change; they never grant it inline. This keeps a replayed,
   duplicated, or forged webhook from widening access.
3. **Evaluation is server-side, and the client's copy is a hint.** `/session` returns the module set
   for rendering; the API re-evaluates on every request. A tampered client can hide a module from
   itself but cannot reach one.

**Why not RLS per module?** Adding a module predicate to every policy would double the policy surface, slow every query, and couple the isolation mechanism (audited, canaried) to a commercial/billing concern. Keeping the two orthogonal means a bug in entitlements can only ever *remove* access, never leak it — the failure mode is a locked screen, not a breach.

### 5.5 Superadmin model (ADR-4)

| Capability | How it is enforced |
|---|---|
| Create tenants, tenant admins; list all tenants/users; suspend/reactivate; plans & flags | Administrative tables (`tenants`, `users`, `branches`, `subscriptions`…) have policy `tenant_id = tenant OR scope='platform'`. |
| See platform-wide metrics | Aggregate views/materialized views **without patient identifiers** (counts, usage, health). |
| Access a specific clinic's operational/PHI data | **“Enter clinic”**: superadmin selects tenant, supplies a *reason*; a `breakglass_sessions` row is created (time-boxed, default 60 min, renewable), a new JWT is minted with `scope='tenant'`, `tenant_id=<target>`, `breakglass_id`, and `acting_as_platform=true`. All actions are audited with the break-glass id; tenant admin is notified (configurable); a persistent banner shows in the UI. |
| Never possible | A single SQL statement spanning tenants' PHI tables. Cross-clinic PHI views do not exist by design. |

PHI tables therefore have only the strict policy (`tenant_id = current tenant`), while administrative tables add the platform clause.

### 5.6 Tenant resolution & login

1. `slug` → `tenant_directory(id, slug, status)` — a tiny non-PHI table with no RLS (granted narrowly), kept in sync by trigger.
2. App sets tenant context from the resolved id and authenticates the user *inside* that tenant context.
3. Suspended/offboarding tenants fail at step 1.

---

## 6. Database Architecture

### 6.1 Roles

```sql
CREATE ROLE clinic_owner  NOLOGIN;                                  -- owns objects; used by migrator only
CREATE ROLE clinic_app    LOGIN NOSUPERUSER NOBYPASSRLS;            -- api + worker
CREATE ROLE clinic_report LOGIN NOSUPERUSER NOBYPASSRLS;            -- read replica, reports
CREATE SCHEMA app AUTHORIZATION clinic_owner;                       -- helper functions
GRANT USAGE ON SCHEMA public, app TO clinic_app, clinic_report;
ALTER DEFAULT PRIVILEGES FOR ROLE clinic_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
-- append-only tables get explicit REVOKE UPDATE, DELETE (audit_log, stock_movements, phi_access_log)
```

### 6.2 Context helpers (SECURITY INVOKER)

```sql
CREATE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.is_platform() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.scope', true), '') = 'platform' $$;

CREATE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
```

### 6.3 Policy templates

```sql
-- (A) Tenant-owned PHI / operational table (strict)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients
  USING      (tenant_id = (SELECT app.tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()));

-- (B) Administrative table visible to platform scope (tenants, users, branches, subscriptions…)
CREATE POLICY tenant_or_platform ON users
  USING      (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()) OR (SELECT app.is_platform()));

-- (C) Partitioned high-volume table (audit_log, phi_access_log, stock_movements)
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  USING      (tenant_id = (SELECT app.tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.tenant_id()));
-- Partitions inherit the parent's policies ONLY when reached through the parent.
-- Therefore: REVOKE ALL ON the child partitions from the runtime role, and
-- grant on the partitioned parent only. See the partition rule in 6.4.
```

`(SELECT …)` wrapping lets the planner evaluate the function once. With no tenant set, `tenant_id = NULL` matches **zero rows** (fail-closed).

**Keep policy predicates index-friendly.** RLS predicates are planned before ordinary indexes are
chosen, so a policy that calls a non-inlinable or non-`LEAKPROOF` function degrades into a per-row
filter and can expose row counts through timing. Rules of thumb we enforce in review:

- `app.tenant_id()` / `app.is_platform()` are declared **`STABLE`**, so the planner may evaluate them once per statement.
- Compare bare columns to the function result; keep the wrapped form `(SELECT app.tenant_id())` so it is an InitPlan rather than a per-row call.
- Do not wrap the column side of the comparison, and do not put `arrayoverlap`, `texteq`, or enum-equality functions directly in a `USING` clause — they are not `LEAKPROOF` and will block index use.

### 6.4 Schema conventions

- **Partitioned tables (high volume: `audit_log`, `phi_access_log`, `stock_movements`, outbox-driven ledgers).** Policies on a partitioned parent are **not** applied to rows read by querying a child partition directly — this is the classic way an RLS guarantee is silently lost. Two enforced rules:
  1. **Never grant on a child partition.** `REVOKE ALL ON <table>_p2026m07 FROM app_runtime;` and grant only on the partitioned parent. Partition maintenance (JOB-08) creates children and immediately revokes.
  2. **No ad-hoc partition access.** All repository queries target the parent; a linter rule fails the build on any query whose target is a `_*_p20*` child.
  3. Partitioning is by month, and `tenant_id` stays the leading column of every child index so the policy predicate is still index-backed after a partition prune.
- **Correlation statistics.** Tenant-scoped data is heavily correlated (`tenant_id` → `branch_id` → date range), which the default planner estimates assume is independent and therefore get wrong. Create extended statistics for the pairs the hot queries filter on, e.g. `CREATE STATISTICS st_stock_tenant_branch (dependencies) ON tenant_id, branch_id FROM stock_movements;`
- **IDs:** UUIDv7 (time-ordered) `id`; every tenant table also has `UNIQUE (tenant_id, id)` so children can use **composite FKs**:
  `FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id)` — makes cross-tenant references impossible even without RLS.
- **Standard columns:** `tenant_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `row_version int` (optimistic locking); `deleted_at` on archivable master data; `branch_id` where branch-scoped.
- **Indexes:** `tenant_id` is the leading column of every hot-path index.
- **Types:** money `numeric(14,2)`, unit cost `numeric(14,4)`, quantities `numeric(14,3)` in **base UOM**; timestamps `timestamptz` (UTC) + tenant timezone (default `Asia/Manila`) for rendering/cron; dates for expiry.
- **Enums:** `text` + `CHECK` (easier migrations than PG enums) or lookup tables for tenant-configurable lists.
- **Naming:** `snake_case`, plural tables, `_id` FKs, `_at` timestamps.
- **Search:** `pg_trgm` + `unaccent` for patient/item/drug lookup; `tsvector` for notes (off by default for PHI notes).
- **Partitioning:** `audit_log`, `phi_access_log`, `stock_movements`, `notification_log` by month (range on time); hash-partition by `tenant_id` only if a table passes ~100M rows.
- **Migrations:** forward-only SQL, executed by `clinic_owner`; every migration touching a tenant table must include RLS/FORCE/policy/index (linter-enforced). Expand/contract for zero-downtime.
- **Sequences:** `number_sequences(tenant_id, branch_id, doc_type, period, last_value)` incremented with `UPDATE … RETURNING` inside the business transaction (gapless for ORs/invoices).

### 6.5 Request transaction wrapper

```ts
export async function withTenant<T>(ctx: RequestContext, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',  $1, true),   -- true = transaction-local
              set_config('app.user_id',    $2, true),
              set_config('app.scope',      $3, true),
              set_config('app.branch_id',  $4, true),
              set_config('app.request_id', $5, true)`,
      [ctx.tenantId ?? '', ctx.userId ?? '', ctx.scope, ctx.branchId ?? '', ctx.requestId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
```

Because settings are transaction-local, PgBouncer **transaction pooling** is safe. Every request/job runs in exactly one such transaction (or explicit sub-transactions via savepoints). No session-level `SET` is permitted (lint + connection-reset on checkout as a second guard).

### 6.6 DDL reference patterns

These five templates are the shapes that recur ~180 times. A migration that creates a table which does not fit one of them needs a design review.

**(a) Tenant-owned master/transactional table**

```sql
CREATE TABLE appointments (
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid        NOT NULL,
  branch_id    uuid        NOT NULL,
  patient_id   uuid        NOT NULL,
  practitioner_id uuid,
  starts_at    timestamptz NOT NULL,
  status       text        NOT NULL DEFAULT 'BOOKED'
               CHECK (status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT',
                                 'COMPLETED','CANCELLED','NO_SHOW')),
  row_version  int         NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  deleted_at   timestamptz,

  CONSTRAINT appointments_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  -- composite FK: makes a cross-tenant patient reference structurally impossible
  CONSTRAINT appointments_patient_fkey
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id)
);

-- every tenant table carries this pair, so children can form composite FKs
ALTER TABLE patients        ADD CONSTRAINT patients_tenant_id_id_key UNIQUE (tenant_id, id);
CREATE UNIQUE INDEX appointments_no_double_book
  ON appointments (tenant_id, practitioner_id, starts_at)
  WHERE status NOT IN ('CANCELLED','NO_SHOW');           -- exclusion constraint in prod

CREATE INDEX appointments_branch_time_idx ON appointments (tenant_id, branch_id, starts_at DESC);
CREATE INDEX appointments_patient_idx    ON appointments (tenant_id, patient_id, starts_at DESC);
```

**(b) Isolation block — required on every tenant table, generated by the migration helper**

```sql
SELECT app.apply_tenant_isolation('appointments');   -- ENABLE + FORCE + USING + WITH CHECK
```

Expands to exactly the policy block from §6.3. The helper is `SECURITY INVOKER` and simply emits the two `ALTER`s and the `CREATE POLICY`. The schema linter (§5.2 layer 5) additionally asserts that a `(tenant_id, …)` index exists.

**(c) Append-only ledger** (stock movements, audit log, controlled register, PHI access log)

```sql
CREATE TABLE stock_movements (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  location_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid,
  qty         numeric(14,3) NOT NULL CHECK (qty <> 0),   -- signed; base UOM
  uom_id      uuid NOT NULL,
  unit_cost   numeric(14,4),
  movement_type text NOT NULL
    CHECK (movement_type IN ('GRN','ISSUE_OUT','ISSUE_IN','DISPENSE','SALE',
      'PATIENT_RETURN','SUPPLIER_RETURN','ADJ_GAIN','ADJ_LOSS','COUNT_VARIANCE',
      'DISPOSAL','CONSUMPTION','TRANSFER_OUT','TRANSFER_IN','REVERSAL')),
  ref_type    text, ref_id uuid,          -- source document
  reversal_of uuid,                       -- points at the movement being reversed
  reason_code text, reason_note text,
  posted_by   uuid NOT NULL, request_id uuid NOT NULL,
  prev_hash   bytea, row_hash bytea        -- hash chain, see §15
) PARTITION BY RANGE (occurred_at);

REVOKE UPDATE, DELETE ON stock_movements FROM clinic_app, clinic_report;
CREATE RULE stock_movements_no_update AS ON UPDATE TO stock_movements DO INSTEAD NOTHING;
CREATE TRIGGER stock_movements_hash BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.chain_hash();
```

**(d) Balance projection guarded by constraints**

```sql
CREATE TABLE stock_balances (
  tenant_id    uuid NOT NULL,
  location_id  uuid NOT NULL,
  batch_id     uuid NOT NULL,
  qty_on_hand  numeric(14,3) NOT NULL DEFAULT 0,
  qty_reserved numeric(14,3) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  CONSTRAINT stock_balances_pk PRIMARY KEY (tenant_id, location_id, batch_id),
  -- the single most important constraint in the inventory engine
  CONSTRAINT stock_balances_nonneg
    CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand),
  CONSTRAINT stock_balances_batch_fkey
    FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches (tenant_id, id)
);
```

**(e) Gapless document numbering**

```sql
CREATE TABLE number_sequences (
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL,
  doc_type  text NOT NULL,           -- 'PO' | 'RX' | 'LAB' | 'INVOICE' | 'GRN' …
  period    text NOT NULL,           -- '2026' or '2026-03'
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch_id, doc_type, period)
);

-- called inside the business transaction; the row lock serialises concurrent issuers
CREATE FUNCTION app.next_doc_no(p_tenant uuid, p_branch uuid, p_type text, p_period text)
RETURNS text LANGUAGE sql AS $$
  UPDATE number_sequences SET last_value = last_value + 1
   WHERE tenant_id = p_tenant AND branch_id = p_branch
     AND doc_type = p_type AND period = p_period
  RETURNING p_type || '-' || p_period || '-' || lpad(last_value::text, 6, '0');
$$;
```

**Report performance pattern:** heavy reports read from a read replica (`clinic_report`) or from tenant-scoped materialized views refreshed nightly by JOB-19. Views are always defined with a `tenant_id` predicate so a replica connection without tenant context returns zero rows rather than everything.

### 6.7 Indexing and query patterns

| Pattern | Implementation |
|---|---|
| Tenant-scoped list | `WHERE tenant_id = app.tenant_id() AND … ` with a matching composite index led by `tenant_id` |
| Fuzzy person/item search | `pg_trgm` GIN index on a lowercased, unaccented generated column; `similarity() > 0.3`; results always re-checked exactly |
| Exact-identifier lookup | Unique btree on `(tenant_id, patient_no)` / `(tenant_id, accession_no)` |
| Date-ranged reports | `BRIN` on `timestamptz` for append-only tables; btree for selective ranges |
| Queue / worklists | Partial index on status: `WHERE status IN ('ORDERED','RESULTED')` |
| Ledger aggregation | Covering index `(tenant_id, item_id, occurred_at) INCLUDE (qty, unit_cost)` |
| `EXPLAIN` guard | CI runs `EXPLAIN (ANALYZE, BUFFERS)` on the 25 declared hot queries; regression > 2× fails the build |


---

## 7. Data Model Overview

```mermaid
erDiagram
  TENANT ||--o{ BRANCH : has
  TENANT ||--o{ USER : has
  TENANT ||--o{ TENANT_MODULE : entitled_to
  BRANCH ||--o{ STOCK_LOCATION : has
  TENANT ||--o{ PATIENT : owns
  PATIENT ||--o{ VISIT : has
  VISIT ||--o{ PRESCRIPTION : orders
  VISIT ||--o{ LAB_ORDER : orders
  PRESCRIPTION ||--o{ DISPENSE : fulfilled_by
  LAB_ORDER ||--o{ LAB_ORDER_ITEM : contains
  LAB_ORDER_ITEM ||--o{ LAB_RESULT : yields
  ITEM ||--o{ STOCK_BATCH : has
  STOCK_BATCH ||--o{ STOCK_BALANCE : held_at
  STOCK_LOCATION ||--o{ STOCK_BALANCE : holds
  STOCK_MOVEMENT }o--|| STOCK_BATCH : moves
  PURCHASE_ORDER ||--o{ GOODS_RECEIPT : received_by
  REQUISITION ||--o{ ISSUE : fulfilled_by
  DISPENSE ||--o{ STOCK_MOVEMENT : posts
  GOODS_RECEIPT ||--o{ STOCK_MOVEMENT : posts
  ISSUE ||--o{ STOCK_MOVEMENT : posts
  VISIT ||--o{ INVOICE : billed_by
```

The full table catalog (columns, constraints) is in **specification.md §4–§13**.

### 7.1 Inventory core (Supply + Pharmacy + Lab reagents share this)

```mermaid
erDiagram
  ITEM ||--o{ ITEM_CATEGORY : "classified by"
  ITEM ||--o{ UOM_CONVERSION : "converts"
  ITEM ||--o{ LOCATION_ITEM_PARAM : "min/max/par per location"
  ITEM ||--o{ STOCK_BATCH : "arrives as"
  ITEM ||--o{ LAB_TEST_REAGENT : "BOM component"
  SUPPLIER ||--o{ PURCHASE_ORDER : "quoted by"
  PURCHASE_ORDER ||--o{ GOODS_RECEIPT : "received by"
  GOODS_RECEIPT ||--o{ STOCK_BATCH : "creates"
  STOCK_LOCATION ||--o{ STOCK_BATCH : "holds"
  STOCK_BATCH ||--o{ STOCK_BALANCE : "balances at"
  STOCK_BATCH ||--o{ STOCK_MOVEMENT : "moves via"
  STOCK_LOCATION ||--o{ REQUISITION : "requests from"
  REQUISITION ||--o{ ISSUE : "fulfilled by"
  ISSUE ||--o{ ISSUE_LINE : "contains"
  ISSUE_LINE }o--|| STOCK_BATCH : "allocates FEFO"
  DISPENSE ||--o{ DISPENSE_ITEM : "contains"
  DISPENSE_ITEM }o--|| STOCK_BATCH : "records lot used"
  DISPENSE ||--o{ CONTROLLED_REGISTER : "writes register line"
  PHYSICAL_COUNT ||--o{ PHYSICAL_COUNT_LINE : "counts"
  RECALL ||--o{ RECALL_BATCH : "quarantines"
```

**Invariants asserted by tests, not just by review:**

- `SUM(stock_movements.qty) GROUP BY (location, batch) == stock_balances.qty_on_hand` — checked nightly by JOB-32 and continuously in integration tests.
- `stock_balances.qty_reserved <= qty_on_hand` (DB constraint).
- Every `stock_movements` row has a non-null `ref_type/ref_id` **except** `COUNT_VARIANCE` and `ADJ_*`, which must carry a `reason_code`.
- `REVERSAL` movements must reference exactly one `reversal_of`, and the referenced movement must not itself be a reversal (no chains).
- A `stock_batches.status <> 'AVAILABLE'` batch has zero selectable balance (enforced in the FEFO query and asserted in tests).

### 7.2 Laboratory

```mermaid
erDiagram
  LAB_ORDER ||--o{ LAB_ORDER_ITEM : "expands panels into"
  LAB_TEST ||--o{ LAB_ORDER_ITEM : "is"
  LAB_TEST ||--o{ LAB_ANALYTE : "yields"
  LAB_ORDER_ITEM ||--o{ SPECIMEN : "sampled by"
  SPECIMEN ||--o{ SPECIMEN_EVENT : "chain of custody"
  LAB_ORDER_ITEM ||--o{ LAB_RESULT : "produces"
  LAB_ANALYTE ||--o{ LAB_REFERENCE_RANGE : "flagged against"
  LAB_ANALYTE ||--o{ LAB_DELTA_RULE : "delta checked by"
  LAB_RESULT ||--o{ LAB_RESULT_AMENDMENT : "corrected by"
  LAB_RESULT ||--o| LAB_CRITICAL_NOTIFICATION : "escalates"
  LAB_ORDER ||--o{ LAB_REPORT : "rendered as versioned PDF"
  LAB_INSTRUMENT ||--o{ LAB_RESULT : "measured by"
  LAB_INSTRUMENT ||--o{ LAB_QC_RUN : "quality controlled by"
  LAB_QC_RUN ||--o{ LAB_QC_RESULT : "levels"
  LAB_ORDER_ITEM ||--o| LAB_SEND_OUT : "referred out"
  LAB_ORDER_ITEM ||--o{ STOCK_MOVEMENT : "consumes reagents"
```

`lab_results` is the highest-integrity table in the system: value + unit + flag + `status` are written once, then only ever superseded by a new `lab_result_amendments` row. Verified rows are protected by a trigger that raises on `UPDATE`/`DELETE`.

### 7.3 Pharmacy

```mermaid
erDiagram
  VISIT ||--o{ PRESCRIPTION : "issues"
  PRESCRIPTION ||--o{ PRESCRIPTION_ITEM : "contains"
  DRUG_PRODUCT ||--o{ PRESCRIPTION_ITEM : "prescribed as"
  PRESCRIPTION ||--o{ DISPENSE : "dispensed by"
  DISPENSE ||--o{ DISPENSE_ITEM : "contains"
  DISPENSE_ITEM }o--o| PRESCRIPTION_ITEM : "satisfies"
  DRUG_PRODUCT }o--|| ITEM : "is stocked as"
  DISPENSE ||--o{ MEDICATION_ADMINISTRATION : "administered in clinic"
  PRESCRIPTION ||--o{ PHARMACIST_INTERVENTION : "queries raised"
  CONTROLLED_REGISTER }o--|| DISPENSE : "evidences"
  SPECIAL_RX_RECORD ||--o{ CONTROLLED_REGISTER : "authorises"
  DRUG_PRODUCT }o--o{ DRUG_INTERACTION : "interacts with"
  PATIENT }o--o{ PATIENT_ALLERGY : "allergic to"
```

The two join tables that carry the safety logic are `prescription_items → dispense_items` (for **partial fills**; a prescription is `DISPENSED` when Σ dispensed ≥ Σ prescribed per item, and partial fills keep the remainder open until `valid_until`) and `dispense → controlled_register` (for **perpetual controlled-drug accounting**).

### 7.4 Clinical, platform and compliance

```mermaid
erDiagram
  TENANT ||--o{ BRANCH : "has"
  TENANT ||--o{ USER : "employs"
  USER ||--o{ USER_ROLE : "granted"
  ROLE ||--o{ ROLE_PERMISSION : "grants"
  USER }o--o{ BRANCH : "assigned to"
  PLATFORM_USER ||--o{ BREAKGLASS_SESSION : "opens"
  BREAKGLASS_SESSION ||--o{ AUDIT_LOG : "attributes"
  PATIENT ||--o{ VISIT : "attends"
  VISIT ||--o{ CLINICAL_NOTE : "documented by"
  VISIT ||--o{ VISIT_DIAGNOSIS : "diagnosed"
  PATIENT ||--o{ PROBLEM_LIST : "carries"
  VISIT ||--o{ APPOINTMENT : "resolves from"
  APPOINTMENT ||--o| QUEUE_TICKET : "queues into"
  VISIT ||--o{ INVOICE : "billed by"
  INVOICE ||--o{ PAYMENT : "settled by"
  PATIENT ||--o{ PHI_ACCESS_LOG : "accessed in"
  PATIENT ||--o{ DATA_SUBJECT_REQUEST : "requests over"
```

`phi_access_log` and `audit_log` reference `patient_id`/`entity_id` **without** cascading deletes: erasure anonymizes the patient, it never removes the evidence that access occurred.


---

## 8. Unified Inventory Architecture

Pharmacy stock, lab reagents, and general supplies share one engine so that *central supply → pharmacy/lab → patient* is traceable by batch.

### 8.1 Concepts

| Concept | Description |
|---|---|
| `items` | One master for all stockable things; `item_type ∈ {DRUG, LAB_REAGENT, MEDICAL_SUPPLY, CONSUMABLE, OFFICE, OTHER}`; `drug_products` and `lab_tests` link to items. |
| `stock_locations` | Per branch: `CENTRAL_STORE`, `PHARMACY`, `LABORATORY`, `CLINIC_ROOM`, `QUARANTINE`, `WASTE`, `IN_TRANSIT`. |
| `stock_batches` | (item, lot no, expiry, supplier, unit cost, status `AVAILABLE/QUARANTINED/EXPIRED/RECALLED/DEPLETED`). |
| `stock_movements` | **Append-only** ledger; signed qty in base UOM; typed (`GRN`, `ISSUE_OUT`, `ISSUE_IN`, `DISPENSE`, `SALE`, `PATIENT_RETURN`, `SUPPLIER_RETURN`, `ADJ_GAIN`, `ADJ_LOSS`, `COUNT_VARIANCE`, `DISPOSAL`, `CONSUMPTION`, `TRANSFER_OUT`, `TRANSFER_IN`, `REVERSAL`) with `ref_type/ref_id`, reason, user, cost. |
| `stock_balances` | (tenant, location, batch) → `qty_on_hand`, `qty_reserved`; `CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand)`. Updated in the **same transaction** as the movement. |
| Costing | Batch-specific unit cost (specific identification); valuation = Σ balance × batch cost. |
| UOM | Base UOM per item with `uom_conversions`; documents store entered UOM + converted base qty. |

### 8.2 FEFO allocation (issue / dispense / consume)

```sql
SELECT bal.id, bal.batch_id, bal.qty_on_hand - bal.qty_reserved AS available
FROM   stock_balances bal
JOIN   stock_batches  b ON b.tenant_id = bal.tenant_id AND b.id = bal.batch_id
WHERE  bal.tenant_id = app.tenant_id()
  AND  bal.location_id = $1 AND bal.item_id = $2
  AND  bal.qty_on_hand - bal.qty_reserved > 0
  AND  b.status = 'AVAILABLE' AND b.expiry_date > CURRENT_DATE
ORDER  BY b.expiry_date ASC, b.received_at ASC, b.id
FOR UPDATE OF bal;                       -- deterministic order ⇒ no deadlocks
```

The service walks rows until the requested base quantity is satisfied, writes one movement per batch touched, updates balances, and fails the whole transaction if insufficient. Pharmacists may **override** batch choice (logged reason) — e.g., to use a specific lot; expired/quarantined/recalled batches can never be selected.

### 8.3 Consistency guarantees

- Movement + balance + source document status update commit atomically.
- Nightly `stock.balance.reconcile` (JOB-32) recomputes balances from the ledger; any mismatch raises a high-severity alert and blocks the affected item/location until resolved.
- Posted documents cannot be edited; use `REVERSAL` movements referencing the original.
- Idempotency: every posting endpoint accepts `Idempotency-Key`; unique `(tenant_id, idempotency_key)` prevents double posting on retry.

### 8.4 Replenishment

- `location_item_params(min, max, par, reorder_point, lead_time_days)` per location.
- Pull: department requisition. Push: `par.replenishment.suggest` (JOB-30) drafts requisitions when balance < par.
- Purchasing: `po.reorder.suggest` (JOB-31) proposes PRs from central-store reorder points and usage.

---

## 9. Application Architecture (Modular Monolith)

```
apps/
  api/                     # NestJS HTTP
  worker/                  # pg-boss consumers, schedulers
  web/                     # React (tenant app + platform console routes)
packages/
  db/                      # migrations, drizzle schema, withTenant, RLS linter
  contracts/               # OpenAPI + zod schemas shared FE/BE
  domain/                  # pure domain logic (FEFO, flags, delta checks)
  jobs/                    # job definitions (name, schedule, handler, retry policy)
  ui/                      # shared React components (design system)
modules/ (inside api)
  platform  tenancy  iam  patients  clinical  lab  pharmacy  supply  billing
  compliance  notifications  reports  files  integrations
```

Rules: modules talk via **application services or domain events** (outbox), not each other's tables. `lab`/`pharmacy` call `supply.InventoryService` for all stock effects. Cross-module reads go through query services.

---

## 10. Authentication & Authorization

| Topic | Design |
|---|---|
| Passwords | Argon2id; breached-password check; min length 12; lockout with backoff; forced reset on admin-set password |
| MFA | TOTP mandatory for platform users, tenant admins, pharmacists (controlled drugs), lab verifiers; optional for others (tenant policy) |
| Tokens | 10-min access JWT; refresh in httpOnly, `SameSite=Strict`, `Secure` cookie, rotated with reuse detection; `session_id` revocable |
| RBAC | `permissions` (global catalog) → `roles` (per tenant, seeded from system templates) → `user_roles` (per branch or tenant-wide) |
| ABAC layers | (a) branch scope; (b) `patients.restricted` (VIP/staff records: explicit grant + reason); (c) `lab_tests.is_confidential` (e.g., HIV-related) requires `lab.result.view_confidential`; (d) controlled-drug actions require `pharmacy.controlled.*` + MFA step-up |
| Segregation of duties | Configurable: result entry ≠ verification; PO creator ≠ approver; adjustment requester ≠ approver; dispensing controlled drug needs witness |
| Step-up | Re-auth (password/TOTP) for void/refund, adjustment approval, controlled dispense, break-glass |
| Service accounts | Tenant API keys (hashed, scoped, rotatable) for instrument/LIS integrations; bound to one tenant |

Authorization is enforced in NestJS guards (`@RequirePermission('lab.result.verify')`) **and** re-checked in domain services for state transitions.

---

## 11. API Design

- REST JSON under `/api/v1`; OpenAPI generated; shared zod contracts.
- Resources are tenant-implicit (no tenant id in paths). Platform endpoints live under `/api/v1/platform/*` and require `scope=platform`.
- Collections: `GET /resources?filter[...]&sort=&page[size]=&page[cursor]=`; cursor pagination for ledgers/logs, offset allowed for small masters.
- Writes: `POST` create, `PATCH` partial update with `If-Match: <row_version>` (412 on conflict), `DELETE` = archive (soft) where allowed.
- Transitions: `POST /purchase-orders/{id}/approve`, `/lab-orders/{id}/verify`, `/dispenses/{id}/post` etc. Transitions are explicit verbs, validated against the state machine.
- Idempotency: `Idempotency-Key` header required on all posting/transition endpoints.
- Errors: RFC 9457 problem+json with stable `code` (e.g., `STOCK_INSUFFICIENT`, `BATCH_EXPIRED`, `TENANT_MISMATCH`).
- Rate limiting per user and per tenant; stricter on auth endpoints.
- Async operations (exports, big reports): `202 Accepted` + `/jobs/{id}` polling + notification.

### 11.1 Route topology

```
/api/v1
├── /auth/*                    public: login, refresh, logout, mfa/verify, password reset
├── /session                   current user, permissions, effective tenant, module entitlements
├── /me/*                      self-service: profile, password, mfa, preferences
├── /platform/*                scope=platform only (separate host in prod)
│   ├── /tenants               CRUD + /{id}/suspend /reactivate /provision /export
│   │                           POST body carries modules[] (ticked at creation)
│   ├── /tenants/{id}/admins   create, invite, reset, revoke
│   ├── /tenants/{id}/enter    break-glass session
│   ├── /tenants/{id}/modules  GET list · PUT replace set · PATCH /{module}
│   │                           POST /{module}/preflight | drain | disable | enable | reopen
│   ├── /users                 cross-tenant user directory (metadata only)
│   ├── /plans  /subscriptions /feature-flags /announcements /system-settings
│   ├── /breakglass            sessions
│   └── /reports/*             aggregate platform reports (no PHI)
├── /admin/*                   tenant admin: branches, users, roles, settings, masters, prices
├── /patients/*                + /{id}/merge /unmerge /history /documents /access-log
├── /clinical/*                schedules, appointments, queue, visits, notes, vitals,
│                              diagnoses, procedures, immunizations, prescriptions,
│                              certificates, referrals, order-sets, templates
├── /lab/*                     config (sections, tests, analytes, ranges, reagents,
│                              instruments, qc) + work (orders, specimens, results,
│                              verify, amend, critical, reports, send-outs, interfaces)
├── /pharmacy/*                products, generics, interactions, prices, dispenses,
│                              otc, returns, controlled-register, special-rx, interventions
├── /supply/*                  items, categories, uoms, suppliers, locations, params,
│                              pr, po, grn, requisitions, issues, transfers, adjustments,
│                              counts, disposals, recalls, consumption, stock
├── /billing/*                 invoices, charges, payments, credit-notes, shifts, discounts
├── /compliance/*              audit, phi-access, consents, dsr, breaches, retention,
│                              legal-holds, security-events, access-reviews
├── /reports/{id}              run a catalog report (RPT-*)
├── /reports/{id}/export       async export → job
├── /notifications/*           list, read, preferences, templates
├── /files/*                   presign, upload-complete, download
├── /jobs/{id}                 async operation status
├── /health  /ready  /metrics
└── /reference/*               read-only global reference (ICD-10, PSGC, LOINC subset…)
```

Module prefixes map 1:1 to NestJS modules and 1:1 to the frontend route tree in **frontend.md §7**. The full endpoint-by-endpoint CRUD/permission map lives in **specification.md §18**, and the permission names it uses are defined once in **specification.md §2.3**.

The prefix is also the **module key**: `/lab/*` is `laboratory`, `/supply/*` is `supply`, and so on, so the module guard can be derived from the route rather than maintained in a second table. Two prefixes are cross-cutting and therefore not gated as modules: `/admin/*` and `/session` (every tenant has `admin`), and `/reports/*`, which is gated on `reports` plus the underlying module of the report being run.

### 11.2 Error catalog

All errors are `application/problem+json` (RFC 9457) with a stable machine `code`, a human `title`, and optional `errors[]` for field-level detail. The frontend maps `code` → copy; it never parses `detail` text.

| Code | HTTP | Meaning |
|---|---|---|
| `TENANT_CONTEXT_MISSING` | 400 | No tenant context — a bug, fail-closed |
| `TENANT_MISMATCH` | 403 | Token tenant ≠ request tenant (subdomain/host) |
| `FORBIDDEN` / `PERMISSION_DENIED` | 403 | RBAC/ABAC denial |
| `STEP_UP_REQUIRED` | 401 | Re-authentication needed before this action |
| `BREAKGLASS_REQUIRED` | 403 | Clinical action attempted outside a break-glass session |
| `MODULE_NOT_ENTITLED` | 403 | The tenant does not have the module the route belongs to — checked **before** permissions, so it never leaks which permissions exist |
| `MODULE_READ_ONLY` | 403 | Module is `DRAINING`: reads and prints allowed, writes refused |
| `MODULE_DEPENDENCY_MISSING` | 422 | Requested module set omits a hard dependency (e.g. `laboratory` without `patients`) |
| `PLAN_MODULE_NOT_ALLOWED` | 422 | Requested module is not in the tenant plan's allowed set |
| `MODULE_HAS_OPEN_WORK` | 409 | Disable refused: preflight found open work; client must drain or force-disable with a reason |
| `NOT_FOUND` | 404 | Also returned for another tenant's id (no existence oracle) |
| `CONFLICT` | 409 | State-machine violation (e.g. verify an already-verified result) |
| `STALE_ROW_VERSION` | 412 | `If-Match` mismatch — client must refetch and reapply |
| `VALIDATION_FAILED` | 422 | Zod/domain validation; `errors[]` carries field paths |
| `STOCK_INSUFFICIENT` | 409 | Requested qty > available (on-hand − reserved) |
| `BATCH_EXPIRED` / `BATCH_QUARANTINED` / `BATCH_RECALLED` | 409 | Batch not selectable for the requested operation |
| `SHELF_LIFE_VIOLATION` | 422 | Received lot has less remaining shelf life than the tenant rule |
| `SEGREGATION_OF_DUTIES` | 403 | Actor == approver where policy forbids it |
| `MFA_REQUIRED` / `MFA_INVALID` | 401 | MFA policy |
| `PERIOD_LOCKED` | 409 | Accounting period closed; backdated posting refused |
| `QUOTA_EXCEEDED` | 429 | Plan limit (users, branches, storage) or rate limit |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key reused with a different payload |
| `UPSTREAM_UNAVAILABLE` | 502/503 | SMS/email/instrument interface failure (retryable) |

Error bodies **never** contain PHI beyond what the caller was already authorised to see, and the `stack` is only included when `NODE_ENV !== 'production'`.

### 11.3 Request pipeline

The order below is the **actual** NestJS execution order, not an aspirational one. NestJS runs
`middleware → guards → interceptors → pipes → handler`, so **guards run before validation**. This is
corrected from an earlier draft in this document, which put Zod before the module/permission guard —
that ordering is not expressible with a pipe.

```
CDN/WAF → rate limit → helmet/CSP → correlation id
  → [platform console host? platform guard]        ← middleware
  → tenant context guard (subdomain/host, withTenant) + break-glass check
  → MODULE guard  (@ModuleGuard('laboratory'))    ← guard 1: entitlement status
  → PERMISSION guard (@RequirePermission)         ← guard 2: RBAC/ABAC (+ SoD, step-up)
  → zod body/query/param validation                ← pipes (always AFTER guards)
  → interceptor (serialisation, redaction, logging, timeout)
  → service → domain validation → withTenant() transaction (set_config … SET LOCAL)
  → repository (explicit tenant_id + RLS)
  → audit/phi_access write (same transaction) → outbox insert (same transaction)
  → COMMIT → serialise (redaction) → access log
```

**How the guard order is guaranteed (and not left to luck):**

| Concern | Mechanism |
|---|---|
| Guard order | Guards run in **registration order**, so `ModuleGuard` is registered before `PermissionGuard`. Order is asserted by a unit test on the composed handler chain, not by a comment. |
| DI in guards | Guards are instantiated through the `APP_GUARD` provider token. We do **not** use `app.useGlobalGuards(new XGuard())` — instance-bound global guards are constructed outside the Nest injector and silently lose DI (including the entitlement cache and `ConfigService`). |
| Guard scope | Tenant/module guards are `APP_GUARD` (global, so a forgotten decorator cannot leak). `@ModuleGuard()` is a *declarative annotation* read by the global guard to learn the route's module, and throws at bootstrap if a route outside the allow-list carries no module — so adding a route without a module fails the build/start, not production. |
| Pre-validation 403s | Because guards precede pipes, a malformed body sent to a non-entitled module returns `403 MODULE_NOT_ENTITLED`, not `422`. This is intended: it avoids turning entitlement into a validation oracle, and it is asserted in AC-23. |
| Cheap only | Guards stay cheap and declarative. Anything that must be true "inside the same transaction as the write" (audit row, outbox event, stock movement) is done by the service layer, never by a guard. |

**Fail-closed on evaluation failure.** If the entitlement cache or `tenant_modules` cannot be read, the
module guard returns `503 UPSTREAM_UNAVAILABLE` and refuses the request. It never falls back to
"assume entitled" (fail-open) and never caches a stale `ENABLED` past `modules_cache_ttl`; the
outage is visible as a dedicated metric + alert rather than as users reaching data they should not.

---

## 12. Background Jobs Architecture

| Aspect | Design |
|---|---|
| Engine | pg-boss in the same Postgres (separate schema `pgboss`); multiple worker replicas. On PostgreSQL pg-boss claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, which is what backs its "exactly-once delivery" claim — we still keep handlers idempotent, because a worker crash after the side effect and before the completion commit is not preventable by locking. |
| Isolation level | The API transaction is `READ COMMITTED`. If we ever enable pg-boss's `noSkipLocked` fetch path (atomic `UPDATE … RETURNING`), we set `SERIALIZABLE` for that connection, which is upstream's recommendation for exactly-once on that path. Default path does not need it. |
| Types | **Scheduled (cron)**, **event-driven** (enqueued from outbox/domain events), **delayed** (`startAfter`), **deduped** via named queue policies |
| Queue policy per job | pg-boss 12 named policies, chosen per job rather than one queue: `standard` (default) for normal fan-out; `short` for "one queued at a time, many active" (e.g. `JOB-11 session.cleanup`); `singleton` + `singletonKey: tenantId` for must-not-overlap tenant jobs (`JOB-06 subscription.check`, `JOB-18 rls.canary`); `stately` for "one queued, one active" (`JOB-01 outbox.dispatch`); `key_strict_fifo` + `singletonKey: "{tenantId}:{module}"` for ordered per-tenant-per-module work (`JOB-03 tenant.provision` re-runs). |
| Tenant fan-out | A scheduled *coordinator* job enumerates active tenants (platform scope, ids only) and enqueues one **tenant-scoped child job per tenant**; child handler calls `withTenant(tenant)` so RLS applies. Cron is evaluated per tenant timezone. |
| Payload contract | `{ tenantId, branchId?, idempotencyKey, params }` — validated by zod; missing tenant = rejected |
| Reliability | Retries with exponential backoff; per-job timeout; dead-letter queue; idempotent handlers; `job_runs` view for the platform console |
| Isolation | Per-tenant concurrency caps (queue policies above) to prevent noisy neighbors; heavy report/PDF jobs on a separate queue with lower priority |
| Worker timeouts | Set `expireInSeconds` (pg-boss default 15 min) and `heartbeat` explicitly on long jobs (large report exports, DSR export) so a wedged worker is reclaimed rather than blocking the queue; `retentionSeconds` (default 14 days) bounds the job table. |
| Never | Do not pass `priority: false` — it is deprecated and ignored from pg-boss 12.30.0, and disabling the priority sort was measured ~180× slower. Jobs are always fetched in priority order. |
| Module scoping | Every job declares the module it belongs to. The scheduler refuses to enqueue a job whose module is not entitled, and the worker re-checks entitlement before each attempt, so a module disabled mid-window cannot keep running work. Jobs for a `DRAINING` module are allowed to finish. |
| Observability | Metrics per job (duration, failures, lag) with `tenant_id` label; alert on dead-letter growth and schedule misses |
| Catalog | 50 jobs defined in **specification §14** (IDs `JOB-01…JOB-50`) |

**Transactional outbox:** domain events are inserted into `outbox` in the same transaction as the state change; `outbox.dispatch` (JOB-01) publishes to queues/notifications. No dual-write.

---

## 13. Notifications

Channels: in-app (bell), email, SMS, web push. Templates per tenant (language `en`/`fil`). Delivered via outbox → `notification.send` (JOB-02) with provider abstraction, retries, delivery log, per-user preferences, and quiet hours (except critical lab values and stock-out of controlled drugs).

---

## 14. Files & Documents

- Uploads (patient documents, lab attachments, signatures, logos, supplier docs) → object storage at `t/{tenant_id}/{domain}/{uuid}`; metadata in `files` table with RLS; SSE enabled.
- Size/type allow-list; antivirus scan job before availability; pre-signed GET ≤ 60 s; downloads logged to `phi_access_log` when patient-linked.
- Generated PDFs (lab reports, prescriptions, certificates, receipts, reports) stored immutably with SHA-256; re-render creates a new version, old retained.

---

## 15. Audit & Compliance Architecture

| Control | Implementation |
|---|---|
| **Audit trail** | `audit_log` (insert-only, monthly partitions): actor, tenant, `acting_as_platform`, `breakglass_id`, action, entity, before/after JSON (PHI fields masked where not needed), request id, IP, UA, per-tenant **hash chain** (`prev_hash`, `row_hash`) verified daily (JOB-10). |
| **PHI access log** | Every read of a patient record, result, or document writes `phi_access_log` (who, patient, resource, purpose, time). Viewable by DPO/auditor and per patient. |
| **Consent** | Versioned consent templates; signed/recorded consent per patient with purposes; withdrawal tracked. |
| **Data subject rights** | `data_subject_requests` workflow with SLA reminders (JOB-16); erasure = anonymization subject to legal retention/hold. |
| **Breach management** | Incident register with timers to notify the regulator/data subjects within the prescribed period (JOB-17; period configurable, confirm with DPO). |
| **Retention** | `retention_policies` per record class; `retention.enforce` (JOB-15) flags/anonymizes; legal holds override. Defaults set conservatively and confirmed with counsel. |
| **Processor obligations** | Platform acts as Processor: DPA/outsourcing contract template, sub-processor list, audit rights, breach notice to tenant. |
| **Encryption** | TLS 1.2+ everywhere; encrypted volumes & backups; envelope encryption (per-tenant DEK via KMS) for especially sensitive columns (government IDs, confidential results). |
| **Access reviews** | Quarterly user-access recertification report (RPT-CMP-06). |
| **Entitlement transparency** | Every module enable/drain/disable is an audited platform action with actor and reason; forced disables surface to the tenant's admins and DPO in RPT-PLT-09, alongside the break-glass list (RPT-PLT-05). Entitlements only ever narrow what a user can reach. |

Tenants are responsible as Controllers for appointing a DPO, privacy impact assessments, and (where thresholds are met, e.g., large-scale sensitive data) registration with the National Privacy Commission — the platform supplies a compliance checklist and evidence reports.

---

## 16. Security Controls (summary)

OWASP ASVS L2 as baseline · CSP strict, no inline scripts · CSRF protection for cookie flows · input validation with zod on every endpoint · parameterized SQL only · SSRF-safe outbound calls · secrets in a vault, rotated · dependency & container scanning in CI · SAST + secret scanning · WAF & DDoS protection · least-privilege DB/network policies · no PHI in logs/metrics/traces (structured-log redaction) · annual penetration test · tenant-isolation pen-test scenarios (IDOR, JWT swap, header spoof, queue poisoning, report/export scoping).

---

## 17. Observability & Operations

- Structured JSON logs with `request_id`, `tenant_id`, `user_id` (hashed in logs), route, duration; PHI redaction middleware.
- Metrics: RED per route, DB pool saturation, slow queries per tenant, job lag, stock reconcile mismatches, RLS canary status.
- Tracing: OpenTelemetry through API → DB → worker.
- Per-tenant usage metering (rows, storage, API calls) for plans and noisy-neighbor detection (alert on per-tenant row-growth anomalies).
- SLOs: API availability 99.9 %, p95 latency < 300 ms for CRUD / < 1 s for searches, job schedule adherence 99 %.

---

## 18. Deployment, Backup & DR

| Topic | Design |
|---|---|
| Environments | `dev` (docker-compose + MinIO + Mailpit), `test` (ephemeral per PR), `staging` (prod-like, synthetic data only), `prod` |
| Hosting | Containers on Kubernetes/managed platform; managed Postgres with HA; PgBouncer; region chosen with data-residency counsel (PH or nearby APAC region) |
| Releases | Blue/green or rolling; migrations as pre-deploy job (expand/contract); feature flags per tenant |
| Backups | Continuous WAL archiving (PITR), daily base backups, encrypted, cross-region copy; **RPO ≤ 5 min, RTO ≤ 1 h**; weekly automated restore test (JOB-14) |
| Tenant export | `tenant.export` (JOB-04) produces an encrypted archive through RLS-scoped queries only |
| Offboarding | Export → retention hold → `tenant.offboard.purge` (JOB-05) hard-deletes tenant rows and objects; backups age out per policy |
| Scaling path | Vertical → read replica for reports → partition hot tables → **promote heavy tenant to dedicated DB** using `tenant_directory.db_shard` routing |

---

## 19. Testing Strategy

| Level | Tooling | Must-haves |
|---|---|---|
| Unit | Vitest | FEFO, unit conversions, reference-range flags, delta checks, state machines |
| DB/integration | Testcontainers Postgres | Migrations, RLS policies, constraints, concurrency (parallel dispenses never oversell) |
| **Tenant isolation (release gate)** | Generated suite | For every tenant table & endpoint: seed tenants A/B, authenticate as A, assert zero B rows / 404 on B ids, cross-tenant FK rejected, `WITH CHECK` blocks forged `tenant_id`, job payload tampering rejected |
| **Module entitlements (release gate)** | Generated suite | For every module route: a tenant without the module gets `403 MODULE_NOT_ENTITLED` with a *superuser* token too; `DRAINING` allows reads and refuses writes; dependency and plan validation reject bad sets; disable → re-enable round-trips data, postings, and audit entries; a disabled module's jobs are never enqueued and its reports vanish from the catalog; break-glass inherits the tenant's set |
| API contract | OpenAPI + Schemathesis/Dredd | No breaking changes |
| E2E | Playwright (mobile + desktop viewports) | Registration → consult → lab → Rx → dispense → bill; PO → GRN → requisition → issue |
| Security | ZAP, dependency scan, pen-test | Auth, IDOR, break-glass |
| Accessibility | axe + manual | WCAG 2.1 AA |
| Performance | k6 | 200 concurrent users per tenant, noisy-neighbor scenario |
| Chaos/DR | Scheduled | Restore drill, worker kill mid-job (idempotency) |

---

## 20. Interoperability Roadmap

1. **v1:** PDF reports, CSV/XLSX exports, barcode labels, printable prescriptions/certificates.
2. **v1.5:** Lab instrument interface via HL7 v2 / ASTM (ORM/OML orders, ORU results, accession-number matching, corrected-result `OBX-11 = C`), LOINC mapping table per tenant.
3. **v2:** FHIR R4 (`Patient`, `Encounter`, `Observation`, `DiagnosticReport`, `MedicationDispense`), and integration with the national health information exchange as it becomes applicable (de-identified data only).

---

## 21. Local Development & Repository Layout

### 21.1 Stack on a laptop

`docker compose up` is the only setup step: PostgreSQL 17, Mailpit (SMTP UI), MinIO, and a seeded "demo tenant" fixture. `pnpm install && pnpm dev` starts Vite, the NestJS API in watch mode, and the worker in watch mode with the job scheduler enabled.

```yaml
# db roles are created by the first migration, not by hand
DATABASE_URL_MIGRATOR=postgres://clinic_owner:***@localhost:5432/clinic     # DDL only
DATABASE_URL_APP=postgres://clinic_app:***@localhost:5432/clinic            # NOSUPERUSER NOBYPASSRLS
DATABASE_URL_REPORT=postgres://clinic_report:***@localhost:5432/clinic_read  # replica, read-only
```

Two demo tenants (`demo-a`, `demo-b`) are seeded with mirrored fixtures **on purpose**: the isolation test suite and the RLS canary both depend on being able to prove A cannot see B. A third fixture is a `PROVISIONING_FAILED` tenant so the retry path is exercisable.

### 21.2 Repository layout

```
clinic-platform/
├─ apps/
│  ├─ api/            NestJS HTTP entrypoint (Fastify)
│  ├─ worker/         pg-boss consumers, cron scheduler, PDF/label renderers
│  └─ web/            React app: tenant app + platform console routes
├─ packages/
│  ├─ db/             migrations/*.sql, drizzle schema, withTenant(), RLS linter
│  ├─ contracts/      OpenAPI snapshot + zod schemas shared by api and web
│  ├─ domain/         pure logic: FEFO, UOM math, flags, delta checks, state machines
│  ├─ jobs/           job registry (name → schedule → handler → retry policy)
│  ├─ ui/             design system: every react-bootstrap import lives here (ADR-8)
│  └─ testkit/        factories, tenant fixtures, isolation-test generator
├─ modules/           library code shared by api + worker (one folder per domain module)
├─ infra/             docker-compose, k8s manifests, migrations job, IaC
└─ docs/              these four documents
```

**Import rules (enforced by ESLint `no-restricted-imports` + dependency-cruiser):**

| Rule | Reason |
|---|---|
| Only `packages/db` may `import { pool }` | Prevents a stray un-tenanted query |
| Only `packages/db` may `import { withTenant }` | Single place context is established |
| No `SECURITY DEFINER` in migrations | Bypasses RLS (architecture §6.3) |
| No `@app/*` cross-module deep imports | Modules communicate via services/events |
| `react-bootstrap` importable only from `packages/ui` | ADR-8 escape hatch |
| No `SELECT *` in `modules/**` repositories | Forces explicit column lists; prevents PHI leaking into exports by accident |

### 21.3 Seed data strategy

Seeds are **fixtures, not migrations** — re-runnable, tenant-parameterised, and never applied in production. `pnpm seed:demo` creates a tenant with a 2-branch clinic, ~20 practitioners across roles, a starter lab catalogue (~120 LOINC-coded tests with reference ranges), a pharmacy formulary (~800 drug products), ~40 central-supply items with suppliers, a week of appointments/visits/orders, and stock across batches with deliberately varied expiries so the FEFO and near-expiry paths are demonstrable.

---

## 22. Assumptions, Risks & References

**Assumptions:** PH is the primary market (PHP, `Asia/Manila`, PSGC addresses, RA 10173 / RA 9165 / RA 10918 context); 100–300 tenants in the first 18 months; most tenants 1–5 branches; clinics (not hospitals).

| Risk | Mitigation |
|---|---|
| RLS misconfiguration leaks data | Linter + generated negative tests + canary job + FORCE RLS + non-bypass role |
| Connection-pool context bleed | Transaction-local settings only; no session `SET`; reset on checkout |
| Stock drift | Ledger + nightly reconcile + `CHECK` constraints + immutable postings |
| Regulatory interpretation | Config-driven rules; counsel/DPO review before go-live |
| Superadmin over-reach | Break-glass with reason, time-box, tenant notification, audit |
| Noisy neighbor | Per-tenant rate limits, job concurrency caps, metering |
| Bootstrap/react-bootstrap major churn | All Bootstrap usage isolated behind `packages/ui` (ADR-8), so a react-bootstrap major swap is a `packages/ui` change; pinned versions tested in CI weekly, and 3.0-stable adopted only after GA |
| Cross-tenant leak via async path | Job payloads carry `tenantId` and are schema-validated; queue payloads are treated as untrusted input and covered by isolation tests |
| Stale entitlement cache after a downgrade | `modules_version` in the token is checked per request; a disable is also reflected in the next token refresh, and the preflight/force-disable flow exists because a sudden loss of access is the point of the feature |
| Entitlement bug locks a paying tenant out of its own data | Re-enable is one call and never destructive; force-disable requires a typed reason; the module-management screen is a first-class platform feature, not a support script |

**References (research)** — checked 2026-09-30

*Tenancy & PostgreSQL*
- AWS Prescriptive Guidance, multi-tenant PostgreSQL — https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/best-practices.html · https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html
- AWS SaaS Tenant Isolation Strategies (whitepaper) — https://d1.awsstatic.com/whitepapers/saas-tenant-isolation-strategies.pdf
- RLS pitfalls: superuser/BYPASSRLS bypass, table-owner bypass fixed by `FORCE ROW LEVEL SECURITY`, `USING` vs `WITH CHECK` asymmetry, global rows with `NULL` tenant — https://medium.com/@abogeerick/moving-beyond-where-tenant-id-engineering-true-multi-tenant-isolation-in-postgresql-52af2037e744 · https://picus-security-engineering.medium.com/enforcing-db-level-multi-tenancy-using-postgresql-row-level-security-c11d037d3f49 · https://github.com/gastonlopezl/supabase-rls-multi-tenant
- Practical patterns and a 10-point checklist — https://www.buildmvpfast.com/blog/postgres-row-level-security-multi-tenant-saas-2026

*Regulatory (Philippines)*
- Data Privacy Act (RA 10173) — https://privacy.gov.ph/data-privacy-act/ · https://www.respicio.ph/commentaries/patient-privacy-and-confidentiality-laws-in-the-philippines
- Dangerous drugs handling (DDB / PDEA) — https://ddb.gov.ph/images/Board_Regulation/2014/BD.REG1.14.pdf · https://www.pna.gov.ph/articles/1097377
- FDA e-Governance / CLIA and laboratory reporting standards context — https://www.govinfo.gov/content/pkg/CMR-HE1-00196380/pdf/CMR-HE1-00196380.pdf

*Clinical standards*
- FHIR R4 best practices and invariants — https://hl7.org/FHIR/R4/best-practices.html
- LOINC / RxNorm / ATC code systems — https://hl7.org/FIR/R4/loinc.html · https://terminology.hl7.org/3.1.0/CodeSystem-v3-rxNorm.html
- Lab order→result workflow: order placer/filler, `Task`-driven worklists, `DiagnosticReport` context — https://www.devdays.com/wp-content/uploads/2024/07/6.10.24-Rene-Spronk-Lab-Order-Management-Workflow.pdf · https://build.fhir.org/ig/HL7/fhir-order-catalog/labservices.html
- Lab result status lifecycle (preliminary / final / corrected / entered-in-error) and cancellation semantics — https://build.fhir.org/ig/HL7-cz/cz-lab/branches/__default/en/workflow-en.html
- LIMS development practice — https://acquaintsoft.com/blog/laboratory-information-system-development · https://mirth.support/blog/hl7-orm-oru-lab-workflow

*Pharmacy & supply chain*
- ASHP guidelines on preventing controlled-substance diversion (perpetual inventory, blind counts, ADC verification) — https://academic.oup.com/ajp/article/79/24/2279/6754265
- Controlled-substance handling best practice (witness, waste, same-shift accountability) — https://www.vumc.org/pharmacy-inventory-integrity-team/sites/default/files/public_files/Inventory%20Integrity%20Files/Best%20Practices%20for%20Handling%20Controlled%20Substances%20v4.pdf
- Automated dispensing evidence review (error reduction, inventory control, ADC governance) — https://pmc.ncbi.nlm.nih.gov/articles/PMC7907692 · https://academic.oup.com/ajp/article-abstract/79/24/2279/6754265
- Batch/lot + expiry capture, cycle counting, ABC/VEN, expiry exposure KPIs — https://www.cleverence.com/articles/for-business/hospital-pharmacy-inventory-management-best-practices-4821 · https://www.stockflowsystems.com/pharmacy-inventory-management
- Central stores and par-level replenishment — https://casrai.org/dictionary/term/central-stores · https://www.rfsmart.com/blog/hospital-materials-management-replenishment-best-practices

*Application stack*
- pg-boss (exactly-once via `SKIP LOCKED`, ORM adapters incl. Drizzle, cron, `LISTEN/NOTIFY`) — https://pgboss.io/ · https://github.com/timgit/pg-boss
- NestJS 11 / Fastify 5 — https://docs.nestjs.com/ · https://fastify.dev/docs/latest/Guides/Getting-Started/
- Bootstrap 5.3 color modes and the SCSS `color-mode()` mixin — https://getbootstrap.com/docs/5.3/customize/color-modes
- React-Bootstrap versioning and the React 19 port (2.10.10 chosen over the stale 3.0.0-beta) — https://github.com/react-bootstrap/react-bootstrap/releases · https://pgboss.io/ · https://github.com/timgit/pg-boss/blob/master/docs/database-backends.md · https://docs.nestjs.com/faq/request-lifecycle · https://react-bootstrap.netlify.app/docs/getting-started/color-modes/ · https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- React 19 type/internal changes affecting libraries — https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- TanStack Query v5 (single-object API, `context.client`, stable suspense hooks) — https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5 · https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
- Offline-first PWA patterns: service worker + IndexedDB outbox + client-generated idempotency keys — https://rohitraj.tech/notes/pwa-offline-sync · https://dev.to/zeeshanali0704/frontend-system-design-offline-support-and-progressive-web-apps-pwas-4k8m · https://github.com/duvan096/offline-first-pos
- `BarcodeDetector` API and its Chrome-only support (hence the ZXing fallback) — https://github.com/ConradMearns/barcode-scanner

> This document is an engineering design, not legal advice. Regulatory behaviors must be validated with qualified counsel and each tenant's Data Protection Officer.
