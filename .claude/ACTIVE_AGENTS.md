# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## INTER-VP BRIEFS (read before starting work)

### 📋 VP Deal Flow → VP Extraction — 2026-02-26
190 pipeline entries have null asking_price → all score 40/FAIR. CL price scraping stalled.
**File**: `.claude/VP_DEAL_FLOW_TO_EXTRACTION_BRIEF.md`

### 📋 VP Intel → VP Extraction — 2026-02-26
Gap report: descriptions, VIN, mileage, engine/transmission gaps hurting scoring pipeline.
**File**: `.claude/VP_INTEL_TO_EXTRACTION_BRIEF.md`

---

## CURRENTLY ACTIVE

### Worker — Vehicle Deduplication — 2026-02-26
- Task: 3f77edb7 — dedup vehicles by listing_url (1.07M rows → ~39K distinct)
- Building merge PL/pgSQL function + dedup edge function
- Touching: supabase/functions/dedup-vehicles/ (new), vehicle_merge_proposals table
- DO NOT: modify vehicles table directly without checking merged_into_vehicle_id


### VP AI — Tier-2 ONNX Upload & Modal Redeploy — 2026-02-26 23:06
- Task: fdf5038f — waiting for PID 12814 (zone) + PID 39959 (tier2 watcher) to complete
- Will: upload tier-2 ONNX to Modal volume yono-data, redeploy sidecar, validate
- DO NOT: kill PID 12814 or PID 39959


### VP Deal Flow — Transfer System Coordination — 2026-02-26
- Audited full transfer pipeline. Brief at `.claude/VP_DEAL_FLOW_TRANSFER_BRIEF.md`
- Coordinating with CPO, CTO, CFO, VP Platform
- Touching: no files yet — in coordination phase




### YONO Vision V2 — BACKGROUND TRAINING 2026-02-26
- All 4 phases + zone system done. Florence2 v2 COMPLETE (yono_vision_v2_head.safetensors saved).
- **Zone classifier PID 12814**: train_zone_classifier.py — epoch 5/15, val_acc ~69%, ~31min/epoch
  - DO NOT interrupt. Log: yono/outputs/zone_classifier/training.log
- **Watcher PID 39959**: wait_then_train_hier_tier2.sh — waiting for zone (PID 12814) to finish
  - Will train tier-2 families: german, british, japanese, italian, french, swedish (american already done)
  - Then runs --export for all ONNX files
  - Log: yono/outputs/hierarchical/tier2_remaining.log
  - Next step after export: upload ONNX files to Modal volume yono-data
  - DO NOT kill PID 39959 or PID 12814
- **Watcher PID 80532**: wait_then_train_zones.sh — stale, zone already running; may relaunch zone on finish (low risk, checkpoint exists)
- **Zone labeling**: COMPLETE (2764/2764 records labeled)

### [vp-platform] Platform health check complete — 2026-02-27 03:00 UTC
- Fixed 4 broken cron commands (jobs 128, 186, 213, 235) using stale current_setting() calls
- Quality backfill 237-240 confirmed ACTIVE (COO note was stale — already re-enabled)
- Filed incident P70 (bat-snapshot timeout) and P60 (mecum-live 50% fail rate)

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

### VP Intel — Comparable Sales Feature — 2026-02-27 06:00
- Task: Build "Similar Sales" section for vehicle profile pages (top user request)
- Creating: VehicleSimilarSales.tsx component + API endpoint
- Editing: VehicleProfile.tsx (add Similar Sales tab)
- DO NOT: modify vehicle profile layout structure (just adding new tab)

### VP Platform — Search UI Fixes — 2026-02-27 03:50 UTC
- Task: Fix search results UI to show actual data (tier ratings, observation counts, filters, VIN search)
- Backend already returns image_count + event_count correctly
- Frontend needs to display prominently in VehicleCardDense.tsx and Search.tsx
- Touching: nuke_frontend/src/components/vehicles/VehicleCardDense.tsx, nuke_frontend/src/pages/Search.tsx
- DO NOT: modify backend APIs (already working)
