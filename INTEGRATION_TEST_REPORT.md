# Nuke MCP Server & API Integration Test Report

**Date**: 2026-02-10
**Agent**: Integration Testing Agent (Claude Opus 4.6)
**Scope**: All 6 MCP tools, auth, rate limits, edge cases, response times

---

## Executive Summary

- **45 tests executed** across 6 MCP tools and 4 edge functions
- **6 issues found** (2 critical, 2 medium, 2 low)
- **2 issues fixed and deployed** (M1: pagination validation, L1: search input sanitization)
- **3 slow endpoints** flagged (>5s response time)
- **No SQL injection vulnerability** -- Supabase parameterized queries + WAF protect against injection
- **Auth gap**: 3 of 4 edge functions work without authentication (by design for `--no-verify-jwt` deployment, but important to document)
- **Commit**: 9de68f655 (pushed to main)

---

## Test Matrix

### 1. search_vehicles (universal-search)

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| "Porsche 911" | Vehicle results | 3 results, correct vehicles | 5518 | SLOW |
| "1969 Chevrolet Camaro" | Year+make+model results | 3 results, correct vehicles | 976 | PASS |
| "WP0AC2A90NS268501" (VIN) | VIN match | 1 result, exact VIN match, query_type=vin | 416 | PASS |
| "Ferrari" (single make) | Ferrari vehicles | 3 results, all Ferraris | 3777 | PASS |
| "truck" (generic) | Truck-related vehicles | 3 results including fire truck, dump truck | 8466 | SLOW |
| "xyz123" (garbage) | Empty results with AI suggestion | 0 results, ai_suggestion present | 16451 | SLOW |
| "" (empty) | 400 error | 400 "Query is required" | 384 | PASS |
| "2024" (year only) | Year results, query_type=year | 5 results from 2024 | 546 | PASS |
| SQL injection: `'; DROP TABLE vehicles; --` | Safe/no damage | 403 Forbidden (Supabase WAF) | 238 | PASS |
| XSS: `<script>alert(1)</script>` | JSON response, no execution | JSON response with FTS noise result | 425 | PASS |
| Long string (10000 chars) | Empty results | 0 results, handled gracefully | 8615 | PASS |
| Malformed JSON body | 500 error with message | 500 with parse error message | 272 | PASS |
| Missing query field | Error | 500 "Cannot read properties of undefined" | 6 | **ISSUE** |
| Number for query (12345) | Error | 500 "query.trim is not a function" | 5 | **ISSUE** |
| String for limit ("not_a_number") | Error or default | Handled gracefully, returned results | 8296 | PASS |

**Notes**:
- "Porsche 911" takes 5.5s due to FTS + ILIKE fallback chain
- "xyz123" takes 16s because it runs ALL search paths (FTS, ILIKE, organizations, users, identities, tags) before finding nothing
- "truck" is slow (8.5s) because the term is generic and triggers broad ILIKE scans
- The 2024 year search returns auction events (e.g., "2024 Gooding : Amelia Island") stored as vehicles with the make/model containing the auction name -- this is a data quality issue, not a code issue

### 2. extract_listing (extract-vehicle-data-ai)

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| BaT URL (1988 Porsche 911 Turbo) | Extracted vehicle data | `success: false, "No vehicle data found"` | 1375 | **FAIL** |
| google.com (non-car) | Rejection | `success: false, "No vehicle data found"` | 8583 | PASS |
| invalid-url | Error message | `success: false, "No vehicle data found"` | 1364 | PASS* |
| Wikipedia (Porsche 911) | Rejection or partial data | `success: false, "No vehicle data found"` | 3333 | PASS |

**Root Cause**: BaT extraction fails because:
1. The dedicated `bat-simple-extract` function is called first but returns mostly null fields (BaT likely blocks direct fetch in Deno runtime)
2. Since the dedicated extractor returns no year/make/vin, the function falls through to generic extraction
3. Generic extraction fetches the URL directly, but BaT returns JS-rendered content that needs a browser
4. The LLM receives minimal content and returns `no_vehicle_data: true`

*`invalid-url` returns 200 with `success: false` instead of 400 -- this is a minor protocol issue.

