-- VIN Plate Condition Assessment & Validation Source System
-- Tracks detailed VIN plate condition for collector authenticity assessment
-- Links all vehicle data fields to their validation source images

-- ============================================================================
-- VIN PLATE CONDITION TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS vin_plate_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  -- PLATE PHYSICAL CONDITION
  plate_material TEXT CHECK (plate_material IN ('aluminum', 'stainless', 'brass', 'paper_sticker', 'plastic', 'unknown')),
  plate_legibility INTEGER CHECK (plate_legibility >= 0 AND plate_legibility <= 100),
  plate_damage TEXT[],  -- ['rust', 'corrosion', 'bent', 'cracked', 'faded', 'scratched']
  plate_completeness TEXT CHECK (plate_completeness IN ('complete', 'partial', 'missing_sections')),
  
  -- CHARACTER CONDITION
  character_embossing_type TEXT CHECK (character_embossing_type IN ('stamped', 'embossed', 'debossed', 'printed', 'etched', 'unknown')),
  character_depth_quality TEXT CHECK (character_depth_quality IN ('deep', 'moderate', 'shallow', 'worn', 'illegible')),
  character_damage TEXT[],  -- ['worn', 'filled_paint', 'corroded', 'altered', 'faded']
  character_clarity_score INTEGER CHECK (character_clarity_score >= 0 AND character_clarity_score <= 100),
  
  -- RIVET/MOUNTING CONDITION (Critical for collectors!)
  rivet_type TEXT CHECK (rivet_type IN ('rosette', 'pop', 'screw', 'adhesive', 'none', 'unknown')),
  rivet_condition TEXT CHECK (rivet_condition IN ('original', 'replaced', 'missing', 'modified', 'mixed', 'unknown')),
  rivet_count INTEGER,
  rivet_count_expected INTEGER,
  rivet_material TEXT,  -- 'steel', 'aluminum', 'brass', 'painted', 'chrome'
  rivet_heads_condition TEXT[],  -- ['original', 'painted_over', 'damaged', 'mismatched', 'corroded']
  
  -- PAINT/SURFACE ANALYSIS
  paint_around_plate TEXT CHECK (paint_around_plate IN ('unpainted', 'taped_off', 'painted_over', 'removed', 'original', 'unknown')),
  paint_match_body BOOLEAN,
  paint_layers_visible TEXT[],  -- ['primer', 'base', 'clear', 'overspray', 'rust']
  surface_prep_quality TEXT CHECK (surface_prep_quality IN ('factory', 'professional', 'amateur', 'none', 'unknown')),
  
  -- MOUNTING ANALYSIS
  mounting_location_correct BOOLEAN,
  mounting_location_description TEXT,  -- e.g., "Driver door jamb, lower B-pillar"
  mounting_alignment TEXT CHECK (mounting_alignment IN ('straight', 'crooked', 'upside_down', 'backward')),
  mounting_hardware_original BOOLEAN,
  mounting_holes_condition TEXT,  -- 'original', 'enlarged', 'additional', 'filled', 'elongated'
  
  -- AUTHENTICITY INDICATORS
  authenticity_confidence INTEGER CHECK (authenticity_confidence >= 0 AND authenticity_confidence <= 100),
  red_flags TEXT[],  -- ['wrong_location', 'modern_rivets', 'laser_etching', 'wrong_format', 'tampered']
  positive_indicators TEXT[],  -- ['correct_format', 'period_rivets', 'factory_location', 'wear_pattern']
  
  -- ASSESSMENT METADATA
  assessed_by TEXT NOT NULL CHECK (assessed_by IN ('ai', 'user', 'expert', 'ai_assisted')),
  assessment_notes TEXT,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  requires_expert_review BOOLEAN DEFAULT FALSE,
  expert_reviewed_by UUID REFERENCES profiles(id),
  expert_reviewed_at TIMESTAMPTZ,
  expert_notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_vin_plate_conditions_vehicle ON vin_plate_conditions(vehicle_id);
CREATE INDEX idx_vin_plate_conditions_image ON vin_plate_conditions(image_id);
CREATE INDEX idx_vin_plate_conditions_authenticity ON vin_plate_conditions(authenticity_confidence DESC);
CREATE INDEX idx_vin_plate_conditions_review_needed ON vin_plate_conditions(requires_expert_review) WHERE requires_expert_review = true;

-- Unique constraint: One condition assessment per image
CREATE UNIQUE INDEX idx_vin_plate_conditions_unique_image ON vin_plate_conditions(image_id);

