# BaT Extractor Audit Report

**Date:** 2026-02-01
**Audited by:** Claude (Sonnet 4.5)
**Problem:** 18+ BaT-related functions causing fragmentation and maintenance overhead

---

## Executive Summary

**CANONICAL EXTRACTOR: `extract-bat-core`**

This is the approved BaT extraction function, explicitly referenced by `complete-bat-import` as the official workflow. It should be the ONLY full-extraction function going forward.

**Recommended Actions:**
1. Keep `extract-bat-core` as the canonical extractor
2. Keep 5 supporting functions (discovery, queue, sync, price-fix, postprocess)
3. Deprecate/remove 12 functions (duplicates, incomplete, or obsolete)

---

## Function Matrix

| Function | Purpose | LOC | Uses AI? | Uses Firecrawl? | Complete? | Tables Written | Recommendation |
|----------|---------|-----|----------|-----------------|-----------|----------------|----------------|
| **extract-bat-core** | Core BaT extractor (HTML → vehicle) | 2016 | No | No | **YES** | vehicles, vehicle_images, external_listings, auction_events, timeline_events, listing_page_snapshots, extraction_metadata | **KEEP - CANONICAL** |
| bat-simple-extract | Older BaT extractor | 1129 | No | Optional | Yes | vehicles, vehicle_images, external_listings, timeline_events, organization_vehicles | **DEPRECATE** (duplicate of extract-bat-core) |
| bat-extract | Mid-generation extractor with versioning | 1052 | No | Optional | Yes | vehicles, vehicle_images, external_listings, auction_events, timeline_events, organization_vehicles | **DEPRECATE** (duplicate of extract-bat-core) |
| bat-queue-worker | Production queue processor | 206 | No | No | Helper | Calls other extractors | **KEEP** (queue infrastructure) |
| bat-url-discovery | Scrapes BaT results pages for URLs | 296 | No | No | Helper | import_queue | **KEEP** (URL discovery) |
| bat-year-crawler | Crawls all BaT completed auctions | 334 | No | No | Helper | import_queue | **KEEP** (discovery/backfill) |
| crawl-bat-active | Discovers active BaT auctions (RSS + Firecrawl) | 302 | No | Yes | Helper | import_queue | **CONSOLIDATE** (merge with bat-url-discovery) |
| complete-bat-import | Orchestrator: calls extract-bat-core + comments | 189 | No | No | Orchestrator | None (calls other functions) | **KEEP** (official entry point) |
| sync-bat-listing | Live polling for bid/watcher count updates | 404 | No | Optional | Helper | external_listings | **KEEP** (live sync for active auctions) |
| auto-fix-bat-prices | Detects and fixes price mismatches | 428 | No | No | Helper | vehicles, timeline_events | **KEEP** (data quality) |
| bat-multisignal-postprocess | Creates auction_event_links and timeline repairs | 479 | No | No | Helper | auction_events, auction_event_links, timeline_events | **KEEP** (post-processing for resales) |
| extract-bat-parts-brands | AI extraction of parts/brands from description | 283 | **Yes (OpenAI)** | No | Helper | vehicle_parts, brands, part_mentions | **EVALUATE** (specialized use case) |
| extract-bat-profile-vehicles | Scrapes BaT member profiles for vehicle list | 470 | No | Yes | Helper | Calls other extractors | **DEPRECATE** (low usage, high complexity) |
| process-bat-extraction-queue | Legacy queue processor | 383 | No | No | Helper | Calls other extractors | **DEPRECATE** (replaced by bat-queue-worker) |
| analyze-batch-contextual | Contextual image batch analysis | 816 | **Yes** | No | Helper | image_analysis, batch_analysis | **EVALUATE** (image analysis - separate concern) |
| batch-analyze-vehicle | Vehicle-level batch analysis | 230 | **Yes** | No | Helper | image_analysis | **EVALUATE** (image analysis - separate concern) |
| validate-bat-image | AI-powered image validation | 385 | **Yes** | No | Helper | image_validation | **EVALUATE** (image validation - separate concern) |
| api-v1-batch | Bulk vehicle/observation import API | 335 | No | No | Helper | vehicles, vehicle_observations | **KEEP** (API endpoint, not BaT-specific) |
| import-bat-data | Placeholder function (no logic) | 40 | No | No | **NO** | None | **DELETE** (placeholder only) |

---

## Detailed Analysis

### 1. CORE EXTRACTION (Duplicates - Choose ONE)

