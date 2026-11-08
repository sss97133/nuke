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

5. **Review drain** (`20261111140000`): `capture_set_review_sweep(user, rearm_limit)` hourly (`capture-review-sweep`, :17) resolves held sets
   superseded by a newer run or with nothing left unfiled (`evidence.resolved = {how, by, at}`), and re-arms up to 200 user-days whose newest
   open row predates the user's newest gate-passed filing (new visual anchors), skipping days already pending. `v_capture_review_backlog`
   shows what remains per user.
6. **One scorer** (`20261111150000`): `capture_sets_score_evidence` (the arrival loop's 5-arg scorer, never called by the pipeline) is dropped;
   its legs live in v3 (`20261111120000` lettering, `20261111130000` gated anchors). The revert file carries its last body.
7. **Capture ledger** (`20261111170000`): one record per photo from the phone's gate to the vehicle, read the same way by the
   website (`/capture/ledger`, owner only) and the capture app. Owner, 2026-11-07: "why's the website so disconnected functionally
   [from iOS]? they are not well aligned": the site read none of the capture tables, the phone kept its gate decisions in an
   on-device log. States, one per frame: `on_vehicle`, `unverified`, `waiting`, `held`, `pulled`, `private`, `unsorted`, `failed`,
   plus `skipped` (a `capture_skips` row the phone wrote through `report_capture_skips`, dropped once the frame arrives with the
   same exif uuid). Readers `get_capture_ledger(tz, from, to, limit)` (days, default the last 365; all time measured 6.7 s on
   29,749 frames vs 143 ms for a year) and `get_capture_ledger_day(day, tz)` (frames, reasons, the scorer's top-3 for a held
   set, the day's skips; no thumbnail for a private frame). "Re-scan my library" is a `capture_rescan_requests` row
   (`request_capture_rescan` from any surface, `claim_capture_rescan` / `finish_capture_rescan` by the phone). Nothing writes
   testimony. The page's words are the app's ingest bar (`CaptureIngestStatus.swift`). Contract `test_capture_ledger.sql`.
   `20261111190000`: the readers bound the window for the planner (the "from may be null" test made every read scan all of a
   person's frames), and the day list reads `capture_ledger_states` over `idx_vehicle_images_capture_ledger` (user, taken day,
   exif uuid; the five columns the states need) instead of the heap; the day detail keeps `capture_ledger_frames`.

## Open items
- Provider credit exhaustion (HTTP 402 from the fallback classifier) needs the account owner; the breaker only stops hammering.
- The cron idles at `awaiting_gate` until `auto_filing_audit_queue` rows for the chunk run are marked correct/wrong/unclear by actually viewing the sample photos.
