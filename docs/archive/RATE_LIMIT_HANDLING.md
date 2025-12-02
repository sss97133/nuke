# Rate Limit Handling for Image Processing

**Date:** January 28, 2025  
**Status:** ✅ Implemented

## Problem

When processing large batches of images through OpenAI Vision API, rate limits (429 errors) can cause:
- Failed image classifications
- Lost progress
- Need to manually restart processing

## Solution

### 1. Exponential Backoff in API Calls ✅

The `classifyImageAngle` function now includes:
- **Automatic retry** with exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Respects `retry-after` header** from OpenAI
- **Up to 5 retries** before giving up
- **Handles both 429 (rate limit) and 5xx (server errors)**

### 2. Adaptive Concurrency ✅

The main processing loop now:
- **Starts conservative** (20 concurrent requests)
- **Reduces concurrency** when rate limits are hit (70% reduction)
- **Gradually increases** concurrency when no rate limits (10% increase)
- **Minimum concurrency** of 5, **maximum** of 30
- **Waits longer** between batches when rate limited (5s vs 1s)

### 3. Resume Script ✅

New script: `scripts/resume-image-processing.sh`
- **Handles rate limits gracefully** (waits 60s on rate limit)
- **Continues automatically** until all images processed
- **Tracks consecutive rate limits** (waits longer after 3+ consecutive hits)
- **Logs everything** to `/tmp/image-processing-resume.log`

## Usage

### Run with Rate Limit Handling:

```bash
# Use the resume script (recommended)
./scripts/resume-image-processing.sh

# Or use the original script (also updated)
./scripts/process-all-images.sh
```

### Manual Invocation:

```bash
# Smaller batches to avoid rate limits
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-image-angles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "batchSize": 50,
    "minConfidence": 80,
    "requireReview": true
  }'
```

## Configuration

### Edge Function Settings:
- **Starting concurrency:** 20 requests
- **Min concurrency:** 5 requests
- **Max concurrency:** 30 requests
- **Retry attempts:** 5
- **Base delay:** 1 second
- **Wait between batches (normal):** 1 second
- **Wait between batches (rate limited):** 5 seconds

### Resume Script Settings:
- **Batch size:** 50 images
- **Sleep between batches:** 10 seconds
- **Sleep on rate limit:** 60 seconds
- **Max attempts:** 200 batches

## Monitoring

### Check Progress:

```bash
# View log file
tail -f /tmp/image-processing-resume.log

# Check how many images remain
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-image-angles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 1}' | jq '.remaining'
```

### Response Format:

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

## Best Practices

1. **Start with smaller batches** (50 images) to avoid rate limits
2. **Use the resume script** for large image sets (handles interruptions)
3. **Monitor the log file** to track progress
4. **Let it run overnight** for very large sets (1000+ images)
5. **Check `remaining` count** to know when done

## Rate Limit Recovery

If you hit rate limits:
1. The function automatically retries with exponential backoff
2. Concurrency is reduced to avoid further rate limits
3. The resume script waits 60s before retrying
4. Processing continues automatically - no manual intervention needed

## Files Modified

1. ✅ `supabase/functions/backfill-image-angles/index.ts` - Added rate limit handling
2. ✅ `scripts/resume-image-processing.sh` - New resume script
3. ✅ `scripts/process-all-images.sh` - Updated with better rate limit handling

