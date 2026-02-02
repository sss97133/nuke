# Mecum Auctions Crawler Research
**Date**: 2026-02-01
**Researched for**: Nuke vehicle data platform
**Status**: Research complete - ready for implementation

---

## Executive Summary

Mecum Auctions uses a **Next.js-based website** powered by **Algolia search**, **WordPress VIP headless CMS**, and **Cloudinary for images**. The site requires **JavaScript rendering** to display search results and lot listings, making Firecrawl essential for extraction.

**Key Finding**: No existing Mecum extractor in `/Users/skylar/nuke/supabase/functions/`. Will need to build one using Firecrawl + pattern matching or route through `extract-vehicle-data-ai`.

---

## 1. URL Structure

### Individual Lot Pages
**Pattern**: `https://mecum.com/lots/[AUCTION_CODE]-[LOT_NUMBER]/[vehicle-slug]/`

**Examples**:
- `https://mecum.com/lots/SC0518-327347/2018-dodge-challenger-srt-demon/`
- `https://mecum.com/lots/FL0126-123456/2015-ferrari-f50/` (hypothetical 2026)

**Components**:
- **AUCTION_CODE**: Event identifier (e.g., `FL0126` = Florida, Jan 2026)
- **LOT_NUMBER**: Sequential lot number within auction
- **vehicle-slug**: SEO-friendly description (not required for page load)

### Listing Pages
**Current URLs tested**:
- ✅ `https://www.mecum.com/lots/` - "Upcoming Lots" (requires JS)
- ❌ `https://www.mecum.com/lots/results/` - Returns 404
- ❌ `https://www.mecum.com/auctions/lots/results/` - Returns 404

**Observation**: The `/lots/` page is a **client-side search interface** with no server-rendered results in initial HTML.

---

## 2. Technology Stack

### Frontend Framework
- **Next.js** (React-based, confirmed via `__NEXT_DATA__` script tags)
- **Server-Side Rendering (SSR)** with client-side hydration
- **Algolia InstantSearch** for lot search/filtering

### Data Architecture
From HTML analysis:
```javascript
{
  props: {
    pageProps: {
      post: {...},           // WordPress content
      __APOLLO_STATE__: {...} // GraphQL cache (likely for WordPress queries)
    }
  }
}
```

### Content Management
- **WordPress VIP** (headless CMS)
- **Salesforce** as "single source of truth" for lots/auctions
- **Algolia** indexes ~8 million assets for search

### Media Delivery
- **Cloudinary CDN** for images
- Pattern: `https://res.cloudinary.com/mecum/images/...`

### Search Infrastructure
**Algolia Application ID**: `U6CFCQ7V52`
**Found in**: `<link rel="preconnect" href="https://U6CFCQ7V52-dsn.algolia.net">`

**Search API**: Not publicly exposed. Algolia queries likely require:
1. API key (may be public search-only key in JS bundles)
2. Index name (e.g., `mecum_lots`, `mecum_vehicles`)
3. Query DSL parameters

---

## 3. Pagination & Search

### Search Results Rendering
- **Client-side only** - no server-rendered lot listings
- Requires **JavaScript execution** to fetch/display results
- Uses **Algolia InstantSearch React** components

### Pagination Method
**Likely approach** (not confirmed without JS execution):
- Infinite scroll OR page-based navigation
- Algolia handles pagination via `page` and `hitsPerPage` params
- Results delivered as JSON from Algolia API

### Data Extraction Strategy
**For crawling lots**:
1. Use **Firecrawl** to render JavaScript on `/lots/` page
2. Extract Algolia search configuration from rendered HTML
3. Discover Algolia API key + index name from network requests
4. Query Algolia API directly for bulk lot discovery (faster than page-by-page)

**For individual lot pages**:
1. Use **Firecrawl** to render lot page
2. Parse structured data from:
   - `__NEXT_DATA__` JSON (may contain lot details)
   - Rendered HTML (title, price, images)
   - Meta tags (OG tags for year/make/model)

---

## 4. Data Fields Available

### From Individual Lot Pages
Based on Bonhams extractor pattern and Mecum auction structure:

**Vehicle Identification**:
- `title` - Lot title (e.g., "1967 Chevrolet Corvette 427/435")
- `year`, `make`, `model` - Parsed from title
- `vin` - May be in description or specs
- `lot_number` - From URL or page metadata

**Pricing**:
- `estimate_low`, `estimate_high` - Pre-sale estimate
- `hammer_price` - Final bid (sold lots)
- `buyers_premium` - Mecum charges 10% buyer's premium
- `total_price` - hammer + premium

**Auction Metadata**:
- `sale_id` - Auction event identifier
- `sale_name` - e.g., "Kissimmee 2026"
- `sale_date` - Auction date
- `sale_location` - City/venue
- `auction_status` - `sold` | `unsold` | `upcoming` | `withdrawn`

