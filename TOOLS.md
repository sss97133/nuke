# Nuke Tool Registry

**Read this before building anything.** Every common operation has an existing tool.
Building a duplicate wastes compute, creates data forks, and breaks pipeline tracking.

---

## How to Use This Document

1. Find your intent in the table below → use the listed function
2. If your intent isn't here → check `supabase/functions/` before writing new code
3. If you're writing to a DB field → query `pipeline_registry` to see who owns it:
   ```sql
   SELECT * FROM pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';
   ```

---

## Vehicle Data Extraction

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract any listing URL (unknown source) | `extract-vehicle-data-ai` | Handles generic AI extraction |
| Extract Bring a Trailer listing | `bat-simple-extract` | Full BaT-specific parser |
| Extract Cars & Bids listing | `extract-cars-and-bids-core` | Handles C&B structure |
| Extract Hagerty Marketplace listing | `extract-hagerty-listing` | |
| Extract PCarMarket listing | `import-pcarmarket-listing` | |
| Extract Craigslist listing | `extract-craigslist` | |
| Extract eBay Motors listing | `extract-ebay-motors` | |
| Extract Facebook Marketplace listing | `extract-facebook-marketplace` or `fb-marketplace-orchestrator` | Use orchestrator for bulk |
| Extract Bonhams auction | `extract-bonhams` | |
| Extract RM Sotheby's | `extract-rmsothebys` | |
| Extract Mecum | `extract-mecum` | |
| Extract Gooding & Co | `extract-gooding` | |
| Extract Barrett-Jackson | `extract-barrett-jackson` | |
| Extract Collecting Cars | `extract-collecting-cars-core` | |
| Extract Broad Arrow | `extract-broad-arrow` | |
| Extract ClassicCars.com listing | `import-classiccars-listing` | |
| Extract Hagerty bidding platform | `extract-hagerty-listing` | |
| Route a URL to the right extractor | `smart-extraction-router` | Auto-detects source |
| Queue a URL for background extraction | `continuous-queue-processor` → `import_queue` | Insert to `import_queue`, worker picks it up |

---

## VIN Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Decode a VIN and update vehicle record | `decode-vin-and-update` | Calls NHTSA VPIC API, writes make/model/year/etc. |
| Decode VIN only (no DB write) | `api-v1-vin-lookup` | Returns decoded data |
| Batch decode VINs | `batch-vin-decode` | Processes multiple vehicles |
| Extract VIN from an image | `extract-vin-from-vehicle` | AI-powered OCR from photo |
| Find VIN conflicts | `vin-data-conflicts` table | Query directly |

---

## Vehicle Enrichment

| Intent | Use This | Notes |
|--------|----------|-------|
| Enrich a vehicle profile with AI | `enrich-vehicle-profile-ai` | General AI enrichment |
| Enrich factory specs (OEM data) | `enrich-factory-specs` | Writes OEM spec fields |
| Enrich MSRP | `enrich-msrp` | Writes `vehicles.msrp` |
| Batch enrich pending vehicles | `enrich-bulk` | Calls `enrich-vehicle-profile-ai` in bulk |
| Propagate YMM to related records | `batch-ymm-propagate` | Fixes missing year/make/model |
| Fix vehicle profile issues | `auto-fix-vehicle-profile` | Automated repair |

---

## Scoring & Valuation

| Intent | Use This | Writes To |
|--------|----------|-----------|
| Compute Nuke estimate (AI valuation) | `compute-vehicle-valuation` | `vehicles.nuke_estimate`, `vehicles.nuke_estimate_confidence` |
| Calculate performance/social scores | `calculate-vehicle-scores` | `vehicles.perf_*_score`, `vehicles.social_positioning_score`, `vehicles.investment_quality_score` |
| Assess market signals (deal/heat score) | `analyze-market-signals` | `vehicles.signal_score`, `vehicles.signal_reasons`, `vehicles.last_signal_assessed_at` |
| Calculate profile completeness | `calculate-profile-completeness` | `vehicles.completion_percentage`, `vehicles.data_quality_score` |
| Calculate quality scores | `calculate-vehicle-scores` or `calculate-profile-completeness` | `vehicles.quality_grade` |
| Get comps for a vehicle | `api-v1-comps` | Read-only — returns comparables |
| Get market trends | `api-v1-market-trends` | Read-only |

---

