-- Migration: survival_rate_estimates table
-- Estimates how many of a given make/model/generation are still on the road.

BEGIN;

CREATE TABLE IF NOT EXISTS survival_rate_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Grouping key
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year_start INTEGER NOT NULL,
    year_end INTEGER NOT NULL,

    -- Production data
    total_produced INTEGER,

    -- Survival estimates
    estimated_surviving INTEGER,
    survival_rate NUMERIC(5,4) CHECK (survival_rate IS NULL OR (survival_rate >= 0 AND survival_rate <= 1)),

    -- Method
    estimation_method TEXT NOT NULL CHECK (estimation_method IN (
        'registry_data', 'listing_frequency', 'decay_model'
    )),

    -- Proxy signals used for estimation
    proxy_signals JSONB DEFAULT '{}',

    -- Confidence
    confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score BETWEEN 0 AND 100)),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(make, model, year_start, year_end)
);

CREATE INDEX IF NOT EXISTS idx_sre_make_model ON survival_rate_estimates(make, model);
CREATE INDEX IF NOT EXISTS idx_sre_survival_rate ON survival_rate_estimates(survival_rate);
CREATE INDEX IF NOT EXISTS idx_sre_method ON survival_rate_estimates(estimation_method);

-- RLS
ALTER TABLE survival_rate_estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survival_rate_estimates_read" ON survival_rate_estimates;
CREATE POLICY "survival_rate_estimates_read" ON survival_rate_estimates
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "survival_rate_estimates_service_write" ON survival_rate_estimates;
CREATE POLICY "survival_rate_estimates_service_write" ON survival_rate_estimates
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE survival_rate_estimates IS 'Estimated surviving count for each make/model/generation';
COMMENT ON COLUMN survival_rate_estimates.proxy_signals IS '{"unique_vins_seen": N, "listing_frequency_annual": N, "sources_seen": [...]}';

GRANT SELECT ON survival_rate_estimates TO authenticated, anon;
GRANT ALL ON survival_rate_estimates TO service_role;

COMMIT;
