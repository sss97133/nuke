# Chapter 1: Intake Pipeline

## What This Subsystem Does

The intake pipeline is the front door of the entire platform. Every vehicle listing URL enters through a single queue table (`import_queue`), gets routed to the correct domain-specific extractor based on URL pattern matching, and either succeeds (creating or updating a vehicle record) or fails with categorized error tracking and exponential backoff retry. The pipeline also archives every fetched page to `listing_page_snapshots` so that extraction can be re-run against stored content without re-crawling.

---

## Key Tables and Functions

### Tables

| Table | Purpose |
|-------|---------|
| `import_queue` | Central intake queue. Every URL to be processed enters here. |
| `listing_page_snapshots` | Archived HTML/markdown of every page ever fetched. |
| `vehicles` | Destination table for extracted vehicle records. |
| `vehicle_events` | Links vehicles to their source listings/auctions. |
| `vehicle_images` | Images discovered during extraction. |

### Edge Functions

| Function | Purpose |
|----------|---------|
| `process-import-queue` | Claims batches from the queue, routes to domain-specific extractors. |
| `continuous-queue-processor` | Cron-driven wrapper that invokes `process-import-queue` on a schedule. |
| `haiku-extraction-worker` | Cheap AI extraction using Claude Haiku for routine work. |
| `extract-vehicle-data-ai` | Generic AI extraction for unknown/unsupported sources. |

### Shared Modules

| Module | Purpose |
|--------|---------|
| `_shared/archiveFetch.ts` | Fetch + cache + archive any external URL. |
| `_shared/listingUrl.ts` | URL normalization for consistent domain routing. |
| `_shared/cors.ts` | Standard CORS headers (import, never copy-paste). |

---

## The import_queue Table

This is the beating heart of intake. Every URL that needs to be processed gets inserted here, either by a human, a discovery agent, a scraper, or another edge function.

### Schema

```sql
CREATE TABLE import_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url TEXT NOT NULL,
  listing_title TEXT,
  listing_year INTEGER,
  listing_make TEXT,
  listing_model TEXT,
  listing_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 100,
  source_id UUID REFERENCES observation_sources(id),
  vehicle_id UUID REFERENCES vehicles(id),
  raw_data JSONB DEFAULT '{}',
  error_message TEXT,
  failure_category TEXT,
  attempts INTEGER DEFAULT 0,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Status Flow

```
pending
  |
  v
[process-import-queue claims batch via claim_import_queue_batch RPC]
  |
  v
processing (locked_by = worker_id, locked_at = now)
  |
  +---> complete (extraction succeeded, vehicle_id set)
  |
  +---> pending_review (low quality score < 0.3, or Haiku escalation)
  |
  +---> skipped (non-vehicle page: memorabilia, parts, etc.)
  |
  +---> pending (transient failure, retry scheduled with backoff)
  |
  +---> failed (max attempts exceeded)
```

### Status Definitions

- **pending**: Ready to be processed. The default state for new entries.
- **processing**: Currently locked by a worker. Transitions to another state within ~120 seconds.
- **complete**: Successfully extracted. `vehicle_id` is set. `processed_at` is set.
- **pending_review**: Needs human or Sonnet-tier review. Either quality score was too low, or the Haiku worker escalated due to missing year/make/model.
- **skipped**: The page was fetched successfully but contains no vehicle data (memorabilia, collectibles, parts listings).
- **pending** (after failure): A transient error occurred (timeout, rate limit, blocked). Will be retried after `next_attempt_at`.
- **failed**: Permanent failure after exhausting all retry attempts.

### Failure Categories

The queue processor automatically categorizes failures:

```typescript
// From process-import-queue/index.ts
if (errorMsg.includes('timeout') || errorMsg.includes('504'))
  failureCategory = 'timeout';
else if (errorMsg.includes('browser has been closed'))
  failureCategory = 'browser_crash';
else if (errorMsg.includes('rate limit') || errorMsg.includes('429'))
  failureCategory = 'rate_limited';
else if (errorMsg.includes('403') || errorMsg.includes('blocked'))
  failureCategory = 'blocked';
else if (errorMsg.includes('bad_data') || errorMsg.includes('Invalid'))
  failureCategory = 'bad_data';