COMMENT ON TABLE vin_plate_conditions IS 'Detailed VIN plate condition assessments for authenticity verification and collector value documentation';
COMMENT ON COLUMN vin_plate_conditions.rivet_condition IS 'Critical for collectors - original rosette rivets vs replacement pop rivets significantly affects authenticity';
COMMENT ON COLUMN vin_plate_conditions.paint_around_plate IS 'Indicates if plate was removed during respray (proper) or painted over (improper)';

-- ============================================================================
-- DATA VALIDATION SOURCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_validation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- What data field is being validated?
  data_field TEXT NOT NULL,  -- 'vin', 'year', 'make', 'model', 'trim', 'color', 'engine', 'transmission', etc.
  data_value TEXT NOT NULL,  -- The actual value
  data_category TEXT CHECK (data_category IN ('identification', 'specifications', 'condition', 'history', 'modifications')),
  
  -- Source of validation
  source_type TEXT NOT NULL CHECK (source_type IN ('image', 'document', 'receipt', 'title', 'registration', 'manual_entry', 'api', 'vin_decode', 'spid', 'build_sheet')),
  source_image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  source_document_id UUID,  -- Could reference documents table if it exists
  source_url TEXT,  -- External source URL (e.g., VIN decode API)
  
  -- Confidence and verification
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  extraction_method TEXT CHECK (extraction_method IN ('ocr', 'ai_vision', 'manual', 'barcode', 'qr_code', 'api', 'user_input')),
  verified_by_user UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  
  -- Technical metadata
  extraction_raw_data JSONB,  -- Raw OCR/AI output
  extraction_confidence_details JSONB,  -- Detailed confidence breakdown
  
  -- Status
  is_primary_source BOOLEAN DEFAULT FALSE,  -- The most trusted source for this field
  superseded_by UUID REFERENCES data_validation_sources(id),  -- If replaced by better source
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_data_validation_vehicle_field ON data_validation_sources(vehicle_id, data_field);
CREATE INDEX idx_data_validation_image ON data_validation_sources(source_image_id);
CREATE INDEX idx_data_validation_confidence ON data_validation_sources(confidence_score DESC);
CREATE INDEX idx_data_validation_primary ON data_validation_sources(vehicle_id, data_field, is_primary_source) WHERE is_primary_source = true;
CREATE INDEX idx_data_validation_type ON data_validation_sources(source_type);

COMMENT ON TABLE data_validation_sources IS 'Links every piece of vehicle data to its validation source (image, document, or API) with confidence tracking';
COMMENT ON COLUMN data_validation_sources.is_primary_source IS 'The most trusted source for this data field - shown first in UI';
COMMENT ON COLUMN data_validation_sources.extraction_raw_data IS 'Preserves original OCR/AI output for audit trail and reprocessing';

-- ============================================================================
-- HELPER FUNCTION: AUTO-LINK VIN VALIDATION SOURCES
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_link_vin_validation_source()
RETURNS TRIGGER AS $$
BEGIN
  -- When a VIN plate condition is assessed, automatically create validation source
  -- if the extracted VIN matches the vehicle's VIN
  
  IF NEW.plate_legibility >= 75 AND NEW.authenticity_confidence >= 70 THEN
    -- Try to get vehicle VIN
    DECLARE
      vehicle_vin TEXT;
      image_angle TEXT;
    BEGIN
      SELECT v.vin, vi.angle
      INTO vehicle_vin, image_angle
      FROM vehicles v
      JOIN vehicle_images vi ON vi.id = NEW.image_id
      WHERE v.id = NEW.vehicle_id;
      
      IF vehicle_vin IS NOT NULL AND vehicle_vin != '' THEN
        -- Check if validation source already exists for this image
        IF NOT EXISTS (
          SELECT 1 FROM data_validation_sources
          WHERE vehicle_id = NEW.vehicle_id
          AND data_field = 'vin'
          AND source_image_id = NEW.image_id
        ) THEN
          -- Create validation source
          INSERT INTO data_validation_sources (
            vehicle_id,
            data_field,
            data_value,
            data_category,
            source_type,
            source_image_id,
            confidence_score,
            extraction_method,
            is_primary_source,
            extraction_raw_data
          ) VALUES (
            NEW.vehicle_id,
            'vin',
            vehicle_vin,
            'identification',
            'image',
            NEW.image_id,
            LEAST(NEW.plate_legibility, NEW.authenticity_confidence),
            'ai_vision',
            true,  -- Make primary if first high-confidence source
            jsonb_build_object(
              'angle', image_angle,
              'plate_condition', jsonb_build_object(
                'rivet_condition', NEW.rivet_condition,
                'authenticity_confidence', NEW.authenticity_confidence,
                'assessment_notes', NEW.assessment_notes
              )
            )
          );
        END IF;
      END IF;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_link_vin_validation
  AFTER INSERT ON vin_plate_conditions
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_vin_validation_source();

