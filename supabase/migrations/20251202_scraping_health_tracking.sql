-- Scraping Health Tracking System
-- Tracks every scrape attempt to monitor reliability and detect failures

-- ============================================
-- SCRAPING HEALTH LOG
-- ============================================

CREATE TABLE IF NOT EXISTS scraping_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHAT WAS SCRAPED
  source TEXT NOT NULL,  -- 'craigslist', 'bat', 'ksl', 'facebook_marketplace', etc.
  region TEXT,           -- For regional sources like Craigslist
  search_term TEXT,      -- Search query used (if applicable)
  url TEXT,              -- Specific URL attempted
  
  -- RESULT
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  error_type TEXT,  -- 'timeout', 'bot_protection', 'not_found', 'network', 'parse_error'
  response_time_ms INTEGER,
  
  -- DATA QUALITY
  data_extracted JSONB,  -- What was extracted (for validation)
  images_found INTEGER DEFAULT 0,
  has_price BOOLEAN DEFAULT FALSE,
  has_location BOOLEAN DEFAULT FALSE,
  has_contact BOOLEAN DEFAULT FALSE,
  
  -- CONTEXT
  function_name TEXT,    -- Which edge function ran this
  attempt_number INTEGER DEFAULT 1,
  retry_after_seconds INTEGER,  -- If rate limited, how long to wait
  
  -- TRACKING
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_source CHECK (source IN (
    'craigslist', 'bat', 'bringatrailer', 'ksl', 'facebook_marketplace',
    'classiccars', 'affordableclassics', 'classic.com', 'goxee', 'ebay',
    'hemmings', 'cars.com', 'autotrader', 'cargurus'
  ))
);

-- Indexes for performance
CREATE INDEX idx_scraping_health_source_time ON scraping_health(source, created_at DESC);
CREATE INDEX idx_scraping_health_failures ON scraping_health(source, success) WHERE success = FALSE;
CREATE INDEX idx_scraping_health_region ON scraping_health(region, created_at DESC) WHERE region IS NOT NULL;
CREATE INDEX idx_scraping_health_recent ON scraping_health(created_at DESC);

-- Enable RLS
ALTER TABLE scraping_health ENABLE ROW LEVEL SECURITY;

-- Policies
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

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

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

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE scraping_health IS 'Tracks every scraping attempt to monitor reliability and detect failures';
COMMENT ON COLUMN scraping_health.success IS 'Whether the scrape attempt succeeded';
COMMENT ON COLUMN scraping_health.error_type IS 'Category of error: timeout, bot_protection, not_found, network, parse_error';
COMMENT ON COLUMN scraping_health.response_time_ms IS 'How long the request took in milliseconds';

