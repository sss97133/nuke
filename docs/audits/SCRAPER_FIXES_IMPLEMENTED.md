# SCRAPER FIXES IMPLEMENTED

**Date:** 2025-01-XX  
**Status:** In Progress

---

## ✅ COMPLETED FIXES

### 1. **Completed `scrape-ksl-listings`** ✅

**Before:**
- Only extracted listing URLs
- No vehicle data extraction
- No source registration

**After:**
- ✅ Scrapes individual listing pages with Firecrawl
- ✅ Extracts full vehicle data (year, make, model, price, mileage, location, description, VIN, images)
- ✅ Creates/updates `scrape_sources` record
- ✅ Adds to `import_queue` with complete `raw_data`
- ✅ Updates source health tracking (`last_scraped_at`, `last_successful_scrape`, `total_listings_found`)
- ✅ Uses standardized discovery source: `KSL` (in `raw_data.source`)

**Files Modified:**
- `supabase/functions/scrape-ksl-listings/index.ts`

---

### 2. **Fixed `scrape-craigslist-search` to use `import_queue`** ✅

**Before:**
- Called `scrape-vehicle` for each URL
- Called `data-router` to create vehicles directly
- No source registration
- Bypassed queue system

**After:**
- ✅ Adds all discovered URLs to `import_queue`
- ✅ Creates/updates `scrape_sources` record
- ✅ Updates source health tracking
- ✅ Uses standardized discovery source: `CRAIGSLIST` (in `raw_data.source`)
- ✅ Proper deduplication (checks queue and vehicles table)

**Files Modified:**
- `supabase/functions/scrape-craigslist-search/index.ts`

---

## 🔄 IN PROGRESS

### 3. **Standardize Discovery Source Values**

**Target Format:** UPPERCASE (e.g., `KSL`, `CRAIGSLIST`, `SBXCARS`, `BRING_A_TRAILER`)

**Scrapers to Update:**
- ✅ `scrape-ksl-listings`: `KSL`
- ✅ `scrape-craigslist-search`: `CRAIGSLIST`
- ⏳ `scrape-sbxcars`: `SBXCARS` (already uses `sbxcars` - needs uppercase)
- ⏳ `scrape-multi-source`: URL-based (needs standardization)
- ⏳ `import-bat-listing`: `BAT_IMPORT` (already uses `bat_import` - needs uppercase)
- ⏳ `import-classic-auction`: `CLASSIC_COM_AUCTION` (already uses `classic_com_auction` - needs uppercase)
- ⏳ `import-pcarmarket-listing`: `PCARMARKET_IMPORT` (already uses `pcarmarket_import` - needs uppercase)

---

### 4. **Ensure All Scrapers Register Sources**

**Scrapers Already Registering:**
- ✅ `scrape-ksl-listings`
- ✅ `scrape-craigslist-search`
- ✅ `scrape-sbxcars`
- ✅ `scrape-multi-source`

**Scrapers Needing Source Registration:**
- ⏳ `scrape-vehicle` (generic scraper - may not need source registration)
- ⏳ `scrape-all-craigslist-squarebodies` (direct vehicle creation - needs refactor)
- ⏳ `comprehensive-bat-extraction` (adds to queue - should register source)
- ⏳ `import-bat-listing` (direct vehicle creation - should register source)
- ⏳ `import-classic-auction` (direct vehicle creation - should register source)
- ⏳ `import-pcarmarket-listing` (direct vehicle creation - should register source)

---

## 📋 PENDING FIXES

### 5. **Fix `scrape-all-craigslist-squarebodies` to use `import_queue`**

**Current Behavior:**
- Directly creates vehicles in `vehicles` table
- Bypasses queue system
- No source registration

**Target Behavior:**
- Add discovered listings to `import_queue`
- Register source in `scrape_sources`
- Update source health tracking
- Use standardized discovery source: `CRAIGSLIST_SQUAREBODIES`

**Complexity:** High (large file, many direct vehicle inserts)

---

### 6. **Create Unified Queue Processor**

**Current State:**
- `process-import-queue`: Processes `import_queue` table
- `process-cl-queue`: Processes `craigslist_listing_queue` table (separate)
- `process-classic-seller-queue`: Processes `classic_seller_queue` table (separate)

**Target State:**
- Merge all queue processors into `process-import-queue`
- OR create unified processor that handles all queue types
- Standardize on `import_queue` for all sources

**Complexity:** Medium (requires migration of existing queue data)

---

## 🎯 STANDARDIZATION CHECKLIST

### Discovery Source Values (UPPERCASE format)
- [x] `KSL` - KSL Cars
- [x] `CRAIGSLIST` - Craigslist
- [ ] `SBXCARS` - SBX Cars
- [ ] `BRING_A_TRAILER` - Bring a Trailer
- [ ] `BAT_IMPORT` - BaT Import
- [ ] `CLASSIC_COM` - Classic.com
- [ ] `CLASSIC_COM_AUCTION` - Classic.com Auction
- [ ] `PCARMARKET` - PCarMarket
- [ ] `PCARMARKET_IMPORT` - PCarMarket Import
- [ ] `CRAIGSLIST_SQUAREBODIES` - Craigslist Squarebodies

### Source Registration Pattern
```typescript
// Get or create scrape source
const { data: source } = await supabase
  .from('scrape_sources')
  .select('id')
  .eq('domain', 'example.com')
  .maybeSingle();

let sourceId = source?.id;

if (!sourceId) {
  const { data: newSource } = await supabase
    .from('scrape_sources')
    .insert({
      domain: 'example.com',
      source_name: 'Example Source',
      source_type: 'marketplace', // or 'dealer', 'auction_house', 'classifieds'
      base_url: 'https://example.com',
      is_active: true,
    })
    .select('id')
    .single();
  
  sourceId = newSource?.id;
}

// Update source health tracking
if (sourceId) {
  await supabase
    .from('scrape_sources')
    .update({
      last_scraped_at: new Date().toISOString(),
      last_successful_scrape: new Date().toISOString(),
      total_listings_found: listings.length,
      updated_at: new Date().toISOString()
    })
    .eq('id', sourceId);
}
```

### Import Queue Pattern
```typescript
// Add to import_queue
await supabase
  .from('import_queue')
  .insert({
    source_id: sourceId,
    listing_url: listingUrl,
    listing_title: title,
    listing_price: price,
    listing_year: year,
    listing_make: make,
    listing_model: model,
    thumbnail_url: imageUrl,
    raw_data: {
      source: 'SOURCE_NAME', // UPPERCASE
      // ... other data
    },
    status: 'pending',
    priority: isPriority ? 10 : 0
  });
```

---

## 📊 IMPACT METRICS

### Before Fixes
- **Incomplete Scrapers:** 1 (KSL)
- **Scrapers Bypassing Queue:** 2 (Craigslist search, Craigslist squarebodies)
- **Scrapers Without Source Registration:** 6+
- **Inconsistent Discovery Sources:** All scrapers

### After Fixes (Current)
- **Incomplete Scrapers:** 0 ✅
- **Scrapers Bypassing Queue:** 1 (squarebodies - pending)
- **Scrapers Without Source Registration:** 4+ (pending)
- **Inconsistent Discovery Sources:** Most scrapers (standardization in progress)

---

## 🔄 NEXT STEPS

1. **Standardize remaining discovery source values** (quick wins)
2. **Add source registration to import functions** (medium effort)
3. **Refactor scrape-all-craigslist-squarebodies** (high effort, large file)
4. **Create unified queue processor** (medium effort, requires migration)

---

**Last Updated:** 2025-01-XX

