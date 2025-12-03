# 🔒 Scraper Infrastructure - Locked Down & Secure

**Status:** Edge functions deployed ✅ | Migrations ready ⚠️ | Testing pending ⏳

## What Was Built

### 1. **Health Tracking System** ✅
Monitors every scrape attempt to detect failures and measure reliability.

**Database Table:** `scraping_health`
- Tracks success/failure for every fetch
- Records response times
- Categorizes error types (timeout, bot_protection, network, etc.)
- Stores data quality metrics (images_found, has_price, etc.)

**Helper Functions:**
- `get_source_health_stats(source, hours)` - Get success rate for a source
- `is_source_healthy(source, min_rate)` - Boolean health check
- `get_all_sources_health()` - Summary of all sources

### 2. **Health Monitoring Function** ✅
**Deployed:** `check-scraper-health`

Runs hourly to:
- Check all source health (Craigslist, BaT, KSL, etc.)
- Calculate success rates
- Detect degraded sources (<90% success)
- Create admin alerts when things break

### 3. **Updated Craigslist Scraper** ✅
**Deployed:** `scrape-all-craigslist-squarebodies` (v78)

Now tracks:
- Every search attempt (region + search term)
- Response times
- Success/failure with error categorization
- Automatic admin alerts when failure rate >15%

### 4. **Automated Daily Scraping** ⏳
**Migration ready:** `20251202_daily_craigslist_cron.sql`

Runs daily at 2 AM:
- Scrapes 100+ Craigslist regions
- Processes 100 listings per search
- Automatically creates vehicles
- Downloads images

### 5. **Automated Health Checks** ⏳
**Migration ready:** `20251202_scraper_health_cron.sql`

Runs every hour:
- Checks source health
- Creates alerts if degraded
- Tracks trends over time

---

## 📋 Apply Migrations (5 Minutes)

### Quick Start:
```bash
cd /Users/skylar/nuke
node scripts/apply-scraper-infrastructure.js
```

This will show you exactly what to paste into Supabase Dashboard SQL Editor.

### Manual Steps:

1. **Open [Supabase SQL Editor](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new)**

2. **Apply migrations in order:**
   - `20251202_scraping_health_tracking.sql` (health table)
   - Set service role key (see below)
   - `20251202_daily_craigslist_cron.sql` (daily scraping)
   - `20251202_scraper_health_cron.sql` (health monitoring)

3. **Set service role key (one time):**
   ```sql
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
   ```
   (Get from: Settings → API → service_role key)

---

## 🧪 Test Everything

### Run Full System Test:
```bash
cd /Users/skylar/nuke
node scripts/test-scraper-system.js
```

This will:
- ✅ Verify health table exists
- ✅ Trigger test scrape
- ✅ Check health tracking is working
- ✅ Test health check function
- ✅ Verify vehicles are being created

### Manual Test Scrape:
```bash
# Scrape right now (small test)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: 'application/json" \
  -d '{"max_regions":1,"max_listings_per_search":10}'
```

### Check Health:
```bash
# Get health report
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/check-scraper-health" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" | jq '.'
```

---

## 📊 Monitoring Queries

### Daily Health Check:
```sql
-- View health summary (last 24h)
SELECT * FROM get_all_sources_health();
```

### Detailed Source Stats:
```sql
-- Craigslist health
SELECT * FROM get_source_health_stats('craigslist', 24);

-- BaT health  
SELECT * FROM get_source_health_stats('bat', 24);

-- KSL health
SELECT * FROM get_source_health_stats('ksl', 24);
```

### Recent Failures:
```sql
SELECT 
  source,
  region,
  search_term,
  error_message,
  error_type,
  created_at
FROM scraping_health
WHERE success = FALSE
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;
```

### Success Rate Trend:
```sql
SELECT 
  DATE(created_at) as date,
  source,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE success) as succeeded,
  ROUND(
    COUNT(*) FILTER (WHERE success)::NUMERIC / COUNT(*) * 100,
    1
  ) as success_rate
FROM scraping_health
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at), source
ORDER BY date DESC, source;
```