#### **extract-bat-core** ✅ CANONICAL
- **Size:** 2016 LOC (most comprehensive)
- **Modified:** Jan 29, 2026
- **Features:**
  - Saves HTML snapshots to `listing_page_snapshots` (evidence preservation)
  - Extracts clean title/year/make/model (removes SEO cruft)
  - Extracts BaT Essentials (seller/location/lot)
  - Extracts description + images
  - Creates `vehicles`, `vehicle_images`, `external_listings`, `auction_events`
  - Creates `timeline_events` for auction dates
  - Creates `extraction_metadata` for provenance tracking
  - No Firecrawl (free, direct HTML fetch)
  - No AI (rule-based extraction)
- **Used by:** `complete-bat-import` (official orchestrator)
- **Tables:** 7 tables (most comprehensive data model)
- **Recommendation:** **KEEP - This is the canonical extractor**

#### bat-simple-extract
- **Size:** 1129 LOC
- **Modified:** Feb 1, 2026 (11:13 AM)
- **Features:**
  - Similar to extract-bat-core but older
  - Uses `batFetcher.ts` shared utility (hybrid direct/Firecrawl)
  - Writes to `organization_vehicles` (not in extract-bat-core)
  - Does NOT save HTML snapshots (no evidence preservation)
  - Comments note: "Comments extracted separately via extract-auction-comments"
- **Tables:** 5 tables
- **Recommendation:** **DEPRECATE** - Older version, less comprehensive than extract-bat-core

#### bat-extract
- **Size:** 1052 LOC
- **Modified:** Feb 1, 2026 (5:09 PM - most recent)
- **Features:**
  - Mid-generation extractor
  - Has versioning system (`EXTRACTOR_VERSION = 'bat-extract:2.0.0'`)
  - Handles resales (same VIN, different auction)
  - Detects BaT Alumni status
  - Sanitizes control characters from JSON
  - Uses `batFetcher.ts` (hybrid direct/Firecrawl)
- **Tables:** 6 tables (includes auction_events)
- **Recommendation:** **DEPRECATE** - Good features but extract-bat-core is the approved workflow

**Why extract-bat-core wins:**
1. Explicitly called by `complete-bat-import` (line 69: "Approved BaT workflow")
2. Saves HTML snapshots for evidence/debugging
3. Most comprehensive (2016 LOC vs 1129/1052)
4. Most tables written (7 vs 5-6)
5. Free (no Firecrawl dependency)

---

### 2. DISCOVERY FUNCTIONS (Keep for URL gathering)

#### bat-url-discovery ✅ KEEP
- **Purpose:** Scrapes BaT results pages to discover listing URLs
- **Method:** Direct HTML scraping (no Firecrawl)
- **Writes:** `import_queue`
- **Actions:** `discover`, `status`, `continuous`
- **Recommendation:** **KEEP** - Essential for backfill and discovery

#### bat-year-crawler ✅ KEEP
- **Purpose:** Crawls ALL BaT completed auctions by pagination
- **Method:** Direct HTML scraping
- **Writes:** `import_queue`
- **Recommendation:** **KEEP** - Essential for historical backfill

#### crawl-bat-active
- **Purpose:** Discovers active BaT auctions (RSS + Firecrawl map)
- **Method:** RSS feed + Firecrawl for link discovery
- **Writes:** `import_queue`
- **Recommendation:** **CONSOLIDATE** - Merge RSS logic into bat-url-discovery, deprecate Firecrawl usage

---

### 3. QUEUE INFRASTRUCTURE (Keep for automation)

#### bat-queue-worker ✅ KEEP
- **Purpose:** Production worker for processing URLs from `import_queue`
- **Method:** Atomic claims, stealth delays, parallel-safe
- **Features:** Calls extractors, tracks failures, prevents duplicates
- **Recommendation:** **KEEP** - Core automation infrastructure

#### process-bat-extraction-queue
- **Purpose:** Legacy queue processor
- **Method:** Claims from `bat_extraction_queue` (different table)
- **Recommendation:** **DEPRECATE** - Replaced by bat-queue-worker

---

### 4. LIVE SYNC (Keep for active auctions)

#### sync-bat-listing ✅ KEEP
- **Purpose:** Live polling for bid count, watcher count, current bid
- **Method:** Hybrid (direct or Firecrawl for live data)
- **Writes:** `external_listings`
- **Recommendation:** **KEEP** - Essential for tracking active auctions

---

### 5. DATA QUALITY (Keep for correctness)

#### auto-fix-bat-prices ✅ KEEP
- **Purpose:** Detects and fixes price mismatches between DB and BaT
- **Method:** Scrapes live price, compares to DB, creates timeline events
- **Writes:** `vehicles`, `timeline_events`
- **Recommendation:** **KEEP** - Critical for data quality

---

### 6. POST-PROCESSING (Keep for resale handling)

#### bat-multisignal-postprocess ✅ KEEP
- **Purpose:** Creates auction_event_links (resale edges) and timeline repairs
- **Method:** Ensures auction_events exist, links prior listings, extracts repair claims
- **Writes:** `auction_events`, `auction_event_links`, `timeline_events`
- **Recommendation:** **KEEP** - Essential for resale tracking

