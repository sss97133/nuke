-- Market Trends Infrastructure
-- Aggregates sentiment and demand signals across platforms for trend analysis

-- Store aggregated market trends by make/model
CREATE TABLE IF NOT EXISTS market_trends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Grouping
    make TEXT NOT NULL,
    model TEXT, -- NULL = make-level aggregate
    year_start INTEGER,
    year_end INTEGER,

    -- Platform coverage
    platform TEXT NOT NULL, -- 'bringatrailer', 'carsandbids', 'all'
    vehicle_count INTEGER NOT NULL DEFAULT 0,
    analysis_count INTEGER NOT NULL DEFAULT 0, -- vehicles with AI analysis

    -- Demand signals (from comment_discoveries.raw_extraction.market_signals)
    demand_high_pct NUMERIC(5,2),
    demand_moderate_pct NUMERIC(5,2),
    demand_low_pct NUMERIC(5,2),

    -- Price signals
    price_rising_pct NUMERIC(5,2),
    price_stable_pct NUMERIC(5,2),
    price_declining_pct NUMERIC(5,2),

    -- Sentiment
    avg_sentiment_score NUMERIC(4,2),
    sentiment_samples INTEGER,

    -- Rarity distribution
    rarity_rare_pct NUMERIC(5,2),
    rarity_moderate_pct NUMERIC(5,2),
    rarity_common_pct NUMERIC(5,2),

    -- Price stats
    avg_sale_price NUMERIC(12,2),
    min_sale_price NUMERIC(12,2),
    max_sale_price NUMERIC(12,2),
    median_sale_price NUMERIC(12,2),

    -- Common themes from AI analysis
    top_discussion_themes JSONB, -- ['condition', 'originality', 'value']
    top_community_concerns JSONB, -- ['rust', 'pricing', 'authenticity']

    -- Timestamps
    period_start TIMESTAMPTZ, -- for time-series trends
    period_end TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique aggregation
    UNIQUE(make, model, platform, period_start)
);

-- Indexes for querying trends
CREATE INDEX IF NOT EXISTS idx_market_trends_make ON market_trends(make);
CREATE INDEX IF NOT EXISTS idx_market_trends_platform ON market_trends(platform);
CREATE INDEX IF NOT EXISTS idx_market_trends_demand ON market_trends(demand_high_pct DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_market_trends_sentiment ON market_trends(avg_sentiment_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_market_trends_calculated ON market_trends(calculated_at DESC);

-- Track trending keywords/themes over time
CREATE TABLE IF NOT EXISTS market_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme TEXT NOT NULL,
    theme_type TEXT NOT NULL, -- 'discussion', 'concern', 'positive', 'negative'
    platform TEXT,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    avg_sentiment_when_mentioned NUMERIC(4,2),
    example_vehicle_ids UUID[],
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_themes_type ON market_themes(theme_type, occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_market_themes_theme ON market_themes(theme);

-- View: Hot makes (high demand + positive sentiment)
CREATE OR REPLACE VIEW hot_makes AS
SELECT
    make,
    platform,
    analysis_count,
    demand_high_pct,
    avg_sentiment_score,
    avg_sale_price,
    calculated_at,
    ROUND(demand_high_pct * avg_sentiment_score, 2) as heat_score
FROM market_trends
WHERE model IS NULL -- make-level only
  AND analysis_count >= 3 -- minimum sample size
ORDER BY heat_score DESC NULLS LAST;

-- View: Rising models (price_rising + high demand)
CREATE OR REPLACE VIEW rising_models AS
SELECT
    make,
    model,
    platform,
    analysis_count,
    demand_high_pct,
    price_rising_pct,
    avg_sentiment_score,
    avg_sale_price,
    ROUND((COALESCE(demand_high_pct, 0) + COALESCE(price_rising_pct, 0)) / 2, 2) as momentum_score
FROM market_trends
WHERE model IS NOT NULL
  AND analysis_count >= 2
  AND (demand_high_pct > 20 OR price_rising_pct > 20)
ORDER BY momentum_score DESC NULLS LAST;

COMMENT ON TABLE market_trends IS 'Aggregated market signals from AI-analyzed auction comments';
COMMENT ON TABLE market_themes IS 'Trending discussion themes and community concerns';
COMMENT ON VIEW hot_makes IS 'Makes with highest demand + sentiment combination';
COMMENT ON VIEW rising_models IS 'Specific models showing price momentum';
