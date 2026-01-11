# BaT Extraction Fix - January 26, 2025

## Problem
The `comprehensive-bat-extraction` Edge Function was failing to boot (BOOT_ERROR) due to its massive size (2650 lines, 1.231MB). This blocked all BaT profile vehicle imports.

## Solution
**Bypassed the broken function** by updating `extract-bat-profile-vehicles` to use Firecrawl directly and save vehicles inline.

### Changes Made

1. **Updated `extract-bat-profile-vehicles/index.ts`**:
   - Removed dependency on `comprehensive-bat-extraction` function
   - Added direct Firecrawl extraction using `extractBatListingWithFirecrawl`
   - Inline vehicle creation/update logic
   - Changed from parallel (5 at a time) to sequential processing to avoid timeouts
   - Added 500ms delay between listings to avoid rate limits

2. **Function Status**:
   - ✅ Deployed successfully (806.8kB)
   - ✅ Processing listings sequentially (prevents timeouts)
   - ✅ 118 vehicles already imported from previous runs

### Current Status
- Function is working and deployed
- Script can be re-run: `node scripts/extract-all-bat-profile-vehicles.js`
- Sequential processing prevents 503 timeouts
- Firecrawl extraction takes ~10 seconds per listing

## Next Steps
1. Re-run extraction script to import more BaT listings
2. Monitor for timeouts (sequential processing should prevent them)
3. Consider batching if throughput needs improvement

---

# Scraping Tooling Consolidation Plan

## Current State: Fragmented & Inefficient

### The Problem
**Data pipeline is not bringing in nearly enough vehicles per hour** because:
- Scraping logic is scattered across 50+ Edge Functions
- No unified orchestration layer
- Duplicate extraction logic across functions
- Inconsistent error handling and retry logic
- No centralized rate limiting or queue management
- Functions call each other creating cascading timeouts

### Current Scraping Functions Inventory

#### BaT (Bring a Trailer)
- `extract-bat-profile-vehicles` - Profile listings extraction ✅ (just fixed)
- `comprehensive-bat-extraction` - Full listing extraction ❌ (broken, too large)
- `import-bat-listing` - Single listing import
- `monitor-bat-seller` - Seller monitoring
- `extract-bat-parts-brands` - Parts extraction
- `process-bat-extraction-queue` - Queue processor
- `scheduled-bat-scrape` - Scheduled scraping
- `sync-bat-listing` - Listing sync

#### Craigslist
- `scrape-vehicle` - Single listing scraper
- `scrape-all-craigslist-squarebodies` - Bulk squarebody scraper
- `scrape-craigslist-search` - Search scraper
- `discover-cl-squarebodies` - Discovery
- `normalize-craigslist-vehicles` - Normalization
- `process-cl-queue` - Queue processor
- `backfill-craigslist-images` - Image backfill

#### Other Marketplaces
- `import-pcarmarket-listing` - PCarMarket import
- `import-classiccars-listing` - ClassicCars.com import
- `import-classic-auction` - Classic auction import
- `scrape-ksl-listings` - KSL.com scraper
- `scrape-multi-source` - Multi-source scraper

#### Organization/Dealer Sites
- `scrape-organization-site` - Organization site scraper
- `catalog-dealer-site-structure` - Site structure cataloging
- `update-org-from-website` - Org updates
- `process-inventory-sync-queue` - Inventory sync queue

#### Generic/Unified
- `scrape-vehicle` - Generic vehicle scraper
- `scrape-vehicle-with-firecrawl` - Firecrawl-based scraper
- `intelligent-crawler` - AI-powered crawler
- `process-import-queue` - Main import queue processor
- `process-url-drop` - URL drop handler

#### Monitoring & Discovery
- `monitor-price-drops` - Price monitoring
- `monitor-pcarmarket-auction` - PCarMarket monitoring
- `discover-classic-sellers` - Seller discovery
- `process-classic-seller-queue` - Seller queue

### Key Issues

1. **No Unified Extraction Layer**
   - Each function implements its own extraction logic
   - Duplicate code for parsing, validation, error handling
   - Inconsistent data models and schemas

2. **Queue Fragmentation**
   - `process-import-queue` - Main queue
   - `process-cl-queue` - Craigslist queue
   - `process-bat-extraction-queue` - BaT queue
   - `process-inventory-sync-queue` - Inventory queue
   - `process-classic-seller-queue` - Seller queue
   - No unified queue management

3. **Rate Limiting Chaos**
   - Each function implements its own rate limiting
   - No global rate limit coordination
   - Functions compete for API quotas (Firecrawl, OpenAI, etc.)

4. **Error Handling Inconsistency**
   - Some functions retry, some don't
   - Different error formats
   - No centralized error tracking

