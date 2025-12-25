# SCRAPING DEPARTMENT HANDOFF DOCUMENT

**Date:** 2025-01-XX  
**Status:** Major Fixes Completed, Remaining Work Identified  
**Priority:** High - Critical Department for Data Ingestion

---

## 🎯 CONTEXT & MISSION

The scraping department is responsible for ingesting vehicle listings from multiple sources into the database. The user's goal is to have a fully automated system that:
1. Discovers new sources automatically
2. Maps each source thoroughly (95%+ field coverage)
3. Ingests data consistently into the database
4. Provides accountability and tracking
5. Accumulates thousands of new profiles every couple hours

**User's Frustration Points (Addressed):**
- ✅ "So many shitty tools that don't work" - Fixed incomplete scrapers
- ✅ "No accountability or tracking" - Added source registration and health tracking
- ✅ "Lack of new profiles" - Fixed scrapers to properly queue data
- ✅ "Only 5 sources in dashboard" - Fixed frontend to load dynamically from DB

---

## ✅ WHAT WE ACCOMPLISHED

### 1. **Comprehensive Audit** ✅
- **Document:** `docs/audits/SCRAPER_AUDIT_COMPLETE.md`
- Mapped all 14 scrapers to their sources and database landing points
- Identified inconsistencies and issues
- Created detailed mapping of scraper → source → database tables

### 2. **Fixed Incomplete Scrapers** ✅
- **`scrape-ksl-listings`**: Now extracts full vehicle data (was only extracting URLs)
  - Scrapes individual listing pages with Firecrawl
  - Extracts: year, make, model, price, mileage, location, description, VIN, images
  - Files: `supabase/functions/scrape-ksl-listings/index.ts`

### 3. **Standardized Queue Usage** ✅
- **`scrape-craigslist-search`**: Now uses `import_queue` (was creating vehicles directly)
  - Files: `supabase/functions/scrape-craigslist-search/index.ts`

### 4. **Standardized Discovery Source Values** ✅
- All scrapers now use UPPERCASE format:
  - `KSL`, `CRAIGSLIST`, `SBXCARS`, `BAT_IMPORT`, `CLASSIC_COM_IMPORT`, `CLASSIC_COM_AUCTION`, `PCARMARKET_IMPORT`
- Updated files:
  - `supabase/functions/scrape-sbxcars/index.ts`
  - `supabase/functions/import-bat-listing/index.ts`
  - `supabase/functions/import-classic-auction/index.ts`
  - `supabase/functions/import-pcarmarket-listing/index.ts`

### 5. **Added Source Registration** ✅
- All import functions now register sources in `scrape_sources` table
- All scrapers update source health tracking:
  - `last_scraped_at`
  - `last_successful_scrape`
  - `total_listings_found`
  - `updated_at`

---

## 📋 CURRENT STATE

### **Scrapers Status**

| Scraper | Source | Queue | Source Reg | Health Track | Status |
|---------|--------|-------|-----------|--------------|--------|
| `scrape-ksl-listings` | ksl.com | ✅ `import_queue` | ✅ | ✅ | ✅ Fixed |
| `scrape-craigslist-search` | craigslist.org | ✅ `import_queue` | ✅ | ✅ | ✅ Fixed |
| `scrape-sbxcars` | sbxcars.com | ✅ `import_queue` | ✅ | ✅ | ✅ Good |
| `scrape-multi-source` | Generic | ✅ `import_queue` | ✅ | ✅ | ✅ Good |
| `scrape-vehicle` | Generic | Direct | ❌ | ❌ | ⚠️ Generic scraper |
| `scrape-all-craigslist-squarebodies` | craigslist.org | ❌ Direct | ❌ | ❌ | 🔴 Needs Fix |
| `comprehensive-bat-extraction` | bringatrailer.com | ✅ `import_queue` | ⚠️ Partial | ⚠️ Partial | ⚠️ Needs Source Reg |
| `import-bat-listing` | bringatrailer.com | Direct | ✅ | ✅ | ✅ Fixed |
| `import-classic-auction` | classic.com | Direct | ✅ | ✅ | ✅ Fixed |
| `import-pcarmarket-listing` | pcarmarket.com | Direct | ✅ | ✅ | ✅ Fixed |
| `discover-cl-squarebodies` | craigslist.org | ⚠️ `craigslist_listing_queue` | ❌ | ❌ | 🔴 Separate Queue |
| `discover-classic-sellers` | classic.com | ⚠️ `classic_seller_queue` | ❌ | ❌ | 🔴 Separate Queue |
| `index-classic-com-dealer` | classic.com | Direct (orgs) | ✅ | ✅ | ✅ Good |
| `process-import-queue` | Processes queue | N/A | N/A | N/A | ✅ Critical |

