# docs/ledger — design guidance, open cases and dated inventories

Start with the repository's [`AGENTS.md`](../../AGENTS.md) for task scope and development rules.
This folder contains both active owner guidance and historical audit outputs; their roles differ.

- [`theory/data-machine.md`](theory/data-machine.md) defines the owner's data-machine model and
  vocabulary, promoted on 2026-09-30. Read it before database, monitor, fold or data-reader work.
- [`theory/data-machine-cases.md`](theory/data-machine-cases.md) records open cases, acceptance
  criteria and dated measurements. Use current handoffs and recent `DONE.md` entries to establish
  what has since been implemented, tested, merged, deployed and verified.
- Live `v_schema_atlas`, `v_job_health` and bounded writer/reader probes establish current
  operational state. Counts in these documents are measurements from their stated dates.
- The capability and asset inventories below came from a **2026-07-12 audit**. They help locate
  existing machinery and explain earlier decisions; verify their verdicts before acting.

The July audit replaced `CODEBASE_MAP.md` (now archived). Its measurements and classifications are
retained as historical evidence, not a current census or a declaration that this folder is deprecated.

## THE ONE RULE

> Before you build anything — a function, table, page, queue, cron, script — look in
> **`CAPABILITY_MAP.md`**. If a canonical owner for that capability exists, **extend it. Never mint a parallel one.**
> Preflight a name: `scripts/guardrails/check-capability-before-mint.mjs "<name-or-capability>"`

Why this exists: the **2026-07-12 audit** found 204 edge functions (target ~50), 913 tables (**739 empty**),
136 crons (**18 active**), and **74 capabilities implemented more than once**. The audit described the live
platform at that time as ~30 functions, ~20 tables, ~10 SQL routines and 18 crons, and classified
the remainder as shells.
These figures describe that audit's scope and date. Use the live atlas for today's shape.

## The artifacts

| File | What it answers | Axis |
|---|---|---|
| `CANONICAL_LEDGER.md` | Earlier per-asset verdicts and their evidence; re-verify activity live | dated runtime inventory |
| `CAPABILITY_MAP.md` | Candidate canonical capabilities and duplicates to avoid; verify current ownership | capability inventory |
| `ledger.json` | machine-readable ledger (backs the guardrails) | runtime |
| `INTENT_LEDGER.md` | Was this *meant* to be? (waste vs incompletion, from history) | intent |
| `FINISH_ROADMAP.md` | Which half-built things are worth finishing (+ what's already built) | intent |
| `NEEDS_SKYLAR.md` | The handful of seed-or-corpse calls only the owner can make | intent |
| `disposition.json` | Earlier asset → intent fate → proposed action; never authorization to archive | dated intent classification |
| `theory/*.md` | Per-subsystem theory cards: model, invariant, canonical entrypoint, anti-pattern; retain each card's date and scope | doctrine |
| `../../scripts/guardrails/` | Executable checks, including advisory preflights and deployed write-guard validation | checks |
| `../../scripts/ci/verify.sh`, `../../.github/workflows/` | Where checks are actually run and whether failures block publication/deployment | enforcement wiring |

## Two axes, because they disagree

Runtime evidence (rows, active crons, callers) tells you if a thing is *breathing*. It **cannot**
tell waste from incompletion — an empty table is identical to a shelved prototype from where the
code sits. Intent (recovered from 5,131 sessions of history + git + docs) tells you if it was
*meant to be*. The disposition of anything = (runtime state) × (intent).

**⚠️ NEVER execute an archive/delete straight off `disposition.json` (or any ledger doc).** The
intent classifier judges by *story*, not by live data. Verified 2026-07-12: of 33 tables it marked
"safe to archive," ~23 actually held rows, one (`vehicle_value_recompute_queue`) is drained by an
*active* cron, and `app_config` is live config. Before archiving ANY asset, re-verify against
runtime at execution time: tables → `count(*)==0` AND no code refs (`git grep`) AND no incoming FK
AND not touched by a cron/routine; edge functions → not in the deploy list AND no callers (removing
a deployed function's source just creates a load-bearing zombie); files → git-tracked so the delete
is recoverable. Archive by moving (tables → an `archive` schema; files → git rm), never DROP.

## Regenerating

The generated inventories (`ledger.json`, `CANONICAL_LEDGER.md`, intent classifications and related
audit outputs) preserve the evidence of their audit. Re-run the relevant ledger / intent-archaeology
lane to revise their verdicts; record the new measurement date and method. Do not silently edit old
counts to appear current or execute a historical disposition as an instruction.

This navigation README, the owner theory and the case ledger have different maintenance needs.
Correct stale navigation here; preserve owner intent in the theory; close cases with the commit and
measurement that prove the result. Describe guidance separately from implemented enforcement.
