-- Market Intelligence Schema Improvements
-- Based on AI meta-analysis identifying data gaps across 200+ vehicle analyses
-- Top gaps: owner history (20%), service records (13%), comparable sales (4%)

-- 1. OWNERSHIP HISTORY
-- Track provenance chain for each vehicle
CREATE TABLE IF NOT EXISTS ownership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  owner_number INTEGER, -- 1 = first owner, 2 = second, etc.
  acquired_date DATE,
  sold_date DATE,
  location TEXT, -- City/state/country
  purchase_price NUMERIC,
  sale_price NUMERIC,
  ownership_type TEXT, -- 'private', 'dealer', 'museum', 'collection'
  notes TEXT,
  source TEXT, -- Where this info came from
  confidence_score NUMERIC DEFAULT 0.5, -- 0-1 how confident we are
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_history_vehicle ON ownership_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ownership_history_dates ON ownership_history(acquired_date, sold_date);

-- 2. SERVICE RECORDS
-- Track maintenance and repair history
CREATE TABLE IF NOT EXISTS service_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date DATE,
  mileage INTEGER,
  shop_name TEXT,
  shop_location TEXT,
  work_performed TEXT,
  cost NUMERIC,
  parts_replaced TEXT[], -- Array of part names
  service_type TEXT, -- 'routine', 'repair', 'restoration', 'modification'
  documentation_available BOOLEAN DEFAULT FALSE,
  source TEXT,
  confidence_score NUMERIC DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_records_vehicle ON service_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_records_date ON service_records(service_date);
CREATE INDEX IF NOT EXISTS idx_service_records_type ON service_records(service_type);

-- 3. VEHICLE HISTORY REPORTS
-- Store Carfax/AutoCheck data when available
CREATE TABLE IF NOT EXISTS vehicle_history_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  vin TEXT,
  report_provider TEXT, -- 'carfax', 'autocheck', 'nmvtis', etc.
  report_date DATE,
  title_history JSONB, -- Array of title events
  accident_history JSONB, -- Array of accident records
  odometer_readings JSONB, -- Array of {date, mileage, source}
  ownership_count INTEGER,
  last_reported_mileage INTEGER,
  branded_title BOOLEAN DEFAULT FALSE,
  brand_type TEXT, -- 'salvage', 'rebuilt', 'lemon', etc.
  raw_report JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_history_vehicle_provider
  ON vehicle_history_reports(vehicle_id, report_provider);

