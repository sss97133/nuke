# AGENT BOOTSTRAP: PCarMarket Extraction System
**Target Agent**: Fresh agent with no prior context
**Time to Proficiency**: Single read
**Last Updated**: 2026-01-23

---

## TL;DR - What You're Doing

You are building a **complete extraction pipeline** for PCarMarket.com - a collector car auction site similar to Bring a Trailer (BaT). The goal is to discover all auction listings and extract them into the vehicles database.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PCARMARKET EXTRACTION GOAL                         │
│─────────────────────────────────────────────────────────────────────────────│
│                                                                             │
│   1. DISCOVER: Find all auction URLs (active + completed)                   │
│   2. QUEUE: Add URLs to import_queue for processing                         │
│   3. EXTRACT: Scrape each listing for vehicle data                          │
│   4. STORE: Create vehicle profiles in vehicles table                       │
│                                                                             │
│   TARGET: All PCarMarket auctions → Nuke vehicles database                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current State (As of 2026-01-23)

| Metric | Count |
|--------|-------|
| PCarMarket URLs in import_queue | **0** |
| Vehicles from PCarMarket | **2** |
| Estimated total PCarMarket auctions | **5,000-10,000+** |
| Infrastructure readiness | **~70%** |

**What Exists:**
- `import-pcarmarket-listing` edge function (works)
- Scraping scripts (need updates)
- Documentation (comprehensive)
- Organization setup (done)

**What's Missing:**
- Discovery loop (like ralph-wiggum --bat-loop)
- Bulk queue population
- Automated extraction runner

---

## Quick Context Load (Read These Files)

**In this exact order:**

| Order | File | Why | Read Time |
|-------|------|-----|-----------|
| 1 | `/Users/skylar/nuke/CLAUDE.md` | Project-wide context | 2 min |
| 2 | `/Users/skylar/nuke/docs/imports/PCARMARKET_IMPORT_PLAN.md` | Strategy overview | 3 min |
| 3 | `/Users/skylar/nuke/docs/imports/PCARMARKET_DATA_MAPPING_EXAMPLE.md` | Exact data flow | 5 min |
| 4 | `/Users/skylar/nuke/supabase/functions/import-pcarmarket-listing/index.ts` | Working extractor | 5 min |
| 5 | `/Users/skylar/nuke/docs/imports/PCARMARKET_QUICKSTART.md` | How-to guide | 3 min |

---

## Key Difference from BaT: JavaScript Rendering

**BaT**: Server-rendered HTML - direct fetch works
**PCarMarket**: Client-side React app - **requires JavaScript execution**

```
WRONG: curl https://pcarmarket.com/auction/...
       → Returns: "You need to enable JavaScript to run this app"

RIGHT: Firecrawl API → Renders JavaScript → Returns full HTML
       OR: Playwright → Headless browser → Scrapes rendered DOM
```

**Always use Firecrawl MCP or Playwright for PCarMarket scraping.**

---

## Site Structure

### URL Patterns

```
Auction listing:  https://www.pcarmarket.com/auction/{year}-{make}-{model}-{id}
Example:          https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2

Seller profile:   https://www.pcarmarket.com/member/{username}/
                  https://www.pcarmarket.com/seller/{username}/

Browse pages:     https://www.pcarmarket.com/
                  https://www.pcarmarket.com/results/  (completed auctions)
                  https://www.pcarmarket.com/upcoming/ (future auctions)
```

### Image CDN

```
Pattern: https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/...
Example: https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg
```

### Status Indicators (HTML)

```html
<!-- Active/Unsold -->
<span class="text-gray-600">High bid: </span>
<span class="font-semibold text-gray-900">$25,000</span>
<span class="bg-gray-100 text-gray-600 rounded">Unsold</span>

<!-- Sold -->
<span class="text-green-700">Final bid: </span>
<span class="font-semibold text-green-700">$220,000</span>
<span class="bg-green-100 text-green-800 rounded">Sold</span>
```

