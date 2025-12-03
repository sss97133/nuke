-- ============================================
-- PASTE THIS ENTIRE FILE IN SUPABASE SQL EDITOR
-- https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new
-- ============================================

-- 1. CREATE HEALTH TABLE
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraping_health_source_time ON scraping_health(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_health_failures ON scraping_health(source, success) WHERE success = FALSE;
CREATE INDEX IF NOT EXISTS idx_scraping_health_recent ON scraping_health(created_at DESC);

ALTER TABLE scraping_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role full access" ON scraping_health FOR ALL USING (auth.role() = 'service_role');

-- 2. CREATE HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION get_all_sources_health()
RETURNS TABLE (
  source TEXT,
  total_attempts INTEGER,
  success_rate NUMERIC,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sh.source,
    COUNT(*)::INTEGER as total_attempts,
    ROUND((COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 1) as success_rate,
    CASE 
      WHEN ROUND((COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 1) >= 90 THEN 'healthy'
      WHEN ROUND((COUNT(*) FILTER (WHERE success)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 1) >= 70 THEN 'degraded'
      ELSE 'failing'
    END as status
  FROM scraping_health sh
  WHERE sh.created_at > NOW() - INTERVAL '24 hours'
  GROUP BY sh.source
  ORDER BY total_attempts DESC;
END;
$$ LANGUAGE plpgsql;

-- 3. SET SERVICE KEY (REPLACE WITH YOUR KEY!)
ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

-- 4. SETUP DAILY SCRAPING
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('daily-craigslist-squarebodies') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-craigslist-squarebodies'
);

SELECT cron.schedule(
  'daily-craigslist-squarebodies',
  '0 2 * * *',
  $$SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
      body := jsonb_build_object('max_regions', 100, 'max_listings_per_search', 100),
      timeout_milliseconds := 900000
    );$$
);

-- 5. SETUP HEALTH MONITORING
SELECT cron.schedule(
  'hourly-scraper-health-check',
  '0 * * * *',
  $$SELECT net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/check-scraper-health',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
      timeout_milliseconds := 30000
    );$$
);

-- 6. VERIFY
SELECT 'Health table created' as status, COUNT(*) as rows FROM scraping_health
UNION ALL
SELECT 'Cron jobs created', COUNT(*) FROM cron.job WHERE jobname IN ('daily-craigslist-squarebodies', 'hourly-scraper-health-check');

