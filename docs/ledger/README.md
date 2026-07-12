# docs/ledger — the authoritative map of what's real

**Generated 2026-07-12** by a Fable-run audit of the whole Nuke codebase. This replaces the old
`CODEBASE_MAP.md` (which was ~half fiction). If you are an agent about to touch this codebase,
**read this first.**

## THE ONE RULE

> Before you build anything — a function, table, page, queue, cron, script — look in
> **`CAPABILITY_MAP.md`**. If a canonical owner for that capability exists, **extend it. Never mint a parallel one.**
> Preflight a name: `scripts/guardrails/check-capability-before-mint.mjs "<name-or-capability>"`

Why this exists: the audit found 204 edge functions (target ~50), 913 tables (**739 empty**),
136 crons (**18 active**), and **74 capabilities implemented more than once**. The real live
platform is ~30 functions, ~20 tables, ~10 SQL routines, 18 crons. Everything else is shell.
A weak model can't see the difference — these files draw the outline so it doesn't guess.

## The artifacts

| File | What it answers | Axis |
|---|---|---|
| `CANONICAL_LEDGER.md` | Is this asset alive or dead? (per-asset verdict + evidence) | runtime |
| `CAPABILITY_MAP.md` | What's the ONE canonical way to do X? (+ duplicates to avoid) | runtime |
| `ledger.json` | machine-readable ledger (backs the guardrails) | runtime |
| `INTENT_LEDGER.md` | Was this *meant* to be? (waste vs incompletion, from history) | intent |
| `FINISH_ROADMAP.md` | Which half-built things are worth finishing (+ what's already built) | intent |
| `NEEDS_SKYLAR.md` | The handful of seed-or-corpse calls only the owner can make | intent |
| `disposition.json` | asset → intent fate → action (**source of truth for any archive**) | intent |
| `theory/*.md` | per-subsystem theory cards: model, invariant, canonical entrypoint, anti-pattern | doctrine |
| `../../scripts/guardrails/` | six checks that mechanically enforce the above (currently inert; opt-in) | enforcement |

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

These are workflow outputs, not hand-edited docs. Regenerate via the ledger / intent-archaeology /
guardrails workflows (scripts under the session's `workflows/`). If you find a stale verdict, fix
it by re-running the relevant lane, not by editing the doc — and update this note if the process changes.
