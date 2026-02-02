# Collecting Cars Crawler Research

**Date**: 2026-02-01
**Status**: Research complete - ready for implementation
**Priority**: High (Tier 1 platform, 24/7 global auctions)

---

## Executive Summary

Collecting Cars is a UK-based 24/7 online auction platform for classic, sports, and performance cars. The site uses Cloudflare protection, requires JavaScript rendering, and uses Algolia for product listings. An archived monitoring function exists but needs modernization.

**Key Findings:**
- Cloudflare WAF blocks simple HTTP requests (403)
- Requires Playwright/Firecrawl for JS rendering
- Uses Algolia API for auction listings (client-side JSON)
- Existing infrastructure: archived monitor function, database records, comparison test data
- URL pattern: `https://collectingcars.com/for-sale/{listing-slug}`
- Image CDN: `https://images.collectingcars.com/`

---

## Platform Overview

| Aspect | Details |
|--------|---------|
| **Base URL** | https://collectingcars.com |
| **Founded** | 2018 by Edward Lovett |
| **Location** | UK-based, 24/7 global operations |
| **Currency** | GBP (£) primarily |
| **Focus** | Classic, sports, and performance cars |
| **Auction Duration** | ~7 days (typical) |
| **Soft Close** | Yes |
| **Fee Structure** | 6% buyer's premium for cars/bikes, 10% for parts/plates |

---

## URL Patterns

### Results/Listings Page
```
https://collectingcars.com/results
https://collectingcars.com/for-sale
```

### Individual Listing
```
https://collectingcars.com/for-sale/{listing-slug}

Examples:
- https://collectingcars.com/for-sale/2004-ferrari-360-challenge-stradale-12
- https://collectingcars.com/for-sale/1989-porsche-911-carrera-3-2-targa-g50
```

### Image CDN Pattern
```
https://images.collectingcars.com/{listing-id}/{image-filename}.jpg?w={width}&q={quality}

Parameters:
- w: width (e.g., 828, 1263, 189, 315)
- q: quality (75, 85)
- fit: fillmax, crop
- crop: edges
- auto: format,compress
- cs: srgb
- h: height (optional, for cropping)
```

---

## Data Fields Available

Based on existing extraction attempts and monitor function analysis:

### Core Auction Data
- **current_bid**: Integer (GBP, extracted via regex patterns)
- **bid_count**: Integer (number of bids)
- **watcher_count**: Integer (users watching/following)
- **auction_status**: `active`, `sold`, `ended`
- **auction_end_date**: ISO timestamp
- **reserve_met**: Boolean
- **final_price**: Integer (if sold)
- **sold_at**: Timestamp (if sold)

### Vehicle Data
- **title**: String (full listing title)
- **year**: Integer
- **make**: String
- **model**: String
- **vin**: String (if available)
- **mileage**: Integer
- **exterior_color**: String
- **interior_color**: String
- **transmission**: String
- **engine**: String
- **location**: String (often includes country flag)
- **description**: Text

### Media
- **image_urls**: Array of strings (high-res gallery images)
- **thumbnail_urls**: Array of strings (preview images)

### Seller Info
- **seller_username**: String (if available)
- **seller_location**: String (country/region)

---

## Technical Implementation Details

### Anti-Bot Protection

**Cloudflare WAF**: Blocks naive HTTP requests
```bash
# This returns HTTP 403:
curl -s "https://collectingcars.com/results"

# Returns Cloudflare challenge page requiring JS execution
```

**Required Approach**: JavaScript rendering via Playwright or Firecrawl

### Extraction Comparison Data

From `/Users/skylar/nuke/extraction-comparison-results/csv/domain-breakdown.csv`:

| Domain | Tested | Success (naive) | Success (Playwright) | Avg Score (naive) | Avg Score (Playwright) | Classification |
|--------|--------|----------------|---------------------|-------------------|----------------------|----------------|
| collectingcars.com | 2 | 0.0% | 100.0% | 0.0 | 88.5 | PLAYWRIGHT_REQUIRED |

**Performance (Playwright)**:
- Extraction score: 82-95 (medium quality)
- Content size: 6,329-6,857 bytes
- Render time: ~487-859ms
- Image count: 82-95 images per listing
- Links: 340-8,527 (high count due to navigation)

### Algolia Integration

Based on recent web search findings:

