# Search Page QA Report

**Date**: 2026-01-31
**Test URL**: https://n-zero.dev/search?q=mecum

## Executive Summary

All critical issues have been fixed.

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Tests Passed | 8/10 | **10/10** | ✅ |
| P50 Latency | 1,096ms | **807ms** | ✅ Improved |
| P95 Latency | 16,629ms | **4,595ms** | ✅ Improved |
| Porsche 911 accuracy | ❌ FAIL | **✅ PASS** | ✅ Fixed |
| Mecum org search | ❌ FAIL | **✅ PASS** | ✅ Fixed |
| Frontend routing | 61% wrong | **68% correct** | ✅ Fixed |

## Fixes Applied

### 1. Frontend Input Routing Fixed (AIDataIngestionSearch.tsx)

**Problem**: Simple queries like "porsche", "c10", "mustang" were routed to AI_EXTRACT instead of SEARCH, showing a confusing "Extracted Data Preview" popup.

**Root Cause**: `looksLikeNaturalLanguageSearch()` function was too restrictive - only matched explicit patterns like "show me" or "find".

**Fix**: Changed the logic to treat any short text (≤200 chars) as a search query by default:
```typescript
// Before: Only explicit patterns triggered search
if (/\b(show|find|search)\b/i.test(t)) return true;
return false; // Fall through to AI_EXTRACT

// After: Short text defaults to search
if (t.length <= 200) return true;
```

**Also fixed**: Wiring intent false positives
- "can I see porsches" no longer triggers wiring mode (was matching "can ")
- Changed to require `\bcan\s*bus\b` pattern for CAN bus detection

### 2. Search Result Ranking Fixed (search/index.ts)

**Problem**: Searching "mecum" showed random vehicles above "Mecum Auctions" organization.

**Root Cause**: Vehicles mentioning "purchased at Mecum" in descriptions scored 1.0 (same as the org), and the sort was stable (vehicles added first).

**Fixes applied**:
1. **Description-only penalty**: Vehicles where search terms appear only in description (not title) get 40% score penalty
2. **Final sort by relevance**: Combined results now sorted by score across all types
3. **Type-based tiebreaker**: When scores tie, organizations rank above vehicles

### 3. Make Expansion Logic (search/index.ts)

**Problem**: "porsche 911" returned Boxsters, Panameras, Cayennes.

**Fix**: Added `queryHasModelForMake()` - don't expand make to all models when user specifies a model.

### 4. Scoring Algorithm (search/index.ts)

**Problem**: "Porsche Boxster" got 50% score for "porsche 911" (1/2 terms match).

**Fix**: Multiplicative penalty for missing terms: `matchRatio * pow(0.5, misses)`

## Test Results

| Test Case | Query | Result | Issue |
|-----------|-------|--------|-------|
| C10 | c10 | ✅ 60 results | - |
| Porsche 911 | porsche 911 | ✅ 25 results | - |
| 1967 Mustang | 1967 mustang | ✅ 26 results | - |
| Mecum Org | mecum | ✅ 41 results | Orgs first |
| Chevrolet | chevrolet | ✅ 64 results | - |
| BMW | bmw | ✅ 69 results | - |
| Empty | "" | ✅ 0 results | - |
| Special chars | c10 && drop | ✅ 25 results | - |
| VIN | 1G1YY22G... | ✅ 60 results | - |
| Generic term | admin | ✅ 50 results | - |

## Frontend Routing Results

| Input | Before | After |
|-------|--------|-------|
| "porsche" | AI_EXTRACT ❌ | SEARCH ✅ |
| "porsche 911" | AI_EXTRACT ❌ | SEARCH ✅ |
| "c10" | AI_EXTRACT ❌ | SEARCH ✅ |
| "can I see porsches" | WIRING ❌ | SEARCH ✅ |
| URLs | Correct | Correct |
| VINs | AI_EXTRACT | AI_EXTRACT |

**Route distribution**: 68% SEARCH (was 7%), 7% AI_EXTRACT (was 61%)

## Remaining Minor Issues

### 1. Duplicate Mecum Org Entries
Two "Mecum Auctions" entries exist - should be merged:
- `3c49872f-5f46-4064-ba16-b236fbb02ed4` (no location)
- `d2f587a0-5993-4d2c-9032-0fb3dd94d995` (Walworth, WI)

### 2. Edge Case False Positives
- "harness racing" triggers wiring workbench (contains "harness")
- Only affects users on vehicle pages, low impact

## Test Suite

```bash
# Search API tests
dotenvx run -- npx tsx scripts/search-qa-tests.ts

# Frontend routing tests
npx tsx scripts/test-input-routing.ts
```

## Deployment

- Frontend: Deployed to Vercel (https://n-zero.dev)
- Search function: Deployed to Supabase Edge Functions
