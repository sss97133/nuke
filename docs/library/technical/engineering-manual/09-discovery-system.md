# Chapter 9: Discovery System

## What This Subsystem Does

Discovery finds vehicle listing URLs that do not yet exist in the system and queues them into `import_queue` for extraction. It is the system's growth engine -- without discovery, the only way a URL enters the pipeline is manual insertion. Discovery functions run on schedules (via pg_cron), as local scripts (for sources requiring residential IPs), or on-demand via POST requests.

Every discovery function follows the same contract:

1. Fetch a list of URLs from an external source (RSS feed, HTML page, API, GraphQL endpoint)
2. Deduplicate against `import_queue` and `vehicle_events` to identify genuinely new URLs
3. Insert new URLs into `import_queue` with `status = 'pending'`
4. Report how many were found, how many were new, how many were queued

The intake pipeline (Chapter 1) then picks them up and routes them to the appropriate extractor (Chapter 2).

---

## Discovery Methods

The system uses six distinct methods to find new listing URLs:

| Method | Example | Infrastructure |
|--------|---------|---------------|
| RSS/Atom feed polling | BaT new listings RSS, Craigslist RSS | `poll-listing-feeds` edge function |
| HTML pagination scraping | BaT `/auctions/results/?page=N` | `bat-url-discovery`, `barn-finds-discovery` |
| API search | Collecting Cars Typesense | `collecting-cars-discovery` |
| GraphQL endpoint | FB Marketplace `doc_id` | `fb-marketplace-local-scraper.mjs` (local) |
| Firecrawl site map | Cars & Bids past auctions | `cab-url-discovery` |
| Manual submission | Any URL pasted into import_queue | Direct SQL or MCP tool |

---

## The listing_feeds Table

The `listing_feeds` table stores RSS/Atom/HTML feed configurations that `poll-listing-feeds` iterates over. As of March 2026, it contains 719 rows.

### Schema

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | uuid() | Primary key |
| `source_slug` | text | NO | | Platform identifier (e.g. `craigslist`, `bat`, `ksl`) |
| `display_name` | text | NO | | Human-readable feed name |
| `feed_url` | text | NO | | The URL to fetch |
| `feed_type` | text | NO | `'rss'` | Format: `rss`, `atom`, or `html` |
| `search_criteria` | jsonb | YES | `'{}'` | Search parameters used to build the feed URL |
| `enabled` | boolean | NO | `true` | Whether this feed is actively polled |
| `poll_interval_minutes` | integer | NO | `15` | Minimum interval between polls |
| `last_polled_at` | timestamptz | YES | | Timestamp of last successful poll |
| `last_poll_count` | integer | YES | `0` | Items queued in the last poll |
| `total_items_found` | integer | YES | `0` | Cumulative items queued from this feed |
| `error_count` | integer | YES | `0` | Consecutive error count (resets to 0 on success) |
| `last_error` | text | YES | | Most recent error message |
| `created_at` | timestamptz | YES | now() | |
| `updated_at` | timestamptz | YES | now() | |

### Auto-Disable Behavior

When `error_count` reaches 10 consecutive failures, `poll-listing-feeds` sets `enabled = false` and logs a disable message. To re-enable, fix the underlying issue and then:

```sql
UPDATE listing_feeds
SET enabled = true, error_count = 0, last_error = NULL
WHERE id = '<feed-id>';
```

### Adding a New Feed

```sql
INSERT INTO listing_feeds (source_slug, display_name, feed_url, feed_type, poll_interval_minutes)
VALUES (
  'hemmings',
  'Hemmings - Trucks',
  'https://www.hemmings.com/classifieds/cars-for-sale/trucks/?format=rss',
  'rss',
  30
);
```

The next time `poll-listing-feeds` runs, it will pick up the new feed (ordered by `last_polled_at ASC NULLS FIRST`, so new feeds are polled immediately).

---

## poll-listing-feeds

**Location:** `supabase/functions/poll-listing-feeds/index.ts` (428 lines)