---

## Database Schema Mapping

### PCarMarket → vehicles Table

```sql
INSERT INTO vehicles (
  year,                    -- From title/URL: 2002
  make,                    -- "aston martin" (lowercase)
  model,                   -- "db7" (lowercase)
  trim,                    -- "v12 vantage coupe"
  vin,                     -- If visible on page
  mileage,                 -- From title: "5k-Mile" → 5000
  sale_price,              -- Final bid if sold
  sale_date,               -- Auction end date if sold
  auction_end_date,        -- ISO timestamp
  auction_outcome,         -- 'sold' | null
  description,             -- Full listing description

  -- Origin tracking
  profile_origin,          -- 'PCARMARKET_IMPORT'
  discovery_source,        -- 'PCARMARKET'
  discovery_url,           -- Full auction URL
  listing_url,             -- Same as discovery_url

  -- Metadata (JSONB)
  origin_metadata          -- { source, pcarmarket_url, seller_username, ... }
) VALUES (...);
```

### origin_metadata Structure

```json
{
  "source": "PCARMARKET_IMPORT",
  "pcarmarket_url": "https://www.pcarmarket.com/auction/...",
  "pcarmarket_listing_title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
  "pcarmarket_seller_username": "elismotorcars",
  "pcarmarket_buyer_username": null,
  "pcarmarket_auction_id": "2",
  "pcarmarket_auction_slug": "2002-aston-martin-db7-v12-vantage-2",
  "bid_count": 12,
  "view_count": 345,
  "sold_status": "unsold",
  "imported_at": "2026-01-23T15:30:00Z"
}
```

---

## The Extraction Loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PCARMARKET EXTRACTION LOOP                         │
└─────────────────────────────────────────────────────────────────────────────┘

START:
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: DISCOVER LISTINGS                                                   │
│─────────────────────────────────────────────────────────────────────────────│
│ Use Firecrawl to scrape:                                                     │
│   • https://www.pcarmarket.com/ (active auctions)                           │
│   • https://www.pcarmarket.com/results/ (completed auctions)                │
│                                                                              │
│ Extract all auction URLs matching:                                           │
│   /auction/\d{4}-[a-z0-9-]+-\d+                                             │
│                                                                              │
│ Handle pagination: Click "Load More" or scroll to load all                  │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: QUEUE URLs                                                          │
│─────────────────────────────────────────────────────────────────────────────│
│ For each discovered URL:                                                     │
│   1. Check if already in import_queue                                        │
│   2. Check if vehicle already exists (by URL)                               │
│   3. If new → INSERT INTO import_queue                                       │
│                                                                              │
│ INSERT INTO import_queue (listing_url, source, status) VALUES               │
│   ('https://www.pcarmarket.com/auction/...', 'pcarmarket', 'pending');      │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: EXTRACT LISTINGS                                                    │
│─────────────────────────────────────────────────────────────────────────────│
│ For each pending URL in import_queue:                                        │
│   1. Fetch HTML via Firecrawl (JS rendering)                                │
│   2. Call import-pcarmarket-listing edge function                           │
│   3. Mark queue status: 'complete' or 'failed'                              │
│                                                                              │
│ Rate limit: 2-3 seconds between requests                                    │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: VALIDATE & LOG                                                      │
│─────────────────────────────────────────────────────────────────────────────│
│ □ Verify vehicle created successfully                                        │
│ □ Verify images imported                                                     │
│ □ Verify organization link created                                          │
│ □ Log: vehicle_id, title, status, errors                                    │
└─────────────────────────────────────────────────────────────────────────────┘
  │
  ▼
  ◄──────── LOOP BACK TO PHASE 1 (for new listings) ────────►
