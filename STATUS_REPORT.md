# BaT Extraction Status Report

## Current Database State
- **1,500 BaT vehicles** in database (was 143 earlier - something else ran)
- **1,484 comments** extracted
- **3,300 bids** extracted

## Queue Status
- **1,546 pending** items in queue
- **31 failed** items (all timeout errors from `extract-premium-auction`)
- **0 complete** (queue processor running but not completing items)

## The Problem

### Queue Processor Issues
- `process-bat-extraction-queue` is running (200 status)
- But completing in ~300ms (too fast - means no work or immediate failure)
- All failures are: "Edge Function returned a non-2xx status code"
- This means `extract-premium-auction` is timing out (150s limit)

### What's Happening
1. Queue processor tries to extract vehicle
2. Calls `extract-premium-auction` 
3. Function times out after 150 seconds
4. Queue item marked as failed after 3 attempts
5. Next item in queue fails the same way

## Root Cause
`extract-premium-auction` is taking >150 seconds for complex BaT listings, causing timeouts.

## Solutions

### Option 1: Use Direct Extraction (What Works)
Skip the queue, use the proven two-step method directly:
```bash
./scripts/extract-bat-simple.sh "https://bringatrailer.com/listing/..."
```

### Option 2: Fix Queue Processor
- Increase timeout for `extract-premium-auction` calls
- Or break extraction into smaller chunks
- Or skip timeouts and let them complete

### Option 3: Clear Failed Queue Items
Reset failed items to retry:
```sql
UPDATE bat_extraction_queue 
SET status = 'pending', attempts = 0, error_message = NULL
WHERE status = 'failed' AND attempts >= 3;
```

## Recommendation
**Use direct extraction for now** - the queue system needs timeout fixes.
The proven method works: `extract-premium-auction` + `extract-auction-comments`