else
  failureCategory = 'extraction_failed';
```

### Retry Logic

Retries use exponential backoff with different policies for transient vs. permanent errors:

```typescript
// Transient errors (timeout, rate_limited, blocked): up to 8 attempts
// Permanent errors (bad_data, extraction_failed): up to 5 attempts
const isTransient = failureCategory === 'timeout' ||
                    failureCategory === 'rate_limited' ||
                    failureCategory === 'blocked';
const maxAttempts = isTransient ? 8 : 5;

// Backoff formula: base_delay * 2^attempts, capped at 2 hours
// Transient base: 10 minutes
// Permanent base: 5 minutes
const baseMinutes = isTransient ? 10 : 5;
const delayMs = Math.min(
  2 * 60 * 60 * 1000,  // 2 hour cap
  baseMinutes * 60 * 1000 * Math.pow(2, attempts)
);
```

---

## The Claim Mechanism

Workers do not poll the queue directly. Instead, they call a PostgreSQL RPC function `claim_import_queue_batch` that atomically selects and locks a batch of items. This prevents duplicate processing when multiple workers run concurrently.

```typescript
// From process-import-queue/index.ts
const { data: queueItems } = await supabase.rpc('claim_import_queue_batch', {
  p_batch_size: batch_size,      // default 10
  p_max_attempts: 8,
  p_priority_only: priority_only,
  p_source_id: source_id || null,
  p_worker_id: workerId,
});
```

The RPC function:
1. Selects `p_batch_size` rows where `status = 'pending'` and `locked_by IS NULL`
2. Filters out rows where `attempts >= p_max_attempts`
3. Filters out rows where `next_attempt_at > now()` (not yet ready for retry)
4. Orders by `priority DESC, created_at ASC` (highest priority first, oldest first within same priority)
5. Sets `locked_by = p_worker_id` and `locked_at = now()` atomically
6. Returns the claimed rows

The worker ID format is `process-import-queue:<timestamp>` to enable debugging of stuck workers.

### Stale Lock Protection

If a worker crashes mid-processing, its locked items would be stuck forever. The system has a PostgreSQL function `release_stale_locks()` that releases any lock older than 30 minutes:

```sql
-- Check for stale locks
SELECT release_stale_locks(dry_run := true);

-- Release stale locks across all queue tables
SELECT release_stale_locks();
```

A cron job (job 188) runs this hourly as a safety net.

There is also a view `queue_lock_health` that shows live lock state with stale counts:

```sql
SELECT * FROM queue_lock_health;
```

---

## URL Routing: Domain to Extractor

The core routing logic in `process-import-queue` maps URL domains to specific extractor edge functions. This is a simple if/else chain on the normalized URL.

### URL Normalization

Before routing, the URL is normalized using `normalizeListingUrlKey()` from `_shared/listingUrl.ts`:

```typescript
// From _shared/listingUrl.ts
export function normalizeListingUrlKey(raw: string | null | undefined): string | null {
  try {
    const u = new URL(input);
    u.hash = '';
    u.search = '';
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '').replace(/\/+$/, '');
    return `${host}${path}`.toLowerCase();
  } catch {
    // Fallback for partial/invalid URLs
    return input
      .replace(/[?#].*$/, '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}
```

This strips protocol, www prefix, query strings, hash fragments, and trailing slashes. The result is a stable key like `bringatrailer.com/listing/1967-porsche-911s`.

### Routing Table

The normalized URL is checked against domain patterns to select the correct extractor:

| Domain Pattern | Extractor Function | Notes |
|---------------|-------------------|-------|
| `bringatrailer.com` | `complete-bat-import` | Two-step: core extraction + comment extraction |
| `carsandbids.com` | `extract-cars-and-bids-core` | JS SPA, requires Firecrawl |
| `pcarmarket.com` | `import-pcarmarket-listing` | API-based |
| `hagerty.com` | `extract-hagerty-listing` | |
| `classic.com` | `import-classic-auction` | |
| `collectingcars.com` | `extract-vehicle-data-ai` | Generic AI (JS SPA) |
| `barnfinds.com` | `extract-barn-finds-listing` | |
| `craigslist.org` | `extract-craigslist` | |
| `mecum.com` | `extract-mecum` | |
| `barrett-jackson.com` | `extract-barrett-jackson` | |
| `broadarrowauctions.com` | `extract-broad-arrow` | |
| `bonhams.com` | `extract-bonhams` | |
| `rmsothebys.com` | `extract-rmsothebys` | |
| `goodingco.com` | `extract-gooding` | |
| Specialty builders* | `extract-specialty-builder` | velocityrestorations, coolnvintage, brabus, icon4x4, ringbrothers |
| Everything else | `extract-vehicle-data-ai` | Generic AI fallback |

The extractor is called via internal HTTP:

```typescript
const extractorUrl = supabaseUrl + '/functions/v1/complete-bat-import';

const extractResponse = await fetch(extractorUrl, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url, save_to_db: true }),
  signal: AbortSignal.timeout(120_000),  // 2 minute timeout per extraction
});
```

### Non-Vehicle Detection

Some URLs on auction sites point to non-vehicle items (memorabilia, parts, collectibles). The queue processor detects these and marks them as `skipped` rather than `failed`:

```typescript
const isNonVehicle = errorMsg.includes('No vehicle data found') ||
  errorMsg.includes('could not find real vehicle data') ||
  errorMsg.includes('Missing required fields');