```

---

## Existing Infrastructure

### Edge Function: import-pcarmarket-listing

**Location**: `/Users/skylar/nuke/supabase/functions/import-pcarmarket-listing/index.ts`

**Usage**:
```bash
curl -X POST "$SUPABASE_URL/functions/v1/import-pcarmarket-listing" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"listing_url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"}'
```

**Returns**:
```json
{
  "success": true,
  "vehicle_id": "456e7890-e12b-34c5-d678-901234567890",
  "organization_id": "f7c80592-6725-448d-9b32-2abf3e011cf8",
  "listing": {
    "title": "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe",
    "url": "https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2"
  }
}
```

**What it does**:
1. Uses Firecrawl to scrape the listing (JS rendering)
2. Parses YMM from URL and title
3. Extracts VIN, mileage, price, images
4. Creates/updates vehicle record
5. Imports all gallery images
6. Links to PCarMarket organization
7. Creates external_listings record

### Scripts (May Need Updates)

```
scripts/scrape-pcarmarket-listings.js   # Playwright-based scraper
scripts/import-pcarmarket-vehicle.js    # Single vehicle import
scripts/setup-pcarmarket-org.js         # Organization setup (already done)
```

### Organization

PCarMarket organization should already exist in `businesses` table:
```sql
SELECT id, business_name, website FROM businesses
WHERE website ILIKE '%pcarmarket%';
```

---

## What You Need to Build

### 1. Discovery Script: pcarmarket-discover.sh

```bash
#!/bin/bash
# Discover PCarMarket listings and add to import_queue

# Use Firecrawl to get all listing URLs
# Handle pagination
# Insert new URLs to import_queue
```

### 2. Bulk Extractor: pcarmarket-bulk-extract.sh

Similar to `/Users/skylar/nuke/scripts/bat-bulk-extract.sh`:
- Pull pending URLs from import_queue where listing_url ILIKE '%pcarmarket.com%'
- Call import-pcarmarket-listing for each
- Handle rate limiting
- Log successes/failures

### 3. Loop Shell: pcarmarket-loop.sh

Similar to ralph-wiggum.sh --bat-loop:
```bash
./scripts/pcarmarket-loop.sh --discover   # Find new listings
./scripts/pcarmarket-loop.sh --extract    # Process queue
./scripts/pcarmarket-loop.sh --status     # Show stats
```

---

## Data Extraction Patterns

### Title Parsing

```javascript
// "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe"
function parseTitle(title) {
  // Mileage from "Xk-Mile"
  const mileageMatch = title.match(/(\d+)k-Mile/i);
  const mileage = mileageMatch ? parseInt(mileageMatch[1]) * 1000 : null;

  // Year is always 4 digits
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;

  return { year, mileage };
}
```

### URL Parsing

```javascript
// "/auction/2002-aston-martin-db7-v12-vantage-2"
function parseAuctionUrl(url) {
  const match = url.match(/\/auction\/(\d{4})-([a-z0-9-]+)-(\d+)\/?$/i);
  if (!match) return null;

  const year = parseInt(match[1]);
  const slug = match[2]; // "aston-martin-db7-v12-vantage"
  const id = match[3];   // "2"

  // Split slug into make/model
  const parts = slug.split('-');
  // Make is usually first 1-2 words
  // This is tricky - "aston-martin" is 2 words

  return { year, slug, id };
}
```

### Price Parsing

```javascript
// "$25,000" or "$220,000"
function parsePrice(priceStr) {
  const match = priceStr.match(/\$?([\d,]+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''));
}
```

### VIN Detection

```javascript
// Standard 17-character VIN
const VIN_REGEX = /\b([A-HJ-NPR-Z0-9]{17})\b/;

function extractVin(html) {
  const match = html.match(VIN_REGEX);
  return match ? match[1] : null;
}
```

---

## Firecrawl Usage

### Scrape Single Listing

```typescript
const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
    formats: ['html'],
    waitFor: 5000,  // Wait for JS to render
    mobile: false,
  }),
});