---

## 🚨 Alert System

### How Alerts Work:

1. **Scraper runs** → Records health data
2. **If failure rate >15%** → Creates admin notification
3. **If failure rate >30%** → Creates CRITICAL notification
4. **Health check runs hourly** → Re-evaluates all sources
5. **Degraded sources** → Additional notifications

### View Alerts:
```sql
SELECT 
  type,
  severity,
  title,
  message,
  metadata,
  created_at
FROM admin_notifications
WHERE type LIKE '%scraper%'
ORDER BY created_at DESC
LIMIT 10;
```

### Mark as Read:
```sql
UPDATE admin_notifications
SET is_read = TRUE
WHERE type LIKE '%scraper%';
```

---

## 📈 Expected Performance

### Healthy Metrics:
- **Craigslist:** >95% success rate, <2s avg response
- **BaT:** 100% success rate, <3s avg response
- **KSL:** >70% success rate (has bot protection)

### Daily Scraping:
- **Listings found:** 200-500 per day
- **Vehicles created:** 50-150 per day (after dedup)
- **Run time:** 30-60 minutes (in cloud)
- **Images downloaded:** 1,000-3,000 per day

---

## 🐛 Troubleshooting

### Health table not tracking?
```sql
-- Check if table exists
\d scraping_health

-- Check permissions
SELECT * FROM information_schema.table_privileges 
WHERE table_name = 'scraping_health';
```

### Cron jobs not running?
```sql
-- Check jobs exist
SELECT * FROM cron.job;

-- Check recent runs
SELECT * FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 10;

-- Check service key is set
SELECT current_setting('app.settings.service_role_key', true);
```

### Scraper failing?
```sql
-- Get failure details
SELECT error_type, COUNT(*) 
FROM scraping_health
WHERE success = FALSE
GROUP BY error_type
ORDER BY COUNT(*) DESC;

-- Common errors
SELECT error_message, COUNT(*)
FROM scraping_health
WHERE success = FALSE
GROUP BY error_message
ORDER BY COUNT(*) DESC
LIMIT 10;
```

---

## 🔧 Quick Commands

### Trigger Scrape Now:
```bash
cd /Users/skylar/nuke
./scripts/scrape-cl-now.sh
```

### Check Health:
```bash
cd /Users/skylar/nuke  
node scripts/test-scraper-system.js
```

### View Recent Activity:
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) FILTER (WHERE discovery_source = 'craigslist_scrape') as cl_vehicles,
  COUNT(*) as total_vehicles
FROM vehicles
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## ✅ Success Criteria

After setup, you should have:

1. ✅ `scraping_health` table exists and tracking
2. ✅ `check-scraper-health` function deployed and working
3. ✅ Updated Craigslist scraper with health tracking
4. ✅ Daily scraping cron job scheduled (2 AM)
5. ✅ Hourly health check cron job scheduled
6. ✅ Admin alerts working when sources degrade
7. ✅ 50-150 vehicles created per day automatically

---

## 📖 Files Created

**Migrations:**
- `supabase/migrations/20251202_scraping_health_tracking.sql`
- `supabase/migrations/20251202_daily_craigslist_cron.sql`
- `supabase/migrations/20251202_scraper_health_cron.sql`

**Functions:**
- `supabase/functions/check-scraper-health/` (deployed)
- Updated: `supabase/functions/scrape-all-craigslist-squarebodies/` (deployed v78)

**Scripts:**
- `scripts/apply-scraper-infrastructure.js` (setup guide)
- `scripts/test-scraper-system.js` (test suite)
- `scripts/scrape-cl-now.sh` (manual trigger)

---

**Last Updated:** December 2, 2025  
**Status:** Functions deployed, migrations ready to apply  
**Next:** Apply migrations → Test → Monitor

---

**Wild West sources: LOCKED DOWN** 🔒

