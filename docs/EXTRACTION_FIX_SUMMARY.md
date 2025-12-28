# Extraction System Fix Summary

Date: December 28, 2025

## What Was Wrong

### 1. Sequential Processing (FIXED)
The extraction queue processors were running **sequentially** instead of in parallel, causing:
- `process-cl-queue`: Processing 1 listing at a time (~10s each = 6/minute)
- `extract-bat-profile-vehicles`: Already had parallel processing (5 concurrent)
- `process-import-queue`: Still sequential (needs fixing)

### 2. Stuck Queue Items (FIXED)
- 83 CL items stuck in "processing" state
- 659 import items stuck in "processing" state
- Both reset to "pending"

### 3. Over-Strict Validation (PARTIALLY FIXED)
Top failure reasons in import queue:
- "Scrape failed: 403" - 2,962 items (sites blocking scraper - needs Firecrawl)
- "Invalid make/year/model" - ~780 items (validation too strict - RESET to pending)
- "Invalid year: null" - 263 items
- Database schema issues - 181 items

Validation-blocked items (~779) were reset to pending with retry.

### 4. Scraper Blocking (ONGOING)
2,962+ items failing with 403 errors. These sites are blocking direct scraping and need:
- Firecrawl (browser rendering)
- Better User-Agent rotation
- Request throttling

## What Was Fixed

### `process-cl-queue` (DEPLOYED)
Converted from sequential to parallel processing:
```typescript
// BEFORE: Sequential (6 items/minute)
for (const queueItem of queueItems) {
  await processItem(queueItem);
  await sleep(200);
}

// AFTER: Parallel batches of 5 (30 items/minute)
const CONCURRENCY_LIMIT = 5;
for (let i = 0; i < queueItems.length; i += CONCURRENCY_LIMIT) {
  const batch = queueItems.slice(i, i + CONCURRENCY_LIMIT);
  await Promise.allSettled(batch.map(processQueueItem));
  await sleep(300);
}
```

### Queue Items Reset
- 83 CL queue items: processing -> pending
- 659 import queue items: processing -> pending  
- 779 validation-blocked items: failed -> pending

## Current Queue Status (After Fixes)

| Queue | Status | Count |
|-------|--------|-------|
| craigslist_listing_queue | pending | 83 |
| craigslist_listing_queue | failed | 34 |
| import_queue | complete | 7,644 |
| import_queue | duplicate | 981 |
| import_queue | failed | ~3,520 |
| import_queue | pending | ~1,468 |

## Total Vehicles
**9,281 vehicles** in database

## Next Steps

### High Priority
1. **Fix `process-import-queue`** - Convert to parallel (complex, 3500 lines)
2. **Retry 403 failures with Firecrawl** - 2,962 items blocked by bot protection
3. **Relax validation further** - Don't reject items with partial data

### Medium Priority
4. **Add observability** - Track extraction rates, failure patterns
5. **Consolidate functions** - Too many duplicate Edge Functions (292 total)
6. **Fix database schema issues** - 181 items failing on "vehicle_images" relation

### Low Priority
7. **Better error categorization** - Group failures by root cause
8. **Retry mechanism** - Automatic retry with exponential backoff

## Test Commands

```bash
# Check queue stats
node scripts/test-extraction-parallel.js

# Trigger CL queue processing
curl -X POST "${SUPABASE_URL}/functions/v1/process-cl-queue" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20}'

# Trigger BaT profile extraction
curl -X POST "${SUPABASE_URL}/functions/v1/extract-bat-profile-vehicles" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"username": "TheShopClubs"}'
```

## Performance Comparison

| Metric | Before | After |
|--------|--------|-------|
| CL queue throughput | ~6 items/min | ~30 items/min (5x) |
| BAT extraction | ~30 items/min | ~30 items/min (unchanged) |
| Stuck items | 742 | 0 |
| Retryable failures | 0 | 779 |