Collecting Cars uses **Algolia** for product listings, fetched client-side. This means:
- Auction data available via JSON API (replicate their Algolia requests)
- Client-side filtering (region, category, status)
- Potentially cleaner than HTML scraping
- Can use tools like Postman to test API endpoints

**Note**: Internal API usage should be done carefully and is considered fragile for production use.

---

## Existing Infrastructure

### 1. Archived Monitor Function

**Location**: `/Users/skylar/nuke/supabase/functions/_archived/monitor-collecting-cars-listings/index.ts`

**Capabilities**:
- Single listing mode (by ID or URL)
- Batch mode (processes active listings from `external_listings` table)
- Uses Firecrawl API for JS rendering (fallback to naive fetch)
- Extracts: current_bid, bid_count, watcher_count, auction_status, end_date, reserve_met
- Updates both `external_listings` and `vehicles` tables
- Handles currency patterns (£, $, €)
- Multiple date extraction patterns (unix timestamp, ISO, countdown text)

**Extraction Patterns** (from archived function):

```typescript
// Bid patterns
/Current\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i
/High\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i
/Winning\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i
/"currentBid"[:\s]*[£$€]?([\d,]+)/i
/"highestBid"[:\s]*[£$€]?([\d,]+)/i
/Sold\s+for[:\s]*[£$€]?([\d,]+)/i
/Hammer\s+Price[:\s]*[£$€]?([\d,]+)/i

// Bid count
/(\d+)\s+bids?/i
/"bidCount"[:\s]*(\d+)/i

// Watcher count
/(\d+)\s+watch(?:ers?|ing)/i
/"watcherCount"[:\s]*(\d+)/i

// End date patterns
data-end-time="(\d{10,13})"
"endTime":\s*(\d{10,13})
"endsAt":\s*"([^"]+)"
/ends?\s+in[:\s]*(\d+)\s*d(?:ays?)?\s*(\d+)\s*h(?:ours?)?/i
```

### 2. Debug Script

**Location**: `/Users/skylar/nuke/scripts/debug-collecting-cars.js`

**Purpose**: Playwright-based debugging script to analyze bid-related content

**Features**:
- Launches Chromium with realistic browser context (UK locale, London timezone)
- Waits 5 seconds for dynamic content
- Extracts all bid/price/auction-related text
- Pattern matching for bid data
- Useful for refining extraction patterns

### 3. Database Records

**live_auction_platforms.sql** (`/Users/skylar/nuke/database/seeds/live_auction_platforms.sql`):
- Row 49-61: Business record for "Collecting Cars"
- Marked as `auction_house`, verified
- Description: "UK-based 24/7 global online auction platform for classic, sports and performance cars. Founded 2018 by Edward Lovett."

**live_auction_sync_registry.sql** (`/Users/skylar/nuke/database/migrations/20260129_live_auction_sync_registry.sql`):
- Row 296-312: Sync configuration
- Slug: `collecting-cars`
- Method: `polling_scrape`
- Poll interval: 60s (default), 5s (soft close)
- Rate limit: 15 req/min
- Priority: 85 (high)
- Supports proxy bidding: true
- Requires auth: true
- Notes: "UK-based, 24/7 global. Have monitor script. Need adapter."

### 4. Extraction Test Data

**Location**: `/Users/skylar/nuke/extraction-comparison-results/`

Multiple comparison runs with Collecting Cars URLs:
- `comparison-1769697624996.json`
- `comparison-1769698061701.json`
- `comparison-1769716921833.json`
- `comparison-1769717097121.json`

**Insights**:
- Consistent extraction with Playwright
- Captures vehicle data (year, make, model)
- Image extraction successful (80-95 images per listing)
- Naive fetch always fails (HTTP 403)

---

## Pagination & Discovery

### Results Page Pagination

**Unknown** - requires investigation:
- URL parameters for pagination (page number, offset, limit)
- Total results count
- Filters available (make, model, year range, price range, location, status)

**Investigation needed**:
1. Inspect Algolia API requests on `/results` or `/for-sale` pages
2. Identify query parameters for pagination
3. Document filter options
4. Test rate limits for bulk discovery

### Active Auction Discovery

**Recommended approach**:
1. Use Algolia API to fetch all active listings
2. Filter by `auction_status: active`
3. Extract listing slugs
4. Store in `live_auction_sync_registry` table
5. Schedule regular sync jobs per listing

---

## Rate Limiting & Best Practices

