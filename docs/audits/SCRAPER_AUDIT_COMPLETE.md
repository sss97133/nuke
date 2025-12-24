# SCRAPER AUDIT: SCRAPER → SOURCE → DATABASE LANDING POINTS

**Date:** 2025-01-XX  
**Purpose:** Comprehensive mapping of all scraper functions to their target sources and database landing points

---

## 📊 EXECUTIVE SUMMARY

| Scraper Function | Target Source | Primary DB Table | Discovery Source Value | Status |
|-----------------|---------------|-----------------|------------------------|--------|
| `scrape-sbxcars` | sbxcars.com | `import_queue` → `vehicles` | `sbxcars` | ✅ Active |
| `scrape-vehicle` | Generic (URL-based) | `vehicles` (direct) | Various | ✅ Active |
| `scrape-multi-source` | Generic (any dealer/auction) | `import_queue` → `vehicles` | URL-based | ✅ Active |
| `scrape-ksl-listings` | ksl.com | `import_queue` | `ksl` | ⚠️ Partial |
| `scrape-craigslist-search` | craigslist.org | `vehicles` (via data-router) | `CRAIGSLIST` | ✅ Active |
| `scrape-all-craigslist-squarebodies` | craigslist.org | `vehicles` (direct) | `craigslist_scrape` | ✅ Active |
| `comprehensive-bat-extraction` | bringatrailer.com | `import_queue` | `BRING_A_TRAILER` | ✅ Active |
| `import-bat-listing` | bringatrailer.com | `vehicles`, `bat_listings`, `external_listings` | `bat_import` | ✅ Active |
| `import-classic-auction` | classic.com | `vehicles`, `external_listings` | `classic_com_auction` | ✅ Active |
| `import-pcarmarket-listing` | pcarmarket.com | `vehicles`, `businesses` | `pcarmarket_import` | ✅ Active |
| `discover-cl-squarebodies` | craigslist.org | `craigslist_listing_queue` | N/A (queue only) | ⚠️ Separate queue |
| `discover-classic-sellers` | classic.com | `classic_seller_queue` | N/A (queue only) | ⚠️ Separate queue |
| `index-classic-com-dealer` | classic.com | `businesses` | `classic_com_indexing` | ✅ Active |
| `process-import-queue` | Processes `import_queue` | `vehicles`, `businesses`, `external_identities` | From queue item | ✅ Active |

---

## 🔍 DETAILED MAPPINGS

### 1. `scrape-sbxcars` → SBX Cars

**Source:** `sbxcars.com`  
**Function:** `supabase/functions/scrape-sbxcars/index.ts`

**Data Extracted:**
- Vehicle details (year, make, model, VIN, AMG nomenclature, transmission)
- Auction data (current bid, reserve price, auction end date, status)
- Seller information (name, website)
- Specialist information (name, username)
- Bidder usernames
- Images, description, highlights
- Detailed sections (overview, specs, options, exterior, interior, tech, mechanical, service, condition)
- Carfax URL, inspection data

**Database Landing Points:**
1. **`scrape_sources`** - Creates/updates source record for `sbxcars.com`
2. **`import_queue`** - Adds listing with `source_id`, `listing_url`, `raw_data` containing full listing
3. **`businesses`** - Creates seller organizations (via `createSellerOrganization`)
4. **`external_identities`** - Creates bidder/specialist user identities (via `createAuctionUser`, `createSpecialistUser`)

**Discovery Source:** `sbxcars` (in `raw_data.source`)

**Notes:**
- Uses Firecrawl for structured extraction
- Creates users and organizations before queuing
- Priority: 10 for live auctions, 5 for others

---

### 2. `scrape-vehicle` → Generic Vehicle Scraper

**Source:** Any URL (detects source from URL)  
**Function:** `supabase/functions/scrape-vehicle/index.ts`

**Data Extracted:**
- Vehicle identity (year, make, model, trim, VIN)
- Pricing (asking_price, msrp)
- Specs (mileage, transmission, drivetrain, seats, doors, fuel_type)
- Colors (exterior, interior)
- Engine details
- Description
- Images
- Location
- Dealer information (for Craigslist)

**Database Landing Points:**
1. **`vehicles`** - Direct insert/update (no queue)
2. **`businesses`** - Creates dealer organizations (for Craigslist listings)

**Discovery Source:** Varies by source:
- `Craigslist` for craigslist.org
- `Worldwide Vintage Autos` for worldwidevintageautos.com
- `SBX Cars` for sbxcars.com
- `Firecrawl` for Firecrawl-extracted data
- `beverlyhillscarclub` for BHCC
- `lartdelautomobile` for L'Art