const data = await response.json();
const html = data.data?.html;
```

### Scrape Listing Index (with scrolling)

```typescript
const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://www.pcarmarket.com/',
    formats: ['html', 'links'],
    waitFor: 10000,
    actions: [
      { type: 'scroll', direction: 'down', amount: 5000 },
      { type: 'wait', milliseconds: 2000 },
      { type: 'scroll', direction: 'down', amount: 5000 },
    ],
  }),
});
```

---

## Queue Management

### Add to Queue

```sql
INSERT INTO import_queue (listing_url, source, status, created_at)
SELECT
  'https://www.pcarmarket.com/auction/...',
  'pcarmarket',
  'pending',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM import_queue
  WHERE listing_url = 'https://www.pcarmarket.com/auction/...'
);
```

### Get Pending URLs

```sql
SELECT id, listing_url
FROM import_queue
WHERE listing_url ILIKE '%pcarmarket.com%'
  AND status = 'pending'
ORDER BY created_at ASC
LIMIT 100;
```

### Update Status

```sql
UPDATE import_queue
SET status = 'complete', updated_at = NOW()
WHERE id = '...';
```

---

## Comparison with BaT

| Aspect | BaT | PCarMarket |
|--------|-----|------------|
| Rendering | Server-side HTML | Client-side React |
| Scraping | Direct fetch | Firecrawl/Playwright |
| URL pattern | `/listing/{slug}` | `/auction/{year}-{slug}-{id}` |
| VIN availability | Usually visible | Sometimes visible |
| Image CDN | bringatrailer.com | d2niwqq19lf86s.cloudfront.net |
| Volume | 100k+ auctions | 5k-10k auctions |
| Edge function | bat-simple-extract | import-pcarmarket-listing |

---

## Testing Checklist

Before running bulk extraction:

- [ ] Firecrawl API key is set (`FIRECRAWL_API_KEY`)
- [ ] Can scrape single listing successfully
- [ ] import-pcarmarket-listing returns vehicle_id
- [ ] Vehicle appears in vehicles table
- [ ] Images imported to vehicle_images
- [ ] Organization link created
- [ ] external_listings record created

### Test Single Extraction

```bash
cd /Users/skylar/nuke

# Test the edge function
dotenvx run -- bash -c 'curl -s -X POST \
  "$VITE_SUPABASE_URL/functions/v1/import-pcarmarket-listing" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"listing_url\": \"https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2\"}"' | jq
```

---

## Implementation Priority

1. **First**: Verify existing edge function works
2. **Second**: Build discovery script (find all URLs)
3. **Third**: Build queue population script
4. **Fourth**: Build bulk extraction runner
5. **Fifth**: Create monitoring/status script

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "JavaScript required" | Direct fetch instead of Firecrawl | Use Firecrawl API |
| Missing year/make/model | Title parsing failed | Check URL parsing fallback |
| VIN constraint violation | Duplicate vehicle | Check existing vehicle by URL first |
| Rate limited | Too fast | Add 2-3 second delays |
| Firecrawl timeout | Page too slow | Increase waitFor to 10000ms |

### Retry Strategy

```javascript
async function extractWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await importPCarMarketListing(url);
      return result;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(5000 * (i + 1)); // Exponential backoff
    }
  }
}
```

---

## Success Metrics

You're done when:
- [ ] Discovery script finds all PCarMarket listing URLs
- [ ] All URLs are in import_queue
- [ ] Bulk extractor processes queue with >90% success rate
- [ ] vehicles table has PCarMarket entries
- [ ] Images imported correctly
- [ ] Organization links created

---

## Files to Create

```
scripts/pcarmarket-discover.sh          # URL discovery
scripts/pcarmarket-bulk-extract.sh      # Bulk extraction runner
scripts/pcarmarket-loop.sh              # Combined loop shell
scripts/rlm/pcarmarket_context.md       # RLM context for future agents
```

## Files to Reference (Don't Modify Unless Broken)

```
supabase/functions/import-pcarmarket-listing/index.ts  # Working extractor
docs/imports/PCARMARKET_*.md                           # Documentation
```

---

END OF BOOTSTRAP DOCUMENT.