| Aspect | Recommendation |
|--------|---------------|
| **Default polling** | 60s (1 req/min per listing) |
| **Soft close polling** | 5s (12 req/min during final minutes) |
| **Rate limit** | 15 req/min total (all listings combined) |
| **Concurrent requests** | Max 3 simultaneous |
| **User-Agent** | Rotate realistic browser UAs |
| **Session management** | Login required for bidding, not for viewing |
| **Proxy** | Recommended for production (UK/EU IPs preferable) |

---

## Comparison to Similar Platforms

| Platform | Protection | JS Required | Soft Close | Currency | Priority |
|----------|-----------|-------------|-----------|----------|---------|
| **Collecting Cars** | Cloudflare | Yes | Yes | GBP | 85 |
| Bring a Trailer | Moderate | No | 2 min | USD | 100 |
| Cars & Bids | Moderate | No | Yes | USD | 95 |
| PCARMARKET | Low | No | Yes | USD | 80 |
| Hagerty | Low | No | 2 min | USD | 85 |

**Collecting Cars stands out**:
- UK-based (different legal/operational context)
- 24/7 global operations (not US-centric)
- Stronger anti-bot measures (Cloudflare)
- Algolia-powered listings (potentially easier API access)

---

## Implementation Recommendations

### Phase 1: Discovery (Immediate)
1. **Investigate Algolia API**:
   - Use browser dev tools on `/results` page
   - Capture Algolia search requests
   - Document API endpoint, query structure, response format
   - Test pagination and filtering

2. **Test listing extraction**:
   - Update archived monitor function or create new extractor
   - Use Firecrawl MCP for rendering
   - Validate extraction patterns still work
   - Test on 5-10 different listings

3. **Database integration**:
   - Ensure `observation_sources` has Collecting Cars entry
   - Link to `external_listings` platform enum
   - Configure sync settings

### Phase 2: Sync Adapter (Next)
1. **Build sync adapter** (pattern from BaT adapter):
   - Poll active auctions at configured intervals
   - Update `vehicle_observations` with bid changes
   - Detect soft close and increase poll frequency
   - Handle auction end (sold/unsold)

2. **Auth handling** (if needed for bidding):
   - Research login flow
   - Store encrypted credentials
   - Session refresh logic
   - 2FA handling (if required)

3. **Rate limiting**:
   - Implement token bucket or leaky bucket
   - Respect 15 req/min limit
   - Backoff on rate limit errors
   - Queue management for soft close priority

### Phase 3: Proxy Bidding (Future)
1. Research bid submission endpoint
2. CSRF token handling
3. Bid validation logic
4. Proxy bid queue integration

---

## BREAKTHROUGH: Typesense API Discovery (2026-02-01)

**Major Discovery**: Collecting Cars does NOT use Algolia - they use **Typesense** search API!

### API Details

**Endpoint**: `https://dora.production.collecting.com/multi_search`

**API Key**: `pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1` (client-side, public)

**Collection**: `production_cars`

### Working Example
```bash
curl -X POST "https://dora.production.collecting.com/multi_search?x-typesense-api-key=pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1" \
  -H "Content-Type: application/json" \
  -d '{
    "searches": [{
      "collection": "production_cars",
      "q": "*",
      "filter_by": "listingStage:live",
      "per_page": 250,
      "page": 1
    }]
  }'
```

### Key Advantages
- **No Cloudflare protection on API** - direct curl access works!
- **No Playwright/Firecrawl needed** - pure HTTP requests
- **Rich structured data** - all auction details in JSON
- **Fast pagination** - 250 results per page
- **Multiple stages**: `live`, `sold`, `comingsoon`

### Data Fields Available
Each listing returns:
- `auctionId`, `slug`, `title`
- `makeName`, `modelName`, `productYear`
- `currentBid`, `noBids` (bid count)
- `dtStageEndsUTC` (auction end time)
- `listingStage`, `lotType`, `location`, `countryCode`, `regionCode`
- `currencyCode`, `noReserve`, `reserveMet`
- `mainImageUrl`, `mainImagePath`
- `features`: { `modelYear`, `mileage`, `transmission`, `fuelType`, `driveSide` }
- `coords` (lat/long), `popularity`, `rank`

### Implementation Status

**Function**: `/Users/skylar/nuke/supabase/functions/collecting-cars-discovery/index.ts`

**Deployed**: Yes (2026-02-01)

**Results**:
- 121 live listings queued
- 184 sold listings queued
- 305 total Collecting Cars listings in import_queue
- Zero Firecrawl/Playwright usage required