This is the general-purpose feed poller. It handles RSS 2.0, Atom, and HTML link extraction in a single function.

### How It Works

1. **Select feeds due for polling.** Query `listing_feeds` where `enabled = true`, ordered by `last_polled_at ASC NULLS FIRST`, limited to `batch_size` (default 10). Feeds are skipped if `last_polled_at` is within the last 10 minutes (unless `force = true`).

2. **Fetch each feed.** Direct HTTP GET with a 15-second timeout and a `NukeBot/1.0` user agent.

3. **Parse the content.** The parser handles both RSS and Atom formats via regex:
   - RSS: `<item>` blocks with `<title>`, `<link>`, `<pubDate>`, `<description>`
   - Atom: `<entry>` blocks with `<title>`, `<link href="...">`, `<published>`, `<summary>`
   - CDATA-wrapped content is handled

4. **Extract vehicle hints from titles.** `parseVehicleFromTitle()` regex-matches `YEAR MAKE MODEL` patterns from feed item titles, populating `listing_year`, `listing_make`, `listing_model` on the queue row.

5. **Clean URLs.** Strip tracking params, hash fragments, trailing slashes. Craigslist URLs get special treatment to preserve the listing ID while stripping query strings.

6. **Upsert to import_queue.** Batch inserts in chunks of 50, using `ON CONFLICT (listing_url) DO NOTHING` to avoid duplicates. Feed items get `priority = 3`.

7. **Update feed metadata.** On success: reset `error_count` to 0, update `last_polled_at` and `last_poll_count`. On failure: increment `error_count`, store `last_error`.

8. **500ms delay between feeds.** Polite pacing to avoid slamming multiple sources simultaneously.

### Invocation

```bash
# Poll all due feeds (batch of 10)
curl -s -X POST "$SUPABASE_URL/functions/v1/poll-listing-feeds" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json"

# Poll only Craigslist feeds
curl -s -X POST "$SUPABASE_URL/functions/v1/poll-listing-feeds" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source": "craigslist"}'

# Force-poll a specific feed regardless of interval
curl -s -X POST "$SUPABASE_URL/functions/v1/poll-listing-feeds" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"feed_id": "uuid-here", "force": true}'
```

---

## Platform-Specific Discovery

Each platform has its own discovery function tailored to how that platform exposes listing data.

| Platform | Discovery Function | Method | Dedup Against | Priority | Throughput |
|----------|-------------------|--------|---------------|----------|------------|
| BaT (daily) | `bat-url-discovery` | HTML scrape of `/auctions/results/?page=N` | `vehicle_events` + `import_queue` | 5 | ~40-60 new/day |
| BaT (backfill) | `bat-year-crawler` | HTML scrape of `/auctions/results/?page=N` with `bat_crawl_state` tracking | `vehicle_events` + `import_queue` | 10 | ~500/run |
| BaT (feeds) | `poll-listing-feeds` | RSS feed | `import_queue` (upsert) | 3 | ~20/poll |
| Cars & Bids | `cab-url-discovery` | Firecrawl scrape of `/past-auctions/?page=N` | `vehicle_events` + `import_queue` | 5 | ~10-15/day |
| Collecting Cars | `collecting-cars-discovery` | Typesense API (`production_cars` collection) | `import_queue` | 50-70 | ~5-10/day |
| Barn Finds | `barn-finds-discovery` | HTML scrape of homepage + `/page/N/` + `/auctions/` + `/category/for-sale/` | `import_queue` + `vehicles` | default | ~5/day |
| Craigslist | `discover-cl-squarebodies` | HTML scrape of CL search results across 100+ regions | `craigslist_listing_queue` | default | Variable |
| FB Marketplace | `fb-marketplace-local-scraper.mjs` | GraphQL POST to `/api/graphql/` (local script) | `marketplace_listings` | default | ~144/sweep |
| KSL | `poll-listing-feeds` | HTML feed rows | `import_queue` (upsert) | 3 | ~20/poll |
| Hemmings | `poll-listing-feeds` | RSS (needs configuration) | `import_queue` (upsert) | 3 | TBD |
| Mecum/BJ/Bonhams/RM/Gooding | None dedicated | Depend on `poll-listing-feeds` RSS or manual submission | N/A | N/A | Manual |