---

### 7. SPECIALIZED EXTRACTORS (Evaluate case-by-case)

#### extract-bat-parts-brands
- **Purpose:** AI extraction of parts/brands from listing description
- **Method:** OpenAI GPT-4o
- **Writes:** `vehicle_parts`, `brands`, `part_mentions`
- **Usage:** Low (specialized use case)
- **Recommendation:** **EVALUATE** - Keep if parts data is valuable, otherwise deprecate

#### extract-bat-profile-vehicles
- **Purpose:** Scrapes BaT member profiles for all their vehicles
- **Method:** Firecrawl to render profile page, then extract listing URLs
- **Writes:** None (calls other extractors)
- **Usage:** Low
- **Recommendation:** **DEPRECATE** - High complexity, low value

---

### 8. IMAGE ANALYSIS (Separate concern - not core extraction)

These three functions are for image analysis, not core BaT extraction. They should be evaluated separately.

#### analyze-batch-contextual
- **Purpose:** Contextual image batch analysis (sentiment, commitment score)
- **Method:** AI (likely Claude/OpenAI)
- **Recommendation:** **KEEP** (separate concern - image analysis system)

#### batch-analyze-vehicle
- **Purpose:** Vehicle-level batch image analysis
- **Method:** AI
- **Recommendation:** **KEEP** (separate concern - image analysis system)

#### validate-bat-image
- **Purpose:** AI-powered image validation
- **Method:** AI
- **Recommendation:** **KEEP** (separate concern - image quality)

---

### 9. ORCHESTRATORS (Keep official entry point)

#### complete-bat-import ✅ KEEP
- **Purpose:** Official BaT import orchestrator
- **Method:** Calls extract-bat-core + extract-auction-comments
- **Comment:** "✅ Approved BaT workflow"
- **Recommendation:** **KEEP** - Official entry point for BaT imports

---

### 10. GENERIC APIs (Not BaT-specific)

#### api-v1-batch
- **Purpose:** Bulk vehicle/observation import API (generic, not BaT-specific)
- **Recommendation:** **KEEP** - Generic API, not BaT-specific

---

### 11. DEAD CODE (Delete)

#### import-bat-data
- **Purpose:** Placeholder function with no logic
- **Code:** Just returns a message to use external script
- **Recommendation:** **DELETE** - No functionality

---

## Missing Features Analysis

### What extract-bat-core is missing (that other functions have):

1. **Versioning** (from bat-extract)
   - `EXTRACTOR_VERSION` tracking
   - Should be added to extract-bat-core

2. **BaT Alumni detection** (from bat-extract)
   - Detects if vehicle was previously sold on BaT
   - Should be added to extract-bat-core

3. **Resale handling** (from bat-extract)
   - Better handling of same VIN, different auction
   - Should be added to extract-bat-core

4. **Control character sanitization** (from bat-extract)
   - Sanitizes JSON output to prevent parser errors
   - Should be added to extract-bat-core

5. **Organization linking** (from bat-simple-extract)
   - Writes to `organization_vehicles` table
   - Should be added to extract-bat-core OR handled by complete-bat-import

### What extract-bat-core has (that others don't):

1. **HTML snapshot preservation** (`listing_page_snapshots`)
2. **Extraction metadata tracking** (`extraction_metadata`)
3. **More comprehensive title cleaning** (removes SEO cruft)
4. **Standardized entity decoding**
5. **More robust image URL normalization**

---

## Recommendation Summary

### KEEP (7 functions)
1. **extract-bat-core** - Canonical extractor
2. **complete-bat-import** - Official orchestrator
3. **bat-queue-worker** - Queue infrastructure
4. **bat-url-discovery** - URL discovery
5. **bat-year-crawler** - Historical backfill
6. **sync-bat-listing** - Live sync
7. **auto-fix-bat-prices** - Data quality
8. **bat-multisignal-postprocess** - Resale tracking

### EVALUATE (4 functions - separate concerns)
1. **analyze-batch-contextual** - Image analysis (not core extraction)
2. **batch-analyze-vehicle** - Image analysis (not core extraction)
3. **validate-bat-image** - Image validation (not core extraction)
4. **extract-bat-parts-brands** - AI parts extraction (specialized)

### DEPRECATE (5 functions)
1. **bat-simple-extract** - Duplicate of extract-bat-core (older)
2. **bat-extract** - Duplicate of extract-bat-core (mid-gen)
3. **process-bat-extraction-queue** - Replaced by bat-queue-worker
4. **extract-bat-profile-vehicles** - Low value, high complexity
5. **crawl-bat-active** - Consolidate into bat-url-discovery

