-- Migration: record_prices table
-- Tracks the highest known sale for each year/make/model combo.

BEGIN;

CREATE TABLE IF NOT EXISTS record_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Grouping key (generation-bucketed)
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year_start INTEGER NOT NULL,
    year_end INTEGER NOT NULL,

    -- Current record
    record_price NUMERIC(12,2) NOT NULL,
    record_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    record_sale_date TIMESTAMPTZ,
    record_platform TEXT,
    record_url TEXT,

    -- Previous record (for "beat by X%" headlines)
    previous_record_price NUMERIC(12,2),
    previous_record_date TIMESTAMPTZ,

    -- Statistics
    times_record_broken INTEGER DEFAULT 1,
    avg_time_between_records_days INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(make, model, year_start, year_end)
);

CREATE INDEX IF NOT EXISTS idx_rp_make_model ON record_prices(make, model);
CREATE INDEX IF NOT EXISTS idx_rp_record_price ON record_prices(record_price DESC);
CREATE INDEX IF NOT EXISTS idx_rp_vehicle ON record_prices(record_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rp_year_range ON record_prices(year_start, year_end);

-- RLS
ALTER TABLE record_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "record_prices_read" ON record_prices;
CREATE POLICY "record_prices_read" ON record_prices
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "record_prices_service_write" ON record_prices;
CREATE POLICY "record_prices_service_write" ON record_prices
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE record_prices IS 'Highest known sale for each make/model/generation combo';

GRANT SELECT ON record_prices TO authenticated, anon;
GRANT ALL ON record_prices TO service_role;

COMMIT;
