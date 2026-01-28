-- Source Census System
-- Tracks universe size and completeness for each data source
-- Created: 2026-01-27

-- ============================================================================
-- 1. SOURCE CENSUS TABLE
-- Stores point-in-time counts of what exists at each source
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_census (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES observation_sources(id) ON DELETE CASCADE,

  -- Universe counts
  universe_total INTEGER,                -- Total items at source
  universe_active INTEGER,               -- Currently live/active
  universe_historical INTEGER,           -- Completed/sold/archived

  -- How we counted
  census_method TEXT NOT NULL,           -- 'sitemap', 'api', 'pagination', 'rss', 'estimate', 'manual'
  census_confidence DECIMAL(3,2),        -- 0.00-1.00 confidence in count
  census_url TEXT,                       -- URL/endpoint used to count
  census_notes TEXT,                     -- Any relevant notes

  -- Timing
  census_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  census_duration_ms INTEGER,            -- How long the census took
  next_census_at TIMESTAMPTZ,            -- When to recount

  -- Segment breakdowns (flexible JSONB)
  by_year JSONB DEFAULT '{}',            -- {"2024": 1200, "2023": 1500}
  by_make JSONB DEFAULT '{}',            -- {"Porsche": 8000, "Ferrari": 3000}
  by_category JSONB DEFAULT '{}',        -- {"auction": 5000, "classified": 2000}
  raw_response JSONB,                    -- Store raw census data for debugging

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure we can query latest census per source efficiently
  CONSTRAINT source_census_unique_timestamp UNIQUE (source_id, census_at)
);

-- Index for fast lookup of latest census per source
CREATE INDEX IF NOT EXISTS idx_source_census_source_latest
  ON source_census (source_id, census_at DESC);

-- ============================================================================
-- 2. COVERAGE TARGETS TABLE
-- Defines what "complete" means for each source/segment
-- ============================================================================

CREATE TABLE IF NOT EXISTS coverage_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES observation_sources(id) ON DELETE CASCADE,

  -- What segment this target applies to
  segment_type TEXT NOT NULL DEFAULT 'all',  -- 'all', 'make', 'year', 'year_range', 'category'
  segment_value TEXT,                         -- 'Porsche', '2020', '1960-1970', null for 'all'

  -- Targets
  target_coverage_pct DECIMAL(5,2),          -- 95.00 = want 95% of universe
  target_freshness_hours INTEGER,            -- Data should be < X hours old
  target_extraction_hours INTEGER,           -- New items extracted within X hours

  -- Priority for resource allocation
  priority INTEGER DEFAULT 50,               -- Higher = more important

  -- Status
  is_active BOOLEAN DEFAULT true,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT coverage_targets_unique UNIQUE (source_id, segment_type, segment_value)
);

-- ============================================================================
-- 3. HELPER FUNCTION: Get latest census for a source
-- ============================================================================

CREATE OR REPLACE FUNCTION get_latest_census(p_source_slug TEXT)
RETURNS TABLE (
  source_slug TEXT,
  universe_total INTEGER,
  universe_active INTEGER,
  census_method TEXT,
  census_confidence DECIMAL(3,2),
  census_at TIMESTAMPTZ,
  age_hours DECIMAL(10,2)
)
LANGUAGE sql STABLE
AS $$
  SELECT
    os.slug,
    sc.universe_total,
    sc.universe_active,
    sc.census_method,
    sc.census_confidence,
    sc.census_at,
    EXTRACT(EPOCH FROM (NOW() - sc.census_at)) / 3600 as age_hours
  FROM observation_sources os
  JOIN source_census sc ON sc.source_id = os.id
  WHERE os.slug = p_source_slug
  ORDER BY sc.census_at DESC
  LIMIT 1;
$$;

-- ============================================================================
-- 4. VIEW: Source Completeness Dashboard
-- Real-time view of coverage across all sources
-- ============================================================================

CREATE OR REPLACE VIEW source_completeness AS
WITH latest_census AS (
  SELECT DISTINCT ON (source_id)
    source_id,
    universe_total,
    universe_active,
    universe_historical,
    census_method,
    census_confidence,
    census_at,
    by_year,
    by_make
  FROM source_census
  ORDER BY source_id, census_at DESC
),
source_counts AS (
  SELECT
    vo.source_id,
    COUNT(DISTINCT vo.vehicle_id) as vehicles_observed,
    COUNT(DISTINCT vo.id) as total_observations,
    MAX(vo.observed_at) as latest_observation,
    MIN(vo.observed_at) as earliest_observation
  FROM vehicle_observations vo
  GROUP BY vo.source_id
)
SELECT
  os.slug,
  os.display_name,
  os.category,
  os.base_trust_score,

  -- Census data
  lc.universe_total,
  lc.universe_active,
  lc.census_method,
  lc.census_confidence,
  lc.census_at,
  EXTRACT(EPOCH FROM (NOW() - lc.census_at)) / 3600 as census_age_hours,

  -- Our coverage
  COALESCE(sc.vehicles_observed, 0) as vehicles_observed,
  COALESCE(sc.total_observations, 0) as total_observations,

  -- Completeness calculation
  CASE
    WHEN lc.universe_total IS NULL THEN NULL
    WHEN lc.universe_total = 0 THEN 100.00
    ELSE ROUND(100.0 * COALESCE(sc.vehicles_observed, 0) / lc.universe_total, 2)
  END as completeness_pct,

  -- Gap
  CASE
    WHEN lc.universe_total IS NULL THEN NULL
    ELSE lc.universe_total - COALESCE(sc.vehicles_observed, 0)
  END as gap,

  -- Freshness
  sc.latest_observation,
  EXTRACT(EPOCH FROM (NOW() - sc.latest_observation)) / 3600 as data_age_hours,

  -- Segments
  lc.by_year,
  lc.by_make

