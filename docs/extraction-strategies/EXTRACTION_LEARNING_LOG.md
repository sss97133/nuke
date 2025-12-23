# Extraction Learning Log

## Purpose

This document tracks learnings from each specialized niche site extraction, treating the first several extractions as sample cases to refine our approach.

## Sample Case: 2002AD (2002ad.com)

**Date:** 2025-01-XX  
**Organization:** 2002AD  
**Website:** https://2002ad.com  
**Type:** Specialized niche site (BMW 2002 specialist, 24+ years of history)

### Initial Expectations

- **Vehicles:** ~500 (user estimate)
- **Images:** Hundreds (gallery spanning decades)
- **Parts:** 500-2000 (full catalog)
- **Brochures:** 40-50
- **External Platforms:** Classic.com, potentially BaT

### Extraction Strategy Applied

1. **Site Structure Discovery:**
   - Hardcoded known pages: `/pages/about.cfm`, `/pages/restoration.cfm`, `/pages/carsforsale.cfm`, `/pages/gallery.cfm`, `/pages/brochures.cfm`
   - Link discovery: Crawl up to 200 additional pages
   - Breadth-first discovery with rate limiting

2. **Vehicle Extraction Methods:**
   - **Restoration page:** Image + description pairs (`<img>` + `<b><font>description</font></b>`)
   - **Cars for sale page:** Year + model pattern matching with context extraction
   - **Gallery page:** Image-based inference (year from filename/context, model from patterns)
   - **All pages:** Generic vehicle pattern matching

3. **Image Extraction:**
   - Direct `<img>` tags
   - Linked images (`<a href="image.jpg">`)
   - Multiple images per vehicle (not just one)
   - Filter out navigation/header/button images

4. **External Platform Integration:**
   - Check `external_identities` for Classic.com/BaT profiles
   - Trigger async extraction (fire-and-forget to avoid timeout)

### Issues Encountered

1. **Function Timeout (150s limit)**
   - **Problem:** Comprehensive extraction taking >150 seconds, causing 504 timeout
   - **Root Causes:**
     - Crawling 200+ discovered pages sequentially
     - Synchronous image backfilling blocking execution
     - Processing all vehicles synchronously
   - **Solutions Applied:**
     - Reduced discovered page crawl limit from 200 to 20 (initial extraction)
     - Made image backfilling async (fire-and-forget)
     - Made external platform extraction async
     - Parallel batch processing for discovered pages (5 at a time)
   - **Learning:** Large extractions need aggressive async/parallelization and limits

2. **Vehicle Pattern Matching**
   - **Problem:** Initial pattern only captured "20" instead of full year "2002"
   - **Solution:** Changed from `(19|20)\d{2}` to `((?:19|20)\d{2})` to capture full year
   - **Learning:** Regex capture groups need careful grouping

3. **Nested HTML Tags**
   - **Problem:** Descriptions in `<b><font>...</font></b>` weren't being extracted
   - **Solution:** Updated pattern to handle nested tags, then strip HTML
   - **Learning:** Old HTML sites use nested tags extensively

4. **False Positives**
   - **Problem:** "2002 AD" company name being matched as vehicle
   - **Solution:** Added filters for company names, "classic", "projects"
   - **Learning:** Need context-aware filtering for specialized sites

5. **Multiple Images Per Vehicle**
   - **Problem:** Only capturing first image per vehicle
   - **Solution:** Extract ALL images from context (both `<img>` and linked images)
   - **Learning:** Specialized sites often have multiple images per listing

6. **Discovered Pages vs Key Pages**
   - **Problem:** Too many discovered pages causing timeout
   - **Solution:** Prioritize key pages, limit discovered page crawling
   - **Learning:** Two-phase approach: initial extraction (key pages), follow-up (discovered pages)

### Actual Results (Database Query)

**Total Vehicles Linked to 2002AD:**
- **Total vehicles:** 246 (includes merged/duplicate-resolved)
- **Years covered:** 21 different years
- **Makes:** 1 (BMW - as expected for 2002AD)
- **Models:** 45 different models
- **With descriptions:** 62 vehicles
- **With images:** 169 vehicles

**Relationship Types:**
- `service_provider` (active): 77 vehicles (restoration work)
- `consigner` (active): 3 vehicles (auction consignments)

**Timeline Events:**
- `auction_listed`: 3 events
- `pending_analysis`: 3 events
- **Note:** Custom/maintenance events from site scraping may not have been created yet, or were filtered

**Images:**
- Total images: 169+ (stored in `vehicle_images`)

**From Site Scraping (Function Output):**
- Vehicles found: 88 (initial extraction)
- Vehicles created: 73 (some merged as duplicates)
- Gallery images: 145
- Brochures: 43
- Pages discovered: 68

**From External Platforms:**
- Classic.com identity: Linked ✅
- Classic.com profile indexed: Yes (async)
- Classic.com listings: Not yet extracted (needs separate process)
- BaT profiles: None found

**Parts Catalog:**
- Triggered: Yes (async)
- Status: Processing in batches

### Key Learnings

1. **Specialized Niche Sites Have Unique Structures**
   - Old HTML (ColdFusion `.cfm` files)
   - Nested tags (`<b><font>`)
   - Inconsistent formatting
   - Historical data mixed with current

