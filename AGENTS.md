# AGENTS.md — Clinic Platform

Working agreements for this repo. Read `todo.md §49` (Ground rules) and
`todo.md §39` (How to use this plan) before starting any phase — they are
authoritative and this file does not restate them.

## Rule 0 — Preflight before you touch anything

```powershell
./.opencode/skills/doc-preflight/scripts/preflight.ps1 -Root .
```

Runs a read-only consistency gate over the root `*.md` (skips `README`,
`AGENTS`, `CLAUDE`, `CHANGELOG`, `CONTRIBUTING`, `LICENSE`, `NOTICE`, `SECURITY`).
Exit `1` on any error → **blocks work**. Fix or report; never edit around it.

Then read the doc that owns the decision:

| Task is about | Read |
|---|---|
| Behaviour, permissions, endpoints, jobs, reports, acceptance | `specification.md` |
| Data model, tenancy, security, request flow, tech choices | `architecture.md` |
| Screen, state, navigation, components, E2E coverage | `frontend.md` |
| Sequencing, exit gates, open questions, risk register | `todo.md` |

Cite `§` numbers in your summary. A task that contradicts the docs is a **scope
question for the user** — never silently "fixed" in code. If a task resolves an
open question (`specification §20`) or changes a contract, update the owning doc
in the same change.

## Skill routing

Skills are installed **globally** — do not copy them into `.opencode/skills/`.
Load the one that matches the task:

| Task | Skill |
|---|---|
| Anything, before starting | `doc-preflight` (project-local) |
| New feature, bug fix, refactor | `tdd-workflow` |
| Before claiming done | `verification-loop` |
| Auth, input, secrets, API endpoints, PHI | `security-review` |
| Schema change / migration | `database-migrations`, `postgres-patterns`, `prisma-patterns` |
| React components, hooks, state | `react-patterns`, `frontend-patterns` |
| Component tests, accessibility | `react-testing` |
| E2E + axe WCAG 2.2 AA | `e2e-testing`, `browser-qa` |
| Slow renders, waterfalls, bundle size | `react-performance` |
| "Buttons don't work", shared state, post-refactor | `click-path-audit` |
| RLS policy, FEFO invariant, multi-constraint reasoning | `sequentialthinking` MCP |
| Unfamiliar area / first session | `codebase-onboarding` |

## MCP routing

| Need | Tool |
|---|---|
| Symbol search, find references across the monorepo | `serena` |
| DB health, unused/duplicate/bloated indexes, EXPLAIN | `postgres` MCP |
| Real browser + axe scan | `playwright` MCP |
| Version-accurate lib docs | `context7` MCP |
| Clean HTML→Markdown (RFCs, changelogs) | `fetch` MCP |
| Network/CPU profiling, console errors | `chrome-devtools` MCP *(enable on demand)* |
| Issues / PRs / CI | `github` MCP *(enable on demand)* |

## Environment — verified facts

- pnpm workspaces: `apps/api`, `apps/web`, `packages/{contracts,db,ui}`, `tooling`.
- Node ≥20. Use **pnpm**, not npm.
- React 19.3, React Router 7.18, Vite 7.3, Bootstrap 5.3.8 + react-bootstrap 2.10.10.
  Playwright is already installed — do not add a Vite or Playwright package.
- **No Docker.** PostgreSQL 18.4 runs directly on `localhost:5432`.
- Local DB: `public` schema holds the 29 tables; roles are `owner` / `app` /
  `report` (see `packages/db/src/pool.ts`).

### Postgres MCP is read-only by default

Configured `--access-mode=restricted`. Verified to block `INSERT`, `UPDATE`,
`CREATE`, `DROP`, and multi-statement escapes like `ROLLBACK; DROP TABLE`.

- **Default to reads** for schema inspection and query analysis.
- Writes require restarting that session with `--access-mode=unrestricted`.
- If unrestricted, you are writing to a database holding PHI — confirm the task
  actually requires a write first. The MCP path bypasses application RLS.
- The connection URI comes from `CLINIC_DATABASE_URL`. If the server fails with
  `Connection closed`, that variable is not inherited — the environment change
  postdates the running process. Restart OpenCode rather than inlining the
  credential into `opencode.json`.

## Ground rules — non-negotiable

Full text and rationale: `todo.md §49`. In short, every PR must preserve:
tenant isolation proven by test (RLS enabled **and** forced, composite tenant
FKs), no `BYPASSRLS` role in the app path, single-transaction idempotent 🔒
endpoints, audited state changes, no PHI crossing the tenant boundary, no
client-side money/stock computation, append-only destructive actions, versioned
reference data, and observable tenant-scoped background jobs.

Weakening any of these is an **architecture change requiring a new ADR** — not a
bug fix. Say so rather than shipping it quietly.

## Completion

A ticked box means **merged, tested, and demonstrated** (`todo.md §39`). Run
`verification-loop` and report actual command output — never claim a check
passed without having run it in this session.