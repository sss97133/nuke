-- ============================================================
-- VALUE SOURCES / CITATIONS SCHEMA
--
-- Multi-source valuation tracking system.
-- Every price data point is cited with source, URL, confidence.
-- Enables detective-grade data provenance.
-- ============================================================

-- =============================================================================
-- VEHICLE VALUE SOURCES TABLE
-- Stores individual citations for vehicle valuations
-- =============================================================================

CREATE TABLE IF NOT EXISTS vehicle_value_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Source identification
  source_key text NOT NULL, -- e.g., 'hagerty', 'bat_sold', 'classic_com'
  source_name text NOT NULL, -- Human readable name
  source_type text NOT NULL CHECK (source_type IN ('valuation', 'sale', 'listing', 'auction_result', 'appraisal', 'insurance', 'other')),

  -- Value data
  value_amount numeric(15, 2), -- The value from this source
  value_low numeric(15, 2), -- Range low (for valuations)
  value_high numeric(15, 2), -- Range high (for valuations)
  value_currency text DEFAULT 'USD',

  -- Citation data (the evidence)
  source_url text, -- URL where data was found
  source_date date, -- Date of the source data (e.g., sale date)
  fetched_at timestamptz DEFAULT NOW(), -- When we retrieved it

  -- Confidence and validation
  confidence numeric(3, 2) DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  is_verified boolean DEFAULT false, -- Human verified?
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,

  -- Raw evidence storage
  raw_data jsonb DEFAULT '{}', -- Store the raw response/data
  screenshot_url text, -- Screenshot of the source (proof)
  notes text,

  -- Metadata
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  created_by uuid REFERENCES auth.users(id),

  -- Prevent duplicate entries from same source
  UNIQUE (vehicle_id, source_key, source_url)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_vehicle_id ON vehicle_value_sources(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_source_key ON vehicle_value_sources(source_key);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_source_type ON vehicle_value_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_confidence ON vehicle_value_sources(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_sources_fetched_at ON vehicle_value_sources(fetched_at DESC);

-- Enable RLS
ALTER TABLE vehicle_value_sources ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Service role can manage value sources"
  ON vehicle_value_sources FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view value sources"
  ON vehicle_value_sources FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can add value sources"
  ON vehicle_value_sources FOR INSERT TO authenticated
  WITH CHECK (true);

-- =============================================================================
-- ADD COLUMNS TO VEHICLES TABLE FOR COMPUTED VALUES
-- =============================================================================

-- Add columns if they don't exist
DO $$
BEGIN
  -- Computed value from multiple sources
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'computed_value') THEN
    ALTER TABLE vehicles ADD COLUMN computed_value numeric(15, 2);
  END IF;

  -- Confidence in the computed value
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'value_confidence') THEN
    ALTER TABLE vehicles ADD COLUMN value_confidence numeric(3, 2);
  END IF;

  -- Method used to compute value
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'value_method') THEN
    ALTER TABLE vehicles ADD COLUMN value_method text;
  END IF;

  -- When value was last computed/enriched
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'value_enriched_at') THEN
    ALTER TABLE vehicles ADD COLUMN value_enriched_at timestamptz;
  END IF;

  -- Number of sources used
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'value_source_count') THEN
    ALTER TABLE vehicles ADD COLUMN value_source_count integer DEFAULT 0;
  END IF;
END $$;