**Notes:**
- Site-specific parsers for: L'Art de l'Automobile, Beverly Hills Car Club, Craigslist, Worldwide Vintage Autos, SBX Cars
- Uses Firecrawl structured extraction as primary method
- Falls back to HTML parsing for specific sites

---

### 3. `scrape-multi-source` → Generic Multi-Source Scraper

**Source:** Any dealer/auction website  
**Function:** `supabase/functions/scrape-multi-source/index.ts`

**Data Extracted:**
- Dealer/organization info (name, address, phone, email, website, specialties)
- Vehicle listings (title, URL, price, year, make, model, mileage, location, images)
- Inventory counts

**Database Landing Points:**
1. **`scrape_sources`** - Creates/updates source record
2. **`businesses`** - Creates/updates dealer/auction house organizations
3. **`import_queue`** - Adds all discovered listings
4. **`dealer_inventory_seen`** - Tracks seen listings (for disappearance detection)
5. **`source_favicons`** - Caches favicons (via `extractAndCacheFavicon`)
6. **`businesses`** - Updates brand assets (logo, banner, portfolio images)

**Discovery Source:** URL-based (from `source_url`)

**Notes:**
- Supports BHCC inventory API (`/isapi_xml.php?module=inventory`)
- Supports L'Art index pages (direct HTML fetch)
- Supports BaT/Classic.com auction index pages
- Creates organizations with geographic matching logic
- Extracts brand DNA (favicon, logo, banner, portfolio images)

---

### 4. `scrape-ksl-listings` → KSL Cars

**Source:** `ksl.com` (specifically `cars.ksl.com`)  
**Function:** `supabase/functions/scrape-ksl-listings/index.ts`

**Data Extracted:**
- Listing URLs
- Basic listing info (title, price, listing ID)

**Database Landing Points:**
1. **`import_queue`** - Adds listings with `source: 'ksl'`, `source_name: 'KSL Cars'`

**Discovery Source:** `ksl` (in `metadata.source`)

**Notes:**
- ⚠️ **INCOMPLETE**: Only extracts URLs, doesn't extract full vehicle data
- Requires Firecrawl (bot protection)
- Does NOT create vehicles directly - relies on `process-import-queue`

---

### 5. `scrape-craigslist-search` → Craigslist Search Results

**Source:** `craigslist.org` (search results pages)  
**Function:** `supabase/functions/scrape-craigslist-search/index.ts`

**Data Extracted:**
- Listing URLs from search results

**Database Landing Points:**
1. **`vehicles`** - Via `scrape-vehicle` → `data-router` (indirect)

**Discovery Source:** `CRAIGSLIST` (via `scrape-vehicle`)

**Notes:**
- Extracts URLs from search results
- Calls `scrape-vehicle` for each URL
- Calls `data-router` to create/update vehicles
- Rate limiting: 1 second between requests

---

### 6. `scrape-all-craigslist-squarebodies` → Craigslist Squarebodies

**Source:** `craigslist.org` (multiple regions)  
**Function:** `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`

**Data Extracted:**
- Vehicle details (year, make, model, price, location, description, images)
- Dealer information (if present)

**Database Landing Points:**
1. **`vehicles`** - Direct insert/update
2. **`businesses`** - Creates dealer organizations (if dealer detected)

**Discovery Source:** `craigslist_scrape` (in `discovery_source`)

**Notes:**
- Searches all major Craigslist regions
- Focuses on 1973-1991 Chevrolet/GMC trucks (squarebodies)
- Direct vehicle creation (no queue)
- Function chaining support for large-scale discovery

---

### 7. `comprehensive-bat-extraction` → Bring a Trailer

**Source:** `bringatrailer.com`  
**Function:** `supabase/functions/comprehensive-bat-extraction/index.ts`

**Data Extracted:**
- Full auction data (bids, comments, watchers, views)
- Seller/buyer information
- Timeline events
- Images
- Vehicle details

**Database Landing Points:**
1. **`import_queue`** - Adds listings for processing
2. **`external_identities`** - Creates seller/buyer identities
3. **`vehicles`** - Creates/updates vehicles (if `vehicleId` provided)
4. **`external_listings`** - Creates external listing records
5. **`organization_vehicles`** - Links to seller organizations

**Discovery Source:** `BRING_A_TRAILER` (in `raw_data.source`)

**Notes:**
- Comprehensive extraction of auction data
- Creates timeline events for bids, comments
- Links to seller organizations if dealer detected

---

### 8. `import-bat-listing` → Bring a Trailer Listing Import

**Source:** `bringatrailer.com` (individual listing URLs)  
**Function:** `supabase/functions/import-bat-listing/index.ts`

**Data Extracted:**
- Vehicle identity (year, make, model, trim, VIN)
- Auction data (sale price, sale date, current bid, bid count, watchers, views, comments)
- Seller/buyer usernames
- Lot number
- Images (via `extractBatGalleryImagesFromHtml`)
- Auction end date

