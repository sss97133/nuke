# Auction Monitoring System Issues

## Current Problems

### 1. **Comments Not Being Updated Regularly**
- ❌ `extract-auction-comments` function exists but **NO scheduled cron job** runs it
- ❌ `sync-bat-listing` function doesn't extract or update comments
- ❌ Comments only updated during initial import/extraction, not during live auctions

**Impact:** Comment counts are stale during live auctions

### 2. **BaT Listings Table Not Synced**
- ❌ `sync-active-auctions` **only syncs `external_listings` table**
- ❌ BaT data is stored in **BOTH `bat_listings` AND `external_listings`** tables
- ❌ `bat_listings` table not updated by monitoring system

**Impact:** 
- `bat_listings.bid_count` and `bat_listings.final_bid` are stale
- Frontend may read from `bat_listings` and see outdated data

### 3. **Current Bid Updates Are Limited**
- ✅ `sync-bat-listing` updates `external_listings.current_bid` 
- ✅ Cron runs every 15 minutes (`sync-active-auctions`)
- ⚠️ Only processes 20 listings per run
- ⚠️ 15-minute delay means bids can be stale during fast auctions

**Impact:** Current bid can be up to 15 minutes old during active bidding

### 4. **No Adaptive Polling for Ending Auctions**
- ❌ Fixed 15-minute interval regardless of auction status
- ❌ No faster polling in final minutes (when bids come in fastest)
- ❌ No detection of auction extensions (BaT 2-minute rule)

**Impact:** Missing critical bid updates in final minutes

---

## Proposed Fixes

### Fix 1: Add Comments Extraction to Sync Flow

**Option A: Integrate into sync-bat-listing**
```typescript
// In sync-bat-listing/index.ts after updating external_listings
// Also extract and update comments
const commentsResponse = await fetch(`${supabaseUrl}/functions/v1/extract-auction-comments`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,
  },
  body: JSON.stringify({
    bat_listing_url: listing.listing_url,
    vehicle_id: listing.vehicle_id
  })
});
```

**Option B: Create separate cron job (every 30 minutes)**
```sql
-- Extract comments for active BaT auctions
SELECT cron.schedule(
  'extract-bat-comments',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-auction-comments-batch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'platform', 'bat',
        'batch_size', 10
      )
    ) AS request_id;
  $$
);
```

**Recommendation:** Option A (integrate into sync-bat-listing) - more efficient, ensures comments stay in sync with bids

---

### Fix 2: Sync Both `bat_listings` and `external_listings`

**Update sync-bat-listing to also update bat_listings:**
```typescript
// After updating external_listings
// Also find and update corresponding bat_listings row
const { data: batListing } = await supabase
  .from('bat_listings')
  .select('id')
  .eq('bat_listing_url', listing.listing_url)
  .maybeSingle();

if (batListing) {
  await supabase
    .from('bat_listings')
    .update({
      bid_count: bidCount,
      final_bid: finalPrice || currentBid,
      comment_count: commentCount, // From extract-auction-comments
      listing_status: newStatus,
      last_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', batListing.id);
}
```

**Or: Create sync-bat-listings function**
```typescript
// New function: sync-bat-listings-batch
// Queries bat_listings table directly
// Syncs active bat_listings that haven't been updated recently
```

---

### Fix 3: Adaptive Polling for Ending Auctions

**Update sync-active-auctions to use adaptive intervals:**
```typescript
// Calculate polling interval based on auction end time
function getPollingInterval(endDate: string | null): number {
  if (!endDate) return 15 * 60 * 1000; // Default: 15 minutes
  
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const minutesUntilEnd = (end - now) / (60 * 1000);
  
  if (minutesUntilEnd < 2) return 30 * 1000;  // Last 2 min: 30 seconds
  if (minutesUntilEnd < 10) return 60 * 1000; // Last 10 min: 1 minute
  if (minutesUntilEnd < 60) return 5 * 60 * 1000; // Last hour: 5 minutes
  return 15 * 60 * 1000; // Default: 15 minutes
}

// Update get_listings_needing_sync function to use adaptive cooldown
```

**Or: Create priority queue system**
- Separate "ending soon" auctions into high-priority batch
- Process high-priority every 1-2 minutes
- Process normal auctions every 15 minutes

---

### Fix 4: Increase Batch Size and Frequency

**Current:** 20 listings every 15 minutes = ~80/hour
**Problem:** If you have 200+ active auctions, each gets synced only ~3 times per hour

