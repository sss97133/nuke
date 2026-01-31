# Search Page QA Report

**Date**: 2026-01-31
**Test URL**: https://n-zero.dev/search?q=mecum

## Executive Summary

After fixes applied on 2026-01-31:

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Tests Passed | 8/10 | **10/10** | ✅ |
| P50 Latency | 1,096ms | **935ms** | ✅ Improved |
| P95 Latency | 16,629ms | 16,559ms | ⚠️ Still slow |
| Porsche 911 accuracy | ❌ FAIL | **✅ PASS** | ✅ Fixed |

## Fixes Applied

### 1. Relevance Bug Fixed (supabase/functions/search/index.ts)
- Changed `MAKE_EXPANSIONS` to `MAKE_MODELS` mapping
- Added `queryHasModelForMake()` to detect when user specifies a model
- Now "porsche 911" only returns 911s, not Boxsters/Panameras

### 2. Scoring Algorithm Improved
- Old: `hits / terms.length` (50% for 1/2 match)
- New: `(hits / terms.length) * pow(0.5, misses)` (25% for 1/2 match)
- Results that miss query terms are now heavily penalized

### 3. Fuzzy Search Timeout Fix (pending migration)
- Created `20260131_fix_fuzzy_search_timeout.sql`
- Adds 3s statement timeout to fuzzy RPCs
- Removes slow `description` column from fuzzy matching
- **Status**: Migration needs to be applied to fix P95 latency

## Remaining Issues

## Critical Issues

### 1. Relevance Bug: Model-Specific Searches Return Wrong Results

**Query**: "porsche 911"
**Expected**: Only Porsche 911 variants
**Actual**: Returns Boxster, Panamera, Cayenne in top 5

**Root Cause** (`supabase/functions/search/index.ts:96-117`):
```typescript
const MAKE_EXPANSIONS: Record<string, string[]> = {
  porsche: [
    "911", "carrera", "gt3", ...
    "boxster", "panamera", "cayenne", // ← These pollute results
  ],
};
```

When user searches "porsche 911", the code expands "porsche" to include ALL Porsche models, then matches any of them.

**Fix**: Only expand make when no specific model is in the query.

### 2. Performance Crisis: Fuzzy Fallback Timeouts

**Symptom**: Some searches take 16+ seconds
**Root Cause**: `search_vehicles_fuzzy` RPC times out

The fuzzy search on `description` column triggers full table scans despite GIN indexes because:
- The `%` (trigram similarity) operator on long text columns is expensive
- The `similarity()` function in ORDER BY prevents index-only scans

**Evidence**:
```bash
curl -X POST ".../rpc/search_vehicles_fuzzy" -d '{"query_text": "test", "limit_count": 5}'
# Returns: {"message":"canceling statement due to statement timeout"}
```

**Fix**: Limit fuzzy search to short columns only (make, model, vin) or add statement timeout.

### 3. Scoring Doesn't Penalize Missing Terms

**Current** (`search/index.ts:130-140`):
```typescript
function scoreText(terms: string[], hay: string): number {
  let hits = 0;
  for (const t of terms) {
    if (h.includes(t)) hits += 1;
  }
  return hits / terms.length; // 1/2 terms = 0.5 score
}
```

Search "porsche 911" gives **0.5 score** to "Porsche Boxster" (matches 1/2 terms).
This should score near 0 since "911" is missing.

**Fix**: Use multiplicative scoring or require all terms for high scores.

### 4. Duplicate Mecum Org Entries

Two "Mecum Auctions" entries in `businesses` table:
- `3c49872f-5f46-4064-ba16-b236fbb02ed4` (no location)
- `d2f587a0-5993-4d2c-9032-0fb3dd94d995` (Walworth, WI)

**Fix**: Deduplicate and merge.

## Test Results

| Test Case | Query | Result | Issue |
|-----------|-------|--------|-------|
| C10 | c10 | ✅ 60 results | - |
| Porsche 911 | porsche 911 | ❌ | Boxster in top 5 |
| 1967 Mustang | 1967 mustang | ✅ 26 results | - |
| Mecum Org | mecum | ✅ 6 results | 16s latency |
| Chevrolet | chevrolet | ✅ 67 results | - |
| BMW | bmw | ✅ 69 results | - |
| Empty | "" | ✅ 0 results | - |
| Special chars | c10 && drop | ✅ handled | - |
| VIN | 1G1YY22G... | ✅ 0 results | 16s latency |
| User search | admin | ❌ | Returns orgs instead |

## Data Coverage Assessment

| Source | Vehicles | Status |
|--------|----------|--------|
| User Submissions | 769 | ✅ Primary |
| Dealer Websites | 219 | ✅ Good |
| Craigslist | 5 | ⚠️ Light |
| BaT | 0 | ❌ Missing |
| Mecum | 0 | ❌ Missing |
| Cars & Bids | 0 | ❌ Missing |

## Recommended Fixes

### P0 - Critical (Fix Now)

1. **Fix fuzzy search timeout**
   - Add `SET statement_timeout = '2s'` to fuzzy RPCs
   - Remove `description` from fuzzy matching

2. **Fix Porsche 911 relevance**
   - Don't expand make when model is specified
   - Use AND logic for multi-term queries

### P1 - Important (This Week)

3. **Improve scoring algorithm**
   - Require all query terms for score > 0.7
   - Exact phrase matches get score boost

4. **Deduplicate orgs**
   - Merge duplicate Mecum Auctions entries

### P2 - Nice to Have

5. **Add missing data sources**
   - Mecum auction results
   - BaT auction results
   - Cars & Bids results

## Test Suite Location

Automated test suite: `scripts/search-qa-tests.ts`

Run with:
```bash
dotenvx run -- npx tsx scripts/search-qa-tests.ts
```