---

## bat-url-discovery vs bat-year-crawler

These two functions both discover BaT listing URLs, but serve different purposes.

### bat-url-discovery

**Purpose:** Daily discovery of recently completed auctions.

**Location:** `supabase/functions/bat-url-discovery/index.ts`

Scrapes `https://bringatrailer.com/auctions/results/?page=N` to extract listing URLs from the results pages. Deduplicates against both `vehicle_events` (already extracted) and `import_queue` (already queued). Stores discovery state in the `system_state` table under key `bat_url_discovery`.

```bash
# Discover from first 10 pages of results
curl -s -X POST "$SUPABASE_URL/functions/v1/bat-url-discovery" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "discover", "pages": 10}'

# Continuous mode: keep going until 1000 new URLs queued
curl -s -X POST "$SUPABASE_URL/functions/v1/bat-url-discovery" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "continuous", "target": 1000}'
```

Key details:
- URL validation: regex-checked against `/listing/[a-z0-9-]+` pattern
- Bad URL filtering: rejects contact pages, embed pages, static assets, URL-encoded garbage
- Rate limiting: 500ms delay between pages
- Priority: queued items get `priority = 5`
- Stops when a page returns zero URLs

### bat-year-crawler

**Purpose:** Historical backfill of the entire BaT archive (~228K listings).

**Location:** `supabase/functions/bat-year-crawler/index.ts`

Same scraping logic as `bat-url-discovery`, but with page-level state tracking via the `bat_crawl_state` table. This allows the crawler to resume where it left off across multiple invocations, skip already-scraped pages, and track per-page yield.

```sql
-- bat_crawl_state schema
-- crawl_type TEXT (e.g. 'results', 'year_1967')
-- page_number INTEGER
-- urls_found INTEGER
-- urls_new INTEGER
-- crawled_at TIMESTAMPTZ
-- UNIQUE (crawl_type, page_number)
```

The crawler also supports year-specific crawling via `crawl_type`:

```bash
# Crawl /1967/?page=N for all 1967 BaT listings
curl -s -X POST "$SUPABASE_URL/functions/v1/bat-year-crawler" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "crawl", "crawl_type": "year_1967", "pages": 100}'
```

Key differences from `bat-url-discovery`:
- Tracks scraped pages in `bat_crawl_state` to avoid re-scraping
- Stops after 3 consecutive empty pages
- Accepts a `queue_urls` action for external crawlers (Playwright) to submit URLs
- Priority: queued items get `priority = 10` (higher than daily discovery)
- 300ms delay between pages (faster than daily discovery)

**Use discovery for daily new listings. Use year crawler for historical backfill.**

---

## Collecting Cars Discovery (Typesense API)

**Location:** `supabase/functions/collecting-cars-discovery/index.ts`

Collecting Cars exposes a public Typesense search API that returns structured JSON -- no HTML parsing needed. The function queries the `production_cars` collection for live or sold listings.

```typescript
const TYPESENSE_API_KEY = "pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1";
const TYPESENSE_ENDPOINT = "https://dora.production.collecting.com/multi_search";
```

The API returns rich structured data per listing:
- `auctionId`, `slug`, `title`
- `makeName`, `modelName`, `productYear`
- `currentBid`, `noBids`, `dtStageEndsUTC`
- `listingStage` (live, sold, comingsoon)
- `location`, `countryCode`, `currencyCode`
- `features` (mileage, transmission, fuelType, driveSide)

The function filters to `lotType === "car"` (skipping plates, parts, bikes) and sets priority based on listing stage: live listings get `priority = 70`, sold listings get `priority = 50`.

