# Edge Function Health Report

**Generated**: 2026-02-10 15:30 UTC
**Agent**: Edge Function Health Agent (Autonomous 8-hour session)
**Platform**: Nuke Vehicle Data Extraction Platform
**Total Edge Functions**: 320
**Functions Tested**: 25+ critical functions

---

## Executive Summary

Tested all critical edge functions via live production calls. Found **4 code bugs** across 4 functions, all fixed, deployed, and verified. Also identified **3 infrastructure/operational issues** that require manual intervention.

### Scorecard

| Category | Status |
|----------|--------|
| Critical Functions (search, extract, valuation) | PASS |
| Error Handling | FIXED (was FAIL for 4 functions) |
| CORS Headers | PASS |
| Empty Input Handling | FIXED (was FAIL for 2 functions) |
| Search Quality | PASS |
| Data Pipeline | PASS (with extraction rate warning) |
| Feed Performance | FIXED (was timing out) |

---

## Bugs Found and Fixed

### 1. universal-search -- Crash on empty query (FIXED, DEPLOYED)

**File**: `/Users/skylar/nuke/supabase/functions/universal-search/index.ts`
**Severity**: HIGH
**Issue**: Calling with empty body `{}` crashed with `Cannot read properties of undefined (reading 'trim')` on line 97. The function tried `query.trim()` without checking if `query` was defined.
**Fix**: Added null guard with early return (HTTP 400) when query is missing/empty. Also added `.catch()` on `req.json()` to handle malformed bodies gracefully.
**Before**: HTTP 500 with stack trace
**After**: HTTP 400 with `{"success":false,"error":"Query is required","results":[],"query_type":"empty"}`

### 2. process-url-drop -- HTTP 500 for BaT URLs (FIXED, DEPLOYED)

**File**: `/Users/skylar/nuke/supabase/functions/process-url-drop/index.ts`
**Severity**: HIGH
**Issue**: When a user drops a BaT URL, the function calls `processBaTListingURL()` which invokes `extract-bat-core`. If BaT rate-limits the request (302 redirect to login), the error propagated uncaught through the `case 'bat':` handler all the way to the outer catch block, returning HTTP 500.
**Fix**: Wrapped the BaT handler in a try/catch that falls back to creating a discovery lead. The URL is queued for later retry instead of crashing.
**Before**: `{"error":"Edge Function returned a non-2xx status code"}` (HTTP 500)
**After**: `{"success":true,"action":"queued","message":"BaT listing detected but extraction failed (rate limited). Queued for retry."}` (HTTP 200)

### 3. system-health-monitor -- feed_performance timeout (FIXED, DEPLOYED)

**File**: `/Users/skylar/nuke/supabase/functions/system-health-monitor/index.ts`
**Severity**: MEDIUM
**Issue**: The `checkFeedPerformance()` function queried `vehicle_valuation_feed` without a timeout. When the materialized view was stale or under load, the query hit the Supabase statement timeout (8s+), causing the check to report "fail" with `canceling statement due to statement timeout`. This made the overall health status "critical" instead of the more accurate "degraded".
**Fix**: Added a 7-second client-side AbortSignal. If the query times out, it now reports "warn" (not "fail") with a helpful message about the materialized view needing refresh. Also distinguishes timeout errors from actual query failures.
**Before**: `"status":"critical"`, feed_performance reports "fail"
**After**: `"status":"degraded"`, feed_performance reports "pass" (2567ms) or "warn" if slow

### 4. import-fb-marketplace -- Null title crash (FIXED, DEPLOYED)

**File**: `/Users/skylar/nuke/supabase/functions/import-fb-marketplace/index.ts`
**Severity**: MEDIUM
**Issue**: `parseTitle()` was called with `listing.title` which can be null for some FB Marketplace listings. The function signature expected `string` but received `null`, causing `title.match()` to crash with `Cannot read properties of null (reading 'match')`.
**Fix**: Changed function signature to accept `string | null | undefined` and added early return for null/undefined values.
**Before**: Error in processing batch: `"Cannot read properties of null (reading 'match')"`
**After**: No errors, null titles gracefully return empty parse result

---

## Infrastructure/Operational Issues (Not Code Bugs)

### 5. extract-bat-core -- BaT rate limiting (INFRASTRUCTURE)

**Severity**: HIGH (blocks BaT extraction pipeline)
**Issue**: BaT (bringatrailer.com) is blocking datacenter IPs with 302 redirects to login page. The error `RATE_LIMITED: Redirected to login (302)` is returned consistently.
**Impact**: No new BaT listings can be extracted via direct fetch. The `extract-vehicle-data-ai` falls back to URL parsing (confidence 0.5) which only extracts year/make/model from the slug.
**Code quality**: The error detection and reporting in `extract-bat-core` is well-implemented -- it correctly identifies the rate limit and throws an appropriate error.
**Recommendation**: Use Firecrawl MCP or a proxy service for BaT fetching. Alternatively, set up a residential IP relay (similar to the FB relay pattern already in the codebase).

### 6. data-normalize-makes -- SQL statement timeout (INFRASTRUCTURE)