**Database Landing Points:**
1. **`bat_users`** - Creates/updates BaT user identities (seller, buyer)
2. **`vehicles`** - Creates/updates vehicle records
3. **`bat_listings`** - Creates/updates BaT listing records
4. **`external_listings`** - Creates/updates external listing records
5. **`organization_vehicles`** - Links to seller organizations (if dealer)
6. **`vehicle_images`** - Adds images via `backfill-images`
7. **`data_validations`** - Creates validation records for sale_price, year, VIN
8. **`timeline_events`** - Creates sale event (if sold)

**Discovery Source:** `bat_import` (in `profile_origin`, `discovery_source`)

**Notes:**
- Idempotent matching by `bat_auction_url`, `discovery_url`, `listing_url`, or VIN
- Links to seller organizations via Local Partners or explicit `organizationId`
- Stores BaT user IDs in `origin_metadata` for claimable identities
- Creates `external_listings` for live auction telemetry

---

### 9. `import-classic-auction` → Classic.com Auction Import

**Source:** `classic.com` (individual listing URLs)  
**Function:** `supabase/functions/import-classic-auction/index.ts`

**Data Extracted:**
- Vehicle identity (year, make, model from URL/title)
- Auction data (current bid, bid count, end date)
- Listing status (active/sold/ended)
- Images
- Seller information (from profile links)

**Database Landing Points:**
1. **`vehicles`** - Creates/updates vehicle records
2. **`external_listings`** - Creates/updates external listing records
3. **`vehicle_images`** - Adds images via `backfill-images`
4. **`businesses`** - Triggers organization extraction (via `extract-organization-from-seller`)

**Discovery Source:** `classic_com_auction` (in `profile_origin`, `discovery_source`)

**Notes:**
- Uses Firecrawl for JS-heavy pages
- Extracts seller links and triggers organization extraction
- Idempotent matching by `listing_url` or `discovery_url`

---

### 10. `import-pcarmarket-listing` → PCarMarket Listing Import

**Source:** `pcarmarket.com` (individual listing URLs)  
**Function:** `supabase/functions/import-pcarmarket-listing/index.ts`

**Data Extracted:**
- Vehicle identity (year, make, model from URL)
- Auction data (sale price, sale date, auction end date, outcome)
- VIN
- Mileage
- Images
- Description

**Database Landing Points:**
1. **`businesses`** - Creates/updates PCarMarket organization
2. **`vehicles`** - Creates/updates vehicle records
3. **`organization_vehicles`** - Links to PCarMarket organization
4. **`vehicle_images`** - Adds all images from gallery

**Discovery Source:** `pcarmarket_import` (in `profile_origin`, `discovery_source`)

**Notes:**
- Idempotent matching by VIN or `discovery_url`
- Creates PCarMarket organization if not exists
- Links vehicles to organization with `relationship_type: 'sold_by'` or `'consigner'`

---

### 11. `discover-cl-squarebodies` → Craigslist Discovery

**Source:** `craigslist.org` (search across all regions)  
**Function:** `supabase/functions/discover-cl-squarebodies/index.ts`

**Data Extracted:**
- Listing URLs only (no vehicle data)

**Database Landing Points:**
1. **`craigslist_listing_queue`** - Adds URLs to separate queue table

**Discovery Source:** N/A (queue only, not vehicles)

**Notes:**
- ⚠️ **SEPARATE QUEUE**: Uses `craigslist_listing_queue` instead of `import_queue`
- Searches all major Craigslist regions
- Focuses on squarebody search terms (1973-1991 Chevrolet/GMC trucks)
- Function chaining support for large-scale discovery
- Does NOT create vehicles - separate processor needed

---

### 12. `discover-classic-sellers` → Classic.com Seller Discovery

**Source:** `classic.com` (seller directory pages)  
**Function:** `supabase/functions/discover-classic-sellers/index.ts`

**Data Extracted:**
- Seller profile URLs
- Seller names
- Seller types (dealer/auction_house)

**Database Landing Points:**
1. **`classic_seller_queue`** - Adds seller profiles to separate queue table

**Discovery Source:** N/A (queue only, not vehicles)

**Notes:**
- ⚠️ **SEPARATE QUEUE**: Uses `classic_seller_queue` instead of `import_queue`
- Discovers sellers from Classic.com data pages
- Does NOT create organizations - separate processor (`index-classic-com-dealer`) needed

---

### 13. `index-classic-com-dealer` → Classic.com Dealer Indexing

**Source:** `classic.com` (dealer profile URLs)  
**Function:** `supabase/functions/index-classic-com-dealer/index.ts`

**Data Extracted:**
- Dealer profile data (name, logo, website, address, phone, email, dealer license)
- Business type (dealer/auction_house)
- Specialties
- Description
- Inventory/auctions URLs

