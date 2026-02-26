# ACTIVE AGENTS
**Update this file when you start or finish work. Remove stale entries — they cause false conflicts.**

---

## CURRENTLY ACTIVE

### Location Pipeline Fix + Geocode Backfill — ACTIVE 2026-02-26 18:00
- **Task**: Fix BAT/C&B/CL extractors to populate listing_location_* fields + write vehicle_location_observations. Running geocode backfill script for 28k existing records.
- **Touching**: extract-bat-core, extract-cars-and-bids-core, process-cl-queue, _shared/parseLocation.ts (NEW), geocode-vehicle-locations (NEW), scripts/geocode-backfill.mjs (NEW)
- **Do not touch**: vehicles table schema (no migrations needed — columns already exist)

### SDK v1.3.1 + api-v1-vision — COMPLETED 2026-02-26
- Deployed api-v1-vision to Supabase. Committed vision.ts. SDK v1.3.1 already live on npm.
- See DONE.md for details.

Format:
```
### [Task Name] — ACTIVE [DATE TIME]
- **Task**: What you're doing (1-2 sentences)
- **Touching**: Which files / edge functions / areas
```

Remove your entry when done. Add results to DONE.md.

---

## COORDINATION RULES

- One agent per edge function at a time
- Database: no DROP, TRUNCATE, or DELETE without WHERE
- Git: descriptive commit messages, no force push to main
- Before editing a shared edge function: check this file

---

## COMPLETED THIS WEEK (reference)

### Agent Safety & Pipeline Documentation — COMPLETED 2026-02-25
- TOOLS.md, pipeline_registry (63 entries), column comments (86), CHECK constraints (6 columns)
- release_stale_locks() + queue_lock_health view + hourly cron job 188
- Released 375 stuck records on deploy (367 vehicle_images since Dec 2025)

### Cars & Bids Extractor Rewrite — COMPLETED 2026-02-25
- extract-cars-and-bids-core: direct HTML parsing, cache-first markdown, all fields, sale_price fix

### FB Marketplace Sprint — COMPLETED 2026-02-25
- HTML fallback, residential-IP scraper, seller blocklist, refine-fb-listing (og: tags + bingbot fetch)
- Discovery gap fixed, CL private-seller filter

### Nuke.ag + Rebrand — COMPLETED 2026-02-24
- Marque → Nuke complete, nuke.ag live, /offering dynamic investor page, contact inbox

### Acquisition Pipeline — COMPLETED 2026-02-19
- Market proof page, CL discovery, batch processing, acquisition dashboard

### Extraction Quality Sprint — ACTIVE 2026-02-26
- **Task**: Fix extractor field gaps + mass re-queue for backfill. PCarMarket color/engine/tx deployed. 18K C&B + 25K Bonhams + 13K B-J queued. Auditing RMSothebys/Gooding/BaT snapshot backfill, quality gates.
- **Touching**: import-pcarmarket-listing (deployed), import_queue (bulk inserts), extract-rmsothebys, extract-gooding
- **Coordinate**: Do NOT modify the 24,978 Bonhams + 18,261 C&B + 13,602 B-J pending items I just queued

### data_quality_score Backfill — ACTIVE 2026-02-26
- **Task**: Check column type, fix trigger to store 0-100, backfill 1.25M vehicle records in batches, set up cron
- **Touching**: vehicles table (data_quality_score column), DB triggers, pg_cron schedules

### YONO FastAPI Sidecar + Training Export — ACTIVE 2026-02-26 15:45
- **Task**: Build server.py (FastAPI sidecar), export_supabase_training.py, train_hierarchical.py — the 3 files needed to unblock SDK v1.3.0
- **Touching**: yono/server.py, yono/scripts/export_supabase_training.py, yono/scripts/train_hierarchical.py, supabase/functions/yono-classify/index.ts
- **Do not touch**: analyze-image (will modify after sidecar is proven working)

### Market Exchange Backend Integration — ACTIVE 2026-02-26 16:10
- **Task**: Wire exchange backend end-to-end — NAV pricing from real vehicle data, fractional platform listings, order flow validation, mark-to-market updates
- **Touching**: supabase/functions/calculate-market-indexes, place-market-order, trading, market_funds/market_segments/share_holdings/market_orders tables
- **Do not touch**: vehicles table (read-only), YONO files, bonhams import_queue records

### VehicleHeader Transfer Badge + Backfill — ACTIVE 2026-02-26 16:15
- **Task**: 1) Fix VehicleHeader.tsx drift (dead code, duplicate useMemos, owner badge), 2) Add transfer status badge (current milestone, progress, days stale), 3) Run transfer backfill for 170k sold auctions
- **Touching**: VehicleHeader.tsx, ownership_transfers/transfer_milestones (read), new edge fn transfer-status-api
- **Do not touch**: YONO files (other agent), import_queue (other agent), vehicles.data_quality_score (other agent)

### Frontend Perf Sprint — ACTIVE 2026-02-26 18:30
- **Task**: Eliminating page load waterfalls across the app. Completed: SubdomainRouter, useSession, vendor chunk split, VehicleProfile auth-gate. Next: lazy loading images, TECHNICAL_EXHIBITS markdown bundle fix.
- **Touching**: nuke_frontend/src — useSession.ts, SubdomainRouter.tsx, VehicleProfile.tsx, vite.config.ts, utils/cachedSession.ts
- **Do not touch**: Any edge functions, backend, DB migrations
