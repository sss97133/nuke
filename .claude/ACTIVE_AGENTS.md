# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

### YONO Vision V2 — BACKGROUND TRAINING 2026-02-26
- All 4 phases + zone system done. Background processes still running.
- **Training PID 68092**: train_florence2.py — epoch 3/10, loss 3.86, cond_acc 75%
  - DO NOT interrupt. Saves to yono/models/yono_vision_v2_head.safetensors when done.
- **Watcher PID 80532**: wait_then_train_zones.sh — auto-launches zone classifier when PID 68092 finishes
  - Zone training will start automatically: train_zone_classifier.py --epochs 15
  - Logs: yono/outputs/zone_classifier/training.log
- **Zone labeling**: COMPLETE (2764/2764 records labeled)
- **server.py fix**: `_zone_classifier` global declaration bug fixed

### Extraction Quality Sprint — ACTIVE 2026-02-26 (continued after context compression)
- **Phase 1** (earlier): CQP routing fixes: mecum→extract-mecum, ebay→extract-ebay-motors, gooding sourceIds. C&B 7-day cache TTL removed.
- **Phase 2** (this session): **CRITICAL DESCRIPTION FIXES**:
  - **extract-mecum**: Added `parseBlocksDescription()` — parses HIGHLIGHTS + EQUIPMENT from Gutenberg blocks (post.content was always empty!). Description rate 0%→60%+. Quality 0.73→0.93.
  - **extract-bonhams Phase 2**: Footnotes parsing, markdown title fallback, vehicle_id top-level fix.
  - **extract-bonhams Phase 3**: Firecrawl trigger fixed (`!hasLotContent` only — React shell always has JSON-LD + 120KB, old `(!hasJsonLd || html.length < 5000)` was always false). Added inline body extraction (paragraphs between lot title H2 and `## Additional information`). Result: **0% → 66% description rate**, avg 3,564 chars.
  - **35K Mecum backfill**: Reset mecum items completed before 2026-02-20 to pending for re-extraction.
  - **Crons added**: 231-232 (mecum-queue-worker-4,5), 233-234 (gooding-queue-worker-1,2)
  - **Crons removed**: 229, 230 (bad re_enrich workers)
- **Current queue**: mecum 54.5K/828hr (~66h), C&B 30.5K/984hr (~31h), B-J 22.7K/1931hr (~12h), PCar 5K/157hr (~32h), BaT 3.6K/832hr (~4h), Bonhams 2.4K/573hr (~4h), Gooding 1.3K/187hr (~7h)
- **DO NOT**: touch quality_backfill_state, recreate idx_vehicles_quality_score/backfill indexes; touch C&B snapshot cache logic; kill PIDs 34496 or 5727

### Queue Coordinator — ACTIVE 2026-02-26 20:00 (this terminal)
- **Crons added**: 217-222 (Mecum/PCarMarket workers), 228 (quality backfill v2 with DO block + temp table)
- **DB changes**: Dropped idx_vehicles_quality_score + idx_vehicles_quality_backfill, created quality_backfill_state, quick_quality_backfill_v3
- **DO NOT**: recreate the dropped quality score indexes (backfill in progress, takes 69hrs); touch quality_backfill_state

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

### YONO Training + Export — BACKGROUND JOBS 2026-02-26 (current session)
- **Tier 2 training** PID 34496: `train_hierarchical.py --all` running since 2:00 AM, training on MPS
  - Progress: tier 1 done (hier_family.onnx), american epoch 1+ done (12:32), continuing through german/japanese/etc
  - DO NOT kill PID 34496
- **Supabase export** PID 5727 (or check supabase_export.pid): ctid-based export, --skip-download mode
  - Progress: ~27% (808K/2923K blocks), writing to training-data/images/batch_0103+
  - ETA: ~1 hour to complete all 838K records
  - DO NOT kill or restart this export

### YONO FastAPI Sidecar — COMPLETED 2026-02-26
- Deployed to Modal: https://sss97133--yono-serve-fastapi-app.modal.run
- YONO_SIDECAR_URL set in Supabase, yono-classify full round-trip validated
- Both agent_tasks (P85 + P100) marked completed

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
