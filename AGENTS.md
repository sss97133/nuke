# AGENTS.md — how to work in this repo

Rules for every coding agent here. Claude Code loads this file through `CLAUDE.md`; Cursor, Codex and
other tools read it directly. It holds what is true everywhere and points to the rest.

## What this is
Nuke (nuke.ag) is a data machine for physical assets: every observation about an asset is kept with its
source, its clocks and its trust, and state, baselines and predictions are computed from that log, point-in-time,
so every number can be replayed and graded. Vehicles are the first asset class (see `README.md`). The stack:
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

Data-model progress reports must put the full population and its measurement date beside the
numerator, then show the eligible population, net usable coverage gained and remaining backlog.
Choose the measurement from the intended public activity before counting. Follow the
public-use readiness criteria in `docs/ledger/theory/data-machine.md`: per-capability ready,
blocked and not-assessed populations, anonymous source-to-reader acceptance, quality/freshness
evidence and net supported-answer gain. Any-binding coverage, eleven-field fullness and
canonical-claim presence are diagnostics, not public readiness. For Facebook/source collection,
declare intended channels/markets, target enumeration, capture depth and revisit obligations;
recent capture batches are neither platform nor retained-population denominators.
Label estimates and unknown denominators explicitly. A fixed cohort is validation scope; completed
source-property work and distinct vehicles touched are processing measures, not modeled-fleet
coverage. Follow the fleet-relative reporting contract in `docs/ledger/theory/data-machine.md`.

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
For the delivered reader repairs, remaining evidence relationships, acceptance cases and private
receipt locations, use the [`retained evidence repair guide`](docs/market/RETAINED_EVIDENCE_REPAIR_GUIDE.md).
Its dated findings are a starting point; verify the affected owner before a new repair.

For ongoing database repair, follow the **schema-aware repair loop** in `data-machine.md`:
recognize relationships from retained evidence, find the existing owner, implement an authorized
repair and prove its consumer. Configuration is one application; a diagnostic report alone does
not close the work. The bounded discovery assays are operator tools, not autonomous write authority.

Recursive work must return to its original failed question after each repair. Test the actual intake,
PostgreSQL admission and consumer together; a registered property or a successful duplicate lookup is
insufficient. Recheck withdrawal, supersession and source visibility through every affected reader.
Carry the next observed gap into code and the methodology together, preserving deployment holds.
Roles such as artist, buyer and researcher describe evidenced behavior in context; do not turn them
into permanent identity types or mandatory arrival choices without a separate model decision.

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
  - Create a simple view in `public` (one table, no aggregate) `WITH (security_invoker = true)`. The
    `view_write_guard` event trigger fails a statement that leaves a view there running as its owner
    while anon or authenticated can write through it; its migration,
    `supabase/migrations/20261014214500_view_write_guard.sql`, lists the cases.
  - Verify it live after the run.
- **Edge functions.** Same path; CI deploys the function folders the commit changed. A function that
  writes calls `requireWriteAuth` (`supabase/functions/_shared/writeGuard.ts`), and
  `scripts/guardrails/check-write-guard.mjs` fails the deploy otherwise.
- **Row writes.** Only through the sanctioned writers: `ingest-observation`,
  `correct_vehicle_sale_provenance_batch`, `correct_vehicle_event_attribution` (a BaT event's organization,
  seller identity and metadata, by merge, with the before-image kept on the row), and the supersession functions.
  - Image evidence store (from M1w, `20261021221000`; not live until it deploys). These writers write only the evidence
    store and touch no existing testimony table. Jobs call `evidence_open_run`, `evidence_close_run`,
    `evidence_record_answers`, `propose_image_candidates`, `propose_capture_time_claims`,
    `confirm_capture_times_by_rule`, `propose_evidence_links`, `propose_account_entities`, `propose_change_claim`,
    `propose_claim_support` and `record_day_context` as top-level PostgREST RPC with the service-role key under
    `dotenvx run`, never from q.sh; `evidence_record_answers` stores his chat answers and decides nothing.
    `decide_evidence` is called only from the owner's own aal2 session. No job can call it (it is not granted to the
    service role and its body refuses a job caller), and a delegated Sign (`owner_delegated_sign_register`) never
    stands in for it.
  - No raw INSERT, UPDATE or DELETE on testimony tables.
  - No `DISABLE TRIGGER`.
  - No `statement_timeout = 0`.
- **Reads.** Use `scripts/data/q.sh "SELECT …"`.
- **Frontend.** Open a PR to `main`. Vercel deploys on merge, which takes 8–10 min. Check the live page
  afterwards.
