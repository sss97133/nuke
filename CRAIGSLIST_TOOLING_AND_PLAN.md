# Craigslist Tooling & Extraction Plan

## 📦 Current Tooling Inventory

### 1. **Core Scraping Functions**

#### `scrape-vehicle` Edge Function
**Location:** `supabase/functions/scrape-vehicle/index.ts`

**Capabilities:**
- ✅ Extracts vehicle data (year, make, model, price, mileage, condition, etc.)
- ✅ Parses Craigslist attributes (cylinders, drive, fuel, odometer, color, transmission, body style)
- ✅ **3 fallback methods for image extraction:**
  1. Thumbnail links (`a.thumb` elements)
  2. Slideshow/gallery images
  3. JSON data in inline scripts
- ✅ Upgrades image URLs to high-res (1200x900)
- ✅ Extracts description, location, posted dates
- ✅ Supports Firecrawl for bypassing anti-bot measures

**Usage:**
```typescript
const { data } = await supabase.functions.invoke('scrape-vehicle', {
  body: { url: 'https://sfbay.craigslist.org/...' }
});
```

#### `scrape-all-craigslist-squarebodies` Edge Function
**Location:** `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`

**Capabilities:**
- ✅ Searches 50+ Craigslist regions
- ✅ Uses 10 prioritized search terms (squarebody, C10, K10, etc.)
- ✅ Finds listings via search results
- ✅ Scrapes individual listings inline (no function-to-function calls)
- ✅ Creates vehicles with proper attribution
- ✅ Downloads and uploads images to Supabase Storage
- ✅ Creates timeline events for discovery
- ✅ Creates ghost users for unknown photographers
- ✅ Handles duplicates (VIN matching, year/make/model matching)

**Limitations:**
- Processes max 20 listings per run (to avoid timeout)
- Limited to 10 search terms (to avoid timeout)
- 1 second delay between searches
- 500ms delay between listings

**Usage:**
```typescript
const { data } = await supabase.functions.invoke('scrape-all-craigslist-squarebodies', {
  body: { 
    max_regions: 50,
    max_listings_per_search: 100,
    user_id: 'optional-user-id'
  }
});
```

#### `scrape-craigslist-search` Edge Function
**Location:** `supabase/functions/scrape-craigslist-search/index.ts`

**Capabilities:**
- ✅ Scrapes Craigslist search results pages
- ✅ Extracts individual listing URLs
- ✅ Returns array of listing URLs for batch processing

**Usage:**
```typescript
const { data } = await supabase.functions.invoke('scrape-craigslist-search', {
  body: { 
    search_url: 'https://sfbay.craigslist.org/search/cta?query=squarebody',
    max_listings: 50
  }
});
```

---

### 2. **Backfill & Repair Scripts**

#### `backfill-missing-craigslist-images.js`
**Location:** `scripts/backfill-missing-craigslist-images.js`

**Purpose:** Finds CL vehicles without images and re-scrapes listings to import images

**Process:**
1. Finds vehicles with `discovery_source` containing "craigslist" or "cl"
2. Checks which ones have no images
3. Gets listing URL from `discovery_url`, `external_listings`, or `timeline_events`
4. Re-scrapes listing via `scrape-vehicle` function
5. Downloads and uploads images using same logic as scraper
6. Creates ghost users for photographers
7. Proper attribution via `device_attributions` table

**Usage:**
```bash
node scripts/backfill-missing-craigslist-images.js
```

**Configuration:**
- `MAX_VEHICLES`: null = all, or set to number
- `DRY_RUN`: false = actually import, true = preview only

#### `fix-cl-images-high-res.js`
**Location:** `scripts/fix-cl-images-high-res.js`

**Purpose:** Replaces direct CL image URLs with properly uploaded high-res images

**Process:**
1. Finds vehicles with CL images that are direct URLs (not uploaded)
2. Re-scrapes listing to get all high-res image URLs
3. Downloads images
4. Uploads to Supabase Storage (`vehicle-data` bucket)
5. Updates `vehicle_images` records with new URLs
6. Deletes old direct URL records

**Usage:**
```bash
node scripts/fix-cl-images-high-res.js
```

**Note:** Currently hardcoded to specific vehicle IDs - needs to be made dynamic

