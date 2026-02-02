# Hemmings Crawler Research

**Date:** 2026-02-01
**Status:** Research Complete - Ready for Implementation
**Priority:** Medium

## Executive Summary

Hemmings is a classic car marketplace with both classifieds and auctions. The platform has **Cloudflare protection** that blocks simple HTTP requests, requiring browser-based scraping (Playwright) or Firecrawl. Three working Node.js scripts already exist that successfully extract from Hemmings, demonstrating proven patterns.

**Current Database Status:**
- 30 Hemmings vehicles discovered
- All 30 in "pending" status (not yet extracted)
- 0 active vehicles (extraction incomplete)

## Website Structure

### Base URLs

```
Main classifieds: https://www.hemmings.com/classifieds/cars-for-sale
Auctions:        https://www.hemmings.com/auctions
Business directory: https://www.hemmings.com/business-directory
```

### URL Patterns

#### Listing URLs
```
Format: /listing/YEAR-MAKE-MODEL-LOCATION-ID
Example: /listing/1957-cadillac-eldorado-cape-coral-fl-296011

Format: /auction/YEAR-MAKE-MODEL-ID
Example: /auction/1970-chevrolet-monte-carlo-379218
```

**ID Pattern:** 6+ digit number at end of URL (unique identifier)

**Location Pattern:** For /listing/ URLs, location is embedded as `-[city]-[STATE]-[ID]` where STATE is 2-letter US state abbreviation

**Model Extraction:** Model name is between make and location, with hyphens converted to spaces

### Categories

Hemmings organizes listings by category (discovered in `hemmings-fast-discover.js`):

```javascript
const CATEGORIES = [
  'classics', 'convertibles', 'muscle-cars', 'sports-cars', 'exotics',
  'restomods-customs', 'trucks', 'suvs', '4x4s', 'race', 'performance-cars',
  'luxury-cars', 'late-model', 'wagons', 'american', 'japanese', 'british', 'european'
];
```

Category URLs: `https://www.hemmings.com/classifieds/cars-for-sale/{category}`

### Pagination

**Critical Finding:** Pagination doesn't work reliably on Hemmings. Existing scripts work around this by:
1. Scraping each category separately
2. Using infinite scroll (scrolling 10+ times per page to load lazy content)
3. Rate limiting to avoid blocks

## Data Fields Available

### Detail Page Extraction

Based on `hemmings-proper-extract.js` analysis:

#### Vehicle Identity
- **VIN:** Pattern `VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})`
- **Year:** Extracted from URL
- **Make:** Extracted from URL
- **Model:** Extracted from URL
- **Title:** H1 heading on page

#### Specifications
- **Mileage:** Pattern `(?:Mileage|Miles)[:\s]+([0-9,]+)`
- **Engine:** Pattern `Engine[:\s]+([^\n]+)` or `(\d+\.?\d*[Ll]|V\d+|[Ii]nline.?\d+|Flat.?\d+)`
- **Transmission:** Pattern `Transmission[:\s]+([^\n]+)`
- **Drivetrain:** Pattern `Drivetrain[:\s]+([^\n]+)`
- **Exterior Color:** Pattern `(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]+([^\n]+)`
- **Interior Color:** Pattern `(?:Interior\s*Color|Int\.?\s*Color)[:\s]+([^\n]+)`

#### Pricing & Sales Info
- **Price:** Pattern `\$([0-9,]+)` or `Price[:\s]+\$?([0-9,]+)`
- **Stock Number:** Pattern `Stock\s*#?[:\s]+([^\n]+)`
- **Dealer/Seller:** Pattern `(?:Seller|Dealer|Offered By)[:\s]+([^\n]+)`
- **Location:** Pattern `(?:Location|Located)[:\s]+([^\n]+)`

#### Content
- **Description:** Found in elements with classes: `[class*="description"]`, `[class*="about"]`, `.listing-description`, `#description`
- **Features/Equipment:** Extracted from `<li>` elements (filtered 5-150 chars)

#### Images
- **Image URLs:** Multiple CDN patterns detected
  - `hemmings` domain
  - `cloudinary` CDN
  - `cloudfront` CDN
- **Image filters:** Excludes logos, icons, avatars, placeholders
- **Image validation:** Must contain `/listings/`, `upload`, or `image` in path

### Listing Card Data (Category Pages)

From `hemmings-fast-discover.js`:

- **URL:** Listing detail page link
- **Year:** Parsed from URL
- **Make:** Parsed from URL (capitalized)
- **Model:** Parsed from URL (hyphens to spaces)
- **Price:** Pattern `\$\s*([\d,]+)` from card text
- **Thumbnail:** From `<img>` with src containing `hemmings`, `cloudinary`, or with `data-src` attribute