```bash
# Discover all live listings
curl -s -X POST "$SUPABASE_URL/functions/v1/collecting-cars-discovery" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "discover"}'

# Discover sold listings
curl -s -X POST "$SUPABASE_URL/functions/v1/collecting-cars-discovery" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "discover", "stage": "sold"}'
```

---

## Craigslist Discovery

**Location:** `supabase/functions/discover-cl-squarebodies/index.ts`

This is a specialized discovery function for square-body Chevrolet/GMC trucks (1973-1991). It searches 100+ Craigslist regions using 40+ keyword variations and queues results to `craigslist_listing_queue` (a separate queue from `import_queue`).

Key characteristics:
- Uses DOM parsing via `deno_dom` with multiple CSS selector fallbacks plus regex fallback
- Year-filtered searches: `min_auto_year=1973&max_auto_year=1991`
- Self-chaining: can invoke itself to process remaining regions when `chain_depth > 0`
- Rate limiting: 800ms between searches, 800ms between regions
- 5-second per-request timeout

The function queues to `craigslist_listing_queue` rather than `import_queue`. Items flow from there to the Craigslist extractor.

---

## Facebook Marketplace Discovery

**Location:** `scripts/fb-marketplace-local-scraper.mjs` (must run locally on residential IP)

This is the only discovery function that cannot run as an edge function. Facebook blocks datacenter IP ranges, so it runs on the developer's local machine.

### The GraphQL Endpoint

The key discovery: Facebook's Marketplace GraphQL API works without any authentication from residential IPs.

```typescript
const body = new URLSearchParams({
  doc_id: "33269364996041474",  // The magic document ID
  variables: JSON.stringify({
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],  // Vehicles category
    count: 24,                           // Hard cap per page
    cursor,
    radius: 65000,
    priceRange: [0, 214748364700],
  }),
});

const resp = await fetch("https://www.facebook.com/api/graphql/", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": CHROME_UA,
    "Origin": "https://www.facebook.com",
    "Sec-Fetch-Site": "same-origin",
  },
  body: body.toString(),
});
```

### Geographic Coverage

58 US metro areas are defined with lat/lng coordinates. The `--group` flag splits them into 4 groups for staggered scheduling:

```bash
# Scrape all 58 metros, 50 pages each
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50

# Scrape group 2 of 4 (staggered scheduling)
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50 --group 2

# Single city
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --max-pages 10

# Dry run (scrape but don't write to DB)
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --dry-run
```

### Rate Limiting Strategy

- 2-3 second delay between pages
- 5-10 seconds between cities
- Skip city on rate limit (HTTP 429 or response shape change)
- 30-second extra cooldown after a rate limit hit
- Abort only after 3 consecutive city failures

### Vintage Filtering

The scraper targets pre-2006 vehicles (`YEAR_MIN = 1920`, `YEAR_MAX = 2006`). Year is extracted from the listing title since Facebook's year filter API parameter is broken (ignored server-side).

National vintage rate: approximately 12% of all vehicle listings are pre-2006.

### DNS Workaround

Uses custom DNS resolution via `dns.Resolver` with Google/Cloudflare DNS servers to bypass macOS `getaddrinfo()` failures during long-running Node.js processes:

```typescript
const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);
```

---

## Email Newsletter Discovery

The system has no dedicated automated email discovery function currently deployed. The planned approach is:

- Gmail search for emails from `@bringatrailer.com`, `@beverlyhillscarclub.com`, `@hemmings.com`
- Extract listing URLs from email bodies
- Queue to `import_queue`

This is a passive discovery channel that catches dealer-specific listings and newsletter-only content. The `mcp-connector` edge function includes MCP tool definitions for email-based operations, but automated email polling for discovery is not yet implemented.

---

## continuous-discovery.sh

**Location:** `scripts/continuous-discovery.sh`

A shell script that runs discovery and extraction jobs in a loop with 30-minute sleep cycles:

