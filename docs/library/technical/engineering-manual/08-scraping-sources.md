# Chapter 8: Scraping Sources

## What This Subsystem Does

Nuke aggregates vehicle data from dozens of sources across the collector vehicle ecosystem. Each source has different technical characteristics: some serve static HTML that can be fetched directly, some are JavaScript SPAs that require browser rendering, some have APIs, and one (Facebook Marketplace) uses a public GraphQL endpoint that requires no authentication but does require a residential IP address. This chapter documents each major source's access method, rate limits, data structure, and quality characteristics, plus the generic Firecrawl fallback for sources without dedicated extractors.

---

## Source Quality Hierarchy

| Tier | Source Type | Trust Score | Data Quality | Coverage |
|------|-----------|-------------|-------------|----------|
| 1 | Curated auction (BaT, Gooding, RM Sotheby's) | 0.85-0.90 | Excellent. Verified by editorial staff. | Limited to auctions |
| 2 | Volume auction (Mecum, Barrett-Jackson) | 0.70-0.80 | Good. Lot descriptions vary in detail. | High volume |
| 3 | Dealer/marketplace (Hemmings, PCarMarket, Hagerty) | 0.60-0.75 | Variable. Dealer-written descriptions. | Broad |
| 4 | Classified (Craigslist, FB Marketplace, eBay) | 0.40-0.55 | Low. Seller-written, often incomplete. | Very broad |

---

## Bring a Trailer (BaT)

### Access Method

**Direct HTML fetch.** BaT pages are fully server-rendered. No JavaScript rendering required. No API needed.

### Implementation

`supabase/functions/extract-bat-core/index.ts`

Entry point: `complete-bat-import` (orchestrator that calls `extract-bat-core` + `extract-auction-comments`)

### Fetch Strategy

Direct HTTP GET with randomized user agent and timing jitter:

```typescript
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
  // 5 variants
];
const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

// Jitter to reduce bot patterns
const delayMs = Math.random() * 500 + 200;
await new Promise(r => setTimeout(r, delayMs));

const resp = await fetch(url, {
  redirect: "manual",  // Detect rate limiting redirects
  headers: {
    "User-Agent": userAgent,
    "Accept": "text/html,...",
    "Referer": "https://www.google.com/",
  },
  signal: AbortSignal.timeout(30000),
});
```

### Rate Limiting Detection

BaT rate-limits by redirecting to a login page:

```typescript
if (resp.status === 301 || resp.status === 302) {
  const location = resp.headers.get("location") || "";
  if (location.includes("/account/login")) {
    throw new Error("RATE_LIMITED: Redirected to login");
  }
}

// Also detect login page in response body
if (html.includes('id="login-form"') || html.includes('action="/account/login"')) {
  throw new Error("RATE_LIMITED: Got login page instead of listing");
}
```

### Data Structure

BaT HTML has highly structured data:

- **Identity**: `<h1 class="post-title">`, `og:title` meta tag, URL slug
- **Essentials block**: `<div class="essentials">` with seller, location, lot, specs
- **Listing Details**: `<ul>` after `<strong>Listing Details</strong>` with VIN, mileage, colors, transmission, engine
- **Auction Result table**: `<table id="listing-bid">` with sold/RNM status, price, buyer
- **Gallery**: `data-gallery-items` JSON attribute on gallery div
- **Description**: `<div class="post-excerpt">` or `<div class="post-content">`
- **Comments**: Separate scrape via `extract-auction-comments`

### Data Quality

**Excellent.** BaT listings are editorially curated. Key characteristics:
- Year/make/model always present and accurate
- VIN present in ~80% of listings
- Mileage present in ~90%
- Price (sold or high bid) always present for ended auctions
- 20-100+ photos per listing
- Rich descriptions (1,000-5,000 words)
- Comments section with expert analysis

### Rate Limits

- **Practical limit**: ~100-200 requests/hour before triggering login redirects
- **Mitigation**: Random UA rotation, timing jitter, Google referer
- **Recovery**: Wait 10-30 minutes after being rate-limited

### Current Scale

- 141K vehicles extracted
- 11.5M comments
- 30M images (URLs)
- 137K descriptions (107 AI-extracted)

---

## Facebook Marketplace

### Access Method

**Logged-out GraphQL endpoint.** No authentication tokens required. Residential IP address required (datacenter IPs are blocked).

### Implementation

`scripts/fb-marketplace-local-scraper.mjs` (runs locally on residential IP)

### The GraphQL Discovery

The key discovery is that Facebook's Marketplace GraphQL API works without any authentication from residential IPs:

```typescript
const body = new URLSearchParams({
  doc_id: "33269364996041474",  // This is the magic document ID
  variables: JSON.stringify({
    buyLocation: { latitude: lat, longitude: lng },
    categoryIDArray: [807311116002614],  // Vehicles category
    count: 24,
    cursor,
    radius: 65000,
    priceRange: [0, 214748364700],
    topicPageParams: { location_id: location, url: "vehicles" },
  }),
  __a: "1",
  __comet_req: "15",
  server_timestamps: "true",
});

const resp = await dnsFetch("https://www.facebook.com/api/graphql/", {
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

### What Works and What Does Not

| Feature | Status | Notes |
|---------|--------|-------|
| Price filter | Works | Via `priceRange` parameter |
| Year/make filter | Broken | API ignores these parameters; must filter by title parsing |
| Pagination | Works perfectly | Zero overlap across 10+ pages using cursor |
| Max per page | 24 | Hard cap |
| Cross-city queries | Works | Different lat/lng, no per-city tokens needed |
| Images | Works | Multiple images via `images.edges[].node.image.uri` |
| Location data | Works | Per-listing lat/lng from GraphQL |
| Seller info | Works | `seller_id` + `seller_name` from edges |
| Description | Works | Via `redacted_description.text` |

### Geographic Coverage

The scraper covers 58 US metro areas. The listing universe is geographically fragmented -- each metro area returns a different set of vehicles. ~500-1000 metro areas would cover the full US market.

```typescript
const METRO_AREAS = {
  austin: { lat: 30.2672, lng: -97.7431, label: "Austin, TX" },
  dallas: { lat: 32.7767, lng: -96.797, label: "Dallas, TX" },
  // ... 56 more metros
};
```

### Rate Limiting

- **Conservative limit**: 2-3 second delay between pages, 5-10 seconds between cities
- **Rate limit detection**: HTTP 429 or response shape changes
- **Strategy**: Skip city on rate limit, abort only after 3 consecutive failures
- **Group rotation**: `--group 1-4` flag splits 58 cities into 4 groups for staggered scheduling

```typescript
let consecutiveRateLimits = 0;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
// After hitting a rate limit on one city, add a 30-second extra delay
```

### DNS Workaround

Both the iPhoto intake and FB Marketplace scripts use custom DNS resolution because macOS `getaddrinfo()` fails during long-running Node.js processes:

```typescript
const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customLookup(hostname, opts, cb) {
  dnsResolver.resolve4(hostname, (err, addrs) => {
    if (err) return cb(err);
    cb(null, addrs[0], 4);
  });
}
```

### Image Handling

Facebook CDN URLs expire, so images are downloaded during scraping and stored in Supabase Storage:

```typescript
async function downloadAndStoreImage(sourceUrl, vehicleId, index) {
  const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000) });
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length < 5000) return null;  // Skip tiny images

  const storagePath = `${vehicleId}/fb-marketplace/${Date.now()}-${index}.${ext}`;
  await supabase.storage.from("vehicle-photos")
    .upload(storagePath, buffer, { contentType });

  return supabase.storage.from("vehicle-photos").getPublicUrl(storagePath).data?.publicUrl;
}
```

### Vintage Vehicle Filtering

The scraper targets pre-2006 vehicles (collector vehicle market):

```typescript
const YEAR_MIN = 1920;
const YEAR_MAX = 2006;
```

Year is extracted from the listing title (since the year filter API parameter is broken).

### Data Quality

**Low but broad.** Facebook Marketplace listings are seller-written with minimal structure:
- Year/make/model: Usually in title, requires title parsing
- VIN: Almost never provided
- Mileage: Sometimes in description
- Price: Always present (it is a required field)
- Images: 1-10 photos, CDN URLs expire
- Description: Variable quality, often just a few sentences

National vintage rate: ~12% of all vehicle listings are pre-2006.

### Usage

```bash
# Scrape all 58 metros, 50 pages each
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50

