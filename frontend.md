# Multi-Tenant Clinic Platform — Frontend Specification

**Version:** 1.0 (draft) · **Date:** 2026-09-30
**Companion docs:** [architecture.md](architecture.md) · [specification.md](specification.md) · [todo.md](todo.md)

This document defines the **web client**: design system, routing, screen inventory for every module, mobile-first behaviour, accessibility, client state, offline/PWA strategy, and the frontend test plan. It consumes the API in [specification.md §18](specification.md) and the tenancy rules in [architecture.md §4–§6](architecture.md).

---

## Contents

1. Product goals & design principles
2. Personas → primary tasks
3. Tech stack & version policy
4. Repository structure
5. Design system
6. Responsive strategy
7. Navigation & routing
8. Application shell & layout
9. State management
10. API client, auth, and tenancy plumbing
11. Forms & validation
12. Data tables, search & filtering
13. Barcode & QR scanning
14. Screen specifications by module
15. Offline & PWA behaviour
16. Notifications & realtime
17. Accessibility (WCAG 2.2 AA)
18. Internationalization & units
19. Error, empty, and loading states
20. Security in the client
21. Performance budgets
22. Frontend testing strategy
23. Design handoff & acceptance checklist

---

## 1. Product goals & design principles

**Who uses this.** A receptionist on a shared tablet, a physician between patients with one hand free, a phlebotomist at a counter with a barcoded tube in the other, a supply clerk in a storeroom with a scanner and poor lighting, a cashier at the end of a shift, and a superadmin on a laptop who must never see PHI.

**Principles.**

| # | Principle | Consequence in the UI |
|---|---|---|
| P-1 | **Scan first, type second** | Every identifier field (item, patient, specimen, order, PO, prescription) has a scan-first variant; BarcodeDetector with ZXing fallback. Manual entry always available. |
| P-2 | **The next action is always visible** | Each list row exposes its single most likely next action inline (collect, receive, verify, post, acknowledge). No hunting through a detail page. |
| P-3 | **No destructive action without a typed or reasoned confirmation** | Void, post, adjust, approve, and delete flows use a modal naming the entity, showing the consequence, and requiring a reason; high-risk ones also require a passphrase re-entry. |
| P-4 | **One screen, one primary job** | Work surfaces (lab worklist, pharmacy queue, cashier) are dedicated single-purpose screens, not dashboards with tabs. |
| P-5 | **Timestamps and statuses are never ambiguous** | Status is a coloured pill with text (never colour alone) and every date shows relative *and* absolute time. |
| P-6 | **The UI never computes money or stock authority** | Totals, balances, FEFO order, and expiry tiers are server-rendered values; the client displays them and warns when the server rejects. |
| P-7 | **Reveal PHI progressively** | Patient banner shows name/DOB/sex/allergy count; allergies, diagnoses, and results require explicit expansion, and each reveal is audit-visible. |
| P-8 | **Offline is honest** | The offline banner states exactly what still works. Offline is permitted for read-mostly browsing and a defined write subset; everything else is disabled with a reason, never silently queued. |
| P-9 | **Keyboard-complete** | Every workflow is operable without a pointer, including scanning workflows (scan events are keyboard-like). |
| P-10 | **Accessible on a cheap phone in bright light** | 44 px minimum targets, high contrast, no hover-only information, no colour-only meaning. |

**Explicit non-goals.** No native mobile app. No real-time collaborative editing of clinical documents. No chart-by-drag dashboards. No client-side PDF generation for official documents (server renders them for signature integrity).

---

## 2. Personas → primary tasks

| Persona | Device/context | Primary tasks | Optimisation target |
|---|---|---|---|
| **Receptionist** | Shared tablet, counter, high ambient noise | Find patient, check in, reschedule, collect payment, print receipt, take a message | Search latency; 3 taps max to check-in; no PHI on screen while idle (auto-blur) |
| **Physician** | Desktop + mobile, intermittent network | Review today's list, open chart, vitals, order labs, e-prescribe, sign notes, read results | Chart opens in 2 clicks; results inline; offline read of today's list |
| **Nurse** | Mobile, ward/ER, gloves | Vitals, triage, specimen collection, medication administration, discharge instructions | Big targets; voice-free one-hand operation; offline-tolerant vitals |
| **Phlebotomist** | Counter + mobile cart, barcoded tubes | Worklist triage, accession, collect, label, transport | Scan-first; worklist is the home screen; keyboard-only fallback |
| **Lab manager / verifier** | Desktop, second monitor | QC review, verify batches, amend results, release reports, TAT monitoring | Batch verify with keyboard; critical-alert inbox front and centre |
| **Pharmacist** | Desktop + tablet at the counter | Verify prescriptions, check interactions, allocate FEFO, dispense, controlled register | Interaction findings unmissable; FEFO suggestion with override reason |
| **Supply clerk** | Storeroom, poor light, scanner | Receive GRN, count, pick, issue, adjust, dispose | Scan-first, offline-tolerant counting; big confirm targets |
| **Cashier** | Counter terminal, shift end | Charge, split tender, discount with ID, print receipt, close shift with blind count | Fast numeric keypad; shift close is a guided wizard |
| **Tenant admin** | Desktop | Users, roles, branches, services, price lists, templates, operating hours, settings | Bulk configuration; import/export CSV; permission preview before save |
| **Compliance officer / DPO** | Desktop | Audit trail, PHI access log, breach workflow, DSR, access reviews, retention approvals | Filter-first design; export everything; immutable evidence view |
| **Superadmin** | Desktop | Provision tenants, manage plans and admins, monitor system, enter tenant with break-glass | No PHI anywhere; every cross-tenant action visibly flagged and justified |

---

## 3. Tech stack & version policy

| Concern | Choice | Version (as of 2026-09-30) | Rationale |
|---|---|---|---|
| Language | TypeScript | 5.9 (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) | |
| Build | Vite | 7.x | Fast HMR; ESM-native |
| UI runtime | React | 19.x | Concurrent features; `useOptimistic` for the outbox; `use()` for suspense |
| Component library | Bootstrap | 5.3.x (CSS custom properties, `color-modes`) | Pinned; no CDN |
| Bootstrap bindings | `packages/ui` wrapper over **react-bootstrap 2.x** | 2.10.10 (Bootstrap 5.3.8) | See architecture ADR-8: all Bootstrap/React-Bootstrap imports are confined to `packages/ui`, so a major upgrade (incl. react-bootstrap 3.0-stable when it ships) is a wrapper change only. |
| Routing | React Router | 7.x (data router, `loader`/`action`) | Nested layouts, loaders for auth/tenant context |
| Server state | TanStack Query | 5.x | Single `queryClient` on the tenant instance; `context.client` for partial invalidation |
| Mutations & forms | React Hook Form + Zod | latest stable | Resolver-per-form; shared schemas with the API |
| Validation | Zod | 4.x | Same schema shapes the API contract |
| Local persistence | Dexie (IndexedDB) | 4.x | Offline outbox, cached reference data, draft forms |
| Barcode | `BarcodeDetector` + `@zxing/library` | — | Native where available, WASM fallback (architecture §3) |
| Charts | Recharts | 3.x | Lab trends, TAT; SVG-friendly, respects reduced motion |
| Rich text / note editor | TipTap | 3.x | Structured clinical notes; plain-text export for reports |
| Dates | `date-fns` + `date-fns-tz` | 4.x / 3.x | Tenant-timezone correctness; never raw `new Date()` for business dates |
| Formatting | `Intl.NumberFormat`, `Intl.DateTimeFormat` | built-in | Currency and locale-aware |
| i18n | `react-i18next` | latest | en-PH, en-US; translation keys co-located |
| Testing | Vitest + React Testing Library + MSW + Playwright + axe | latest | See §22 |
| State management | React context + `useReducer` for shell/UI state; **no** Redux | — | Server state stays in TanStack Query; no client-side cache of business rules (architecture §3, §9) |
| PWA | Workbox via `vite-plugin-pwa` | latest | Precache shell, network-first API, offline page |
| Observability | Sentry + OpenTelemetry Web Vitals | latest | PHI scrubbed before send (architecture §17) |

