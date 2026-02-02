# Extraction Sources Inventory
**Generated**: 2026-02-01
**Total Extractor Functions**: 48
**Total Sources with Queued Items**: 77
**Total Pending Items**: 77,859

---

## Executive Summary

### Blocked by External Dependencies
- **AI-Dependent Functions**: 125+ functions use OpenAI/Anthropic (BLOCKED)
- **Firecrawl-Dependent Functions**: 89+ functions use Firecrawl API (BLOCKED)

### Can Run NOW (No AI, No Firecrawl)
The following extractors are functional and have queued items:

| Source | Extractor Function | Queue Count (Pending) | Status |
|--------|-------------------|----------------------|--------|
| Bring a Trailer | `complete-bat-import` | 77,022 | ✅ READY |
| Bring a Trailer | `extract-auction-comments` | 77,022 | ✅ READY (comment extraction) |
| Craigslist | (unknown) | 539 | ⚠️ Needs verification |
| Classic.com | (unknown) | 10 | ⚠️ Needs verification |

---

## Full Extractor Function Inventory

### Primary Extractors (Active Sources)

#### Bring a Trailer
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `complete-bat-import` | ❌ No | ❌ No | 77,022 pending, 127,936 complete | **READY** - Orchestrator, calls other functions |
| `bat-simple-extract` | ❌ No | ❌ No | N/A | **DEPRECATED** - Use complete-bat-import |
| `extract-bat-core` | ❌ No | ✅ Yes (shared) | N/A | **BLOCKED** - Uses batFetcher which may use Firecrawl |
| `extract-auction-comments` | ❌ No | ❌ No | N/A | **READY** - Scrapes BaT comments via DOM parsing |
| `crawl-bat-active` | ❌ No | ⚠️ Mentions Firecrawl | N/A | **PARTIAL** - Uses RSS + optional Firecrawl map |
| `bat-url-discovery` | ❌ No | ✅ Yes | N/A | **BLOCKED** |
| `bat-year-crawler` | ❌ No | Unknown | N/A | ⚠️ Needs review |
| `process-bat-extraction-queue` | ❌ No | Unknown | N/A | ⚠️ Needs review |

**BaT Summary**: **77,022 pending** items ready to process with `complete-bat-import` and `extract-auction-comments`

---

#### Cars & Bids
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `extract-cars-and-bids-core` | ❌ No | ✅ Yes | 2 pending | **BLOCKED** - Requires Firecrawl for 403 bypass |
| `extract-cars-and-bids-comments` | Unknown | ✅ Yes | N/A | **BLOCKED** |

**C&B Summary**: 2 pending items, **BLOCKED** (Firecrawl dependency)

---

#### Hagerty Marketplace
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `extract-hagerty-listing` | ❌ No | ✅ Yes | 0 pending | **BLOCKED** - Uses Firecrawl for JS rendering |

**Hagerty Summary**: No pending items, **BLOCKED** (Firecrawl dependency)

---

#### PCarMarket
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `import-pcarmarket-listing` | ❌ No | ✅ Yes | 2 failed | **BLOCKED** - Uses Firecrawl |

**PCarMarket Summary**: 2 failed items, **BLOCKED** (Firecrawl dependency)

---

#### Bonhams
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `extract-bonhams` | ❌ No | ✅ Yes | 8 pending | **BLOCKED** - Uses Firecrawl |

**Bonhams Summary**: 8 pending items, **BLOCKED** (Firecrawl dependency)

---

#### Classic.com
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| (Unknown) | Unknown | Unknown | 10 pending | ⚠️ No dedicated extractor found |

---

#### Craigslist
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| (Unknown) | Unknown | Unknown | 539 pending | ⚠️ No dedicated extractor found |

---

#### ClassicCars.com
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| `import-classiccars-listing` | ✅ Yes | Unknown | Various pending | **BLOCKED** - Uses AI for image analysis |

---

#### L'Art de l'Automobile
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| (Unknown) | Unknown | Unknown | 951 complete | ✅ Already processed |

---

#### Beverly Hills Car Club
| Function | Uses AI? | Uses Firecrawl? | Queue Status | Notes |
|----------|----------|-----------------|--------------|-------|
| (Unknown) | Unknown | Unknown | 2,012 complete | ✅ Already processed |

---

### Generic/Universal Extractors