### **Database Tables Used**

**Primary Landing Points:**
- `vehicles` - Main vehicle profiles
- `import_queue` - Staging table for vehicle processing
- `businesses` - Organization/dealer profiles
- `external_identities` - User identities from external platforms
- `organization_vehicles` - Links vehicles to organizations
- `external_listings` - External marketplace listings
- `scrape_sources` - Source registration and health tracking

**Secondary Tables:**
- `vehicle_images` - Vehicle photos
- `bat_listings` - BaT-specific auction data
- `bat_users` - BaT user identities
- `timeline_events` - Vehicle history
- `data_validations` - Data quality validations

**Separate Queues (Need Unification):**
- `craigslist_listing_queue` - Used by `discover-cl-squarebodies`
- `classic_seller_queue` - Used by `discover-classic-sellers`

---

## 🔴 REMAINING CRITICAL WORK

### 1. **Fix `scrape-all-craigslist-squarebodies`** (HIGH PRIORITY)

**Current State:**
- Directly creates vehicles in `vehicles` table
- Bypasses `import_queue` system
- No source registration
- No health tracking
- Large file (~1300 lines) with many direct inserts

**Target State:**
- Add discovered listings to `import_queue`
- Register source in `scrape_sources`
- Update source health tracking
- Use standardized discovery source: `CRAIGSLIST_SQUAREBODIES`

**File:** `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`

**Approach:**
1. Find all `supabase.from('vehicles').insert()` calls
2. Replace with `import_queue` inserts
3. Add source registration at start
4. Add health tracking at end
5. Keep discovery logic, change landing point

**Complexity:** High (large file, many inserts)

---

### 2. **Unify Queue Processors** (MEDIUM PRIORITY)

**Current State:**
- `process-import-queue`: Processes `import_queue` table ✅
- `process-cl-queue`: Processes `craigslist_listing_queue` table (separate) ⚠️
- `process-classic-seller-queue`: Processes `classic_seller_queue` table (separate) ⚠️

**Target State:**
- Option A: Merge all into `process-import-queue`
- Option B: Create unified processor that handles all queue types
- Option C: Migrate separate queues to `import_queue` and deprecate separate processors

**Files:**
- `supabase/functions/process-import-queue/index.ts` (main processor)
- `supabase/functions/process-cl-queue/index.ts` (needs review)
- `supabase/functions/process-classic-seller-queue/index.ts` (needs review)

**Approach:**
1. Review `process-cl-queue` and `process-classic-seller-queue`
2. Determine if they can be merged into `process-import-queue`
3. If yes: Add queue type detection to `process-import-queue`
4. If no: Create unified processor
5. Migrate existing queue data to `import_queue`
6. Update scrapers to use `import_queue`

**Complexity:** Medium (requires migration of existing queue data)

---

### 3. **Add Source Registration to Remaining Scrapers** (LOW PRIORITY)

**Scrapers Needing Source Registration:**
- `comprehensive-bat-extraction` - Adds to queue, should register source
- `scrape-vehicle` - Generic scraper (may not need, but should consider)

**Pattern to Follow:**
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

---

## 📁 KEY FILES & PATTERNS

### **Standard Patterns Established**

#### **1. Source Registration Pattern**
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
      source_type: 'marketplace', // 'dealer', 'auction_house', 'classifieds'
      base_url: 'https://example.com',
      is_active: true,
    })
    .select('id')
    .single();
  
  sourceId = newSource?.id;
}
```

#### **2. Import Queue Pattern**
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

#### **3. Source Health Tracking Pattern**
```typescript
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

#### **4. Discovery Source Standard**
- **Format:** UPPERCASE with underscores
- **Examples:** `KSL`, `CRAIGSLIST`, `SBXCARS`, `BAT_IMPORT`, `CLASSIC_COM_AUCTION`
- **Location:** `raw_data.source` and `profile_origin`/`discovery_source` fields

---

### **Key Files Reference**

