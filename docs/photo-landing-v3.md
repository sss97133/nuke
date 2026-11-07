# Photo landing v3 (2026-11-04)

Applied to Supabase project `qkgaybvrernstplzjaam` (also applied via SQL; the migration history is not stamped).

## What this does
1. **Identifier evidence** (`20261109000100`): classifier/OCR-read VINs and plates are stored as *candidate* `vehicle_identifier_observations`
   (never written to `vehicles`). `identifier_observations_promote(user, run, dry=true)` promotes only after the observation's set landed through the visual gate
   with high confidence; guards against VIN conflicts. `vehicle_dedup_decisions` stores same/distinct/unknown calls with cited evidence (re-evaluable, `superseded_at`).
2. **Scorer v3** (`20261109000200`): `capture_sets_score(..., p_prov)`. Adds classifier VIN/plate candidates, work-session prior (cited, not a hard assignment;
   owner_confirmed 1.0, auto_confirmed 0.8, system_hold 0.4, closed_obsolete excluded), temporal-continuity prior (prior 72h of filed history, provisional same-chunk proposals
   and work sessions, decaying `exp(-days/2)`), roster excludes discovered/merged/inactive, recent-vehicle bonus 0.5 -> 0.15 (<48h). Every decision carries `signals.cites`.
   Perf: visual similarity uses at most 12 evenly spaced embedded photos per set. Visual anchors (`anc`, `20261111130000`): web uploads, iOS frames
   with no machine provenance, and filings of a landing run whose viewed gate sample passed (`filing_run_gate.passed`); a frame an auditor
   marked wrong in `auto_filing_audit_queue` never anchors. Lettering legs (badge, make, model family) came in `20261111120000`.
3. **Landing pipeline** (`20261109000300`): `capture_landing_config` / `_chunks` / `_sets`. Forward track = oldest-unresolved-first, one `chunk_days` (30) chunk at a time, ceiling now-7d;
   recent track = last 7 days. Each chunk: plan (chronological, each day feeds the next) -> finalize (review rows + candidates + stratified visual-gate sample) ->
   `awaiting_gate` -> gate must pass (>= min(10,n) photos viewed, <= 5% wrong) -> apply (`capture_sets_apply`, every landed photo gets a `capture_set_links` row).
   A failed gate halts the config (`halted`, `halt_reason`) and deactivates the cron. Already-filed photos are never moved (provenance link only); photos with >= 2 reverted links are skipped.
   Cron `capture-sets-landing-tick` every 10 min; **config ships `enabled=false`**.
   Enable: `update capture_landing_config set enabled=true;`  Halt: `update capture_landing_config set enabled=false;`
4. **Timeline grouping** (`20261109000400`): `auto_group_photos_into_events` groups per capture session; `timeline_resolve_pending_for_images`;
   `timeline_consolidate_pending_sessions` (backup in `backup_20261104_timeline_pending_consolidated`).
5. **Classifier backoff** (`20261109000500`): `photo_pipeline_provider_state` circuit breaker (60s doubling, 1800s for HTTP 402, cap 6h, jitter), rate-limit failures counted separately,
   no blind requeue; `photo_pipeline_skip_duplicate_pending`.

## Revert
- Filing: `select capture_sets_revert('<run>', 'actor')`.
- profile_fix_log ops: `select profile_fix_revert('<run>')` (duplicate-copy skip run `a1b2c3d4-0000-4000-8000-20261104f020`).
- Timeline consolidation: `select timeline_consolidate_revert('<run>')` for runs `...20261104f003`..`f014`.
- Backups: `backup_20261104_landing_v3_fn_defs` (original functions), `backup_20261104_landing_v3_cron`, `backup_20261104_timeline_pending_consolidated`.
- Dedup decisions: set `superseded_at`.

## Open items
- Provider credit exhaustion (HTTP 402 from the fallback classifier) needs the account owner; the breaker only stops hammering.
- The cron idles at `awaiting_gate` until `auto_filing_audit_queue` rows for the chunk run are marked correct/wrong/unclear by actually viewing the sample photos.
