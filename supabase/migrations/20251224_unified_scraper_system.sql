-- Unified Scraper System - Accountability Tables

-- Scraper runs tracking
CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  sources_checked INTEGER DEFAULT 0,
  sources_scraped INTEGER DEFAULT 0,
  queue_processed INTEGER DEFAULT 0,
  vehicles_added INTEGER DEFAULT 0,
  issues TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'success', -- 'success', 'partial', 'failed'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_started ON scraper_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_status ON scraper_runs(status, started_at DESC);

-- Ensure scrape_sources has required fields
ALTER TABLE scrape_sources 
  ADD COLUMN IF NOT EXISTS scraper_function TEXT DEFAULT 'scrape-multi-source',
  ADD COLUMN IF NOT EXISTS last_successful_scrape TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scrape_sources_scraper_function ON scrape_sources(scraper_function);
CREATE INDEX IF NOT EXISTS idx_scrape_sources_last_scrape ON scrape_sources(last_successful_scrape DESC NULLS LAST);

-- View: Source health summary
CREATE OR REPLACE VIEW source_health_summary AS
SELECT 
  ss.id,
  ss.domain,
  ss.source_name,
  ss.scraper_function,
  ss.is_active,
  ss.last_successful_scrape,
  sm.coverage_percentage as site_map_coverage,
  sm.status as site_map_status,
  (SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status = 'pending') as queue_pending,
  (SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status = 'complete') as queue_complete,
  (SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status = 'failed') as queue_failed,
  CASE 
    WHEN sm.coverage_percentage < 95 OR sm.status != 'complete' THEN 'unmapped'
    WHEN (SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status = 'failed')::float / 
         NULLIF((SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status IN ('complete', 'failed')), 0) > 0.5 THEN 'failing'
    WHEN (SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status = 'failed')::float / 
         NULLIF((SELECT COUNT(*) FROM import_queue WHERE source_id = ss.id AND status IN ('complete', 'failed')), 0) > 0.2 THEN 'degraded'
    ELSE 'healthy'
  END as health_status
FROM scrape_sources ss
LEFT JOIN site_maps sm ON sm.source_id = ss.id;

-- View: Queue metrics
CREATE OR REPLACE VIEW queue_metrics AS
SELECT 
  status,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24_hours,
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time_seconds
FROM import_queue
GROUP BY status;

-- View: Recent activity
CREATE OR REPLACE VIEW recent_scraper_activity AS
SELECT 
  sr.cycle_id,
  sr.started_at,
  sr.completed_at,
  sr.sources_scraped,
  sr.queue_processed,
  sr.vehicles_added,
  sr.status,
  sr.issues
FROM scraper_runs sr
ORDER BY sr.started_at DESC
LIMIT 10;

-- Enable RLS
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON scraper_runs FOR ALL USING (auth.role() = 'service_role');