-- =============================================================================
-- FUNCTION: Calculate vehicle value from sources
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_vehicle_value_from_sources(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_computed_value numeric;
  v_confidence numeric;
  v_method text;
  v_source_count integer;
BEGIN
  -- Get all sources for this vehicle
  WITH source_data AS (
    SELECT
      source_key,
      source_type,
      value_amount,
      confidence,
      fetched_at,
      -- Prioritize: sales > auction_results > appraisals > valuations > listings
      CASE source_type
        WHEN 'sale' THEN 5
        WHEN 'auction_result' THEN 4
        WHEN 'appraisal' THEN 3
        WHEN 'valuation' THEN 2
        WHEN 'listing' THEN 1
        ELSE 0
      END as type_priority
    FROM vehicle_value_sources
    WHERE vehicle_id = p_vehicle_id
      AND value_amount IS NOT NULL
      AND value_amount > 0
    ORDER BY type_priority DESC, confidence DESC, fetched_at DESC
  ),
  best_source AS (
    SELECT * FROM source_data LIMIT 1
  ),
  weighted_calc AS (
    SELECT
      SUM(value_amount * confidence) / NULLIF(SUM(confidence), 0) as weighted_avg,
      AVG(confidence) as avg_confidence,
      COUNT(*) as source_count
    FROM source_data
  )
  SELECT
    COALESCE(bs.value_amount, wc.weighted_avg),
    CASE
      WHEN bs.source_type IN ('sale', 'auction_result') THEN bs.confidence
      ELSE LEAST(0.95, wc.avg_confidence + (wc.source_count * 0.02))
    END,
    CASE
      WHEN bs.source_type = 'sale' THEN 'sale_record'
      WHEN bs.source_type = 'auction_result' THEN 'auction_result'
      WHEN wc.source_count > 1 THEN 'weighted_average'
      ELSE 'single_source'
    END,
    wc.source_count
  INTO v_computed_value, v_confidence, v_method, v_source_count
  FROM weighted_calc wc
  LEFT JOIN best_source bs ON true;

  -- Update the vehicle record
  IF v_computed_value IS NOT NULL AND v_computed_value > 0 THEN
    UPDATE vehicles
    SET
      computed_value = v_computed_value,
      value_confidence = v_confidence,
      value_method = v_method,
      value_source_count = v_source_count,
      value_enriched_at = NOW(),
      updated_at = NOW()
    WHERE id = p_vehicle_id;
  END IF;

  -- Return result
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'computed_value', v_computed_value,
    'confidence', v_confidence,
    'method', v_method,
    'source_count', v_source_count,
    'calculated_at', NOW()
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_vehicle_value_from_sources(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_vehicle_value_from_sources(uuid) TO service_role;

-- =============================================================================
-- FUNCTION: Add a value source citation
-- =============================================================================

CREATE OR REPLACE FUNCTION add_value_source(
  p_vehicle_id uuid,
  p_source_key text,
  p_source_name text,
  p_source_type text,
  p_value_amount numeric,
  p_source_url text DEFAULT NULL,
  p_source_date date DEFAULT NULL,
  p_confidence numeric DEFAULT 0.5,
  p_raw_data jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_id uuid;
  result jsonb;
BEGIN
  -- Insert or update the source
  INSERT INTO vehicle_value_sources (
    vehicle_id, source_key, source_name, source_type,
    value_amount, source_url, source_date, confidence,
    raw_data, notes
  )
  VALUES (
    p_vehicle_id, p_source_key, p_source_name, p_source_type,
    p_value_amount, p_source_url, p_source_date, p_confidence,
    p_raw_data, p_notes
  )
  ON CONFLICT (vehicle_id, source_key, source_url)
  DO UPDATE SET
    value_amount = EXCLUDED.value_amount,
    source_date = EXCLUDED.source_date,
    confidence = EXCLUDED.confidence,
    raw_data = EXCLUDED.raw_data,
    notes = EXCLUDED.notes,
    fetched_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_source_id;

  -- Recalculate vehicle value
  SELECT calculate_vehicle_value_from_sources(p_vehicle_id) INTO result;

  RETURN jsonb_build_object(
    'success', true,
    'source_id', v_source_id,
    'vehicle_value', result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION add_value_source(uuid, text, text, text, numeric, text, date, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION add_value_source(uuid, text, text, text, numeric, text, date, numeric, jsonb, text) TO service_role;

-- =============================================================================
-- VIEW: Vehicles with value sources summary
-- =============================================================================

CREATE OR REPLACE VIEW vehicle_value_summary AS
SELECT
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.computed_value,
  v.value_confidence,
  v.value_method,
  v.value_source_count,
  v.value_enriched_at,
  -- Original values for comparison
  v.sale_price,
  v.high_bid,
  v.current_value,
  v.auction_outcome,
  -- Source breakdown
  (
    SELECT jsonb_agg(jsonb_build_object(
      'source', source_key,
      'value', value_amount,
      'confidence', confidence,
      'type', source_type,
      'url', source_url
    ) ORDER BY confidence DESC)
    FROM vehicle_value_sources
    WHERE vehicle_id = v.id
  ) as value_sources
FROM vehicles v
WHERE v.is_public = true;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE vehicle_value_sources IS
'Multi-source valuation citations. Every price data point is tracked with source, URL, and confidence level.';

COMMENT ON FUNCTION calculate_vehicle_value_from_sources(uuid) IS
'Calculates weighted value from all sources for a vehicle. Prioritizes sales over valuations.';

COMMENT ON FUNCTION add_value_source(uuid, text, text, text, numeric, text, date, numeric, jsonb, text) IS
'Adds a citation/source for a vehicle value. Automatically recalculates vehicle computed_value.';
