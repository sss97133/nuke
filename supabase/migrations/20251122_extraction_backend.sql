-- AI Extraction Backend - Where Parsed Data Goes
-- This creates the complete pipeline from document upload → AI extraction → user review → database population

-- ============================================
-- EXTRACTION STORAGE (Temporary Review Queue)
-- ============================================

-- Already created, but ensure all columns exist
CREATE TABLE IF NOT EXISTS document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  -- RAW AI EXTRACTION (full JSON dump from GPT-4)
  extracted_data JSONB NOT NULL,
  
  -- VALIDATION QUESTIONS (conflicts, low confidence, clarifications)
  validation_questions JSONB,
  
  -- USER REVIEW (corrections, confirmations)
  user_corrections JSONB,
  user_notes TEXT,
  
  -- STATUS TRACKING
  status TEXT DEFAULT 'pending_review',  
  -- 'pending_review' → User needs to review
  -- 'approved' → User confirmed, ready to apply
  -- 'applied' → Applied to oem_vehicle_specs
  -- 'rejected' → User rejected extraction
  
  -- REVIEW TRACKING
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  
  -- APPLICATION TRACKING
  applied_to_specs BOOLEAN DEFAULT FALSE,
  applied_spec_id UUID REFERENCES oem_vehicle_specs(id),
  applied_at TIMESTAMP WITH TIME ZONE,
  
  -- TIMESTAMPS
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extractions_doc ON document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_extractions_status ON document_extractions(status);
CREATE INDEX IF NOT EXISTS idx_extractions_pending ON document_extractions(status) WHERE status = 'pending_review';

-- ============================================
-- FIELD-LEVEL PROOF LINKING
-- ============================================

-- Links individual spec fields to their source document pages
CREATE TABLE IF NOT EXISTS spec_field_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHAT spec this proves
  spec_id UUID NOT NULL REFERENCES oem_vehicle_specs(id) ON DELETE CASCADE,
  
  -- WHERE the proof comes from
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  extraction_id UUID REFERENCES document_extractions(id),
  
  -- WHICH FIELD
  field_name TEXT NOT NULL,  -- 'horsepower', 'wheelbase', 'paint_codes', etc.
  field_value TEXT NOT NULL,
  field_type TEXT,           -- 'numeric', 'text', 'array', 'object'
  
  -- WHERE IN DOCUMENT
  page_number INTEGER,
  section_name TEXT,         -- "Engine Specifications", "Standard Colors"
  excerpt_text TEXT,         -- Actual text from document
  bounding_box JSONB,        -- {x, y, width, height} for highlighting
  
  -- HOW CONFIDENT
  extraction_method TEXT DEFAULT 'gpt4',  -- 'gpt4', 'gpt4_vision', 'ocr', 'manual'
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  
  -- VERIFICATION
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  verification_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_spec_field_proof UNIQUE (spec_id, document_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_field_proofs_spec ON spec_field_proofs(spec_id);
CREATE INDEX IF NOT EXISTS idx_field_proofs_doc ON spec_field_proofs(document_id);
CREATE INDEX IF NOT EXISTS idx_field_proofs_field ON spec_field_proofs(field_name);
CREATE INDEX IF NOT EXISTS idx_field_proofs_unverified ON spec_field_proofs(is_verified) WHERE is_verified = FALSE;

-- ============================================
-- EXTRACTED COLORS (Dedicated Table)
-- ============================================

-- Paint colors extracted from brochures
CREATE TABLE IF NOT EXISTS extracted_paint_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- SOURCE
  extraction_id UUID NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  -- WHAT YMM this applies to
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  series TEXT,
  
  -- COLOR DATA
  color_code TEXT NOT NULL,      -- "70", "67", "11"
  color_name TEXT NOT NULL,      -- "Cardinal Red", "Nevada Gold"
  color_family TEXT,             -- "red", "gold", "blue"
  hex_color TEXT,                -- "#C41E3A" (approximate)
  is_metallic BOOLEAN DEFAULT FALSE,
  is_two_tone BOOLEAN DEFAULT FALSE,
  two_tone_variant TEXT,         -- "conventional" or "special"
  
  -- INTERIOR vs EXTERIOR
  application TEXT DEFAULT 'exterior',  -- 'exterior', 'interior', 'both'
  
  -- VERIFICATION
  is_verified BOOLEAN DEFAULT FALSE,
  confidence INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_paint_color UNIQUE (year, make, series, color_code, application)
);

CREATE INDEX IF NOT EXISTS idx_paint_colors_ymm ON extracted_paint_colors(year, make, series);
CREATE INDEX IF NOT EXISTS idx_paint_colors_code ON extracted_paint_colors(color_code);

-- ============================================
-- EXTRACTED OPTIONS/RPO CODES
-- ============================================

