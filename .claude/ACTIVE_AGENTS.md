# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

### Image Bundle Review UX — IN PROGRESS 2026-02-26 (terminal: vehicle-profile-ui)
- **Task**: Build bundle-grouped gallery + review queue for Dave's GMC K2500 (vehicle a90c008a)
- **Files touching**: src/components/images/, src/pages/VehicleProfile.tsx, src/pages/vehicle-profile/
- **Prior work**: EXIF backfill complete (580 images clean), daemon EXIF format fixed
- **Status**: Starting UI implementation per plan at ~/.claude/plans/delightful-seeking-narwhal.md
- **DO NOT**: touch reprocess-image-exif, photo-sync-orchestrator, photo-auto-sync-daemon.py

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