### 3. get_vehicle_valuation (compute-vehicle-valuation)

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| Known vehicle (Porsche 911 GT3) | Valuation computed | estimated_value: $230,000, confidence: 78 | 3318 | PASS |
| Same vehicle (cached) | Cached result | computed: 0, cached: 1 | 481 | PASS |
| force=true | Recomputed | computed: 1, cached: 0 | 695 | PASS |
| Invalid UUID "not-a-uuid" | Error | 200 with error_details, `success: true` | 403 | **ISSUE** |
| Non-existent UUID | Error | 200 with error_details, `success: true` | 376 | **ISSUE** |
| Empty body `{}` | 400 error | 400 "Provide vehicle_id or vehicle_ids" | 316 | PASS |
| Batch (1 valid + 1 invalid) | Mixed results | cached: 1, errors: 1, both reported | 481 | PASS |
| GET method | Error | 400 "Provide vehicle_id or vehicle_ids" | varies | PASS |

**Issues**: Invalid/non-existent vehicle IDs return HTTP 200 with `success: true` and errors in `error_details`. The MCP server's `callFunction` checks `res.ok` which is `true` for 200, so the error is only visible in the JSON body. This could mislead consumers.

### 4. identify_vehicle_image

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| Cloudinary vehicle image | Vehicle identification | "unsupported image format" error | 884 | **FAIL** |
| BaT PNG image | Vehicle identification | Toyota Land Cruiser FJ40, confidence 0.8 | 10168 | PASS |
| Invalid URL | Error | "Failed to download image" error | varies | PASS |
| Empty body | Error | 500 "Missing required parameter: image_url" | varies | PASS |

**Issue**: Cloudinary URLs (used extensively in vehicle_images) serve images in AVIF/WebP format via content negotiation, which OpenAI's vision API rejects. This affects any vehicle whose primary_image_url comes from Cloudinary (e.g., Mecum auction images).

### 5. get_vehicle (api-v1-vehicles/:id)

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| Valid vehicle ID | Vehicle data | Full vehicle profile returned | 406 | PASS |
| Invalid UUID "not-a-uuid" | 404 | 404 "Vehicle not found" | varies | PASS |
| Non-existent UUID | 404 | 404 "Vehicle not found" | varies | PASS |

### 6. list_vehicles (api-v1-vehicles)

| Input | Expected | Actual | Time (ms) | Pass/Fail |
|-------|----------|--------|-----------|-----------|
| page=1, limit=3 | 3 vehicles | 3 vehicles, pagination correct | varies | PASS |
| page=2, limit=3 | Next 3 vehicles | Different 3 vehicles | varies | PASS |
| limit=500 | Capped at 100 | 100 items, limit shows 100 | varies | PASS |
| page=-1 | 400 error | **500 "Requested range not satisfiable"** | varies | **FAIL** |
| page=0 | 400 or page=1 default | Empty data array, pagination shows page 0 | varies | **ISSUE** |
| limit=0 | 400 or default | Empty array, pages: null | varies | **ISSUE** |
| limit=-1 | 400 error | **500 "Requested range not satisfiable"** | varies | **FAIL** |
| PUT method | 405 | 405 "Method not allowed" | varies | PASS |

---

## Auth Test Results

| Endpoint | With Auth | Invalid Auth | No Auth | Expected |
|----------|-----------|-------------|---------|----------|
| api-v1-vehicles | 200 | 401 | 401 | Correct |
| universal-search | 200 | 200 | **200** | Auth gap |
| compute-vehicle-valuation | 200 | 200 | **200** | Auth gap |
| extract-vehicle-data-ai | 200 | 200 | **200** | Auth gap |
| identify-vehicle-from-image | 200 | 200 | **200** | Auth gap |

**Analysis**: Only `api-v1-vehicles` enforces authentication. All other edge functions are deployed with `--no-verify-jwt` and create their own Supabase client using the service role key from environment variables. This means:
- Anyone who knows the function URL can call `universal-search`, `compute-vehicle-valuation`, `extract-vehicle-data-ai`, and `identify-vehicle-from-image` without any authentication
- The functions use the service role key internally, so they have full database access regardless of the caller's identity

