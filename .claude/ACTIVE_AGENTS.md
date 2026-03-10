# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## 🚨 VERCEL BUILD DEBRIEF — 2026-02-27 (READ BEFORE ANY FRONTEND WORK)

**What happened:** 18 consecutive failed Vercel deployments (~14:05–14:33 UTC)
**Root cause:** `QuotePartsList.tsx` imported `./PartLineItem` but `PartLineItem.tsx` was not committed.
**Fix:** Commit `f10954394` added the missing file. Builds green since 14:35 UTC.

**Rule for all frontend agents:**
> When you create a new component file that another file imports, they MUST be in the same commit.
> Never commit an import without also committing the file being imported.

**Current git state:**
- `origin/main` HEAD: `f10954394` (fix exchange)
- Local HEAD (NOT YET PUSHED): `6282a7ce6` (fix homepage feed query, search loading state)
- Action needed: push `6282a7ce6` to origin when safe

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

## 🚨 CRON CLEANUP — 2026-02-27 16:30 UTC + 17:30 UTC (READ BEFORE CREATING CRONS)

**What happened:** 165 active cron jobs were choking the database. 44 ran every minute. 20 had completely broken auth (NULL headers). DB couldn't even run `SELECT count(*)` without timing out.

**Pass 1 (16:30 UTC): 165 → 116 active**
- Removed 50 cron jobs
- Per-minute crons: 44 → 13 (kept 2 per major platform, 1 per minor)
- Fixed 3 vault-based crons (data-quality-workforce, compute-data-quality-snapshot, check-vendor-balances) — rewrote to use `get_service_role_key_for_cron()`
- Removed 20 crons with broken `current_setting()` auth (all analytics, premium-extraction, polling, scraper-health, etc.)
- Removed 7 excess BaT extraction workers (10 → 3), 2 excess YONO workers (4 → 2), 3 excess continuous-queue-processors (5 → 2)
- Purged 880,423 stale entries from `cron.job_run_details`
- Added `cleanup-cron-log` cron (job 326): purges entries >6h old, runs every 6h

**Pass 2 (17:30 UTC): 116 → 103 active**
Removed 13 more low-value/redundant/broken jobs:
- `auto-extract` (24): was `SELECT 1` — pure no-op
- `concierge-villa-discovery` (90): broken auth — `app_config` key lookup, not `get_service_role_key_for_cron()`
- `mecum-extraction-cron` (71): only inserted a run record, no actual extraction; mecum-queue-workers handle it
- `cron-startup-timeout-alert` (328): low-priority monitoring noise every 5 min
- `agent-monitor-scan` (235): redundant with extraction-watchdog
- `extraction-health-check` (110): redundant with extraction-watchdog, every 15 min
- `observation-migration` (82): broken COALESCE with `current_setting()` fallback, migration is background
- `enrich-bulk-continuous` (170): `strategy:all, source:bat` — redundant with specific enrich-bulk-mine-bat + enrich-bulk-derive-bat + enrich-bulk-vin-bat
- `aggressive-backlog-clear` (65): every 10 min, redundant with bat-extraction-worker-1/2/3 and continuous-queue-processors
- `live-auction-sync` (87): broken vault auth (`trigger_live_auction_cron` uses `vault.decrypted_secrets`); `sync-live-auctions` (109) covers it every 15 min
- `source-health-monitor` (21): low-value health check via old `trigger_agent_execution` dispatch, every hour
- `auto-sort-telegram-photos` (128): low priority, every 2 hours
- `analyze-unprocessed-org-images` (60): low priority, every 2 hours

**Rules for all agents:**
> 1. **NEVER create per-minute cron jobs.** Use `*/2` minimum, `*/5` preferred.
> 2. **ALWAYS use `get_service_role_key_for_cron()`** — NOT `current_setting()`, NOT `vault.decrypted_secrets`.
> 3. **Max 2 workers per platform queue.** Don't scale by adding more crons — fix throughput per worker.
> 4. **Check `SELECT count(*) FROM cron.job WHERE active = true;` before adding crons.** If over 120, you need to justify it.

