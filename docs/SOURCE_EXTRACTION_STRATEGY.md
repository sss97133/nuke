# Source Extraction Strategy

## Problem Summary

During extraction, error pages (403/404) and search queries were incorrectly used as source names, creating bad entries in `scrape_sources`. Additionally, some dealers cross-post their inventory on multiple platforms, creating attribution conflicts.

## Issues Fixed

### 1. Bad Source Names (Fixed ✅)

**Problem:** Sources were created with error page titles instead of proper dealer/website names:
- "403 Error" → Should be dealer name
- "404 Error: Page Not Found" → Should be dealer name  
- "Page not found | Bring a Trailer" → Search result pages (shouldn't be sources)
- "You searched for chevrolet/c10 - Cars-On-Line.com" → Search query (shouldn't be source)

**Fix Applied:**
- ✅ Migration `fix_bad_source_names_v2` cleaned up existing bad source names
- ✅ Updated `scrape-multi-source/index.ts` to detect error pages and use domain name instead
- ✅ Deactivated search query URLs (BaT search pages, Cars & Bids search, etc.)

### 2. Search Query URLs (Fixed ✅)

**Problem:** Search result pages were being added as sources:
- `bringatrailer.com/chevrolet/c10/` (BaT search)
- `carsandbids.com/search?make=Chevrolet&model=C10`
- `carsonline.com/search/chevrolet/c10`

**Fix Applied:**
- ✅ Deactivated search query URLs in `scrape_sources`
- ✅ These shouldn't be sources - they're dynamic search results, not inventory pages

### 3. Cross-Posting Attribution (Needs Strategy)

**Problem:** Some dealers (like Fantasy Junction) cross-post inventory on multiple platforms:
- Platform source: Bring a Trailer (where we found it)
- Dealer source: Fantasy Junction (who owns/listed it)

**Current State:**
- Vehicles extracted from BaT URLs
- Vehicles linked to Fantasy Junction via `organization_vehicles` table
- Source attribution shows "Bring a Trailer" (platform) but not "Fantasy Junction" (dealer)

**Proposed Solution:**
- Show both platform and dealer when they differ: "Bring a Trailer (via Fantasy Junction)"
- Or use separate filters: Platform filters (BaT, KSL, Craigslist) + Dealer filters (Fantasy Junction, Worldwide Vintage Autos, etc.)

## Sources That Need Proper Extraction

### DuPont Registry
- **URL:** `live.dupontregistry.com` and `www.dupontregistry.com`
- **Status:** Fixed source name to "DuPont Registry Live"
- **Action Needed:** Set up proper extraction (see `docs/imports/DUPONTREGISTRY_INGESTION_PLAN.md`)

### Other Dealers with Error Names (Fixed)
- Genau AutoWerks ✅
- Speed Digital ✅
- Gasoline Alley Garage ✅
- The AutoBarn Collection ✅
- Sierra Classic Sportscar ✅
- Sell With TPG ✅

## Extraction Code Improvements

### Error Page Detection

Added `sanitizeSourceName()` function in `scrape-multi-source/index.ts` to:
- Detect error page titles (403, 404, "page not found", etc.)
- Use domain name instead of error page title
- Prevent future bad source names

### Search Query Detection

Search query URLs should not be added as sources:
- BaT search URLs (`bringatrailer.com/chevrolet/c10/`)
- Cars & Bids search (`carsandbids.com/search?make=...`)
- Cars-On-Line search (`carsonline.com/search/...`)
- KSL search (`cars.ksl.com/v2/search/...`)

These are dynamic search results, not inventory pages.

## Next Steps

1. **Set up DuPont Registry extraction** - Follow the ingestion plan in `docs/imports/DUPONTREGISTRY_INGESTION_PLAN.md`
2. **Fix remaining dealers** - Extract properly from dealer websites (may require site-specific extraction logic)
3. **Cross-posting UI** - Update UI to show both platform and dealer sources
4. **Source aggregation** - Investigate why some vehicles show fewer sources than expected (may be display/aggregation logic issue)