# Scrape a single city
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --max-pages 10

# Scrape group 2 of 4 (for staggered scheduling)
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50 --group 2

# Dry run (scrape but don't write to DB)
dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --dry-run
```

### Saved Items Pipeline (Automatic)

A separate pipeline extracts vehicles the user saves on Facebook Marketplace. Unlike the geographic sweep (which discovers new listings across metros), this pipeline captures vehicles the user has already identified as interesting.

**Architecture**: Two-phase extraction via AppleScript + curl, running as a macOS LaunchAgent.

```
User saves vehicle on FB Marketplace
    ↓ (≤30 min — LaunchAgent fires)
fb-saved-sync.sh
    Phase 1: AppleScript → Chrome → facebook.com/saved
             Auto-scrolls, parses DOM for titles/prices/sellers/images
             Returns JSON array of vehicles
    Phase 2: curl POSTs batch to extract-facebook-marketplace (mode: "batch")
    ↓
marketplace_listings (upserted, tagged source=facebook_saved)
    ↓ (5 min cron: fb-marketplace-refine)
refine-fb-listing → title parsing, structured field extraction
    ↓ (5 min cron: fb-marketplace-import)
import-fb-marketplace → vehicle record created (image gate bypassed for saved items)
    ↓ (5-10 min crons: enrich-fb-marketplace-*)