```bash
# Start continuous discovery (runs until .stop-discovery file exists)
dotenvx run -- bash scripts/continuous-discovery.sh

# Stop it
touch .stop-discovery
```

The loop calls:
1. Comment sentiment discovery (`discover-comment-data`)
2. BaT comment extraction backfill (`backfill-comments`)
3. Discovery snowball (`discovery-snowball`) -- recursive lead finding across platforms

---

## How to Add Discovery for a New Source

### Decision Tree

```
Does the source have an RSS or Atom feed?
  YES -> Add a row to listing_feeds. Done.
         poll-listing-feeds handles the rest.

Does the source have a structured search API?
  YES -> Write a dedicated discovery function.
         Pattern: collecting-cars-discovery (Typesense API)

Is the source a static HTML site with pagination?
  YES -> Write an HTML scraper.
         Pattern: bat-url-discovery (results pages)
         Pattern: barn-finds-discovery (WordPress)

Does the source require JavaScript rendering?
  YES -> Use Firecrawl in the discovery function.
         Pattern: cab-url-discovery (Firecrawl + regex)

Does the source require a residential IP?
  YES -> Write a local script in scripts/.
         Pattern: fb-marketplace-local-scraper.mjs

None of the above?
  -> Manual URL submission to import_queue.
```

### Steps for a New Discovery Function

1. **Create the edge function** at `supabase/functions/<source>-discovery/index.ts`
2. **Implement dedup** by querying `import_queue` and `vehicle_events` for existing URLs
3. **Insert new URLs** into `import_queue` with appropriate priority
4. **Store discovery state** in `system_state` (keyed by function name) for resumability
5. **Add URL routing** in `process-import-queue` if a new extractor is needed (Chapter 1)
6. **Deploy**: `supabase functions deploy <source>-discovery --no-verify-jwt`
7. **Optionally add a cron** for scheduled polling

### Steps for a New RSS Feed

```sql
INSERT INTO listing_feeds (source_slug, display_name, feed_url, feed_type, poll_interval_minutes)
VALUES ('new-source', 'New Source - Category', 'https://example.com/feed.xml', 'rss', 30);
```

No code changes needed. The next `poll-listing-feeds` invocation picks it up.

---

## Known Problems

1. **No centralized rate limiting across discovery functions.** Each discovery function manages its own rate limiting independently. If `bat-url-discovery` and `bat-year-crawler` run simultaneously, both hit BaT and both get rate-limited. A shared rate limit counter would coordinate access.

2. **No adaptive polling frequency.** `poll-listing-feeds` uses a fixed 10-minute minimum interval regardless of feed activity. A feed that publishes 100 items/day gets the same poll rate as one that publishes 1 item/week.

3. **Silent failures.** If a discovery function returns zero URLs, there is no alert. The function reports success with `urls_queued: 0` and moves on. There is no mechanism to distinguish "source has no new listings" from "our scraping is broken."

4. **FB Marketplace requires a local machine.** The GraphQL endpoint only responds to residential IP addresses. There is no managed residential proxy integration, so the scraper must run on the developer's machine.

5. **Craigslist discovery uses a separate queue.** `discover-cl-squarebodies` writes to `craigslist_listing_queue` instead of `import_queue`, creating a parallel queue path that is not visible to the standard queue health monitoring.

6. **No dedup across discovery functions.** `bat-url-discovery` and `bat-year-crawler` both maintain their own dedup sets by querying the database. If both run near-simultaneously, they may both queue the same URL before the other's insert is visible.

7. **719 listing_feeds rows, most untested.** The table has 719 feed entries but many were bulk-inserted and have never been successfully polled. No health dashboard shows which feeds are actually producing results vs. silently returning zero items.

8. **discovery-snowball is not deployed as an edge function.** The migration exists (`20260119_discovery_snowball_system.sql`) and `continuous-discovery.sh` calls it, but the edge function directory `supabase/functions/discovery-snowball/` does not exist in the current codebase. Calls to it from `continuous-discovery.sh` will fail silently.
