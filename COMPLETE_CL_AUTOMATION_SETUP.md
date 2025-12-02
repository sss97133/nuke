# Complete Craigslist Automation Setup

**Status:** Edge functions deployed ✅ | Database setup needed ❌

## What You Have Now

Your automated Craigslist listing detection system was **built but never activated**. Here's what exists:

- ✅ Edge functions deployed (just now):
  - `discover-cl-squarebodies` - Finds new listings
  - `process-cl-queue` - Scrapes and creates vehicles
- ✅ `scrape-vehicle` function - Already deployed, handles individual listings
- ✅ Migration files exist in `supabase/migrations/`

## What's Missing

1. **Queue table** - Stores discovered listings
2. **Cron jobs** - Automated scheduling

---

## 📋 Manual Setup Steps (5 minutes)

### Step 1: Apply Queue Table Migration

1. Open [Supabase Dashboard SQL Editor](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new)
2. Copy/paste contents of: `supabase/migrations/20250129_create_cl_listing_queue.sql`
3. Click "Run" button
4. ✅ You should see "Success. No rows returned"

### Step 2: Apply Cron Jobs Migration

1. **IMPORTANT:** First, get your service role key:
   - Go to [Settings → API](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api)
   - Copy the **service_role** key (keep it secret!)

2. In SQL Editor, run:
   ```sql
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
   ```

3. Copy/paste contents of: `supabase/migrations/20250129_setup_cl_scraping_cron.sql`
4. Click "Run"
5. ✅ You should see 2 cron jobs created

### Step 3: Verify Setup

Run this in SQL Editor:
```sql
-- Check queue table exists
SELECT * FROM craigslist_listing_queue LIMIT 1;

-- Check cron jobs are scheduled
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname IN ('cl-discover-squarebodies', 'cl-process-queue');
```

---

## 🧪 Test with Your 3 URLs

Once setup is complete, test with your three Craigslist URLs:

```bash
cd /Users/skylar/nuke
node scripts/test-cl-automation.js
```

This will:
1. Insert your 3 URLs into the queue
2. Call `process-cl-queue` to scrape them
3. Create vehicles (if they're squarebodies)
4. Download/upload images
5. Show results

---

## 📊 How the System Works

### Discovery (Daily at 2 AM):
```
discover-cl-squarebodies
  ↓
Searches all Craigslist regions for:
  - "squarebody", "C10", "K10"
  - "1973-1991 chevrolet truck"
  - "1973-1991 GMC truck"
  - etc.
  ↓
Adds unique URLs to queue table
  (status: 'pending')
```

### Processing (Every 30 Minutes):
```
process-cl-queue
  ↓
Gets 15 pending listings from queue
  ↓
For each listing:
  1. Call scrape-vehicle function
  2. Extract vehicle data
  3. Check if squarebody (1973-1991 Chevy/GMC)
  4. Create vehicle or skip
  5. Download images
  6. Upload to Supabase Storage
  7. Mark queue item: complete/failed/skipped
  ↓
Stats returned: { processed: 15, created: 8, skipped: 5, failed: 2 }
```

---

## 📈 Expected Performance

- **Discovery:** 200-500 listings/day (market dependent)
- **Processing:** 720 listings/day (15 every 30 min)
- **Success Rate:** >90% (some listings fail due to 403/robots.txt)
- **Image Import:** >80% of listings have images

---

## 🔍 Monitoring

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

### Check Cron Job Logs
```sql
SELECT * FROM cron.job_run_details 
WHERE jobid IN (
  SELECT jobid FROM cron.job 
  WHERE jobname IN ('cl-discover-squarebodies', 'cl-process-queue')
)
ORDER BY start_time DESC
LIMIT 10;
```

---

## 🛠️ Manual Operations

### Trigger Discovery Now (Test)
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

### Trigger Processing Now (Test)
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

### Clear Queue (if needed)
```sql
-- Clear all items
DELETE FROM craigslist_listing_queue;

-- Clear only failed items
DELETE FROM craigslist_listing_queue WHERE status = 'failed';

-- Retry failed items
UPDATE craigslist_listing_queue
SET status = 'pending', retry_count = 0, error_message = NULL
WHERE status = 'failed'
AND retry_count < max_retries;
```

---

## 🐛 Troubleshooting

### Queue Not Processing
1. **Check pending items:**
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

### Cron Jobs Not Running
1. **Check pg_cron extension:**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. **Check job status:**
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE status = 'failed'
   ORDER BY start_time DESC
   LIMIT 10;
   ```

---

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

**Last Updated:** December 2, 2025  
**Edge Functions:** DEPLOYED ✅  
**Database Setup:** REQUIRED ⚠️

---

## 📖 See Also

- `SETUP_CL_SQUAREBODY_SCRAPING.md` - Original setup guide
- `supabase/functions/discover-cl-squarebodies/` - Discovery function code
- `supabase/functions/process-cl-queue/` - Processing function code
- `supabase/functions/scrape-vehicle/` - Individual listing scraper

---

**Ready to activate?** Follow Steps 1-3 above, then run the test script!

