# RBAC Menu Gating — Implementation Guide

Audience: any engineer or AI model adding, changing, or debugging which menus,
search destinations, dashboard tiles, and routes a user can see.

This guide is authoritative for the **frontend visibility model**. It is a
client-side mirror only: the API's `PermissionGuard` / `ModuleGuard` and RLS stay
the security authority. A bug here can *reveal* a link, never *grant* access.

Read alongside the owning specs before changing anything:

| Document | Section | What it owns |
|---|---|---|
| `specification.md` | §2.2 Module access matrix (default template) | Role → module access (F/R/C-R-U/A/—). This is the source of truth for *who may operate what*. |
| `specification.md` | §2.3 Permission catalogue | The full list of permission codes and their module. |
| `architecture.md` | §5.3 | Tenancy, entitlement, and the RBAC model. |
| `frontend.md` | §7.2 (routing/nav rule), §8 (nav), §9 (search) | The rendered contract this code implements. |

If a task asks you to make a user see a surface that §2.2 says they may not
operate, that is a **scope question for the user** — never silently resolve it in
code.

---

## 0. TL;DR — the non-negotiable rules

1. **Two gates, both required.** A surface is visible only when
   `hasModule(module) === true` **AND** the caller holds an **operative**
   permission for that specific surface. Entitled module alone is not enough;
   any permission in the module is not enough.