enrich-bulk → description mining for VIN, engine, transmission, colors
    ↓
Fully resolved vehicle profile (~35-50 min from save to complete)
```

**Why two phases?** Facebook's Content Security Policy blocks cross-origin `fetch()` from their pages. The browser JS extracts data from the DOM, but the HTTP POST to Supabase must happen outside the browser via `curl`.

**Key implementation details:**

| Component | File | What it does |
|-----------|------|-------------|
| LaunchAgent | `~/Library/LaunchAgents/com.nuke.fb-saved-sync.plist` | Fires every 30 min |
| Sync script | `scripts/fb-saved-sync.sh` | AppleScript + curl orchestrator |
| Batch endpoint | `extract-facebook-marketplace` (mode: "batch") | Upserts array of saved items |
| Extractor JS | `scripts/fb-saved-extractor.js` | Standalone version (console/bookmarklet) |

**Requirements:**
- Chrome open with a facebook.com tab (any FB page works — script navigates to /saved)
- Chrome → View → Developer → Allow JavaScript from Apple Events (one-time toggle)
- Skips silently if Chrome is closed or no FB tab exists

**Saved items bypass the image quality gate** in `import-fb-marketplace`. Geographic sweep listings are blocked without images (too much garbage), but saved items are user-curated — if someone saved it, it's a real vehicle. Images are backfilled later by the enrichment pipeline.

**Description enrichment** requires a residential IP (Facebook blocks cloud/datacenter IPs on individual listing pages). The Playwright-based enricher runs locally:

```bash
# Enrich all saved items missing descriptions
dotenvx run -- bash -c '
for fid in $(psql -t -A "$DATABASE_URL" -c "
  SELECT facebook_id FROM marketplace_listings
  WHERE raw_scrape_data->'\''agent_context'\''->>'\'session_type'\'' = '\''facebook_saved'\''
    AND description IS NULL AND status = '\''active'\''"); do
  node scripts/fb-marketplace-enricher.mjs --facebook-id "$fid"
done'
```

**Observed data quality from saved items (75 vehicles, March 2026):**

| Field | Fill Rate | Source |
|-------|-----------|--------|
| Year/Make/Model | 100% | Title parsing |
| Price | 99% | DOM extraction |
| Seller | 100% | DOM extraction |
| Description | 96% | Playwright fetch from residential IP |
| Mileage | 31% | Mined from description |
| Transmission | 35% | Mined from description |
| Images | 9% | CDN URLs expire; needs download pipeline |
| VIN | 0% | FB sellers almost never include VINs |

---

## Cars and Bids

### Access Method

**Firecrawl (JS SPA).** Cars and Bids is a JavaScript single-page application. Direct `fetch()` returns an empty shell. Firecrawl renders the page in a headless browser.

### Implementation

`supabase/functions/extract-cars-and-bids-core/index.ts`

### Fetch Strategy

```typescript
const { html, markdown } = await archiveFetch(url, {
  platform: "carsandbids",
  useFirecrawl: true,
  waitForJs: 3000,  // Wait 3 seconds for JS rendering
  includeMarkdown: true,
});
```

### Data Quality

**Good.** Similar to BaT but with less editorial curation. Structured data in the rendered HTML.

### Rate Limits

Firecrawl handles rate limiting. Each scrape costs ~$0.01.

---

## PCarMarket

### Access Method

**API + Firecrawl fallback.** PCarMarket has a structured API that provides clean JSON data. For pages not covered by the API, Firecrawl is used.

### Implementation

`supabase/functions/import-pcarmarket-listing/index.ts`

### Data Quality

**Good.** PCarMarket is an enthusiast-focused platform with detailed listings. Porsche-heavy.

---

## Craigslist

### Access Method

**Direct HTML fetch.** Craigslist pages are simple HTML. No JavaScript rendering needed.

### Implementation

`supabase/functions/extract-craigslist/index.ts`

Discovery: `supabase/functions/discover-cl-squarebodies/index.ts` (specialized for square-body Chevrolet trucks)

### Data Structure

Craigslist vehicle listings have:
- Title with year/make/model (often abbreviated)
- Price in `<span class="price">`
- Description in `<section id="postingbody">`
- Images in `<div id="thumbs">`
- Location in posting metadata

### Data Quality

**Low.** Seller-written, highly variable. Common issues:
- No VIN
- Incorrect year/make/model in title
- Price may be "$1" (placeholder)
- Images are low quality
- Listings disappear within days

### Rate Limits

Craigslist aggressively blocks scrapers. Rate limit to 1 request per 5-10 seconds per city.

---

## Mecum Auctions

### Access Method

**Firecrawl required.** Mecum's website is a JavaScript SPA with Cloudflare protection.

### Implementation

`supabase/functions/extract-mecum/index.ts`

### Data Quality

**Moderate.** Mecum is a volume auctioneer (10,000+ lots per year). Lot descriptions are shorter than BaT but structured.

### Challenges

- Cloudflare bot detection frequently blocks scraping
- Lot pages may change structure between auction events
- Results (sold/not sold) are not always available programmatically

---

## Barrett-Jackson

### Access Method

**Firecrawl required.** Barrett-Jackson uses a Cloudflare-protected JS SPA.

### Implementation

`supabase/functions/extract-barrett-jackson/index.ts`

### Challenges

Barrett-Jackson's Cloudflare protection is aggressive. The garbage detection in `archiveFetch.ts` specifically handles their empty shell responses:

```typescript
if (platform === "barrett-jackson") {
  const hasVehicleData = /\d{4}\s*Year/i.test(html) ||
    /"vehicle":\{/i.test(html) ||
    /"@type"\s*:\s*"(?:Vehicle|Product|Car)"/i.test(html);
  if (!hasVehicleData && html.length < 50000) return true;  // garbage
}
```

---

## RM Sotheby's / Gooding / Bonhams

### Access Method

**Firecrawl for all three.** All are JavaScript SPAs.

### Implementations

- `supabase/functions/extract-rmsothebys/index.ts`
- `supabase/functions/extract-gooding/index.ts`
- `supabase/functions/extract-bonhams/index.ts`

### Data Quality

**Excellent.** These are premium auction houses. Lot descriptions are extensive (2,000-10,000 words), professionally photographed (50-200+ images), and include provenance, condition reports, and expert commentary.

### Challenges

Bonhams uses a Next.js SPA that returns an empty shell to bots. The garbage detector specifically handles this:

```typescript
if (platform === "bonhams") {
  const hasNextShell = lower.includes("__next_data__");
  const hasLotContent = /<h[12][^>]*>[^<]*\d{4}\s+[A-Z]/i.test(html);
  if (hasNextShell && !hasLotContent) return true;  // garbage
}
```

---

## Generic Extraction (Firecrawl + AI)

### Access Method

For any source without a dedicated extractor, the system uses Firecrawl to render the page and then passes the content to Claude for AI extraction.

### Implementation

`supabase/functions/extract-vehicle-data-ai/index.ts`

### Flow

```
Unknown URL
  |
  v
archiveFetch(url, { useFirecrawl: true })
  |
  v
[Firecrawl renders page, returns HTML + markdown]
  |
  v
[Archive to listing_page_snapshots]
  |
  v
[callTier("haiku", LISTING_EXTRACTION_SYSTEM, markdown)]
  |
  v
[normalizeVehicleFields(extracted)]
  |
  v
[qualityGate(extracted)]
  |
  v
[Upsert vehicle record]
```

### When to Use

- New/unknown auction platforms
- Dealer websites
- Forum build threads
- Magazine articles
- Any URL that is not covered by a dedicated extractor

### Cost

Each generic extraction costs:
- Firecrawl scrape: ~$0.01
- Haiku extraction: ~$0.001 (1,500 input tokens, 500 output tokens)
- Total: ~$0.011 per URL

---

## How to Add a New Scraping Source

### Decision Tree

```
Is the site a JS SPA?
  YES -> Use Firecrawl via archiveFetch({ useFirecrawl: true })
  NO  -> Use direct fetch via archiveFetch()

Does the site have an API?
  YES -> Use the API, supplement with archiveFetch for HTML evidence
  NO  -> Parse HTML with regex/DOM

Is the HTML structure consistent?
  YES -> Write a deterministic parser (like extract-bat-core)
  NO  -> Use AI extraction (like haiku-extraction-worker)

Does the site require authentication?
  YES -> Consider if the data is available without auth (check logged-out access)
  NO  -> Proceed with scraping

Does the site use Cloudflare/bot protection?
  YES -> Firecrawl handles most bot protection
         If Firecrawl fails, may need residential IP or browser automation
  NO  -> Direct fetch works
```

### Required Steps

1. **Discover the data** (Chapter 2, Schema Discovery Principle)
2. **Register the source** in `observation_sources`
3. **Write the extractor** following patterns from `extract-bat-core`
4. **Add URL routing** in `process-import-queue`
5. **Add to TOOLS.md**
6. **Deploy and test**
7. **Add a source-specific garbage detector** in `archiveFetch.ts` if needed

---

## Known Problems

1. **No centralized rate limit tracking.** Each extractor manages its own rate limiting independently. If two workers hit BaT simultaneously, they both get rate-limited. A shared rate limit counter (in Redis or Postgres) would coordinate access.

2. **Firecrawl is a single point of failure.** If Firecrawl is down, all JS SPA sources (Cars & Bids, Mecum, Bonhams, etc.) cannot be scraped. There is no fallback to Playwright or other rendering services.

3. **No residential IP management.** The FB Marketplace scraper runs on the developer's local machine. A managed residential proxy service would enable running this from cloud infrastructure.

4. **CDN URL expiration is not tracked.** There is no system that detects when an `image_url` in `vehicle_images` has expired. A periodic check that HEAD-requests image URLs and flags dead ones would prevent broken images in the frontend.

5. **No robots.txt compliance checking.** The system does not automatically check or respect robots.txt directives. This is a legal and ethical consideration that should be addressed.

6. **Scraping frequency is not adaptive.** The system scrapes at fixed intervals regardless of how frequently the source publishes new content. An adaptive schedule that increases frequency during active auction periods and decreases during quiet periods would be more efficient.