**Removed workers (DO NOT RE-CREATE):**
- mecum-queue-worker 3-10, mecum-live-queue-worker 3-5
- cnb-queue-worker 3-6, bj-queue-worker 3-6, bat-queue-worker 3-5
- pcar-queue-worker 2-3, bonhams-queue-worker 2-3, gooding-queue-worker-2
- quality-backfill-worker 2-4, bat-extraction-worker 4-10, yono-vision-worker 3-4
- continuous-queue-processor 3-5
- auto-extract, concierge-villa-discovery, mecum-extraction-cron, cron-startup-timeout-alert
- agent-monitor-scan, extraction-health-check, observation-migration, enrich-bulk-continuous
- aggressive-backlog-clear, live-auction-sync, source-health-monitor, auto-sort-telegram-photos, analyze-unprocessed-org-images

---

## CURRENTLY ACTIVE

### 🚨 P0 ALERT: vehicles table UPDATE blocking PostgREST — 2026-02-27 ~18:30 UTC
- PID 78414: `UPDATE vehicles SET auction_source = 'barrett-jackson'` running **30+ minutes**
- While running, DDL retries (DROP/CREATE INDEX) cause AccessExclusive lock cascade → PGRST002 outage
- **DO NOT** run any DDL on `vehicles` until this UPDATE completes
- **DO NOT** re-enable valuation cron jobs 321-325 until UPDATE is done
- Valuation crons 321-325 PAUSED by CWFTO to reduce contention


### CWFTO — Morning Brief + Page Failure Triage — 2026-02-27 ~16:35 UTC — COMPLETED
- Ran full startup ritual: inbox (3 msgs), active agents, DONE.md, task list, queue depths, background PIDs
- Platform pulse: 1.165M active vehicles, import queue 40K pending / 235 processing / draining
- Closed: duplicate YONO sidecar task (5a28a4a6), stale curator dedup task (3f77edb7)
- Filed: P92 page load audit (21c3d69c), P88 auth guard map (e6aa28b8) — both vp-platform
- COO inbox msg (YONO watchdog): british tier-2 training PID 37505 confirmed active at epoch 1/25
- REMOVED: session complete

### DB Migration — Normalize auction_source slugs — 2026-02-27
- Task: Fix duplicate auction_source slugs (Barrett-Jackson, Bonhams, PCarMarket, etc.), tag ConceptCarz/orphan records, zero-mileage cleanup
- Files: supabase/migrations/20260227210000_normalize_auction_sources.sql (new)
- DO NOT TOUCH: vehicles.auction_source column (migrating it)

### DB Worker — primary_image_url Backfill + Trigger — 2026-02-27
- Task: Backfill vehicles.primary_image_url from vehicle_images (image_url column), add trigger
- Files: supabase/migrations/20260227200000_sync_primary_image_url_trigger.sql (new)
- DO NOT TOUCH: vehicle_images table schema, vehicles.primary_image_url column (backfilling it)

### VP Vehicle Intel — Valuation Backfill Sprint (feb786e7) — 2026-02-27 ~17:00 UTC
- Task: Lift valuation coverage from 44% → 70%+ (489K viable vehicles queued)
- Building: sharded backfill cron (5 workers, quality-sorted), immediate batch fire, accuracy validation
- DB changes: new migration for run_valuation_batch_by_quality() + 5 cron workers
- DO NOT TOUCH: compute-vehicle-valuation edge function (calling it, not modifying)

### VP Platform — Vehicle Profile P0 Fix — COMPLETED 2026-02-27
- Fixed indefinite loading for anon users: anon role 3s timeout, RPC was slow
- DB migration: stripped price_signal/price_history/documents subqueries, capped images at 200
- Frontend: RPC timeout 8s→2.5s, explicit column fallback. Commit 5ee11e181, pushed to main.
- REMOVED: session complete

