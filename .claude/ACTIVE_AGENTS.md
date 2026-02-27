# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## INTER-VP BRIEFS (read before starting work)

### 📋 VP Deal Flow → VP Extraction — 2026-02-26 (RESOLVED 2026-02-27)
190 pipeline entries had null asking_price → all scored 40/FAIR.
**Resolution**: backfill-cl-asking-price deployed, 190 → 93 null (51% reduction). Remaining 93 are expired listings (410 gone) or $1 placeholders. Cron 259 runs daily.
**File**: `.claude/VP_DEAL_FLOW_TO_EXTRACTION_BRIEF.md`

### 📋 VP Intel → VP Extraction — 2026-02-26 (RESPONDED 2026-02-27)
Gap report: descriptions, VIN, mileage, engine/transmission gaps hurting scoring pipeline.
**File**: `.claude/VP_INTEL_TO_EXTRACTION_BRIEF.md`
**Response**: `.claude/EXTRACTION_TO_VP_INTEL_BRIEF.md` — root causes identified, B-J queue draining (~13h), RM/Gooding need individual page scraping (separate task)

---

## CURRENTLY ACTIVE

### VP Platform — Resend Inbound Email Audit + alerts@nuke.ag wiring — 2026-02-27 12:00 UTC — COMPLETED
- Audited Resend inbound config: pipeline IS working (5 real emails in contact_inbox)
- Root issue: RESEND_API_KEY is send-only (restricted_api_key scope) — inbound routing configured in Resend dashboard, not discoverable via API
- Fixed inbound-email: now uses webhook payload body as fallback when Resend API content fetch fails
- Added alerts@nuke.ag to VALID_ADDRESSES + routing to process-alert-email → import_queue
- Verified full pipeline: email.received → inbound-email → process-alert-email → import_queue (BMW M3 test: 1 URL queued)
- Inserted test record in contact_inbox (email_id: test-001, from: someone@example.com)
- REMOVED: session complete

### VP AI — Zone Classifier + Bearer Auth + interior_quality — 2026-02-27 11:20 UTC — COMPLETE
- Zone classifier: uploaded safetensors to Modal, redeployed, live (72.8% val_acc, 41 classes)
- Bearer token auth: added to modal_serve.py, yono-classify, yono-analyze, yono-vision-worker
- interior_quality + zone_source: columns added to vehicle_images, worker updated to write them
- Task ba1593fd (TTLRM P88): COMPLETED — NO-GO, 3D reconstruction paper, not relevant to YONO
- Task b6b693ab (Bearer auth P75): COMPLETED — deployed and verified
- Upload script: fixed to include zone files + --zone-only + --no-deploy flags + auto redeploy
- REMOVED: session complete

### VP Vehicle Intel — Session Audit + Cron Gap Filing — 2026-02-27 11:40 UTC
- Diagnosing: VIN decode, signal score, nuke_estimate, exchange health
- Touching: agent_tasks (inserts only), DONE.md, ACTIVE_AGENTS.md
- Key finding: batch-vin-decode NOT DEPLOYED, no crons for compute-vehicle-valuation or analyze-market-signals
- DO NOT touch: compute-vehicle-valuation, analyze-market-signals functions

### Worker Agent — Gmail Alert Poller — 2026-02-27
- Building: `scripts/gmail-poller.mjs` (OAuth2 Gmail poller → process-alert-email)
- Also building: `supabase/functions/gmail-alert-poller/index.ts` (edge function for cron)
- Also creating: DB migration for `alert_email_log` table (if needed)
- Touching: scripts/gmail-poller.mjs, supabase/functions/gmail-alert-poller/, supabase/migrations/
- DO NOT: modify process-alert-email/index.ts

### VP Photos — Health Check + K10 Vision Audit — 2026-02-27 07:30 UTC
- Checking: YONO vision worker (jobs 247+248), organization status, K10 photos, agent_tasks
- Finding: DB pool saturated + PostgREST schema cache reload loop (system-wide incident)
- yono-keepalive confirms sidecar operational (vision_available=true, uptime=190s)
- yono-vision-worker deployed v8 at 11:32 UTC today — recently updated
- K10 photos confirmed: ai_processing_status=completed, vision_analyzed_at=NULL, yono_queued_at=NULL
  → YONO WILL pick these up (no ai_processing_status filter in claim_yono_vision_batch)
- Touching: .claude/ACTIVE_AGENTS.md, DONE.md, agent_tasks (when DB recovers)
- DO NOT: write to ai_processing_status, vision fields directly