**Vehicle Specs**:
- `mileage` - Odometer reading
- `engine` - Engine description
- `transmission` - Manual/automatic
- `exterior_color` - Paint color
- `interior_color` - Upholstery color
- `body_style` - Coupe, convertible, etc.

**Content**:
- `description` - Main lot description
- `history` - Ownership/provenance
- `modifications` - Non-stock items
- `condition_report` - May be available for some lots

**Media**:
- `image_urls[]` - Gallery images (Cloudinary URLs)

### CSS Selectors / Regex Patterns
**Title**: `<h1>` tag or `<title>` in meta
**Lot number**: Regex `/Lot[:\s]+(\d+)/i` or from URL
**Price**: Regex `/\$[\d,]+/` with context ("Sold for", "Estimate")
**Images**: `src="https://res.cloudinary.com/mecum/..."` or `data-src` attributes

---

## 5. Anti-Bot Protections

### Observations
- ✅ **No immediate blocking** on curl requests (HTML returned)
- ✅ **No CAPTCHA** observed
- ⚠️ **Requires User-Agent** header (standard practice)
- ⚠️ **JavaScript required** for search results (not anti-bot, just architecture)

### Rate Limiting
- **Not tested** - unknown if aggressive crawling triggers blocks
- **Recommendation**: Implement 2-5 second delays between requests
- Use **Firecrawl** which handles rotation/throttling

### Detection Risks
- **Low risk** for individual lot page extraction
- **Moderate risk** for bulk scraping via Algolia API (if reverse-engineered)
- **Best practice**: Use Firecrawl for all requests (handles fingerprinting)

---

## 6. Firecrawl Requirements

### When Firecrawl is REQUIRED
✅ **Search/results pages** (`/lots/`) - No content without JS
✅ **Lot pages** - May have JS-rendered galleries or price updates
✅ **Discovering lot URLs** - Search results only appear client-side

### Firecrawl Configuration
```typescript
{
  url: "https://www.mecum.com/lots/FL0126-123456/...",
  formats: ["html", "markdown"],
  waitFor: 5000,  // Allow JS to load images/data
  onlyMainContent: false,  // Need full page for metadata
}
```

### Cost Estimate
- **Per lot page**: ~1 credit ($0.01 USD)
- **Search page scrape**: ~1 credit
- **1000 lots**: ~$10 USD

---

## 7. Recommended Extraction Approach

### Option A: Firecrawl + Pattern Matching (Fast)
**Best for**: Extracting individual known lot URLs

1. User provides lot URL or lot discovered via search
2. Call **Firecrawl** to render page
3. Extract data using regex/CSS patterns (like `extract-bonhams`)
4. Parse title → year/make/model
5. Extract images from Cloudinary URLs
6. Parse price from "Sold for" or "Estimate" text
7. Save to `vehicles` table via `ingest-observation`

**Pros**: Fast, predictable, works offline
**Cons**: Requires pattern maintenance if Mecum changes HTML structure

### Option B: Firecrawl + AI Extraction (Robust)
**Best for**: Handling varied lot page formats

1. Call **Firecrawl** to get markdown + HTML
2. Pass to **`extract-vehicle-data-ai`** (existing function)
3. AI parses year/make/model, price, specs
4. AI extracts images from markdown
5. Save via `ingest-observation`

**Pros**: Handles layout changes gracefully, less code maintenance
**Cons**: Slower (~3-5s per lot), AI costs (~$0.005/lot)

### Option C: Algolia API Reverse-Engineering (Bulk Discovery)
**Best for**: Discovering thousands of lots at scale

1. Use Firecrawl to load `/lots/` and capture network requests
2. Extract Algolia API key + index name from XHR calls
3. Query Algolia API directly:
   ```bash
   curl https://U6CFCQ7V52-dsn.algolia.net/1/indexes/mecum_lots/query \
     -H "X-Algolia-API-Key: [extracted_key]" \
     -d '{"query": "", "hitsPerPage": 1000}'
   ```
4. Batch extract lot URLs from results
5. Process each URL via Option A or B

**Pros**: Can discover all lots in database
**Cons**: API key may be rotated, unclear legality, higher detection risk

---

## 8. Implementation Roadmap

### Phase 1: Single Lot Extraction (MVP)
**Goal**: Extract one Mecum lot URL successfully

1. Create `/Users/skylar/nuke/supabase/functions/extract-mecum/index.ts`
2. Use **Firecrawl** to fetch lot page
3. Parse data using patterns from `extract-bonhams` as template:
   - Title → year/make/model
   - Lot number from URL
   - Price (estimate or sold)
   - Images (Cloudinary URLs)
   - Description text
4. Test with recent Kissimmee 2026 lot URL
5. Save to database via `ingest-observation`

**Files to create**:
- `/Users/skylar/nuke/supabase/functions/extract-mecum/index.ts`

**Dependencies**:
- `_shared/firecrawl.ts` (already exists)
- `_shared/listingUrl.ts` (for deduplication)

