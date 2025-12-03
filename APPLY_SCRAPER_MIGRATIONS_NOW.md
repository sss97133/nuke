# 🚀 Apply Scraper Infrastructure - DO THIS NOW

Your scraping infrastructure is **built and deployed**, but needs database migrations applied.

---

## ⚡ Quick Start (Copy/Paste This)

### 1. Open Supabase SQL Editor
**URL:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new

---

### 2. Apply Migration 1: Health Tracking Table

**Copy/paste this entire block:**

```sql
-- Scraping Health Tracking System
CREATE TABLE IF NOT EXISTS scraping_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  source TEXT NOT NULL,
  region TEXT,
  search_term TEXT,
  url TEXT,
  
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  error_type TEXT,
  response_time_ms INTEGER,
  
  data_extracted JSONB,
  images_found INTEGER DEFAULT 0,
  has_price BOOLEAN DEFAULT FALSE,
  has_location BOOLEAN DEFAULT FALSE,
  has_contact BOOLEAN DEFAULT FALSE,
  
  function_name TEXT,
  attempt_number INTEGER DEFAULT 1,
  retry_after_seconds INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_source CHECK (source IN (
    'craigslist', 'bat', 'bringatrailer', 'ksl', 'facebook_marketplace',
    'classiccars', 'affordableclassics', 'classic.com', 'goxee', 'ebay',
    'hemmings', 'cars.com', 'autotrader', 'cargurus'
  ))
);

CREATE INDEX IF NOT EXISTS idx_scraping_health_source_time ON scraping_health(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_health_failures ON scraping_health(source, success) WHERE success = FALSE;
CREATE INDEX IF NOT EXISTS idx_scraping_health_region ON scraping_health(region, created_at DESC) WHERE region IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scraping_health_recent ON scraping_health(created_at DESC);

ALTER TABLE scraping_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON scraping_health
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Admins can read" ON scraping_health
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND is_admin = true
    )
  );
```

**Click "RUN" → Should see "Success. No rows returned"**

---

### 3. Apply Migration 2: Helper Functions

**Copy/paste this:**

```sql
-- Get health stats for a source
CREATE OR REPLACE FUNCTION get_source_health_stats(
  p_source TEXT,
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  total_attempts INTEGER,
  successful_attempts INTEGER,
  failed_attempts INTEGER,
  success_rate NUMERIC,
  avg_response_ms NUMERIC,
  common_errors TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT *
    FROM scraping_health
    WHERE source = p_source
    AND created_at > NOW() - (p_hours || ' hours')::INTERVAL
  )
  SELECT 
    COUNT(*)::INTEGER as total_attempts,
    COUNT(*) FILTER (WHERE success)::INTEGER as successful_attempts,
    COUNT(*) FILTER (WHERE NOT success)::INTEGER as failed_attempts,
    ROUND(
      (COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100),
      2
    ) as success_rate,
    ROUND(AVG(response_time_ms)::NUMERIC, 0) as avg_response_ms,
    ARRAY_AGG(DISTINCT error_message) FILTER (WHERE error_message IS NOT NULL) as common_errors
  FROM recent;
END;
$$ LANGUAGE plpgsql;

-- Check if source is healthy
CREATE OR REPLACE FUNCTION is_source_healthy(
  p_source TEXT,
  p_min_success_rate NUMERIC DEFAULT 90.0
)
RETURNS BOOLEAN AS $$
DECLARE
  v_success_rate NUMERIC;
BEGIN
  SELECT success_rate INTO v_success_rate
  FROM get_source_health_stats(p_source, 24);
  
  RETURN COALESCE(v_success_rate >= p_min_success_rate, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Get all sources health summary
CREATE OR REPLACE FUNCTION get_all_sources_health()
RETURNS TABLE (
  source TEXT,
  total_attempts INTEGER,
  success_rate NUMERIC,
  status TEXT,
  last_success TIMESTAMPTZ,
  last_failure TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sh.source,
    COUNT(*)::INTEGER as total_attempts,
    ROUND(
      (COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100),
      1
    ) as success_rate,
    CASE 
      WHEN ROUND((COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 1) >= 90 THEN 'healthy'
      WHEN ROUND((COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 1) >= 70 THEN 'degraded'
      ELSE 'failing'
    END as status,
    MAX(sh.created_at) FILTER (WHERE success) as last_success,
    MAX(sh.created_at) FILTER (WHERE NOT success) as last_failure
  FROM scraping_health sh
  WHERE sh.created_at > NOW() - INTERVAL '24 hours'
  GROUP BY sh.source
  ORDER BY total_attempts DESC;
END;
$$ LANGUAGE plpgsql;
```

**Click "RUN"**

---

### 4. Set Service Role Key (ONE TIME)

**Copy/paste with YOUR key:**

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
```

(Get key from: [Settings → API](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api) → service_role)

---

### 5. Apply Migration 3: Daily Scraping Cron

**Copy/paste this:**

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('daily-craigslist-squarebodies') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-craigslist-squarebodies'
);

SELECT cron.schedule(
  'daily-craigslist-squarebodies',
  '0 2 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_regions', 100,
        'max_listings_per_search', 100
      ),
      timeout_milliseconds := 900000
    ) AS request_id;
  $$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'daily-craigslist-squarebodies';
```

**Should see:** 1 row with jobname `daily-craigslist-squarebodies`

---

### 6. Apply Migration 4: Health Monitoring Cron

**Copy/paste this:**

```sql
SELECT cron.unschedule('hourly-scraper-health-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hourly-scraper-health-check'
);

SELECT cron.schedule(
  'hourly-scraper-health-check',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/check-scraper-health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      timeout_milliseconds := 30000
    ) AS request_id;
  $$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'hourly-scraper-health-check';
```

**Should see:** 1 row with jobname `hourly-scraper-health-check`

---

## ✅ Verify Setup

**Run this in SQL Editor:**

```sql
-- 1. Check table exists
SELECT COUNT(*) as health_records FROM scraping_health;

-- 2. Check cron jobs
SELECT jobname, schedule, active FROM cron.job 
WHERE jobname IN ('daily-craigslist-squarebodies', 'hourly-scraper-health-check');

-- 3. Check service key is set
SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL as key_is_set;
```

**Expected:**
- health_records: 0 (table is empty, ready to use)
- 2 cron jobs showing
- key_is_set: true

---

## 🧪 Test It Works

**Run in terminal:**

```bash
cd /Users/skylar/nuke
node scripts/test-scraper-system.js
```

**Should show:**
- ✅ Health table exists
- ✅ Scraper working
- ✅ Health tracking working
- ✅ Vehicles being created

---

## 🎯 What You Get

### Real-Time Monitoring:
```sql
-- Check scraper health RIGHT NOW
SELECT * FROM get_all_sources_health();

-- Example output:
-- craigslist | 247 | 96.3% | healthy  | 2025-12-02 10:15:00 | 2025-12-02 09:42:00
-- bat        |  12 | 100%  | healthy  | 2025-12-02 10:10:00 | NULL
-- ksl        |  18 | 55.6% | degraded | 2025-12-02 09:30:00 | 2025-12-02 10:05:00
```

### Automatic Alerts:
- Scraper fails >15% → Warning notification
- Scraper fails >30% → Critical notification
- Hourly health check → Auto-detect issues

### Daily Automation:
- Runs at 2 AM daily
- No manual intervention needed
- Catches all new listings automatically

---

**Total time: 5 minutes to copy/paste 6 SQL blocks**

**Then:** Your wild west sources are LOCKED DOWN. 🔒