### Frontend Worker — Market/Portfolio UI Fixes — COMPLETED 2026-02-27
- Fixed MarketDashboard, MarketExchange, MarketFundDetail, Portfolio. Commit b9ae1497c.

### COO — Session triage + work order routing — 2026-02-27 11:30 UTC — COMPLETED
- Checked all VP inboxes (all clear)
- Reviewed YONO training state: zone DONE (72.8%), german tier-2 epoch ~5/25 (PID 28401), watcher PID 7390 live
- Reviewed pending tasks: 19 pending, 3 in_progress
- Filed 5 work orders: CFO Twilio (P90), VP Extraction RM Sotheby's + Gooding scrapers (P80 each), VP Deal Flow suppress_notifications (P78), VP Platform transfer UI (P75)
- Cancelled 1 duplicate ONNX task (be95e3aa — fdf5038f already in_progress)
- REMOVED: session complete

### CTO Session — Architecture Review + Work Orders — 2026-02-27 11:30 UTC — COMPLETED
- Reviewed ralph-spawn, YONO sidecar, archiveFetch violations, agent type registry
- Filed 7 agent_tasks (see DONE.md)
- Processed CFO recommendation task bcf6d537
- REMOVED: session complete

### Worker Agent — Multi-task sprint — COMPLETED 2026-02-27 08:10 UTC
- P90 YONO ACTIVE_AGENTS update (1977ede1): zone classifier finished epoch 15/15 (72.8%), tier-2 training active
- P85 YONO sidecar (363eca02): already working, typo in task URL; verified auth=401 without token
- P80 Import queue backlog (78505a8b): not stalled, 84K pending/353 active workers draining
- P75 YONO Bearer auth (b6b693ab): already deployed by VP AI; verified working
- P70 crawl-bat-active (db1d1a69): documented RSS exception, deployed
- P70 sync-live-auctions (7ad92537): FIXED — archiveFetch() for BaT /auctions/ page, deployed
- P60 extract-gooding (c8afcd1e): documented sitemap exception, deployed
- REMOVED: session complete

### Worker — BaT Queue Unblock + PCarMarket Fix — COMPLETED 2026-02-27
- P0: Deployed process-bat-extraction-queue (was missing, caused 2-month stall). Added cron job 260 (bat-extraction-queue-worker, */2 * * * *). 119,300 pending items now draining.
- P1: Fixed import-pcarmarket-listing parsePCarMarketIdentityFromUrl() to handle /marketplace-YEAR-make-model URL pattern. Deployed.
- REMOVED: session complete

### Frontend Worker — Map Bug Fixes — COMPLETED 2026-02-27
- Fixed random jitter (deterministic hash), cluster icon black-on-black, businesses column bug. Commit 1ad6c89c7.

### CFO — Cost Analysis + Task Filing — COMPLETED 2026-02-27 11:45 UTC
- Twilio: diagnosed as unconfigured credentials (not negative balance). Filed P88 founder action task.
- Pipeline unpause: filed P80 CEO memo — $3,250 capped cost, $150/month ongoing.
- Token budget: filed P75 CTO task — Haiku/Sonnet/Opus tiering model.
- Claimed and completed pre-existing CFO Twilio task (f49f82f7).
- REMOVED: session complete

### VP Docs — SDK README + OpenAPI + Quickstart — 2026-02-27 — COMPLETED
- Rewrote tools/nuke-sdk/README.md, fixed docs/api/openapi.yaml (21 paths, Vision misplacement fixed), created docs/QUICKSTART.md
- REMOVED: session complete

### Frontend Worker — Admin + Onboarding UX — COMPLETED 2026-02-27
- Login overhaul, admin route fixes, first-run onboarding. See DONE.md. Commit 5a62f7c34.

### VP Extraction — RM Sotheby's Lot Page Scraper — 2026-02-27
- Building: `backfill-rmsothebys-descriptions` edge function
- Touching: supabase/functions/backfill-rmsothebys-descriptions/, supabase/functions/extract-rmsothebys/
- Approach: Firecrawl to fetch individual lot pages, parse description + highlights + chassis info
- DO NOT: touch extract-rmsothebys (enhancement goes in new backfill function)

### VP Orgs — Cron Gap Fix — COMPLETED 2026-02-27
- 3 cron jobs added (jobs 262, 263, 264), 2 functions deployed, 109 queue items reset and draining

### VP Extraction — FB GraphQL Probe — 2026-02-27 07:20 UTC — COMPLETED
- Key finding: GraphQL works from residential IPs (doc_id 33269364996041474), blocked from Supabase datacenter (1675004)
- Created facebook-marketplace-extraction.md with full findings + 3 paths forward
- Updated DONE.md

