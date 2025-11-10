-- Intelligent Data Annotation System
-- Cherry-picked from 20250913_multi_source_verification.sql
-- Tracks multiple sources for each vehicle data point with verification levels

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Vehicle field sources table - tracks data provenance for every field
CREATE TABLE IF NOT EXISTS vehicle_field_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  
  -- Source information
  source_type TEXT NOT NULL CHECK (source_type IN (
    'ai_scraped',      -- Web scraping, AI extraction
    'user_input',      -- User provided
    'db_average',      -- Average from database
    'human_verified',  -- Human inspection/service  
    'professional'     -- Professional diagnostic tools
  )),
  source_name TEXT,           -- e.g., "KBB.com", "Owner", "Mechanic Shop Name"
  source_url TEXT,            -- URL if scraped from web
  
  -- Verification details
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  verification_details TEXT,   -- Additional context about verification
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  
  -- Service/inspection details (for human_verified and professional)
  service_id UUID,             -- Link to service record if applicable
  inspection_type TEXT,        -- Type of inspection/service performed
  diagnostic_codes TEXT[],     -- OBD codes or other diagnostic data
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate sources for same field
  UNIQUE(vehicle_id, field_name, source_type, source_name)
);

-- 2. Data source configurations for web scraping
CREATE TABLE IF NOT EXISTS data_source_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('web_scraper', 'api', 'manual_entry')),
  base_url TEXT,
  
  -- Scraping configuration
  scraping_config JSONB DEFAULT '{}', -- CSS selectors, API endpoints, etc.
  rate_limit_ms INTEGER DEFAULT 1000, -- Milliseconds between requests
  
  -- Data mapping
  field_mappings JSONB DEFAULT '{}',   -- Maps scraped data to vehicle fields
  
  -- Quality settings
  default_confidence_score INTEGER DEFAULT 70,
  requires_human_verification BOOLEAN DEFAULT false,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_successful_scrape TIMESTAMPTZ,
  error_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Vehicle status metadata for discovery and completeness tracking
CREATE TABLE IF NOT EXISTS vehicle_status_metadata (
    vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    
    -- Status indicators
    status TEXT CHECK (status IN (
        'needs_data',
        'active_work', 
        'for_sale',
        'verified_profile',
        'open_contributions',
        'professional_serviced'
    )),
    
    -- Data completeness tracking
    data_completeness_score INTEGER DEFAULT 0 CHECK (data_completeness_score >= 0 AND data_completeness_score <= 100),
    missing_fields TEXT[], -- Array of field names that need data
    
    -- Verification metrics
    verification_level TEXT CHECK (verification_level IN ('none', 'ai_only', 'human_verified', 'professional_verified')),
    professional_verifications_count INTEGER DEFAULT 0,
    contributor_count INTEGER DEFAULT 0,
    
    -- Activity metrics
    last_activity_at TIMESTAMPTZ,
    activity_heat_score INTEGER DEFAULT 0, -- 0-100 scale of recent activity
    timeline_event_count INTEGER DEFAULT 0,
    photos_count INTEGER DEFAULT 0,
    
    -- Engagement metrics
    views_this_week INTEGER DEFAULT 0,
    views_this_month INTEGER DEFAULT 0,
    views_total INTEGER DEFAULT 0,
    active_discussions_count INTEGER DEFAULT 0,
    pending_questions_count INTEGER DEFAULT 0,
    
    -- Contribution opportunities
    needs_photos BOOLEAN DEFAULT false,
    needs_specifications BOOLEAN DEFAULT false,
    needs_history BOOLEAN DEFAULT false,
    needs_maintenance_records BOOLEAN DEFAULT false,
    needs_professional_inspection BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_field_sources_vehicle ON vehicle_field_sources(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_field_sources_field ON vehicle_field_sources(field_name);
CREATE INDEX IF NOT EXISTS idx_vehicle_field_sources_type ON vehicle_field_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_field_sources_confidence ON vehicle_field_sources(confidence_score);

CREATE INDEX IF NOT EXISTS idx_data_source_configs_active ON data_source_configs(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_data_source_configs_type ON data_source_configs(source_type);

CREATE INDEX IF NOT EXISTS idx_vehicle_status_metadata_status ON vehicle_status_metadata(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_status_metadata_completeness ON vehicle_status_metadata(data_completeness_score);
CREATE INDEX IF NOT EXISTS idx_vehicle_status_metadata_verification ON vehicle_status_metadata(verification_level);

-- 5. Enable RLS
ALTER TABLE vehicle_field_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_source_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_status_metadata ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for vehicle_field_sources
DROP POLICY IF EXISTS "Public read access to field sources" ON vehicle_field_sources;
CREATE POLICY "Public read access to field sources" ON vehicle_field_sources
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Vehicle contributors can add field sources" ON vehicle_field_sources;
CREATE POLICY "Vehicle contributors can add field sources" ON vehicle_field_sources
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_field_sources.vehicle_id 
            AND v.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id 
            AND vup.user_id = auth.uid() 
            AND vup.is_active = true
        )
    );

DROP POLICY IF EXISTS "Vehicle contributors can update field sources" ON vehicle_field_sources;
CREATE POLICY "Vehicle contributors can update field sources" ON vehicle_field_sources
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_field_sources.vehicle_id 
            AND v.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id 
            AND vup.user_id = auth.uid() 
            AND vup.is_active = true
        )
    );