## Image Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| Process pending vehicle images (AI analysis) | `photo-pipeline-orchestrator` | Sets `ai_processing_status` |
| Batch process all pending images | `process-all-images-cron` | Cron-driven, calls pipeline orchestrator |
| Classify image angle/perspective | `yono-classify` | YONO local model, writes `vehicle_images.angle` |
| Batch YONO classification | `yono-batch-process` | Bulk angle detection |
| Auto-sort photos into categories | `auto-sort-photos` | Uses `vehicle_images.organization_status` |
| Sync photos from iPhoto library | `scripts/iphoto-intake.mjs` | See MEMORY.md for usage |
| Upload image and trigger analysis | `image-intake` | Handles upload + queues processing |
| Backfill image angles | `backfill-image-angles` | Retroactively adds angle data |
| Identify vehicle from image | `identify-vehicle-from-image` | AI-powered vehicle recognition |
| Validate image is a vehicle | `validate-vehicle-image` | Screening step |
| Reprocess stale images | `trickle-backfill-images` | Slow drip backfill |

---

## Comments & Sentiment Analysis

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract auction comments from BaT | `extract-auction-comments` | Scrapes BaT page, writes to `auction_comments` |
| Discover/analyze comment data with AI | `discover-comment-data` | Writes to `comment_discoveries` |
| Fast batch comment analysis | `analyze-comments-fast` | Batch version of discovery |
| Batch comment discovery | `batch-comment-discovery` | Parallel comment analysis |
| Update live sentiment | `update-live-sentiment` | Writes to `auction_sentiment_timeline` |

---

## Document Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| OCR a vehicle document | `document-ocr-worker` | Reads from `document_ocr_queue` |
| Queue a document for OCR | Insert to `document_ocr_queue` | Worker picks up automatically |
| Extract title/registration data | `extract-title-data` | Writes to `vehicle_title_documents` |
| Parse reference documentation | `parse-reference-document` | Service manuals, specs |
| Detect sensitive content in document | `detect-sensitive-document` | PII screening |

---

## Queue Management

| Intent | Use This | Notes |
|--------|----------|-------|
| Check overall pipeline health | `ralph-wiggum-rlm-extraction-coordinator` with `{"action":"brief"}` | Returns queue stats, errors, recommendations |
| Check queue status | `queue-status` | `import_queue` breakdown |
| View pipeline dashboard | `pipeline-dashboard` | Full system overview |
| Check database stats | `db-stats` | Vehicle/image/queue counts |
| Release stale locked records | `SELECT release_stale_locks()` | SQL function — releases locks older than 30 min |
| Check system health | `system-health-monitor` | |
| Monitor extraction health | `extraction-watchdog` | Alerts on failures |
| **Data quality report (all sources)** | `data-quality-monitor` with `{"action":"report"}` | Per-source YMM%, VIN%, price%, grade A-F |
| **Data quality alerts only** | `data-quality-monitor` with `{"action":"alerts"}` | Only sources with issues |
| **Snapshot quality metrics to DB** | `data-quality-monitor` with `{"action":"snapshot"}` | Writes to source_quality_snapshots (cron runs at 2am UTC) |
| **Query live quality view** | `SELECT * FROM source_quality_current` | Live per-source stats (slow on full table) |
| Process queued imports | `continuous-queue-processor` | **Don't call directly** — runs on cron |

---

## BaT-Specific Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Queue BaT listings for extraction | `crawl-bat-active` | Discovers active auctions |
| Process BaT extraction queue | `process-bat-extraction-queue` | Works `bat_extraction_queue` |
| Monitor a BaT seller | `bat-seller-monitors` table | Insert record to start monitoring |
| Monitor a BaT buyer | `bat-buyer-monitors` table | Insert record to start monitoring |
| Parse BaT snapshot HTML | `bat-snapshot-parser` | Parses archived BaT pages |
| Complete BaT import | `complete-bat-import` | Final step after extraction |

---

## Organizations

| Intent | Use This | Notes |
|--------|----------|-------|
| Create org from URL | `create-org-from-url` | Scrapes site, creates `organizations` record |
| Update org from website | `update-org-from-website` | Refreshes org data |
| Classify organization type | `classify-organization-type` | Sets `organizations.type` |
| Get org due diligence | `generate-org-due-diligence` | AI analysis report |
| Merge duplicate orgs | `auto-merge-duplicate-orgs` | Deduplication |

---

## Discovery & Lead Generation