### Frontend Performance Worker — Auth Waterfall Elimination — COMPLETED 2026-02-27
- Created AuthContext (global single getSession), updated useAuth, useSession, 14 pages
- Commit: 05000c396
- REMOVED: session complete


### Worker — Stub Vehicle Filter — COMPLETED 2026-02-27
- Task: d1c9187e (P97) + 3827a50b (P85, CDO audit) — BOTH COMPLETED
- Filtered ~97K stub vehicles (no YMM) from all inventory/search endpoints
- Migration: 20260227060000_filter_stub_vehicles_from_inventory.sql applied
- Deployed: api-v1-search, api-v1-vehicles, universal-search edge functions
- Frontend: IntelligentSearch.tsx autocomplete updated
- DB: search_vehicles_fts, search_vehicles_fulltext, search_vehicles_fuzzy updated
- Committed 5257d97f9, pushed to main
- REMOVED: session complete


### VP AI — Zone Training Resume + Sidecar Fix — 2026-02-27 04:52 UTC — UPDATED 07:35 UTC
- Task: fdf5038f — ZONE CLASSIFIER COMPLETE
- Zone classifier PID 7241: FINISHED (epoch 15/15, best val_acc=72.8%)
  - Saved: yono_zone_classifier.pt, yono_zone_head.safetensors, yono_zone_config.json
  - Log: yono/outputs/zone_classifier/training.log (complete)
- Tier2 watcher PID 7390: ACTIVE — zone done, now running tier-2 families sequentially
  - PID 28401: train_hierarchical.py --tier 2 --family german (in progress ~02:21 UTC start)
  - PID 23678: train_hierarchical.py --all (separate legacy process, also active)
  - Remaining families after german: british, japanese, italian, french, swedish
  - Then --export runs for all ONNX files
  - Log: yono/outputs/hierarchical/tier2_remaining.log
  - DO NOT kill PID 7390 or PID 28401 or PID 23678
- YONO sidecar: needs health check (task 363eca02, P85 unreachable)
- Next after tier2+export: upload ONNX to Modal volume yono-data, redeploy sidecar


### VP Deal Flow — Transfer System Wiring — COMPLETED 2026-02-27 12:00 UTC
- suppress_notifications added to transfer-automator (P78 done)
- stripe-webhook wired to transfer-advance for payment_confirmed milestone
- vehicle_transactions.ownership_transfer_id FK column added
- get_transfer bug fixed (error.message vs String(error))
- Twilio diagnosis: placeholders in Supabase secrets → 401, filed CFO task P92
- Crons 223-227 remain paused (safe now, waiting on Twilio CFO)
- REMOVED: session complete




### YONO Vision V2 — TIER-2 TRAINING IN PROGRESS (2026-02-27 updated 07:35 UTC)
- All 4 phases + zone system done. Florence2 v2 COMPLETE (yono_vision_v2_head.safetensors saved).
- **Zone classifier PID 7241**: COMPLETE — epoch 15/15 done, val_acc=72.8%
  - Saved: yono_zone_classifier.pt, yono_zone_head.safetensors, yono_zone_config.json
- **Tier-2 training PID 28401**: train_hierarchical.py --tier 2 --family german (ACTIVE, started ~02:21)
  - Full pipeline PID 23678: train_hierarchical.py --all (also active)
  - DO NOT kill PID 7390 (watcher), PID 28401 (german training), or PID 23678 (--all training)
  - Log: yono/outputs/hierarchical/tier2_remaining.log
  - Remaining: british, japanese, italian, french, swedish → then --export ONNX
  - Next step after export: upload ONNX files to Modal volume yono-data, redeploy sidecar
- **Zone labeling**: COMPLETE (2764/2764 records labeled)
- **Sidecar**: unreachable (task P85 363eca02) — worker investigating

### [vp-platform] Platform health + task sprint — 2026-02-27 05:20 UTC — COMPLETE
- Fixed 4 broken cron commands (jobs 128, 186, 213, 235) using stale current_setting() calls [prior session]
- Quality backfill 237-240 confirmed ACTIVE [prior session]
- **This session:** 3 agent_tasks completed (P97 stub filter, P85 quality backfill timeouts, P78 DB load)
- Quality backfill: fixed batch size 300→75, switched JOIN to ANY() — all workers succeeding <60s
- DB load: deactivated treemap-refresh (job 175), auto-duplicate-cleanup (job 43), dedup-vehicles-batch (job 258)
- Stub filter: deployed search + universal-search edge functions with ilike fallback YMM filters, fixed Search.tsx nearby query
- reconcile_listing_status: reduced batch 50→10 items to fit 2min pg_cron window