### CWFTO — Situational Brief — 2026-02-27 ~16:10 UTC — COMPLETED
- Full startup ritual ran. Reset 7 stale in_progress→pending. Completed 4 done tasks. Closed 2 dupes.
- Filed: P92 deactivate quality backfill crons (100% done), P90 YONO sidecar redeploy, P88 verify vehicle profile P0
- Next CWFTO loop filed (P92 pending)
- REMOVED: session complete

### Key Guardian Setup — COMPLETED 2026-02-27
- gitleaks installed (v8.30.0), .gitleaks.toml config created
- .claude/agents/key-guardian/CLAUDE.md persona created
- scripts/key-audit.sh daily audit script built and tested
- Pre-commit hook updated to run gitleaks protect --staged first
- key-guardian registered in agent_registry + agent_tasks (daily audit task 0e8b5ca1, P95)
- FOUNDER_EMAIL set in Supabase secrets for real email delivery
- First audit ran: ACTION REQUIRED (2 unrotated keys in .env)
- Confirmation email sent (Resend ID: 130dbf6b)
- Committed cf0b94722, pushed to main
- REMOVED: session complete

### Frontend Worker — TeamInbox Gmail-style 3-pane Redesign — COMPLETED 2026-02-27
- Rebuilt TeamInbox.tsx visual layer: 220px sidebar + 360px middle + flex-1 detail pane
- All design system tokens, sender avatars, left accent bars, mobile tab bar
- Commit 9c0553683, pushed to main. REMOVED: session complete

### Stripe Connect Agent — COMPLETED 2026-02-27
- All done. See DONE.md for details. Commit 5528063ab, pushed to main.
- REMOVED: session complete

### Worker — Import Queue Cleanup + Task Triage — 2026-02-27 11:49 UTC — COMPLETED
- Failed queue: 381 → 0 (100% cleared via skip/fix/reset)
- 243 PCarMarket records reset to pending, 44 port-80 BaT URLs fixed
- 8 stale tasks closed, agent type registry cleaned + REGISTRY.md updated
- REMOVED: session complete

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

### VP Vehicle Intel — Session Audit + Cron Gap Filing — COMPLETED 2026-02-27 12:00 UTC
- Deployed: batch-ymm-propagate + batch-vin-decode (both were undeployed)
- Completed: agent_task 1489e336 (YMM propagation: 286 fields filled across 63 vehicles)
- Filed: tasks 6fe1a113 (cron jobs P85), f93ef450 (signal coverage P75), 0e57d34a (VIN gap P60)
- Exchange: confirmed healthy, 4 funds (PORS/SQBD/TRUK/Y79) updating correctly
- Ran: 8x compute-vehicle-valuation batches manually (~400 new estimates)
- REMOVED: session complete

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

### VP Extraction — RM Sotheby's Lot Page Scraper — COMPLETED 2026-02-27
- Built + deployed: `backfill-rmsothebys-descriptions` edge function
- Cron job 268: every 30min, batch_size=10 — 71/1,251 done (5.7% desc rate, was 1.3%)
- Also extracts: mileage, VIN (from chassis field), engine_number, estimate, highlights
- REMOVED: session complete

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

### CFO/Security Officer — Stripe Connect Security Audit — COMPLETED 2026-02-27
- 4 Critical + 4 High issues found and fixed. Commit 8ec743ad9 deployed.
- Email report sent to founder via agent-email. See DONE.md for full details.
- REMOVED: session complete

### VP Extraction — VIN Backfill (User Submission) — 2026-02-27
- Task: 05436e30 — Backfill VINs from listing_page_snapshots, NHTSA WMI lookup
- Files: supabase/functions/backfill-vin-from-snapshots/ (new)
- DO NOT TOUCH: continuous-queue-processor, import_queue processing