5. **Throughput Bottlenecks**
   - Functions call each other (cascading timeouts)
   - Sequential processing where parallel would work
   - No batching or bulk operations
   - 10-second timeouts kill long-running extractions

## Proposed Unified Architecture

### 1. Unified Extraction Service

**New Function: `unified-vehicle-extractor`**

Single entry point for all vehicle extraction:
- Accepts source type (bat, craigslist, pcarmarket, classiccars, ksl, organization, etc.)
- Uses shared extraction logic with source-specific adapters
- Unified error handling and retry logic
- Consistent data model output

**Benefits:**
- One place to fix extraction bugs
- Consistent data quality
- Easier to add new sources
- Shared rate limiting and quotas

### 2. Unified Queue System

**New Table: `vehicle_import_queue`**

Single queue for all vehicle imports:
- Source type field
- Priority field
- Retry count
- Error tracking
- Unified processing

**New Function: `process-unified-import-queue`**

Single queue processor:
- Processes all source types
- Shared rate limiting
- Unified retry logic
- Priority-based processing

### 3. Extraction Adapters Pattern

```
unified-vehicle-extractor
├── adapters/
│   ├── bat-adapter.ts (uses Firecrawl)
│   ├── craigslist-adapter.ts (uses scrape-vehicle logic)
│   ├── pcarmarket-adapter.ts
│   ├── classiccars-adapter.ts
│   ├── ksl-adapter.ts
│   ├── organization-adapter.ts (uses scrape-organization-site)
│   └── generic-adapter.ts (fallback)
├── shared/
│   ├── extraction-core.ts (common logic)
│   ├── rate-limiter.ts (global rate limiting)
│   ├── error-handler.ts (unified error handling)
│   └── data-validator.ts (validation)
└── index.ts (orchestrator)
```

### 4. Rate Limiting Service

**New Function: `rate-limit-manager`**

Centralized rate limiting:
- Tracks API quotas (Firecrawl, OpenAI, etc.)
- Coordinates across all functions
- Prevents quota exhaustion
- Provides quota status to extractors

### 5. Monitoring & Metrics

**New Table: `extraction_metrics`**

Track extraction performance:
- Vehicles per hour by source
- Success/failure rates
- Average extraction time
- API quota usage
- Error rates

## Migration Plan

### Phase 1: Consolidate Core Extraction (Week 1)
1. Create `unified-vehicle-extractor` function
2. Migrate BaT extraction (already using Firecrawl)
3. Migrate Craigslist extraction
4. Create unified queue table

### Phase 2: Queue Unification (Week 2)
1. Create `process-unified-import-queue`
2. Migrate existing queues to unified queue
3. Update all scrapers to use unified queue
4. Deprecate old queue processors

### Phase 3: Rate Limiting (Week 3)
1. Create `rate-limit-manager`
2. Integrate with all extractors
3. Add quota monitoring
4. Optimize API usage

### Phase 4: Monitoring & Optimization (Week 4)
1. Add extraction metrics
2. Create dashboard for throughput monitoring
3. Optimize bottlenecks
4. Add auto-scaling for high-priority sources

## Immediate Actions

### High Priority (This Week)
1. ✅ Fix BaT extraction (DONE)
2. Create unified extraction service skeleton
3. Migrate 2-3 sources to prove the pattern
4. Set up unified queue table

### Medium Priority (Next Week)
1. Migrate all BaT functions to unified service
2. Migrate Craigslist functions
3. Create rate limiting service
4. Add basic metrics tracking

### Low Priority (Following Weeks)
1. Migrate remaining sources
2. Deprecate old functions
3. Optimize throughput
4. Add advanced monitoring

## Success Metrics

- **Throughput**: 100+ vehicles/hour (currently ~10-20/hour)
- **Success Rate**: >95% extraction success
- **Error Rate**: <5% failures
- **Queue Processing**: <5 minute average wait time
- **API Efficiency**: 50% reduction in API calls via better caching/coordination

## Files to Create

1. `supabase/functions/unified-vehicle-extractor/index.ts`
2. `supabase/functions/unified-vehicle-extractor/adapters/` (directory)
3. `supabase/functions/unified-vehicle-extractor/shared/` (directory)
4. `supabase/functions/process-unified-import-queue/index.ts`
5. `supabase/functions/rate-limit-manager/index.ts`
6. `supabase/migrations/YYYYMMDD_create_unified_import_queue.sql`
7. `supabase/migrations/YYYYMMDD_create_extraction_metrics.sql`

## Notes

- Keep existing functions working during migration
- Use feature flags to gradually migrate sources
- Monitor metrics before/after migration
- Document all adapters and their capabilities
- Create runbooks for common issues