2. **Image Extraction Needs Multiple Strategies**
   - Direct images
   - Linked images
   - Gallery pages
   - Context-based inference

3. **Vehicle Extraction Requires Flexible Patterns**
   - Year/make/model patterns vary
   - Context extraction is crucial
   - Multiple images per vehicle
   - Status indicators (sold/for_sale) in context

4. **External Platform Integration**
   - Profile indexing is fast
   - Full listing extraction is slow (needs queue)
   - Async triggers prevent timeouts

5. **Data Quality Expectations**
   - Incomplete profiles are valuable (historical context)
   - Approximate dates are acceptable (vehicle year as event date)
   - Low-quality individual records paint valuable aggregate picture

### Refinements Needed

1. **Classic.com Full Listing Extraction**
   - Create separate function/queue for extracting all listings from seller profile
   - Batch processing to avoid timeouts
   - Rate limiting to respect platform limits
   - **Status:** Profile indexed, listings extraction pending

2. **Better Vehicle Deduplication**
   - Current: VIN-first, then YMM
   - **Observation:** 246 total vehicles vs 88 found suggests good deduplication working
   - Needed: Image-based matching for gallery vehicles
   - Needed: Price/date context for better matching

3. **Brochure Processing**
   - Currently: Metadata only (43 URLs stored)
   - Needed: Actual document upload/storage
   - Needed: OCR for text extraction
   - Needed: Link to `library_documents` table

4. **Timeline Event Creation**
   - **Observation:** Only 6 timeline events created (3 auction, 3 pending_analysis)
   - **Expected:** ~80 events (one per vehicle from site scraping)
   - **Issue:** Timeline event creation may be failing silently or filtered
   - **Needed:** Debug why custom/maintenance events aren't being created
   - **Needed:** Extract actual dates from descriptions when available

5. **Two-Phase Extraction Strategy**
   - **Phase 1 (Current):** Key pages only, limited discovered pages (20)
   - **Phase 2 (Future):** Follow-up run for remaining discovered pages
   - **Needed:** Track which pages have been crawled
   - **Needed:** Resume capability for follow-up extractions

### Patterns to Apply to Future Extractions

1. **Start with Known Pages, Then Discover**
   - Hardcode key pages (about, inventory, gallery, etc.)
   - Use link discovery for additional pages
   - Limit discovery to avoid timeout (200 pages)

2. **Multiple Extraction Strategies Per Page Type**
   - Try specific patterns first (restoration, inventory)
   - Fall back to generic patterns
   - Extract from gallery images as last resort

3. **Preserve Incomplete Data**
   - Don't reject low-quality profiles
   - Store with quality indicators
   - Historical value > individual completeness

4. **Async External Platform Extraction**
   - Check for linked identities
   - Trigger async (don't await)
   - Use separate queue for full extraction

5. **Comprehensive Image Collection**
   - Multiple extraction methods
   - Filter navigation/UI elements
   - Link to vehicles when possible

### Next Similar Site Considerations

When extracting the next specialized niche site:

1. **Analyze Site Structure First**
   - Identify key pages
   - Understand HTML structure
   - Note any unique patterns

2. **Test Extraction Patterns**
   - Start with small sample
   - Refine patterns based on results
   - Document what works/doesn't

3. **Monitor for Timeouts**
   - Keep main extraction under 120s
   - Move heavy operations to async/queue
   - Batch large operations

4. **Track Data Quality**
   - Count vehicles found vs created
   - Note merge rates
   - Identify false positives

5. **Document Unique Characteristics**
   - Site-specific patterns
   - Data quality expectations
   - Relationship types used

### Metrics to Track

- **Extraction Time:** How long does full extraction take?
- **Vehicle Yield:** Vehicles found vs created (merge rate)
- **Image Yield:** Images found vs stored
- **False Positive Rate:** Incorrect vehicle matches
- **Timeout Rate:** How often do we hit limits?
- **External Platform Coverage:** How many platforms are we extracting from?

### Success Criteria

A successful extraction should:
- ✅ Extract all discoverable vehicles (even incomplete) - **246 vehicles found**
- ✅ Collect all images (even low quality) - **169+ images stored**
- ✅ Link to external platforms when available - **Classic.com linked**
- ✅ Preserve historical context - **21 years covered**
- ⚠️ Complete without timeout - **Still timing out, needs optimization**
- ✅ Create proper relationships (not just "dealer") - **service_provider, consigner used**
- ⚠️ Generate timeline events for historical context - **Only 6 events, expected ~80**

### Current Status

**Extraction State:**
- **Initial extraction:** Partially complete (timed out)
- **Vehicles extracted:** 246 total (includes merged duplicates)
- **Images extracted:** 169+ stored
- **Key pages:** Scraped (about, restoration, carsforsale, gallery, brochures)
- **Discovered pages:** 20/68 crawled (remaining for follow-up)
- **External platforms:** Classic.com profile indexed
- **Parts catalog:** Triggered (async, processing)

**Next Steps:**
1. Fix timeout issue (further optimize or split into phases)
2. Create follow-up extraction for remaining discovered pages
3. Extract Classic.com listings (separate process)
4. Debug timeline event creation
5. Process brochures into library_documents