### Frontend Audit Agent — Crash Fix Sprint — 2026-02-27 (ACTIVE)
- Task: Full audit of all pages in nuke_frontend/src/pages/ for crashes/broken states
- Touching: All pages (read), fixing null guards, loading states, broken imports
- Priority pages: VehicleProfile.tsx, VehicleHeader.tsx, Search.tsx, CursorHomepage.tsx, MarketExchange.tsx, MarketFundDetail.tsx, Portfolio.tsx, TeamInbox.tsx, InvestorOffering.tsx, BrowseInvestments.tsx, OrganizationProfile.tsx, Dashboard.tsx, AdminMissionControl.tsx
- DO NOT TOUCH: edge functions, DB schema

### Backend Error Triage Agent — 2026-02-27 — COMPLETED
- Found and filed 6 real backend issues (see agent_tasks filed 2026-02-27 16:35 UTC)
- Key findings: api-v1-comps 401 for anon, search_vehicles_fuzzy 3s timeout, investor-portal-stats >15s timeout, api-v1-market-trends timeout, search_vehicles_fts intermittent 503
- All pages return HTTP 200 from Vercel CDN. No missing route files.
- REMOVED: session complete

### VP Platform — Site Load Failure Triage (Playwright) — 2026-02-27
- Task: Investigate blank content / "Loading module..." on nuke.ag
- Using Playwright to capture console errors, network failures, screenshots
- Pages: /, /search?q=porsche, /vehicles
- READ ONLY — no file edits

## Agent: search_vehicles_fuzzy index fix — 2026-02-27
**Task**: Update search_vehicles_fuzzy function to use idx_vehicles_make_model_trgm index
**Files**: supabase function (DB only, no file changes)
**Status**: Running

## Agent: Timeout Fixer — 2026-02-27 ~21:00 UTC
- **Task**: Fix api-v1-market-trends 500 timeout + investor-portal-stats timeout
- **Areas**: DB RPCs (get_market_trends, investor stats), edge functions (api-v1-market-trends, investor-portal-stats)
- **Task IDs**: ffaeabaf, 322eb3ae

### ~~Agent: Fix mobile nav + cron URL bugs — 2026-02-27 ~20:00 UTC~~ DONE
- Both issues were already resolved before pickup. Tasks marked completed.

