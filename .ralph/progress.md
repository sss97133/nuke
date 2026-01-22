# Ralph Wiggum Progress Log

## Session: 2026-01-22

---

### Loop 0 - Setup (Human)
- Created PROMPT.md with full context
- Created fix_plan.md with 75 tasks across 7 phases
- Ready for autonomous operation

---

### Loop 1 - Extraction Accuracy Baseline
**Task**: 1.1 - Run extraction accuracy query, save results to progress.md

**Results** (2026-01-22):
```
 auction_source  | total | pct_year | pct_make | pct_vin | pct_mileage | pct_price
-----------------+-------+----------+----------+---------+-------------+-----------
 Craigslist      |  6125 |    100.0 |    100.0 |    21.3 |        10.6 |      64.0
 Unknown Source  |  3888 |     79.4 |    100.0 |     9.9 |        23.3 |      24.5
 Bring a Trailer |  2685 |     99.9 |    100.0 |    96.9 |        96.8 |      98.8
 Mecum           |   387 |    100.0 |    100.0 |    38.5 |        77.3 |      21.4
 Cars & Bids     |   368 |    100.0 |    100.0 |    51.1 |        49.5 |      29.9
 User Submission |   235 |    100.0 |    100.0 |    27.2 |         6.4 |      11.9
                 |   116 |    100.0 |    100.0 |    86.2 |        97.4 |       0.0
 bat             |    68 |    100.0 |    100.0 |    98.5 |        98.5 |     100.0
 Collecting Cars |    61 |     96.7 |    100.0 |     0.0 |         0.0 |     100.0
 SBX Cars        |    32 |    100.0 |    100.0 |     0.0 |         0.0 |      59.4
 PCarMarket      |    30 |     63.3 |    100.0 |     0.0 |         0.0 |       0.0
 Broad Arrow     |    21 |    100.0 |    100.0 |     0.0 |         0.0 |      47.6
 RM Sothebys     |    20 |    100.0 |    100.0 |     0.0 |         0.0 |       0.0
 Design Auto     |     9 |    100.0 |    100.0 |     0.0 |       100.0 |       0.0
 Gooding         |     7 |    100.0 |    100.0 |     0.0 |         0.0 |       0.0
```

**Key Findings**:
1. **Bring a Trailer** is the gold standard - 96.9% VIN, 96.8% mileage, 98.8% price
2. **Craigslist** (6,125 vehicles) has critical gaps:
   - VIN: only 21.3% (expected - Craigslist rarely has VIN)
   - Mileage: only 10.6% (extractable - should be higher)
   - Price: 64.0% (decent)
3. **Unknown Source** (3,888 vehicles) needs classification - nearly 30% of database
4. **Cars & Bids** (368 vehicles) underperforming:
   - VIN: 51.1% (should be higher - available in __NEXT_DATA__)
   - Mileage: 49.5% (should be higher)
   - Price: 29.9% (low - likely lazy-loading issue)
5. **Mecum** (387 vehicles) has VIN gap at 38.5%, mileage at 77.3% but price only 21.4%
6. Note: 68 vehicles with "bat" source vs 2,685 with "Bring a Trailer" - inconsistent naming

**Priority Gaps to Fix**:
1. C&B VIN/mileage/price extraction (~50% each)
2. Craigslist mileage extraction (10.6%)
3. Mecum VIN extraction (38.5%)
4. Unknown Source classification (3,888 vehicles)

---

### Loop 2 - Source Classification Fix (HIGH IMPACT)
**Task**: D.1-D.9 - Fix Unknown Source classification

**Discovery**: The `20260122_normalize_auction_source.sql` migration existed but was NEVER APPLIED.
- Trigger `trigger_auto_set_auction_source` didn't exist in DB
- Migration only covered ~15 sources, but 67+ unique domains exist

**Actions Taken**:
1. Applied the base migration (created trigger, basic patterns)
2. Extended with 14 additional high-volume source patterns
3. Updated trigger function with 28 total source patterns

**Results**:
```
BEFORE: Unknown Source = 3,888 vehicles
AFTER:  Unknown Source = 196 vehicles (95% reduction!)
```

