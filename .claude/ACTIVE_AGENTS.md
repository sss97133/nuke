# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

### Image Bundle Review UX — COMPLETED 2026-02-26 (terminal: vehicle-profile-ui)
- BundleReviewQueue.tsx wired in Evidence tab; 4 needs_input events exist for Dave's GMC
- auto-create-bundle-events + suggest-bundle-label deployed; auto-triggered on owner profile load
- photo-auto-sync-daemon.py: structured EXIF format fix (camera.make, exif_status: 'synced_from_photos')
- Committed 76a35a4d7, pushed, Vercel deploying

### VehicleHeader Transfer Badge — COMPLETED 2026-02-26 19:00
- transfer-automator, transfer-advance, transfer-email-webhook, transfer-sms-webhook, transfer-status-api deployed
- VehicleHeader.tsx: drift fixes + transfer status badge (milestone label, progress %, days stale, buyer handle)
- Backfill cron (job 190) running every 2 min. Committed 6e346eba7, pushed, Vercel deploying.

### YONO Hierarchical Training — BACKGROUND JOBS 2026-02-26 12:30
- **Task**: Two background jobs running — Tier 2 training (PID in /tmp/hier_tier2_training.log) + Supabase export (PID in training-data/supabase_export.pid)
- **Tier 2 training**: `python train_hierarchical.py --tier 2` — american (20 makes, 25 epochs on MPS, ~14min/epoch), then german, japanese, british, italian
- **Export**: `python export_supabase_training.py --resume` — fetching batches 101+ from Supabase, 300s psql timeout
- **DO NOT**: kill these processes, edit train_hierarchical.py or export_supabase_training.py, or touch training-data/images/

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

### data_quality_score Backfill — COMPLETED 2026-02-26
- Fixed trigger (was storing 0.0-1.0 decimal as INTEGER → all zeros), now stores 0-100
- Backfilled 6,517 records manually; cron job 211 runs every minute via quick_quality_backfill(500)
- ~1.247M remaining, auto-completing at ~500/min (~40 hrs to finish)