**Fix:** Increase batch size or frequency
```sql
-- Option A: More frequent (every 10 minutes)
'*/10 * * * *'

-- Option B: Larger batch (50 per run)
'batch_size', 50

-- Option C: Parallel processing
-- Process multiple platforms in parallel
```

---

## Immediate Action Items

### Priority 1: Fix Comments Extraction ✅ COMPLETED
1. ✅ Integrated `extract-auction-comments` call into `sync-bat-listing` (with cost control)
2. ✅ Comments are extracted asynchronously when auction ending soon (< 24h) or significant bid increase
3. ✅ `extract-auction-comments` already updates `bat_listings.comment_count` and `auction_comments` table

### Priority 2: Sync Both Tables ✅ COMPLETED
1. ✅ Updated `sync-bat-listing` to also update `bat_listings` table
2. ✅ Both `external_listings` and `bat_listings` now stay in sync with:
   - `bid_count`, `final_bid`, `view_count`
   - `listing_status`, `sale_price`, `sale_date`
   - `auction_end_date`

### Priority 3: Improve Batch Processing ✅ COMPLETED
1. ✅ Increased batch size from 20 to 50 listings per run
2. ✅ Added better error handling with timeouts (60s per listing)
3. ✅ Improved logging and error reporting
4. ✅ Created health check functions to monitor sync status

### Priority 4: Verify Cron Jobs ✅ COMPLETED
1. ✅ Created migration to update cron job with new batch size
2. ✅ Added `check_auction_sync_health()` function
3. ✅ Added `check_sync_coverage()` function for monitoring

### Priority 3: Verify Cron Jobs Are Active
```sql
-- Check if cron jobs are running
SELECT jobid, jobname, schedule, active, last_run
FROM cron.job 
WHERE jobname IN ('sync-active-auctions', 'extract-bat-comments');

-- Verify jobs have run recently
SELECT * FROM cron.job_run_details 
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname = 'sync-active-auctions'
)
ORDER BY start_time DESC
LIMIT 10;
```

### Priority 4: Adaptive Polling (Future Enhancement)
- Implement adaptive intervals for ending auctions
- Add extension detection (2-minute rule for BaT)
- Create priority queue for ending-soon auctions

---

## Testing Checklist

After implementing fixes:

1. ✅ Verify `external_listings.current_bid` updates every 15 minutes
   - **Test**: Run `SELECT * FROM check_sync_coverage();` to see sync coverage
2. ✅ Verify `bat_listings.bid_count` updates when syncing
   - **Test**: Check that `bat_listings` rows are updated after sync runs
3. ✅ Verify `bat_listings.comment_count` updates via `extract-auction-comments`
   - **Test**: Check that comments are extracted for auctions ending soon
4. ✅ Verify `auction_comments` table gets new comments during live auctions
   - **Test**: Monitor `auction_comments` table for new entries after comment extraction
5. ✅ Verify sold status is detected and updated promptly
   - **Test**: Check that `listing_status` changes to 'sold' when auction ends
6. ✅ Verify frontend shows accurate bid counts and comment counts
   - **Test**: Check organization profile page shows current bids and comments

## Monitoring Commands

```sql
-- Check if sync cron job is running
SELECT * FROM check_auction_sync_health();

-- Check sync coverage
SELECT * FROM check_sync_coverage();

-- Check recent sync activity
SELECT 
  platform,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE last_synced_at >= NOW() - INTERVAL '15 minutes') as synced_recently,
  MAX(last_synced_at) as last_sync
FROM external_listings
WHERE listing_status = 'active' AND sync_enabled = TRUE
GROUP BY platform;

-- Check bat_listings sync status
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE listing_status = 'active') as active,
  COUNT(*) FILTER (WHERE last_updated_at >= NOW() - INTERVAL '15 minutes') as updated_recently,
  MAX(last_updated_at) as last_update
FROM bat_listings;
```

---

## Related Files

- `supabase/functions/sync-active-auctions/index.ts` - Main sync orchestrator
- `supabase/functions/sync-bat-listing/index.ts` - BaT listing sync (needs comments integration)
- `supabase/functions/extract-auction-comments/index.ts` - Comments extractor (not scheduled)
- `supabase/migrations/20250117_sync_active_auctions_cron.sql` - Cron job setup
- `nuke_frontend/src/pages/OrganizationProfile.tsx` - Frontend display (already fixed)

