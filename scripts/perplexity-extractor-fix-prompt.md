I need you to fix broken web scrapers for an automotive data platform. For each auction/marketplace site below, I need you to:

1. VISIT the site and find a current vehicle listing page
2. VIEW SOURCE / inspect the page structure (HTML, any JSON-LD, any API calls in network tab)
3. DETERMINE: Is the data in static HTML, server-rendered, JavaScript-rendered (SPA), or available via a public API/JSON endpoint?
4. FIND the cheapest extraction method (static HTML parse > JSON endpoint > JS rendering needed)
5. WRITE a working Node.js extraction function for each

For each site, output a complete, tested extraction function that takes a listing URL and returns this schema:

```json
{
  "url": "string",
  "title": "string",
  "year": "number|null",
  "make": "string|null",
  "model": "string|null",
  "vin": "string|null",
  "mileage": "number|null",
  "exterior_color": "string|null",
  "interior_color": "string|null",
  "transmission": "string|null",
  "engine": "string|null",
  "sale_price": "number|null",
  "bid_count": "number|null",
  "comment_count": "number|null",
  "seller_username": "string|null",
  "image_urls": ["string"],
  "description": "string|null",
  "lot_number": "string|null",
  "auction_date": "string|null",
  "status": "sold|live|upcoming|null"
}
```

## SITES TO FIX (priority order):

### 1. Cars & Bids (carsandbids.com) — BROKEN, TOP PRIORITY
- Current extractor fails with HTTP 402 (out of Firecrawl credits) and also gets 500s
- Visit a current listing like https://carsandbids.com/auctions/ and find an active one
- Check: Is there a public API? Are listings in JSON-LD? Can we get data without JS rendering?
- The comments and bid history are critical — we need those too
- Test with 3 different listing URLs

### 2. Bonhams (bonhams.com/auction/XXXXX) — 92% FAILURE RATE
- Our scraper gets 403 Forbidden on 92% of attempts
- Visit their current car auctions at bonhams.com/departments/MOT/
- Check their anti-bot measures — do they use Cloudflare, DataDome, etc?
- Find if there's a way to get listing data without triggering blocks
- Check if they have a public API or catalog endpoint

### 3. Craigslist (craigslist.org) — 0% SUCCESS RATE
- Zero successful scrapes ever
- Visit a city's car listings (e.g., https://sfbay.craigslist.org/search/cta)
- Craigslist historically blocks scrapers aggressively
- Check: Do they have RSS feeds still? JSON API? Any public data access?
- We mainly want collector/classic cars, not all vehicles

### 4. RM Sotheby's (rmsothebys.com) — BARELY STARTED
- Only 3 successful extractions out of 1K attempts
- Visit their current lots at rmsothebys.com/en/results
- Check page structure — they're a high-end auction house, likely have clean markup
- Find lot detail pages and map the data fields

### 5. PCarMarket (pcarmarket.com) — 70% SKIPPED
- Extractor exists but skips most listings
- Visit current listings at pcarmarket.com
- Porsche-focused auction site — should have clean, consistent data
- Figure out why listings would be "skipped" (maybe pagination issue or listing state detection)

### 6. Barrett-Jackson (barrett-jackson.com) — 62% SCRAPE SUCCESS
- Works but wastes 38% of scraping budget on failures
- Visit their lot catalog at barrett-jackson.com/Events/Auction/Lots
- Check: What causes the 38% failure? Anti-bot? Rate limiting? Specific lot types?
- Find if there's a cleaner data access method (API, sitemap, JSON endpoints)

## FOR EACH SITE, DELIVER:

A. **Site Assessment** (1 paragraph)
   - Static HTML / SPA / API available
   - Anti-bot measures detected
   - Recommended scraping method
   - Estimated cost per page (free if static, needs Firecrawl/Playwright if JS)

B. **Working Node.js Function**
   - Uses only `fetch()` (no external dependencies) where possible
   - Falls back to noting "needs browser rendering" if JS is required
   - Includes error handling and retry logic
   - Parses into the schema above

C. **Test Results**
   - Run against 2-3 real listing URLs
   - Show the extracted data
   - Note any fields that couldn't be extracted

D. **Index Page Scraper**
   - How to get the list of ALL listings (pagination, sitemap, API)
   - Function to enumerate listing URLs for bulk ingestion

## IMPORTANT NOTES:
- We archive every page we scrape (HTML stored in our DB). So we only need to fetch once — after that we re-extract from cache.
- If a site serves JSON somewhere (even embedded in HTML as __NEXT_DATA__ or similar), that's gold — much more reliable than HTML parsing.
- We're running on Deno (Supabase Edge Functions) so the code should be compatible with Deno's fetch API.
- We have 800K+ archived pages already — for some sites we may not need to re-scrape at all, just re-extract from stored HTML.
- Budget constraint: We can't afford expensive scraping services. Free/cheap methods strongly preferred.

Output everything as one comprehensive document with clear sections per site. Include the actual code, not pseudocode.