**Scrapers:**
- `supabase/functions/scrape-ksl-listings/index.ts` - ✅ Fixed
- `supabase/functions/scrape-craigslist-search/index.ts` - ✅ Fixed
- `supabase/functions/scrape-sbxcars/index.ts` - ✅ Standardized
- `supabase/functions/scrape-multi-source/index.ts` - ✅ Good
- `supabase/functions/scrape-vehicle/index.ts` - Generic scraper
- `supabase/functions/scrape-all-craigslist-squarebodies/index.ts` - 🔴 Needs Fix
- `supabase/functions/comprehensive-bat-extraction/index.ts` - ⚠️ Needs Source Reg

**Import Functions:**
- `supabase/functions/import-bat-listing/index.ts` - ✅ Fixed
- `supabase/functions/import-classic-auction/index.ts` - ✅ Fixed
- `supabase/functions/import-pcarmarket-listing/index.ts` - ✅ Fixed

**Queue Processors:**
- `supabase/functions/process-import-queue/index.ts` - ✅ Main processor
- `supabase/functions/process-cl-queue/index.ts` - ⚠️ Separate queue
- `supabase/functions/process-classic-seller-queue/index.ts` - ⚠️ Separate queue

**Discovery Functions:**
- `supabase/functions/discover-cl-squarebodies/index.ts` - 🔴 Uses separate queue
- `supabase/functions/discover-classic-sellers/index.ts` - 🔴 Uses separate queue
- `supabase/functions/index-classic-com-dealer/index.ts` - ✅ Good

**Orchestration:**
- `supabase/functions/unified-scraper-orchestrator/index.ts` - Main orchestrator
- `supabase/functions/database-fill-agent/index.ts` - Monitors and activates sources
- `supabase/functions/thorough-site-mapper/index.ts` - Deep site analysis

**Frontend:**
- `nuke_frontend/src/pages/CursorHomepage.tsx` - ✅ Fixed (loads sources dynamically)
- `nuke_frontend/src/pages/admin/UnifiedScraperDashboard.tsx` - Dashboard

**Documentation:**
- `docs/audits/SCRAPER_AUDIT_COMPLETE.md` - Full audit
- `docs/audits/SCRAPER_FIXES_IMPLEMENTED.md` - Fix log
- `docs/audits/SCRAPER_FIXES_SUMMARY.md` - Quick reference

---

## 🔍 ISSUES IDENTIFIED

### **1. Inconsistent Queue Usage**
- Most scrapers use `import_queue` ✅
- `scrape-all-craigslist-squarebodies` creates vehicles directly 🔴
- `discover-cl-squarebodies` uses `craigslist_listing_queue` 🔴
- `discover-classic-sellers` uses `classic_seller_queue` 🔴

**Impact:** Makes tracking and processing inconsistent

### **2. Missing Source Registration**
- `comprehensive-bat-extraction` doesn't register source ⚠️
- `scrape-vehicle` doesn't register source (generic scraper) ⚠️

**Impact:** No visibility into source status

### **3. Separate Queue Tables**
- `craigslist_listing_queue` - Separate from `import_queue`
- `classic_seller_queue` - Separate from `import_queue`

**Impact:** Requires separate processors, harder to track

---

## 🎯 RECOMMENDATIONS (Priority Order)

### **Priority 1: Fix `scrape-all-craigslist-squarebodies`**
1. Read the file: `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`
2. Find all `supabase.from('vehicles').insert()` calls
3. Replace with `import_queue` inserts
4. Add source registration at start
5. Add health tracking at end
6. Test with small batch first

### **Priority 2: Unify Queue Processors**
1. Review `process-cl-queue` and `process-classic-seller-queue`
2. Determine migration strategy:
   - Option A: Migrate queue data to `import_queue`, update scrapers
   - Option B: Add queue type detection to `process-import-queue`
3. Update `discover-cl-squarebodies` to use `import_queue`
4. Update `discover-classic-sellers` to use `import_queue`

### **Priority 3: Add Source Registration**
1. Add to `comprehensive-bat-extraction`
2. Consider adding to `scrape-vehicle` (may need domain detection)

### **Priority 4: Standardize Remaining Discovery Sources**
- Review all scrapers for remaining lowercase/underscore variations
- Standardize to UPPERCASE format

---

## 🔗 RELATED SYSTEMS

### **Autonomous Systems (Should Integrate)**
- `autonomous-source-ingestion-agent` - Discovers and ingests new sources
- `database-fill-agent` - Monitors database state, activates sources
- `thorough-site-mapper` - Maps site structure and fields (95%+ coverage goal)

