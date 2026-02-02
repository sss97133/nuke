# Barrett-Jackson Crawler Research

**Date**: 2026-02-01
**Researcher**: Claude (Sonnet 4.5)
**Status**: Research Complete - Ready for Implementation Planning

---

## Executive Summary

Barrett-Jackson presents a **moderately difficult scraping target** due to multiple anti-bot protections across their domains. They operate two main domains with different protection schemes:

1. **www.barrett-jackson.com** - Marketing/informational site (Cloudflare protection, Next.js)
2. **bid.barrett-jackson.com** - Live bidding/lot details (SHA-256 proof-of-work challenge)

**Recommendation**: Use **Firecrawl** (via Playwright/headless browser) to handle JavaScript challenges. Alternative: Source data from third-party aggregators like classic-car-auctions.info.

---

## Site Architecture

### Primary Domain: www.barrett-jackson.com

**Technology Stack**:
- Framework: **Next.js** (React-based)
- Protection: **Cloudflare** (JavaScript challenge on `/Archive/Results`)
- Build ID: `VYZ0e-B52DIJSSuZ0WIsj` (as of 2026-02-01)

**Key Pages**:
```
/Archive/Results           - Main results page (404/not found behavior)
/results                   - Alternative results page
/Archive/Event             - Event archive listing
/auctions                  - Upcoming auctions
/2026-scottsdale/docket    - Event-specific vehicle listings
```

**Anti-Bot Protection**:
- Standard curl requests receive Cloudflare "Just a moment..." challenge page
- Requires JavaScript execution to pass
- User-Agent header alone insufficient
- Next.js static data endpoints (e.g., `/_next/data/[buildId]/Archive/Results.json`) also protected

### Bidding Domain: bid.barrett-jackson.com

**Technology Stack**:
- Protection: **Custom SHA-256 proof-of-work challenge**
- Challenge difficulty: 2 (requires finding hash starting with "00")

**URL Structure for Lots**:
```
https://bid.barrett-jackson.com/lot-details/index/catalog/{catalog_id}/lot/{lot_id}

Examples:
- catalog/48/lot/33925 (2000 BMW M5, Lot 384, 2026 Scottsdale)
- catalog/48/lot/34488 (2026 Scottsdale auction)
```

**Catalog IDs**:
- Each auction event has a unique catalog ID
- Example: Catalog ID 48 = 2026 Scottsdale Auction

**Anti-Bot Protection**:
The site implements a browser-based proof-of-work challenge:
```javascript
// Requires solving SHA-256 puzzle with nonce + solution
// Finding hash that starts with "00" (difficulty = 2)
// Solution posted back via fetch() with challenge token
```

This protection requires:
1. JavaScript execution
2. WebCrypto API (SHA-256)
3. Interactive POST after solving challenge
4. Cookie/session management

---

## Data Structure

### Lot URL Pattern
Based on web search findings:
```
Base URL: https://bid.barrett-jackson.com/lot-details/index/catalog/{catalog_id}/lot/{lot_id}

Parameters:
- catalog_id: Auction event identifier (e.g., 48 for 2026 Scottsdale)
- lot_id: Individual vehicle/lot identifier within that catalog
```

### Expected Data Fields
(Based on typical Barrett-Jackson listings and Nuke schema requirements):

```typescript
{
  url: string;                    // Full lot URL
  lot_number: string;             // Display lot number (e.g., "384")
  title: string;                  // Vehicle title from listing
  year: number;                   // Model year
  make: string;                   // Manufacturer
  model: string;                  // Model name
  vin: string | null;             // VIN if disclosed
  mileage: number | null;         // Odometer reading
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  sale_price: number | null;      // Hammer price (if sold)
  sold: boolean;                  // Sale status
  reserve_met: boolean | null;    // Whether reserve was met
  auction_date: string;           // Date of sale
  catalog_name: string;           // Event name (e.g., "2026 Scottsdale")
  catalog_id: number;             // Catalog identifier
  description: string | null;     // Lot description
  consignor: string | null;       // Seller info if available
  image_urls: string[];           // All lot images
}
```

---

## Pagination Strategy

### Catalog-Level Pagination
The docket pages support pagination:
```
https://www.barrett-jackson.com/2026-scottsdale/docket?page=1&type=Vehicles
https://www.barrett-jackson.com/2026-scottsdale/docket?page=2&type=Vehicles
```