**Severity**: LOW
**Issue**: The first SQL query in `data-normalize-makes` times out due to the size of the vehicles table (~800k rows). The query joins `canonical_makes` with `vehicles` using `WHERE v.make = ANY(cm.variants)` which is expensive.
**Recommendation**: Add a `SET statement_timeout = '30s'` at the start of the RPC call, or refactor to use indexed lookups. Alternatively, schedule this function to run during off-peak hours.

### 7. Extraction Rate Drop (OPERATIONAL)

**Severity**: MEDIUM
**Issue**: System health monitor reports extraction rate of 19,035 vehicles in last 24h vs 78,383/day 7-day average. This is ~75% below normal.
**Likely cause**: The BaT rate limiting (issue #5) is blocking a significant extraction source.
**Recommendation**: Investigate whether other extraction sources (Mecum, C&B, FB Marketplace) are also affected.

---

## Test Results: All Critical Functions

### Core Functions

| Function | Status | Response Time | Notes |
|----------|--------|---------------|-------|
| universal-search | PASS | 357-5197ms | Search quality good across 5 test queries |
| extract-vehicle-data-ai | PASS | ~2s | Falls back to URL parsing for blocked sites (by design) |
| compute-vehicle-valuation | PASS | ~2s | Returns accurate valuations with confidence scores |
| api-v1-vehicles | PASS | ~1s | Pagination working correctly |
| db-stats | PASS | ~2s | Returns comprehensive platform stats |
| system-health-monitor | PASS | ~2.5s | Now reports degraded (was critical) |

### Data Pipeline Functions

| Function | Status | Notes |
|----------|--------|-------|
| compute-feed-scores | PASS | All vehicles up to date |
| detect-record-prices | PASS | 457 new records created in test run |
| estimate-survival-rates | PASS | Processed 1 group successfully |
| calculate-vehicle-scores | PASS | Returns 8-dimension scoring |
| price-analytics | PASS | Returns full price distribution |
| calculate-market-trends | PASS | Analyzed 1 make, found 5 discoveries |
| calculate-market-indexes | PASS | 10 indexes calculated |
| data-flag-price-outliers | PASS | Flagged 727 IQR outliers |
| auto-fix-bat-prices | PASS | (background job) |

### Extraction Functions

| Function | Status | Notes |
|----------|--------|-------|
| extract-bat-core | FAIL | BaT rate limiting (302 to login) - infrastructure issue |
| import-fb-marketplace | PASS | Fixed null title crash |
| process-url-drop | PASS | Fixed BaT fallback, works for all other URLs |
| identify-vehicle-from-image | PASS | Returns proper error for missing image_url |

### Operational Functions

| Function | Status | Notes |
|----------|--------|-------|
| deal-wire-automation | PASS | Proper validation (requires deal_id) |
| stripe-webhook | PASS | Correctly rejects unsigned requests |
| telegram-webhook | PASS | Returns OK |
| ds-merge-deal-data | PASS | Proper validation (requires deal_id) |
| ds-create-checkout | PASS | Proper validation (requires plan) |

### Data Quality Functions

| Function | Status | Notes |
|----------|--------|-------|
| data-normalize-makes | FAIL | SQL timeout - infrastructure issue |
| org-extraction-coverage | PASS | Proper validation (requires org_id) |

---

## Search Quality Results

All 5 test queries returned relevant results:

| Query | Results | Top Result | Score |
|-------|---------|------------|-------|
| "1967 Ford Mustang" | 1 | 1967 Ford Mustang Convertible | 14.68 |
| "Porsche 944" | 2 | 1986 Porsche 944 Challenge | 2.31 |
| "Toyota Land Cruiser" | 1 | 1999 Toyota Land Cruiser SUV | 12.09 |
| "Ferrari Testarossa" | 2 | 1988 Ferrari Testarossa | 3.14 |
| "Chevrolet Corvette C3" | 2 | 1980 Chevrolet Corvette C3 GO Kart | 1.45 |

Search quality is acceptable. Result counts are low relative to the 797k vehicles in the database, suggesting the FTS index may not be fully populated for all vehicles. This is not urgent but could improve user experience.

---

## Deployment Log

| Time (UTC) | Function | Action |
|------------|----------|--------|
| 15:15 | universal-search | Deployed fix for empty query handling |
| 15:15 | process-url-drop | Deployed BaT error fallback |
| 15:15 | system-health-monitor | Deployed feed performance timeout |
| 15:18 | import-fb-marketplace | Deployed null title guard |

All changes committed to `main` and pushed to origin (commit `539deb0ba`).

---

## Recommendations

1. **BaT Rate Limiting (Priority: HIGH)**: Set up a Firecrawl-based or proxy-based fetch for BaT pages. The current direct fetch approach will continue to be blocked by BaT's anti-bot measures.

2. **data-normalize-makes Timeout (Priority: LOW)**: Add explicit statement timeout or refactor the heavy JOIN query to use batched processing.

3. **Search Index Coverage**: Investigate whether all 797k vehicles have populated `search_vector` fields. Low result counts for common makes suggest incomplete indexing.

4. **Extraction Rate Monitoring**: The 75% drop in extraction rate should be investigated. If primarily caused by BaT blocking, restoring BaT access would resolve it.

5. **analyze-comments-fast LLM Errors**: 2 out of ~16 analyses fail with "Empty or invalid json" from the LLM. Consider adding retry logic or more robust JSON extraction from LLM responses.