CREATE TABLE IF NOT EXISTS extracted_rpo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- SOURCE
  extraction_id UUID NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  -- APPLICABILITY
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  series TEXT,
  year_range_start INTEGER,
  year_range_end INTEGER,
  
  -- RPO DATA
  rpo_code TEXT NOT NULL,        -- "Z62", "YE9", "G80"
  description TEXT NOT NULL,
  category TEXT,                 -- 'engine', 'transmission', 'interior', 'exterior', 'chassis', 'wheels'
  
  -- DETAILS
  is_standard BOOLEAN DEFAULT FALSE,
  is_optional BOOLEAN DEFAULT TRUE,
  price NUMERIC(10,2),           -- If price shown in brochure
  notes TEXT,
  
  -- VERIFICATION
  is_verified BOOLEAN DEFAULT FALSE,
  confidence INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_rpo UNIQUE (year, make, series, rpo_code)
);

CREATE INDEX IF NOT EXISTS idx_rpo_ymm ON extracted_rpo_codes(year, make, series);
CREATE INDEX IF NOT EXISTS idx_rpo_code ON extracted_rpo_codes(rpo_code);
CREATE INDEX IF NOT EXISTS idx_rpo_category ON extracted_rpo_codes(category);

-- ============================================
-- FUNCTIONS: Apply Extraction to OEM Specs
-- ============================================

-- Apply approved extraction to oem_vehicle_specs table
CREATE OR REPLACE FUNCTION apply_extraction_to_specs(p_extraction_id UUID, p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_extraction RECORD;
  v_doc RECORD;
  v_library RECORD;
  v_spec_id UUID;
  v_extracted JSONB;
BEGIN
  -- Get extraction
  SELECT * INTO v_extraction
  FROM document_extractions
  WHERE id = p_extraction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extraction not found';
  END IF;
  
  -- Get document and library
  SELECT ld.*, rl.year, rl.make, rl.series, rl.body_style
  INTO v_doc
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  WHERE ld.id = v_extraction.document_id;
  
  v_extracted := COALESCE(v_extraction.user_corrections, v_extraction.extracted_data);
  
  -- Find or create OEM spec entry
  SELECT id INTO v_spec_id
  FROM oem_vehicle_specs
  WHERE make ILIKE v_doc.make
    AND year_start <= v_doc.year
    AND (year_end IS NULL OR year_end >= v_doc.year)
    AND (series = v_doc.series OR series IS NULL)
  LIMIT 1;
  
  -- Create if doesn't exist
  IF v_spec_id IS NULL THEN
    INSERT INTO oem_vehicle_specs (
      make, model, year_start, series, body_style, source
    ) VALUES (
      v_doc.make,
      v_doc.series || ' ' || COALESCE(v_doc.body_style, ''),
      v_doc.year,
      v_doc.series,
      v_doc.body_style,
      'Reference Library Extraction'
    )
    RETURNING id INTO v_spec_id;
  END IF;
  
  -- Update OEM spec with extracted data
  UPDATE oem_vehicle_specs
  SET
    -- Dimensions
    wheelbase_inches = COALESCE(wheelbase_inches, (v_extracted->'specifications'->'dimensions'->>'wheelbase')::NUMERIC),
    length_inches = COALESCE(length_inches, (v_extracted->'specifications'->'dimensions'->>'length')::NUMERIC),
    width_inches = COALESCE(width_inches, (v_extracted->'specifications'->'dimensions'->>'width')::NUMERIC),
    height_inches = COALESCE(height_inches, (v_extracted->'specifications'->'dimensions'->>'height')::NUMERIC),
    ground_clearance_inches = COALESCE(ground_clearance_inches, (v_extracted->'specifications'->'dimensions'->>'ground_clearance')::NUMERIC),
    
    -- Weights
    curb_weight_lbs = COALESCE(curb_weight_lbs, (v_extracted->'specifications'->'weights'->>'curb_weight')::INTEGER),
    gross_vehicle_weight_lbs = COALESCE(gross_vehicle_weight_lbs, (v_extracted->'specifications'->'weights'->>'gvwr')::INTEGER),
    payload_capacity_lbs = COALESCE(payload_capacity_lbs, (v_extracted->'specifications'->'weights'->>'payload')::INTEGER),
    towing_capacity_lbs = COALESCE(towing_capacity_lbs, (v_extracted->'specifications'->'weights'->>'towing_capacity')::INTEGER),
    
    -- Engine (first engine from array)
    engine_size = COALESCE(engine_size, (v_extracted->'specifications'->'engines'->0->>'displacement_cid') || ' CID'),
    horsepower = COALESCE(horsepower, (v_extracted->'specifications'->'engines'->0->>'horsepower')::INTEGER),
    torque_ft_lbs = COALESCE(torque_ft_lbs, (v_extracted->'specifications'->'engines'->0->>'torque')::INTEGER),
    engine_config = COALESCE(engine_config, v_extracted->'specifications'->'engines'->0->>'configuration'),
    
    -- Source tracking
    source_library_id = v_doc.library_id,
    source_documents = array_append(COALESCE(source_documents, ARRAY[]::UUID[]), v_extraction.document_id),
    verification_status = 'factory_verified',
    confidence_score = 95,
    
    updated_at = NOW()
  WHERE id = v_spec_id;
  
  -- Mark extraction as applied
  UPDATE document_extractions
  SET 
    status = 'applied',
    applied_to_specs = TRUE,
    applied_spec_id = v_spec_id,
    applied_at = NOW(),
    reviewed_by = p_user_id,
    reviewed_at = NOW()
  WHERE id = p_extraction_id;
  
  RETURN v_spec_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_field_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_paint_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_rpo_codes ENABLE ROW LEVEL SECURITY;

-- Users can see extractions for their uploaded documents
CREATE POLICY "extractions_owner_read" ON document_extractions
  FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT id FROM library_documents WHERE uploaded_by = auth.uid()
    )
  );