**Strategy**:
1. Start with page=1
2. Increment page number until no results returned or HTTP error
3. Extract all lot URLs from each page
4. Queue individual lot extractions

### Results Archive Access
The main `/Archive/Results` endpoint appears to show a 404/not-found page, suggesting:
- Results may be event-specific (not aggregated)
- Need to access individual event archives
- Alternative: Use `/results` or event-specific pages

---

## Anti-Bot Bypass Strategy

### Option 1: Firecrawl (RECOMMENDED)

**Why Firecrawl**:
- Handles JavaScript execution automatically
- Bypasses Cloudflare challenges
- Solves proof-of-work challenges via headless browser
- Already integrated into Nuke via MCP

**Implementation**:
```typescript
// Use Firecrawl MCP or API
const result = await firecrawl.scrape_url({
  url: 'https://bid.barrett-jackson.com/lot-details/index/catalog/48/lot/33925',
  formats: ['markdown', 'html']
});
```

**Cost Considerations**:
- Firecrawl charged per page
- For bulk extraction (thousands of lots), cost could be significant
- Consider batching and caching strategies

### Option 2: Playwright Automation

**Approach**:
```javascript
// Use Playwright MCP to navigate and solve challenges
await playwright.navigate('https://bid.barrett-jackson.com/auctions/catalog/id/48');
await playwright.waitForSelector('.lot-card'); // Wait for JS to load
const html = await playwright.getContent();
```

**Advantages**:
- More control over extraction process
- Can handle multi-page workflows (login, bidding history, etc.)
- No per-request API costs

**Disadvantages**:
- More complex to maintain
- Need to handle session management
- Proof-of-work challenge may require custom logic

### Option 3: Third-Party Aggregators

**Source**: classic-car-auctions.info
```
https://www.classic-car-auctions.info/usa/scottsdale/2026-barrett-jackson-scottsdale-sale-auction-results/
```

**Advantages**:
- Simpler scraping (less protection)
- Already aggregated and formatted
- Historical data available (2016-2026+)

**Disadvantages**:
- Not real-time (published after auctions)
- May be incomplete (only top lots)
- Less detailed than official source
- Lacks VIN, detailed specs
- Images may be lower quality or missing

**Pattern**:
```
/usa/scottsdale/{YYYY}-barrett-jackson-scottsdale-sale-auction-results/
```

---

## Discovery Strategy

### Phase 1: Catalog Enumeration
1. Identify active/past catalog IDs
2. Method: Iterate known patterns or scrape event listing pages
3. Example starting point: Check `/auctions` or `/Archive/Event`

### Phase 2: Lot Enumeration
For each catalog:
1. Access docket page with pagination
2. Extract all lot_id values
3. Alternative: Enumerate lot IDs numerically (may have gaps)

### Phase 3: Lot Extraction
For each lot:
1. Use Firecrawl to fetch lot details page
2. Parse HTML/markdown for structured data
3. Extract images, specs, sale results
4. Insert into `import_queue` or `vehicle_observations`

---

## Rate Limiting Considerations

### Official Site (bid.barrett-jackson.com)
- Proof-of-work challenge indicates serious anti-bot measures
- Likely has rate limiting in place
- Consider delays between requests (3-5 seconds minimum)
- Use rotating user agents and session management

### Third-Party Aggregator (classic-car-auctions.info)
- Less strict protection
- Still recommend respectful crawling (1-2 second delays)
- Appears to be WordPress-based (check robots.txt)

---

## Existing Infrastructure Check

### Edge Functions Search
```bash
ls /Users/skylar/nuke/supabase/functions/ | grep -i barrett
```

**Result**: No existing Barrett-Jackson extractor found.

### Related Extractors to Reference
- `bat-simple-extract` - Bring a Trailer pattern
- `extract-cars-and-bids-core` - Cars & Bids
- `extract-hagerty-listing` - Hagerty Marketplace
- `extract-premium-auction` - General premium auction extractor

---

## Implementation Recommendations

### Immediate Next Steps

1. **Build Prototype Extractor**
   - Start with single lot URL extraction using Firecrawl
   - Target: `https://bid.barrett-jackson.com/lot-details/index/catalog/48/lot/33925`
   - Parse markdown/HTML to extract vehicle data
   - Map to `ExtractedVehicle` schema

