-- Database Fill Accountability System
-- Tracks cycles, source health, and quality metrics

-- Fill cycles tracking
CREATE TABLE IF NOT EXISTS fill_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  vehicles_added INTEGER DEFAULT 0,
  vehicles_queued INTEGER DEFAULT 0,
  sources_active INTEGER DEFAULT 0,
  sources_discovered INTEGER DEFAULT 0,
  data_quality_score DECIMAL(3,2) DEFAULT 0,
  on_target BOOLEAN DEFAULT false,
  next_actions TEXT[] DEFAULT '{}',
  errors TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fill_cycles_started ON fill_cycles(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fill_cycles_on_target ON fill_cycles(on_target, started_at DESC);

-- Source health tracking
CREATE TABLE IF NOT EXISTS source_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES scrape_sources(id) ON DELETE CASCADE,
  cycle_id TEXT,
  vehicles_extracted INTEGER DEFAULT 0,
  success_rate DECIMAL(5,4) DEFAULT 0,
  error_rate DECIMAL(5,4) DEFAULT 0,
  avg_quality_score DECIMAL(3,2) DEFAULT 0,
  status TEXT DEFAULT 'unknown', -- 'healthy', 'degraded', 'failing', 'unknown'
  last_checked TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_health_source ON source_health(source_id, last_checked DESC);
CREATE INDEX IF NOT EXISTS idx_source_health_status ON source_health(status, last_checked DESC);

-- Quality metrics
CREATE TABLE IF NOT EXISTS quality_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id TEXT,
  field_name TEXT NOT NULL,
  completeness DECIMAL(5,4) DEFAULT 0, -- 0.0 to 1.0
  accuracy DECIMAL(5,4) DEFAULT 0, -- 0.0 to 1.0
  sample_size INTEGER DEFAULT 0,
  issues TEXT[] DEFAULT '{}',
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_quality_metrics_cycle ON quality_metrics(cycle_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_field ON quality_metrics(field_name, measured_at DESC);

-- Helper function: Get current cycle stats
CREATE OR REPLACE FUNCTION get_current_cycle_stats()
RETURNS TABLE (
  cycle_id TEXT,
  vehicles_added INTEGER,
  vehicles_queued INTEGER,
  total_progress INTEGER,
  target INTEGER,
  on_target BOOLEAN,
  data_quality DECIMAL,
  started_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fc.cycle_id,
    fc.vehicles_added,
    fc.vehicles_queued,
    (fc.vehicles_added + fc.vehicles_queued) as total_progress,
    2000 as target, -- TARGET_VEHICLES_PER_CYCLE
    fc.on_target,
    fc.data_quality_score,
    fc.started_at
  FROM fill_cycles fc
  ORDER BY fc.started_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Get daily summary
CREATE OR REPLACE FUNCTION get_daily_summary(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  date DATE,
  vehicles_added INTEGER,
  vehicles_queued INTEGER,
  cycles_completed INTEGER,
  cycles_on_target INTEGER,
  avg_quality DECIMAL,
  sources_active INTEGER,
  sources_discovered INTEGER,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p_date as date,
    COALESCE(SUM(fc.vehicles_added), 0)::INTEGER as vehicles_added,
    COALESCE(SUM(fc.vehicles_queued), 0)::INTEGER as vehicles_queued,
    COUNT(*)::INTEGER as cycles_completed,
    COUNT(*) FILTER (WHERE fc.on_target = true)::INTEGER as cycles_on_target,
    COALESCE(AVG(fc.data_quality_score), 0) as avg_quality,
    COALESCE(MAX(fc.sources_active), 0)::INTEGER as sources_active,
    COALESCE(SUM(fc.sources_discovered), 0)::INTEGER as sources_discovered,
    CASE 
      WHEN COALESCE(SUM(fc.vehicles_added), 0) >= 24000 THEN 'ON_TARGET'
      WHEN COALESCE(SUM(fc.vehicles_added), 0) >= 12000 THEN 'BELOW_TARGET'
      ELSE 'CRITICAL'
    END as status
  FROM fill_cycles fc
  WHERE DATE(fc.started_at) = p_date;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE fill_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_metrics ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON fill_cycles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON source_health FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON quality_metrics FOR ALL USING (auth.role() = 'service_role');

