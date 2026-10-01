---
name: doc-preflight
description: "Review the project's .md documents before starting any job, task, or code change. Runs a mechanical consistency gate (broken cross-references, undeclared identifiers, duplicate section numbers, unclosed code fences, malformed tables, dead links, encoding corruption) and then reads the doc that owns the decision. Use when: starting a phase or feature, before writing code against specification.md / architecture.md / frontend.md / todo.md, resuming work after a break, or when asked to 'review the docs first', 'check the spec', 'start the next task', or to sanity-check documentation before a build."
---

# Doc Preflight

Engineering docs drift the moment they are written. Code written from a stale
mental model is the most expensive defect class there is — it ships, and it
contradicts the spec. So: **run the gate before you touch anything.**

This is a read-only gate. It never edits your documents.

## The rule

Do not begin implementation work until the preflight has run and you have read
the document that owns the decision. If the gate fails, fix or report first.

## Step 1 — run the gate

From the repo root:

```powershell
./.opencode/skills/doc-preflight/scripts/preflight.ps1 -Root .
```

Auto-discovers `*.md` in the root (skips `README`, `CHANGELOG`, `CONTRIBUTING`,
`LICENSE`, `AGENTS`, `CLAUDE`, `NOTICE`, `SECURITY`), reports **ERROR** (blocks
work) and **WARN** (note it), and exits `1` on any error, so it drops straight
into CI.

| Flag | Use |
|---|---|
| `-Root <dir>` | Document directory (default `.`) |
| `-Docs <paths>` | Explicit file list instead of discovery |
| `-Quiet` | Suppress the report; keep the exit code (for CI) |

| Check | Catches |
|---|---|
| `discovery` | A file passed via `-Docs` that does not exist |
| `encoding` | Invalid UTF-8, U+FFFD mojibake from a bad edit |
| `fences` | Odd fence count — an unclosed code block |
| `headings` | Duplicate section numbers (breaks every `§N` reference) |
| `xref` | `spec §14` pointing at a section that does not exist |
| `ids` | An identifier whose family the catalogue defines, but which it never declares (`JOB-99` when only `JOB-01…50` exist) |
| `links` | Local `.md` link targets that are missing |
| `table` | A markdown row with the wrong pipe count for its table |
| `ids` (warn) | Lookalike separators (en/em hyphen, nbsp) — invisible in search |
| `stub` (warn) | A section with no content of its own |

The **catalogue** doc is auto-detected as the one that *defines* the most
identifiers (first table column or list marker) — not the one that merely
mentions the most, which a typo-ridden downstream file can beat.

## Step 2 — read the doc that owns the decision

The gate proves the docs are internally consistent. It cannot tell you what
they *say*. Read the owning document for the task at hand:

| The task is about… | Read | Because |
|---|---|---|
| What a feature must do, permissions, endpoints, jobs, reports, acceptance | `specification.md` | Source of truth for behaviour |
| How it is built, data model, security, request flow, tech choices | `architecture.md` | ADRs and isolation mechanisms live here |
| Screen, state, navigation, component and E2E coverage | `frontend.md` | UI contract |
| What to build next, in what order, and the phase exit gate | `todo.md` | Sequencing, exit gates, risk register |

Always read `todo.md` "Ground rules" — ten invariants every pull request must
preserve. Weakening one is an architecture change needing a new ADR, not a bug fix.

Also read `todo.md` "How to use this plan". It sets the rules of engagement: a
tick means **merged, tested, and demonstrated**; a phase is not done until its
**exit gate** is ticked; and a 🔺 task blocked by an open question
(`specification §20`) cannot start until that question is signed off.

Read the specific sections, not the whole file. Then check the task against what
you read — a task that contradicts the docs is a **scope question for the user**,
not something to silently "fix" in code.

## Step 3 — report before you start

State plainly, in a few lines:

1. **Gate result** — clean, or which findings and where (`file:line`).
2. **What the docs require** for this task, citing `§` numbers.
3. **Anything unresolved** — an open question (§20), a contradiction between
   docs, or a task whose stated scope conflicts with the spec.

Then begin work. Keep the citations in your final summary so the work is
traceable to the document that authorised it.

## Working rules

- **The docs are the source of truth.** When code and docs disagree, that is a
  defect in one of them — do not let code silently win. Fix the doc or raise it.
- **Never work from memory of these docs.** Read them this session. Section
  numbers and identifier ranges move.
- **Write decisions back.** If a task resolves an open question or changes a
  contract, update the owning doc in the same change. A decision that lives only
  in a commit message is lost.
- **Keep identifiers canonical.** Copy `JOB-03`, never retype it — lookalike
  hyphens are invisible until someone greps for it.
- **Do not "fix" a failed gate by editing around it.** If a finding looks wrong,
  verify it by hand first, then either correct the checker or the doc.

## Stop and ask when

- The gate reports errors you believe are false positives. Verify manually,
  explain the finding, and ask before proceeding — do not suppress it.
- A task's scope contradicts the specification. The user decides which wins.
- A required decision is parked in the open-questions section and has no default.