if (isNonVehicle) {
  await supabase.from('import_queue').update({
    status: 'skipped',
    error_message: `Non-vehicle page: ${errorMsg.slice(0, 200)}`,
  }).eq('id', item.id);
}
```

---

## The Archive Fetch System

### Why It Exists

Before `archiveFetch` existed, every extraction pass required re-crawling the source URL. This caused:
- Wasted bandwidth and API credits (Firecrawl costs ~$0.01/scrape)
- Rate limiting from source sites
- Lost data when pages were taken down
- Inability to re-extract with improved parsers

### How It Works

`archiveFetch()` from `_shared/archiveFetch.ts` is a three-step process:

**Step 1: Check Cache.** Query `listing_page_snapshots` for a recent successful snapshot of this URL.

```typescript
const cutoff = new Date(Date.now() - maxAgeSec * 1000).toISOString();
const { data: cached } = await supabase
  .from("listing_page_snapshots")
  .select("id, html, markdown, fetched_at")
  .eq("listing_url", url)
  .eq("success", true)
  .gte("fetched_at", cutoff)
  .order("fetched_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (cached?.html) {
  return { html: cached.html, source: "cache", cached: true };
}
```

Default cache TTL is 24 hours. Can be overridden per call.

**Step 2: Fetch the Page.** If cache miss, fetch from the source using the appropriate method:

- **BaT URLs**: Use the dedicated `batFetcher` (direct fetch with UA rotation and jitter)
- **JS SPA sites** (Cars & Bids, Collecting Cars, PCarMarket): Use Firecrawl
- **Everything else**: Use the generic `hybridFetcher` (direct fetch with retries)

```typescript
if (platform === "bat" && !useFirecrawl) {
  const batResult = await fetchBatPage(url, options?.batOptions);
  result.html = batResult.html;
} else if (useFirecrawl) {
  const fcResult = await firecrawlScrape({ url, formats: ["html", "markdown"] });
  result.html = fcResult.data.html;
  result.markdown = fcResult.data.markdown;
} else {
  const directResult = await fetchPage(url);
  result.html = directResult.html;
}
```

**Step 3: Archive.** Save the fetched content to `listing_page_snapshots`:

```typescript
await supabase.from("listing_page_snapshots").insert({
  platform,
  listing_url: url,
  fetched_at: new Date().toISOString(),
  fetch_method: result.source,
  http_status: result.statusCode,
  success: html !== null && !isGarbageHtml(html, platform),
  html: html,
  markdown: result.markdown,
  html_sha256: htmlHash,
  content_length: html?.length ?? 0,
});
```

### Garbage Detection

Not all successful HTTP responses contain useful content. The system detects garbage HTML:

```typescript
function isGarbageHtml(html: string, platform: string): boolean {
  const lower = html.toLowerCase();

  // Cloudflare challenge / bot wall
  if (lower.includes("attention required") && lower.includes("cloudflare")) return true;
  if (lower.includes("cf_chl_opt")) return true;

  // Generic access denied
  if (lower.includes("access denied") && html.length < 5000) return true;

  // React/Next.js shell with no rendered content
  // (Bonhams, Barrett-Jackson serve empty SPA shells to bots)
  if (platform === "bonhams") {
    const hasNextShell = lower.includes("__next_data__");
    const hasLotContent = /<h[12][^>]*>[^<]*\d{4}\s+[A-Z]/i.test(html);
    if (hasNextShell && !hasLotContent) return true;
  }

  return false;
}
```

Garbage pages are archived with `success = false` so they do not pollute the cache.

### Storage Migration

Large HTML pages (100KB+) can bloat the Postgres database. The system supports migrating content out of the `html` column into Supabase Storage (`listing-snapshots` bucket) with the path stored in `html_storage_path`:

```typescript
// When reading, check both inline and storage
let html = cached.html ?? null;
if (!html && cached.html_storage_path) {
  const { data: blob } = await supabase.storage
    .from("listing-snapshots")
    .download(cached.html_storage_path);
  if (blob) html = await blob.text();
}
```

### Platform Auto-Detection

If the caller does not specify a platform, it is auto-detected from the URL:

```typescript
function detectPlatform(url: string): string {
  if (url.includes("bringatrailer.com")) return "bat";
  if (url.includes("carsandbids.com")) return "carsandbids";
  if (url.includes("hagerty.com")) return "hagerty";
  // ... 10+ more patterns
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "unknown";
  }
}
```

### Sites That Need Firecrawl

Some sites are JavaScript SPAs that return empty HTML shells to direct `fetch()`. These are auto-detected:

```typescript
function needsFirecrawl(url: string): boolean {
  const fcSites = ["carsandbids.com", "collectingcars.com", "pcarmarket.com"];
  return fcSites.some((s) => url.includes(s));
}
```

---

## How to Build the Intake Pipeline from Scratch

### Step 1: Create the import_queue table

```sql
CREATE TABLE import_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url TEXT NOT NULL,
  listing_title TEXT,
  listing_year INTEGER,
  listing_make TEXT,
  listing_model TEXT,
  listing_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 100,
  source_id UUID,
  vehicle_id UUID,
  raw_data JSONB DEFAULT '{}',
  error_message TEXT,
  failure_category TEXT,
  attempts INTEGER DEFAULT 0,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for queue claiming (most critical performance path)