**Version policy.** Exact versions are pinned in `pnpm-lock.yaml` and asserted in CI (§3.3 architecture). Dependabot opens PRs weekly; majors require a compatibility note against the `packages/ui` wrapper surface. `react-bootstrap` majors are tracked by a dedicated label and evaluated against the `packages/ui` wrapper surface only, so its churn never blocks unrelated work.

**What the client never ships.** No PHI in analytics, error reports, session replays, or localStorage. No bearer tokens in `localStorage` (memory + `HttpOnly; Secure; SameSite=Lax` refresh cookie). No `dangerouslySetInnerHTML` on any server-provided string.

---

## 4. Repository structure

A pnpm workspace, monorepo-lite. `apps/api` and `apps/worker` (architecture §12, §21) sit beside the web client.

```
clinic-platform/
├── apps/
│   ├── api/                     # NestJS + Fastify
│   ├── worker/                  # pg-boss consumers
│   └── web/                     # this document's subject
│       ├── public/              # favicons, manifest, icons
│       ├── src/
│       │   ├── app/             # bootstrap, providers, router root
│       │   ├── shell/           # layout, nav, tenant switcher, offline bar
│       │   ├── features/        # one folder per module (M1..M10)
│       │   │   ├── platform/
│       │   │   ├── admin/
│       │   │   ├── patients/
│       │   │   ├── clinical/
│       │   │   ├── laboratory/
│       │   │   ├── pharmacy/
│       │   │   ├── supply/
│       │   │   ├── billing/
│       │   │   ├── compliance/
│       │   │   ├── notifications/
│       │   │   └── reports/
│       │   ├── shared/          # cross-feature code
│       │   │   ├── api/         # typed client, endpoints, msw handlers
│       │   │   ├── hooks/       # usePermission, useBreakglass, useScanner...
│       │   │   ├── components/  # feature-agnostic (DataTable, ReasonModal...)
│       │   │   ├── offline/     # outbox, sync engine, Dexie schema
│       │   │   ├── i18n/
│       │   │   ├── utils/       # dates, money, units, formatting
│       │   │   └── styles/      # theme, tokens, bootstrap overrides
│       │   └── main.tsx
│       ├── public/
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── e2e/
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── ui/                      # React-Bootstrap wrapper (ADR-8)
│   ├── contracts/               # Zod schemas + generated OpenAPI types
│   ├── test-utils/              # renderWithProviders, msw server, fixtures
│   └── eslint-config/           # incl. no-restricted-imports for react-bootstrap
├── tooling/
│   ├── tsconfig.base.json
│   └── docker-compose.dev.yml
└── docs/                        # these four documents
```

**Boundary rules (enforced by ESLint `no-restricted-imports`):**

1. `react-bootstrap` and `bootstrap` may only be imported from `packages/ui`.
2. `api/**` may not import from `features/**`; `features/x` may not import from `features/y` except through `shared/api`.
3. Only `shell/` and `shared/offline/` may touch `navigator.onLine`, the service worker, or Dexie directly.
4. No feature may read another feature's query keys; use the exported invalidation helpers.

---

## 5. Design system

### 5.1 Tokens

Tokens live in `shared/styles/tokens.css` as CSS custom properties and are the only source of colour, spacing, and type values.

**Colour.** Bootstrap 5.3 CSS variables per tenant branding, plus a fixed semantic palette for clinical status that never changes with the tenant theme:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--status-critical` | `#b42318` | `#f97066` | critical lab values, blocked, oversell |
| `--status-high` | `#b54708` | `#fdb022` | abnormal-high, near-expiry (≤ 90 d), at-risk |
| `--status-normal` | `#027a48` | `#47cd89` | normal ranges, released, posted |
| `--status-low` | `#175cd3` | `#53b1fd` | abnormal-low, informational |
| `--status-neutral` | `#475467` | `#98a2b3` | cancelled, voided, archived |
| `--status-pending` | `#6941c6` | `#b692f6` | awaiting verification, draft |

Tenant brand colour is applied only to primary buttons, links, and focus rings. **Status colour is never the sole carrier of meaning** — every status pill includes text, and every chart marks series with a shape or label too.

**Contrast.** Body text ≥ 4.5:1, large text and UI borders ≥ 3:1, verified in CI with a contrast test over the full token set in light, dark, and the top three tenant brand colours.

**Spacing & shape.** 4 px base scale; `--radius-*` at 6/10/14 px; card radius 10 px; input radius 8 px; table row height 44 px (touch) / 36 px (desktop, `md`+).

**Type.** System font stack with `Inter` as the progressive enhancement; 14 px base dense data, 16 px body on mobile; tabular numerals for all quantity, price, and result columns (`font-variant-numeric: tabular-nums`).

### 5.2 Components inventory

`packages/ui` exports the wrapper surface. Every component below is a wrapper (or a composition of wrappers) so a Bootstrap major bump touches one package.

| Component | Wrapper | Notes |
|---|---|---|
| `Button` | ✔ | `variant`, `size`, `loading` (spinner + `aria-busy`), `iconOnly` requires `aria-label` |
| `IconButton` | ✔ | Minimum 44×44 px hit area via pseudo-element expansion |
| `Form.Control`, `Form.Select`, `Form.Check` | ✔ | Bootstrap markup, React-Bootstrap state management |
| `DateField` | custom on `Form.Control` | Native `<input type="date">` with tenant-timezone semantics; no custom calendar keyboard traps |
| `DateTimeField` | custom | `datetime-local` + explicit timezone label; relative + absolute display |
| `MoneyField` | custom | Numeric, no currency symbol in the input (in the label), rounding to currency minor units on blur |
| `QuantityField` | custom | Unit selector, UOM conversion preview, FEFO badge when relevant |
| `SearchCombobox` | custom | Async, keyboard-navigable, `aria-activedescendant`, used for patient/item/drug pickers |
| `ScanButton` / `ScanInput` | custom | Camera + USB/BT scanner; `BarcodeDetector` or ZXing |
| `DataTable` | custom | Server-driven sort/filter/cursor paging, column visibility, CSV export, saved views, sticky header, bulk actions |
| `StatusPill` | custom | `status` + `label` + optional `icon`; never colour-only |
| `PatientBanner` | custom | Collapsed by default; reveals PHI progressively (P-7) |
| `AlertBanner` | custom | `info` / `success` / `warning` / `danger`, with `role="alert"` for critical |
| `ReasonModal` | custom | Requires reason code + free text; used by every 🔒 destructive/transition action |
| `StepConfirmModal` | custom | Named entity, consequence list, optional passphrase re-entry (P-3) |
| `ConfirmPopover` | custom | Inline, for low-risk single actions (e.g. mark read) |
| `Offcanvas` / `Modal` | ✔ | Offcanvas for detail panes on mobile, modal for confirmations |
| `Toast` / `ToastStack` | ✔ | Grouped by entity; never more than 3 visible |
| `Tabs` / `Nav` | ✔ | `Nav` for primary work-area navigation on mobile |
| `Timeline` | custom | Audit, result amendment, movement history |
| `EmptyState` | custom | Icon, headline, one-sentence explanation, primary action |
| `SkeletonTable` | custom | Shape-stable loading (no layout shift) |
| `SplitPane` | custom | Master-detail; stacks on mobile |
| `Stepper` | custom | Guided flows: GRN post, shift close, bulk edit |
| `QRSummary` | custom | Lab report, Rx label, PO, DOB wristband |
| `SignaturePad` | custom | Pointer-event signature for pharmacy witness and lab verifier attestation |
| `Sparkline` / `TrendChart` / `ControlChart` | custom (Recharts) | Lab deltas, TAT, Levey–Jennings QC |
| `VirtualList` | custom | `react-window`; used for worklists > 200 rows |
| `Money` / `Quantity` / `DateTime` / `Code` | custom renderers | Centralised formatting so money never appears ad hoc |