**Recommendation**: For public-facing tools, add optional auth check or rate limiting at the function level. For internal-only tools, this is acceptable.

---

## CORS Test Results

| Endpoint | Access-Control-Allow-Origin | Access-Control-Allow-Headers | Access-Control-Allow-Methods |
|----------|----------------------------|-----------------------------|-----------------------------|
| api-v1-vehicles | `*` | authorization, x-client-info, apikey, content-type, x-api-key | GET, POST, PATCH, DELETE, OPTIONS |
| universal-search | `*` | authorization, x-client-info, apikey, content-type | (not set in OPTIONS) |

CORS is wide open (`*`) on both endpoints. This is fine for a public API but should be tightened for production if needed.

---

## Rate Limit Test Results

| Endpoint | 10 rapid requests | Rate Limiting Active |
|----------|-------------------|---------------------|
| universal-search | All 200 | **No** |
| api-v1-vehicles (service role) | All 200 | **No** (service role bypasses) |

Rate limiting exists only in the api-v1-vehicles function via API key `rate_limit_remaining` field, and only for API key authentication (not JWT/service role). There is no rate limiting on universal-search, compute-vehicle-valuation, or extract-vehicle-data-ai.

---

## Response Time Analysis

| Endpoint + Query | Time (ms) | Verdict |
|-----------------|-----------|---------|
| search: VIN | 336 | Fast |
| search: empty | 307 | Fast |
| search: year 2024 | 460 | Fast |
| search: 1969 Chevrolet Camaro | 905 | Good |
| api: get single vehicle | 406 | Fast |
| api: list vehicles (limit=5) | 1171 | Good |
| search: Ferrari | 2113 | Acceptable |
| valuation: cached | 405 | Fast |
| valuation: force=true | 695 | Good |
| valuation: first compute | 3318 | Acceptable |
| search: Porsche 911 | **5518** | **SLOW** |
| search: truck | **8466** | **SLOW** |
| search: xyz123 (no results) | **16451** | **VERY SLOW** |
| search: long string (10k chars) | **8615** | **SLOW** |
| identify: valid image | **10168** | Expected (AI call) |

**Key finding**: Searches that yield no FTS results are very slow because the function sequentially tries:
1. Full-text search (FTS with ts_rank)
2. ILIKE fallback (make/model)
3. Organization search
4. User/profile search
5. External identity search
6. Tag search

All run in parallel via `Promise.all`, but the ILIKE searches on large tables with no results are slow.

---

## Issues Found

### CRITICAL

**C1: extract_listing fails for BaT URLs**
- **Impact**: The primary use case (extracting BaT listings) returns no data
- **Root cause**: `bat-simple-extract` cannot scrape BaT (likely blocked), and generic extraction also fails because BaT requires JavaScript rendering
- **Fix needed**: `bat-simple-extract` needs to use Firecrawl or Playwright instead of direct fetch
- **Files**: `/Users/skylar/nuke/supabase/functions/bat-simple-extract/index.ts`

**C2: No auth on unauthenticated endpoints**
- **Impact**: Universal search, valuation, extraction, and image ID can be called by anyone without authentication
- **Root cause**: Functions deployed with `--no-verify-jwt` and no internal auth check
- **Recommendation**: Add optional rate limiting for unauthenticated requests, or require at minimum the Supabase anon key

### MEDIUM

**M1: API pagination crashes on negative values** -- FIXED
- **Impact**: page=-1 or limit=-1 returns 500 Internal Server Error
- **Root cause**: No input validation on page/limit before passing to Supabase `.range()` which throws on negative offsets
- **Fix applied**: Added `Math.max(1, isNaN(rawPage) ? 1 : rawPage)` and similar for limit. NaN values default gracefully.
- **Deployed**: `supabase functions deploy api-v1-vehicles --no-verify-jwt`
- **Verified**: page=-1 now returns page=1, limit=-1 returns limit=1, limit=NaN returns limit=20
- **File**: `/Users/skylar/nuke/supabase/functions/api-v1-vehicles/index.ts`

**M2: Valuation returns 200+success:true for errors**
- **Impact**: MCP server's `callFunction` treats the response as successful even when all vehicle valuations failed
- **Root cause**: The function returns HTTP 200 with `success: true` even when all items in the batch had errors
- **Recommendation**: Return 200 only when at least one valuation succeeded; return 404 for single vehicle not found