### Phase 2: Route Through Unified Extractor
**Goal**: Add Mecum support to existing routing

✅ **ALREADY DONE** - Mecum is configured in `extract-premium-auction`:
- Routes to `extract-vehicle-data-ai` (generic AI extractor)
- Pattern: `/mecum\.com\/lots\/\d{4}\/[A-Z]+-\d+/`
- ⚠️ **Pattern is too restrictive** - doesn't match actual lot URLs (requires 4-digit year prefix)
- **Correct pattern should be**: `/mecum\.com\/lots\/[A-Z0-9]+-[A-Z0-9]+/`

**To improve**:
1. **Fix regex pattern** in `extract-premium-auction`:
   - Current: `/mecum\.com\/lots\/\d{4}\/[A-Z]+-\d+/` ❌
   - Correct: `/mecum\.com\/lots\/[A-Z0-9]+-[A-Z0-9]+/` ✅
2. Create dedicated `extract-mecum` function (Phase 1)
3. Update router to use `mecum: "extract-mecum"` instead of AI fallback
4. Test performance/cost comparison (pattern-based vs AI)

### Phase 3: Batch Discovery (Optional)
**Goal**: Discover lots from auction catalogs

1. Investigate Algolia API via Firecrawl network capture
2. Extract API key + index name
3. Query for all lots from specific auction (e.g., Kissimmee 2026)
4. Enqueue discovered URLs to `import_queue`
5. Process via `extract-mecum`

---

## 9. Existing Nuke Infrastructure

### No Dedicated Mecum Extractor Found
```bash
$ ls /Users/skylar/nuke/supabase/functions/ | grep -i mecum
# (no results)
```

**However**, Mecum IS configured in the router:
```typescript
// In extract-premium-auction/index.ts
SITE_EXTRACTORS: {
  mecum: "extract-vehicle-data-ai",  // Routes to AI extractor
}
SITE_LISTING_PATTERNS: {
  mecum: [/mecum\.com\/lots\/\d{4}\/[A-Z]+-\d+/],  // URL pattern
}
```

**Current Status**: Mecum lot URLs can be extracted via `extract-premium-auction`, which routes them to the generic AI extractor (`extract-vehicle-data-ai`). This works but may be slower/costlier than a dedicated pattern-based extractor.

### Reference Extractors
- **`extract-bonhams`** - Premium auction pattern-based extraction (867 lines)
- **`extract-premium-auction`** - Router that dispatches to site-specific extractors
- **`extract-vehicle-data-ai`** - Generic AI-powered extraction
- **`bat-simple-extract`** - Bring a Trailer (uses Firecrawl)

### Database Tables
- **`vehicles`** - Core vehicle records
- **`auction_events`** - Auction instances
- **`external_listings`** - Cross-platform tracking
- **`vehicle_observations`** - New unified observation system (recommended)

---

## 10. Next Steps

### Immediate Actions
1. ✅ **Research complete** - Document created
2. ⏭️ **Get sample lot URL** - Use recent Kissimmee 2026 lot for testing
3. ⏭️ **Test Firecrawl** - Verify rendering works for Mecum pages
4. ⏭️ **Build extractor** - Create `extract-mecum` following Bonhams pattern
5. ⏭️ **Deploy + test** - Validate with real lot URLs
6. ⏭️ **Update router** - Add to `extract-premium-auction`

### Open Questions
- **Algolia API accessibility** - Can we query directly or is key obfuscated?
- **Lot URL discovery** - How to get URLs without manual input?
- **Buyer's premium calculation** - Flat 10% or tiered (like Bonhams)?
- **Condition reports** - Available on all lots or premium-only?

---

## 11. References

### Sources
- [Mecum Auctions Technology Stack](https://www.americaneagle.com/projects/detail/mecum-auctions) - Built on WordPress VIP, Algolia, Cloudinary
- [Mecum Digital Transformation](https://www.americaneagle.com/insights/news/news-article/2023/05/09/mecum-auctions-drives-its-digital-experience-forward-with-brand-new-website) - Algolia integration details
- [Mecum Kissimmee 2026 Results](https://www.glenmarch.com/auctions/results/2726) - Sample lot data from third-party aggregator
- [Classic Car Auctions Info](https://www.classic-car-auctions.info/usa/2026-mecum-kissimmee-sale-top-auction-results/) - Lot examples and pricing

### Related Documentation
- `/Users/skylar/nuke/supabase/functions/extract-bonhams/index.ts` - Reference extractor pattern
- `/Users/skylar/nuke/supabase/functions/extract-premium-auction/index.ts` - Routing logic
- `/Users/skylar/nuke/.claude/CLAUDE.md` - Nuke platform architecture

---

**Conclusion**: Mecum is crawlable with Firecrawl. Recommend building dedicated `extract-mecum` function following Bonhams pattern, then integrating into `extract-premium-auction` router.
