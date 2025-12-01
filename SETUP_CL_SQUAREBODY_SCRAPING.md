# Setup Automated Craigslist Squarebody Scraping

This guide sets up automated discovery and processing of Craigslist squarebody listings (1973-1991 Chevy/GMC trucks).

## 🎯 What This Does

1. **Discovery** (runs daily at 2 AM):
   - Searches all Craigslist regions for squarebody listings
   - Adds unique listing URLs to a queue table
   - No scraping, just discovery

2. **Processing** (runs every 30 minutes):
   - Processes 15 listings from queue per run
   - Scrapes each listing
   - Creates vehicles (if squarebody, 1973-1991 Chevy/GMC)
   - Downloads and uploads images
   - Handles duplicates and errors

## 📋 Prerequisites

1. **Service Role Key**: Get from Supabase Dashboard → Settings → API
2. **Database Access**: Supabase Dashboard → SQL Editor

## 🚀 Setup Steps

### Step 1: Apply Migrations

Run these migrations in Supabase Dashboard → SQL Editor (in order):

1. **Queue Table:**
   ```sql
   -- File: supabase/migrations/20250129_create_cl_listing_queue.sql
   -- Creates the queue table for storing discovered listings
   ```

2. **Cron Jobs:**
   ```sql
   -- File: supabase/migrations/20250129_setup_cl_scraping_cron.sql
   -- Sets up scheduled jobs (but requires service role key first)
   ```

### Step 2: Set Service Role Key

**IMPORTANT:** The cron jobs need your service role key to authenticate.

Run this in Supabase SQL Editor (replace `YOUR_SERVICE_ROLE_KEY`):

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

**To get your service role key:**
1. Go to Supabase Dashboard
2. Settings → API
3. Copy "service_role" key (keep it secret!)

### Step 3: Deploy Edge Functions

Deploy the two new edge functions:

```bash
cd /Users/skylar/nuke

# Deploy discovery function
supabase functions deploy discover-cl-squarebodies

# Deploy processing function
supabase functions deploy process-cl-queue
```

### Step 4: Verify Cron Jobs

Check that cron jobs were created:

```sql
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname IN ('cl-discover-squarebodies', 'cl-process-queue');
```

You should see:
- `cl-discover-squarebodies` - Runs daily at 2 AM
- `cl-process-queue` - Runs every 30 minutes

## 🧪 Testing

### Test Discovery (Manual)

```sql
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-squarebodies',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  ),
  body := jsonb_build_object(
    'max_regions', 5, -- Test with 5 regions
    'max_searches_per_region', 5
  )
);
```

Check queue:
```sql
SELECT COUNT(*) as pending_count, status 
FROM craigslist_listing_queue 
GROUP BY status;
```

### Test Processing (Manual)

```sql
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-cl-queue',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  ),
  body := jsonb_build_object(
    'batch_size', 5 -- Test with 5 listings
  )
);
```

Check results:
```sql
SELECT status, COUNT(*) 
FROM craigslist_listing_queue 
GROUP BY status;
```

## 📊 Monitoring

### Check Queue Status

```sql
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM craigslist_listing_queue
GROUP BY status
ORDER BY status;
```

### Check Recent Activity

```sql
SELECT 
  status,
  listing_url,
  error_message,
  retry_count,
  created_at,
  processed_at
FROM craigslist_listing_queue
ORDER BY updated_at DESC
LIMIT 20;
```

### Check Created Vehicles

```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN discovery_source = 'craigslist_scrape' THEN 1 END) as from_cl
FROM vehicles
WHERE created_at > NOW() - INTERVAL '7 days';
```

## ⚙️ Configuration

### Adjust Discovery Schedule

To change when discovery runs:

```sql
SELECT cron.unschedule('cl-discover-squarebodies');

SELECT cron.schedule(
  'cl-discover-squarebodies',
  '0 3 * * *', -- Change to 3 AM
  $$...$$ -- Same command as before
);
```

### Adjust Processing Frequency

To process more frequently:

```sql
SELECT cron.unschedule('cl-process-queue');

SELECT cron.schedule(
  'cl-process-queue',
  '*/15 * * * *', -- Every 15 minutes instead of 30
  $$...$$ -- Same command as before
);
```

### Adjust Batch Size

Edit the cron job body to change `batch_size` (default: 15):

```sql
-- In the cron job body, change:
'batch_size', 15  -- To:
'batch_size', 20  -- Process 20 per run
```

## 🐛 Troubleshooting

### Cron Jobs Not Running

1. **Check if pg_cron is enabled:**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. **Check job status:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid IN (
     SELECT jobid FROM cron.job 
     WHERE jobname IN ('cl-discover-squarebodies', 'cl-process-queue')
   )
   ORDER BY start_time DESC
   LIMIT 10;
   ```

3. **Check for errors:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE status = 'failed'
   ORDER BY start_time DESC
   LIMIT 10;
   ```

### Service Role Key Not Set

If you see authentication errors:

```sql
-- Check if it's set:
SELECT current_setting('app.settings.service_role_key', true);

-- If NULL, set it:
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

### Queue Not Processing

1. **Check if there are pending items:**
   ```sql
   SELECT COUNT(*) FROM craigslist_listing_queue WHERE status = 'pending';
   ```

2. **Check for stuck "processing" items:**
   ```sql
   SELECT * FROM craigslist_listing_queue 
   WHERE status = 'processing' 
   AND updated_at < NOW() - INTERVAL '1 hour';
   ```

3. **Reset stuck items:**
   ```sql
   UPDATE craigslist_listing_queue
   SET status = 'pending', updated_at = NOW()
   WHERE status = 'processing' 
   AND updated_at < NOW() - INTERVAL '1 hour';
   ```

## 📈 Expected Performance

- **Discovery:** Finds 200-500 listings per day (depending on market activity)
- **Processing:** Processes 15 listings every 30 minutes = ~720 listings per day
- **Success Rate:** >90% (some listings will be skipped if not squarebodies)
- **Image Import:** >80% of listings have images

## 🔄 Manual Operations

### Clear Queue (if needed)

```sql
-- Clear all items
DELETE FROM craigslist_listing_queue;

-- Clear only failed items
DELETE FROM craigslist_listing_queue WHERE status = 'failed';

-- Clear old completed items (older than 30 days)
DELETE FROM craigslist_listing_queue 
WHERE status = 'complete' 
AND processed_at < NOW() - INTERVAL '30 days';
```

### Retry Failed Items

```sql
-- Reset failed items to pending (for retry)
UPDATE craigslist_listing_queue
SET status = 'pending', retry_count = 0, error_message = NULL
WHERE status = 'failed'
AND retry_count < max_retries;
```

## ✅ Success Criteria

After setup, you should see:

1. ✅ Queue table created
2. ✅ Two cron jobs scheduled
3. ✅ Discovery function finds listings daily
4. ✅ Processing function creates vehicles every 30 minutes
5. ✅ Vehicles appear in database with `discovery_source = 'craigslist_scrape'`
6. ✅ Images uploaded to Supabase Storage
7. ✅ Timeline events created for discoveries

---

**Last Updated:** January 2025  
**Status:** Ready for deployment

