-- Expand Intelligence Schema Based on Discovery Patterns
-- Based on 39 description and 8 comment discovery samples

-- ============================================================
-- PART 1: Add new fields to vehicle_intelligence
-- (Based on Tier 1 & 2 patterns from discovery)
-- ============================================================

-- Numbers mentioned (87% frequency)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  numbers_extracted JSONB DEFAULT '{}';
-- Contains: mileage, prices, years, production numbers as structured data

-- Parts mentioned (69% frequency)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  parts_mentioned TEXT[] DEFAULT '{}';

-- Locations mentioned (49% frequency)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  locations_mentioned JSONB DEFAULT '[]';
-- Array of {name, type: "city"|"state"|"country", context}

-- People mentioned (46% frequency)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  people_mentioned JSONB DEFAULT '[]';
-- Array of {name, role: "owner"|"shop"|"dealer"|"celebrity"}

-- Key dates (77% frequency)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  key_dates JSONB DEFAULT '[]';
-- Array of {date, description, type: "service"|"sale"|"registration"}

-- Notable claims (18% but valuable)
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  notable_claims TEXT[] DEFAULT '{}';

-- Service shops specifically
ALTER TABLE vehicle_intelligence ADD COLUMN IF NOT EXISTS
  service_shops TEXT[] DEFAULT '{}';

-- ============================================================
-- PART 2: Create vehicle_sentiment table
-- (Based on 100% consistent comment patterns)
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_sentiment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Extraction metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  comment_count INT NOT NULL,
  extraction_version TEXT DEFAULT 'v1.0',

  -- Sentiment Core
  overall_sentiment TEXT,  -- 'positive', 'negative', 'mixed', 'neutral'
  sentiment_score NUMERIC(3,2),  -- -1.0 to 1.0
  mood_keywords TEXT[] DEFAULT '{}',
  emotional_themes TEXT[] DEFAULT '{}',

  -- Market Signals
  market_demand TEXT,      -- 'high', 'medium', 'low'
  market_rarity TEXT,
  price_trend TEXT,        -- 'rising', 'stable', 'falling'
  price_sentiment JSONB,   -- {overall, comments}

  -- Community Intelligence
  expert_insights JSONB DEFAULT '[]',
  seller_disclosures JSONB DEFAULT '[]',
  community_concerns JSONB DEFAULT '[]',
  key_quotes TEXT[] DEFAULT '{}',

  -- Comparable Sales
  comparable_sales JSONB DEFAULT '[]',

  -- Discussions
  discussion_themes TEXT[] DEFAULT '{}',
  notable_discussions JSONB DEFAULT '[]',
  authenticity_discussion JSONB,

  -- Raw extraction for anything we missed
  raw_extraction JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT vehicle_sentiment_vehicle_id_key UNIQUE (vehicle_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_sentiment_sentiment ON vehicle_sentiment(overall_sentiment);
CREATE INDEX IF NOT EXISTS idx_vehicle_sentiment_score ON vehicle_sentiment(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_vehicle_sentiment_demand ON vehicle_sentiment(market_demand);

-- RLS
ALTER TABLE vehicle_sentiment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_sentiment_select" ON vehicle_sentiment FOR SELECT USING (true);
CREATE POLICY "vehicle_sentiment_service" ON vehicle_sentiment FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- PART 3: Create market_trends table
-- (For aggregated insights across segments)
-- ============================================================

CREATE TABLE IF NOT EXISTS market_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Segmentation
  segment_type TEXT NOT NULL,  -- 'make', 'model', 'year_range', 'price_range', 'body_style'
  segment_value TEXT NOT NULL, -- 'Porsche', '911', '1970-1979', '$50k-100k'

  -- Time period
  period_type TEXT NOT NULL,   -- 'all_time', 'year', 'quarter', 'month'
  period_start DATE,
  period_end DATE,

  -- Sample size
  vehicle_count INT NOT NULL,
  comment_count INT,

  -- Sentiment metrics
  avg_sentiment_score NUMERIC(4,3),
  sentiment_distribution JSONB,  -- {positive: 30, mixed: 50, negative: 20}
  top_mood_keywords TEXT[],

  -- Feature prevalence (% of vehicles with feature)
  feature_rates JSONB DEFAULT '{}',
  -- {matching_numbers: 0.34, has_service_records: 0.67, ...}

  -- Market signals
  avg_market_demand NUMERIC(3,2),  -- 0-1 scale
  price_trend_distribution JSONB,  -- {rising: 40, stable: 45, falling: 15}

  -- Common themes
  top_discussion_themes TEXT[],
  top_concerns TEXT[],
  top_expert_topics TEXT[],

  -- Price analysis
  avg_sale_price INT,
  median_sale_price INT,
  price_range_low INT,
  price_range_high INT,

  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT market_trends_unique UNIQUE (segment_type, segment_value, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_market_trends_segment ON market_trends(segment_type, segment_value);
CREATE INDEX IF NOT EXISTS idx_market_trends_period ON market_trends(period_type, period_start);

ALTER TABLE market_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_trends_select" ON market_trends FOR SELECT USING (true);
CREATE POLICY "market_trends_service" ON market_trends FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- PART 4: Create views for common queries
-- ============================================================

-- View: Vehicles with full intelligence
CREATE OR REPLACE VIEW v_vehicle_intelligence_full AS
SELECT
  v.id,
  v.year,
  v.make,
  v.model,
  v.sale_price,
  vi.owner_count,
  vi.matching_numbers,
  vi.has_service_records,
  vi.is_modified,
  vi.total_production,
  vi.acquisition_year,
  vi.is_restored,
  vi.is_rust_free,
  vi.parts_mentioned,
  vi.service_shops,
  vs.overall_sentiment,
  vs.sentiment_score,
  vs.market_demand,
  vs.price_trend,
  vs.discussion_themes
FROM vehicles v
LEFT JOIN vehicle_intelligence vi ON vi.vehicle_id = v.id
LEFT JOIN vehicle_sentiment vs ON vs.vehicle_id = v.id;

-- View: Market sentiment by make
CREATE OR REPLACE VIEW v_sentiment_by_make AS
SELECT
  v.make,
  COUNT(*) as vehicle_count,
  AVG(vs.sentiment_score) as avg_sentiment,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vs.sentiment_score) as median_sentiment,
  MODE() WITHIN GROUP (ORDER BY vs.overall_sentiment) as most_common_sentiment,
  AVG(v.sale_price) as avg_price
FROM vehicles v
JOIN vehicle_sentiment vs ON vs.vehicle_id = v.id
WHERE v.make IS NOT NULL
GROUP BY v.make
HAVING COUNT(*) >= 3
ORDER BY avg_sentiment DESC;

COMMENT ON TABLE vehicle_sentiment IS 'Community sentiment and market signals extracted from auction comments';
COMMENT ON TABLE market_trends IS 'Aggregated market trends by segment (make, model, price range, etc.)';
