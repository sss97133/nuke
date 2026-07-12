# EXTRACTION — theory card

**The model:** Fetch once, extract forever. Every external page fetch goes through `_shared/archiveFetch.ts`, which checks `listing_page_snapshots` cache, fetches (direct/Firecrawl), archives raw HTML+markdown, then returns content — so later extraction passes re-parse stored snapshots at $0 instead of re-crawling. Extraction stores raw evidence/observations with source DNA (amount, source, method, observed_at, trust); labels are projections of measurement, computed at render — never baked as categoricals into schema.

**The invariant(s):**
- `archiveFetch()` for ALL external page fetches (raw `fetch()` follows 302→login, caches garbage for 24h — the auth-redirect bug). Only exception: JSON API endpoints.
- Before any network call, check `listing_page_snapshots` — if a snapshot exists, re-extract from it (`batch-extract-snapshots`).
- `auction_comments` (105k rows) is testimony — never delete/overwrite. Extracted values keep provenance; no raw INSERT into testimony tables (write via ingest-observation path).
- Every candidate passes `qualityGate()` (`_shared/extractionQualityGate.ts`) inside `ingest` before landing.

**Canonical entrypoints** (from CAPABILITY_MAP.md, verdict=CANONICAL):
- Ingest ANY listing URL / unknown source → `ingest` edge fn (universal entry; chains archiveFetch + qualityGate)
- Enqueue extraction work → insert into `import_queue` table (the spine, 264k rows)
- Route/drain import_queue → `process-import-queue` (routes to 17 per-source extractors + AI fallback)
- BaT listing → `extract-bat-core` THEN `extract-auction-comments` (two-step); queue drain → `process-bat-extraction-queue` (cron */5); discovery → `bat-url-discovery`; profiles → `extract-bat-profile-vehicles`
- Re-extract from archived snapshots → `batch-extract-snapshots` (reads `listing_page_snapshots`)
- Facebook Marketplace → `extract-facebook-marketplace` + `refine-fb-listing` (+ fb-scraper skill / launchd fleet)
- Per-source extractors → the `extract-*` fn already routed by process-import-queue (craigslist, hagerty, pcarmarket, mecum, bonhams, gooding, rmsothebys, ebay-motors, cars-and-bids, …)
- Generic AI fallback → `extract-vehicle-data-ai`; new source onboarding → `onboard-source`
- Health → `extraction-watchdog` (manual); queue brief → `ralph-wiggum-rlm-extraction-coordinator {action:'brief'}`

**Do NOT:** resurrect the graveyard: smart-extraction-router (ghost — old map wrongly calls it the entry), scrape-vehicle (undeployed; AddVehicle degrades to manual entry — do NOT wire `ingest` into the paste-debounce, it auto-mints before user intent is stated; ingest needs a preview mode first, see .claude/ISSUES.md 2026-07-12), complete-bat-import (undeployed, 404s), sync-bat-listing / unified-scraper-orchestrator / store-auction-listing (zombies), bat-simple-extract, extraction-quality-validator (ghost), import-classic-auction + extract-specialty-builder (routed but UNDEPLOYED — 404 traps). `bat_comments` table DOES NOT EXIST. Never mint a new per-source fn, queue, or sentiment/label column — extend the routed extractor. Never full-scan snapshots without an index (bat-snapshot-parser died scanning 367k rows/59GB). Don't trust inactive cron rows as evidence of life.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (column 2 is THE entrypoint; column 3 is the graveyard) and `docs/library/technical/extraction-playbook.md` (12 repeated mistakes, method catalog). Check `pipeline_registry` before writing any computed field, and `cron.job WHERE active=true` for what actually runs. If a capability seems missing, it almost certainly exists — search the ledger before minting anything.
