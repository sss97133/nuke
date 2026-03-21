# Data Flow

## From URL to Structured Database Record

This document traces every path that data takes through the Nuke system, from the moment a URL enters the platform to the moment structured vehicle data is written to the database. Every function, every table, every decision point is documented.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Entry Points](#2-entry-points)
3. [The Import Queue](#3-the-import-queue)
4. [Domain Routing](#4-domain-routing)
5. [The Archive-First Fetch Strategy](#5-the-archive-first-fetch-strategy)
6. [Platform-Specific Extraction Flows](#6-platform-specific-extraction-flows)
7. [Generic AI Extraction Flow](#7-generic-ai-extraction-flow)
8. [The Quality Gate](#8-the-quality-gate)
9. [The Tetris Write Layer](#9-the-tetris-write-layer)
10. [Vehicle Resolution](#10-vehicle-resolution)
11. [Post-Extraction Flows](#11-post-extraction-flows)
12. [Deduplication](#12-deduplication)
13. [The Observation Intake Flow](#13-the-observation-intake-flow)
14. [Error Handling and Retry Logic](#14-error-handling-and-retry-logic)
15. [Complete Flow Diagram](#15-complete-flow-diagram)

---

## 1. System Overview

The Nuke data pipeline has one job: turn URLs into structured vehicle records with full provenance. The pipeline is designed around three principles:

1. **Archive first.** Every page fetched is stored in `listing_page_snapshots` before extraction. Re-extraction never requires re-fetching.
2. **Quality gate everything.** No data enters the `vehicles` table without passing validation checks for identity fields, price sanity, HTML contamination, and field pollution.
3. **Provenance on every field.** Every field written to `vehicles` gets a receipt in `extraction_metadata` recording what extracted it, when, from where, and with what confidence.

The pipeline processes approximately 18,000 vehicles from 20+ auction and marketplace platforms. The primary data sources are Bring a Trailer (BaT), Cars & Bids, Mecum, Barrett-Jackson, Bonhams, RM Sotheby's, Gooding, PCarMarket, Craigslist, Facebook Marketplace, and several specialty builders.

### High-Level Flow

```
                          +------------------+
                          |  ENTRY POINTS    |
                          |  - User URL      |
                          |  - Crawler       |
                          |  - Cron scraper  |
                          |  - API call      |
                          +--------+---------+
                                   |
                                   v
                          +------------------+
                          |  import_queue    |
                          |  (pending)       |
                          +--------+---------+
                                   |
                            claim_import_
                            queue_batch()
                                   |
                                   v
                     +-------------+-------------+
                     |  process-import-queue      |
                     |  (domain router)           |
                     +-------------+-------------+
                                   |
                    +--------------+--------------+
                    |              |              |
                    v              v              v
              [BaT flow]    [C&B flow]    [Generic AI]
              extract-      extract-       extract-
              bat-core      cars-and-      vehicle-
                            bids-core      data-ai
                    |              |              |
                    +--------------+--------------+
                                   |
                                   v
                          +------------------+
                          |  Quality Gate    |
                          |  (validate)      |
                          +--------+---------+
                                   |
                          +--------+---------+
                          |  pass  | reject  |
                          |        |         |
                          v        v         v
                     [vehicles]  [quarantine] [failed]
                     [vehicle_   [bat_        [import_
                      events]    quarantine]   queue
                     [vehicle_                 status=
                      images]                  failed]
```

---

## 2. Entry Points

Data enters the Nuke system through several paths, all of which converge on the `import_queue` table.

### 2.1 Direct URL Submission

A user pastes a URL into the frontend or sends it via the API. The URL is inserted into `import_queue` with `status='pending'`.

```
User/API --> POST /functions/v1/universal-search
         --> INSERT INTO import_queue (listing_url, status='pending')
```

### 2.2 Automated Crawlers

Cron-triggered edge functions crawl known platforms and discover new listings. Each crawler writes discovered URLs to `import_queue`.

| Crawler | Platform | Cron Frequency | What It Discovers |
|---------|----------|---------------|-------------------|
| `crawl-bat-active` | BaT | 15 min | Active auctions on BaT front page |
| `cab-fast-discover` | Cars & Bids | 30 min | New C&B listings |
| `mecum-fast-discover` | Mecum | 30 min | New Mecum lots |
| `hagerty-fast-discover` | Hagerty | 60 min | New Hagerty marketplace listings |
| `hemmings-fast-discover` | Hemmings | 60 min | New Hemmings listings |
| `pcarmarket-fast-discover` | PCarMarket | 60 min | New PCarMarket auctions |

Each crawler follows the same pattern:
1. Fetch the platform's listing index page
2. Parse listing URLs from the index
3. Check each URL against `import_queue.listing_url` (UNIQUE constraint prevents duplicates)
4. Insert new URLs with appropriate `priority` and `source_id`

### 2.3 Facebook Marketplace Scraper

The FB Marketplace scraper (`scripts/fb-marketplace-local-scraper.mjs`) uses a different path. It queries the logged-out GraphQL API (`doc_id=33269364996041474`) across 55 US metros, filters for vintage vehicles, and batch-upserts directly into `import_queue`.

```
fb-marketplace-local-scraper.mjs
  |
  +--> POST /api/graphql/ (doc_id=33269364996041474)
  |    55 metros, 24 results per page, paginated
  |
  +--> Filter: title matches vintage pattern (year < 2000)
  |
  +--> Batch INSERT INTO import_queue
       (listing_url, listing_title, listing_price, listing_year,
        listing_make, listing_model, thumbnail_url, source_id)
```

### 2.4 iPhoto Intake

Local photos from the user's Apple Photos library enter through `scripts/iphoto-intake.mjs`, which uses the `osxphotos` CLI to export photos and upload them directly to `vehicle-photos` storage bucket and insert into `vehicle_images`. This path bypasses `import_queue` entirely.

```
iphoto-intake.mjs
  |
  +--> osxphotos CLI (export from Photos.app)
  |
  +--> Upload to Supabase Storage (vehicle-photos bucket)
  |
  +--> INSERT INTO vehicle_images
       (vehicle_id, url, source='iphoto')
```

### 2.5 Observation Intake

The newer observation architecture provides a separate entry point via `ingest-observation`. This is described fully in [observation-system.md](./observation-system.md). Observations do not pass through `import_queue`; they write directly to `vehicle_observations`.

---

## 3. The Import Queue

The `import_queue` table is the central intake buffer for all URL-based data. It acts as a job queue with locking, backoff, and priority scheduling.

### 3.1 Schema

```
import_queue
+-------------------+-------------+----------------------------------------+
| Column            | Type        | Purpose                                |
+-------------------+-------------+----------------------------------------+
| id                | UUID PK     | Unique job identifier                  |
| listing_url       | TEXT UNIQUE | Dedup key: canonical listing URL       |
| source_id         | UUID FK     | -> observation_sources.id              |
| listing_title     | TEXT        | Hint for prioritization + UI           |
| listing_price     | NUMERIC     | Hint for prioritization                |
| listing_year      | INTEGER     | Hint: extracted or discovered year     |
| listing_make      | TEXT        | Hint: extracted or discovered make     |
| listing_model     | TEXT        | Hint: extracted or discovered model    |
| thumbnail_url     | TEXT        | Preview image URL                      |
| status            | TEXT        | pending/processing/complete/failed/    |
|                   |             | skipped/duplicate                      |
| attempts          | INTEGER     | Number of processing attempts          |
| priority          | INTEGER     | Higher = processed first               |
| vehicle_id        | UUID FK     | -> vehicles.id (set on success)        |
| processed_at      | TIMESTAMPTZ | When processing completed              |
| error_message     | TEXT        | Last error message                     |
| raw_data          | JSONB       | Scrape payload, extraction metadata,   |
|                   |             | haiku results, escalation reasons      |
| next_attempt_at   | TIMESTAMPTZ | Backoff: when to retry                 |
| locked_at         | TIMESTAMPTZ | When a worker claimed this job         |
| locked_by         | TEXT        | Worker ID that holds the lock          |
| last_attempt_at   | TIMESTAMPTZ | When last attempt started              |
| created_at        | TIMESTAMPTZ | Row creation time                      |
| updated_at        | TIMESTAMPTZ | Last modification time                 |
+-------------------+-------------+----------------------------------------+
```

### 3.2 State Machine

```
                    +----------+
           insert   |          |
          -------->| pending  |<------+
                    |          |       |
                    +----+-----+       |
                         |             |
                  claim_import_   retry (transient
                  queue_batch()   error, attempts
                         |        < max)
                         v             |
                    +----------+       |
                    |          |       |
                    |processing+-------+
                    |          |
                    +----+-----+
                         |
              +----------+----------+----------+
              |          |          |          |
              v          v          v          v
         +--------+ +--------+ +--------+ +--------+
         |complete| | failed | |skipped | |pending |
         |        | |        | |        | |_review |
         +--------+ +--------+ +--------+ +--------+
```

### 3.3 Claim Mechanism

The `claim_import_queue_batch()` RPC function provides atomic, concurrent-safe job claiming:

```sql
claim_import_queue_batch(
  p_batch_size    INTEGER DEFAULT 20,
  p_max_attempts  INTEGER DEFAULT 3,
  p_priority_only BOOLEAN DEFAULT FALSE,
  p_source_id     UUID    DEFAULT NULL,
  p_worker_id     TEXT    DEFAULT NULL,
  p_lock_ttl_seconds INTEGER DEFAULT 900
)
```

This function:
1. Selects candidate rows: `status='pending'`, `attempts < max`, `next_attempt_at <= now()`, not locked (or lock expired)
2. Orders by: `priority DESC`, `listing_year DESC NULLS LAST`, `created_at ASC`
3. Uses `FOR UPDATE SKIP LOCKED` to prevent concurrent workers from claiming the same row
4. Atomically sets `status='processing'`, increments `attempts`, sets `locked_at` and `locked_by`
5. Returns the claimed rows

The lock TTL defaults to 900 seconds (15 minutes). The hourly stale lock release cron (`release_stale_locks()`) cleans up any locks older than 30 minutes.

### 3.4 Indexes

```
idx_import_queue_status_priority  ON (status, priority DESC, created_at ASC)
idx_import_queue_next_attempt     ON (status, next_attempt_at, created_at)
idx_import_queue_locked_at        ON (locked_at)
idx_import_queue_source           ON (source_id)
```

---

## 4. Domain Routing

Once items are claimed from `import_queue`, the `process-import-queue` edge function routes each URL to the appropriate platform-specific extractor.

### 4.1 The Router (`process-import-queue/index.ts`)

The function normalizes the URL (strips protocol, www, trailing slash, query/hash) using `normalizeListingUrlKey()`, then checks the URL against a chain of domain patterns:

```
URL normalization
       |
       v
  +----+--------------------------------------------+
  | Domain pattern           | Extractor function   |
  +---------------------------+---------------------+
  | bringatrailer.com         | complete-bat-import |
  | carsandbids.com           | extract-cars-and-   |
  |                           | bids-core           |
  | pcarmarket.com            | import-pcarmarket-  |
  |                           | listing             |
  | hagerty.com               | extract-hagerty-    |
  |                           | listing             |
  | classic.com               | import-classic-     |
  |                           | auction             |
  | collectingcars.com        | extract-vehicle-    |
  |                           | data-ai             |
  | barnfinds.com             | extract-barn-finds- |
  |                           | listing             |
  | craigslist.org            | extract-craigslist  |
  | mecum.com                 | extract-mecum       |
  | barrett-jackson.com       | extract-barrett-    |
  |                           | jackson             |
  | broadarrowauctions.com    | extract-broad-arrow |
  | gaaclassiccars.com        | extract-gaa-        |
  |                           | classics            |
  | bhauction.com             | extract-bh-auction  |
  | bonhams.com               | extract-bonhams     |
  | rmsothebys.com            | extract-rmsothebys  |
  | goodingco.com             | extract-gooding     |
  | velocityrestorations.com, | extract-specialty-  |
  | coolnvintage.com,         | builder             |
  | brabus.com, icon4x4.com,  |                     |
  | ringbrothers.com          |                     |
  | vanguardmotorsales.com    | extract-vehicle-    |
  |                           | data-ai             |
  | exclusivecarregistry.com  | extract-vehicle-    |
  | /details/                 | data-ai             |
  | (everything else)         | extract-vehicle-    |
  |                           | data-ai             |
  +---------------------------+---------------------+
```

Each extractor is called via HTTP POST with `{ url, save_to_db: true }` and a 120-second timeout.

### 4.2 The Select-Processor Alternative

There is also a more sophisticated routing system in `_shared/select-processor.ts` that considers source metadata and raw_data fields. This is used by some orchestrators but `process-import-queue` primarily uses the simpler URL-pattern approach.

The `selectProcessor()` function returns a `ProcessorSelection` with:
- `functionName`: which edge function to call
- `parameters`: function-specific arguments
- `reason`: human-readable routing explanation
- `priority`: for ordering when multiple items are batched

---

## 5. The Archive-First Fetch Strategy

Before any extractor touches a URL, the page HTML is archived. This is the single most important architectural decision in the pipeline.

### 5.1 `archiveFetch()` (`_shared/archiveFetch.ts`)

Every external page fetch must go through `archiveFetch()`. It implements a three-step process:

```
archiveFetch(url, options)
       |
       v
  Step 1: CHECK CACHE
  +-------------------------------------------+
  | Query listing_page_snapshots              |
  |   WHERE listing_url = url                 |
  |     AND success = true                    |
  |     AND fetched_at >= (now - maxAgeSec)   |
  |   ORDER BY fetched_at DESC LIMIT 1       |
  |                                           |
  | Prefer snapshots matching fetch_method    |
  | (firecrawl vs direct) to avoid type       |
  | mismatch.                                 |
  |                                           |
  | If cached HTML found: RETURN immediately  |
  | (source='cache', cached=true)             |
  +-------------------------------------------+
       |
       | (cache miss)
       v
  Step 2: FETCH THE PAGE
  +-------------------------------------------+
  | Platform detection (auto from URL):       |
  |                                           |
  | BaT URLs:                                 |
  |   -> fetchBatPage() from batFetcher.ts    |
  |   -> Direct fetch with UA rotation        |
  |   -> Anti-bot detection (login redirect,  |
  |      Cloudflare, access denied)           |
  |                                           |
  | JS-rendered sites (C&B, CollectingCars,   |
  |   PCarMarket):                            |
  |   -> firecrawlScrape() from firecrawl.ts  |
  |   -> Returns HTML + markdown              |
  |   -> ~$0.01 per scrape                    |
  |                                           |
  | All other sites:                          |
  |   -> fetchPage() from hybridFetcher.ts    |
  |   -> Direct fetch with retries            |
  +-------------------------------------------+
       |
       v
  Step 3: ARCHIVE TO listing_page_snapshots
  +-------------------------------------------+
  | INSERT INTO listing_page_snapshots:       |
  |   platform, listing_url, fetched_at,      |
  |   fetch_method, http_status, success,     |
  |   error_message, html, markdown,          |
  |   html_sha256, content_length, metadata   |
  |                                           |
  | Garbage detection: Cloudflare challenge,  |
  |   bare React shells, access denied pages  |
  |   are archived as success=false so cache  |
  |   lookups don't return them.              |
  |                                           |
  | Duplicate detection: 23505 (unique        |
  |   constraint) is silently ignored --      |
  |   content hasn't changed.                 |
  +-------------------------------------------+
       |
       v
  RETURN ArchiveFetchResult
  {html, markdown, source, cached, snapshotId,
   url, platform, statusCode, error, costCents}
```

### 5.2 `readArchivedPage()`

For re-extraction passes (when you want to extract more fields from an already-fetched page), use `readArchivedPage()` instead of `archiveFetch()`. It reads from `listing_page_snapshots` without ever touching the external network.

### 5.3 Storage Migration

Large HTML snapshots may be migrated from inline Postgres storage to Supabase Storage (`listing-snapshots` bucket). The archive functions transparently handle both:
- If `html` column is populated: use it directly
- If `html_storage_path` is populated: download from storage bucket

### 5.4 Platform Detection

`detectPlatform()` maps URLs to platform slugs:

```
bringatrailer.com  -> bat
carsandbids.com    -> carsandbids
hagerty.com        -> hagerty
pcarmarket.com     -> pcarmarket
collectingcars.com -> collectingcars
rmsothebys.com     -> rmsothebys
mecum.com          -> mecum
bonhams.com        -> bonhams
ebay.com           -> ebay
craigslist.org     -> craigslist
facebook.com/marketplace -> facebook
(fallback)         -> hostname first segment
```

### 5.5 Firecrawl Requirement Detection

`needsFirecrawl()` identifies sites that are JavaScript SPAs requiring browser rendering:

```
carsandbids.com    -> true (React SPA)
collectingcars.com -> true (Next.js)
pcarmarket.com     -> true (React SPA)
(all others)       -> false (direct fetch OK)
```

---

## 6. Platform-Specific Extraction Flows

### 6.1 BaT Flow (`extract-bat-core`)

BaT is the primary data source (141K vehicles, 11.5M comments, 30M images). Its extractor is the most sophisticated.

```
extract-bat-core (v3.0.0)
       |
       v
  1. FETCH HTML
     fetchHtmlDirect(url)
     - Random UA rotation (5 user agents)
     - 200-700ms random jitter delay
     - Manual redirect detection (login = rate limited)
     - Cloudflare challenge detection
     - Login page detection
     - Minimum 1000 chars validation
       |
       v
  2. SAVE HTML SNAPSHOT
     trySaveHtmlSnapshot() -> listing_page_snapshots
     - SHA-256 hash of HTML
     - Non-fatal (never blocks extraction)
       |
       v
  3. EXTRACT IDENTITY
     extractTitleIdentity(html, url)
     - Parse <h1 class="post-title">
     - Parse <meta property="og:title">
     - Parse <title>
     - Clean BaT suffixes ("for sale on BaT Auctions...")
     - Fallback: parse from URL slug (/listing/YEAR-MAKE-MODEL/)
     - Multi-word make detection (Alfa Romeo, Mercedes-Benz, etc.)
       |
       v
  4. EXTRACT ESSENTIALS
     extractEssentials(html)
     - Seller username (from essentials block)
     - Buyer username (from stats table: "Sold to <user>")
     - Location
     - Lot number
     - Listing category
     - VIN
     - Mileage
     - Exterior/interior color
     - Transmission, drivetrain, engine, body style
     - Reserve status (no_reserve / reserve_met / reserve_not_met)
     - Auction end date (from data-ends timestamp)
     - Bid/comment/view/watcher counts
     - Sale price (from listing stats table: Sold/Winning Bid rows)
     - High bid (from High Bid/Current Bid rows)

     CRITICAL: Essentials extraction is limited to a 50KB window
     starting from the essentials div to prevent comment pollution.
       |
       v
  5. EXTRACT DESCRIPTION
     - Full listing description text
     - Gallery image URLs (normalized: strip -scaled, strip dimensions)
       |
       v
  6. NORMALIZE
     normalizeVehicleFields(data)
     - Make normalization (aliases -> canonical)
     - Model validation (reject if > 80 chars or auction junk)
     - VIN uppercase + validation
     - Transmission normalization
     - Drivetrain normalization
     - Color normalization
     - Source normalization
       |
       v
  7. QUALITY GATE
     qualityGate(data, {source: 'bat', sourceType: 'auction'})
     - Identity check (year/make/model)
     - HTML contamination check
     - Pollution detection
     - VIN checksum validation
     - Price sanity (era-based bounds)
     - Cross-field consistency
     - Spec completeness

     score < 0.2 -> REJECT (quarantine)
     score < 0.5 -> FLAG FOR REVIEW
     score >= 0.5 -> UPSERT
       |
       v
  8. VEHICLE RESOLUTION
     resolveExistingVehicleId()
     - By vehicle_events (source_platform + source_listing_id)
     - By vehicles.discovery_url exact match
     - By vehicles.discovery_url ILIKE pattern match

     Found -> UPDATE existing vehicle
     Not found -> INSERT new vehicle
       |
       v
  9. TETRIS WRITE LAYER
     batchUpsertWithProvenance()
     For each field:
       NULL in DB -> GAP FILL (write + receipt)
       Same value -> CONFIRMATION (receipt only)
       Different  -> CONFLICT (quarantine, don't overwrite)
       |
       v
  10. WRITE VEHICLE EVENTS + AUCTION EVENTS
      Upsert into vehicle_events and auction_events
      with sale results, bid counts, end dates
       |
       v
  11. WRITE VEHICLE IMAGES
      Batch insert gallery image URLs into vehicle_images
      (deduplicated by URL)
```

### 6.2 Cars & Bids Flow

```
extract-cars-and-bids-core
       |
       v
  1. archiveFetch(url, {platform:'carsandbids', useFirecrawl:true})
     (C&B is a React SPA -- requires Firecrawl)
       |
       v
  2. Parse structured data from rendered HTML
     - Title, year, make, model
     - Price, reserve status
     - Specs (VIN, mileage, transmission, etc.)
     - Images
       |
       v
  3. qualityGate() -> normalize -> resolveVehicle -> upsert
```

### 6.3 Other Platform Flows

All other platform-specific extractors follow the same general pattern:
1. Fetch (via `archiveFetch` or direct)
2. Platform-specific HTML parsing (regex, DOM patterns)
3. Normalize fields
4. Quality gate
5. Resolve vehicle
6. Upsert with provenance

---

## 7. Generic AI Extraction Flow

When no platform-specific extractor exists, `extract-vehicle-data-ai` is used as the universal fallback.

```
extract-vehicle-data-ai
       |
       v
  1. archiveFetch(url)
     - Auto-detects platform
     - Auto-selects direct vs Firecrawl
       |
       v
  2. Prepare content for LLM
     - Prefer markdown if available
     - Truncate to fit context window
       |
       v
  3. Call Haiku tier
     callTier('haiku', LISTING_EXTRACTION_SYSTEM, content)
     - System prompt: extract year/make/model/vin/mileage/colors/
       engine/transmission/drivetrain/body_style/title/prices/
       seller/description/images/confidence
     - Returns structured JSON
       |
       v
  4. Parse JSON response
     parseJsonResponse()
     - Try raw JSON.parse()
     - Try markdown code block extraction
     - Try { ... } / [ ... ] extraction
       |
       v
  5. Assess quality
     assessQuality(parsed)
     - Count non-null key fields (15 total)
     - Validate VIN length, year range, mileage sign, price sign
     - Check for year/make/model presence
     - Score = (1 - null_ratio) + bonuses - penalties
       |
       v
  6. Escalation decision
     score < 0.6 -> escalate to Sonnet
     no YMM      -> escalate to Sonnet
     confidence < 0.8 -> escalate to Sonnet
       |
       v
  7. normalizeVehicleFields() + qualityGate()
       |
       v
  8. Upsert to vehicles + vehicle_events + vehicle_images
```

---

## 8. The Quality Gate

The quality gate (`_shared/extractionQualityGate.ts`) is the mandatory checkpoint before any data enters the `vehicles` table. Every extractor must call `qualityGate()` before writing.

### 8.1 Checks Performed

```
+----+-----------------------------+---------+----------------------------+
| #  | Check                       | Weight  | What it validates          |
+----+-----------------------------+---------+----------------------------+
| 1  | Identity fields             | 40%     | year (1885-current+2),     |
|    |                             |         | make (not polluted),       |
|    |                             |         | model (not polluted,       |
|    |                             |         | < 80 chars)                |
+----+-----------------------------+---------+----------------------------+
| 2  | HTML contamination          | 10%     | No HTML tags in text       |
|    |                             | (penalty)| fields: description,      |
|    |                             |         | colors, transmission,      |
|    |                             |         | engine, body_style, etc.   |
+----+-----------------------------+---------+----------------------------+
| 3  | Field pollution             | 10%     | No auction metadata in     |
|    |                             | (penalty)| spec fields (e.g. "for    |
|    |                             |         | sale on BaT Auctions" in   |
|    |                             |         | model field)               |
+----+-----------------------------+---------+----------------------------+
| 3b | Make canonicalization       | (side   | Normalize "Chevy" ->       |
|    |                             | effect) | "Chevrolet", etc.          |
+----+-----------------------------+---------+----------------------------+
| 3c | Field normalization         | (side   | normalizeVehicleFields()   |
|    |                             | effect) | on all applicable fields   |
+----+-----------------------------+---------+----------------------------+
| 3d | VIN checksum                | (flag)  | MOD11 checksum for post-   |
|    |                             |         | 1981 VINs. No I/O/Q.      |
|    |                             |         | Pre-1981: 6-13 chars OK    |
+----+-----------------------------+---------+----------------------------+
| 4  | Description presence        | 20%     | Has description > 20 chars |
+----+-----------------------------+---------+----------------------------+
| 5  | Price sanity                | 10%     | Era-based bounds:          |
|    |                             |         | 2020+: $500 - $5M          |
|    |                             |         | 2000+: $200 - $5M          |
|    |                             |         | 1970+: $100 - $20M         |
|    |                             |         | 1950+: $100 - $50M         |
|    |                             |         | 1920+: $50 - $100M         |
|    |                             |         | pre-1920: $50 - $100M      |
+----+-----------------------------+---------+----------------------------+
| 5b | Cross-field consistency     | (flag)  | reserve_not_met + sale_    |
|    |                             |         | price > 0 = conflict       |
|    |                             |         | year < 1950 + mileage >    |
|    |                             |         | 500K = suspicious          |
+----+-----------------------------+---------+----------------------------+
| 6  | Spec completeness           | 20%     | Weighted presence of:      |
|    |                             |         | VIN(1), mileage(1),        |
|    |                             |         | transmission(0.5),         |
|    |                             |         | engine(0.5), colors(0.3),  |
|    |                             |         | drivetrain(0.3),           |
|    |                             |         | body_style(0.3)            |
+----+-----------------------------+---------+----------------------------+
```

### 8.2 Score Calculation

```
score = identity_pct * 0.40
      + description_pct * 0.20
      + specs_pct * 0.20
      + price_pct * 0.10
      + cleanliness_pct * 0.10

where:
  identity_pct = (valid_year + valid_make + valid_model) / 3
  description_pct = 1 if description > 20 chars, else 0
  specs_pct = weighted_present_specs / weighted_total_specs
  price_pct = 1 if price in valid range, 0.5 if atypical, 0 otherwise
  cleanliness_pct = max(0, 1 - html_contamination*0.15 - polluted_fields*0.1)
```

### 8.3 Action Determination

```
score < 0.2 (rejectThreshold)  --> action = "reject"
score < 0.5 (reviewThreshold)  --> action = "flag_for_review"
score >= 0.5                   --> action = "upsert"

HARD REJECT: identityScore == 0 --> always reject (no year, no make, no model)
```

### 8.4 Cleaning

When `action != "reject"`, the quality gate also returns a cleaned copy of the data:
- HTML stripped from text fields
- Polluted fields nulled
- Make canonicalized
- All fields normalized via `normalizeVehicleFields()`
- Invalid VINs nulled

---

## 9. The Tetris Write Layer

The Tetris write layer (`_shared/batUpsertWithProvenance.ts`) ensures that no extraction ever overwrites existing data without justification. Every field write follows one of three paths:

### 9.1 The Three Actions

```
For each field in proposed extraction:
  |
  +-- existing is NULL
  |     |
  |     v
  |   GAP FILL
  |   - Write proposed value to vehicles table
  |   - Write *_source column with extraction version
  |   - Write receipt to extraction_metadata
  |   - Status: "unvalidated"
  |
  +-- existing == proposed
  |     |
  |     v
  |   CONFIRMATION
  |   - Do NOT overwrite (value already correct)
  |   - Write receipt to extraction_metadata
  |   - Status: "confirmed"
  |
  +-- existing != proposed
        |
        v
      CONFLICT
      - Do NOT overwrite (existing value preserved)
      - Write quarantine row to bat_quarantine
      - Write receipt to extraction_metadata
      - Status: "conflicting"
```

### 9.2 Extraction Metadata Receipt

Every field-level write creates a receipt in `extraction_metadata`:

```
extraction_metadata
+--------------------+-------------+-------------------------------+
| Column             | Type        | Purpose                       |
+--------------------+-------------+-------------------------------+
| vehicle_id         | UUID FK     | Which vehicle                 |
| field_name         | TEXT        | Which field (e.g. "make")     |
| field_value        | TEXT        | What value was extracted       |
| extraction_method  | TEXT        | regex/table_parse/html_match/ |
|                    |             | url_slug/json_ld/etc.         |
| scraper_version    | TEXT        | e.g. "extract-bat-core:3.0.0" |
| source_url         | TEXT        | Which listing URL             |
| confidence_score   | DECIMAL     | 0-1 extraction confidence     |
| validation_status  | TEXT        | unvalidated/confirmed/        |
|                    |             | conflicting                   |
| extracted_at       | TIMESTAMPTZ | When extraction happened       |
| raw_extraction_data| JSONB       | Additional context (signal,   |
|                    |             | tetris version, etc.)         |
+--------------------+-------------+-------------------------------+
```

### 9.3 Quarantine

Conflicting values are written to `bat_quarantine` for human review:

```
bat_quarantine
+--------------------+-------------+-------------------------------+
| vehicle_id         | UUID FK     | Which vehicle                 |
| listing_url        | TEXT        | Source of conflict             |
| field_name         | TEXT        | Which field conflicts          |
| existing_value     | TEXT        | Current value in DB            |
| proposed_value     | TEXT        | New value from extraction      |
| extraction_version | TEXT        | Which extractor proposed it    |
| quality_score      | DECIMAL     | Extraction confidence          |
| issues             | TEXT[]      | Array of issue descriptions    |
+--------------------+-------------+-------------------------------+
```

### 9.4 Source Columns

The `vehicles` table has `*_source` columns that track which extractor last set each identity field:

```
make_source, model_source, year_source, vin_source,
mileage_source, color_source, transmission_source,
engine_source, description_source, series_source,
trim_source, msrp_source, listing_location_source,
platform_source
```

These are set automatically by the Tetris layer during GAP FILL operations.

---

## 10. Vehicle Resolution

Before writing to the `vehicles` table, extractors must determine whether the extracted data matches an existing vehicle or requires a new record. This is handled by `resolveExistingVehicleId()` (`_shared/resolveVehicleForListing.ts`).

### 10.1 Resolution Cascade

```
resolveExistingVehicleId(supabase, {url, platform, discoveryUrlIlikePattern})
  |
  +-- Step 1: vehicle_events match
  |   SELECT vehicle_id FROM vehicle_events
  |   WHERE source_platform = platform
  |     AND source_listing_id = normalizeListingUrlKey(url)
  |
  |   Confidence: HIGHEST (same listing was processed before)
  |
  +-- Step 2: discovery_url exact match
  |   SELECT id FROM vehicles
  |   WHERE discovery_url = url
  |
  |   Confidence: HIGH
  |
  +-- Step 3: discovery_url pattern match (ILIKE)
      SELECT id FROM vehicles
      WHERE discovery_url ILIKE '%domain.com/path/slug%'
      LIMIT 1

      Confidence: MEDIUM
      NOTE: Leading % prevents btree index usage.
      Wrapped in try/catch with timeout to avoid blocking.
```

If no match is found, the extractor creates a new vehicle record.

### 10.2 URL Normalization

`normalizeListingUrlKey()` from `_shared/listingUrl.ts` creates a canonical URL key by stripping protocol, www, trailing slashes, query parameters, and hash fragments. This ensures that `https://www.bringatrailer.com/listing/1967-porsche-911/` and `https://bringatrailer.com/listing/1967-porsche-911` resolve to the same key.

---

## 11. Post-Extraction Flows

After a vehicle is extracted and written to the database, several downstream processes may fire.

### 11.1 Comment Extraction

For auction platforms, comments/bids are extracted separately:

```
Vehicle extracted (vehicle_events row created)
       |
       v
  extract-auction-comments
  (separate cron or manual trigger)
       |
       v
  Fetch listing page (from archive or fresh)
       |
       v
  Parse comments: username, text, posted_at, is_bid, bid_amount
       |
       v
  INSERT INTO auction_comments
  (vehicle_id, comment_text, username, posted_at, is_bid, bid_amount)
```

### 11.2 AI Analysis

The `analysis-engine-coordinator` is triggered (fire-and-forget) when new observations are ingested:

```
ingest-observation (after insert)
       |
       ==> analysis-engine-coordinator
           {action: "observation_trigger",
            vehicle_id, observation_kind}
```

### 11.3 Image Pipeline

Vehicle images enter a separate processing pipeline:

```
vehicle_images (new row)
       |
       v
  photo-pipeline-orchestrator
  (triggered by insert or cron)
       |
       +-> yono-classify (angle classification)
       +-> AI analysis (condition, details)
       +-> optimization (resize, compress)
```

### 11.4 Enrichment

Vehicle profiles can be enriched with additional data:

```
vehicles (incomplete profile)
       |
       v
  enrich-vehicle-profile-ai
  (cron-triggered for incomplete profiles)
       |
       +-> decode-vin-and-update (VIN decode)
       +-> enrich-msrp (MSRP lookup)
       +-> generate-vehicle-description (AI description)
       +-> calculate-vehicle-scores (composite scores)
       +-> calculate-profile-completeness
```

---

## 12. Deduplication

The `dedup-vehicles` function merges duplicate vehicle records that share the same `listing_url`.

### 12.1 Algorithm

```
dedup-vehicles
       |
       v
  1. Find duplicate groups
     SELECT listing_url, array_agg(id ORDER BY created_at ASC)
     FROM vehicles
     WHERE listing_url IS NOT NULL
       AND status IS DISTINCT FROM 'merged'
       AND merged_into_vehicle_id IS NULL
     GROUP BY listing_url
     HAVING COUNT(*) > 1
     LIMIT batch_size
       |
       v
  2. For each group:
     primary_id = oldest vehicle (first in array)
     dup_ids = all others
       |
       v
  3. For each duplicate:
     merge_into_primary(primary_id, dup_id)

     This SQL function:
     a. Re-points child records to primary:
        - vehicle_images
        - auction_comments
        - vehicle_observations
        - vehicle_events
     b. Soft-deletes duplicate:
        - status = 'merged'
        - merged_into_vehicle_id = primary_id
       |
       v
  4. Report stats:
     - Groups found
     - Duplicates merged
     - Images/comments/observations/events moved
```

### 12.2 Safety

- Uses direct Postgres connection (bypasses PostgREST timeout)
- Processes in batches (`batch_size` default 100, max 1000)
- Caps total merges per call (`max_merges` default 500, max 5000)
- Supports dry_run mode
- Never hard-deletes: uses soft-delete with `status='merged'`

---

## 13. The Observation Intake Flow

The observation system provides a newer, source-agnostic intake path that runs parallel to the `import_queue` pipeline. See [observation-system.md](./observation-system.md) for the complete description. The key difference:

```
Old path: URL -> import_queue -> extractor -> vehicles
New path: Observation -> ingest-observation -> vehicle_observations
                                               -> (triggers analysis)
```

---

## 14. Error Handling and Retry Logic

### 14.1 Failure Categories

`process-import-queue` auto-categorizes failures:

| Category | Detection | Max Attempts | Backoff |
|----------|-----------|-------------|---------|
| `timeout` | "timeout", "504", "AbortError" | 8 | 10min * 2^n (transient) |
| `browser_crash` | "browser has been closed" | 5 | 5min * 2^n |
| `rate_limited` | "rate limit", "429" | 8 | 10min * 2^n (transient) |
| `blocked` | "403", "blocked", "Forbidden" | 8 | 10min * 2^n (transient) |
| `bad_data` | "bad_data", "Invalid" | 5 | 5min * 2^n |
| `extraction_failed` | (default) | 5 | 5min * 2^n |

### 14.2 Backoff Formula

```
next_attempt_at = now() + min(2 hours, base_minutes * 2^attempts)

where:
  base_minutes = 10 for transient errors (timeout, rate_limited, blocked)
  base_minutes = 5 for all others
```

### 14.3 Non-Vehicle Page Detection

Pages that contain no vehicle data (memorabilia, collectibles, articles) are detected and marked as `status='skipped'` rather than `status='failed'`:

```
Error messages containing:
  - "No vehicle data found"
  - "could not find real vehicle data"
  - "Missing required fields"

-> status = 'skipped'
-> error_message = "Non-vehicle page: ..."
-> No retry (these are correct non-results)
```

### 14.4 Stale Lock Recovery

An hourly cron job runs `release_stale_locks()` to recover jobs stuck in `processing` state:

```
SELECT * FROM import_queue
WHERE locked_at < (now() - interval '30 minutes')
  AND status = 'processing'

-> SET locked_at = NULL, locked_by = NULL, status = 'pending'
```

The `queue_lock_health` view provides real-time monitoring of lock states across all queue tables.

---

## 15. Complete Flow Diagram

This diagram shows the full data flow from URL entry to final database state.

```
+==============================================================================+
|                              ENTRY POINTS                                     |
|                                                                               |
|  [User URL]  [Crawler Cron]  [FB Scraper]  [iPhoto Intake]  [Observation]    |
|      |            |              |               |                |           |
|      |            |              |               |                |           |
|      v            v              v               |                |           |
|  +---+------------+--------------+---+           |                |           |
|  |        import_queue               |           |                |           |
|  |  (listing_url, status=pending)    |           |                |           |
|  +---+-------------------------------+           |                |           |
|      |                                           |                |           |
|      v                                           |                |           |
|  (claim_import_queue_batch)                      |                |           |
|      |                                           |                |           |
|      v                                           |                |           |
|  (process-import-queue)                          |                |           |
|      |                                           |                |           |
|      +-- domain routing                          |                |           |
|      |                                           |                |           |
|      v                                           |                |           |
|  +--------+--------+--------+--------+           |                |           |
|  |  BaT   |  C&B   | Mecum  |Generic |           |                |           |
|  |extract-|extract-|extract-|extract-|           |                |           |
|  |bat-core|cars-...|mecum   |vehicle-|           |                |           |
|  |        |        |        |data-ai |           |                |           |
|  +---+----+---+----+---+----+---+----+           |                |           |
|      |        |        |        |                |                |           |
|      +--------+--------+--------+                |                |           |
|      |                                           |                |           |
|      v                                           v                v           |
|  (archiveFetch)                         [vehicle_images]  (ingest-observation)|
|      |                                                            |           |
|      v                                                            v           |
|  [listing_page_snapshots]                              [vehicle_observations] |
|      |                                                            |           |
|      v                                                            |           |
|  (qualityGate)                                                    |           |
|      |                                                            |           |
|      +-- reject --> [bat_quarantine]                              |           |
|      |                                                            |           |
|      v                                                            |           |
|  (resolveExistingVehicleId)                                       |           |
|      |                                                            |           |
|      v                                                            |           |
|  (batchUpsertWithProvenance)                                      |           |
|      |                                                            |           |
|      +-- gap_fill --> UPDATE vehicles, INSERT extraction_metadata |           |
|      +-- confirmation --> INSERT extraction_metadata              |           |
|      +-- conflict --> INSERT bat_quarantine + extraction_metadata |           |
|      |                                                            |           |
|      v                                                            |           |
|  [vehicles] + [vehicle_events] + [auction_events] + [vehicle_images]         |
|      |                                                            |           |
|      +------------------------------------------------------------+           |
|      |                                                                        |
|      v                                                                        |
|  (post-extraction: comments, AI analysis, image pipeline, enrichment)        |
|                                                                               |
+==============================================================================+
```

---

## Appendix A: Key File Locations

| Component | File |
|-----------|------|
| Import queue processor | `supabase/functions/process-import-queue/index.ts` |
| BaT core extractor | `supabase/functions/extract-bat-core/index.ts` |
| Generic AI extractor | `supabase/functions/extract-vehicle-data-ai/index.ts` |
| Haiku extraction worker | `supabase/functions/haiku-extraction-worker/index.ts` |
| Archive fetch | `supabase/functions/_shared/archiveFetch.ts` |
| Quality gate | `supabase/functions/_shared/extractionQualityGate.ts` |
| Tetris write layer | `supabase/functions/_shared/batUpsertWithProvenance.ts` |
| Vehicle resolver | `supabase/functions/_shared/resolveVehicleForListing.ts` |
| Vehicle normalization | `supabase/functions/_shared/normalizeVehicle.ts` |
| Agent tier system | `supabase/functions/_shared/agentTiers.ts` |
| Processor selection | `supabase/functions/_shared/select-processor.ts` |
| Observation intake | `supabase/functions/ingest-observation/index.ts` |
| Deduplication | `supabase/functions/dedup-vehicles/index.ts` |
| Import queue schema | `supabase/migrations/20251215000003_import_queue_schema_and_locking.sql` |
| Pipeline registry | `supabase/migrations/20260225000003_pipeline_registry.sql` |

## Appendix B: Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | All functions | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Service role key for admin access |
| `ANTHROPIC_API_KEY` | Agent tier system | Claude API calls |
| `FIRECRAWL_API_KEY` | archiveFetch | Firecrawl scraping |
| `SUPABASE_DB_URL` | dedup-vehicles | Direct Postgres connection |