2. **Test Catalog Enumeration**
   - Use Firecrawl on docket page: `/2026-scottsdale/docket?page=1&type=Vehicles`
   - Extract lot URLs and catalog structure
   - Validate pagination logic

3. **Create Edge Function**
   - Follow pattern: `supabase/functions/extract-barrett-jackson-core/index.ts`
   - Support both individual lot URLs and catalog crawling
   - Use Firecrawl MCP for fetching
   - Return structured data or insert to `import_queue`

4. **Integration with Observation System**
   - Register Barrett-Jackson as observation source
   - Configure extractor in `observation_extractors` table
   - Route through `ingest-observation` for unified intake

### Alternative Approach: Aggregator-First

If Firecrawl costs are prohibitive:
1. Build extractor for classic-car-auctions.info first
2. Scrape historical results (2016-2026)
3. Use as baseline dataset
4. Supplement with direct Barrett-Jackson extraction for detailed data on high-value lots

---

## Cost-Benefit Analysis

### Direct Extraction (Firecrawl)
**Pros**:
- Complete data (VINs, detailed specs, all images)
- Real-time or near-real-time
- Official source (authoritative)

**Cons**:
- API costs (Firecrawl per-page charges)
- More complex anti-bot bypass
- May face blocking/rate limits

**Estimated Volume**:
- 2026 Scottsdale: 1,911 vehicles
- 4-6 major auctions per year
- Total: ~10,000-15,000 lots/year
- Firecrawl cost: $0.001-0.01/page = $10-150/year (rough estimate)

### Aggregator Extraction
**Pros**:
- Free (just HTTP requests)
- No anti-bot challenges
- Historical data readily available

**Cons**:
- Incomplete data (top lots only)
- Delayed (post-auction publication)
- Lower quality/fewer images
- Not authoritative

**Best For**:
- Initial dataset population
- Market trend analysis
- High-level statistics

---

## Risks & Mitigations

### Risk 1: Terms of Service Violation
**Mitigation**:
- Review Barrett-Jackson ToS and robots.txt
- Use respectful crawling practices
- Consider official API/partnership if high-volume

### Risk 2: Anti-Bot Detection
**Mitigation**:
- Use Firecrawl or Playwright (browser-based)
- Implement delays between requests
- Rotate user agents and headers
- Monitor for 403/429 responses

### Risk 3: Data Quality Issues
**Mitigation**:
- Implement validation layer
- Cross-reference with third-party sources
- Flag low-confidence extractions for manual review

### Risk 4: Schema Changes
**Mitigation**:
- Use AI-powered extraction (`extract-vehicle-data-ai`) as fallback
- Implement schema discovery before bulk extraction
- Regular monitoring and alerts for extraction failures

---

## Related Research

### Web Search Sources
- [Barrett-Jackson Scottsdale Docket](https://www.barrett-jackson.com/2026-scottsdale/docket?page=1&type=Vehicles)
- [Barrett-Jackson Results](https://www.barrett-jackson.com/results)
- [Barrett-Jackson Bidding Platform](https://bid.barrett-jackson.com/)
- [Classic Car Auctions Info - 2026 Scottsdale Results](https://www.classic-car-auctions.info/usa/scottsdale/2026-barrett-jackson-scottsdale-sale-auction-results/)
- [Hagerty - 16 Eye-Catching Cars from 2026 Barrett-Jackson](https://www.hagerty.com/media/market-trends/hagerty-insider/16-eye-catching-cars-from-the-2026-barrett-jackson-scottsdale-auction/)

---

## Next Session Tasks

When ready to implement:

1. Create `/Users/skylar/nuke/supabase/functions/extract-barrett-jackson-core/index.ts`
2. Test single lot extraction with Firecrawl
3. Test catalog enumeration and pagination
4. Deploy edge function: `supabase functions deploy extract-barrett-jackson-core --no-verify-jwt`
5. Register in observation system:
   ```sql
   INSERT INTO observation_sources (slug, display_name, category, base_trust_score)
   VALUES ('barrett-jackson', 'Barrett-Jackson', 'auction', 0.85);
   ```
6. Test with 2026 Scottsdale catalog (catalog_id: 48)
7. Schedule recurring crawls for new auctions

---

**END OF RESEARCH DOCUMENT**