### Agent: Fix Organization Pipeline (2026-02-27 ~21:00 UTC)
- **Task**: Investigate and fix vehicle_images organization_status stuck at 'unorganized'
- **Files**: supabase/functions/*organiz*, cron jobs, vehicle_images pipeline
- **Task ID**: 28fc41c0-261f-43c1-8651-0e74b1309b82

### FB Marketplace GraphQL Probe — 2026-02-27 17:00 UTC — COMPLETED
**Agent**: FB Marketplace Extraction team
**Result**: GraphQL probe complete. No tokens needed. v2 scraper deployed. 144 vintage listings from 5-city sweep.
**Next**: Run `--all --max-pages 50` for full 55-metro sweep.

### Agent: Infra/Ops — Valuation Crons + Org Pipeline — 2026-02-27 ~21:30 UTC
- **Task 1**: Re-enable valuation cron jobs 321-325 (paused during lock cascade)
- **Task 2**: Fix vehicle_images organization_status pipeline
- **Areas**: cron.job, vehicles table locks, vehicle_images organization pipeline

### ~~Agent Architecture Team — Agent Hierarchy Build — 2026-02-27 ~23:00 UTC~~ DONE
- Built and deployed: haiku-extraction-worker, sonnet-supervisor, agent-tier-router, _shared/agentTiers.ts
- Tested with real data. See DONE.md 2026-02-27 entry.
- REMOVED: session complete

### ~~YONO Sidecar Team — 2026-02-27 ~23:30 UTC~~ DONE
- Tier-2 models exported to ONNX, uploaded to Modal, sidecar redeployed with all 6 families
- `api-v1-vision` v1.1 rewritten: parallel classify+analyze, auth tokens, optional comps
- All edge functions tested end-to-end. Consumer API delivering full vehicle intelligence at $0/image.

### FB Marketplace National Sweep — RUNNING (PID 96491) — 2026-02-27 ~23:45 UTC
- **Script**: `nohup dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50 > /tmp/fb-sweep.log 2>&1`
- **PID**: 96491 (node process), parent wrapper PID 96482
- **Status**: CONFIRMED RUNNING — Austin complete (89 vintage/942 total), Dallas in progress
- **ETA**: ~4 hours for all 58 metros
- **Monitor**: `tail -30 /tmp/fb-sweep.log`
- **Expected yield**: ~2,000-4,000 vintage listings across 58 US metros
- AGENT REMOVED — sweep is autonomous, no agent needed

### ~~Automation Team — launchd Setup — 2026-02-28~~ DONE
- Both plists created, loaded, verified. Old nohup killed. See DONE.md 2026-02-28.

### ~~SDK Team — @nuke1/sdk v1.5.0 vision namespace — 2026-02-28~~ DONE
- Vision types aligned with live api-v1-vision v1.1, health() method added, smart auth
- All 4 methods verified end-to-end: classify, analyze, batch, health
- REMOVED: session complete

### Agent: VehicleProfile Refactor — 2026-02-27 ~18:00 UTC
- **Task:** Splitting VehicleProfile.tsx into sub-components
- **Files:** `nuke_frontend/src/pages/VehicleProfile.tsx`, new files in `nuke_frontend/src/pages/vehicle-profile/`
- **NOT touching:** VehicleHeader.tsx (another agent owns that)

### Agent: VehicleHeader Refactor — COMPLETED 2026-02-27
**Phase 1 DONE**: Extracted utilities + hooks from VehicleHeader.tsx (5885 -> 4950 lines)
- Created `vehicleHeaderUtils.ts` (313 lines) — pure utility functions
- Created `hooks/useVehicleHeaderData.ts` (904 lines) — 16 custom data-fetching hooks
- VehicleHeader.tsx compiles clean (`npx tsc --noEmit` passes)
- Zero behavior change, all CSS/styling preserved

### DOM Flattening — AppLayout.tsx — COMPLETED 2026-02-27
- Merged `.content-container` into `main.main-content` in AppLayout (removed 1 wrapper div)
- Files changed: AppLayout.tsx, design-system.css
- index.css untouched (no changes needed)



## UI Visual Audit Agent — 2026-02-27 ~18:00 UTC
**Task**: Screenshot vehicle page at mobile/desktop widths, audit dark mode
**Files**: Read-only (screenshots only)
**Status**: Active

### ~~🎨 Theme System Audit & Fix — 2026-02-27 ~23:00 UTC~~ DONE
- Completed: Full audit, 800+ fixes across 80+ files, 90 new CSS variables, report written
- See THEME_AUDIT_REPORT.md for full results
- REMOVED: session complete

### [labor-estimation] COMPLETED — 2026-02-28 03:15 UTC
Automated Labor Estimation Pipeline — all 7 phases built, deployed, and committed (ae30b897c).

### [first-touch-overhaul] First-Time User Engagement Overhaul — 2026-02-27 ~23:20 UTC
- **Task**: Overhauling all first-touch surfaces (homepage, feed, search, about, signup, onboarding)
- **Files**: nuke_frontend/src/pages/*, nuke_frontend/src/components/onboarding/*
- **Areas**: Homepage hero, vehicle cards, feed page, about page, signup page

### Agent: UnifiedMap Migration (Leaflet → deck.gl + MapLibre)
- **Started**: 2026-02-28
- **Files**: `nuke_frontend/src/components/map/UnifiedMap.tsx`, `nuke_frontend/package.json`
- **Task**: Replace react-leaflet with deck.gl ScatterplotLayer + maplibre-gl base map

### Agent: vehicle_zone deprecation (2026-02-28 ~UTC) -- COMPLETED
- Rewrote imageDisplayPriority.ts + imageCoverageTracker.ts, created constants/vehicleZones.ts
- Added deprecation comments to all legacy angle references
- REMOVED: session complete

## Agent: Demote AI Button + Harden Pre-Analysis Pipeline
- **Task**: Demote AI button in ImageLightbox, surface analysis data better in sidebar
- **Files**: nuke_frontend/src/components/image/ImageLightbox.tsx, nuke_frontend/src/components/image/ImageInfoPanel.tsx
- **Started**: 2026-02-28 17:54 UTC


### Agent: Walk-Around Carousel — 2026-02-28 ~15:00 UTC
- **Task**: Build WalkAroundCarousel component, wire into VehicleProfile
- **Files**: `nuke_frontend/src/components/images/WalkAroundCarousel.tsx` (new), `nuke_frontend/src/pages/VehicleProfile.tsx`, `nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx`
- **Status**: Starting

### Frontend Quality Audit Agent — 2026-02-28 ~18:40 UTC
- Task: Runtime crash pattern audit on recently modified components
- Files: ComprehensiveWorkOrderReceipt, ErrorBoundary, EventMap, GlobalUploadIndicator, NotificationCenter, UniversalImageUpload, VehicleComments, VehiclePricingWidget
- Will fix null guards and crash prevention only


### Agent: import_queue cleanup — 2026-03-01 (COMPLETED)
**Task:** Fixed import_queue failures. Widened vehicle_mailboxes.vin varchar(17)->varchar(50), reset 4 VIN overflow items, skipped 20 Firecrawl credit failures, checked snapshot availability for missing-fields errors.
**Status:** Done — removing self

### Agent: Data Quality Score Backfill Acceleration -- COMPLETED
**Started/Ended**: 2026-03-01
**Result**: 800K vehicles scored in 19 minutes. 99.93% coverage. New cron job 344 handles ongoing.

## Agent: Snapshot Success Rate Investigation -- COMPLETED
**Started:** 2026-03-01
**Status:** Done. Changes ready for deploy.
**Files changed:** _shared/archiveFetch.ts, extract-craigslist, extract-bonhams, extract-barrett-jackson, extract-cars-and-bids-core, process-cl-queue, scrape-all-craigslist-squarebodies

### Agent: Quality Score Backfill Acceleration — 2026-03-01 ~00:30 UTC — COMPLETED
- DONE: Scored 790K+ vehicles, 99.94% coverage, maintenance cron installed (job 343)

### Agent: VIN Backfill Deployer — 2026-03-01 ~now
- Task: Deploy backfill-vin-from-snapshots, test, run batches, set up cron
- Files: supabase/functions/backfill-vin-from-snapshots/
- Status: Starting


### Agent: Admin Dashboard Health Check — 2026-03-01
- **Task**: Audit and fix AdminMissionControl and admin pages
- **Files**: `nuke_frontend/src/pages/Admin*`, `nuke_frontend/src/components/admin/`
- **Status**: COMPLETE

### Agent: Mass Snapshot Extraction v2 — 2026-03-01 ~11:20 UTC
- **Task**: Extract structured data from 326K archived HTML snapshots across all platforms
- **Files**: `supabase/functions/batch-extract-snapshots/index.ts`, `scripts/parallel-extract.mjs`
- **Background processes**: 20 BaT workers + 3 Mecum workers running (PIDs 56999-61351)
- **Queue**: snapshot_extraction_queue table — BaT 261K pending, Mecum 10K pending
- **Progress**: 33K completed, 77K+ fields filled
- **Status**: Running in background (~2h for BaT to complete)

## Agent: Header Redesign + Search Intelligence — 2026-03-01 16:00 UTC
**Task**: Full implementation of search RPCs, intent router, 4 header variants
**Files**: 
- `supabase/migrations/2026030201*` (5 new migrations)
- `nuke_frontend/src/lib/search/*` (new intent router)
- `nuke_frontend/src/components/layout/*` (header rewrite)
- `nuke_frontend/src/contexts/ThemeContext.tsx`
- `nuke_frontend/src/styles/unified-design-system.css`
**Status**: Starting

## Agent: St Barth Publication Pipeline — 2026-03-01 19:35 UTC
- **Task**: Building Issuu publication extraction pipeline (schema, seed, hash extraction, vision analysis)
- **Files**: supabase/migrations/20260302*, scripts/stbarth/*
- **Areas**: DB schema, scripts, pipeline registry

## V3 Vehicle Profile Redesign Agent — 2026-03-02
- **Task**: Implementing V3 Bloomberg Terminal aesthetic for vehicle profile page
- **Files**: vehicle-profile.css, VehicleProfile.tsx, WorkspaceContent.tsx, new BarcodeTimeline.tsx, new VehicleBadgeBar.tsx
- **Status**: Active



## Agent: vehicle_events rename — 2026-03-07 ~10:00 UTC
- **Task**: Rename bat_listings + external_listings → vehicle_events across entire codebase
- **Files**: ALL priorities (edge functions, frontend, scripts, docs)
- **DO NOT TOUCH**: migrations/, archive/

### Agent: bat_listings/external_listings → vehicle_events rename (2026-03-07 ~10:00 UTC)
- **Task**: Rename all remaining bat_listings/external_listings references to vehicle_events in 60 edge functions
- **Files**: supabase/functions/*/index.ts (60 files listed)
- **Status**: Starting

