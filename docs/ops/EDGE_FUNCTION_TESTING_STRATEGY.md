# Edge Function Testing Strategy

## Overview

With **200+ Edge Functions** in the Nuke platform, comprehensive testing requires a strategic, tiered approach rather than testing everything manually.

## Testing Tiers

### Tier 1: Critical User-Facing Functions (Test Always)

These functions are called directly from the frontend or are essential for core user workflows:

- `analyze-image` - Image analysis (user uploads)
- `scrape-vehicle` - Vehicle scraping (user URL drops)
- `process-vehicle-import` - Vehicle import processing
- `parse-receipt` - Receipt parsing (user uploads)
- `extract-title-data` - Title scanning (user uploads)
- `create-checkout` - Payment processing
- `stripe-webhook` - Payment webhooks
- `auto-analyze-upload` - Auto-analysis on upload
- `vehicle-expert-agent` - Vehicle valuations
- `search-vehicle-history` - Vehicle search
- `decode-vin` - VIN decoding

**Testing Frequency**: Before every production deployment

### Tier 2: High-Value Processing Functions (Test Weekly)

Functions that process important data or run frequently:

- `process-import-queue` - Import queue processing
- `backfill-images` - Image backfilling
- `comprehensive-bat-extraction` - BaT extraction
- `sync-bat-listing` - BaT sync
- `extract-auction-comments` - Comment extraction
- `analyze-auction-comments` - Comment analysis
- `batch-analyze-images` - Batch image analysis
- `process-all-images-cron` - Scheduled image processing
- `tier1-batch-runner` - Tier 1 analysis
- `analyze-image-tier1` - Tier 1 analysis
- `analyze-image-tier2` - Tier 2 analysis
- `analyze-image-contextual` - Contextual analysis

**Testing Frequency**: Weekly or after significant changes

### Tier 3: Background/Admin Functions (Test Monthly)

Functions used for maintenance, backfilling, or admin tasks:

- `backfill-bat-vehicles` - BaT backfill
- `backfill-image-angles` - Angle backfilling
- `normalize-all-vehicles` - Vehicle normalization
- `auto-fix-bat-prices` - Price fixing
- `cleanup-bat-image-contamination` - Image cleanup
- `admin-backfill-bat-missing-images` - Admin backfill
- `activate-pending-vehicles` - Vehicle activation
- `re-extract-pending-vehicles` - Re-extraction
- `process-backfill-queue` - Backfill queue
- `process-catalog-queue` - Catalog queue

**Testing Frequency**: Monthly or when modified

### Tier 4: Specialized/Experimental Functions (Test As Needed)

Functions for specific use cases or experiments:

- `scrape-lmc-truck` - LMC scraping
- `scrape-prowire-catalog` - Prowire scraping
- `scrape-motec-catalog` - Motec scraping
- `scrape-craigslist-search` - Craigslist scraping
- `scrape-all-craigslist-squarebodies` - Squarebody scraping
- `import-classiccars-listing` - ClassicCars import
- `extract-premium-auction` - Premium auction extraction
- `monitor-bat-seller` - BaT monitoring
- `monitor-sbxcars-listings` - SBXCars monitoring
- All other specialized scrapers and processors

**Testing Frequency**: When actively used or modified

## Testing Approach

### 1. Health Check Tests (All Functions)

**Purpose**: Verify functions respond and don't crash

**Method**: 
- Call each function with minimal/empty payload
- Check for HTTP 200/400/500 (not 404/503)
- Verify response structure (JSON, not HTML error page)
- Timeout: 5 seconds

**Script**: `scripts/test-all-edge-functions-health.js`

**Frequency**: Before major deployments

### 2. Contract Tests (Tier 1 & 2)

**Purpose**: Verify functions match their documented contracts

**Method**:
- Test with valid inputs per `EDGE_FUNCTION_CONTRACTS.md`
- Verify output structure matches expected format
- Test error handling with invalid inputs
- Verify database writes (if applicable)

**Script**: `scripts/test-edge-function-contracts.js`

**Frequency**: Before production deployments

### 3. Integration Tests (Tier 1 Only)

**Purpose**: Verify end-to-end workflows

**Method**:
- Test full user workflows (upload → process → result)
- Verify data flows correctly through the system
- Test error recovery

**Script**: `scripts/test-edge-function-integration.js`

**Frequency**: Weekly or before major releases

### 4. Performance Tests (Tier 1 & 2)

**Purpose**: Identify slow or resource-intensive functions

**Method**:
- Measure response times
- Track memory usage (if available)
- Identify functions taking > 30 seconds
- Flag functions that timeout frequently

**Script**: `scripts/test-edge-function-performance.js`

**Frequency**: Monthly

## Test Execution

### Quick Health Check (All Functions)
```bash
node scripts/test-all-edge-functions-health.js
```

### Contract Tests (Tier 1 & 2)
```bash
node scripts/test-edge-function-contracts.js --tier 1,2
```

### Full Test Suite (Tier 1 Only)
```bash
node scripts/test-edge-function-integration.js
```

### Performance Audit
```bash
node scripts/test-edge-function-performance.js
```

## Test Results

Test results should be stored in:
- `test-results/edge-functions/health-{timestamp}.json`
- `test-results/edge-functions/contracts-{timestamp}.json`
- `test-results/edge-functions/performance-{timestamp}.json`

## Continuous Testing

### Pre-Deployment Checklist
- [ ] Run health check on all functions
- [ ] Run contract tests on Tier 1 functions
- [ ] Verify no new errors in Supabase logs

### Weekly Maintenance
- [ ] Run contract tests on Tier 2 functions
- [ ] Review performance test results
- [ ] Check for functions with high error rates

### Monthly Audit
- [ ] Run full test suite
- [ ] Review and update function priorities
- [ ] Deprecate unused functions
- [ ] Update documentation

## Function Status Tracking

Functions should be tracked with:
- Last tested date
- Test result (pass/fail/warning)
- Last error (if any)
- Usage frequency
- Priority tier

This can be stored in a `function_health` table or tracked via the `tool_registry` system.

## Recommendations

1. **Start with Tier 1**: Focus testing effort on user-facing functions first
2. **Automate Health Checks**: Run basic health checks in CI/CD
3. **Monitor Production**: Use Supabase logs to identify failing functions
4. **Document Contracts**: Ensure all Tier 1 functions have documented contracts
5. **Deprecate Unused**: Remove or archive functions that haven't been used in 90+ days
6. **Test Before Deploy**: Always run health checks before deploying new function versions