### DELETE (1 function)
1. **import-bat-data** - Placeholder with no logic

### NOT BaT-SPECIFIC (1 function)
1. **api-v1-batch** - Generic API endpoint

---

## Implementation Plan

### Phase 1: Enhance extract-bat-core (Immediate)
1. Add versioning system from bat-extract
2. Add BaT Alumni detection
3. Add resale handling improvements
4. Add control character sanitization
5. Test thoroughly

### Phase 2: Update complete-bat-import (Immediate)
1. Add organization linking logic (from bat-simple-extract)
2. Ensure it uses enhanced extract-bat-core

### Phase 3: Consolidate Discovery (Week 1)
1. Merge crawl-bat-active RSS logic into bat-url-discovery
2. Remove Firecrawl dependency from discovery
3. Test discovery pipeline

### Phase 4: Deprecation Warnings (Week 2)
1. Add deprecation warnings to:
   - bat-simple-extract
   - bat-extract
   - process-bat-extraction-queue
   - extract-bat-profile-vehicles
   - crawl-bat-active
2. Log warning when these are called
3. Return error message suggesting extract-bat-core

### Phase 5: Update Documentation (Week 2)
1. Update CLAUDE.md to reference extract-bat-core only
2. Document the official workflow:
   - Discovery: bat-url-discovery / bat-year-crawler
   - Queue: bat-queue-worker
   - Extraction: complete-bat-import → extract-bat-core
   - Comments: extract-auction-comments
   - Live sync: sync-bat-listing
   - Post-process: bat-multisignal-postprocess
   - Data quality: auto-fix-bat-prices

### Phase 6: Monitor and Remove (Week 3-4)
1. Monitor deprecated function calls for 2 weeks
2. If zero usage, delete:
   - bat-simple-extract
   - bat-extract
   - process-bat-extraction-queue
   - extract-bat-profile-vehicles
   - crawl-bat-active
   - import-bat-data

---

## Official BaT Workflow (After Consolidation)

```
┌─────────────────────────────────────────────────────────┐
│                    DISCOVERY PHASE                       │
│  bat-url-discovery / bat-year-crawler → import_queue    │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    QUEUE PROCESSING                      │
│              bat-queue-worker (automated)                │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                  EXTRACTION PHASE                        │
│              complete-bat-import (orchestrator)          │
│                       ↓                                  │
│         extract-bat-core (canonical extractor)           │
│         extract-auction-comments (comments/bids)         │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                 POST-PROCESSING PHASE                    │
│         bat-multisignal-postprocess (resales)            │
│         auto-fix-bat-prices (data quality)               │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                  LIVE SYNC PHASE (active auctions)       │
│         sync-bat-listing (bid/watcher updates)           │
└─────────────────────────────────────────────────────────┘
```

---

## Fragmentation Impact Analysis

### Current State (18 functions)
- **Confusion:** Developers don't know which extractor to use
- **Maintenance:** Bug fixes must be applied to 3 different extractors
- **Drift:** Features diverge (versioning in one, HTML snapshots in another)
- **Testing:** Must test 3 extractors for same functionality
- **Documentation:** Unclear which is "official"

### After Consolidation (7 core + 4 specialized)
- **Clarity:** extract-bat-core is THE extractor
- **Maintenance:** Single codebase for core extraction
- **Consistency:** All extractions use same logic
- **Testing:** Test once, deploy everywhere
- **Documentation:** Clear official workflow

---

## Risk Assessment

### Risks of Consolidation
- **Low Risk:** extract-bat-core is already the approved function
- **Migration:** Need to ensure all features from bat-extract/bat-simple-extract are ported
- **Testing:** Comprehensive testing required after feature additions

### Risks of NOT Consolidating
- **High Risk:** Continued fragmentation
- **Bug Multiplication:** Same bugs in 3+ places
- **Feature Drift:** Inconsistent extraction results
- **Developer Confusion:** Which function should I use?

---

## Conclusion

The audit reveals clear fragmentation with 3 complete extractors, 5 duplicate/obsolete functions, and scattered features.

**extract-bat-core** is the clear winner:
1. Officially approved (referenced by complete-bat-import)
2. Most comprehensive (2016 LOC, 7 tables)
3. Best practices (HTML snapshots, metadata tracking)
4. Free (no Firecrawl costs)

**Action Plan:**
1. Port missing features to extract-bat-core
2. Deprecate duplicates
3. Keep essential supporting functions (discovery, queue, sync, quality)
4. Delete dead code
5. Update documentation

**Expected Outcome:**
- 18 functions → 11 functions (7 core + 4 specialized)
- Single canonical extractor (extract-bat-core)
- Clear workflow documentation
- Reduced maintenance burden
- Consistent extraction quality

---

**End of Audit**