2. **Operative, not namespace.** Gate each item by the permission the page
   actually *operates* with (e.g. lab workbench by `lab.specimen.*` /
   `lab.result.*`), never by "any `lab.` code". Cross-module *read/order* grants
   (a doctor's `lab.order.read`, `lab.report.read`, `pharmacy.rx.read`) must not
   surface another module's workbench.
3. **Every navigable surface must be gated by the SAME permission.** The sidebar,
   the command palette, the dashboard, and the route guard for a page must agree.
   One ungated surface is a leak.
4. **Fail closed.** Missing/stale permission data hides chrome. Never treat
   "unknown" as "allowed".
5. **Do not invent codes.** Use codes that exist in `specification.md §2.3` /
   `packages/contracts/src/permissions.ts`. If none fits, ask.
6. **Cover it with a test.** Every gating change needs a positive (allowed user
   sees it) and a negative (disallowed user does not) assertion.

---

## 1. The permission model

### 1.1 Code grammar

Permission codes are dot-separated and module-prefixed:

```
<module>.<resource>.<action>
```

Examples: `clinical.visit.read`, `pharmacy.dispense.read`, `lab.result.verify`,
`admin.branch.read`, `supply.issue.read`, `billing.invoice.create`.

The `module` segment (first token) generally matches the tenant module name.
Module names used in the app: `patients`, `clinical`, `pharmacy`, `laboratory`,
`supply`, `billing`, `admin`, `compliance` (plus `platform` for the Platform
Console, which is only reachable by namespace-prefix `platform.`).

### 1.2 Two independent axes

| Axis | Source | Question answered | Accessor |
|---|---|---|---|
| **Entitlement** | `session.modules` (tenant's active modules) | Is this clinic allowed to use this module at all? | `hasModule("pharmacy")` |
| **Operative permission** | `session.permissions` (caller's codes) | May *this user* work this specific screen? | `hasAnyPermission([...])` |

A surface appears only when **both** are true. Concretely:
`hasModule(module) && hasAnyPermission(operativeCodes)`.

### 1.3 Where the client reads this from

`apps/web/src/shared/auth/PermissionsContext.tsx` exposes `usePermissions()`:

- `hasPermission(code)`
- `hasAnyPermission(codes)` — the workhorse for nav gating
- `hasAllPermissions(codes)`
- `hasModule(module)`
- `hasAnyPermissionPrefix(prefix)` — **reserved for platform-only surfaces**
- `canAccess(module, codes)` — convenience for `hasModule && hasAnyPermission`

The data is fetched from `GET /auth/session` (`{ modules: string[], permissions:
string[] }`). Without a `PermissionsProvider` the hook fail-softs to **all false**
(`PermissionsContext.tsx:89-107`) so gated chrome hides rather than leaks.

`RequirePermission` (`PermissionsContext.tsx:115-164`) is the route-level guard:
`module?` + `codes`, renders children only when both pass, otherwise a denial
card or a `redirectTo`.

### 1.4 Default role grants (example: doctor)

`packages/contracts/src/permissions.ts` `SYSTEM_ROLE_TEMPLATES.doctor` grants
clinical-workflow codes **plus** cross-module reads that are intentionally *not*
operative:

```
clinical.visit.read, clinical.queue.read, clinical.rx.create, ...
lab.order.create, lab.order.read, lab.result.read, lab.report.read,
pharmacy.rx.read, patient.record.read, reference.read, ...
```

This is why prefix-based gating failed: "any `lab.`" or "any `pharmacy.`" is true
for a doctor. The operative maps below are what fix it.

---

## 2. The four surfaces that must be gated

| # | Surface | File | Mechanism |
|---|---|---|---|
| 1 | Sidebar nav groups | `apps/web/src/shell/MainLayout.tsx` | `MODULE_BY_GROUP` + `PERMS_BY_ITEM`, filtered in `navGroups` `useMemo` |
| 2 | Command palette (Ctrl/⌘+K) | `apps/web/src/shared/search/CommandPalette.tsx` | `DESTINATIONS[].module` + `.codes` (+ `.prefix` for platform only) |
| 3 | Dashboard tiles | `apps/web/src/features/dashboard/DashboardPage.tsx` | `QUICK_ACTIONS[].module` + `.codes`, `canOperate.*`, `visibleTabs` |
| 4 | Route guards | `apps/web/src/main.tsx` | `<RequirePermission module codes>` wrappers |

Rule of thumb: **when you add a page, you touch all four.** If a route has no
guard, the nav/dashboard mapping is the *only* visibility control — so it must be
correct.

---

## 3. Surface 1 — Sidebar (`MainLayout.tsx`)

Reference anchors (line numbers drift; search by symbol):

- `NAV_GROUPS` (~:24) — declarative groups and items. `NavItem = { to, icon, label }`.
- `MODULE_BY_GROUP` (~:263) — group id → tenant module.
- `PERMS_BY_ITEM` (~:279) — `item.to` → operative codes (OR semantics).
- `navGroups` `useMemo` (~:336) — the filter.

Filter contract (`MainLayout.tsx:336-350`):

```ts
const gate = session !== null;                       // no session -> inert nav
const required module; if (gate && !hasModule(mod)) return null; // group off
const items = group.items.filter((item) => {
  if (!gate) return true;
  const needed = PERMS_BY_ITEM[item.to];
  return !needed || hasAnyPermission(needed);        // absent -> always visible
});
if (items.length === 0) return null;                 // empty group -> hidden
```

Key semantics:

- **Group module gate**: `workspace` maps to `patients`; `system` is intentionally
  absent from `MODULE_BY_GROUP` (System Health is tenant-agnostic) and always
  shows once a session exists.
- **Item gate**: an item **absent** from `PERMS_BY_ITEM` is always visible when
  its group's module is entitled. Use this deliberately (dashboard, report
  catalogue, System Health). Owning a group therefore never forces a permission
  on the shared landing items.
- **OR semantics**: listing multiple codes means "any one grants visibility".
- **Empty group hides**: because the group vanishes when every item is filtered
  out. This is how a whole rail (Pharmacy, Laboratory) disappears.

### 3.1 Choosing the operative codes for an item

Ask: *what does this page's primary action read or write?* Gate by that, not by
what a neighbouring module's data the page merely displays.

| Page type | Gate with |
|---|---|
| List / read screen | the `.read` code of the resource (`clinical.visit.read`) |
| Workbench (act on entities) | the action codes the bench performs (`lab.result.verify`, `lab.specimen.receive`) |
| Verify/approve queue | the verify/approve code (`pharmacy.rx.verify`, `lab.result.verify`) |
| Settings/config screen | `*.settings.read` / `*.config.read` (avoid broad cross-cutting reads like `reference.read`) |
| Shared/landing/diagnostics | omit from `PERMS_BY_ITEM` |

Anti-pattern: gating `/admin/icd10` with `reference.read`. A doctor holds
`reference.read` for form lookups, so this leaked the whole admin group. It was
corrected to `admin.settings.read`.

---

## 4. Surface 2 — Command palette (`CommandPalette.tsx`)

`NavDestination` (~:66):

```ts
interface NavDestination {
  label: string;
  path: string;
  keywords: string;
  module?: string;   // tenant entitlement
  codes?: string[];  // operative codes (OR)
  prefix?: string;   // namespace gate — platform-only surfaces
}
```

Filter (`CommandPalette.tsx:185-191`):

```ts
const nav = DESTINATIONS.filter((d) => {
  if (d.module && !hasModule(d.module)) return false;
  if (d.codes  && !hasAnyPermission(d.codes)) return false;
  if (d.prefix && !hasAnyPermissionPrefix(d.prefix)) return false;
  return !q || d.label.toLowerCase().includes(q) || d.keywords.includes(q);
});
```

Rules:

- **Mirror the sidebar.** A destination's `codes` must equal the sidebar item's
  `PERMS_BY_ITEM` for the same path. Keep a data-driven list if they ever drift.
- `prefix` is **only** for Platform Console (`prefix: "platform."`). Do not use
  `prefix` for tenant modules — that reintroduces the namespace bug.
- Shared items (Dashboard, System Health) omit `module`/`codes`.

---

## 5. Surface 3 — Dashboard (`DashboardPage.tsx`)

The dashboard is dynamic: it must not render clickable workbenches the user
cannot operate.

Two families of flags exist; **do not confuse them**:

- `canSee*` flags (~:178-183) — *fetch gating only*. They decide whether to call
  an aggregate endpoint (avoids a burst of 403s). A doctor has `canSeeLab ===
  true` because they hold `lab.order.read`; that does **not** mean a Lab tile may
  render.
- `canOperate.*` flags (~:193-215) — *render gating*. Module entitlement AND
  operative permission. These drive what is shown.

Reference structures:

- `QUICK_ACTIONS` (~:55) — each entry gains `module` + `codes`; filtered with
  `canOpenQuickAction` and the hub hides when empty.
- `canOperate` (~:193) — `{ clinical, laboratory, pharmacy, supply, billing,
  patients, admin }`.
- `visibleTabs` / `effectiveTab` (~:210-217) — the "Operational Working Data"
  tabs. `effectiveTab` auto-falls back to an allowed tab so a stale `activeTab`
  can never render a hidden tab's content.
- Gated regions: hero buttons (`+ Open Visit`, `+ Patient`), the 6 KPI cards,
  the tab buttons and their content, the quick-action hub.

```ts
const canOpenQuickAction = (a: { module?: string; codes?: string[] }) =>
  (!a.module || hasModule(a.module)) && (!a.codes || hasAnyPermission(a.codes));
```

When adding a dashboard card/tab/quick-link: add `module` + operative `codes`,
add (or reuse) the matching `canOperate` flag, wrap the JSX in
`canOperate.x && (...)`, and add a tab to `visibleTabs` if it is tabbed.

---

## 6. Surface 4 — Route guards (`main.tsx`)

Wrap the route element in `RequirePermission`:

```tsx
<Route path="/pharmacy/dispenses" element={
  <RequirePermission module="pharmacy" codes={["pharmacy.dispense.read"]}>
    <PharmacyDispensesPage />
  </RequirePermission>
} />
```

Process (`.js` extension in imports; React Router v7 elements):

1. `import { RequirePermission } from "./shared/auth/PermissionsContext.js";`
2. Wrap the element using the **same** `module` + codes as the sidebar item.
3. Confirm the API route for that page enforces the equivalent guard server-side.

A page reachable by URL but hidden from nav is still a leak if the route is
unguarded and the API forgets to check — defense in depth.

---

## 7. Adding a new nav item / module — checklist

When you add a page or module, satisfy every item:

1. **Code exists?** Confirm the operative permission is in `specification.md §2.3`
   and `packages/contracts/src/permissions.ts`. If not, raise it — do not invent.
2. **Sidebar**: add the `NavItem` to `NAV_GROUPS`; add the group → module in
   `MODULE_BY_GROUP` (if new); add `PERMS_BY_ITEM["/path"] = [operative codes]`.
3. **Palette**: add a `DESTINATIONS` entry with the same `module` + `codes`.
4. **Dashboard** (if surfaced there): add `module` + `codes` to `QUICK_ACTIONS`
   and/or a `canOperate` flag + tab entry.
5. **Route guard**: wrap the element in `RequirePermission` with matching inputs.
6. **Role templates / seeds**: if the role should see it by default, ensure the
   code is in `SYSTEM_ROLE_TEMPLATES` (`packages/contracts/src/permissions.ts`)
   and the demo seeds (`packages/db/migrations/seeds/demo_clean.sql`). Keep these
   convergent.
7. **Tests**: add positive + negative cases (see §8).
8. **Docs**: if the nav contract itself changes, update `frontend.md §7.2` in the
   same change.

---

## 8. Testing requirements

Tests live in `apps/web/tests/` and use a real loopback stub server
(`apps/web/tests/setup.ts` exports `useStubHandler`, `StubHandler`). Provide a
session via a `/auth/session` stub and render inside `AuthProvider` +
`PermissionsProvider`.

Skeleton (see `tests/layout-rbac.test.tsx` for the full pattern):

```tsx
function sessionFor(modules: string[], permissions: string[]) {
  return {
    user: { id: "u-1", email: "user@demo-a.test", name: "Test User" },
    tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
    sessionId: "3f1d3f1d-0000-4000-8000-000000000001",
    amr: ["pwd"], branchId: null, assignedBranches: [],
    effectiveTimezone: "Asia/Manila",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    modules, modulesVersion: 1, permissions,
  };
}
function stubSession(session: unknown): StubHandler {
  return (req, res) => {
    const url = req.url ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    if (url.includes("/auth/session")) res.end(JSON.stringify(session));
    else res.end(JSON.stringify({ ok: true }));
  };
}
```

Required cases per changed surface:

- **Positive**: a role that holds the operative code + entitlement sees the item.
- **Negative**: a role that holds only cross-module *reads* does **not** see it
  (this is the exact doctor regression — assert Pharmacy *and* Laboratory are
  gone while `pharmacy.rx.read` / `lab.order.read` are granted).
- **Entitlement**: a role with the permission but an unentitled module sees
  nothing.
- **Timing**: gating resolves asynchronously (session fetch). Assert settled
  state with `await waitFor(() => { ... })` and put **both** the positive and the
  negative assertion inside the same `waitFor`, otherwise a negative assertion
  can pass against the pre-gating (full-nav) first render.

Test files: `tests/layout-rbac.test.tsx` (sidebar),
`tests/command-palette.test.tsx` (palette), `tests/features.test.tsx` (dashboard).
When a component renders without `PermissionsProvider`, `usePermissions`
fail-softs to all-false — so a dashboard test **must** wrap it in the provider and
stub a session, or every gated tile disappears.

---

## 9. Verification gate (run before claiming done)

```powershell
# Doc consistency (blocks work on failure)
./.opencode/skills/doc-preflight/scripts/preflight.ps1 -Root .

# Focused component tests
pnpm --filter @clinic/web exec vitest run tests/layout-rbac.test.tsx tests/command-palette.test.tsx tests/features.test.tsx

# Types + lint
pnpm --filter @clinic/web exec tsc --noEmit -p tsconfig.json
pnpm --filter @clinic/web exec eslint src/features/dashboard/DashboardPage.tsx src/shell/MainLayout.tsx src/shared/search/CommandPalette.tsx
```

Then **live-verify** in a browser as a narrow role (e.g. a doctor) and confirm
the offending module is absent from the sidebar, the palette, and the dashboard,
while the permitted surfaces still render. Report actual command output; do not
claim a check passed without running it.

---

## 10. Worked example — a doctor

Grants (`SYSTEM_ROLE_TEMPLATES.doctor`): 62 codes including clinical workflow
plus cross-module reads `lab.order.read`, `lab.result.read`, `lab.report.read`,
`pharmacy.rx.read`.

Expected result after gating:

- Sidebar: **Workspace, Clinical Care, System** only
  (no Pharmacy, Laboratory, Supply, Billing, Tenant Administration, Compliance).
- Palette: no "Pharmacy Dispense Workbench", no lab workbench destinations.
- Dashboard: KPI cards **Active Visits** + **Patients** only; a single
  **Clinical Visits** tab; quick-links **Clinical Encounters** + **Patient
  Registry** only.

Why: none of the doctor's cross-module reads is in any `PERMS_BY_ITEM` for the
Pharmacy/Laboratory rails (those require `pharmacy.rx.verify` /
`pharmacy.dispense.read` and `lab.specimen.*` / `lab.result.*`), so every item
filters out and the group disappears.

---

## 11. Anti-patterns (each caused a real bug)

1. **Namespace-prefix group gating.** `hasAnyPermissionPrefix("pharmacy.")` is
   true for any prescription/read grant and surfaced whole rails. Removed. Use
   per-item operative codes.
2. **Gating by fetch flags.** `canSeeLab` exists to avoid 403 storms, not to
   decide rendering; a doctor's `canSeeLab` is true. Use `canOperate`.
3. **Gating routes but not nav (or vice versa).** Four surfaces must agree.
4. **Shared landing items behind permissions.** Keeping Dashboard / report
   catalogue / System Health out of `PERMS_BY_ITEM` is intentional; forcing a
   code on them breaks the shell for roles with few grants.
5. **Platform Console via `codes`.** It is namespace-based (`platform.`); keep it
   on `prefix`, never a tenant module code.
6. **Negative assertions before gating settles.** Wrap them in `waitFor` with the
   positive assertion.
7. **A component test without `PermissionsProvider`.** It fail-softs to all-false
   and will silently hide gated content; stub a session and provide the context.

---

## 12. File reference index

| Concern | Path |
|---|---|
| Permission API + route guard | `apps/web/src/shared/auth/PermissionsContext.tsx` |
| Session / modules payload | `apps/web/src/shared/auth/AuthContext.tsx` (`GET /auth/session`) |
| Sidebar gating | `apps/web/src/shell/MainLayout.tsx` (`NAV_GROUPS`, `MODULE_BY_GROUP`, `PERMS_BY_ITEM`, `navGroups`) |
| Palette gating | `apps/web/src/shared/search/CommandPalette.tsx` (`DESTINATIONS`) |
| Dashboard gating | `apps/web/src/features/dashboard/DashboardPage.tsx` (`QUICK_ACTIONS`, `canOperate`, `visibleTabs`) |
| Route guards | `apps/web/src/main.tsx` (`RequirePermission`) |
| Catalogue + role templates | `packages/contracts/src/permissions.ts` |
| Demo seeds | `packages/db/migrations/seeds/demo_clean.sql` |
| Tests | `apps/web/tests/{layout-rbac,command-palette,features}.test.tsx`, helper `tests/setup.ts` |
| Spec | `specification.md §2.2–2.3`, `architecture.md §5.3`, `frontend.md §7.2/§8/§9` |