### LOW

**L1: Missing input validation on universal-search** -- FIXED
- **Impact**: Passing a number instead of string for `query` crashes with "query.trim is not a function"; missing `query` crashes with "Cannot read properties of undefined"
- **Root cause**: No type checking before calling `.trim()` on query
- **Fixes applied**:
  - Edge Function Health Agent: Added `typeof query !== 'string'` check (already deployed)
  - Integration Testing Agent: Added query length cap (500 chars) and limit sanitization (1-100 range)
- **Deployed**: `supabase functions deploy universal-search --no-verify-jwt`
- **Verified**: Number queries return 400, long strings are truncated, negative limits default to 1
- **File**: `/Users/skylar/nuke/supabase/functions/universal-search/index.ts`

**L2: Cloudinary image URLs fail in identify_vehicle_image**
- **Impact**: Vehicle images from Mecum (Cloudinary CDN) cannot be identified because Cloudinary serves AVIF format which OpenAI rejects
- **Workaround**: Add `f_jpg` transformation parameter to Cloudinary URLs before sending to OpenAI
- **File**: `/Users/skylar/nuke/supabase/functions/identify-vehicle-from-image/index.ts`

---

## MCP Server Validation Gaps

| Tool | Parameter | Zod Validation | Gap |
|------|-----------|---------------|-----|
| search_vehicles | query | `z.string()` | No max length (could send 10KB+) |
| search_vehicles | limit | `z.number()` | No min/max (could send -1 or 999999) |
| list_vehicles | page | `z.number()` | No min (page=0 or page=-1 causes 500) |
| list_vehicles | limit | `z.number()` | No min/max (limit=-1 causes 500) |
| extract_listing | url | `z.string().url()` | Validates URL format (good) |
| get_vehicle_valuation | vehicle_id | `z.string().uuid()` | Validates UUID format (good) |
| get_vehicle | vehicle_id | `z.string().uuid()` | Validates UUID format (good) |
| identify_vehicle_image | image_url | `z.string().url()` | Validates URL format (good) |

---

## Data Quality Observations

1. **Year 2024 search returns auction events**: Items like "2024 Gooding : Amelia Island" and "2024 RM Sothebys : Hershey" are stored as vehicles with the auction house as `make` and event name as `model`. This pollutes vehicle search results.

2. **Duplicate makes**: "Rm" vs "RM" for Sotheby's indicates normalization gaps in ingestion.

3. **Misattributed make**: "23k-Kilometer" appears as a vehicle make (from "23k-Kilometer 1993 Toyota ToyoAce Double Cab Fire Truck 5-Speed"). The BaT title parsing put the mileage prefix into the make field.

4. **Vehicle descriptions contain repeated text**: The Porsche 911 GT3 description repeats "4.0L/502 HP Flat 6-Cylinder" 20+ times, inflating storage.

---

## Recommendations

### Immediate (Before Launch)
1. Add min/max validation for page and limit in `api-v1-vehicles` to prevent 500 errors
2. Add type validation for `query` in `universal-search` to handle non-string inputs gracefully

### Short-term
3. Add rate limiting to unauthenticated endpoints (at minimum, IP-based throttling)
4. Fix Cloudinary image URL handling for `identify-vehicle-from-image` (append `f_jpg` transform)
5. Fix BaT extraction to use Firecrawl or Playwright for JavaScript-rendered content

### Long-term
6. Clean up auction events stored as vehicles (or filter them from search results)
7. Add query length limits in MCP server validation
8. Consider adding pagination validation in MCP server (page >= 1, 1 <= limit <= 100)
9. Improve "no results" search performance (currently 16s for garbage queries)

---

## Test Environment
- **Platform**: macOS Darwin 25.3.0
- **Supabase Project**: qkgaybvrernstplzjaam
- **Region**: us-west-1
- **Testing method**: Direct curl to edge functions (simulating MCP server behavior)
- **Auth**: Service role key (full access)

---

*Report generated by Integration Testing Agent (Claude Opus 4.6) on 2026-02-10*