| Function | Uses AI? | Uses Firecrawl? | Purpose |
|----------|----------|-----------------|---------|
| `extract-vehicle-data-ai` | ✅ Yes | ❌ No | **BLOCKED** - Universal AI extractor for unknown sources |
| `extract-using-catalog` | ✅ Yes | ✅ Yes | **BLOCKED** - AI + Firecrawl |
| `extract-with-proof-and-backfill` | ✅ Yes | ✅ Yes | **BLOCKED** - AI + Firecrawl |
| `extract-and-route-data` | ✅ Yes | ❌ No | **BLOCKED** - AI router |
| `scrape-vehicle` | ❌ No | ✅ Yes | **BLOCKED** - Firecrawl wrapper |
| `scrape-multi-source` | ✅ Yes | ✅ Yes | **BLOCKED** - AI + Firecrawl |

---

### Queue Processing & Orchestration

| Function | Uses AI? | Uses Firecrawl? | Purpose |
|----------|----------|-----------------|---------|
| `process-import-queue` | Unknown | Unknown | Processes import_queue items |
| `process-content-extraction` | Unknown | Unknown | Content extraction processor |
| `ralph-wiggum-extract` | ✅ Yes | ❌ No | **BLOCKED** - AI-powered extraction |
| `ralph-wiggum-rlm-extraction-coordinator` | ✅ Yes | ❌ No | **READY** - Coordination brief (read-only) |
| `autonomous-extraction-agent` | ✅ Yes | Unknown | **BLOCKED** - AI agent |
| `intelligent-crawler` | ✅ Yes | Unknown | **BLOCKED** - AI crawler |
| `smart-extraction-router` | ✅ Yes | Unknown | **BLOCKED** - AI router |

---

### Discovery & Enrichment

| Function | Uses AI? | Uses Firecrawl? | Purpose |
|----------|----------|-----------------|---------|
| `discover-comment-data` | ✅ Yes | ❌ No | **BLOCKED** - AI sentiment analysis |
| `discover-description-data` | ✅ Yes | ❌ No | **BLOCKED** - AI field extraction |
| `discover-from-observations` | ✅ Yes | ❌ No | **BLOCKED** - AI insights |
| `discover-organization-full` | ✅ Yes | ✅ Yes | **BLOCKED** - AI + Firecrawl |
| `extract-organization-from-seller` | Unknown | Unknown | Organization extraction |
| `ingest-org-complete` | ✅ Yes | ✅ Yes | **BLOCKED** - AI + Firecrawl |

---

### Specialized Extractors

| Function | Uses AI? | Uses Firecrawl? | Purpose |
|----------|----------|-----------------|---------|
| `extract-pdf-text` | Unknown | Unknown | PDF text extraction |
| `extract-title-data` | ✅ Yes | ❌ No | **BLOCKED** - AI title extraction |
| `extract-vin-from-vehicle` | Unknown | Unknown | VIN extraction |
| `receipt-extract` | ✅ Yes | ❌ No | **BLOCKED** - AI receipt parsing |
| `detect-vehicles-in-content` | ✅ Yes | ❌ No | **BLOCKED** - AI vehicle detection |
| `validate-vehicle-image` | ✅ Yes | ❌ No | **BLOCKED** - AI image validation |
| `analyze-vehicle-documents` | ✅ Yes | ❌ No | **BLOCKED** - AI document analysis |

---

### Backfill & Bulk Operations

| Function | Uses AI? | Uses Firecrawl? | Purpose |
|----------|----------|-----------------|---------|
| `backfill-make-model-firecrawl` | ❌ No | ✅ Yes | **BLOCKED** - Firecrawl backfill |
| `bulk-enqueue-inventory-extraction` | Unknown | ✅ Yes | **BLOCKED** - Bulk enqueue |
| `re-extract-pending-vehicles` | Unknown | Unknown | Re-extraction processor |

---

### Other Platform Extractors

| Platform | Function | Uses AI? | Uses Firecrawl? | Status |
|----------|----------|----------|-----------------|--------|
| Facebook Marketplace | `extract-facebook-marketplace` | ✅ Yes | ✅ Yes | **BLOCKED** |
| Premium Auctions | `extract-premium-auction` | ✅ Yes | ❌ No | **BLOCKED** |
| Build Posts | `extract-build-posts` | Unknown | Unknown | ⚠️ Review needed |
| Wayback Machine | `extract-wayback-listing` | Unknown | Unknown | ⚠️ Review needed |
| Wayback Machine | `extract-wayback-index` | Unknown | Unknown | ⚠️ Review needed |

---

## Queue Status by Source (Top 20)