-- 4. PRICE COMPARABLES
-- Track comparable sales for market analysis
CREATE TABLE IF NOT EXISTS price_comparables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  comparable_vehicle_id UUID REFERENCES vehicles(id),
  similarity_score NUMERIC, -- 0-1 how similar
  similarity_factors JSONB, -- What makes them comparable
  price_delta NUMERIC, -- Difference in sale price
  price_delta_percent NUMERIC,
  sale_date_delta INTEGER, -- Days between sales
  condition_delta TEXT, -- 'better', 'similar', 'worse'
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_comparables_vehicle ON price_comparables(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_price_comparables_similarity ON price_comparables(similarity_score DESC);

-- 5. MARKET SEGMENT STATS
-- Aggregated stats by vehicle segment for quick lookups
CREATE TABLE IF NOT EXISTS market_segment_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key TEXT UNIQUE, -- e.g., 'porsche_911_1989_1994'
  make TEXT,
  model TEXT,
  year_start INTEGER,
  year_end INTEGER,

  -- Price stats
  avg_sale_price NUMERIC,
  median_sale_price NUMERIC,
  min_sale_price NUMERIC,
  max_sale_price NUMERIC,
  price_std_dev NUMERIC,

  -- Volume stats
  total_sales INTEGER,
  sales_last_30_days INTEGER,
  sales_last_90_days INTEGER,
  sales_last_year INTEGER,

  -- Trend stats
  price_trend_30d NUMERIC, -- Percent change
  price_trend_90d NUMERIC,
  price_trend_1y NUMERIC,

  -- Sentiment from comment analysis
  avg_sentiment_score NUMERIC,
  common_themes TEXT[],
  common_concerns TEXT[],

  -- Data quality
  data_quality_score NUMERIC,
  sample_size INTEGER,
  last_calculated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_segment_make_model ON market_segment_stats(make, model);

-- 6. Add data quality tracking to comment_discoveries
ALTER TABLE comment_discoveries
  ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC,
  ADD COLUMN IF NOT EXISTS missing_data_flags TEXT[],
  ADD COLUMN IF NOT EXISTS recommended_sources TEXT[];

-- 7. Create view for vehicles needing more data
CREATE OR REPLACE VIEW vehicles_needing_data AS
SELECT
  v.id,
  v.year,
  v.make,
  v.model,
  v.sale_price,
  cd.data_quality_score,
  cd.missing_data_flags,
  cd.recommended_sources,
  (SELECT COUNT(*) FROM ownership_history oh WHERE oh.vehicle_id = v.id) as owner_records,
  (SELECT COUNT(*) FROM service_records sr WHERE sr.vehicle_id = v.id) as service_records,
  (SELECT COUNT(*) FROM vehicle_history_reports vhr WHERE vhr.vehicle_id = v.id) as history_reports
FROM vehicles v
LEFT JOIN comment_discoveries cd ON cd.vehicle_id = v.id
WHERE cd.data_quality_score < 0.8
  OR cd.data_quality_score IS NULL
ORDER BY v.sale_price DESC NULLS LAST;

-- 8. Function to calculate price comparables for a vehicle
CREATE OR REPLACE FUNCTION calculate_price_comparables(target_vehicle_id UUID)
RETURNS INTEGER AS $$
DECLARE
  target_vehicle RECORD;
  comparable RECORD;
  similarity NUMERIC;
  inserted_count INTEGER := 0;
BEGIN
  -- Get target vehicle
  SELECT * INTO target_vehicle FROM vehicles WHERE id = target_vehicle_id;

  IF target_vehicle IS NULL THEN
    RETURN 0;
  END IF;

  -- Find similar vehicles
  FOR comparable IN
    SELECT v.*,
      ABS(v.year - target_vehicle.year) as year_diff,
      ABS(COALESCE(v.sale_price, 0) - COALESCE(target_vehicle.sale_price, 0)) as price_diff
    FROM vehicles v
    WHERE v.id != target_vehicle_id
      AND v.make = target_vehicle.make
      AND v.model = target_vehicle.model
      AND v.sale_price IS NOT NULL
      AND ABS(v.year - target_vehicle.year) <= 5
    ORDER BY ABS(v.year - target_vehicle.year), ABS(v.sale_price - target_vehicle.sale_price)
    LIMIT 20
  LOOP
    -- Calculate similarity (simple formula, can be enhanced)
    similarity := 1.0 - (comparable.year_diff * 0.1) - (comparable.price_diff / GREATEST(target_vehicle.sale_price, 1) * 0.3);
    similarity := GREATEST(similarity, 0);

    -- Insert comparable
    INSERT INTO price_comparables (
      vehicle_id, comparable_vehicle_id, similarity_score, similarity_factors,
      price_delta, price_delta_percent
    ) VALUES (
      target_vehicle_id, comparable.id, similarity,
      jsonb_build_object('year_diff', comparable.year_diff, 'same_make', true, 'same_model', true),
      comparable.sale_price - target_vehicle.sale_price,
      (comparable.sale_price - target_vehicle.sale_price) / GREATEST(target_vehicle.sale_price, 1) * 100
    )
    ON CONFLICT DO NOTHING;

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE ownership_history IS 'Vehicle ownership chain - tracks provenance through each owner';
COMMENT ON TABLE service_records IS 'Maintenance and repair history for vehicles';
COMMENT ON TABLE vehicle_history_reports IS 'Carfax/AutoCheck and other VIN-based reports';
COMMENT ON TABLE price_comparables IS 'Similar vehicle sales for pricing analysis';
COMMENT ON TABLE market_segment_stats IS 'Aggregated market stats by vehicle segment';
