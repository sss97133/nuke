# Overnight autonomous run — 2026-06-20

Skylar asked me to work autonomously and stop asking. This is the single morning
report; I append landed results here instead of pinging.

## Mandate
Drive the image depth + attribution pipeline end-to-end overnight. Make every open
decision myself with the defaults below. Deliver landed results, not questions.

## Decisions I own (no confirmation needed)
- Roster-fallback candidate-gen: built (reaches GPS-isolated orphans).
- COMMIT bar: unanimous fail-to-refute + 2 hard signals (GPS sibling + visual), panel 5.
- Roster-fallback (no GPS): caps at SUGGEST — never auto-commits on vision alone.
- SUGGEST: written to `auto_suggested_vehicle_id` + `vision_gate_status=review_needed`,
  surfaced as a dim "likely" tile, excluded from value/labor.

## Guardrails (will not cross while autonomous)
- Never set `user_confirmed_vehicle=true` — Skylar's signature only.
- Never delete/overwrite testimony; COMMIT only via `attribute_testimony`.
- Never touch ghost vehicles.
- Never push/deploy or ship the iOS worktree.
- `--commit` a batch only after its dry-run report reads clean; else leave SUGGEST/HOLD.

## Loop plan
1. Capture drain (6 Sonnet shards) → analyze capture_relay_ios pool (~4.6K). [running]
2. Attribution dry-runs → inspect adjudication reports → tune thresholds.
3. As the drain lands analysis, re-run attribution (richer signal) and `--commit`
   only the clean COMMIT lanes; everything else stays SUGGEST/HOLD for review.
4. Attribute, monitor, log results here.

## Results log (appended as work lands)
- 2026-06-20 ~start: spec + `vision-gate-refute.mjs` orchestrator landed (npm
  `attribution:refute`), columns + `attribute_testimony` signature verified, roster
  bug (null `vehicle_confidence` filter) fixed. First 8-orphan dry-run running.
- 2026-06-20 morning:
  - **CORRECTION (was reported COMPLETE — it was NOT).** The 6 drain shards each fed
    770 images into ONE `claude --print` call and produced **0 verdict lines**, aborting
    ingest. `byok_deep_analysis` coverage is still ~292/4,911. My "4,911 analyzed" claim
    was a misread of `ai_scan_metadata IS NOT NULL` (old `classification` pipeline) vs the
    actual `byok_deep_analysis` atom. Root cause: the drain's per-call batch (770) is far
    too large — works at ~10 (smoke test), yields nothing at 770. Drain needs small,
    looped per-call batches before it produces atoms.
  - **Methodology correction:** I minted `vision-gate-refute.mjs` (deleted) instead of
    operating `classify-unfiled-day.mjs` (`day:classify`) — the existing $0, by-day
    attributor already wired to `byok_deep_analysis`. The real chain is
    `capture:analyze` → `day:classify` → `day:build`/`day:synthesize`. Operate it.
  - Autonomous loop did NOT self-iterate overnight: the drain's worker procs were
    detached/untracked so completion never woke me, and the heartbeat wasn't due till
    09:23. Drain finished on inertia; attribution didn't commit (0 audit rows). Owned.
  - First post-fix dry-run (8 GPS-isolated orphans): 7 HOLD ("roster returned none"),
    1 SUGGEST. NOT a bug — those were Miami-area photos with nothing to match; the
    conservative "none" is correct. Low yield because that slice was worst-case.
  - **Distribution measured (120-orphan sample of the 7,422 GPS+time orphans):**
    33% single-vehicle GPS cell (cheap COMMIT), 33% multi-vehicle (needs panel),
    35% GPS-isolated (expensive roster tail, low yield).
  - Efficiency fix: added `--gps-only` flag — process the 66% with GPS candidates
    cheaply, defer the isolated 35%. GPS-only dry-run (limit 40, panel 5) running to
    validate the COMMIT lane before any `--commit`.