**New Source Distribution** (Top 15):
```
Craigslist             |  6,125
Bring a Trailer        |  2,752
Beverly Hills Car Club |  2,011  (NEW - was Unknown)
L'Art de l'Automobile  |    995  (NEW - was Unknown)
Cars & Bids            |    491
Mecum                  |    387
User Submission        |    235
Collective Auto        |    220  (NEW - was Unknown)
Unknown Source         |    196  (from 3,888!)
Collecting Cars        |     72
Broad Arrow            |     70
Barrett-Jackson        |     51  (NEW - was Unknown)
Classic.com            |     51  (NEW - was Unknown)
```

**Total**: 28 distinct sources now properly classified

**Files Modified**:
- `supabase/migrations/20260122_normalize_auction_source.sql` - applied to DB
- Trigger function `auto_set_auction_source()` - extended with 28 patterns

---

### Loop 3 - Data-Driven Source Classification (ARCHITECTURAL FIX)
**Task**: Fix source classification at ingestion, not after the fact

**Problem Identified**:
- `scrape_sources` has 389 entries, but `listing_url_pattern` was NULL for ALL of them
- No way to automatically match vehicle URLs to sources
- Classification was hardcoded in trigger instead of data-driven

**Solution Implemented**:

1. **Populated `listing_url_pattern`** on all 389 scrape_sources
   - Auto-extracted domain patterns from `url` field
   - Now every source has a regex pattern for matching

2. **Created `lookup_source_from_url(url)`** function
   - Matches URL against `scrape_sources.listing_url_pattern`
   - Prioritizes by source_type (auction > marketplace > dealer)
   - Returns source_id and name

3. **Created `get_auction_source_from_url(url)`** function
   - Wrapper that returns canonical source name
   - Handles URL-like names in scrape_sources
   - Falls back to domain-based canonical mapping

4. **Updated vehicle trigger** to use data-driven lookup
   - `auto_set_auction_source()` now calls `get_auction_source_from_url()`
   - No more hardcoded patterns in trigger

5. **Created `import_queue` trigger**
   - `auto_set_import_queue_source()` sets `source_id` on ingestion
   - New URLs automatically linked to correct source

**Result**:
- New URLs now auto-classified at ingestion
- Source classification is data-driven via `scrape_sources` table
- Adding new source = add row to `scrape_sources` with URL pattern
- No code changes needed to support new sources

**Remaining Work**:
- 8,791 existing import_queue items need source_id backfilled
- Some `scrape_sources.name` values are garbage (URLs) - need cleanup

---

### Loop 4 - Aggregator Hierarchy Fix
**Task**: Properly model aggregators like Classic.com as "source of sources"

**Problem**:
- Classic.com had 103 entries all named "Classic.com"
- Each was actually a different dealer ON Classic.com
- `parent_aggregator` field existed but was unused

**Solution**:
1. Created master Classic.com marketplace entry
2. Extracted dealer names from URLs (e.g., `/s/atomic-motors-hash/` → "Atomic Motors")
3. Set `parent_aggregator = 'Classic.com'` for all 97 dealers

**New Hierarchy**:
```
AGGREGATORS (marketplaces hosting dealers)
├── Classic.com → 97 dealers
├── Hemmings → 1 dealer

DIRECT SOURCES
├── Auctions (15): BaT, C&B, Mecum...
├── Marketplaces (17): Classic.com, Hemmings...
├── Dealers (246): Beverly Hills Car Club...
└── Classifieds (3): Craigslist, KSL Cars...
```

---

## SESSION SUMMARY - 2026-01-22

### What We Fixed

| Area | Before | After |
|------|--------|-------|
| Unknown Source vehicles | 3,888 | 196 (95% ↓) |
| scrape_sources.listing_url_pattern | 0% populated | 100% populated |
| import_queue.source_id | 8,791 missing | 0 missing |
| Aggregator hierarchy | Not modeled | parent_aggregator in use |
| Auto-classification triggers | None | 2 installed |

### Architecture Now In Place

```
URL ingested
    ↓
import_queue trigger matches against scrape_sources.listing_url_pattern
    ↓
source_id FK set automatically
    ↓
Vehicle created
    ↓
auction_source set via get_auction_source_from_url()
    ↓
Aggregator relationship tracked via parent_aggregator
```

### Remaining Work

