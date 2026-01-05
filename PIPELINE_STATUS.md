# Pipeline Status & Action Plan

## Problem Statement
**Goal**: Consistent new profiles arriving from all sources  
**Current State**: Pipelines exist but don't reliably converge

## Root Cause Analysis (Jan 5, 2026)

### 1. Auth Mismatch (FIXED ✅)
- **Problem**: Edge Function secrets use `sb_secret_*` format (41 chars), NOT JWT
- **Symptom**: Functions deployed with `verify_jwt: true` rejected all calls with "Invalid JWT"
- **Fix**: Redeployed all internal functions with `verify_jwt: false`:
  - `pipeline-orchestrator`
  - `process-import-queue`
  - `process-bat-extraction-queue`
  - `comprehensive-bat-extraction`
  - `import-bat-listing`
  - `backfill-images`

### 2. Orphaned Queue Locks (FIXED ✅)
- **Problem**: 861 rows stuck in "processing" status (orphaned locks from crashed/timeout functions)
- **Fix**: Orchestrator now unlocks rows older than 15min on every run
- **Result**: Unlocked 1,053 total rows across 2 runs

### 3. Queue Processor Timeouts (IN PROGRESS 🔧)
- **Problem**: `process-import-queue` hits 150s Edge Function timeout with batch_size=10-20
  - Each item takes 10-30s (Firecrawl scrape + image upload + analysis)
  - 10 items × 15s avg = 150s = timeout
- **Current queue state**:
  - `import_queue`: 748 pending, 99 processing, 7,849 complete
  - `bat_extraction_queue`: 1,000 pending, 0 processing, 0 complete (never runs)
- **Solution options**:
  - **A) Reduce batch to 3-5 items** (conservative, guaranteed to finish)
  - **B) Add "fast import" mode** (skip images/analysis, just create vehicle stub)
  - **C) Make queue processing async/chunked** (process 1 item, return, re-invoke)

### 4. No Active Discovery (NOT STARTED)
- **Problem**: No automated source discovery is running
- **Sources that should be active**:
  - BaT active auctions (50/day)
  - Mecum auctions (20/day)
  - Cars & Bids (20/day)
  - Broad Arrow (20/day)
  - Organization inventory (dealer sites)
  - Craigslist (regional searches)
- **Current**: Only `Collective Auto Group` is actively creating profiles (217 in last 7d)

## Action Plan

### Phase 1: Unblock Queues (NOW)
- [ ] Reduce `process-import-queue` batch to 3 items
- [ ] Reduce `process-bat-extraction-queue` batch to 3 items
- [ ] Test that processors complete within 150s
- [ ] Verify queue depths decrease over time

### Phase 2: Activate Discovery (NEXT)
- [ ] Wire up `sync-active-auctions` to run every 6 hours
- [ ] Enable `extract-all-orgs-inventory` (5 orgs/run, every 12h)
- [ ] Add Craigslist regional scraper (top 10 metros, daily)
- [ ] Monitor queue fill rate vs drain rate

### Phase 3: Optimize Throughput (LATER)
- [ ] Add "fast import" mode (skip images during queue, backfill later)
- [ ] Implement chunked processing (process 1, re-invoke self)
- [ ] Add priority queue (user-requested imports go first)
- [ ] Scale up batch sizes once fast mode is proven

### Phase 4: Observability (LATER)
- [ ] Add health dashboard (profiles/day by source)
- [ ] Track queue depth trends
- [ ] Alert on queue growing >1000 or drain rate <10/hour
- [ ] Add correlation IDs for end-to-end tracing

## Current Metrics (as of last orchestrator run)
- **Queue depths**:
  - `import_queue`: 748 pending, 99 processing
  - `bat_extraction_queue`: 1,000 pending, 0 processing
- **Recent profile creation** (last 7 days):
  - Collective Auto Group: 217
  - Mecum: 112
  - Cars & Bids: 80
  - Broad Arrow: 50
  - BaT: 29
  - **Total: 488 profiles/week = ~70/day**
- **Target**: 200-500 profiles/day across all sources

## Next Immediate Steps
1. Reduce batch sizes to 3 (process-import-queue, process-bat-extraction-queue)
2. Test full orchestrator run (should complete in <60s)
3. Run orchestrator 3x in a row, verify queue depths decrease
4. If successful, set up GitHub Action to run every 10 min
5. Monitor for 24h, adjust batch sizes based on throughput

---
**Updated**: Jan 5, 2026 00:30 UTC  
**Status**: Auth fixed ✅, orphan locks cleared ✅, timeout issue identified 🔧

