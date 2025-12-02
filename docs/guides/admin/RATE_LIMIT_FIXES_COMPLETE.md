# Rate Limit Handling - COMPLETE ✅

**Date:** January 28, 2025  
**Status:** ✅ Implemented and ready to use

## Problem Solved

You hit OpenAI rate limits while processing images. The system now handles this gracefully and ensures **all images are eventually processed**.

## Solutions Implemented

### 1. Exponential Backoff in API Calls ✅

**Location:** `supabase/functions/backfill-image-angles/index.ts`

- **Automatic retry** with exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Respects `retry-after` header** from OpenAI
- **Up to 5 retries** before giving up
- **Handles both 429 (rate limit) and 5xx (server errors)**

### 2. Adaptive Concurrency ✅

**Location:** `supabase/functions/backfill-image-angles/index.ts`

- **Starts conservative** (20 concurrent requests)
- **Reduces concurrency** when rate limits are hit (70% reduction)
- **Gradually increases** concurrency when no rate limits (10% increase)
- **Minimum concurrency** of 5, **maximum** of 30
- **Waits longer** between batches when rate limited (5s vs 1s)

### 3. Resume Script ✅

**Location:** `scripts/resume-image-processing.sh`

- **Handles rate limits gracefully** (waits 60s on rate limit)
- **Continues automatically** until all images processed
- **Tracks consecutive rate limits** (waits longer after 3+ consecutive hits)
- **Logs everything** to `/tmp/image-processing-resume.log`
- **Shows remaining count** so you know progress

## How to Use

### Option 1: Resume Script (Recommended)

```bash
cd /Users/skylar/nuke
./scripts/resume-image-processing.sh
```

**Features:**
- Automatically handles rate limits
- Continues until all images processed
- Logs progress to `/tmp/image-processing-resume.log`
- Shows remaining count

### Option 2: Original Script (Updated)

```bash
cd /Users/skylar/nuke
./scripts/process-all-images.sh
```

**Features:**
- Smaller batches (100 instead of 200)
- Longer waits (5s instead of 2s)
- More attempts (100 instead of 50)

### Option 3: Manual Invocation

```bash
# Check how many images remain
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-image-angles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 50}' | jq '.remaining'

# Process a batch
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-image-angles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 50, "minConfidence": 80, "requireReview": true}'
```

## Response Format

The function now returns:

```json
{
  "success": true,
  "totalImages": 1500,
  "alreadyTagged": 800,
  "untaggedImages": 700,
  "processed": 50,
  "needsReview": 5,
  "skipped": 0,
  "failed": 0,
  "remaining": 650,
  "rateLimitHits": 0,
  "message": "Processed 50 images (5 flagged for review), skipped 0, 0 failed. 650 remaining."
}
```

**Key Fields:**
- `remaining` - How many images still need processing
- `rateLimitHits` - How many rate limits were hit (for monitoring)
- `processed` - Successfully classified this batch
- `skipped` - Already classified (can be ignored)

## Monitoring Progress

### View Log File:

```bash
tail -f /tmp/image-processing-resume.log
```

### Check Remaining Count:

```bash
curl -s -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-image-angles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 1}' | jq '.remaining'
```

## What Happens on Rate Limit

1. **API Call Level:**
   - Detects 429 error
   - Waits for `retry-after` header or uses exponential backoff
   - Retries up to 5 times
   - If still rate limited, throws error (caught by batch handler)

2. **Batch Level:**
   - Detects rate limit errors
   - Reduces concurrency by 30%
   - Waits 5 seconds before next batch
   - Tracks rate limit hits

3. **Script Level:**
   - Detects rate limit in response
   - Waits 60 seconds
   - Retries the batch
   - If 3+ consecutive rate limits, waits 120 seconds

## Best Practices

1. **Start with resume script** - It handles everything automatically
2. **Let it run overnight** - For large image sets (1000+ images)
3. **Monitor the log** - Check `/tmp/image-processing-resume.log` for progress
4. **Check `remaining` count** - Know when you're done
5. **Don't interrupt** - The script will resume from where it left off

## Files Modified

1. ✅ `supabase/functions/backfill-image-angles/index.ts` - Added rate limit handling
2. ✅ `scripts/resume-image-processing.sh` - New resume script
3. ✅ `scripts/process-all-images.sh` - Updated with better rate limit handling

## Status

✅ **Ready to use** - All rate limit handling implemented. Run `./scripts/resume-image-processing.sh` to process all images.

