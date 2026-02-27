# NEXT SESSION — FB Marketplace National Monitoring System

## CEO DIRECTIVE
Build a national monitoring system tracking the full lifecycle of every vintage vehicle listing on FB Marketplace across the US. Fresh listings, price movements, time-on-market, seller behavior patterns, geographic flow.

## PRIORITY STACK (execute in order)

### 1. [P0] Schema Migration — #187
Apply the marketplace lifecycle schema patch:
- New columns on `marketplace_listings`: metro_area, sweep IDs, removed_at, raw_data, price_history, etc.
- New tables: `marketplace_sweep_history`, `fb_sellers`, `fb_seller_listings`
- Price change trigger, seller classification functions, velocity views
- Fix `fb_listing_id` → `facebook_id` column mismatch
- **File:** See issue #187 for full SQL

### 2. [P0] Scraper v2.1 — #190
Replace `scripts/fb-marketplace-local-scraper.mjs` with patched version:
- Seller extraction (seller_id + seller_name)
- Raw data JSONB storage (no data thrown away)
- Batch upserts (chunks of 50 vs individual queries)
- doc_id health check (catches Facebook query rotation)
- Sweep ID + disappearance detection
- Extra fields: description, listing_created_at, vehicle_type, condition
- 55 metros, 60+ makes
- **File:** See issue #190 for full code

### 3. [P1] Twice-Daily Cron — #189
Set up automated sweeps + detective checks
- 6 AM EST + 6 PM EST full national sweeps
- Post-sweep quality checks

### 4. [P2] Facebook Page Strategy — #188
CEO decision needed on branding. Park until Layers 1-3 are running.

## STILL OPEN FROM PREVIOUS SESSIONS
- #173 Vehicle profiles not shareable (Dave Granholm blocker)
- #175 Collection tab vehicles invisible
- #178 Profile crashes on /profile/skylar
- #181 Quality alerting system
- #182 Duplicate/wrong images
- #183 Barrett-Jackson data gaps
- #184 Perplexity Detective mandate for all VPs

## AGENT ASSIGNMENTS
- **VP Platform:** #187 (schema), #189 (cron)
- **VP Extraction:** #190 (scraper v2.1), detective checks
- **CPO:** #188 (FB page strategy, pending CEO input)
- **CTO:** Verify deployment pipeline (#178 fix committed but not deployed)