### Data Purge Agent — 2026-03-07 ~18:30 UTC
- **Task**: Great Data Purge — audit, normalize sources, collapse duplicates, purge empty shells, fix impossible states
- **Touching**: `vehicles` table (status, auction_source, source columns), `vehicle_images`, `vehicle_observations`
- **Will NOT**: delete any data — status-marking only

## Agent: Surface the Damn Data (2026-03-07 ~18:20 UTC)
**Task**: Close backend→UI data gap — fix search cards, primary_image_url backfill, vehicle profile, VIN search, data quality tiers
**Files**: nuke_frontend/src/ (search, vehicle profile components), supabase/functions/ (search, backfill)
**Status**: Active
2026-03-08 02:35 UTC | rate-limiting-fix + design-system-enforcement | files: supabase/functions/api-v1-*/index.ts, eslint config, new lint rules | Agent: Prompt 7+8
~~2026-03-07 18:35 | Prompt 9+10: Archive reextraction + CWTFO Dashboard~~ DONE
- Repopulated snapshot_extraction_queue (23,709 items), cron running every 30 min
- admin_pulse() RPC + edge function deployed, AdminPulse.tsx built at /admin/pulse
- REMOVED: session complete



## 2026-03-07 — ORCHESTRATOR SESSION (12 parallel agents)
**Task:** Executing 12 deep concept prompts from VISION.md research
**Agents launched:** Patient Zero, SDK Fix, MCP Publish, Data Purge, Engagement Loop, YONO Daily, Backbone Test, BJ Gold Mine, Unclaimed IDs, Financial Audit, Perplexity Pattern, Five Layers
**Areas:** ALL — orchestrator coordinating, agents in worktrees for code changes