CREATE POLICY "extractions_owner_update" ON document_extractions
  FOR UPDATE TO authenticated
  USING (
    document_id IN (
      SELECT id FROM library_documents WHERE uploaded_by = auth.uid()
    )
  );

-- Everyone can read proofs
CREATE POLICY "proofs_read_all" ON spec_field_proofs
  FOR SELECT TO public
  USING (true);

-- Authenticated can create proofs
CREATE POLICY "proofs_create" ON spec_field_proofs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Everyone can read extracted colors
CREATE POLICY "colors_read_all" ON extracted_paint_colors
  FOR SELECT TO public
  USING (true);

-- Everyone can read extracted RPO codes
CREATE POLICY "rpo_read_all" ON extracted_rpo_codes
  FOR SELECT TO public
  USING (true);

-- ============================================
-- VIEWS FOR EASY QUERYING
-- ============================================

-- View: Pending extractions needing review
CREATE OR REPLACE VIEW pending_document_reviews AS
SELECT 
  de.id as extraction_id,
  de.document_id,
  ld.title as document_title,
  ld.document_type,
  rl.year,
  rl.make,
  rl.series,
  rl.body_style,
  de.extracted_data,
  de.validation_questions,
  de.extracted_at,
  p.full_name as uploader_name
FROM document_extractions de
JOIN library_documents ld ON ld.id = de.document_id
JOIN reference_libraries rl ON rl.id = ld.library_id
LEFT JOIN profiles p ON p.id = ld.uploaded_by
WHERE de.status = 'pending_review'
ORDER BY de.extracted_at DESC;

-- View: Applied extractions with their impact
CREATE OR REPLACE VIEW applied_extractions_impact AS
SELECT 
  de.id as extraction_id,
  de.document_id,
  ld.title as document_title,
  de.applied_spec_id,
  os.make,
  os.series,
  os.year_start,
  COUNT(DISTINCT sfp.id) as fields_proven,
  de.applied_at,
  p.full_name as reviewed_by_name
FROM document_extractions de
JOIN library_documents ld ON ld.id = de.document_id
LEFT JOIN oem_vehicle_specs os ON os.id = de.applied_spec_id
LEFT JOIN spec_field_proofs sfp ON sfp.spec_id = os.id AND sfp.document_id = ld.id
LEFT JOIN profiles p ON p.id = de.reviewed_by
WHERE de.status = 'applied'
GROUP BY de.id, ld.title, os.make, os.series, os.year_start, de.applied_at, p.full_name
ORDER BY de.applied_at DESC;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get extraction summary for review UI
CREATE OR REPLACE FUNCTION get_extraction_summary(p_extraction_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_extraction RECORD;
  v_summary JSONB;
BEGIN
  SELECT * INTO v_extraction
  FROM document_extractions
  WHERE id = p_extraction_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  v_summary := jsonb_build_object(
    'extraction_id', v_extraction.id,
    'status', v_extraction.status,
    'engines_found', jsonb_array_length(v_extraction.extracted_data->'specifications'->'engines'),
    'colors_found', jsonb_array_length(v_extraction.extracted_data->'colors'),
    'options_found', jsonb_array_length(v_extraction.extracted_data->'options'),
    'trim_levels_found', jsonb_array_length(v_extraction.extracted_data->'trim_levels'),
    'has_dimensions', (v_extraction.extracted_data->'specifications'->'dimensions') IS NOT NULL,
    'has_weights', (v_extraction.extracted_data->'specifications'->'weights') IS NOT NULL,
    'questions_count', jsonb_array_length(v_extraction.validation_questions),
    'extracted_at', v_extraction.extracted_at
  );
  
  RETURN v_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE document_extractions IS 'AI-extracted data from reference documents awaiting user review';
COMMENT ON TABLE spec_field_proofs IS 'Links individual spec fields to their source document pages (proof system)';
COMMENT ON TABLE extracted_paint_colors IS 'Paint colors extracted from factory brochures and paint charts';
COMMENT ON TABLE extracted_rpo_codes IS 'RPO option codes extracted from factory documentation';
COMMENT ON FUNCTION apply_extraction_to_specs IS 'Apply approved extraction to oem_vehicle_specs table';
COMMENT ON VIEW pending_document_reviews IS 'Queue of extractions pending user review';
COMMENT ON VIEW applied_extractions_impact IS 'History of applied extractions and their impact';