1. **Dedupe scrape_sources** - Can't delete due to FK constraints, need migration strategy
2. **Clean up garbage names** - Some entries still have URL-like names
3. **Normalize BaT entries** - Multiple entries for same auction site
4. **Extraction accuracy** - VIN, mileage, images still need improvement

---

### Loop 5 - SBX Cars Extraction Gap Analysis
**Task**: 2.1-2.3 - Diagnose extraction gaps by reading extractor code

**Extractor Analyzed**: `/supabase/functions/scrape-sbxcars/index.ts` (1,267 lines)

**CRITICAL FINDING**: SBX Cars extractor is **completely missing VIN and mileage extraction**.

The `SBXCarsListing` interface (line 13-52) has these fields:
- ✅ url, title, year, make, model
- ✅ price, current_bid, reserve_price
- ✅ images[], description, highlights[]
- ✅ lot_number, location, seller info
- ✅ bidder_usernames[] (live auction data!)
- ❌ **VIN - NOT PRESENT**
- ❌ **mileage - NOT PRESENT**

**HTML Evidence from User's Sample** (SBX Cars Ferrari F430):
```
VIN: ZFFEW59A960147070
Mileage: 26,266 Miles
Current bid: $75,000 (12 bids)
Bid history with usernames: vollgaser5, jgr_pdk, SportsCarAffair, etc.
Images: 99 photos
```

**Comparison with Other Extractors**:
| Extractor | VIN | Mileage | Bid History |
|-----------|-----|---------|-------------|
| BaT Core | ✅ Line 296, 542-564 | ✅ Line 297, 543 | ✅ |
| C&B Core | ✅ Line 56, 243-253 | ✅ Line 57, 125-131 | ✅ |
| SBX Cars | ❌ **MISSING** | ❌ **MISSING** | ✅ (has bidder_usernames) |

**Extraction Accuracy Impact** (from Loop 1 baseline):
```
SBX Cars: 32 vehicles
- VIN:     0.0%  ← Extractor doesn't try to extract it
- Mileage: 0.0%  ← Extractor doesn't try to extract it
- Price:  59.4%  ← Works but incomplete
```

**Root Cause**: The SBX Cars extractor was built to capture auction/bid data but VIN and mileage fields were never added to the interface or extraction logic.

**Fix Required**:
1. Add `vin: string | null` to SBXCarsListing interface
2. Add `mileage: number | null` to SBXCarsListing interface
3. Add VIN extraction patterns (similar to BaT/C&B):
   ```typescript
   const vinPatterns = [
     /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
     /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
   ];
   ```
4. Add mileage extraction:
   ```typescript
   const mileageMatch = text.match(/~?([\d,]+)\s*(?:Miles|mi)/i);
   ```
5. Deploy updated function: `supabase functions deploy scrape-sbxcars`

---

### Loop 6 - SBX Cars VIN/Mileage Fix
**Task**: 3.0a-d - Add VIN and mileage extraction to SBX Cars extractor

**Changes Made** to `/supabase/functions/scrape-sbxcars/index.ts`:

1. **Added fields to interface** (lines 19-20):
```typescript
vin: string | null // VIN/chassis number (17 chars)
mileage: number | null // Odometer reading
```

2. **Added VIN extraction** (lines 517-533):
```typescript
const vinPatterns = [
  /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
  /Chassis[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
  /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
  /"vin"[:\s]*["']([A-HJ-NPR-Z0-9]{17})["']/i,
  /Serial[:\s#]*([A-HJ-NPR-Z0-9]{17})/i,
]
```

3. **Added mileage extraction** (lines 535-548):
```typescript
const mileagePatterns = [
  /~?([\d,]+)\s*(?:Miles|mi)\b/i,
  /Mileage[:\s]*([\d,]+)/i,
  /Odometer[:\s]*([\d,]+)/i,
  /"mileage"[:\s]*([\d,]+)/i,
]
```

4. **Added to listing object** (lines 566-567):
```typescript
vin,
mileage,
```

**Expected Impact**:
- SBX Cars VIN: 0% → should improve significantly
- SBX Cars mileage: 0% → should improve significantly

**Next Step**: Deploy and test with `supabase functions deploy scrape-sbxcars`

---

### Loop 7 - [PENDING]
*Next loop will start here*

---