### Agent: Patient Zero K10 Audit — 2026-03-07
- **Task**: Comprehensive audit of 1984 K10 (vehicle_id: 6442df03-9cac-43a8-b89e-e4fb4c08ee99)
- **Files**: Read-only audit, report output to .claude/reports/
- **Status**: Active

### ~~Agent: Barrett-Jackson Gold Mine Audit — 2026-03-07~~ DONE
- **Task**: Audit 69K BJ archived snapshots, assess extraction state, write report
- **Output**: `.claude/reports/barrett-jackson-gold-mine.md`
- **Key Finding**: 78,901 snapshots, 100% have HTML, but extraction yields 0.00 fields per item due to CSR/BailoutToCSR mismatch
- REMOVED: session complete

## Financial Systems Audit Agent — 2026-03-07
- **Task**: Prompt 10 — Full audit of all 10 financial systems
- **Output**: `.claude/reports/financial-systems-audit.md`
- **Status**: COMPLETE

### Agent: K10 Patient Zero Fix — 2026-03-07 — COMPLETED
- **Task**: Fix the founder's 1984 K10 — link owner, write description, create observations, trigger YONO, fix valuation
- **Result**: Owner linked, description written, 5 observations created, valuation record inserted, quality score 70->85, display tier browse->showcase, YONO processing started, iPhoto intake re-running with --force
- **REMOVED**: session complete

