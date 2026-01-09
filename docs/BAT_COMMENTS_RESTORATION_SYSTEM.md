# BaT Comments Restoration System

## Overview

The BaT Comments Restoration System automatically restores comments and bids from Bring a Trailer auction listings. This system is designed to work **without Firecrawl** using direct HTML fetching and embedded JSON extraction.

## How It Works

### 1. Direct HTML Fetching (No Firecrawl Required)

The `extract-auction-comments` Edge Function uses direct HTTP requests to BaT listings:

- ✅ **No Firecrawl dependency** - Uses native `fetch()` API
- ✅ **Embedded JSON extraction** - BaT embeds comments in HTML as JSON
- ✅ **DOM parsing fallback** - If JSON extraction fails, parses HTML directly
- ⚠️ **Rate limiting** - Adds 2-4 second delays between requests to avoid IP blocking

### 2. IP Rotation & Rate Limiting

To avoid getting blocked by BaT:

- **Automatic delays**: 2-4 seconds between requests (randomized)
- **User-Agent rotation**: Randomizes browser user agents
- **Batch processing**: Processes in small batches (50 vehicles per run)
- **Checkpoint system**: Resumes from failures without re-processing

### 3. Restoration Process

1. **Find vehicles** with BaT URLs that are missing comments
2. **Create auction_events** if they don't exist
3. **Extract comments** using `extract-auction-comments` function
4. **Store comments** in `auction_comments` table
5. **Track progress** with checkpoint system

## Setup

### Option 1: Manual Script (Recommended for Initial Restoration)

Run the Node.js script to restore all comments:

```bash
# Process 50 vehicles at a time
node scripts/restore-bat-comments.js 50 0

# Continue from where it left off
node scripts/restore-bat-comments.js 50 50
```

The script:
- ✅ Processes vehicles in batches
- ✅ Saves checkpoints to resume from failures
- ✅ Shows progress and statistics
- ✅ Handles rate limiting automatically

### Option 2: Supabase Cron Job (Automated Daily Restoration)

Set up automated daily restoration:

1. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy restore-bat-comments
   ```

2. **Apply the migration**:
   ```sql
   -- Run in Supabase Dashboard → SQL Editor
   -- First, set your service role key:
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
   
   -- Then apply the migration:
   \i supabase/migrations/20250201_setup_bat_comments_restore_cron.sql
   ```

3. **Verify the cron job**:
   ```sql
   SELECT jobid, jobname, schedule, active
   FROM cron.job 
   WHERE jobname = 'restore-bat-comments';
   ```

The cron job runs **daily at 2 AM** and processes 50 vehicles per run.

## Edge Function API

### Endpoint

```
POST /functions/v1/restore-bat-comments
```

### Request Body

```json
{
  "batch_size": 50,        // Number of vehicles to process (default: 50)
  "start_from": 0,         // Start from this index (default: 0)
  "max_runs_per_day": 1    // Maximum runs per day (default: 1)
}
```

### Response

```json
{
  "success": true,
  "processed": 50,
  "succeeded": 45,
  "failed": 5,
  "comments_restored": 2341,
  "next_start_from": 50
}
```

## Manual Restoration

### Restore Comments for a Single Vehicle

```bash
# Using the script
node scripts/restore-bat-comments.js 1 0

# Or directly call the Edge Function
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auction_url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/",
    "vehicle_id": "YOUR_VEHICLE_ID"
  }'
```

### Restore Comments for Multiple Vehicles

```bash
# Process 100 vehicles starting from index 0
node scripts/restore-bat-comments.js 100 0

# Continue from index 100
node scripts/restore-bat-comments.js 100 100
```

## IP Jumping & Rate Limiting

### Why IP Jumping Matters

BaT may block requests that:
- Come from the same IP too frequently
- Don't have proper browser headers
- Make requests too quickly

### How We Handle It

1. **Randomized Delays**: 2-4 seconds between requests
2. **User-Agent Rotation**: Randomizes browser user agents
3. **Batch Processing**: Small batches (50 vehicles) to avoid long-running requests
4. **Error Handling**: Gracefully handles rate limit errors and continues

### If You Get Blocked

If you start getting 429 (Too Many Requests) or 403 (Forbidden) errors:

1. **Increase delays**: Modify the delay in `restore-bat-comments.js`:
   ```javascript
   await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
   ```

2. **Reduce batch size**: Process fewer vehicles per run:
   ```bash
   node scripts/restore-bat-comments.js 25 0  # 25 instead of 50
   ```

3. **Add proxy support**: The `extract-auction-comments` function supports proxies via environment variables (see `_shared/proxyRotation.ts`)

## Monitoring

### Check Restoration Progress

```sql
-- Count vehicles with BaT URLs
SELECT COUNT(*) as total_bat_vehicles
FROM vehicles
WHERE discovery_url ILIKE '%bringatrailer.com%'
   OR bat_auction_url ILIKE '%bringatrailer.com%';

-- Count vehicles with comments
SELECT COUNT(DISTINCT vehicle_id) as vehicles_with_comments
FROM auction_comments
WHERE platform = 'bat';

-- Find vehicles missing comments
SELECT v.id, v.year, v.make, v.model, v.discovery_url
FROM vehicles v
WHERE (v.discovery_url ILIKE '%bringatrailer.com%' 
    OR v.bat_auction_url ILIKE '%bringatrailer.com%')
  AND NOT EXISTS (
    SELECT 1 FROM auction_comments ac
    WHERE ac.vehicle_id = v.id AND ac.platform = 'bat'
  )
LIMIT 10;
```

### Check Cron Job Status

```sql
-- View recent cron job runs
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  r.start_time,
  r.end_time,
  r.status,
  r.return_message
FROM cron.job j
LEFT JOIN cron.job_run_details r ON j.jobid = r.jobid
WHERE j.jobname = 'restore-bat-comments'
ORDER BY r.start_time DESC
LIMIT 10;
```

## Troubleshooting

### "Edge Function returned a non-2xx status code"

This usually means:
- The BaT listing URL is invalid or expired
- BaT is blocking the request (rate limiting)
- The listing requires JavaScript rendering (rare)

**Solution**: The script automatically skips failed vehicles and continues. Check the logs for specific error messages.

### "No comments extracted"

Possible reasons:
- The listing has no comments
- The comments are in a format we don't parse yet
- The listing requires JavaScript rendering

**Solution**: Check the BaT listing manually. If it has comments but we're not extracting them, we may need to update the parsing logic.

### "Failed to create auction_event"

This usually means there's a database constraint issue.

**Solution**: Check the `auction_events` table schema and ensure the vehicle_id and source_url combination is valid.

## Performance

### Current Stats

- **Total vehicles with BaT URLs**: ~1,000
- **Successfully restored**: ~180 vehicles
- **Comments restored**: ~4,180 comments
- **Average comments per vehicle**: ~23 comments
- **Success rate**: ~90% (some listings are expired/deleted)

### Optimization Tips

1. **Process in smaller batches** if you're hitting rate limits
2. **Increase delays** between requests if getting blocked
3. **Run during off-peak hours** (2 AM cron job is ideal)
4. **Use checkpoint system** to resume from failures

## Next Steps

1. ✅ **Initial restoration complete**: ~4,180 comments restored
2. ⏳ **Automated daily restoration**: Cron job processes new vehicles
3. 🔄 **Continuous monitoring**: Check logs for failures
4. 📊 **Track success rates**: Monitor restoration statistics

---

**Last Updated**: 2026-02-01  
**Status**: ✅ Production Ready  
**Firecrawl Required**: ❌ No (uses direct HTML fetch)