- **Grants, policies and public reads.** A migration that revokes or narrows a grant or policy on a table the public
  site reads (`vehicle_images`, `vehicles`, `vehicle_events`) is not done at "tests pass". Before it merges, grep every
  consumer: PostgREST filters and computed-column functions that take the whole row (`vehicle_image_gallery_eligible`;
  a whole-row reference needs every column, so column grants break it), `select=*`, joins, and policies on other
  tables. After it deploys, run `node scripts/ci/logged-out-live.mjs` (it also runs after every deploy and every 30
  minutes and opens an issue, "Live site broken for logged-out visitors"); say "live" only with its output.
  2026-10-19: #2293 limited anon to column grants and every logged-out gallery failed for hours while every check was
  green (fixed in #2320, #2322; the live check is #2323).
- **Never** hand-apply a migration or function deploy, and never change compute, plan or disk.

## Books and tax work
- Start with `books_year_state(owner, year)` (RPC; migration `20261101170000`): Schedule C lines per schedule, owner
  rulings, return-level facts (filing status, residency and credits, CFC/GILTI, Form 5471), the newest return result
  and open items with what closes each. Settled facts live there, not in local files; do not re-derive them.
- Write results, rulings and facts only through `ingest_financial_evidence`: Schedule C rulings with
  `scripts/books/schedule_c_rulings.py`, return-level facts and results with `scripts/books/return_facts.py`.
- A return builder passes `db-books/drift_check.py` before its result is reported, and
  `scripts/books/books_year_state_check.py` (line 31 from the API equals the drift-check totals, 2022-2025) after.
- A year is trusted only when `books_year_gate(owner, year)` passes every rule (R1-R9: one treatment per movement,
  credits are revenue unless proven, no double count, cash method, evidence on expenses of $75+, depreciation from an
  asset register, monthly mixed-use percentages, SE tax/credits/GILTI computed from stored inputs, no drift). Run
  `scripts/books/books_year_gate_check.py` and list the failures; never fix them silently.

## PR titles and commit messages
The repo is public, and a squash merge puts the PR title (or a single commit's subject) on `main` as the
permanent record. Write both as `type(scope): summary`, at most 72 characters. The PR gate in
`pre-deploy-check.yml` fails any other form. Check a title before `gh pr create` with
`node scripts/ci/pr-title-check.mjs "<title>"`; with no argument it checks the branch's open PR, and
`scripts/ci/verify.sh` (the pre-push gate) warns when that title would fail. After a retitle,
`gh run rerun <run> --failed` passes: the gate reads the live title.
- **type**: `feat`, `fix`, `perf`, `refactor`, `data` (backfills and corrections), `docs`, `test`, `ci`,
  `build`, `chore` or `revert`.
- **scope**: the component, by its code name. That can be a table (`vehicle_events`), a function
  (`extract-gooding`) or an area (`db`, `ingest`, `frontend`, `ios`, `cad`, `ci`).
- **summary**: lowercase and imperative, with no trailing period. Name the mechanism (index, writer,
  trigger, parser, view, migration).
- Keep these out of titles and put them in the body: narration, internal case numbers (C28, §13.3),
  personal vehicles, people and money.
- Examples: `feat(extract-craigslist): parse listing attributes into vehicle fields`,
  `perf(db): partial index on vehicle_observations.source_vehicle_event_id`,
  `data(vehicle_events): backfill listing_key on Gooding and RM episodes`,
  `feat(cad): engine assembly mesh at 1:1 scale`.

## Working alongside other agents

- Preserve the owner's original outcome and later corrections in one current pickup;
  a new detail does not replace the integrated task. Use existing tools for routine
  checks, Luna for suitable small jobs, Sol for scoped engineering and Astra for gist,
  difficult decisions and deep iteration. These are starting preferences, not automatic
  routing or permission to spawn paid work. The [workspace workflow](docs/AGENT_WORKFLOW.md)
  provides installed commands and a compact handoff; load it when routing or resuming
  substantial work, not before every edit.

- Work in your own worktree:
  `git worktree add ~/.worktrees/<task> -b <branch> origin/main`, then
  `ln -s ~/nuke/nuke_frontend/node_modules ~/.worktrees/<task>/nuke_frontend/node_modules` so the
  pre-commit type check finds `tsc` (a fresh worktree has no dependencies installed). Before pushing a
  migration run `scripts/hooks/pre-push` (or set `git config core.hooksPath scripts/hooks` once per clone): it fails
  when a migration version is shared within your branch or with origin/main. CI enforces the same check
  (`validate` runs it against a freshly fetched latest main) and fails the PR. When the PR is
  merged, `git worktree remove ~/.worktrees/<task>`; the branch may stay. A worktree is about 500 MB,
  and on 2026-10-13 the laptop held 404 of them (382 GB) with 14 GB of disk left.
- When several sessions run, one lane list says who owns what: `.claude/LANES.md` in the shared checkout
  (local, not committed). Codex threads register there too, with the path of their pickup file. Tell the
  others before you push. Handoffs go in `.claude/handoffs/`; finished work is logged to `DONE.md` with
  `claude-log-done` (both local). Codex lanes keep their working receipts under `~/nuke-logs/<lane>/`.
- Merge your own PR once every check is green (owner, 2026-10-12), one at a time when it carries a
  migration or a function so the deploy run applies each; then verify the live surface and say which
  stage was reached: implemented, tested, merged, deployed or runtime-verified. Green means every job
  the workflows define ran and passed: "nothing pending" with jobs missing is a broken workflow, not a
  pass (2026-10-13, four PRs merged while `frontend-tests` ran zero jobs).
- Read a file before changing it, and keep changes surgical. A fix is a few lines, not a rewrite.

## Rules by area
`.claude/rules/` holds rules that Claude Code loads when you touch their folders. Other tools should
open them by path:
- `frontend.md` for `nuke_frontend/src`.
- `db-safety.md`, `edge-functions.md` and `extraction.md` for `supabase/`.
- `library.md` and `supply-side.md`.
- `wiring-receipt.md` and `wiring-wire-closure-protocol.md` for `docs/wiring/`.
- `apps/nuke-capture-ios/README.md`, section "The room", for the iOS app (sub-folder `CLAUDE.md` files are
  gitignored, so the README is the tracked home).
- `production-engineering.md` and `liveness-and-intent.md`, which apply everywhere.
