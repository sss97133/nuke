-- Vehicle Intelligence Table
-- Stores structured data extracted from vehicle descriptions and comments
--
-- IMPORTANT: This is READ-ONLY on vehicles table. All output goes here.
-- Safe to TRUNCATE or DROP without affecting vehicle profiles.

CREATE TABLE IF NOT EXISTS vehicle_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Extraction metadata
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_version TEXT NOT NULL DEFAULT 'v1.0',
  extraction_method TEXT NOT NULL DEFAULT 'hybrid', -- 'regex', 'llm', 'hybrid'
  extraction_confidence NUMERIC(3,2),

  -- Acquisition & Ownership
  acquisition_year INT,
  acquisition_source TEXT,  -- 'private', 'dealer', 'bat', 'estate', 'auction', 'family'
  previous_bat_sale_url TEXT,
  previous_bat_sale_price INT,
  owner_count INT,
  notable_owner TEXT,
  is_single_family BOOLEAN,

  -- Service & Maintenance
  service_events JSONB DEFAULT '[]',
  last_service_year INT,
  last_service_mileage INT,
  has_recent_service BOOLEAN,  -- within last 2 years

  -- Modifications
  is_modified BOOLEAN,
  modification_level TEXT,  -- 'stock', 'mild', 'moderate', 'extensive'
  modifications JSONB DEFAULT '[]',
  parts_replaced JSONB DEFAULT '[]',

  -- Documentation
  has_service_records BOOLEAN,
  service_records_from_year INT,
  has_window_sticker BOOLEAN,
  has_owners_manual BOOLEAN,
  has_books BOOLEAN,
  has_tools BOOLEAN,
  has_spare_key BOOLEAN,
  documentation_list JSONB DEFAULT '[]',

  -- Condition
  is_running BOOLEAN,
  is_driving BOOLEAN,
  is_project BOOLEAN,
  is_restored BOOLEAN,
  restoration_year INT,
  known_issues JSONB DEFAULT '[]',
  seller_condition_notes JSONB DEFAULT '[]',

  -- Provenance
  registration_states JSONB DEFAULT '[]',
  original_delivery_dealer TEXT,
  original_delivery_location TEXT,
  climate_history TEXT,  -- 'dry', 'mixed', 'winter', 'coastal'
  rust_belt_exposure BOOLEAN,
  is_rust_free BOOLEAN,
  is_california_car BOOLEAN,
  never_winter_driven BOOLEAN,

  -- Authenticity
  matching_numbers BOOLEAN,
  matching_components JSONB DEFAULT '[]',  -- partial matching
  is_repainted BOOLEAN,
  repaint_color TEXT,
  repaint_year INT,
  is_original_color BOOLEAN,
  replacement_components JSONB DEFAULT '[]',
  authenticity_notes JSONB DEFAULT '[]',

  -- Awards & Recognition
  awards JSONB DEFAULT '[]',
  is_concours_quality BOOLEAN,
  is_show_winner BOOLEAN,

  -- Rarity
  production_number INT,
  total_production INT,
  special_edition_name TEXT,
  is_limited_edition BOOLEAN,
  rarity_notes JSONB DEFAULT '[]',

  -- Community Intelligence (from comments)
  seller_disclosures JSONB DEFAULT '[]',
  expert_insights JSONB DEFAULT '[]',
  comparable_sales JSONB DEFAULT '[]',
  condition_concerns JSONB DEFAULT '[]',
  reliability_notes JSONB DEFAULT '[]',

  -- Raw extraction data (for debugging/reprocessing)
  raw_tier1_extraction JSONB,
  raw_tier2_extraction JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT vehicle_intelligence_vehicle_id_key UNIQUE (vehicle_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_vehicle_id ON vehicle_intelligence(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_extracted_at ON vehicle_intelligence(extracted_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_owner_count ON vehicle_intelligence(owner_count) WHERE owner_count IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_matching_numbers ON vehicle_intelligence(matching_numbers) WHERE matching_numbers IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_is_modified ON vehicle_intelligence(is_modified) WHERE is_modified IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_intelligence_has_service_records ON vehicle_intelligence(has_service_records) WHERE has_service_records IS NOT NULL;

-- Enable RLS
ALTER TABLE vehicle_intelligence ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can read
CREATE POLICY "vehicle_intelligence_select" ON vehicle_intelligence
  FOR SELECT USING (true);

-- Policy: service role can do anything
CREATE POLICY "vehicle_intelligence_service" ON vehicle_intelligence
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_vehicle_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicle_intelligence_updated_at
  BEFORE UPDATE ON vehicle_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_intelligence_updated_at();

-- Comments
COMMENT ON TABLE vehicle_intelligence IS 'Structured data extracted from vehicle descriptions and auction comments';
COMMENT ON COLUMN vehicle_intelligence.extraction_method IS 'regex = Tier 1 only, llm = Tier 2 only, hybrid = both';
COMMENT ON COLUMN vehicle_intelligence.service_events IS 'Array of {date, mileage, description, shop}';
COMMENT ON COLUMN vehicle_intelligence.modifications IS 'Array of {component, description, reversible}';
COMMENT ON COLUMN vehicle_intelligence.awards IS 'Array of {name, year, score}';
COMMENT ON COLUMN vehicle_intelligence.seller_disclosures IS 'Facts revealed by seller in comment Q&A';
COMMENT ON COLUMN vehicle_intelligence.expert_insights IS 'Technical knowledge from community comments';
