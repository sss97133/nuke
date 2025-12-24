# SCRAPER FIXES SUMMARY

**Date:** 2025-01-XX  
**Status:** ✅ Major Fixes Completed

---

## ✅ COMPLETED FIXES

### 1. **Completed `scrape-ksl-listings`** ✅
- Now scrapes individual listing pages with Firecrawl
- Extracts full vehicle data (year, make, model, price, mileage, location, description, VIN, images)
- Creates/updates `scrape_sources` record
- Adds to `import_queue` with complete `raw_data`
- Updates source health tracking
- Uses standardized discovery source: `KSL`

### 2. **Fixed `scrape-craigslist-search`** ✅
- Now uses `import_queue` instead of direct vehicle creation
- Creates/updates `scrape_sources` record
- Updates source health tracking
- Uses standardized discovery source: `CRAIGSLIST`
- Proper deduplication

### 3. **Standardized Discovery Source Values** ✅
- All scrapers now use UPPERCASE format:
  - `KSL` - KSL Cars
  - `CRAIGSLIST` - Craigslist
  - `SBXCARS` - SBX Cars
  - `BAT_IMPORT` - Bring a Trailer Import
  - `CLASSIC_COM_IMPORT` - Classic.com Import
  - `CLASSIC_COM_AUCTION` - Classic.com Auction
  - `PCARMARKET_IMPORT` - PCarMarket Import

### 4. **Added Source Registration** ✅
- `scrape-ksl-listings`: ✅ Registers source
- `scrape-craigslist-search`: ✅ Registers source
- `scrape-sbxcars`: ✅ Already registered
- `scrape-multi-source`: ✅ Already registered
- `import-bat-listing`: ✅ Now registers source
- `import-classic-auction`: ✅ Now registers source
- `import-pcarmarket-listing`: ✅ Now registers source

### 5. **Added Source Health Tracking** ✅
All scrapers now update:
- `last_scraped_at`
- `last_successful_scrape`
- `total_listings_found` (where applicable)
- `updated_at`

---

## 📊 IMPACT

### Before Fixes
- **Incomplete Scrapers:** 1 (KSL)
- **Scrapers Bypassing Queue:** 2
- **Scrapers Without Source Registration:** 6+
- **Inconsistent Discovery Sources:** All scrapers

### After Fixes
- **Incomplete Scrapers:** 0 ✅
- **Scrapers Bypassing Queue:** 1 (squarebodies - pending)
- **Scrapers Without Source Registration:** 0 ✅
- **Inconsistent Discovery Sources:** Standardized ✅

---

## 🔄 REMAINING WORK

### 1. **Fix `scrape-all-craigslist-squarebodies`** (Pending)
- Large file with many direct vehicle inserts
- Needs refactor to use `import_queue`
- Complexity: High

### 2. **Create Unified Queue Processor** (Pending)
- Merge `process-cl-queue` and `process-classic-seller-queue` into `process-import-queue`
- Or create unified processor
- Complexity: Medium

---

## 📝 FILES MODIFIED

1. `supabase/functions/scrape-ksl-listings/index.ts` - Complete rewrite
2. `supabase/functions/scrape-craigslist-search/index.ts` - Refactored to use queue
3. `supabase/functions/scrape-sbxcars/index.ts` - Standardized discovery source
4. `supabase/functions/import-bat-listing/index.ts` - Added source registration + standardized
5. `supabase/functions/import-classic-auction/index.ts` - Added source registration + standardized
6. `supabase/functions/import-pcarmarket-listing/index.ts` - Added source registration + standardized

---

## 🎯 STANDARDIZATION PATTERNS

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
      total_listings_found: listings.length, // if applicable
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

### Discovery Source Standard
- **Format:** UPPERCASE with underscores
- **Examples:** `KSL`, `CRAIGSLIST`, `SBXCARS`, `BAT_IMPORT`, `CLASSIC_COM_AUCTION`
- **Location:** `raw_data.source` and `profile_origin`/`discovery_source` fields

---

**Last Updated:** 2025-01-XX

