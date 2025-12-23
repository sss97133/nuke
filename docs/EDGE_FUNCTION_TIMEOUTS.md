# Supabase Edge Function Timeout Limits

## Current Limits

**Default Timeout: 60 seconds**
- Supabase Edge Functions have a hard limit of **60 seconds** execution time
- This is a platform limit, not configurable on free/tier plans
- Functions that exceed this limit return **504 Gateway Timeout**

## Why Timeouts Happen

1. **Too much work in one function call**
   - Processing too many listings (50+ regions × 10+ searches)
   - Downloading too many images
   - Making too many external API calls

2. **Network latency**
   - Slow responses from Craigslist
   - Firecrawl API delays
   - Image downloads taking too long

3. **Sequential processing**
   - Processing listings one-by-one instead of in parallel
   - Waiting for each request to complete before starting next

## Current Workarounds (What We're Doing)

1. **Self-limiting execution time**
   ```typescript
   const maxExecutionTime = 50000 // 50 seconds - leave 10s buffer
   if (elapsed > maxExecutionTime) {
     break // Stop processing early
   }
   ```

2. **Reduced batch sizes**
   - `max_regions: 10` (down from 50)
   - `max_listings_per_search: 30` (down from 100)
   - `maxProcessPerRun: 5` (down from 10)

3. **Shorter timeouts**
   - Fetch timeouts: 3-5 seconds
   - Rate limiting: 500ms delays

## Solutions to Increase Effective Processing Time

### Option 1: Queue-Based Processing (RECOMMENDED)
**Best for: Large-scale scraping**

Instead of processing everything in one function:
1. Discovery function finds listings → adds to queue
2. Queue processor runs in smaller batches
3. Each batch completes within timeout
4. Process repeats until queue is empty

**Benefits:**
- No timeout issues (each batch is small)
- Can process unlimited listings
- Automatic retry on failures
- Better error handling

**Current Status:** ✅ Already implemented
- `discover-cl-squarebodies` → adds to `craigslist_listing_queue`
- `process-cl-queue` → processes in batches

### Option 2: Function Chaining (Self-Invocation)
**Best for: Long-running tasks**

Function calls itself to continue processing:
```typescript
// Process batch
const remaining = allListings.slice(processed);

if (remaining.length > 0 && elapsed < 50000) {
  // Invoke self to continue
  await supabase.functions.invoke('scrape-all-craigslist-squarebodies', {
    body: { listings: remaining, ... }
  });
}
```

**Benefits:**
- Can process unlimited items
- Each invocation stays under timeout
- Automatic continuation

**Example:** `go-grinder` function uses this pattern

### Option 3: Upgrade Supabase Plan
**Check if Pro/Enterprise plans have longer timeouts**

- Free/Tier plans: 60 seconds (hard limit)
- Pro/Enterprise: May have longer limits (need to verify)
- Cost: $25-100+/month

**Note:** Even with longer timeouts, queue-based processing is still better for reliability.

### Option 4: Parallel Processing
**Best for: Independent operations**

Process multiple listings in parallel:
```typescript
const promises = listings.map(listing => processListing(listing));
await Promise.all(promises);
```

**Benefits:**
- Faster overall execution
- Better resource utilization
- Still need to stay under 60s total

**Limitations:**
- Can't parallelize too much (still hits timeout)
- Network requests still take time

## Do We Need More Compute?

**Short answer: No**

The timeout is a **time limit**, not a resource limit:
- More CPU/RAM won't help if the function times out
- The bottleneck is **execution time**, not compute power
- Network latency is the main issue (waiting for responses)

**What would help:**
- ✅ Queue-based processing (already implemented)
- ✅ Function chaining (can implement)
- ✅ Parallel processing (can optimize)
- ❌ More compute (won't solve timeout)

## Recommended Approach

**Use Queue-Based Processing** (already built):

1. **Discovery Phase** (fast, under 10s):
   ```bash
   # Finds listings, adds to queue
   discover-cl-squarebodies { max_regions: 20, max_searches_per_region: 5 }
   ```

2. **Processing Phase** (runs in batches):
   ```bash
   # Processes queue in small batches
   process-cl-queue { batch_size: 5 }
   # Run multiple times until queue is empty
   ```

3. **Monitor Progress**:
   - Check queue status in dashboard
   - Run `process-cl-queue` repeatedly
   - Each run processes 5 listings (well under timeout)

## Current Implementation Status

✅ **Queue system exists**
- `craigslist_listing_queue` table
- `discover-cl-squarebodies` adds listings
- `process-cl-queue` processes them

✅ **Timeout protection**
- Self-limiting execution time
- Reduced batch sizes
- Early exit on timeout

⚠️ **Can optimize further**
- Increase batch size in queue processor (currently 5, could be 10-15)
- Add function chaining for discovery
- Parallel processing for independent operations

## Next Steps

1. **Use queue-based processing** instead of direct scraping
2. **Run queue processor multiple times** to clear backlog
3. **Monitor with dashboard** to see progress
4. **Consider function chaining** if queue gets too large