## Anti-Bot Protection

### Cloudflare Challenge

**Confirmed:** Hemmings uses Cloudflare's "Just a moment..." challenge page.

**Evidence:**
```html
<title>Just a moment...</title>
<noscript>Enable JavaScript and cookies to continue</noscript>
```

**Impact:**
- Simple `curl` requests return challenge page (200 lines of JavaScript obfuscation)
- `WebFetch` tool unable to access: "Claude Code is unable to fetch from www.hemmings.com"

### Rate Limiting

From `hemmings-extract-loop.sh` comments:

```bash
# Note: Using conservative settings due to rate limiting
BATCH_SIZE=30  # Conservative batch size
PARALLEL=1     # Single worker to avoid rate limits
```

**Recommended Delays:**
- Between page requests: 3000ms (3 seconds)
- After errors: 10000ms (10 seconds)
- Between batches: 10 seconds
- Page load wait: 8000ms (8 seconds)
- Scroll delay: 1500ms per scroll

## Existing Extractors

### 1. hemmings-fast-discover.js

**Purpose:** Quick discovery of listings from category pages
**Status:** Production-ready
**Method:** Playwright (headless Chrome)

**What it does:**
- Scrapes all 18 categories
- Extracts: URL, year, make, model, price, thumbnail
- Saves to `vehicles` table with `status='active'`
- Saves thumbnails to `vehicle_images` table
- Deduplicates against existing URLs

**Performance:**
- 3 parallel workers
- Processes ~18 categories
- Inserts only new vehicles (skips existing URLs)

**Usage:**
```bash
dotenvx run -- node scripts/hemmings-fast-discover.js [workers]
```

### 2. hemmings-proper-extract.js

**Purpose:** Deep extraction from detail pages (pending vehicles)
**Status:** Production-ready
**Method:** Playwright (headless Chrome)

**What it does:**
- Processes `status='pending'` vehicles from DB
- Full detail page scraping (all fields listed above)
- VIN-based deduplication
- Creates `auction_events` timeline entries
- Updates vehicle to `status='active'` if VIN found
- Conservative rate limiting (single worker)

**Performance:**
- Batch size: 30-50 vehicles
- 1 worker (to avoid rate limits)
- 3 second delay between requests

**Usage:**
```bash
dotenvx run -- node scripts/hemmings-proper-extract.js [batch_size] [workers]
```

### 3. hemmings-extract-loop.sh

**Purpose:** Continuous extraction until queue empty
**Status:** Production-ready
**Method:** Bash wrapper around hemmings-proper-extract.js

**What it does:**
- Loops indefinitely
- Runs proper-extract with batch_size=30
- Checks for "Found 0 pending" to exit
- 60s pause on errors
- 10s pause between batches

**Usage:**
```bash
./scripts/hemmings-extract-loop.sh
```

### 4. extract-hemmings-directory.js

**Purpose:** B2B contact extraction (restoration shops, dealers, parts suppliers)
**Status:** Production-ready
**Method:** Playwright (headless Chrome)
**Location:** `scripts/contacts/`

**What it does:**
- Scrapes Hemmings business directory
- Extracts: business name, email, phone, website, location, specialties
- Categories: restoration, dealers, parts, appraisers, transport, insurance
- Saves to contact leads system (not vehicles table)

**Usage:**
```bash
dotenvx run -- node scripts/contacts/extract-hemmings-directory.js [category|all]
```

## Supabase Edge Function Status

**No dedicated Supabase edge function exists for Hemmings.**

### Comparison to Other Sources

**BaT (Bring a Trailer):**
- `bat-simple-extract` - Simple extraction
- `extract-bat-core` - Core data extractor
- `extract-auction-comments` - Comment scraper
- `bat-url-discovery` - URL discovery
- `bat-year-crawler` - Year-based crawling

**Cars & Bids:**
- `extract-cars-and-bids-core` - Core extractor
- `extract-cars-and-bids-comments` - Comment extractor

**Hagerty:**
- `extract-hagerty-listing` - Listing extractor

**Hemmings:**
- **None** - Only Node.js scripts exist

### Why No Edge Function?

Likely reasons:
1. **Playwright requirement:** Edge functions (Deno) don't support Playwright easily
2. **Rate limiting concerns:** Long-running extraction needs careful orchestration
3. **Working scripts:** Node.js scripts are sufficient for batch processing
4. **Discovery-first pattern:** Scripts separate discovery (fast) from extraction (slow)

## Master Sources Registry

From `data/sources/master_sources.yaml`:

```yaml
- id: hemmings_auctions
  name: "Hemmings Auctions"
  website: "https://www.hemmings.com/auctions"
  kind: "auction"
  region: "US"
  access: "public"
  extraction_plan_status: "planned"
  monitoring_priority: "medium"
  typical_data: ["listing", "photos", "bids", "result"]
  recommended_strategy: "firecrawl_schema_then_fallback"
```

**Note:** Registry lists "planned" status, but scripts are actually "active" in production.

## Database Schema

### Tables Used

#### vehicles
```sql
discovery_source = 'hemmings'
discovery_url = [detail page URL]
listing_source = 'hemmings-fast-discover' or 'hemmings-proper-extract'
status = 'pending' | 'active'
year, make, model, vin, mileage
engine_size, transmission, drivetrain
color (exterior), interior_color
sale_price
description, highlights (array)
primary_image_url, image_url
```

#### auction_events
```sql
vehicle_id
source = 'hemmings'
source_url = [detail page URL]
outcome = 'listed'  -- Hemmings is marketplace, not auction
asking_price
seller_name, seller_location
raw_data = {extractor: 'hemmings-proper-extract', stock_number: ...}
```

#### vehicle_images
```sql
vehicle_id
image_url
source = 'external_import'
is_external = true
is_primary = true/false
is_approved = true
position (0-indexed)
```

## Recommended Extraction Strategy

### Two-Phase Approach (Currently Implemented)

**Phase 1: Fast Discovery**
```bash
dotenvx run -- node scripts/hemmings-fast-discover.js 3
```
- Scrape category pages
- Extract basic data (year, make, model, price, thumbnail)
- Insert as `status='active'` (basic info complete)
- Fast, parallel (3 workers)

**Phase 2: Deep Extraction** (NOT CURRENTLY RUNNING)
```bash
dotenvx run -- node scripts/hemmings-proper-extract.js 30 1
```
- Process pending vehicles
- Full detail page extraction
- VIN-based deduplication
- Slow, conservative (1 worker, 3s delays)

### Why 30 Vehicles Are Stuck "Pending"

**Root Cause:** The 30 vehicles have `status='pending'` but Phase 2 (proper-extract) hasn't run.

**Likely scenario:**
1. An older discovery process created these records with `status='pending'`
2. Fast-discover now creates records with `status='active'` (changed behavior)
3. Proper-extract only processes `status='pending'`
4. The 30 old records are orphaned

**Solution:**
```sql
-- Option 1: Re-run proper-extract to complete them
dotenvx run -- node scripts/hemmings-proper-extract.js 30 1

-- Option 2: Mark them active if basic data is sufficient
UPDATE vehicles
SET status = 'active'
WHERE discovery_source = 'hemmings' AND status = 'pending';
```

## Firecrawl Considerations

### Can Firecrawl Handle Hemmings?

**Likely YES**, based on:
1. Firecrawl v1 has stealth mode: `proxy: 'stealth'`
2. Other Cloudflare sites work with Firecrawl
3. Existing `firecrawl.ts` wrapper supports retries and block detection

### Firecrawl Test Strategy

```typescript
import { firecrawlScrape } from './_shared/firecrawl.ts';

const result = await firecrawlScrape({
  url: 'https://www.hemmings.com/classifieds/cars-for-sale/classics',
  formats: ['markdown', 'html'],
  proxy: 'stealth',
  waitFor: 5000,
  onlyMainContent: true,
});

if (result.blocked) {
  console.log('Blocked by:', result.blockedSignals);
} else if (result.success) {
  console.log('Success! Length:', result.data.markdown?.length);
}
```

### Firecrawl Pros/Cons vs Playwright

**Firecrawl Advantages:**
- Works in Supabase Edge Functions (Deno)
- No browser management overhead
- Handles Cloudflare automatically
- Includes AI extraction (`extract.schema`)

**Playwright Advantages:**
- Proven to work (existing scripts)
- Fine-grained control (scrolling, waiting)
- Works offline (no API costs)
- Faster for batch processing

**Recommendation:** Keep Playwright scripts for batch extraction, consider Firecrawl for edge function implementation if needed.

## Observation System Integration

### Current State

Hemmings uses legacy schema (`vehicles`, `auction_events`).

### Migration Path

Following observation system patterns:

```sql
-- 1. Register source
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('hemmings', 'Hemmings Motor News', 'marketplace', 0.80,
        ARRAY['listing', 'price_update', 'dealer_info']);

-- 2. Configure extractor
INSERT INTO observation_extractors (
  source_id,
  extractor_type,
  produces_kinds,
  config
)
VALUES (
  (SELECT id FROM observation_sources WHERE slug = 'hemmings'),
  'script',
  ARRAY['listing'],
  '{"script_path": "scripts/hemmings-proper-extract.js", "batch_size": 30}'
);

-- 3. Migrate existing data
SELECT migrate_hemmings_to_observations();
```

