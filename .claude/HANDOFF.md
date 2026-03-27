# Session Handoff — 2026-03-27

## What Happened (Vehicle Realization Plan session)

User found a 1971 C10 Fleetside Short Bed on Las Vegas CL for $10K (no engine, no rust, matching numbers, clean title). System should have surfaced it automatically but didn't. Used that as the forcing function to build the vehicle realization plan system.

## What's Complete
1. **`persist_realization_plan(vehicle_id)`** — SQL function deployed to production. Parses description for physical state, derives resolution steps with cost/time ranges, pulls comp tiers from our data, stores as `vehicles.realization_plan` JSONB. Works now.
2. **`labor_estimates` table** — created (was designed in migration 20260227 but never deployed)
3. **`vehicles.realization_plan` column** — added, JSONB
4. **Test vehicle** — `507198f2-e0f7-4c31-aedf-b63283f27fed` (1971 C10, 17 images, realization plan computed: 7 steps, $10.3-36.5K build, 1,412 comps)
5. **Strategy doc** — `docs/products/DEAL_FLOW_ACQUISITION_ENGINE.md` (full inventory, gap analysis, phased plan)

## What's NOT Done
- `persist_realization_plan()` does NOT run automatically on ingest yet — needs to be wired into `process-cl-queue`, `poll-listing-feeds`, and the agent hierarchy pipeline
- The watchlist/buy-trigger tables still don't exist (migrations written, never applied): `vehicle_watchlist`, `watchlist_matches`, `auto_buy_executions`, `price_monitoring`, `marketplace_deal_alerts`, `notification_channels`, `user_subscriptions`
- CL queue processor is stalled since Feb 25 — 124 items stuck in `processing`, 27 pending. Needs diagnosis.
- Frontend: no UI for realization plan yet. Stored on vehicle and queryable but not rendered. Fits into existing ARS panel or build intelligence section.

## Key Concept (from user)
The realization plan is NOT a separate product. It's the vehicle's current state expressed as a resolution path. Same as ARS is data completeness, this is physical completeness. Every vehicle gets one on ingest. A rust-free C10 shell gets 7 steps. A rust bucket gets 12. A show-ready car gets 0. The steps are physics — they happen whether Nuke tracks them or not. "Some vehicles just need to be owned."

## Next Logical Work
1. Wire `persist_realization_plan()` into ingest pipeline (run after vehicle creation)
2. Fix the CL queue processor (stalled since Feb 25)
3. Apply watchlist migrations to enable deal detection
4. Backfill realization plans on existing vehicles with descriptions (298K have descriptions)
