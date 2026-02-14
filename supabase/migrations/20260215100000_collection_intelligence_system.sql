-- ============================================================================
-- COLLECTION INTELLIGENCE SYSTEM
-- Franchise-style business intelligence for vehicle collections
-- ============================================================================

-- 1) collection_intelligence — one row per collection business
CREATE TABLE IF NOT EXISTS collection_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Capacity
  estimated_capacity INTEGER,
  current_inventory INTEGER,
  capacity_utilization NUMERIC(5,2),
  capacity_method TEXT,

  -- Demographics (from geo_demographics or external)
  metro_area TEXT,
  metro_population INTEGER,
  metro_gdp_per_capita NUMERIC,
  zip_median_income NUMERIC,
  zip_population INTEGER,

  -- Demand scoring
  demand_score NUMERIC(5,2),        -- 0-100 franchise-territory style
  demand_signals JSONB DEFAULT '{}',

  -- Surrounding market
  vehicles_within_25mi INTEGER,
  vehicles_within_50mi INTEGER,
  avg_vehicle_value_25mi NUMERIC,
  competing_collections_25mi INTEGER,
  competing_dealers_25mi INTEGER,
  key_users_nearby JSONB DEFAULT '[]',

  -- Vehicle distribution
  make_distribution JSONB DEFAULT '{}',
  era_distribution JSONB DEFAULT '{}',
  value_distribution JSONB DEFAULT '{}',

  -- AI opportunity analysis
  opportunity_summary TEXT,
  opportunity_score NUMERIC(5,2),

  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one intelligence row per business
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collection_intelligence_business_id_key'
  ) THEN
    ALTER TABLE collection_intelligence
      ADD CONSTRAINT collection_intelligence_business_id_key UNIQUE (business_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_collection_intelligence_business
  ON collection_intelligence(business_id);
CREATE INDEX IF NOT EXISTS idx_collection_intelligence_demand
  ON collection_intelligence(demand_score DESC NULLS LAST);

-- 2) geo_demographics — US ZIP code demographics for territorial analysis
CREATE TABLE IF NOT EXISTS geo_demographics (
  zip_code TEXT PRIMARY KEY,
  city TEXT,
  state TEXT,
  county TEXT,
  metro_area TEXT,
  population INTEGER,
  median_household_income NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_geo_demographics_state ON geo_demographics(state);
CREATE INDEX IF NOT EXISTS idx_geo_demographics_metro ON geo_demographics(metro_area) WHERE metro_area IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_geo_demographics_coords ON geo_demographics(latitude, longitude) WHERE latitude IS NOT NULL;

-- 3) RLS — collection_intelligence readable by authenticated, writable by service role
ALTER TABLE collection_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read collection intelligence" ON collection_intelligence;
CREATE POLICY "Public read collection intelligence"
  ON collection_intelligence FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role write collection intelligence" ON collection_intelligence;
CREATE POLICY "Service role write collection intelligence"
  ON collection_intelligence FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4) RLS — geo_demographics public read, service role write
ALTER TABLE geo_demographics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read geo demographics" ON geo_demographics;
CREATE POLICY "Public read geo demographics"
  ON geo_demographics FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role write geo demographics" ON geo_demographics;
CREATE POLICY "Service role write geo demographics"
  ON geo_demographics FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5) RLS — Ensure collection businesses with is_public=true AND is_verified=true are readable
-- The existing RLS policy on businesses requires is_verified=true AND is_public=true for SELECT.
-- Collections seeded by seed-ecr-collections set both flags, so they'll be visible.

-- Also ensure business_vehicle_fleet is readable for public collection businesses
DROP POLICY IF EXISTS "Public can view collection fleet" ON business_vehicle_fleet;
CREATE POLICY "Public can view collection fleet"
  ON business_vehicle_fleet FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_vehicle_fleet.business_id
      AND businesses.is_public = true
      AND businesses.is_verified = true
      AND businesses.business_type = 'collection'
    )
  );