### Extraction Quality Sprint — ACTIVE 2026-02-26→27 (context compressed 2x)
- **Phase 1-3**: Mecum description 0→60%+, Bonhams 0→66%, routing fixes, Gooding workers added
- **Phase 4 (this session — post-compression)**: Pipeline throughput fixes:
  - **mecum-live-queue-workers 251-255**: Fixed broken JSON syntax (`current_setting()` → `get_service_role_key_for_cron()`). Were failing every tick since creation. Now draining 35K Mecum Live Auctions queue at 384/hr.
  - **bat-snapshot-parser jobs 173-174**: Were running 80-110s (PL/pgSQL), holding slots past next tick, causing alternating all-fail minutes. Changed from `* * * * *` → `*/3 * * * *`.
  - **Cascade fixed**: Per-minute jobs now 30 (was 32), 0 failures per minute (was all-fail every other minute).
- **Current queue (2026-02-27 02:15)**: MecumLive 35K/384hr (~91h), C&B 30K/480hr (~62h), B-J 18.5K/318hr (~58h), Mecum 17.5K/372hr (~47h), PCar 2.7K/132hr (~21h), BaT 1.1K/318hr (~3.5h), Gooding ~30min, Bonhams ~30min
- **DO NOT**: touch quality_backfill_state, recreate idx_vehicles_quality_score/backfill indexes; touch C&B snapshot cache logic; kill PIDs 34496 or 5727
- **Quality backfill paused** (jobs 237-240 deactivated) — was causing 73% failure rate on mecum via row-lock contention. Re-enable after queues drain.

### Queue Coordinator — ACTIVE 2026-02-26 20:00 (this terminal)
- **Crons added**: 217-222 (Mecum/PCarMarket workers), 237-240 (quality backfill workers 1-4, sharded)
- **DB changes**: Dropped idx_vehicles_quality_score + idx_vehicles_quality_backfill, created quality_backfill_state (now with range_min/range_max), quick_quality_backfill_v3
- **Quality backfill sharding (2026-02-26 22:55)**: Job 228 replaced by 4 parallel workers (237-240)
  - Worker 1 (job 237): id < 40000000..., no sleep, cursor at 03bc1ea8 (18750 done)
  - Worker 2 (job 238): 40000000... ≤ id < 80000000..., sleep 15s, fresh
  - Worker 3 (job 239): 80000000... ≤ id < c0000000..., sleep 30s, fresh
  - Worker 4 (job 240): id ≥ c0000000..., sleep 45s, fresh (no upper bound)
- **DO NOT**: recreate the dropped quality score indexes (backfill in progress); drop or reset quality_backfill_state rows

### Vehicle Profile Page — COMPLETED 2026-02-26
- All 4 tabs finished. See DONE.md for details. Committed 5a915f327.

### Image Bundle Review UX — COMPLETED 2026-02-26 (terminal: vehicle-profile-ui)
- BundleReviewQueue.tsx wired in Evidence tab; 4 needs_input events exist for Dave's GMC
- auto-create-bundle-events + suggest-bundle-label deployed; auto-triggered on owner profile load
- photo-auto-sync-daemon.py: structured EXIF format fix (camera.make, exif_status: 'synced_from_photos')
- Committed 76a35a4d7, pushed, Vercel deploying

### VehicleHeader Transfer Badge — COMPLETED 2026-02-26 19:00
- transfer-automator, transfer-advance, transfer-email-webhook, transfer-sms-webhook, transfer-status-api deployed
- VehicleHeader.tsx: drift fixes + transfer status badge (milestone label, progress %, days stale, buyer handle)
- Backfill cron (job 190) running every 2 min. Committed 6e346eba7, pushed, Vercel deploying.

### YONO Training + Export — COMPLETED 2026-02-26
- PID 34496 (`train_hierarchical.py --all`): DONE — trained family + american, skipped others (insufficient data at time)
  - hier_family_best.pt ✓, hier_american_best.pt ✓
  - Remaining families handed off to PID 39959 (see YONO Vision V2 above)
- Supabase image export PID 5727: DONE — training-data/images fully exported

### YONO FastAPI Sidecar — COMPLETED 2026-02-27
- Deployed to Modal: https://sss97133--yono-serve-fastapi-app.modal.run
- Added /analyze + /analyze/batch endpoints (Florence-2 + finetuned_v2 head, 9-10s/image on CPU)
- Uploaded yono_vision_v2_head.safetensors, yono_vision_v2_config.json, hier_family.onnx.data to Modal volume
- Florence-2-base pre-baked into Modal image (fast cold start)
- YONO_SIDECAR_URL set in Supabase + local .env
- yono-classify: validated (make=american, ms=40.9)
- yono-analyze: validated (zone=ext_driver_side, mode=finetuned_v2)

