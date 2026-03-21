# ATLAS: Scraping Sources

Complete reference for every data source the platform scrapes, with access methods, data quality, rate limits, and field coverage.

---

## Auction Houses (Trust 0.75-0.90)

### Bring a Trailer (BaT)
- **URL:** bringatrailer.com
- **Trust:** 0.90 (curated, seller-verified, public comment scrutiny)
- **Access:** Direct fetch with UA rotation + jitter (`batFetcher` in `_shared/archiveFetch.ts`)
- **Firecrawl needed:** No
- **Rate limit:** ~1 req/3s with jitter. Aggressive scraping triggers Cloudflare challenge.
- **Extractor:** `complete-bat-import` → `extract-bat-core` + `extract-auction-comments`
- **Data depth:** Best in class. 141K vehicles, 11.5M comments, 30M images, 3.7M bids, 137K descriptions.
- **Fields covered:** year, make, model, trim, VIN, sale_price, mileage, color, transmission, engine, location, seller, description, highlights, equipment, modifications, images (20-80 per listing), comments with usernames/likes/timestamps, bid history
- **Unique value:** Comment threads (expert community), bid history (price discovery curve), seller history

### Cars and Bids (C&B)
- **URL:** carsandbids.com
- **Trust:** 0.85
- **Access:** JavaScript SPA — requires Firecrawl
- **Firecrawl needed:** Yes
- **Rate limit:** Standard web rate limiting
- **Extractor:** `extract-cars-and-bids-core`
- **Fields covered:** year, make, model, price, mileage, color, description, images, bid count, comments

### Mecum Auctions
- **URL:** mecum.com
- **Trust:** 0.75
- **Access:** Direct fetch
- **Firecrawl needed:** No (but JS-heavy, some pages need it)
- **Extractor:** `extract-mecum`
- **Fields covered:** year, make, model, lot number, sale_price, images, description

### RM Sotheby's
- **URL:** rmsothebys.com
- **Trust:** 0.90
- **Access:** Direct fetch
- **Extractor:** `extract-rmsothebys`
- **Fields covered:** year, make, model, sale_price, description, provenance, images, estimate range

### Bonhams
- **URL:** bonhams.com
- **Trust:** 0.85
- **Access:** Next.js SPA — serves empty shells to bots. Needs Firecrawl.
- **Firecrawl needed:** Yes
- **Extractor:** `extract-bonhams`
- **Garbage detection:** `isGarbageHtml()` checks for empty Next.js shells

### Barrett-Jackson
- **URL:** barrett-jackson.com
- **Trust:** 0.75
- **Access:** Direct fetch
- **Extractor:** `extract-barrett-jackson`
- **Fields covered:** year, make, model, lot, sale_price, images

### Gooding & Company
- **URL:** goodingco.com
- **Trust:** 0.90
- **Access:** Direct fetch
- **Extractor:** `extract-gooding`

### Broad Arrow Auctions
- **URL:** broadarrowauctions.com
- **Trust:** 0.80
- **Access:** Direct fetch
- **Extractor:** `extract-broad-arrow`

### Collecting Cars
- **URL:** collectingcars.com
- **Trust:** 0.80
- **Access:** JavaScript SPA — needs Firecrawl
- **Extractor:** `extract-collecting-cars-core`

---

## Marketplaces (Trust 0.45-0.55)

### Facebook Marketplace
- **URL:** facebook.com/marketplace
- **Trust:** 0.45
- **Access:** Logged-out GraphQL (`doc_id=33269364996041474`). No tokens needed from residential IP.
- **Rate limit:** Residential IP required. Datacenter IPs blocked.
- **Extractor:** `extract-facebook-marketplace` or `fb-marketplace-orchestrator`
- **Scraper:** `scripts/fb-marketplace-local-scraper.mjs` — 55 US metros, batch upserts
- **Fields covered:** title, price, location, images (often low quality), seller name
- **Unique challenge:** Year/make filter broken (ignored by API). Must filter by title parsing.
- **Vintage rate:** ~12% of all vehicle listings are vintage

### Craigslist
- **URL:** craigslist.org (per-city subdomains)
- **Trust:** 0.50
- **Access:** Direct fetch (no JS needed)
- **Extractor:** `extract-craigslist`
- **Discovery:** `discover-cl-squarebodies` for targeted regional scanning

### eBay Motors
- **URL:** ebay.com/motors
- **Trust:** 0.55 (seller ratings provide some accountability)
- **Access:** Direct fetch
- **Extractor:** `extract-ebay-motors`

### Hagerty Marketplace
- **URL:** hagerty.com
- **Trust:** 0.70 (Hagerty has institutional reputation)
- **Access:** Direct fetch
- **Extractor:** `extract-hagerty-listing`

### PCarMarket
- **URL:** pcarmarket.com
- **Trust:** 0.75 (Porsche-focused, curated)
- **Access:** API-based (not Firecrawl)
- **Extractor:** `import-pcarmarket-listing`

### ClassicCars.com
- **URL:** classiccars.com
- **Trust:** 0.60
- **Extractor:** `import-classiccars-listing`

### Hemmings
- **URL:** hemmings.com
- **Trust:** 0.65
- **Access:** Direct fetch

---

## Registries (Trust 0.90-0.95)

### NHTSA VIN Decode
- **URL:** vpic.nhtsa.dot.gov/api/
- **Trust:** 0.95 (federal database)
- **Access:** Free public API, no auth needed
- **Rate limit:** Generous (100+ req/min)
- **Tool:** `decode-vin-and-update`
- **Fields covered:** year, make, model, trim, body_style, engine, transmission, drivetrain, fuel_type, doors, seats

---

## Owner Sources (Trust 0.55-0.65)

### Apple Photos (iPhoto)
- **Trust:** 0.60
- **Access:** `osxphotos` CLI (v0.75.1)
- **Tool:** `scripts/iphoto-intake.mjs`
- **Fields covered:** images with EXIF (GPS, date, camera)
- **Note:** Album names have trailing spaces. Many photos are iCloud-only (need `--download-missing`).

### Telegram Restoration Bot
- **Trust:** 0.60
- **Access:** Telegram webhook
- **Tool:** `telegram-restoration-bot` edge function
- **Flow:** Technician sends photos → routed to business → vehicle

---

## Sites That Need Firecrawl

| Site | Reason |
|------|--------|
| carsandbids.com | React SPA |
| collectingcars.com | React SPA |
| pcarmarket.com | API preferred, but Firecrawl as fallback |
| bonhams.com | Next.js — serves empty shells to bots |

All other sites work with direct `fetch()` via `archiveFetch()`.

---

## Source Registration

Every source must be registered in `observation_sources` before observations can be ingested:

```sql
SELECT slug, display_name, category, base_trust_score
FROM observation_sources
WHERE active = true
ORDER BY base_trust_score DESC;
```

To add a new source, see Engineering Manual Chapter 4.