**Usage**:
```bash
# Discover live listings
curl -X POST "$SUPABASE_URL/functions/v1/collecting-cars-discovery" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -d '{"action": "discover"}'

# Discover sold listings
curl -X POST "$SUPABASE_URL/functions/v1/collecting-cars-discovery" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -d '{"action": "discover", "stage": "sold"}'

# Check status
curl -X POST "$SUPABASE_URL/functions/v1/collecting-cars-discovery" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -d '{"action": "status"}'
```

### Research Tools Created
- `/Users/skylar/nuke/scripts/discover-collecting-cars-algolia.js` - Initial network inspection
- `/Users/skylar/nuke/scripts/discover-collecting-cars-api.js` - Full API discovery
- `/Users/skylar/nuke/scripts/capture-typesense-data.js` - Captured request/response
- `/Users/skylar/nuke/.claude/typesense-request.json` - Sample request
- `/Users/skylar/nuke/.claude/typesense-response.json` - Sample response (92KB, 152 listings)

## Open Questions

1. **~~Algolia API~~** (ANSWERED - it's Typesense!):
   - ✅ Endpoint: `https://dora.production.collecting.com/multi_search`
   - ✅ API Key: `pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1`
   - ✅ No authentication required (public search API)
   - ✅ Rate limits unknown but appears generous

2. **Pagination**:
   - How many listings per page?
   - Total active listings at any given time?
   - How to efficiently discover new listings?

3. **Authentication**:
   - Required for viewing or only bidding?
   - Session expiration time?
   - 2FA requirement?
   - Cookie names and structure?

4. **WebSocket/Real-time**:
   - Does Collecting Cars use WebSocket for live updates?
   - Or is it client-side polling?
   - What is the polling interval on their frontend?

5. **Comments/Q&A**:
   - Do listings have comment sections?
   - Seller Q&A feature?
   - Worth extracting for observations?

---

## References & Sources

### Research Artifacts
- **Monitor function**: `/Users/skylar/nuke/supabase/functions/_archived/monitor-collecting-cars-listings/index.ts`
- **Debug script**: `/Users/skylar/nuke/scripts/debug-collecting-cars.js`
- **Platform seed**: `/Users/skylar/nuke/database/seeds/live_auction_platforms.sql`
- **Sync registry**: `/Users/skylar/nuke/database/migrations/20260129_live_auction_sync_registry.sql`
- **Extraction tests**: `/Users/skylar/nuke/extraction-comparison-results/`
- **Live auction docs**: `/Users/skylar/nuke/docs/live_auction_protocol_analysis.md`

### External Sources
- [How it works | Collecting Cars – The Ultimate Guide](https://collectingcars.com/guides/how-auctions-work)
- [Collecting Cars FAQ](https://collectingcars.com/faqs)
- [Sports Car Digest: Collecting Cars overview](https://sportscardigest.com/collecting-cars-a-global-auction-site-like-no-other/)
- [The Drive: Collecting Cars US launch](https://www.thedrive.com/news/41302/collecting-cars-is-the-latest-high-end-auto-auction-site-to-launch-stateside)
- [DEV.to: Collecting Cars uses Algolia](https://dev.to/scottharrisondev/engineering-with-a-product-mindset-14im)

### Web Search Results
- Collecting Cars uses Algolia for product listings (client-side JSON)
- Founded by Edward Lovett in 2018
- 6% buyer's premium for cars/bikes
- Seller keeps vehicle during auction (unless using managed service)
- 7-day payment window after auction

---

## Next Steps

1. ✅ **Research complete** (this document)
2. ✅ **Investigate Algolia API** - DISCOVERED: Typesense API with full access!
3. ✅ **Implement discovery crawler** - DEPLOYED: `collecting-cars-discovery` function
4. ✅ **Queue initial listings** - 305 listings queued (121 live, 184 sold)
5. **Test modern extraction** (Firecrawl/Playwright on sample listings)
6. **Design sync adapter** (based on BaT pattern)
7. **Deploy and monitor** (start with low priority, scale up)

---

## Notes

- **DO NOT build yet** - this is research only
- Cloudflare protection makes this more complex than BaT/C&B
- Algolia API may be the key to efficient bulk discovery
- UK-based platform may have different data privacy considerations
- 24/7 global operations means constant auction activity (good for data richness)
- Consider time zone handling for auction end times (UK time vs user local)