-- 7. RLS Policies for data_source_configs (admin only)
DROP POLICY IF EXISTS "Admins can manage data source configs" ON data_source_configs;
CREATE POLICY "Admins can manage data source configs" ON data_source_configs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_users au
            WHERE au.user_id = auth.uid() AND au.is_active = true
        )
    );

-- 8. RLS Policies for vehicle_status_metadata
DROP POLICY IF EXISTS "Public read access to vehicle status" ON vehicle_status_metadata;
CREATE POLICY "Public read access to vehicle status" ON vehicle_status_metadata
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Vehicle contributors can update status metadata" ON vehicle_status_metadata;
CREATE POLICY "Vehicle contributors can update status metadata" ON vehicle_status_metadata
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_status_metadata.vehicle_id 
            AND v.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_status_metadata.vehicle_id 
            AND vup.user_id = auth.uid() 
            AND vup.is_active = true
        )
    );

-- 9. Functions for data completeness calculation
DROP FUNCTION IF EXISTS calculate_vehicle_data_completeness(UUID);

CREATE OR REPLACE FUNCTION calculate_vehicle_data_completeness(p_vehicle_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_fields INTEGER := 20; -- Adjust based on your vehicle schema
    filled_fields INTEGER := 0;
    completeness_score INTEGER;
BEGIN
    -- Count non-null, non-empty fields in vehicles table
    SELECT 
        CASE WHEN make IS NOT NULL AND make != '' THEN 1 ELSE 0 END +
        CASE WHEN model IS NOT NULL AND model != '' THEN 1 ELSE 0 END +
        CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END +
        CASE WHEN color IS NOT NULL AND color != '' THEN 1 ELSE 0 END +
        CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN fuel_type IS NOT NULL AND fuel_type != '' THEN 1 ELSE 0 END +
        CASE WHEN transmission IS NOT NULL AND transmission != '' THEN 1 ELSE 0 END +
        CASE WHEN engine_size IS NOT NULL AND engine_size != '' THEN 1 ELSE 0 END +
        CASE WHEN horsepower IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN torque IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN drivetrain IS NOT NULL AND drivetrain != '' THEN 1 ELSE 0 END +
        CASE WHEN body_style IS NOT NULL AND body_style != '' THEN 1 ELSE 0 END +
        CASE WHEN doors IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN seats IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN weight_lbs IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN mpg_city IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN mpg_highway IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN msrp IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN current_value IS NOT NULL THEN 1 ELSE 0 END
    INTO filled_fields
    FROM vehicles 
    WHERE id = p_vehicle_id;
    
    completeness_score := (filled_fields * 100) / total_fields;
    
    -- Update the metadata table
    INSERT INTO vehicle_status_metadata (vehicle_id, data_completeness_score, updated_at)
    VALUES (p_vehicle_id, completeness_score, NOW())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
        data_completeness_score = completeness_score,
        updated_at = NOW();
    
    RETURN completeness_score;
END;
$$ LANGUAGE plpgsql;

-- 10. Function to get the best value for a field (highest confidence)
DROP FUNCTION IF EXISTS get_best_field_value(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_best_field_value(p_vehicle_id UUID, p_field_name TEXT)
RETURNS TABLE(field_value TEXT, source_type TEXT, confidence_score INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vfs.field_value,
        vfs.source_type,
        vfs.confidence_score
    FROM vehicle_field_sources vfs
    WHERE vfs.vehicle_id = p_vehicle_id 
    AND vfs.field_name = p_field_name
    ORDER BY vfs.confidence_score DESC, vfs.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 11. Trigger to update vehicle status when data changes
DROP TRIGGER IF EXISTS update_vehicle_status_trigger ON vehicles;

DROP FUNCTION IF EXISTS trigger_update_vehicle_status();

CREATE OR REPLACE FUNCTION trigger_update_vehicle_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate data completeness
    PERFORM calculate_vehicle_data_completeness(NEW.id);
    
    -- Update last activity
    INSERT INTO vehicle_status_metadata (vehicle_id, last_activity_at, updated_at)
    VALUES (NEW.id, NOW(), NOW())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
        last_activity_at = NOW(),
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vehicle_status_trigger
    AFTER INSERT OR UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_vehicle_status();

-- Comments
COMMENT ON TABLE vehicle_field_sources IS 'Tracks multiple sources and verification levels for each vehicle data field';
COMMENT ON TABLE data_source_configs IS 'Configuration for automated data scraping sources';
COMMENT ON TABLE vehicle_status_metadata IS 'Tracks vehicle data completeness, verification levels, and engagement metrics';
COMMENT ON FUNCTION calculate_vehicle_data_completeness IS 'Calculates and updates vehicle data completeness score';
COMMENT ON FUNCTION get_best_field_value IS 'Returns the highest confidence value for a vehicle field from multiple sources';