FROM observation_sources os
LEFT JOIN latest_census lc ON lc.source_id = os.id
LEFT JOIN source_counts sc ON sc.source_id = os.id
ORDER BY COALESCE(sc.vehicles_observed, 0) DESC;

-- ============================================================================
-- 5. VIEW: Coverage Gaps (sources needing attention)
-- ============================================================================

CREATE OR REPLACE VIEW coverage_gaps AS
SELECT
  sc.slug,
  sc.display_name,
  sc.universe_total,
  sc.vehicles_observed,
  sc.completeness_pct,
  sc.gap,
  sc.census_age_hours,
  sc.data_age_hours,
  ct.target_coverage_pct,
  ct.target_freshness_hours,
  ct.priority,

  -- Gap analysis
  CASE
    WHEN sc.completeness_pct IS NULL THEN 'no_census'
    WHEN sc.completeness_pct < COALESCE(ct.target_coverage_pct, 80) THEN 'below_target'
    ELSE 'on_target'
  END as coverage_status,

  CASE
    WHEN sc.data_age_hours IS NULL THEN 'no_data'
    WHEN sc.data_age_hours > COALESCE(ct.target_freshness_hours, 168) THEN 'stale'
    ELSE 'fresh'
  END as freshness_status

FROM source_completeness sc
LEFT JOIN coverage_targets ct ON ct.source_id = (
  SELECT id FROM observation_sources WHERE slug = sc.slug
) AND ct.segment_type = 'all'
WHERE sc.universe_total IS NOT NULL
  AND (sc.completeness_pct < 90 OR sc.data_age_hours > 24)
ORDER BY ct.priority DESC NULLS LAST, sc.gap DESC NULLS LAST;

-- ============================================================================
-- 6. FUNCTION: Record a census result
-- ============================================================================

CREATE OR REPLACE FUNCTION record_census(
  p_source_slug TEXT,
  p_universe_total INTEGER,
  p_universe_active INTEGER DEFAULT NULL,
  p_census_method TEXT DEFAULT 'manual',
  p_census_confidence DECIMAL(3,2) DEFAULT 0.80,
  p_census_url TEXT DEFAULT NULL,
  p_by_year JSONB DEFAULT '{}',
  p_by_make JSONB DEFAULT '{}',
  p_raw_response JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id UUID;
  v_census_id UUID;
BEGIN
  -- Get source ID
  SELECT id INTO v_source_id
  FROM observation_sources
  WHERE slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'Source not found: %', p_source_slug;
  END IF;

  -- Insert census record
  INSERT INTO source_census (
    source_id,
    universe_total,
    universe_active,
    universe_historical,
    census_method,
    census_confidence,
    census_url,
    by_year,
    by_make,
    raw_response,
    next_census_at
  ) VALUES (
    v_source_id,
    p_universe_total,
    p_universe_active,
    p_universe_total - COALESCE(p_universe_active, 0),
    p_census_method,
    p_census_confidence,
    p_census_url,
    p_by_year,
    p_by_make,
    p_raw_response,
    NOW() + INTERVAL '24 hours'  -- Default: recount daily
  )
  RETURNING id INTO v_census_id;

  RETURN v_census_id;
END;
$$;

-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

ALTER TABLE source_census ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_targets ENABLE ROW LEVEL SECURITY;

-- Public read for census data (it's not sensitive)
CREATE POLICY "Public read source_census" ON source_census
  FOR SELECT USING (true);

CREATE POLICY "Service role insert source_census" ON source_census
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public read coverage_targets" ON coverage_targets
  FOR SELECT USING (true);

CREATE POLICY "Service role manage coverage_targets" ON coverage_targets
  FOR ALL USING (true);

-- ============================================================================
-- 8. SEED DEFAULT COVERAGE TARGETS
-- ============================================================================

INSERT INTO coverage_targets (source_id, segment_type, target_coverage_pct, target_freshness_hours, priority, notes)
SELECT
  id,
  'all',
  90.00,  -- Want 90% coverage
  168,    -- Data fresh within 1 week
  CASE slug
    WHEN 'bat' THEN 100
    WHEN 'cars-and-bids' THEN 90
    WHEN 'mecum' THEN 85
    WHEN 'pcarmarket' THEN 80
    WHEN 'rm-sothebys' THEN 75
    WHEN 'bonhams' THEN 70
    WHEN 'gooding' THEN 70
    WHEN 'barrett-jackson' THEN 65
    ELSE 50
  END,
  'Default target - adjust based on source importance'
FROM observation_sources
WHERE category IN ('auction', 'marketplace')
ON CONFLICT (source_id, segment_type, segment_value) DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE source_census IS 'Point-in-time counts of total items at each data source. Run censuses periodically to track universe size.';
COMMENT ON TABLE coverage_targets IS 'Defines completeness goals per source/segment. Used for prioritization and alerting.';
COMMENT ON VIEW source_completeness IS 'Real-time dashboard of coverage across all sources. Shows universe, extracted, gap, freshness.';
COMMENT ON VIEW coverage_gaps IS 'Sources needing attention - below target coverage or stale data.';
COMMENT ON FUNCTION record_census IS 'Records a new census result for a source. Called by census edge functions.';