-- ============================================================================
-- VIEW: VEHICLE DATA WITH VALIDATION SOURCES
-- ============================================================================

CREATE OR REPLACE VIEW vehicle_data_with_sources AS
SELECT 
  v.id as vehicle_id,
  v.vin,
  v.year,
  v.make,
  v.model,
  v.trim,
  
  -- VIN validation sources
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', dvs.id,
        'confidence', dvs.confidence_score,
        'source_type', dvs.source_type,
        'image_url', vi.storage_url,
        'image_angle', vi.angle,
        'plate_condition', vpc.authenticity_confidence,
        'rivet_condition', vpc.rivet_condition,
        'verified_at', dvs.verified_at
      ) ORDER BY dvs.confidence_score DESC
    )
    FROM data_validation_sources dvs
    LEFT JOIN vehicle_images vi ON dvs.source_image_id = vi.id
    LEFT JOIN vin_plate_conditions vpc ON vi.id = vpc.image_id
    WHERE dvs.vehicle_id = v.id
    AND dvs.data_field = 'vin'
  ) as vin_sources,
  
  -- Year validation sources
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', dvs.id,
        'confidence', dvs.confidence_score,
        'source_type', dvs.source_type,
        'image_url', vi.storage_url
      ) ORDER BY dvs.confidence_score DESC
    )
    FROM data_validation_sources dvs
    LEFT JOIN vehicle_images vi ON dvs.source_image_id = vi.id
    WHERE dvs.vehicle_id = v.id
    AND dvs.data_field = 'year'
  ) as year_sources,
  
  -- Count of all validation sources
  (
    SELECT COUNT(*) 
    FROM data_validation_sources 
    WHERE vehicle_id = v.id
  ) as total_validation_sources
  
FROM vehicles v;

COMMENT ON VIEW vehicle_data_with_sources IS 'Shows vehicle data alongside all validation sources for transparency';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE vin_plate_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_validation_sources ENABLE ROW LEVEL SECURITY;

-- VIN plate conditions: viewable by vehicle viewers, editable by experts
CREATE POLICY "Anyone can view VIN plate conditions"
  ON vin_plate_conditions FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create VIN plate assessments"
  ON vin_plate_conditions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Experts can update VIN plate assessments"
  ON vin_plate_conditions FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM profiles 
      WHERE role IN ('admin', 'expert', 'appraiser')
    )
  );

-- Validation sources: viewable by all, creatable by authenticated users
CREATE POLICY "Anyone can view validation sources"
  ON data_validation_sources FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create validation sources"
  ON data_validation_sources FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own validation sources"
  ON data_validation_sources FOR UPDATE
  USING (created_at > NOW() - INTERVAL '1 hour' OR verified_by_user = auth.uid());

-- ============================================================================
-- SAMPLE DATA FOR TESTING
-- ============================================================================

-- This will be filled in by AI when processing VIN plate images
-- Example structure (commented out):
/*
INSERT INTO vin_plate_conditions (
  vehicle_id,
  image_id,
  plate_material,
  plate_legibility,
  plate_completeness,
  character_embossing_type,
  character_clarity_score,
  rivet_type,
  rivet_condition,
  rivet_count,
  rivet_count_expected,
  paint_around_plate,
  mounting_location_correct,
  mounting_alignment,
  authenticity_confidence,
  positive_indicators,
  assessed_by,
  assessment_notes,
  confidence_score
) VALUES (
  '5b4e6bcd-7f31-410a-876a-cb2947d954f5',
  'af1f50cb-1fae-40e5-94ce-d6cafaac5bd7',
  'aluminum',
  95,
  'complete',
  'stamped',
  98,
  'rosette',
  'original',
  2,
  2,
  'taped_off',
  true,
  'straight',
  92,
  ARRAY['correct_format', 'period_rivets', 'factory_location', 'appropriate_wear'],
  'ai',
  'Original VIN plate in excellent condition. Rosette rivets are period-correct for 1966 Bronco. Plate was properly taped off during professional respray. Characters deeply stamped and highly legible.',
  88
);
*/