CREATE INDEX idx_import_queue_pending ON import_queue (priority DESC, created_at ASC)
  WHERE status = 'pending' AND locked_by IS NULL;

-- Index for retry scheduling
CREATE INDEX idx_import_queue_retry ON import_queue (next_attempt_at)
  WHERE status = 'pending' AND next_attempt_at IS NOT NULL;

-- Index for dedup by URL
CREATE INDEX idx_import_queue_url ON import_queue (listing_url);

-- CHECK constraint for valid statuses
ALTER TABLE import_queue ADD CONSTRAINT chk_import_queue_status
  CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped', 'pending_review', 'pending_strategy'));
```

### Step 2: Create the claim RPC function

```sql
CREATE OR REPLACE FUNCTION claim_import_queue_batch(
  p_batch_size INT DEFAULT 10,
  p_max_attempts INT DEFAULT 8,
  p_priority_only BOOLEAN DEFAULT false,
  p_source_id UUID DEFAULT NULL,
  p_worker_id TEXT DEFAULT NULL
)
RETURNS SETOF import_queue AS $$
DECLARE
  claimed_ids UUID[];
BEGIN
  -- Select and lock in one atomic operation
  WITH candidates AS (
    SELECT id FROM import_queue
    WHERE status = 'pending'
      AND locked_by IS NULL
      AND attempts < p_max_attempts
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (p_source_id IS NULL OR source_id = p_source_id)
    ORDER BY priority DESC, created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE import_queue q
  SET locked_by = COALESCE(p_worker_id, 'worker-' || gen_random_uuid()::text),
      locked_at = now(),
      status = 'processing'
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.id INTO claimed_ids;

  RETURN QUERY
    SELECT * FROM import_queue WHERE id = ANY(claimed_ids);
END;
$$ LANGUAGE plpgsql;
```

### Step 3: Create the listing_page_snapshots table

```sql
CREATE TABLE listing_page_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  listing_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  fetch_method TEXT,  -- 'direct', 'firecrawl', 'proxy', 'cache'
  http_status INTEGER,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  html TEXT,
  markdown TEXT,
  html_sha256 TEXT,
  content_length INTEGER DEFAULT 0,
  html_storage_path TEXT,      -- path in Supabase Storage (for large pages)
  markdown_storage_path TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate snapshots (same URL, same content)
CREATE UNIQUE INDEX idx_snapshots_dedup
  ON listing_page_snapshots (platform, listing_url, html_sha256)
  WHERE success = true;

-- Cache lookup index
CREATE INDEX idx_snapshots_cache
  ON listing_page_snapshots (listing_url, success, fetched_at DESC);
```

### Step 4: Deploy the process-import-queue edge function

The full implementation is at `supabase/functions/process-import-queue/index.ts`. Key components to implement:

1. CORS handling (import from `_shared/cors.ts`)
2. Supabase client creation
3. Batch claim via RPC
4. URL normalization via `_shared/listingUrl.ts`
5. Domain-to-extractor routing (if/else chain on normalized URL)
6. HTTP call to extractor with 120-second timeout
7. Success handling (set status=complete, capture vehicle_id)
8. Failure categorization and exponential backoff
9. Non-vehicle detection (set status=skipped)

### Step 5: Set up the cron

The queue processor runs on a cron schedule via `continuous-queue-processor`:

```sql
-- Cron job: process import queue every 5 minutes
SELECT cron.schedule(
  'process-import-queue',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/continuous-queue-processor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size": 10}'
  )$$
);
```

### Step 6: Set up stale lock release

```sql
-- Hourly stale lock cleanup
SELECT cron.schedule(
  'release-stale-locks',
  '0 * * * *',
  $$SELECT release_stale_locks()$$
);
```

---

## How to Insert Items into the Queue

### Single URL

```sql
INSERT INTO import_queue (listing_url, listing_title, status, priority)
VALUES (
  'https://bringatrailer.com/listing/1967-porsche-911s/',
  '1967 Porsche 911S',
  'pending',
  100
);
```

### Bulk import from a crawl

```sql
INSERT INTO import_queue (listing_url, listing_title, priority)
SELECT url, title, 50
FROM unnest(ARRAY['url1', 'url2', 'url3']) AS url
  CROSS JOIN unnest(ARRAY['title1', 'title2', 'title3']) AS title