## Agent: Engagement Infrastructure Activation — 2026-03-07 21:00 UTC
- **Task**: Activate empty engagement tables (user_subscriptions, vehicle_watchlist, user_notifications, email_digest_queue)
- **Files/Areas**: DB engagement tables, RLS policies, NotificationCenter.tsx, .claude/reports/engagement-activation.md
- **Status**: Starting

## Agent: Wire Ingest Function to Frontend
- **Started**: 2026-03-07 21:00 UTC
- **Task**: Connect frontend search/URL pasting to the `ingest` edge function
- **Files**: `nuke_frontend/src/components/search/`, `nuke_frontend/src/services/aiDataIngestion.ts`
- **Status**: DONE — committed a2c9bca0e

## Agent: Competitive Intelligence Deep Dive
- **Task**: Deep competitive analysis of all vehicle data platform competitors
- **Started**: 2026-03-07 ~21:00 UTC
- **Files**: `.claude/reports/competitive-intelligence-deep.md`, docs/
- **Status**: COMPLETE

## Agent: Image Pipeline Unstick + YONO Processing -- COMPLETED 2026-03-07 21:05 UTC
- Released 28,149 stuck locks, fixed 4 edge function bugs, processed 1,624 images
- Report: .claude/reports/image-pipeline-unstick.md

## Agent: Data Fix - Vehicle States/Makes/Platforms
- **Started**: 2026-03-07 21:30
- **Task**: Fix 13K impossible vehicle states, normalize platform slugs, fix make casing
- **Tables**: vehicles, external_identities

## Agent: Duplicate Vehicle Cleanup
- **Task**: Phase 1-4 duplicate vehicle analysis and marking
- **Started**: 2026-03-07
- **Touching**: vehicles table (status column only), read-only on vehicle_images, vehicle_observations, vehicle_events, auction_comments
- **Will NOT**: delete any rows, only mark status='duplicate'

## Agent: Identity Stats & Engagement Infrastructure — 2026-03-07 21:30 UTC
- Task: Build identity stats, claim page data, verify engagement triggers, NotificationCenter icons
- Files: DB tables (bat_identity_stats_v1, user_notifications, user_subscriptions), nuke_frontend/src/components/notifications/
- Status: ACTIVE

## Agent: Garbage Make Cleanup
- **Task:** Investigate and clean ~18K vehicles with garbage/null makes where canonical_vehicle_type IS NULL
- **Started:** 2026-03-08 
- **Touching:** vehicles table (make, canonical_vehicle_type, status columns only)

### Agent: primary_image_url backfill — 2026-03-08
- Task: Backfill primary_image_url on vehicles from vehicle_images
- Files: vehicles table, vehicle_images table (read-only)
- Status: ACTIVE

### ~~Map Rebuild — 2026-03-10~~ DONE
- Event-centric map rebuild (all 6 phases). NukeMap.tsx replaces UnifiedMap.tsx.
- REMOVED: session complete