#### `link-cl-images-to-incomplete-vehicles.js`
**Location:** `scripts/link-cl-images-to-incomplete-vehicles.js`

**Purpose:** Links CL images to vehicles that were imported without images

**Process:**
1. Takes list of vehicle IDs
2. Gets listing URL from vehicle metadata
3. Scrapes listing for images
4. Links images directly (stores CL URLs, doesn't download)

**Usage:**
```bash
node scripts/link-cl-images-to-incomplete-vehicles.js
```

**Note:** Uses direct CL URLs (not uploaded) - consider using `backfill-missing-craigslist-images.js` instead

#### `import-cl-image-1976-c10.js`
**Location:** `scripts/import-cl-image-1976-c10.js`

**Purpose:** One-off script to import specific CL image for a specific vehicle

**Usage:**
```bash
node scripts/import-cl-image-1976-c10.js
```

---

### 3. **Frontend Integration**

#### `AddVehicle.tsx`
**Location:** `nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx`

**Capabilities:**
- ✅ User can paste Craigslist URL
- ✅ Calls `scrape-vehicle` function
- ✅ Auto-fills form with extracted data
- ✅ Downloads images in background (via CORS proxy)
- ✅ Shows image thumbnails as they download
- ✅ Queues images for upload after vehicle creation
- ✅ Generates Craigslist email template

**Flow:**
```
User pastes URL → Scrape → Extract data + images → Download images → Show preview → Create vehicle → Upload images
```

#### `generateCraigslistEmail.ts`
**Location:** `nuke_frontend/src/utils/generateCraigslistEmail.ts`

**Purpose:** Generates email template for contacting CL sellers

---

### 4. **Data Extraction Quality**

#### What Gets Extracted:
- ✅ **Basic Info:** Year, Make, Model, Trim, Series
- ✅ **Pricing:** Asking price, location
- ✅ **Specs:** Condition, cylinders, drivetrain, fuel type, odometer, color, transmission, body style, title status
- ✅ **Description:** Full listing text (up to 5000 chars)
- ✅ **Images:** Up to 50 images per listing
- ✅ **Dates:** Posted date, updated date
- ✅ **Advanced:** Series inference (K10/K20/C10/C20), bed length (SWB/LWB), engine codes, A/C status, known issues, paint history, seller motivation

#### Image URL Upgrading:
```typescript
function upgradeCraigslistImageUrl(url: string): string {
  // Upgrades: _50x50c.jpg → _1200x900.jpg
  // Upgrades: _300x300.jpg → _1200x900.jpg
  // Upgrades: _600x450.jpg → _1200x900.jpg
  return url.replace(/_(\d+x\d+)\.jpg/, '_1200x900.jpg');
}
```

---

## 🎯 Plan Moving Forward

### Phase 1: **Improve Bulk Scraping** (Current Priority)

**Problem:** `scrape-all-craigslist-squarebodies` is limited to 20 listings per run due to timeout

**Solutions:**

1. **Batch Processing Architecture**
   - Store discovered listing URLs in a queue table
   - Process queue in smaller batches (10-20 at a time)
   - Run via cron job every 15-30 minutes
   - Track progress per listing (pending → processing → complete → failed)

2. **Queue Table Schema:**
```sql
CREATE TABLE craigslist_listing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url TEXT NOT NULL UNIQUE,
  region TEXT,
  search_term TEXT,
  status TEXT DEFAULT 'pending', -- pending, processing, complete, failed
  vehicle_id UUID REFERENCES vehicles(id),
  scraped_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
```

3. **New Edge Function:** `process-craigslist-queue`
   - Processes 10-20 listings from queue
   - Updates status as it goes
   - Retries failed listings (max 3 times)
   - Can be called via cron or manually

4. **Discovery Function:** `discover-craigslist-listings`
   - Searches regions + search terms
   - Adds unique listing URLs to queue
   - Doesn't scrape, just discovers
   - Runs daily/weekly

**Benefits:**
- ✅ No timeout issues (processes small batches)
- ✅ Can resume after failures
- ✅ Can track progress
- ✅ Can prioritize certain regions/terms
- ✅ Can run continuously via cron

---

### Phase 2: **Improve Image Handling**

**Current Issues:**
- Some scripts store direct CL URLs (not uploaded)
- Images can expire if CL listing is deleted
- No image deduplication across vehicles

**Solutions:**

1. **Always Upload Images**
   - Never store direct CL URLs
   - Always download and upload to Supabase Storage
   - Use `UnifiedImageImportService` (already exists for BaT)

2. **Image Deduplication**
   - Hash image URLs/content
   - Check if image already exists before uploading
   - Link existing images to new vehicles if same listing

3. **Image Quality**
   - Always upgrade to highest resolution (1200x900)
   - Generate thumbnails/medium variants
   - Store original URL in metadata for reference

---

### Phase 3: **Optimize Squarebody Search** (Focused Scope)

**Scope:** Squarebody trucks only (1973-1991 Chevy/GMC)

**Year Range:**
- **1973-1987:** Original squarebody generation
- **1988-1991:** Carryover models (same body style, different interior)

**Search Terms (Prioritized):**
```typescript
const SQUAREBODY_SEARCH_TERMS = [
  // Core terms (highest priority)
  'squarebody',
  'square body',
  'C10',
  'C20',
  'C30',
  'K10',
  'K20',
  'K30',
  // Year-specific (1973-1991)
  '1973 chevrolet truck', '1974 chevrolet truck', '1975 chevrolet truck',
  '1976 chevrolet truck', '1977 chevrolet truck', '1978 chevrolet truck',
  '1979 chevrolet truck', '1980 chevrolet truck', '1981 chevrolet truck',
  '1982 chevrolet truck', '1983 chevrolet truck', '1984 chevrolet truck',
  '1985 chevrolet truck', '1986 chevrolet truck', '1987 chevrolet truck',
  '1988 chevrolet truck', '1989 chevrolet truck', '1990 chevrolet truck',
  '1991 chevrolet truck',
  // GMC variants
  '1973 GMC truck', '1974 GMC truck', ... '1991 GMC truck',
  // Model variants
  'chevy square', 'GMC square',
  '73-87 chevy', '73-91 chevy', '73-87 GMC', '73-91 GMC',
  // Common models
  'chevy pickup', 'GMC pickup',
  'chevy truck', 'GMC truck'
];
```

**Filtering:**
- Year: 1973-1991 only
- Make: Chevrolet or GMC only
- Model: Truck, Pickup, Suburban, Blazer, Jimmy, or C/K series

---

### Phase 4: **Data Quality Improvements**

1. **Better Make/Model Parsing**
   - Use AI to parse ambiguous titles
   - Handle typos and variations
   - Normalize make names (Chevy → Chevrolet)

2. **VIN Extraction**
   - Extract VINs from descriptions
   - Validate VINs
   - Use VIN for duplicate detection

3. **Price Normalization**
   - Extract prices from descriptions if not in title
   - Handle "OBO", "firm", "negotiable"
   - Store price confidence score

4. **Location Normalization**
   - Parse city, state from location strings
   - Geocode for distance calculations
   - Store in structured format

---

### Phase 5: **Monitoring & Analytics**

1. **Scraping Metrics**
   - Track listings discovered per day
   - Track vehicles created per day
   - Track images imported per day
   - Track error rates

2. **Quality Metrics**
   - % of listings with images
   - % of listings with complete data
   - % of duplicate listings detected
   - Average data completeness score

3. **Alerting**
   - Alert on high error rates
   - Alert on queue backup
   - Alert on missing images

---

## ✅ What Successful Extraction Looks Like

### For a Single Listing:

1. **Data Extraction:**
   - ✅ Year, Make, Model extracted correctly
   - ✅ Price extracted (if present)
   - ✅ All available attributes extracted (mileage, condition, etc.)
   - ✅ Description extracted (full text)
   - ✅ Location extracted
   - ✅ Posted/updated dates extracted

2. **Image Extraction:**
   - ✅ All images found (up to 50)
   - ✅ Images upgraded to high-res (1200x900)
   - ✅ Images downloaded and uploaded to Supabase Storage
   - ✅ Images properly attributed (ghost user for unknown photographer)
   - ✅ Primary image set (first image)
   - ✅ Images linked to vehicle

3. **Vehicle Creation:**
   - ✅ Vehicle created with all extracted data
   - ✅ `discovery_source` = 'craigslist_scrape'
   - ✅ `discovery_url` = listing URL
   - ✅ `origin_metadata` contains listing details
   - ✅ Timeline event created for discovery
   - ✅ Duplicate detection (VIN or year/make/model match)

4. **Attribution:**
   - ✅ Ghost user created for photographer (if unknown)
   - ✅ Device attribution records created
   - ✅ Images marked as claimable
   - ✅ Source tracking in EXIF data

### For Bulk Scraping:

1. **Discovery:**
   - ✅ Searches all configured regions
   - ✅ Uses all configured search terms
   - ✅ Finds all unique listings (no duplicates)
   - ✅ Adds to queue for processing

2. **Processing:**
   - ✅ Processes queue in batches (10-20 at a time)
   - ✅ Handles errors gracefully (continues on failure)
   - ✅ Retries failed listings (max 3 times)
   - ✅ Updates status as it goes

3. **Results:**
   - ✅ High success rate (>90% of listings processed)
   - ✅ Low duplicate rate (<5% duplicates)
   - ✅ High image import rate (>80% of listings have images)
   - ✅ Complete data for most listings (>70% complete)

---

## 🚨 Current Limitations & Issues

1. **Timeout Issues:**
   - `scrape-all-craigslist-squarebodies` limited to 20 listings per run
   - Function timeout is ~60 seconds
   - Need batch processing architecture

2. **Image Storage:**
   - Some scripts store direct CL URLs (not uploaded)
   - Images can expire if listing deleted
   - Need to always upload to Supabase Storage

3. **Duplicate Detection:**
   - Only checks VIN and year/make/model
   - Doesn't check for similar listings (same vehicle, different listing)
   - Need fuzzy matching for duplicates

4. **Error Handling:**
   - Errors are logged but not retried automatically
   - No tracking of which listings failed and why
   - Need retry logic with exponential backoff

5. **Rate Limiting:**
   - Fixed delays (1 second between searches, 500ms between listings)
   - No adaptive rate limiting based on response times
   - Could be blocked if too aggressive

---

## 📊 Success Metrics

### Current Performance:
- **Discovery:** ~100-200 listings per run (limited by timeout)
- **Processing:** ~20 listings per run (limited by timeout)
- **Success Rate:** ~80-90% (estimated)
- **Image Import Rate:** ~70-80% (estimated)
- **Duplicate Rate:** ~5-10% (estimated)

### Target Performance (Squarebodies Only):
- **Discovery:** 200-500 listings per day (via queue, squarebodies only)
- **Processing:** 100-200 listings per day (via cron)
- **Success Rate:** >95%
- **Image Import Rate:** >90%
- **Duplicate Rate:** <3%
- **Relevance:** >95% (only actual squarebodies, 1973-1991)

---

## 🔧 Next Steps (Priority Order)

1. **✅ DONE:** Core scraping functions working
2. **✅ DONE:** Frontend integration working
3. **✅ DONE:** Backfill scripts for missing images
4. **🔄 IN PROGRESS:** Batch processing architecture (queue table + cron)
5. **⏳ TODO:** Always upload images (never store direct URLs)
6. **⏳ TODO:** Optimize squarebody filtering (ensure 1973-1991 only, Chevy/GMC only)
7. **⏳ TODO:** Improve data quality (AI parsing, VIN extraction)
8. **⏳ TODO:** Monitoring & analytics dashboard
9. **⏳ TODO:** Error retry logic with exponential backoff
10. **⏳ TODO:** Fuzzy duplicate detection

---

## 📝 Notes

- **Firecrawl Integration:** `scrape-vehicle` supports Firecrawl for bypassing anti-bot measures
- **Ghost Users:** Unknown photographers get ghost user accounts for proper attribution
- **Unified Import Service:** BaT imports use `UnifiedImageImportService` - CL should too
- **Timeline Events:** Discovery events are created with listing date (not import date)
- **Attribution:** Images are marked as claimable so photographers can claim them later

---

**Last Updated:** January 2025  
**Status:** Core functionality working, batch processing in progress  
**Scope:** Squarebodies only (1973-1991 Chevy/GMC trucks) - 1973-1987 original + 1988-1991 carryover