**Database Landing Points:**
1. **`businesses`** - Creates/updates dealer/auction house organizations
2. **`source_favicons`** - Caches favicons
3. **`businesses`** - Updates brand assets (logo, banner, portfolio images)
4. **`import_queue`** - Triggers inventory extraction (via `scrape-multi-source`)
5. **Team data** - Stores team members (via `storeTeamData`)

**Discovery Source:** `classic_com_indexing` (in `discovered_via`)

**Notes:**
- Uses Firecrawl structured extraction
- Geographic matching logic (dealer license → website → name+city+state)
- Extracts brand DNA (favicon, logo, banner, portfolio images)
- Triggers inventory extraction for discovered organizations

---

### 14. `process-import-queue` → Import Queue Processor

**Source:** Processes items from `import_queue` table  
**Function:** `supabase/functions/process-import-queue/index.ts`

**Data Extracted:**
- Processes queued listings from `import_queue`
- Extracts vehicle data from `raw_data` or scrapes URL if needed

**Database Landing Points:**
1. **`vehicles`** - Creates/updates vehicle records
2. **`businesses`** - Creates/updates organizations (from dealer info in `raw_data`)
3. **`external_identities`** - Creates user identities
4. **`organization_vehicles`** - Links vehicles to organizations
5. **`external_listings`** - Creates external listing records
6. **`scrape_sources`** - Updates source statistics
7. **`import_queue`** - Updates status (pending → processing → completed/failed)

**Discovery Source:** From `raw_data.source` or `discovery_source` field

**Notes:**
- **CRITICAL FUNCTION**: Processes all queued listings
- Uses atomic locking (`claim_import_queue_batch`) to prevent duplicate processing
- Handles Facebook Marketplace listings
- Creates organizations from dealer info
- Links vehicles to organizations
- Batch processing with retry logic

---

## 🚨 ISSUES IDENTIFIED

### 1. **Inconsistent Queue Usage**
- Some scrapers use `import_queue` (standard)
- Some use separate queues (`craigslist_listing_queue`, `classic_seller_queue`)
- Some write directly to `vehicles` (bypassing queue)

**Impact:** Makes tracking and processing inconsistent

### 2. **Incomplete Scrapers**
- `scrape-ksl-listings`: Only extracts URLs, doesn't extract full vehicle data
- `discover-cl-squarebodies`: Only adds to separate queue, no processor
- `discover-classic-sellers`: Only adds to separate queue, no processor

**Impact:** Data not fully ingested

### 3. **Missing Source Registration**
- Some scrapers don't create/update `scrape_sources` records
- Makes tracking source health difficult

**Impact:** No visibility into source status

### 4. **Inconsistent Discovery Source Values**
- Different scrapers use different values for `discovery_source`/`profile_origin`
- Some use uppercase, some lowercase
- Some use underscores, some use hyphens

**Impact:** Difficult to filter/query by source

### 5. **Organization Creation Logic Scattered**
- Some scrapers create organizations directly
- Some rely on `process-import-queue`
- Some use `extract-organization-from-seller`

**Impact:** Inconsistent organization data

---

## ✅ RECOMMENDATIONS

1. **Standardize on `import_queue`**: All scrapers should write to `import_queue`, processed by `process-import-queue`
2. **Complete Incomplete Scrapers**: Finish `scrape-ksl-listings` to extract full vehicle data
3. **Unify Queue Processors**: Merge separate queue processors into `process-import-queue` or create unified processor
4. **Standardize Discovery Source Values**: Use consistent naming (e.g., `SOURCE_NAME` format)
5. **Centralize Organization Creation**: Use `extract-organization-from-seller` or `process-import-queue` for all organization creation
6. **Add Source Registration**: All scrapers should create/update `scrape_sources` records
7. **Add Health Tracking**: All scrapers should update `scrape_sources.last_scraped_at`, `last_successful_scrape`, `total_listings_found`

---

## 📈 METRICS TO TRACK

For each scraper, track:
- **Source Health**: `scrape_sources.last_scraped_at`, `last_successful_scrape`, `total_listings_found`
- **Queue Status**: `import_queue` pending/processing/completed counts
- **Database Growth**: New vehicles created per source
- **Error Rates**: Failed scrapes, processing errors
- **Data Quality**: Field coverage, validation failures

---

## 🔗 RELATED SYSTEMS

- **`unified-scraper-orchestrator`**: Single entry point for all scraping
- **`database-fill-agent`**: Monitors and activates sources
- **`thorough-site-mapper`**: Maps site structure and fields
- **`UnifiedScraperDashboard.tsx`**: Frontend dashboard for monitoring

---

**Last Updated:** 2025-01-XX  
**Next Review:** After implementing recommendations