ON CONFLICT DO NOTHING;
```

### From an edge function (programmatic)

```typescript
await supabase.from('import_queue').insert({
  listing_url: url,
  listing_title: title,
  status: 'pending',
  priority: priority,
  source_id: sourceId,
});
```

---

## Known Problems

1. **No dedup at insert time.** The same URL can be inserted multiple times into `import_queue`. The router will re-extract it each time. A unique constraint on `listing_url` would prevent this but would also prevent intentional re-extraction.

2. **Single-threaded per invocation.** `process-import-queue` processes items sequentially within a batch. Parallel extraction within a batch would improve throughput but adds complexity around lock management.

3. **Hardcoded routing table.** Adding a new source requires editing the if/else chain in `process-import-queue/index.ts` and redeploying. A database-driven routing table would be more flexible.

4. **No priority decay.** Items at priority 100 will always be processed before items at priority 50, even if the priority-50 items have been waiting for days. A time-based priority boost would be fairer.

5. **Stale lock window.** The 30-minute stale lock threshold means a crashed worker's items are stuck for up to 30 minutes (plus up to 60 minutes until the hourly cron runs). The effective worst case is 90 minutes of stuck items.

---

## Target Architecture

The target architecture replaces the URL-routing if/else chain with a single unified intake endpoint that:

1. Accepts any URL or raw data payload
2. Looks up the source in `observation_sources` by domain pattern
3. Finds the registered extractor in `observation_extractors`
4. Dispatches to that extractor (or the generic AI extractor as fallback)
5. Routes all output through `ingest-observation` for unified storage

This eliminates the hardcoded routing table and makes adding new sources a database configuration change rather than a code deployment. See Chapter 4 (Observation System) for the full architecture.
