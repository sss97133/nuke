# AGENTS.md — how to work in this repo

Rules for every coding agent here. Claude Code loads this file through `CLAUDE.md`; Cursor, Codex and
other tools read it directly. It holds what is true everywhere and points to the rest.

## What this is
Nuke (nuke.ag) is a vehicle data ledger: every vehicle and every observation about it, each with its
source. The stack:
- Supabase project `qkgaybvrernstplzjaam`: Postgres, plus edge functions in `supabase/functions/`.
- Web frontend in `nuke_frontend/` (Vite), deployed by Vercel.
- iOS app in `apps/`.

Nuke is pre-launch, and production is the test environment.

**Start at the atlas.** It is computed from the live database, so it is always current:
- `v_schema_atlas` has one row per table: live activity (written / read-only / idle), rows, size,
  description, columns described, owners, writers, triggers and links.
- `v_job_health` does the same for scheduled jobs.

For example: `scripts/data/q.sh "select * from v_schema_atlas where table_name = 'vehicles'"`.
`docs/ledger/` is an older snapshot. Before you decide any function or table is alive or dead, check
the atlas, then `docs/ledger/README.md`. Before you touch the database, a monitor, a fold or a page that shows
data, read `docs/ledger/theory/data-machine.md` and its case ledger `data-machine-cases.md` (the owner's
vocabulary, the open cases, the compass). Before you make
a new function, table or folder, check `docs/ledger/CAPABILITY_MAP.md`
(`node scripts/guardrails/check-capability-before-mint.mjs "<name>"`) and extend what already exists.

## Reading the system

The documents have different jobs. Use the relevant entry point instead of treating every file as
an equally current description of the system:

| Question | Where to start | What it establishes |
|---|---|---|
| How should I work on this task? | Current owner instructions, this file and the applicable rules below | Scope, authorization and development procedure |
| What is the data machine meant to do? | `docs/ledger/theory/data-machine.md` | The owner's model, vocabulary and design invariants |
| Which problem is open, and what would close it? | `docs/ledger/theory/data-machine-cases.md`, the relevant handoff and recent `DONE.md` entries | Work direction and dated acceptance evidence |
| What exists and operates now? | Live `v_schema_atlas`, `v_job_health` and a bounded probe of the affected writer/reader | Current schema, ownership, activity and behavior |
| What is mechanically enforced? | Constraints and permissions; `scripts/ci/verify.sh`; the applicable `.github/workflows/` | The actual checks and their execution paths |
| What was found in earlier audits? | The inventories in `docs/ledger/` | Historical evidence and candidate capabilities to verify |

Read the documents needed for the task; loading the whole documentation tree is unnecessary.
Keep the date and limits of a measurement when citing it. A historical inventory cannot establish
current health or authorize removal. A stated invariant cannot establish enforcement: name the
constraint, permission, test or gate that implements it, or record the missing mechanism.
Documentation changes should preserve owner intent while correcting stale navigation and status
claims. See `docs/ledger/README.md` for the distinction between active guidance and audit outputs.

## Answering vehicle and opportunity questions

Read the existing database and reader contracts first. Reuse stored source captures and extraction
results before fetching the same evidence again. Report the retrieval boundary and the specific
missing relation or field; do not turn an incomplete reader into a claim that the data does not exist.

A listing first establishes a **blip**, with attributed text, photos, source identity and clocks.
Retain unresolved vehicle matches. A badge is evidence of a badge; a seller's specification is an
attributed claim. Ask for the next evidence needed for the current decision, at its current stage.

Keep the wider market available as supporting evidence. A thin configuration slice sits inside
model, generation and broader purpose-specific cohorts. Market volume, movement, liquidity, price
and configuration rank have different eligibility rules. Incomplete price evidence can still support
an observed presentation count; it cannot become a confirmed sale. Return coverage, unresolved
members and exclusion reasons alongside each measure. A candidate's asking-price percentile does
not establish its vehicle's expected value or rank.

The owner made this an all-vehicle repair requirement on 2026-10-04. Before changing an appraisal,
comparable, market or opportunity reader, read **C27 / §11** in
[`data-machine-cases.md`](docs/ledger/theory/data-machine-cases.md#11-whole-market-evidence-and-immediate-vehicle-questions)
and the existing [`market reader contract`](docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md).

For ongoing database repair, follow the **schema-aware repair loop** in `data-machine.md`:
recognize relationships from retained evidence, find the existing owner, implement an authorized
repair and prove its consumer. Configuration is one application; a diagnostic report alone does
not close the work. The bounded discovery assays are operator tools, not autonomous write authority.

## Invariants
1. **Facts are never invented.** Every datum carries its source, method, observed_at and trust.
   "Unknown" is an answer; a guess is not.
2. **Testimony is never overwritten or deleted.** It is superseded, and the original is kept.
3. **The repo is not prod.** Verify a claim against the live system before acting on it. The probe kit is in
   `.claude/rules/production-engineering.md`.
4. **This repo is public.**
   - Secrets never enter it.
   - Private data (people's contact details, invoices, amounts) doesn't either. It lives in the database,
     and code and docs refer to it by id.
   - `VITE_*` values ship to browsers, so no secret gets that prefix. `npm run build` fails if one does.

## Writes and deploys
- **Schema, cron and SQL functions.** Write a migration file, make one commit, and push it yourself.
  - Before pushing, check that `gh run list --workflow supabase-deploy.yml` is idle, and tell the other
    sessions "pushing <sha>, <file>".
  - One migration per commit per push: CI applies only the last commit's new files.
  - Set `statement_timeout` and `lock_timeout` in any migration that can wait on a lock (the pooler
    default is 10 s).
  - Verify it live after the run.
- **Edge functions.** Same path; CI deploys the function folders the commit changed. A function that
  writes calls `requireWriteAuth` (`supabase/functions/_shared/writeGuard.ts`), and
  `scripts/guardrails/check-write-guard.mjs` fails the deploy otherwise.
- **Row writes.** Only through the sanctioned writers: `ingest-observation`,
  `correct_vehicle_sale_provenance_batch`, and the supersession functions.
  - No raw INSERT, UPDATE or DELETE on testimony tables.
  - No `DISABLE TRIGGER`.
  - No `statement_timeout = 0`.
- **Reads.** Use `scripts/data/q.sh "SELECT …"`.
- **Frontend.** Open a PR to `main`. Vercel deploys on merge, which takes 8–10 min. Check the live page
  afterwards.
- **Never** hand-apply a migration or function deploy, and never change compute, plan or disk.

## Working alongside other agents
- Work in your own worktree:
  `git worktree add ~/.worktrees/<task> -b <branch> origin/main`.
- When several sessions run, one lane list says who owns what. Tell the others before you push.
- Read a file before changing it, and keep changes surgical. A fix is a few lines, not a rewrite.

## Rules by area
`.claude/rules/` holds rules that Claude Code loads when you touch their folders. Other tools should
open them by path:
- `frontend.md` for `nuke_frontend/src`.
- `db-safety.md`, `edge-functions.md` and `extraction.md` for `supabase/`.
- `library.md` and `supply-side.md`.
- `wiring-receipt.md` and `wiring-wire-closure-protocol.md` for `docs/wiring/`.
- `production-engineering.md`, which applies everywhere.
