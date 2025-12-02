# Set Up Daily Automated Craigslist Scraping

**Current Status:** Function works ✅ | No automation ❌

## What's Working Now

Your `scrape-all-craigslist-squarebodies` function is **deployed and functional**:
- ✅ Created 17 vehicles in past 7 days
- ✅ Just tested: found 25 listings, created 13 vehicles
- ✅ Scrapes Los Angeles, SF Bay, and other regions
- ❌ Only runs when manually triggered
- ❌ No daily automation

## Why Listings Are Being Missed

New listings (like those 3 today) aren't caught because there's no automated scraper running daily.

---

## 🚀 Set Up Daily Automation (2 Options)

### Option A: Supabase Cron Job (Recommended)

**Best for:** Reliable, no external dependencies

1. Go to [Supabase SQL Editor](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new)

2. Set your service role key:
   ```sql
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
   ```
   (Get key from: Settings → API → service_role)

3. Create daily cron job (runs at 2 AM):
   ```sql
   -- Enable pg_cron if not already enabled
   CREATE EXTENSION IF NOT EXISTS pg_cron;

   -- Remove existing job if it exists
   SELECT cron.unschedule('daily-cl-squarebody-scrape') WHERE EXISTS (
     SELECT 1 FROM cron.job WHERE jobname = 'daily-cl-squarebody-scrape'
   );

   -- Schedule daily scrape at 2 AM
   SELECT cron.schedule(
     'daily-cl-squarebody-scrape',
     '0 2 * * *', -- Every day at 2 AM
     $$
     SELECT
       net.http_post(
         url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
         ),
         body := jsonb_build_object(
           'max_regions', 100, -- All regions
           'max_listings_per_search', 100
         )
       ) AS request_id;
     $$
   );

   -- Verify it was created
   SELECT jobid, jobname, schedule, active 
   FROM cron.job 
   WHERE jobname = 'daily-cl-squarebody-scrape';
   ```

4. ✅ Done! Scraper will run daily at 2 AM

---

### Option B: GitHub Actions (Alternative)

**Best for:** More control, can see logs, can trigger manually

1. Create `.github/workflows/cl-scrape.yml`:
   ```yaml
   name: Craigslist Scrape

   on:
     schedule:
       - cron: '0 2 * * *'  # Daily at 2 AM UTC
     workflow_dispatch:  # Manual trigger button

   jobs:
     scrape:
       runs-on: ubuntu-latest
       timeout-minutes: 30
       
       steps:
         - name: Trigger Craigslist Scrape
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
           run: |
             echo "🔍 Starting Craigslist scrape..."
             
             RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
               "${SUPABASE_URL}/functions/v1/scrape-all-craigslist-squarebodies" \
               -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
               -H "Content-Type: application/json" \
               -d '{"max_regions":100,"max_listings_per_search":100}')
             
             HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
             BODY=$(echo "$RESPONSE" | sed '$d')
             
             if [ "$HTTP_CODE" -eq 200 ]; then
               echo "✅ Scrape successful (HTTP $HTTP_CODE)"
               echo "$BODY" | jq '.'
             else
               echo "❌ Scrape failed (HTTP $HTTP_CODE)"
               echo "$BODY"
               exit 1
             fi
   ```

2. Add secrets to GitHub repo:
   - Go to: Settings → Secrets → Actions
   - Add: `SUPABASE_URL` = https://qkgaybvrernstplzjaam.supabase.co
   - Add: `SUPABASE_SERVICE_ROLE_KEY` = (your key)

3. Commit and push - scraper will run daily at 2 AM

---

## 📊 Verify It's Running

### Check Cron Job Status (Supabase)
```sql
-- See scheduled jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'daily-cl-squarebody-scrape';

-- See recent runs
SELECT * FROM cron.job_run_details 
WHERE jobid = (
  SELECT jobid FROM cron.job 
  WHERE jobname = 'daily-cl-squarebody-scrape'
)
ORDER BY start_time DESC
LIMIT 10;
```

### Check Recent Vehicles
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as vehicles_created
FROM vehicles
WHERE discovery_source = 'craigslist_scrape'
AND created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## 🧪 Manual Trigger (For Testing)

### Supabase Dashboard
```sql
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  ),
  body := jsonb_build_object(
    'max_regions', 10, -- Test with 10 regions
    'max_listings_per_search', 50
  )
);
```

### Command Line
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_regions":10,"max_listings_per_search":50}'
```

---

## 📈 Expected Results

With daily automation:
- **200-500 listings** discovered per day
- **50-150 vehicles** created per day (after dedup)
- **Runs in ~30-60 minutes** (in the cloud)
- **Catches new listings** within 24 hours

---

## 🐛 Troubleshooting

### Scraper runs but finds few vehicles
- Check `max_regions` - increase for more coverage
- Check `max_listings_per_search` - increase to 100+
- Some regions may be empty

### Timeout errors
- Reduce `max_regions` to 50
- Split into 2 cron jobs (AM/PM)

### Missing specific listings
- Scraper searches specific terms (squarebody, C10, K10, etc.)
- Sellers must use those terms in title
- Some listings slip through if poorly titled

---

## ✅ Success Criteria

After setup:
1. ✅ Cron job scheduled and active
2. ✅ Scraper runs daily at 2 AM
3. ✅ 50+ vehicles created per day
4. ✅ New listings caught within 24 hours
5. ✅ Logs show successful runs

---

**Recommendation:** Use Supabase Cron (Option A) - simpler, more reliable, no external dependencies.

**Last Updated:** December 2, 2025
**Function Status:** WORKING ✅
**Automation Status:** NEEDS SETUP ⚠️

