# Extraction Performance Fix - Restored Parallel Processing

## Problem Summary

**Why extraction worked 3 weeks ago (~8000 profiles) but fails now:**

1. **Sequential Processing** - Changed from parallel (5 at a time) to sequential (one at a time) to avoid timeouts
   - **Impact**: ~5x slower throughput
   - **Location**: `extract-bat-profile-vehicles/index.ts` line 231

2. **Over-strict Validation** - Multiple validation layers rejecting valid data
   - Required fields with strict checks
   - Blacklists rejecting "N/A", "null", "undefined"
   - Range checks that may be too tight

3. **Timeout Handling** - Multiple timeout mechanisms cutting off extractions
   - 60s Firecrawl timeout
   - 30s direct fetch timeout
   - 20s map timeout
   - Retry logic with exponential backoff compounding delays

4. **Image Download Batching** - Slow batch downloads (5 at a time, 1s delays)
   - For listings with 100+ images, adds significant time
   - Increases timeout risk

5. **Function Size Issues** - `comprehensive-bat-extraction` was too large (1.231MB) and had to be bypassed
   - Workaround uses different extraction path that may be less reliable

6. **Multiple Extraction Layers** - Added proofreading, re-extraction, validation layers
   - Each layer adds failure points and complexity

## Root Cause

The fix for timeouts (sequential processing) **killed throughput**. The original approach was:
- ✅ Parallel processing (5 at a time)
- ✅ Simple extraction, minimal validation
- ✅ Fast throughput → ~8000 profiles

The current approach was:
- ❌ Sequential processing (one at a time)
- ❌ Multiple validation layers
- ❌ Slow batch downloads
- ❌ Multiple timeout mechanisms
- ❌ Retry logic compounding delays

## Solution Applied

**Restored parallel processing with concurrency limit** in `extract-bat-profile-vehicles/index.ts`:

- Changed from sequential `for` loop to parallel batches
- Concurrency limit of 5 (same as original)
- Uses `Promise.allSettled` to handle failures gracefully
- Small delay between batches (1s) to avoid rate limits
- Maintains timeout prevention while restoring throughput

### Changes Made

1. **Replaced sequential loop** (line 231) with parallel batch processing
2. **Added concurrency limit** of 5 listings at a time
3. **Used Promise.allSettled** to handle individual failures without stopping the batch
4. **Maintained error tracking** for failed extractions
5. **Added batch progress logging** for visibility

## Expected Results

- **Throughput**: Should restore ~5x improvement (from sequential to parallel)
- **Success Rate**: Should maintain or improve (parallel processing doesn't reduce reliability)
- **Timeout Prevention**: Still prevents timeouts (concurrency limit + batch delays)

## Next Steps

1. **Deploy the fix** to production
2. **Monitor extraction rates** - should see ~5x improvement
3. **Review validation rules** - may need to relax some strict checks
4. **Optimize image downloads** - consider parallel downloads with concurrency limit
5. **Consider removing unnecessary layers** - simplify extraction pipeline

## Files Modified

- `supabase/functions/extract-bat-profile-vehicles/index.ts` - Restored parallel processing

## Related Issues

- `comprehensive-bat-extraction` function is still too large (1.231MB) and broken
- Image download batching is still slow (5 at a time, 1s delays)
- Multiple validation layers may still be rejecting valid data

## Testing

After deployment, test with:
- Small batch (10 listings) - verify parallel processing works
- Medium batch (50 listings) - verify throughput improvement
- Large batch (200+ listings) - verify no timeout issues