### **Monitoring & Dashboard**
- `unified-scraper-orchestrator` - Single entry point for all scraping
- `UnifiedScraperDashboard.tsx` - Frontend dashboard
- `scrape_sources` table - Source health tracking
- `scraper_runs` table - Run history
- `scraper_run_logs` table - Detailed logs

### **Database Schema**
- `import_queue` - Main staging table (with atomic locking)
- `scrape_sources` - Source registry
- `vehicles` - Final landing point
- `businesses` - Organization profiles
- `external_identities` - User identities

---

## 📊 METRICS TO MONITOR

### **Source Health**
- `scrape_sources.last_scraped_at` - Last scrape attempt
- `scrape_sources.last_successful_scrape` - Last successful scrape
- `scrape_sources.total_listings_found` - Total discovered
- `scrape_sources.is_active` - Active status

### **Queue Status**
- `import_queue` pending/processing/completed counts
- Queue processing rate
- Error rates

### **Database Growth**
- New vehicles created per source
- New organizations created
- Field coverage per source

### **Data Quality**
- Field extraction stats (`field_extraction_stats` table)
- Validation failures
- Duplicate detection

---

## 🚀 QUICK START COMMANDS

### **Test a Scraper**
```bash
# Test KSL scraper
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/scrape-ksl-listings \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"searchUrl": "https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1970/yearTo/1991", "maxListings": 10}'
```

### **Check Source Health**
```sql
SELECT 
  domain,
  source_name,
  last_scraped_at,
  last_successful_scrape,
  total_listings_found,
  is_active
FROM scrape_sources
ORDER BY last_scraped_at DESC;
```

### **Check Queue Status**
```sql
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT source_id) as sources
FROM import_queue
GROUP BY status;
```

### **Check Recent Imports**
```sql
SELECT 
  discovery_source,
  COUNT(*) as vehicles,
  MAX(created_at) as last_import
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY vehicles DESC;
```

---

## 🎓 KEY LEARNINGS

1. **Standardization is Critical**: Inconsistent patterns make the system hard to maintain
2. **Queue System Works**: `import_queue` with `process-import-queue` is the right pattern
3. **Source Registration Essential**: Without it, no visibility into what's working
4. **Health Tracking Matters**: `last_scraped_at`, `last_successful_scrape` are critical metrics
5. **Discovery Source Consistency**: UPPERCASE format makes filtering/querying easier

---

## 📝 NOTES FOR NEXT SESSION

1. **User's Goal**: Fully automated system that discovers sources and ingests data without manual effort
2. **Accountability**: User wants to hold the system accountable for database needs (thousands of new profiles every couple hours)
3. **Thorough Mapping**: Every site needs its own map with rules to properly match data to fields (95%+ coverage)
4. **Frontend Fixed**: Dashboard now loads sources dynamically from `scrape_sources` table
5. **Major Fixes Done**: KSL completed, Craigslist search fixed, source registration added, discovery sources standardized

---

## 🔄 CONTINUATION CHECKLIST

When resuming work:

- [ ] Review `docs/audits/SCRAPER_AUDIT_COMPLETE.md` for full context
- [ ] Review `docs/audits/SCRAPER_FIXES_SUMMARY.md` for what's done
- [ ] Fix `scrape-all-craigslist-squarebodies` (Priority 1)
- [ ] Unify queue processors (Priority 2)
- [ ] Add source registration to remaining scrapers (Priority 3)
- [ ] Test all scrapers end-to-end
- [ ] Verify source health tracking is working
- [ ] Check dashboard shows all active sources
- [ ] Monitor `import_queue` processing rate
- [ ] Verify database growth metrics

---

## 🆘 TROUBLESHOOTING

### **If scrapers aren't running:**
1. Check `scrape_sources.is_active = true`
2. Check `unified-scraper-orchestrator` status
3. Check `database-fill-agent` logs
4. Check Firecrawl API key (many scrapers require it)

### **If queue isn't processing:**
1. Check `process-import-queue` cron job
2. Check `import_queue` status counts
3. Check for locked batches (atomic locking)
4. Review `process-import-queue` logs

### **If no new vehicles:**
1. Check source health (`last_successful_scrape`)
2. Check queue status (pending vs processing)
3. Check `process-import-queue` error logs
4. Verify scrapers are actually discovering listings

---

**Last Updated:** 2025-01-XX  
**Next Session Focus:** Fix `scrape-all-craigslist-squarebodies`, Unify queue processors

