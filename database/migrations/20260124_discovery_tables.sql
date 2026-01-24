-- Discovery Tables for Learning Phase
-- These capture RAW LLM output before we commit to final schemas
-- The goal: discover what data exists, then build schemas around findings

-- ============================================================
-- DESCRIPTION DISCOVERIES
-- Raw LLM extraction from vehicle descriptions
-- ============================================================

CREATE TABLE IF NOT EXISTS description_discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Discovery metadata
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  model_used TEXT DEFAULT 'claude-3-haiku',
  prompt_version TEXT DEFAULT 'v1-discovery',

  -- Raw extraction (EVERYTHING the LLM found)
  raw_extraction JSONB NOT NULL,

  -- Metrics for analysis
  keys_found INT,           -- Top-level keys in extraction
  total_fields INT,         -- Total leaf values
  description_length INT,   -- Input description length
  sale_price INT,           -- For correlation analysis

  -- Review status
  reviewed BOOLEAN DEFAULT FALSE,
  review_notes TEXT,
  schema_suggestions JSONB,  -- Notes on what fields should be added

  CONSTRAINT description_discoveries_vehicle_id_key UNIQUE (vehicle_id)
);

CREATE INDEX idx_description_discoveries_reviewed ON description_discoveries(reviewed);
CREATE INDEX idx_description_discoveries_sale_price ON description_discoveries(sale_price DESC);
CREATE INDEX idx_description_discoveries_keys_found ON description_discoveries(keys_found DESC);

-- ============================================================
-- COMMENT DISCOVERIES
-- Raw LLM analysis of auction comments
-- Captures: sentiment, expert insights, trends, community mood
-- ============================================================

CREATE TABLE IF NOT EXISTS comment_discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Discovery metadata
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  model_used TEXT DEFAULT 'claude-3-haiku',
  prompt_version TEXT DEFAULT 'v1-discovery',

  -- Raw extraction
  raw_extraction JSONB NOT NULL,

  -- Metrics
  comment_count INT,        -- Number of comments analyzed
  total_fields INT,
  sale_price INT,

  -- Sentiment summary (extracted from raw)
  overall_sentiment TEXT,   -- 'positive', 'negative', 'mixed', 'neutral'
  sentiment_score NUMERIC(3,2),  -- -1 to 1

  -- Review status
  reviewed BOOLEAN DEFAULT FALSE,
  review_notes TEXT,

  CONSTRAINT comment_discoveries_vehicle_id_key UNIQUE (vehicle_id)
);

CREATE INDEX idx_comment_discoveries_sentiment ON comment_discoveries(overall_sentiment);
CREATE INDEX idx_comment_discoveries_sale_price ON comment_discoveries(sale_price DESC);

-- ============================================================
-- FIELD FREQUENCY TRACKING
-- Tracks which fields appear across extractions
-- Helps identify what should be in final schema
-- ============================================================

CREATE TABLE IF NOT EXISTS discovery_field_frequency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source TEXT NOT NULL,     -- 'description' or 'comment'
  field_path TEXT NOT NULL, -- e.g., 'ownership.count', 'service_history[].shop'

  -- Frequency metrics
  occurrence_count INT DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),

  -- Value analysis
  sample_values JSONB DEFAULT '[]',  -- Sample of actual values
  value_types JSONB DEFAULT '[]',    -- Types seen: string, number, boolean, array

  -- Schema recommendation
  recommended_type TEXT,     -- Suggested DB type
  recommended_nullable BOOLEAN DEFAULT TRUE,
  notes TEXT,

  CONSTRAINT discovery_field_frequency_unique UNIQUE (source, field_path)
);

CREATE INDEX idx_discovery_field_frequency_count ON discovery_field_frequency(occurrence_count DESC);

-- ============================================================
-- TREND TRACKING
-- For tracking patterns over time and across niches
-- ============================================================

CREATE TABLE IF NOT EXISTS discovery_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trend_type TEXT NOT NULL,     -- 'sentiment', 'price', 'feature', 'concern'
  trend_key TEXT NOT NULL,      -- What's being tracked

  -- Segmentation
  segment_type TEXT,            -- 'make', 'model', 'year_range', 'price_range', 'all'
  segment_value TEXT,           -- e.g., 'Porsche', '911', '1970-1979', '$50k-100k'

  -- Metrics
  sample_count INT DEFAULT 0,
  metric_value NUMERIC,
  metric_label TEXT,            -- e.g., 'avg_sentiment', 'mention_rate'

  -- Time tracking
  period_start DATE,
  period_end DATE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  raw_data JSONB,               -- Supporting data

  CONSTRAINT discovery_trends_unique UNIQUE (trend_type, trend_key, segment_type, segment_value, period_start)
);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE description_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_field_frequency ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discovery_select" ON description_discoveries FOR SELECT USING (true);
CREATE POLICY "discovery_service" ON description_discoveries FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "comment_discovery_select" ON comment_discoveries FOR SELECT USING (true);
CREATE POLICY "comment_discovery_service" ON comment_discoveries FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "field_freq_select" ON discovery_field_frequency FOR SELECT USING (true);
CREATE POLICY "field_freq_service" ON discovery_field_frequency FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "trends_select" ON discovery_trends FOR SELECT USING (true);
CREATE POLICY "trends_service" ON discovery_trends FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- HELPER FUNCTION: Update field frequency from extraction
-- ============================================================

CREATE OR REPLACE FUNCTION update_field_frequency(
  p_source TEXT,
  p_extraction JSONB,
  p_path TEXT DEFAULT ''
) RETURNS void AS $$
DECLARE
  key TEXT;
  val JSONB;
  full_path TEXT;
BEGIN
  FOR key, val IN SELECT * FROM jsonb_each(p_extraction)
  LOOP
    full_path := CASE WHEN p_path = '' THEN key ELSE p_path || '.' || key END;

    -- Insert or update frequency
    INSERT INTO discovery_field_frequency (source, field_path, occurrence_count, sample_values, last_seen)
    VALUES (p_source, full_path, 1, jsonb_build_array(val), NOW())
    ON CONFLICT (source, field_path) DO UPDATE SET
      occurrence_count = discovery_field_frequency.occurrence_count + 1,
      last_seen = NOW(),
      sample_values = CASE
        WHEN jsonb_array_length(discovery_field_frequency.sample_values) < 5
        THEN discovery_field_frequency.sample_values || jsonb_build_array(val)
        ELSE discovery_field_frequency.sample_values
      END;

    -- Recurse into objects (not arrays)
    IF jsonb_typeof(val) = 'object' THEN
      PERFORM update_field_frequency(p_source, val, full_path);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE description_discoveries IS 'Raw LLM extractions from descriptions - learning phase';
COMMENT ON TABLE comment_discoveries IS 'Raw LLM analysis of comments - sentiment & trends';
COMMENT ON TABLE discovery_field_frequency IS 'Tracks which fields appear across extractions';
COMMENT ON TABLE discovery_trends IS 'Aggregated trends across segments';