---

## COORDINATION RULES

- One agent per edge function at a time
- Database: no DROP, TRUNCATE, or DELETE without WHERE
- Git: descriptive commit messages, no force push to main
- Before editing a shared edge function: check this file

---

### Market Exchange Backend Integration — COMPLETED 2026-02-26 17:15
- pre_trade_risk_check RPC, update_vehicle_offering_prices, update_market_nav (cache-based), mark_to_market, run_exchange_pricing_cycle deployed
- market_segment_stats_cache table + refresh_segment_stats_cache() — avoids 2-min full-table scan
- update-exchange-prices edge function deployed — full pricing cycle in <1s
- api-v1-exchange edge function deployed — unified read API (funds + offerings + holdings)
- MarketExchange.tsx + MarketFundDetail.tsx: replaced slow market_segment_stats RPC with api-v1-exchange
- pg_cron: job 212 (exchange pricing every 15min), job 213 (segment stats refresh every 4h)
- Baselines seeded: PORS $5B, TRUK $1.25B, SQBD $80M, Y79 $317M

## COMPLETED THIS SESSION (reference)

### process-url-drop FB share URL fix — COMPLETED 2026-02-26
- Fixed share URL regex misclassification (extracted "share" as fbIdentifier)
- When relay offline: early return with facebook_share lead + needs_relay:true
- Bulk-updated 10 existing bad leads in discovery_leads
- Committed a2178d2e1, deployed

### YONO Hierarchical Inference — COMPLETED 2026-02-26
- HierarchicalYONO class, server.py lifespan handler, hier_family.onnx exported
- yono-classify edge function updated (yono_source field)
- Committed 969de03c7, pushed, deployed

### data_quality_score Backfill — IN PROGRESS (updated 2026-02-26 20:15)
- Fixed trigger (was storing 0.0-1.0 decimal as INTEGER → all zeros), now stores 0-100
- Cron 228: DO block + temp table + replica role + 30s sleep offset, 300 rows/run
- idx_vehicles_quality_score and idx_vehicles_quality_backfill DROPPED (required to get under 2min timeout)
- Indexes will need RECREATING after backfill completes (~69 hours from now)
- quality_backfill_state table tracks cursor (last_vehicle_id)


### CWFTO — Brief COMPLETED 2026-02-27 03:40 UTC
- Filed 3 follow-up tasks, COO replied, next loop scheduled (P92)

### Craigslist Listing Verification — ACTIVE 2026-02-26
- Checking 4 Corvette listings (Seattle, Portland, Sacramento x2)
- No file writes — read-only research task

### VP Intel — Comparable Sales Feature — COMPLETED 2026-02-27
- Built SimilarSalesSection.tsx (nuke_frontend/src/components/vehicle/)
- Enhanced api-v1-comps edge function: get_auction_comps() DB function + direct fetch RPC
- Updated VehicleComparablesTab.tsx: Similar Sales first, user-submitted comps below
- 9/10 results from auction_events with platform/date/image/link; 0.6s (make/model params) or 3.5s (vehicle_id)

### VP Platform — Search UI Fixes — 2026-02-27 03:50 UTC
- Task: Fix search results UI to show actual data (tier ratings, observation counts, filters, VIN search)
- Backend already returns image_count + event_count correctly
- Frontend needs to display prominently in VehicleCardDense.tsx and Search.tsx
- Touching: nuke_frontend/src/components/vehicles/VehicleCardDense.tsx, nuke_frontend/src/pages/Search.tsx
- DO NOT: modify backend APIs (already working)

### Frontend Worker — Vehicle Profile Page UX Fixes — COMPLETED 2026-02-27
- Commit 475c6ce1b pushed to main. 10 files changed (tabs, hero, comps, specs, basic info, similar sales).

### Frontend Worker — Global UX Audit + Polish — 2026-02-27 — COMPLETED
- pt→px typography purge (300+ files), skeleton loaders (AuctionMarketplace, MarketSegments, Dashboard, CursorHomepage), loading state improvements
- Commits: a5ebb07b8 (pass 1), 944ba7704 (pass 2 merged), 10c63847c (TeamInbox fix)
- REMOVED: session complete

### Frontend Worker — Org Profile + Offering Page UX — COMPLETED 2026-02-27
- Commit d24aa0ad0 pushed to main, Vercel deploying
- Fixed: offering gate landing page, org profile alerts→toasts, loading skeleton, business-docs visibility, verification badge, competitors CTA