### 5.3 Layout primitives

`Container` (max-width by breakpoint), `Stack` (flex/grid gap), `Cluster`, `Grid` (12-col CSS grid, not Bootstrap rows where custom density is needed), `SectionHeader` (title, count, actions, filters), `Toolbar` (sticky), `Card`, `Panel`, `Drawer`, `FooterBar` (sticky primary action on mobile — the commit bar pattern used by dispensing, GRN posting, and shift close).

---

## 6. Responsive strategy

| Breakpoint | Width | Layout intent |
|---|---|---|
| `xs` | < 576 | Single column. Bottom tab bar for the 5 most-used destinations of the active persona. Sticky `FooterBar` for the primary commit action. Tables become `DataTable` card mode (label/value stacked rows) with a horizontally scrollable fallback for wide grids. |
| `sm` | 576–767 | Single column with wider gutters; two-up filter rows. |
| `md` | 768–1023 | Two-pane master-detail for worklists; left nav rail collapses to icons with tooltips; tables get sticky headers. |
| `lg` | 1024–1439 | Full three-zone shell: nav rail + list + detail; denser tables; multi-column forms. |
| `xl` | ≥ 1440 | Wider content column (max 1600 px) for lab/pharmacy/supply grids; side-by-side list + detail without truncation. |

**Per-persona defaults.** `role → default route` and `role → breakpoint behaviour` come from `/session`. A phlebotomist lands on the worklist at `xs` with big scan targets; a superadmin never sees a bottom tab bar, always the desktop nav rail, because platform scope is management, not floor work.

**Print.** Receipts, lab reports, prescriptions, controlled-register pages, and disposal certificates have print stylesheets that strip navigation, expand all identifiers, and force black-on-white regardless of theme. `window.print()` after the server-rendered PDF loads.

---

## 7. Navigation & routing

### 7.1 Route tree

Routes mirror the module sections in [specification.md §4–§13](specification.md). `:tenantSlug` is implicit in the subdomain, not the path, except in the platform console which may address tenants by id.

```
/login
/forgot-password · /reset-password
/mfa

/app                                   → Shell (auth + tenant + permission guards)
├── dashboard                          → role-specific landing
├── patients
│   ├── :id
│   ├── :id/history · /contacts · /allergies · /consents · /documents
│   ├── :id/clinical        (visits, dx, notes, immunizations)
│   ├── :id/lab             (orders, results, reports)
│   ├── :id/pharmacy        (prescriptions, dispenses, controlled)
│   ├── :id/supply          (consumption, requisitions)
│   ├── :id/billing
│   ├── :id/compliance      (access log, DSR)
│   └── new · /search · /merge
├── scheduling
│   ├── calendar · /templates · /exceptions
│   └── appointments/:id
├── queue                            → live board (branch + date scoped)
├── visits
│   ├── :id                            → chart (tabs: Summary, Vitals, Notes, Dx, Rx, Orders, Supplies, Charges)
│   └── new
├── laboratory
│   ├── worklist · /orders/:id · /specimens · /critical-alerts
│   ├── qc · /send-outs · /reports
│   └── config/{sections,specimen-types,tests,analytes,ranges,instruments,qc-materials,report-templates}
├── pharmacy
│   ├── queue · /prescriptions/:id · /dispenses/:id · /sales/:id · /returns
│   ├── stock · /controlled-register · /special-rx · /administrations
│   ├── products[/:id] · /interactions · /price-rules
│   └── reports
├── supply
│   ├── dashboard
│   ├── purchase-requests[/:id] · /purchase-orders[/:id]
│   ├── goods-receipts[/:id]  · /supplier-invoices[/:id] · /supplier-returns[/:id]
│   ├── requisitions[/:id] · /issues[/:id] · /transfers[/:id]
│   ├── counts[/:id] · /adjustments[/:id] · /disposals[/:id] · /recalls[/:id]
│   ├── stock · /batches/:id · /consumption
│   ├── items[/:id] · /categories · /uoms · /barcodes · /suppliers[/:id] · /locations[/:id]
│   └── reports
├── billing
│   ├── cashier                → primary POS surface
│   ├── invoices[/:id] · /payments/:id · /credit-notes[/:id] · /discounts
│   └── shifts[/:id] · /daily-close
├── administration
│   ├── users[/:id] · /roles[/:id] · /branches[/:id] · /practitioners[/:id]
│   ├── service-units · /service-catalog · /price-lists[/:id] · /discount-types · /payment-methods
│   ├── templates/{documents,notifications} · /holidays · /operating-hours · /api-keys
│   └── settings
├── compliance
│   ├── audit · /phi-access · /consents · /dsr[/:id] · /breaches[/:id]
│   ├── retention · /legal-holds · /access-reviews[/:id]
│   └── rls-canary
├── reports
│   ├── catalog · /:reportId (config → run → result → export/schedule)
│   └── schedules
├── notifications · /files · /jobs/:id · /me
└── /platform                       → scope=platform only; separate nav
    ├── overview · /tenants[/:id] · /tenants/new · /admins
    │   └── /tenants/:id/modules      → entitlement management
    ├── plans · /subscriptions · /announcements · /system-settings
    ├── jobs · /security-events · /breakglass
    └── reports
```

### 7.2 Routing rules

