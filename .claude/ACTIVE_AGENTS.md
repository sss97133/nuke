# Active Agents

*Register yourself when starting. Remove yourself when done.*
*Format: `HH:MM | AGENT-NAME | task description | files/areas touched`*

---

## Currently Active (2026-03-23)

23:00 | CWTFO (Opus) | Orchestrator — triaging all uncommitted work, spinning up subagents | .claude/, DONE.md
23:01 | AGENT-1 | Apply 9 pending DB migrations | supabase/migrations/
23:01 | AGENT-2 | Deploy 9 new edge functions | supabase/functions/
23:01 | AGENT-3 | Commit all uncommitted work in logical groups | git, all untracked files
~DONE~ | AGENT-4 | Homepage treemap v8 COMPLETE — squarified algorithm + drill-down | nuke_frontend/src/pages/HomePage.tsx
23:01 | AGENT-5 | API perf — fix api-v1-comps 6s + db-stats 7s | supabase/functions/
23:01 | AGENT-6 | Drop unused vehicle_images indexes — recover 17GB | DB indexes
23:15 | P88-AGENT | Batch-complete 34K stale in_progress import_queue records | import_queue table
03:24 | P85-IMAGE-EXTRACT | Extract images from Mecum/BJ archived snapshots | listing_page_snapshots, vehicle_images
07:20 | VALUATION-FIX | Fix nuke_estimate throughput — cron bug fixed, burndown running (PID 51893) | cron.job, nuke_estimates, vehicles
~DONE~ | SNAPSHOT-BURNDOWN | Fast snapshot extraction COMPLETE: 27K vehicles, 96K fields, 848K images in 67min. Queue drained to 0. | scripts/snapshot-burndown.mjs
08:36 | FB-DEEP-ENRICH | Deep FB enrichment: Playwright (PID 98827) + Ollama (PID 98175) running. Refine cron upgraded. | supabase/functions/refine-fb-listing/, scripts/enrich-fb-ollama.mjs, scripts/fb-enrich-all.ts, vehicles, marketplace_listings

---

## Completed This Session (2026-03-23)

**PERPLEXITY-TASKS** — 6-task package from claude-code-nuke-package. All done.
- 4 RPCs: schema_stats(), source_vehicles(), make_stats(), mv_source_quality
- Garbage audit: 289K flagged, zero deleted
- VIN extraction: 11,855 promoted from conceptcarz chassis numbers
- Batch extraction: 86 vehicles enriched
~DONE~ | BJ-VIN-EXTRACT | Extracted 2,180 VINs from B-J snapshots. Remaining 53K lack snapshots (32K conceptcarz imports, 12.9K no snapshot, 8K discovery-url only) | listing_page_snapshots, vehicles
~DONE~ | BJ-DESC-BACKFILL | Extract descriptions from Barrett-Jackson snapshots — 3,105 updated | listing_page_snapshots, vehicles
~DONE~ | FB-PRICE-FIX | Fixed denorm bug + deployed edge function fix + launched FB sweep (running in background, ~86/batch). Coverage 28%->44%+ | vehicles, compute-vehicle-valuation
~DONE~ | IMAGE-EXTRACT-ALL | 90K+ images extracted from snapshots for 16K vehicles across 5 platforms. Coverage: 81% -> 84.6%. | listing_page_snapshots, vehicle_images, vehicles
~DONE~ | BJ-PRICE-FIX | Computed nuke_estimate for 4,875 of 5,903 BJ vehicles. 98 remain (un-valueable oddities). Coverage 99.74%. | vehicles, nuke_estimates, compute-vehicle-valuation
~DONE~ | FEED-FIX | MV refresh fixed (cron timeout 120s->600s), clickable header metrics wired, feed-query deployed with added_today filter
09:00 | VEHICLE-PROFILE-FIX | Fix 1974 Jaguar E-Type data + redesign vehicle profile page | vehicles table, nuke_frontend/src/pages/vehicle-profile/
