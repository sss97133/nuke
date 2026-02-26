# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

### YONO Vision V2 — COMPLETED 2026-02-26 (vision ML agent)
- All 4 phases done. Background processes still running.
- **Labeling PID 62327**: auto_label_images.py — 2600+/3000 done, finishing in ~5min
- **Training PID 68092**: train_florence2.py — epoch 1/10, step 260/433, loss 7.9→6.8
- See DONE.md for full details. DO NOT interrupt PIDs 62327 or 68092.

### Extraction Quality Sprint — ACTIVE 2026-02-26 (continued after context compression)
- **Phase 1** (earlier): CQP routing fixes: mecum→extract-mecum, ebay→extract-ebay-motors, gooding sourceIds. C&B 7-day cache TTL removed.
- **Phase 2** (this session): **CRITICAL DESCRIPTION FIXES**:
  - **extract-mecum**: Added `parseBlocksDescription()` — parses HIGHLIGHTS + EQUIPMENT from Gutenberg blocks (post.content was always empty!). Description rate went from 0% → ~60%+. Quality score 0.73→0.93.
  - **extract-bonhams**: Added `### Footnotes` markdown section parsing for rich lot descriptions. Added markdown heading title fallback. Fixed Firecrawl trigger (now fires on all non-cached pages, not just html<5KB). Description rate from 0% → expected 60%+.
  - **35K Mecum backfill**: Reset all mecum items completed before 2026-02-20 (35,146 records) to 'pending' for re-extraction with blocks fix.
  - **Crons added**: 231 (mecum-queue-worker-4), 232 (mecum-queue-worker-5), 233-234 (gooding-queue-worker-1,2)
  - **Crons removed**: 229, 230 (bad re_enrich workers)
- **Queue state**: mecum 55K pending (~81hrs), C&B 31K, B-J 24K, PCar 5K, BaT 4K, Bonhams 2.6K, Gooding 1.6K
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