| Intent | Use This | Notes |
|--------|----------|-------|
| Discover vehicles from a source URL | `discover-from-observations` | Source-agnostic |
| Discover squarebody Craigslist listings | `discover-cl-squarebodies` | Regional CL scanner |
| Discover barn finds | `barn-finds-discovery` | Monitors barn find sources |
| Discover build threads | `discover-build-threads` | Forum build thread finder |
| Recursive lead discovery | `discovery-snowball` | Follows discovery chains |

---

## Search & Lookup

| Intent | Use This | Notes |
|--------|----------|-------|
| Search vehicles, orgs, users, tags | `universal-search` | Magic input handler with thumbnails |
| API vehicle search | `api-v1-search` | REST API endpoint |
| Get vehicle history | `api-v1-vehicle-history` | Historical data |
| Get auction data | `api-v1-vehicle-auction` | Auction-specific fields |
| Get observations for a vehicle | `api-v1-observations` | All source observations |

---

## YONO (Local Vision Model)

| Intent | Use This | Notes |
|--------|----------|-------|
| Classify a single image | `yono-classify` | POST `{image_url}` → returns make/model/year/angle |
| Batch classify images | `yono-batch-process` | Bulk version |
| Export training data | `export-training-batch` | Prepares training dataset |
| See YONO state | `yono.md` | Full technical reference |

---

## DO NOT BUILD THESE — They Already Exist

These are the most common "agent reimplementation" antipatterns. If you find yourself writing any of these, stop and use the existing tool.

| What you're about to build | What to use instead |
|---------------------------|---------------------|
| A VIN decoder | `decode-vin-and-update` |
| A fetch wrapper that saves pages | `_shared/archiveFetch.ts` — use `archiveFetch()` |
| An image AI analyzer | `photo-pipeline-orchestrator` |
| A queue poller | `continuous-queue-processor` — insert to queue, don't poll |
| A "get vehicle data" endpoint | `api-v1-vehicles` |
| A duplicate detector | `duplicate-detection-jobs` table + `auto-merge-duplicate-orgs` |
| A vehicle valuation calculator | `compute-vehicle-valuation` |
| A comment sentiment analyzer | `discover-comment-data` |
| A search endpoint | `universal-search` |
| A BaT scraper | `bat-simple-extract` |
| A Craigslist scraper | `extract-craigslist` or `discover-cl-squarebodies` |
| A Facebook scraper | `extract-facebook-marketplace` |
| A market trend calculator | `calculate-market-trends` |

---

## Key Shared Utilities (`supabase/functions/_shared/`)

Always import from these rather than reimplementing:

| File | Purpose |
|------|---------|
| `archiveFetch.ts` | Fetch any URL + auto-archive to `listing_page_snapshots` |
| `cors.ts` | CORS headers |
| `supabaseClient.ts` | Supabase client factory |
| `hybridFetcher.ts` | **Deprecated** — use `archiveFetch.ts` instead |

---

## Pipeline Ownership Quick Reference

Query the `pipeline_registry` table for authoritative field ownership:

```sql
-- Who owns a field?
SELECT owned_by, description, do_not_write_directly
FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';

-- What does a function write?
SELECT table_name, column_name, description
FROM pipeline_registry
WHERE owned_by = 'compute-vehicle-valuation';

-- All fields agents should not write directly
SELECT table_name, column_name, owned_by
FROM pipeline_registry
WHERE do_not_write_directly = true
ORDER BY table_name, column_name;
```

---

## Queue Insert Patterns

### Add a URL to the extraction queue
```sql
INSERT INTO import_queue (listing_url, listing_title, status, priority)
VALUES ('https://bringatrailer.com/listing/...', 'Optional Title', 'pending', 100);
```

### Add a document for OCR
```sql
INSERT INTO document_ocr_queue (storage_path, status, priority, document_type)
VALUES ('vehicle-docs/abc123.pdf', 'pending', 50, 'title');
```

### Check queue depth
```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c \
  'curl -s "$VITE_SUPABASE_URL/functions/v1/queue-status" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

---

## Operational Notes

- **Never write `ai_processing_status`, `signal_score`, `nuke_estimate`, `deal_score`, or `heat_score` directly.** These are computed fields owned by specific pipeline functions.
- **Never change `locked_by` / `locked_at` on queue tables.** The lock mechanism is managed by queue workers; breaking it causes duplicate processing.
- **Check `ACTIVE_AGENTS.md`** before touching any edge function file — another agent may be mid-deployment.
- **Always use `archiveFetch()`** for fetching external URLs — never raw `fetch()`.