- **Auth guard:** unauthenticated → `/login?next=…` (preserving the path, never a redirect loop).
- **Tenant guard:** token tenant ≠ active tenant (only possible under break-glass) → platform warning bar, banner, and automatic expiry countdown.
- **Module guard:** routes declare their module (`module: 'laboratory'`); a module the tenant does not have is not just blocked but absent — the nav entry never renders, and a direct URL shows a `404`-style "not available for your clinic" surface with a "request this module" action. `DRAINING` renders normally with a persistent read-only banner and disabled write controls. The guard reads the set from `/session` and re-reads when `modules_version` changes, so a downgrade takes effect without a manual refresh.
- **Permission guard:** route declares `required: 'lab.result.verify'`; no permission → `403` page naming the role that would be needed, no data fetched. Checked *after* the module guard, mirroring the server.
- **Scope guard:** `/platform/*` requires `platform.*`; a tenant-scoped user hitting it gets a `403` that explains break-glass is platform-initiated, not self-service.
- **Resource guard:** an id from another tenant returns the same `404` surface as a non-existent id, with no distinguishing copy.
- **Loaders:** `/app` and `/session` load in a route loader; feature routes load their reference data (branch list, item cache) via a `QueryClient` prefetch in the same loader, so first paint has no empty pickers (acceptance #18).
- **Deep links** are first-class: every work-surface row has a shareable URL, and a printed label QR encodes a deep link to the entity.

---

## 8. Application shell & layout

**Regions.**

1. **Skip link** → `#main`.
2. **Top bar:** tenant identity (name + status), branch switcher, global search, scan launcher, notifications bell, offline indicator, break-glass banner (when active), user menu (profile, preferences, sessions, sign out).
3. **Nav rail** (`md`+) / **bottom tabs** (`xs`, persona-specific) / **hamburger drawer** (`xs` secondary destinations). Built from the entitled module set in `/session`, so a supply-only tenant sees a short rail, not a tree of dead links. A module losing its entitlement mid-session removes its entry on the next `/session` refresh.
4. **Main:** breadcrumbs, page header (title, count, primary/secondary actions), `Toolbar` (filters, saved views, columns, export), content region, and optional sticky `FooterBar`.
5. **Status region:** `aria-live="polite"` for toasts, `aria-live="assertive"` reserved for critical lab alerts and oversell rejections.

**Tenant & branch context.** Tenant comes from the subdomain; the active branch is in the URL query (`?branch=`) so links are shareable and a cashier cannot accidentally charge the wrong branch. Changing branch invalidates branch-scoped queries and shows a confirm when there is unsaved work.

**Session & idle behaviour.** Idle timeout (configurable, default 15 min) shows a countdown modal at 60 s remaining; activity extends it. `visibilitychange` triggers a `visibilitychange` refetch of open mutations and a PHI re-mask of the patient banner after the configured mask timeout.

**Break-glass banner.** Full-width amber bar, sticky, unmissable: "Platform session as *Tenant* — reason shown — expires in *hh:mm*". Every action in this state is tagged in the audit trail and counted in the tenant's break-glass list (RPT-PLT-05).

---

## 9. State management

| State kind | Mechanism | Rules |
|---|---|---|
| Server data | TanStack Query 5 | Query keys are namespaced `['tenant', tenantId, 'lab', 'orders', filters]`. Mutations invalidate by prefix helpers (`labKeys.orders()`), not by string literals. `staleTime` per surface: worklists 15 s, reference data 30 min, reports 5 min. Cursor pagination stored in the query key, not component state. |
| Forms | React Hook Form + Zod resolver | Default values hydrated from the server; unsaved-changes guard on route change; draft persistence for long forms (visit chart, GRN, count sheet) in IndexedDB, never localStorage. |
| Shell/UI | `AppContext` + `useReducer` | Tenant, branch, active patient, sidebar state, density, theme, **`modules` + `modulesVersion`**, `FooterBar` context. Reducer with exhaustive switch; no ad-hoc `useState` for cross-component values. |
| Selection | URL query or `useState` in list scope | Bulk selections live in the list route, so "select all matching" is a URL the user can return to. |
| Realtime | SSE (architecture §13) | Invalidates queries; never mutates data directly, so a missed event self-heals on next fetch. |
| Offline | `shared/offline` outbox | See §15. |
| Global search | `SearchContext` with a debounced command palette (`Ctrl/⌘+K`) | Searches patients, items, orders, prescriptions, and pages the user can access; results respect permissions and skip non-entitled modules entirely. |

**Rule:** no PHI-bearing state is written to `localStorage`, `sessionStorage`, or the URL. The URL carries ids and filters, never names, diagnoses, or results.

---

## 10. API client, auth, and tenancy plumbing

- **Generated, typed client.** `shared/api` is generated from the OpenAPI document implied by [specification.md §18](specification.md) (`@hey-api/openapi-ts` or `openapi-typescript` + a thin fetch wrapper). `packages/contracts` holds the Zod schemas used for both request validation and response parsing of non-trivial payloads.
- **Base URL** `/api/v1`; credentials `include`; no token in storage.
- **Auth:** access token in memory (short TTL, silent refresh via `POST /auth/refresh` with refresh rotation and reuse detection). On refresh failure → single-flight sign-out, not a request storm.
- **Tenant context:** the subdomain sets the `Host`-derived tenant hint; the token carries the authoritative tenant. The client never sends a tenant id for scoping — if it did, the server would reject it (`TENANT_MISMATCH`), so a UI bug cannot widen scope.
- **Break-glass:** when a platform session is active, the client sends `X-Acting-As-Tenant`; the server maps it to the minted session. The UI shows the banner and disables actions the platform role lacks.
- **Idempotency:** `Idempotency-Key` generated once per submit intent (uuid v4, held in a `useRef` for the form instance, regenerated after success), sent on every 🔒 endpoint (specification §18 conventions). Retries reuse the key; a body change reuses it only after a `409 IDEMPOTENCY_CONFLICT` prompts a new intent.
- **`If-Match`:** optimistic concurrency version from the entity. A `412 STALE_ROW_VERSION` triggers a refetch and surfaces a "changed by *user* — review differences" diff modal rather than an overwrite.
- **Errors:** parse `application/problem+json` (RFC 9457, architecture §11.2) into a typed `ApiProblem`; map `code` → user copy from `shared/api/errors.ts`, with `fieldErrors` bound to form fields and `correlationId` shown in a copyable footer.
- **Rate limits:** `429` with `Retry-After` → non-blocking banner on lists, inline retry on forms; no auto-retry storm.
- **MSW** handlers mirror the OpenAPI contract, with a "chaos" mode for timeouts, `5xx`, and `409` used in tests.

---

## 11. Forms & validation

- **Schema source of truth:** Zod schemas in `packages/contracts` shared with the API; the client never invents validation rules the server does not enforce, and never omits server-enforced rules.
- **Validation timing:** `onBlur` for fields, `onChange` after first submit attempt, `onSubmit` as the gate. Errors render as `aria-describedby` text, not colour alone.
- **Cross-field rules live in the schema** (`superRefine`): expiry vs receipt date, min shelf life, controlled quantity limits, refill eligibility, discount requiring ID, ordering-provider match, Luhn for `*_no` fields.
- **Idempotent submit:** the submit button enters a `loading` state that survives the response; double-taps are impossible and the key is reused.
- **Long forms** (GRN, count sheet, requisition, invoice): sectioned with a sticky progress summary, autosave draft to IndexedDB every 30 s, and a "resume draft" prompt on return.
- **Destructive and transition actions** (P-3): `ReasonModal` with a reason-code select (server-provided codes) + free text (min length), plus `StepConfirmModal` showing entity id, current status, and consequence bullets. High-risk (post, void, adjust, approve, controlled witness, break-glass) additionally require passphrase re-entry.
- **Scan-first fields:** `ScanInput` accepts scanner keystrokes (fast < 50 ms/char, terminator Enter) and camera scans into the same control; on success it resolves the entity and either fills the field or navigates.

---

## 12. Data tables, search & filtering

`DataTable` behaviour, applied to every list in the product:

- **Server-driven:** `sort`, `page[size]`, `page[cursor]`, and filters in the URL. Back/forward works; a filtered worklist is shareable.
- **Columns:** declarative column defs (`key`, `header`, `render`, `sortable`, `width`, `sticky`, `align`, `printable`, `sensitive`). Users control visibility; a tenant may pin mandatory columns.
- **Saved views:** name, filter + sort + columns + density, per user. "My open lab work" and "Expiring in 30 days" are shipped examples.
- **Row actions:** the most likely next action inline, then a `⋯` overflow with the rest. Destructive actions never sit in the primary slot.
- **Bulk actions** appear in a `FooterBar` with an explicit count ("12 selected"), and bulk destructive actions use `StepConfirmModal` listing exactly what will happen per row class.
- **Inline edit** only for whitelisted, low-risk fields (quantity on a count line, note on a draft) with per-cell `PATCH` and optimistic update via `useOptimistic`; failures revert and toast with the server reason.
- **Export** uses the server export endpoint (§18.10) — never client-side CSV of the current page, which would misrepresent totals.
- **Virtualisation** kicks in above 200 rows; sticky header and keyboard paging are unaffected.
- **Empty state** distinguishes: no data yet (action), no filter matches (clear filters), not permitted (no data, no action), and offline (banner + cached rows with a "last synced" stamp).

---

## 13. Barcode & QR scanning

- **Capability detection:** `window.BarcodeDetector` (Chrome/Android, some PWAs) → native decode. Otherwise `@zxing/library` WASM. Either way, an in-page `<input>`-based scanner listener is always active as the hardware-scanner path.
- **Formats:** GS1-128, Code 128, Code 39, EAN-13/UPC-A, Data Matrix, QR (specification §10 for stock, §9 for dispensed items, §6 for patient labels).
- **Scan contexts:** patient wristband, specimen tube, item barcode, batch/lot label, prescription label, PO/GRN label, controlled-drug serial, session badge (future kiosk), lab-report QR.
- **UX:** full-screen scan view with a viewfinder and torch toggle; haptic beep + flash on success; a green/red result banner; camera permission denial falls back to manual entry with a persistent hint; continuous mode for multi-item flows (count sheet, GRN lines, dispensing).
- **Resolution:** a scan resolves through typed endpoints (`GET /lab/specimens?accession=`, `GET /supply/barcodes?code=`) and routes the user to the resolved entity; unknown codes produce a clear "not found in this clinic" state with a manual-search path — never a silent no-op.
- **Offline:** decoded codes are queued with their intended action; resolution happens on sync (specification §16, AC-22 in §17).

---

## 14. Screen specifications by module

Each entry: primary screens, key interactions, states that must be designed, and the specification reference. Permission gates come from the route map in [specification.md §18](specification.md).

### 14.1 Platform console — M1

- **Overview:** tenant count by status, signups needing approval, failed provisions (with retry), job failure rate, break-glass events in the last 24 h, security events, system health. **No PHI.**
- **Tenants list:** status, plan, module chips (entitled set at a glance), branch count, active users, last job run, MRR, created date. Filters; export (aggregate only).
- **New tenant wizard:** profile (name, legal name, slug with live availability, country, timezone) → plan (limits preview) → **modules** → first admin → confirm. The module step is the one that needs care:
  - A grid of module cards, each with a plain-language description, its data footprint, and its dependencies. `Admin` and `Patients` are shown as on and locked with a tooltip explaining why.
  - Ticking a dependent module auto-ticks its dependency and shows why ("Laboratory needs Patients"); soft dependencies surface as an amber note, never a block.
  - Modules outside the chosen plan are visible but disabled with the plan that includes them — so the superadmin sees the upsell instead of a mystery rejection.
  - Right-hand live summary: "This tenant will run Clinical, Laboratory, and Billing" plus the seeded masters each choice implies.
  - Step is skippable and defaulted off; nothing is created until Confirm, which shows the full summary and posts `modules[]` with the tenant.
- **Tenant detail:** tabs — Overview, Branding, Branches (metadata), Admins, Users (metadata), Subscription, **Modules**, Usage, Jobs, Flags, Audit (platform scope), Export/Offboard. Offboard is a two-step confirm with a typed tenant slug.
- **Modules tab** (entitlement management, the highest-consequence screen in the console):
  - Table of all 10 modules with status, seed status, trial expiry, limits, and last change (actor, date, reason).
  - Enabling: a confirm that names the module, warns that new permissions must be mapped in the tenant's roles, and shows which roles will need review.
  - Disabling is deliberately a three-beat flow. "Check what would be blocked" runs preflight and lists open work per module (open visits, unverified results, released reports, draft dispensations, unposted GRNs, open PRs/POs, running jobs). Then either **drain** (module goes read-only, with a live countdown of remaining open items) or **force-disable**, which requires typing the tenant slug and a reason.
  - A forced disable is visibly marked as such in the UI and in the tenant's transparency report; the screen states plainly that no data is deleted and that re-enabling restores everything.
  - Every state change shows a toast naming the module and the effective time, because other users' screens change within a minute.
- **Admin management:** invite a tenant admin, reset password/MFA with step-up, force unlock; every action shows which tenant will be notified.
- **Break-glass console:** start session (reason ≥ 15 chars, step-up MFA, explicit acknowledgement of PHI access limits), live list of active sessions with countdown, extend (ceiling enforced), end. A permanent log of reason, duration, and action count.
- **System settings, plans, announcements:** standard CRUD with versioning; announcement preview across the three landing variants.
- **Jobs monitor:** per-job runtime, retry, failure, DLQ; "replay" only for idempotent jobs, with a confirm.
- **Renders:** every page states "Platform scope — no patient data is available here" in the subheader.

### 14.2 Tenant administration — M2

- **Users:** table with role chips, branch scope, last active, MFA state, lockout; invite drawer (roles, branches, expiry); bulk role assign; reset MFA / unlock / deactivate with reassignment prompt.
- **Roles:** template list, clone, permission matrix (grouped by module with search), SoD warning banner when a grant creates a conflict (e.g. `supply.grn.post` + `supply.adjust.approve`), "effective permissions preview" for a sample user before saving.
- **Branches & service units:** list with map-free address (PSGC picker), code, timezone override, status; service units per branch.
- **Service catalog & price lists:** grid editor with effective dating, bulk CSV import with per-row error report, "who is affected" preview.
- **Discount types & payment methods:** CRUD with the guardrails of the domain (max percent, requires ID, method requires reference).
- **Templates:** document and notification template editor with `{{placeholders}}` picker, version history, and a test-render preview; editing creates a new version.
- **Operating hours & holidays:** weekly grid per branch + holiday calendar; slot generation preview showing which appointments shift.
- **API keys:** create (secret shown once), scope, last used, rotate, revoke.
- **Settings:** grouped forms (general, clinical policy, pharmacy policy, lab policy, security, notifications); each group has a "who can change this" note and an audit history link. Groups belonging to a module the tenant does not have are hidden rather than shown disabled — a locked screen invites support tickets.
- **My modules (read-only):** in the same settings area, a plain list of the tenant's enabled modules with their status, and a "request a module" contact action that opens a pre-filled message to the platform. The tenant can see what it has and ask for more, but cannot grant itself anything.
- **Branches — service profile editor** (specification §19.8, Q-18): within the branch drawer, a checklist of what this branch operates (`CONSULTATION`, `PROCEDURE_ROOM`, `EMBEDDED_LABORATORY`, `PHARMACY_DISPENSING`, `AMBULATORY_SURGICAL`, `BIRTHING`, `DIALYSIS`); a branch may declare none (a valid configuration, e.g. a central store). Declaring a service whose tenant module is not entitled is refused at save with the "Laboratory module is not enabled for your clinic" copy and the request-module action — the same surface as a non-entitled route (§19), so the reason is never a mystery. A branch's profile chips also render in the branches list so ops can see the clinic's shape at a glance.
- **Branches — licence registry & compliance badges** (specification §19.8): a per-branch section listing each licence record (`LOCAL_BUSINESS_PERMIT`, `DOH_LTO`, `FDA_DRUGSTORE_LTO`) with number, issuing authority, expiry, and the scanned document. The screen states its own limits honestly: it **reminds, it never polices**. A missing-but-expected licence — profile says `EMBEDDED_LABORATORY`, no `DOH_LTO` on file — renders an amber badge ("Laboratory licence not on file") with a quiet explanation that DOH licensure attaches to the service, not to the clinic as a whole, and a line appears in RPT-ADM-04; nothing is blocked, ever, and the badge is deliberately calm (informational amber, not alarming red) because absence of paperwork is an operations fact, not a clinical emergency. JOB-13 reminders (60/30/7) key off records that exist; renewals edit the row in place with an audit entry and an "expiring in N days" tint as the date approaches.

### 14.3 Patients — M3

- **Search & register:** the command-palette style search (name/DOB/mobile/ID/patient no) with duplicate-warning cards on selection; registration form in two columns on desktop, stepped on mobile (identity → contact → identifiers → consent → insurance); live duplicate check with explicit "this is the same person" acknowledgement.
- **Patient banner:** collapsed to name + patient no + age/sex + allergy count badge; expand for the full alert strip (allergies, active problems, isolation flags, pending results, outstanding balance). Masked after inactivity and while the cashier POS is open.
- **Chart tabs:** Summary (visits, vitals trend, meds, results, immunizations, documents), Encounters, Labs, Pharmacy, Supply usage, Billing, Compliance (own access log), Demographics history.
- **Merge:** dual-pane preview of the two records field-by-field with a winner selector, a "what will happen to each linked record" summary, confirm; unmerge within 30 days from the same screen.
- **Identifiers:** masked by default; reveal per-field with reason capture, logged.
- **Consent & documents:** consent templates with version, signature capture, PDF; document upload with scan status.
- **Deactivate / mark deceased:** confirm with consequences (open invoices, future appointments, pending results, controlled-drug watch); no delete anywhere in the UI (architecture §6.4).

### 14.4 Clinical — M4

- **Schedule builder:** weekly grid by practitioner/service unit, drag or tap to create slots, block templates, exception dates; a "patients affected" preview before publishing a change.
- **Day view:** timeline columns per practitioner, colour-coded by status with text labels, tap to open the appointment sheet; "no-show" and "cancel" from the sheet with reason.
- **Queue board:** live (SSE) vertical lanes (Waiting → Roomed → With provider → Ready → Done), tap to call/skip/recall; a "my queue" filter; large targets for a shared tablet.
- **Visit chart:** sticky patient banner; the tab set from §7.1; a persistent "unsaved changes" indicator; a footer bar with the single next step ("Ready for billing" when appropriate).
- **Vitals:** auto-flagged fields with colour + text ("High"), an abnormal-vitals summary, and a "trend since last visit" sparkline.
- **Notes:** TipTap templates, smart phrases, autosave draft, sign (with step-up for high-risk note types), amend flow that shows the previous version side-by-side.
- **Diagnoses / problems:** ICD-10 picker with local search + recent-favourite list; problem list with onset/resolution dates and a "resolve" (not delete) action.
- **Order sets & templates:** "My order sets" as the physician's fast path; a one-tap "repeat last visit's orders" with explicit confirmation.
- **e-Prescribe:** drug search with allergy/interaction inline warnings, dose/frequency/route/duration form, quantity, refills, instructions; controlled drug fields expand the special-Rx section; label preview; sign to issue.
- **Certificates & referrals:** template pick, field fill, sign, PDF/print, share link with expiry.
- **Order status timeline:** a single visual line from order → collected → resulted → verified → released, used in the chart, lab, and pharmacy views alike.

### 14.5 Laboratory — M5

- **Worklist (home):** columns or rows by stage with filters (section, priority, TAT breach, age, STAT), inline actions (Collect, Receive, Reject, Start, Enter), a "scan tube" affordance that focuses the accession field, and a dense mode for desktop. Auto-refresh via SSE with a subtle "updated" pulse.
- **Order & specimen screens:** order header (patient, priority, ordering provider, panel), item list with per-item status, collection/receipt capture with a scanned-or-manual accession, label print, chain-of-custody timeline.
- **Result entry:** analyte grid with inputs, units, reference ranges, flags, and a delta indicator; calculated analytes marked; abnormal values highlighted with a "confirm the value" affordance; a "same as previous" shortcut; instrument/QC badge; save as draft vs verify-and-continue.
- **Verify queue:** batch view of results awaiting verification; keyboard-first (arrow keys, `V` to verify, `A` to amend); SoD violation shown explicitly ("you entered this result — verification requires another user"); QC-failure banner blocks verification.
- **Amend flow:** select result → reason → new value; shows a redlined before/after; on confirm, the order is marked `CORRECTED`, a new report version is queued, and the ordering provider is notified.
- **Critical alerts inbox:** the highest-priority surface on the lab home; per-alert value, range, patient (banner), acknowledge dialog with how the value was communicated and read-back text; escalation timer visible; an "escalated" state when the window lapses.
- **QC:** control lots, run entry, Levey–Jennings charts with Westgard flags, accept/reject with impact prompt ("2 results in this run used this failed control").
- **Send-outs:** referral lab, courier, tracking, and "result received" that creates a corrected report on the original order.
- **Reports:** per-order report list with versions, release (with a "which analytes are missing?" checklist), PDF/print with the standard report layout, and the SHA-256 verification footer.
- **Configuration:** tests (LOINC search, TAT, confidentiality, fasting, specimen, container), analytes, effective-dated ranges with a "who was affected" report when a range changes, instruments with calibration due badges, reagent BOMs.

### 14.6 Pharmacy — M6

- **Verification queue:** issued prescriptions; open one to see the patient banner, Rx, and the checks panel — allergies, interactions (with severity and mechanism), duplicate therapy, dose, refill eligibility, stock. Findings require a decision: **Approve**, **Intervene** (document type + description), or **Reject to prescriber** (reason); the decision is recorded and appears in the prescriber's notifications.
- **Dispense workbench:** patient banner, Rx lines with prescribed vs available, FEFO allocation suggestion per line, manual batch override with reason, substitution with reason, price/discount, and a single **Post** action that becomes one transaction (architecture §8.3). A "not enough stock" response shows the shortfall and offers a partial fill (with a note to the prescriber).
- **Controlled dispensing:** expanded flow — special-Rx serial entry (scannable), quantity in words *and* numerals, witness selection (second authorised user) with signature, register entry preview, and a hard block when the serial was already used or the Rx is refill-attempted. The "witness" step cannot be self-completed.
- **OTC sale:** basket with scan-first item entry, controlled items rejected with a message pointing to the Rx flow, receipt.
- **Returns:** original dispense lookup, reason, disposition (restock/quarantine/dispose), credit note prompt.
- **Stock:** by item and batch, FEFO order, near-expiry highlighting (≤ 90/60/30 d), quarantine badges, valuation, and a movement drawer (append-only ledger view).
- **Controlled register:** append-only table by drug and period with running balance, variance flags, the witness trail, and the Dangerous Drugs Book print layout.
- **Configuration:** generics, products (schedule, storage, high-alert, Rx-required), interactions (tenant overrides with a reason), price rules, reports.

### 14.7 Central supply — M7

- **Dashboard:** reorder suggestions with one-tap "create PR", expiring stock by bucket, quarantine/recall alerts, open PR/PO/GRN counts, top movers, stock value, and a "what needs a decision today" list.
- **GRN wizard (Stepper):** header (PO or direct, supplier, invoice ref, dates) → lines (scan or search item, lot, expiry, qty + UOM with conversion, unit cost, inspection result, cold-chain temp) → summary (variance vs PO, shelf-life violations) → post (with override reasons) → receipt PDF. Offline-tolerant: lines queue locally and post on reconnect with the idempotency key (specification §10).
- **Purchase requests & orders:** list + detail with line editor, status transitions (`Submit`, `Approve`, `Reject`, `Send`, `Close`) each with the reason/confirm rules, SoD banner when the approver equals the creator, revision history, and expected-delivery tracking.
- **Requisition & issue:** par-list generated requisitions, requester lines, approver queue (threshold-based), pick list with FEFO suggestions, issue post → in-transit, and the receiving side with full/partial/discrepancy acknowledgement.
- **Transfers:** branch-to-branch with both approvals, in-transit visibility, and receiving.
- **Counts:** count sheet by location (full, cycle with ABC filtering, spot) with a blind-count mode that hides system quantities until submission; variance table with reasons; recount for high-variance lines; post with `COUNT_VARIANCE` movements.
- **Adjustments & disposals:** reason-code-first forms, two-user approval, witness signatures (two for controlled), disposal certificate with photo upload.
- **Recalls:** create from a supplier notice or internal finding, lot trace matrix (lots → locations → quantities → patients dispensed), quarantine action, notification to affected locations, and a close-out checklist.
- **Stock explorer:** item/location/status/near-expiry filters; per-batch rows; movement drawer; valuation snapshot; CSV export from the server.
- **Item master:** items with UOMs, conversions, barcodes, batch/expiry/hazard flags, min shelf life; categories; suppliers with catalogue, last price, lead time; locations with min/max/par parameters (bulk CSV import with an error report).

### 14.8 Billing & cashiering — M8

- **Cashier (POS):** patient or walk-in lookup, open visits and their charges, add service/medicine/supply (scan or search), quantity and price (with permission-aware override), discounts (with ID capture when required and a revoke-before-payment action), split tender with a numeric keypad, change calculation, "print receipt", and "hold" for a customer returning. Keyboard-first: `/` search, `F2` pay, `Enter` confirm.
- **Invoice detail:** lines with origin (lab, Rx, procedure, supply), discounts with actor, payments and allocations, balance, credit notes, void (with reason + step-up), and a stock restock prompt when a stocked line is voided.
- **Shifts:** open/close wizard; close requires a blind count per payment method, computes variance, and requires a reason for any variance; a shift summary with reprintable X/Z-style reports.
- **Daily close:** sales by method, discounts with reasons, receivables, refunds, variance, and the shift audit summary.
- **Credit notes & receivables:** issue, approve, apply, and a patient statement view.

### 14.9 Compliance — M9

- **Audit explorer:** filter by actor, role, action, entity, date, IP, and "acting as platform"; a detail view with a before/after diff and the hash-chain position; export.
- **PHI access log:** by patient, by user, anomalies (bulk views, off-hours, post-break-glass), with the "who saw this patient" view from the patient chart.
- **Consent templates:** builder with version, publish workflow, signature style, and the patient-facing preview.
- **DSR:** request intake, identity verification checklist, due-date countdown, processing, secure delivery with expiry, and rejection reasons.
- **Breaches:** intake, assessment (severity, data involved, affected records), notification timers, decision log, and close-out.
- **Retention & legal holds:** policies per record class, candidates list from JOB-15 with bulk approve/hold, hold register with release workflow.
- **Access reviews:** campaigns, per-user permission decisions, and completion reporting.
- **RLS canary (superadmin + tenant):** latest canary results, probe history, and a "verify this browser's isolation" self-test that only reads aggregate counts.

### 14.10 Notifications, files, jobs, reports — M10

- **Notification centre:** grouped by entity with read/unread, bulk read, deep links, and per-event preferences in `/me/preferences` (channel, quiet hours).
- **Files:** upload with scan status, preview for images/PDF, version history, and a download that always re-authorises server-side.
- **Jobs:** a job status page for anything the user launched (export, report, provision, DSR export) with progress, result download, and cancel.
- **Reports catalog:** grouped by module; each report card states its purpose, required filters, permitted columns, default period, and export formats.
- **Report runner:** filter form (period, branch, item, provider, drug, status), preview rows inline, then Run (small) or Export (async), and Schedule (recurring delivery to chosen recipients). Every run is audited and honours the report's permitted fields.

---

## 15. Offline & PWA behaviour

**What the platform can do without a connection** (specification §16): read cached reference data and recently visited records, **count stock**, capture vitals on a tablet, draft a note, and queue a limited set of writes. Everything else is disabled with a reason.

**Outbox (shared/offline).**

- **Storage:** IndexedDB via Dexie. Tables: `outbox` (intent), `outboxPayloads` (encrypted blobs), `drafts`, `referenceCache`, `countSheets`, `lastSync`.
- **Encryption:** payload fields are encrypted with a key derived from the session (WebCrypto AES-GCM); PHI payloads never leave the device unencrypted at rest. Logs and metrics carry no payloads.
- **Intents:** a discriminated union — `count.line.submit`, `vitals.record`, `note.draft`, `dispense.post` (blocked for controlled, allowed for non-controlled per §20 Q-12), `grn.line.add`, `stock.lookup`. Each intent carries `idempotencyKey`, `entityRef`, `createdAt`, `attempt`, `lastError`.
- **Sync engine:** online/offline listeners, a foreground interval (30 s when dirty), a background sync handler where supported, and a manual "Sync now". Sends in creation order, one at a time per entity type to avoid conflicting intents, with exponential backoff and jitter.
- **Conflict handling:** server rejections are surfaced with the server's copy and an action ("Open the record", "Discard this entry", "Keep both" where the domain allows). A `412 STALE_ROW_VERSION` on a count line shows both quantities and asks the user to choose — never an automatic last-write-wins.
- **Signals in the UI:** the top-bar indicator shows pending count, last successful sync, and the oldest pending age; a detail screen with pending changes shows a "pending sync" pill on the affected fields.
- **Service worker (Workbox):** precache the app shell and static assets; network-first for API reads with a cache fallback limited to GETs of the user's own tenant; never cache `POST`/`PATCH`/`DELETE`; offline page with a "what still works" list; versioned cache cleanup on activate.

**Progressive disclosure of trust.** A small "Offline & sync" settings/help page explains exactly which actions queue, how long they are kept (72 h), what happens on conflict, and how to clear pending data. A pharmacy or supply manager must be able to answer "what happens to my count if the Wi-Fi drops?" from this page alone.

---

## 16. Notifications & realtime

- **SSE channel** per session: `queue` updates, `lab.critical`, `stock.reorder`, `job.progress`, `prescription.issued`, `payment.receipt`. The client invalidates queries on events; it never trusts event payloads as data.
- **Notification rules mirror specification §13:** per event, per channel (in-app, email, SMS/push), per role, with tenant quiet hours (clinical alerts bypass quiet hours). Every notification carries a deep link and, for PHI-bearing events, requires an authenticated click.
- **Critical lab alert UX:** assertive live region, an unmissable inbox entry, a modal that cannot be dismissed without an acknowledgement, and an escalation timer.
- **Email/SMS dispatch** is server-side (`JOB-02 notification.send`, triggered on notification creation); the client only shows delivery status for admin-configured templates. Appointment reminders are `JOB-23`.

---

## 17. Accessibility (WCAG 2.2 AA)

- **Conformance target:** WCAG 2.2 AA across all workflows, verified in CI (axe on every component test) and in Playwright journeys. An AA conformance statement ships with the release.
- **Keyboard:** every interactive element reachable and operable; visible 2 px focus ring with 3:1 contrast; focus order matches visual order; modal traps focus and restores it on close; `Esc` cancels a confirmation without acting; shortcuts documented in a `?` dialog and never shadowing browser/AT shortcuts.
- **Scanning without a pointer:** hardware scanners act as keyboards, so all scan fields are in the tab order; the worklist exposes "scan tube" as a focused field on load.
- **Screen readers:** landmarks (`header`, `nav`, `main`, `aside`), one `h1` per route, live regions for status and toasts, `aria-describedby` on all inputs with help or error text, tables with `<caption>`/headers, and chart alternatives (data table + text summary).
- **Target size & motion:** 44×44 px minimum (WCAG 2.2 2.5.8), `prefers-reduced-motion` honoured (transitions ≤ 100 ms, no parallax), no flashing.
- **Forms:** errors summarised at the top of the form and linked to fields; no placeholder-only labels; units and formats in the label; required fields marked in text.
- **Colour & contrast:** never colour-only (status pills include text/icons); dark mode validated; 200 % zoom and 320 px reflow supported.
- **Timeouts & session:** idle warning is announced, extensible, and never applied to a form with unsaved PHI without a save prompt.
- **Testing:** automated axe scans plus manual NVDA + VoiceOver + TalkBack passes on the top 20 journeys (login, patient search, check-in, chart, order, collect, result entry, verify, amend, critical acknowledge, Rx verify, dispense post, controlled witness, GRN post, count post, adjustment post, payment, shift close, audit search, DSR).

---

## 18. Internationalization & units

- **Locales:** en-PH (default), en-US; the tenant sets the default; users may override. Number, date, and currency formats come from `Intl` with the tenant locale; **stored formats are always canonical** (ISO 8601 dates, `Asia/Manila` tenant timezone).
- **Currency:** stored server-side as `numeric(14,2)` (architecture §6) and always rendered from the server value; displayed with the tenant's currency via `Intl.NumberFormat`; multi-currency priced items show the base and the converted amount with the rate date. The client never re-computes a total.
- **Units:** quantities are stored in base UOM and displayed in the item's preferred UOM with the conversion shown on demand ("12 base = 6 packs"); pharmacy strengths always show the unit.
- **Clinical numbers:** result values are stored with analyte precision and displayed with the analyte's decimals; a raw value with more precision is available to authorised roles.
- **RTL and CJK:** not in v1 scope, but the layout uses logical CSS properties (`margin-inline`, `padding-block`) so it is not a rewrite later.

---

## 19. Error, empty, and loading states

Every screen in the product implements the same six states, and they are specified in the design system, not per page:

1. **Loading:** shape-stable skeletons for tables; a spinner only for whole-page transitions under 300 ms; long operations show determinate progress.
2. **Empty (no data):** explains the concept and offers the create action with the permission check.
3. **Empty (no matches):** shows the active filters and a "clear filters" action.
4. **Forbidden:** names the missing permission and the role that has it; no data, no partial reveal.
5. **Error:** `ApiProblem` copy, correlation id, retry where retryable, and a "report this" affordance that includes the correlation id (never PHI).
6. **Offline:** cached content with a "last synced" stamp, disabled actions with inline reasons, and the pending-sync indicator.

Additionally: **conflict** (diff modal), **stale** ("this record changed — review"), and **partial success** (batch results listing what succeeded and what failed) states exist for bulk and multi-line operations (count post, GRN post, bulk upload, dispense post).

**Module-specific states.** Three more surfaces exist only because entitlements exist:

- **Module not available:** the module is not in the tenant's set. Replaces "Forbidden" — it names the module, says the clinic has not enabled it, and offers "request this module". It deliberately does *not* name the permissions that would be required, so the client never leaks capability information the server would not.
- **Module read-only (`DRAINING`):** the screen renders fully with a persistent banner ("Billing is closing — new charges are off, existing records can still be viewed and printed"), write controls disabled with inline reasons, and a note of what happens to work in progress.
- **Entitlement changed elsewhere:** when `/session` returns a newer `modules_version` than the one the UI was built on, a quiet toast says a module was added or removed and the affected queries are invalidated. The user is not navigated away mid-task; if the current screen is the one that lost its module, the read-only banner is shown first, then the route guard resolves.

---

## 20. Security in the client

- **XSS:** no `dangerouslySetInnerHTML` on server or user content; CSP with nonce-based script policy, no `unsafe-inline`; `frame-ancestors 'none'`; sanitised rich text with an allow-list in the note editor; PDFs rendered in a sandboxed `<iframe>` from a blob, never navigated top-level.
- **Tokens:** access token in memory only; refresh token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; rotated on every refresh with reuse detection; cleared on sign-out and on idle expiry; never logged.
- **PHI hygiene:** no PHI in URLs, `localStorage`, `sessionStorage`, analytics, error reports, or session replays (Sentry `beforeSend` scrubber + `denyUrls`); the command palette redacts results until opened; patient banners auto-mask; screenshots are discouraged by design (no auto-masking overlays).
- **Break-glass hygiene:** the platform console has a hard UI block on any patient-scoped deep link (`/patients/...`, `/laboratory/orders/...`) — those routes render "Not available in platform scope" with no data fetch.
- **CSP & headers** are set at the edge; the client asserts them in a Playwright test.
- **Dependency hygiene:** lockfile pinned, `npm audit`/OSV gate in CI, and no runtime `eval` of remote code.

---

## 21. Performance budgets

| Metric | Budget | Measurement |
|---|---|---|
| LCP (mobile, 4G emulation) | ≤ 2.5 s | Lighthouse CI on `/login`, `/app/dashboard`, worklist |
| INP | ≤ 200 ms | Lighthouse CI + RUM |
| CLS | ≤ 0.1 | Lighthouse CI |
| Initial JS (gzip, app shell) | ≤ 250 kB | Bundle size gate; route-level code splitting |
| Route chunk (worklist, chart) | ≤ 120 kB | Bundle gate |
| Table interaction (sort/filter p95) | ≤ 150 ms | Performance test on 5 000-row fixture |
| List API p95 (server) | ≤ 300 ms for a 50-row page | Architecture §17 SLO: CRUD p95 < 300 ms, searches < 1 s |
| Offline cold start (shell cached) | ≤ 1.5 s | Playwright offline test |
| Scan-to-resolve | ≤ 400 ms | Manual + instrumented test |
| Print-to-PDF for a 200-line report | ≤ 3 s | Timing test |

Route-level `React.lazy` for feature chunks, `virtualisation` for large lists, `prefetch` on row hover/focus for detail routes, image sprites for icons (no icon font), and skeleton-first rendering to hold CLS.

---

## 22. Frontend testing strategy

**Layers.**

1. **Unit (Vitest):** formatting (money, dates, quantities, UOM), validators, Zod schemas, permission helpers, query-key builders, outbox reducer, encryption round-trip, expiry/FEFO display logic. Target ≥ 90 % line coverage on `shared/` and `offline/`; feature components ≥ 80 %.
2. **Component (RTL + MSW):** every `packages/ui` component; each feature screen's happy path, forbidden, empty, error, and offline states; axe scan on every story/test.
3. **Contract (from OpenAPI):** generated types are checked against the API's spec in CI (schema diff), and MSW handlers are generated from the same document so drift fails the build.
4. **Integration (RTL + MSW):` full workflows with mocked API — verify, controlled dispense with witness, GRN post, count post with conflict, payment with split tender, break-glass session lifecycle.
5. **E2E (Playwright):** one journey per persona (11 journeys), run against a real API + Postgres in CI, each asserting the audit entry and the tenant-isolation outcome where relevant; plus an isolation journey that attempts cross-tenant deep links and asserts `404` and no data in the response.
6. **Visual regression (Playwright snapshots):** worklist, patient banner, result entry, cashier, controlled register, critical alert modal — because these are the screens where a layout change is a safety change.
6a. **Entitlements (component + E2E):** the module step of the tenant wizard (dependency auto-tick, plan-locked cards, live summary), the tenant Modules tab (preflight results, drain countdown, force-disable confirm), the "module not available" surface, and the `DRAINING` read-only banner. E2E asserts the full lifecycle: create with three modules → a non-entitled route `404`s → disable with open work is refused → drain → force-disable → re-enable → data and permissions are intact.
7. **Accessibility (axe + manual):** CI axe on all journeys; a manual checklist per release for the top 20 journeys (§17).
8. **Performance:** Lighthouse CI budgets (§21) and a Playwright trace regression check on the worklist.
9. **Offline:** Playwright `context.setOffline(true)` journeys for count, vitals, and a non-controlled dispense; assertions on outbox contents, sync, idempotency (submit twice → one record), and conflict resolution.

**Test data.** A seeded factory per tenant (two tenants by default: "Northwind Clinic" — full clinical/lab/pharmacy/billing — and "Southgate Medical" — deliberately `admin` + `patients` + `supply` only, the shape that proves module gating) with fixtures for patients, items with near-expiry batches, lab orders at every stage, a critical result, a controlled Rx, a GRN with a shelf-life violation, a variance count, and a period lock. Tests never create PHI resembling real people.

**Definition of frontend done.** A feature ships when: its states (§19) are implemented and designed; keyboard and axe checks pass; its contract tests exist; its E2E journey passes; its telemetry has no PHI; its offline behaviour (if any) is tested; its screens are in the visual-regression baseline; and, for anything inside a module, it degrades correctly when that module is non-entitled, draining, or disabled.

---

## 23. Design handoff & acceptance checklist

- **Component contract sheet** for `packages/ui` (props, a11y, states, tokens) is generated from the wrappers and reviewed by both frontend and backend engineers.
- **Per-feature screen pack:** wireframe → Bootstrap-based layout → light/dark → mobile/desktop → empty/error/offline → copy from the API error catalogue. Copy for destructive actions and clinical warnings is reviewed by a domain reviewer (pharmacist, lab manager, nurse) — not only by engineering.
- **Token audit** on every pull request that adds a colour, size, or radius (lint rule).
- **Design QA pass** before each phase gate (see [todo.md](todo.md)): walk the persona journeys on a real phone and a real tablet, offline and online, light and dark.
- **Copy deck:** every status label, warning, and confirm sentence, aligned with `ApiProblem` codes so the client copy and the server reason never disagree.

> This document is an engineering and design specification. Clinical and pharmacy wording, thresholds, and workflows must be reviewed by qualified clinicians, a pharmacist-in-charge, and a lab manager before release; regulatory behaviours must be validated with counsel and each tenant's Data Protection Officer.