| Source | Complete | Pending | Failed | Processing | Duplicate | Skipped |
|--------|----------|---------|--------|------------|-----------|---------|
| **Bring a Trailer** | 127,936 | 77,022 | 2,246 | 2,316 | 6,952 | 4,860 |
| Craigslist | 3,662 | 539 | 0 | 0 | 805 | 366 |
| Beverly Hills Car Club | 2,012 | 0 | 0 | 0 | 0 | 15 |
| L'Art de l'Automobile | 951 | 0 | 0 | 0 | 40 | 9 |
| Classic Car Deals | 83 | 0 | 0 | 0 | 0 | 17 |
| Bring a Trailer (Search) | 54 | 0 | 0 | 0 | 29 | 3 |
| TBTFW | 36 | 0 | 0 | 0 | 0 | 0 |
| www.111motorcars.com | 20 | 0 | 0 | 0 | 1 | 0 |
| A-GC Motors | 15 | 0 | 0 | 0 | 0 | 2 |
| 111 Motorcars | 12 | 0 | 0 | 0 | 0 | 2 |
| GMC Jimmy For Sale - BaT | 11 | 0 | 0 | 0 | 3 | 0 |
| www.motorcars-intl.com | 11 | 1 | 0 | 0 | 0 | 1 |
| KSL (Search) | 11 | 0 | 0 | 0 | 0 | 4 |
| www.pfaffreserve.com | 10 | 0 | 0 | 0 | 0 | 4 |
| Autos of Palm Beach | 9 | 0 | 0 | 0 | 0 | 1 |
| americansupercars.com | 9 | 0 | 0 | 0 | 0 | 0 |
| Bonhams | 3 | 8 | 0 | 0 | 0 | 0 |
| Classic.com | 8 | 10 | 0 | 0 | 1 | 8 |
| Exclusive Motor Club | 8 | 0 | 0 | 0 | 0 | 0 |
| wobcars.com | 8 | 0 | 0 | 0 | 0 | 0 |

---

## Actionable Items - Can Run NOW

### 1. Bring a Trailer (77,022 pending)
**Extractor**: `complete-bat-import`
**Dependencies**: None (uses direct HTTP + DOM parsing)
**Action**: Deploy and process pending queue

```bash
# Test single extraction
curl -X POST "$VITE_SUPABASE_URL/functions/v1/complete-bat-import" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"bat_url": "https://bringatrailer.com/listing/[SLUG]/"}'

# Process batch from queue
# (Requires queue processor function)
```

**Alternative**: `extract-auction-comments`
- Extracts comments from BaT listings
- No AI or Firecrawl dependency
- Can be used standalone for comment enrichment

---

### 2. Craigslist (539 pending)
**Extractor**: Unknown / Missing
**Action**: Need to identify or create extractor
- Check if existing function exists
- If not, create new DOM-based extractor (Craigslist is simple HTML)

---

### 3. Classic.com (10 pending)
**Extractor**: Unknown / Missing
**Action**: Investigate source, create extractor if needed

---

## Blocked Items Summary

### AI-Blocked Functions (125+)
Cannot run without OpenAI/Anthropic API access:
- All AI-powered extractors
- Image analysis functions
- Document parsing functions
- Sentiment analysis
- Discovery agents

### Firecrawl-Blocked Functions (89+)
Cannot run without Firecrawl API:
- Cars & Bids (requires JS rendering + 403 bypass)
- Hagerty Marketplace (Next.js app)
- Bonhams (8 pending items)
- PCarMarket (2 failed items)
- Most discovery/crawl functions

### Dual-Blocked (Both AI + Firecrawl)
- `extract-using-catalog`
- `extract-with-proof-and-backfill`
- `scrape-multi-source`
- `discover-organization-full`
- `ingest-org-complete`

---

## Recommendations

### Immediate Actions
1. **Process BaT Queue**: Run `complete-bat-import` on 77,022 pending items
2. **Extract BaT Comments**: Run `extract-auction-comments` for existing listings
3. **Investigate Craigslist**: Find or create non-AI, non-Firecrawl extractor
4. **Investigate Classic.com**: Find or create simple HTML extractor

### Short-Term
1. **Audit Unknown Extractors**: Review functions for hidden AI/Firecrawl deps
2. **Create Fallback Extractors**: For blocked sources, create simple DOM-based alternatives
3. **Document Extraction Methods**: Map each source to its extraction approach

### Long-Term
1. **Remove AI Dependencies**: Where possible, use structured data extraction
2. **Remove Firecrawl Dependencies**: Use Playwright or direct HTTP for simple sites
3. **Build Source Registry**: Centralized config for all extraction sources

---

## Notes

- **Observation System**: New architecture is source-agnostic, uses `observation_sources` and `vehicle_observations` tables
- **Migration Status**: Many functions still use old schema (vehicles, auction_events, external_listings)
- **Coordination Brief**: `ralph-wiggum-rlm-extraction-coordinator` provides system status (AI-based but read-only)
- **Hidden Dependencies**: Some functions import from `_shared/` modules that may have AI/Firecrawl deps

---

**Last Updated**: 2026-02-01
**Next Review**: After processing BaT queue
