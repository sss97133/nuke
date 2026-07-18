# iOS Connection Audit — 2026-06-23 (verified against LIVE prod)

Method: 4-surface trace+verify workflow (handoff / Today-Engine / Explore / Profile)
+ live `curl` probes against prod RPCs. Branch: `fable5/engine-surface`
(worktree `~/.worktrees/ios-engine`). NOT theory — every claim below was probed
on the wire or grep-verified at file:line.

Honest headline: the app is mostly **real data, not facades**. The failures are
specific and they rhyme. Skylar's frame this session: "scantily clad abomination
but making progress — the code writing and comprehension of connections is
falling short." Confirmed: the gap is at the decode/connection boundaries and in
repo↔prod drift, not in the vision.

## FIXED + committed this session
- **`get_user_sync_status` decode** — `da80e5d61` (engine-surface, **NOT pushed**).
  Swift decoded `[SyncStatus].first` but the RPC `RETURNS jsonb` (a bare object,
  verified: `{"synced_total":5275,"analyzed_total":185,"pending_total":26,"filed_total":298,...}`).
  Array decode threw `DecodingError` on *every* load → owner-only Sync ledger
  ALWAYS rendered "couldn't load… check your connection" while real data sat on
  the wire, and the Analyzed-photos drill nested inside it was unreachable. Now
  decodes the bare object (mirrors sibling `get_user_producer_signals` /
  `get_user_understanding`). `BUILD SUCCEEDED` on iPhone 17 Pro sim.
  Remaining proof: screenshot the Sync ledger rendering the real numbers.

## The 5 repeating patterns
1. **jsonb scalar-vs-array decode (the "b16" class), half-fixed.** RPCs return a
   bare object; some Swift decodes them as arrays → throws. Author fixed it in
   `understanding`/`day_receipt`/`calendar`; **`sync_status` was the missed one
   (now fixed).** Latent: `get_user_contribution_calendar` emits 2 extra keys in
   prod (`work_minutes`,`work_cost`) that the repo migration doesn't — Swift
   requires them, so a fresh DB built from repo would throw and silently truncate
   the barcode to 1000 rows.
2. **repo ≠ prod DRIFT — the root of the swarm chaos.** ~7 RPCs/columns run live
   but exist in **0 of 886 migrations**: `get_analysis_stream`,
   `get_image_deep_analysis`, `get_user_capture_stats`, `get_user_analyzed_count`,
   `register_make_model_subject`, `cohort_members`, `make_model_profiles`, and the
   `apple_ml_labels` column (the last VERIFIED present in prod → uploads are NOT
   dead). Every agent reasoning from the repo reads a false map → this is *why*
   PR #320 rebuilt surfaces that already existed. Fix: `supabase db dump` of these
   functions → committed migrations (the repo's own `production-engineering.md`
   Law 1 + "Drift Repair" standing task).
3. **Minute-1 handoff points the camera at the wrong moment.** `IgnitionEngine`
   reads only `asset.location` + `creationDate` (IgnitionEngine.swift:158-166) —
   never a pixel. `VisionEngine` (on-device, free, built) is wired only into
   upload-triage + the Today worklight (SyncEngine.swift:237,427,626,792), never
   ignition. Post-ignition the user lands on an empty Profile ("No vehicles yet";
   backfill is gated to power+wifi, hasn't run). The headline capability is dark
   exactly at first impression. Fix: Swift sequencing — the asset exists.
4. **Half-dark instrument.** Cohort sentiment "alignment map": X-axis real (3,821
   points) but the Y-axis (stance / vouch-challenge) is **100% null in prod**
   (3821/3821) → collapses to a flat line. Fix: backend (compute stance).
5. **False WEB_PARITY claim.** `LiveAnalysisStream.swift` says it shares a contract
   with a web "PipelineVisualizer" that **doesn't exist**; the actual web stream
   reads `vehicle_observations` per-vehicle. iOS invented its own
   `get_analysis_stream`. Swarm-island problem with a paper trail.

## Solid — do NOT relitigate
Explore feed + search (real `vehicles`, shapes match), the **Cohort Terminal**
(self-seeding, real aggregates — strongest surface; Mustang 1966 = 3,177 docs /
1,098 sale points / 369 comps live), the garage (8 real vehicles, rooted
class-stratified values, honest "Not priced yet" on null), barcode + day-receipt
+ producer signals (3,125 h / 791 work-days / live narratives).

## Open
- **Branch fork:** `engine-surface` (nav overhaul + ENGINE worklight) vs
  `ignition-ios` (provenance + labor copy) — 2 commits each, 4h merge-base, both
  87 ahead of `origin/main`, neither shipped. Reconcile before any TestFlight push.
- **Next move (lean):** the minute-1 handoff (#3) — point VisionEngine at ignition
  so the garage assembles live from the photos. It's the through-line of the whole
  session.

## Pipeline (BYOK image analysis) — HALTED 2026-06-23
launchd `com.nuke.byok-image-analysis` **unloaded** (won't restart) + procs killed,
at Skylar's word ("I HATE that it's a slurry of images"). It was mid-drain on his
1968 C-10 (150/544 landed; rest stay pending, nothing lost).
- Correction to an earlier mis-statement: it does NOT analyze frames in isolation —
  `byok-image-batch.sh` pulls the next DAY's frames (`--by-day`, "the day is the
  unit"), prompts "treat as one work session, follow a component across angles,"
  rolls up into a `work_session`.
- But it's still a slurry by a deeper measure: **brute-forces every frame as equal
  grist** (conveyor), no curation/hierarchy, no butterfly-node selection. Plus a
  pile of competing shell drainers (`byok-image-batch`/`-fleet-batch`/`-cloud-drain`/
  `-burn-all`) on a cron.
- The structured organs Skylar's concept describes already exist:
  `scripts/daily-receipt/build-day.mjs` + `process-photo-cascade.mjs` (Jun 20) —
  but the brute-force shell drain is what was on the cron, not these.
- NEXT (when he's back): the redesign read — butterfly-node vs conveyor, grounded
  in build-day/cascade. Don't rebuild; operate the right organ.
