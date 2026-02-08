-- Migration: nuke_estimates table — the Nuke Estimate (Zestimate for cars)
-- Central output table for the multi-signal valuation engine.
-- One row per vehicle, upserted on recalculation.
-- Named nuke_estimates to avoid conflict with existing vehicle_valuations table.

BEGIN;

-- ============================================================================
-- NUKE ESTIMATES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS nuke_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

    -- The estimate
    estimated_value NUMERIC(12,2) NOT NULL,
    value_low NUMERIC(12,2) NOT NULL,
    value_high NUMERIC(12,2) NOT NULL,
    confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),

    -- Price tier (determines model weight distribution)
    price_tier TEXT NOT NULL CHECK (price_tier IN (
        'budget',       -- < $15K
        'mainstream',   -- $15K-$50K
        'enthusiast',   -- $50K-$150K
        'collector',    -- $150K-$500K
        'trophy'        -- $500K+
    )),
    confidence_interval_pct NUMERIC(5,2),

    -- Explainability (what signals contributed, with what weight)
    signal_weights JSONB NOT NULL DEFAULT '{}',

    -- Deal score: ((estimated - asking) / estimated) * 100 * freshness_decay
    deal_score NUMERIC(5,2),
    deal_score_label TEXT CHECK (deal_score_label IS NULL OR deal_score_label IN (
        'steal', 'good_deal', 'fair', 'overpriced', 'way_overpriced'
    )),

    -- Heat score: 0-100 composite excitement metric
    heat_score NUMERIC(5,2),
    heat_score_label TEXT CHECK (heat_score_label IS NULL OR heat_score_label IN (
        'cold', 'warm', 'hot', 'fire', 'volcanic'
    )),

    -- Meta
    model_version TEXT NOT NULL DEFAULT 'v1',
    input_count INTEGER,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_stale BOOLEAN DEFAULT false,

    UNIQUE(vehicle_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ne_vehicle_id ON nuke_estimates(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ne_deal_score ON nuke_estimates(deal_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ne_heat_score ON nuke_estimates(heat_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ne_price_tier ON nuke_estimates(price_tier);
CREATE INDEX IF NOT EXISTS idx_ne_confidence ON nuke_estimates(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_ne_stale ON nuke_estimates(is_stale) WHERE is_stale = true;
CREATE INDEX IF NOT EXISTS idx_ne_calculated_at ON nuke_estimates(calculated_at DESC);

-- RLS
ALTER TABLE nuke_estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nuke_estimates_read" ON nuke_estimates;
CREATE POLICY "nuke_estimates_read" ON nuke_estimates
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "nuke_estimates_service_write" ON nuke_estimates;
CREATE POLICY "nuke_estimates_service_write" ON nuke_estimates
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- DENORMALIZED COLUMNS ON VEHICLES TABLE
-- ============================================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS nuke_estimate NUMERIC(12,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS nuke_estimate_confidence INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deal_score NUMERIC(5,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS heat_score NUMERIC(5,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS valuation_calculated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vehicles_deal_score ON vehicles(deal_score DESC NULLS LAST)
    WHERE deal_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_heat_score ON vehicles(heat_score DESC NULLS LAST)
    WHERE heat_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_nuke_estimate ON vehicles(nuke_estimate)
    WHERE nuke_estimate IS NOT NULL;

COMMENT ON TABLE nuke_estimates IS 'Nuke Estimate — multi-signal vehicle valuation with deal and heat scoring';
COMMENT ON COLUMN nuke_estimates.signal_weights IS 'JSON map of signal name → {weight, multiplier, source_count}';
COMMENT ON COLUMN nuke_estimates.deal_score IS '((estimated - asking) / estimated) * 100 * freshness_decay';
COMMENT ON COLUMN nuke_estimates.heat_score IS '0-100 composite excitement metric';

-- Grant access
GRANT SELECT ON nuke_estimates TO authenticated, anon;
GRANT ALL ON nuke_estimates TO service_role;

COMMIT;
