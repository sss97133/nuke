-- Site Mapping Accountability System
-- Tracks thorough site mappings and completeness

-- Complete site maps
CREATE TABLE IF NOT EXISTS site_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES scrape_sources(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  
  -- Complete mapping data
  page_types JSONB NOT NULL DEFAULT '{}', -- All page types mapped
  field_mappings JSONB NOT NULL DEFAULT '{}', -- Complete field mappings
  extraction_rules JSONB NOT NULL DEFAULT '{}', -- Site-specific rules
  validation_rules JSONB NOT NULL DEFAULT '{}', -- Validation rules
  
  -- Completeness tracking
  total_fields_available INTEGER DEFAULT 0,
  fields_mapped INTEGER DEFAULT 0,
  fields_extracted INTEGER DEFAULT 0,
  coverage_percentage DECIMAL(5,2) DEFAULT 0, -- 0-100
  missing_fields TEXT[] DEFAULT '{}',
  
  -- Validation results
  validation_results JSONB DEFAULT '{}',
  last_validated_at TIMESTAMPTZ,
  
  -- Status
  status TEXT DEFAULT 'incomplete', -- 'incomplete', 'complete', 'validated'
  mapping_version INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_maps_source ON site_maps(source_id);
CREATE INDEX IF NOT EXISTS idx_site_maps_status ON site_maps(status, coverage_percentage);
CREATE INDEX IF NOT EXISTS idx_site_maps_coverage ON site_maps(coverage_percentage DESC);

-- Field extraction tracking (per source)
CREATE TABLE IF NOT EXISTS field_extraction_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES scrape_sources(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  
  -- Extraction metrics
  total_attempts INTEGER DEFAULT 0,
  successful_extractions INTEGER DEFAULT 0,
  extraction_rate DECIMAL(5,4) DEFAULT 0, -- 0-1
  
  -- Data quality
  accuracy_score DECIMAL(5,4) DEFAULT 0, -- 0-1
  confidence_avg DECIMAL(5,4) DEFAULT 0, -- 0-1
  
  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'degraded', 'failing'
  last_extracted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(source_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_field_extraction_source ON field_extraction_stats(source_id, extraction_rate DESC);
CREATE INDEX IF NOT EXISTS idx_field_extraction_status ON field_extraction_stats(status, extraction_rate);

-- Helper function: Get source mapping completeness
CREATE OR REPLACE FUNCTION get_source_mapping_completeness(p_source_id UUID)
RETURNS TABLE (
  source_id UUID,
  domain TEXT,
  coverage_percentage DECIMAL,
  fields_mapped INTEGER,
  total_fields INTEGER,
  missing_fields TEXT[],
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sm.source_id,
    sm.domain,
    sm.coverage_percentage,
    sm.fields_mapped,
    sm.total_fields_available,
    sm.missing_fields,
    sm.status
  FROM site_maps sm
  WHERE sm.source_id = p_source_id;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Get all incomplete mappings
CREATE OR REPLACE FUNCTION get_incomplete_mappings()
RETURNS TABLE (
  source_id UUID,
  domain TEXT,
  coverage_percentage DECIMAL,
  missing_fields TEXT[],
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sm.source_id,
    sm.domain,
    sm.coverage_percentage,
    sm.missing_fields,
    sm.status
  FROM site_maps sm
  WHERE sm.coverage_percentage < 95.0 OR sm.status = 'incomplete'
  ORDER BY sm.coverage_percentage ASC;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE site_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_extraction_stats ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON site_maps FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON field_extraction_stats FOR ALL USING (auth.role() = 'service_role');