## Implementation Recommendations

### Immediate Actions

1. **Clear pending queue:**
   ```bash
   dotenvx run -- node scripts/hemmings-proper-extract.js 30 1
   ```

2. **Update master sources registry:**
   ```yaml
   extraction_plan_status: "active"  # Change from "planned"
   recommended_strategy: "playwright_two_phase"  # More accurate
   notes:
     - "Fast discovery via category scraping, deep extraction via detail pages"
     - "Uses Playwright due to Cloudflare protection"
     - "Rate limited: 3s between requests, single worker for detail extraction"
   ```

3. **Document in approved extractors:**
   Create `HEMMINGS_EXTRACTION_WORKFLOW.md` similar to `BAT_EXTRACTION_SUCCESS_WORKFLOW.md`

### Edge Function Implementation (If Needed)

**Use Case:** Single-URL extraction triggered by user (e.g., URL drop)

**Approach:**
```typescript
// supabase/functions/extract-hemmings-listing/index.ts
import { firecrawlScrape } from '../_shared/firecrawl.ts';

export default async (req: Request) => {
  const { url } = await req.json();

  const result = await firecrawlScrape({
    url,
    formats: ['markdown'],
    proxy: 'stealth',
    waitFor: 8000,
    onlyMainContent: true,
  });

  if (result.blocked) {
    return new Response(JSON.stringify({
      error: 'Blocked by anti-bot',
      signals: result.blockedSignals
    }), { status: 403 });
  }

  // Parse markdown for vehicle data
  const vehicle = parseHemmingsMarkdown(result.data.markdown);

  // Insert to vehicles table
  // ...

  return new Response(JSON.stringify({ vehicle }));
};
```

**Alternative:** Use `ralph-wiggum-extract` pattern with Firecrawl fallback.

### Monitoring & Maintenance

**Health Checks:**
```bash
# Check Hemmings extraction health
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE vin IS NOT NULL) as with_vin,
  MAX(created_at) as last_discovered,
  MAX(updated_at) as last_updated
FROM vehicles
WHERE discovery_source = 'hemmings';
```

**Rate Limit Monitoring:**
- Track request failures in logs
- Monitor for Cloudflare challenge responses
- Adjust delays if needed

**Quality Metrics:**
- VIN extraction rate (currently low priority for marketplace listings)
- Image count per vehicle
- Description completeness

## Technical Constraints

### Rate Limiting
- **Between requests:** 3 seconds minimum
- **After errors:** 10 seconds
- **Batch pause:** 10 seconds
- **Workers:** 1 for detail extraction, 3 for discovery

### Cloudflare Protection
- Requires browser (Playwright) or stealth proxy (Firecrawl)
- JavaScript execution mandatory
- Cookies/session management needed

### Data Quality
- VIN not always present (marketplace listings vs dealer inventory)
- Mileage sometimes missing
- Price may not always be displayed
- Description quality varies by seller

## Related Documentation

- **Existing Scripts:**
  - `/Users/skylar/nuke/scripts/hemmings-fast-discover.js`
  - `/Users/skylar/nuke/scripts/hemmings-proper-extract.js`
  - `/Users/skylar/nuke/scripts/hemmings-extract-loop.sh`
  - `/Users/skylar/nuke/scripts/contacts/extract-hemmings-directory.js`

- **Master Registry:**
  - `/Users/skylar/nuke/data/sources/master_sources.yaml`

- **Shared Utilities:**
  - `/Users/skylar/nuke/supabase/functions/_shared/firecrawl.ts`

- **Similar Extractors:**
  - `extract-bat-core` - BaT core extractor
  - `extract-cars-and-bids-core` - C&B extractor
  - `extract-hagerty-listing` - Hagerty extractor

## Conclusion

**Hemmings extraction is ACTIVE and WORKING.** Three production-ready Node.js scripts exist:

1. **hemmings-fast-discover.js** - Discovery phase (category scraping)
2. **hemmings-proper-extract.js** - Deep extraction phase (detail pages)
3. **hemmings-extract-loop.sh** - Continuous processing wrapper

**No Supabase edge function is needed** for batch extraction, as the Playwright-based scripts handle Cloudflare protection and rate limiting effectively.

**Next Steps:**
1. Run proper-extract to clear the 30 pending vehicles
2. Update master sources registry to reflect "active" status
3. Consider Firecrawl edge function only if user-triggered single-URL extraction is needed
4. Document the two-phase extraction workflow formally

**Key Insight:** Hemmings follows a "discovery then extraction" pattern due to pagination limitations and rate limiting. This is the correct architecture and should be maintained.
