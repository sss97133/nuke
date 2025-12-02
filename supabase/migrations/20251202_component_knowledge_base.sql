-- Component Knowledge Base - Foundation for Expert-Level Analysis
-- Defines what components exist, how to identify them, and tracks knowledge gaps
-- Migration: 20251202_component_knowledge_base

-- ============================================
-- COMPONENT DEFINITIONS
-- ============================================

-- Master list of components that can exist on vehicles
CREATE TABLE IF NOT EXISTS component_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- APPLICABILITY
  make TEXT NOT NULL,
  model_family TEXT, -- 'C/K', 'Corvette', 'Camaro'
  year_range_start INTEGER NOT NULL,
  year_range_end INTEGER NOT NULL,
  series TEXT[], -- ['C10', 'C20', 'K10', 'K20']
  body_styles TEXT[], -- ['Pickup', 'Suburban', 'Blazer']
  
  -- COMPONENT IDENTIFICATION
  component_category TEXT NOT NULL, -- 'body', 'trim', 'glass', 'wheels', 'mechanical', 'electrical'
  component_name TEXT NOT NULL, -- 'grille', 'front_bumper', 'fender_emblem'
  component_subcategory TEXT, -- 'exterior_trim', 'lighting', 'molding'
  
  -- VISUAL IDENTIFICATION (how to recognize it in images)
  visual_identifiers JSONB, -- { "shape": "rectangular", "location": "front center", "unique_features": ["chrome trim", "horizontal bars"] }
  distinguishing_features TEXT[], -- ["chrome surround", "6 horizontal bars", "bowtie emblem center"]
  common_variations TEXT[], -- ["with trim", "without trim", "painted", "chrome"]
  
  -- PART INFORMATION
  oem_part_numbers TEXT[], -- Known factory part numbers
  common_aftermarket_brands TEXT[], -- ["LMC Truck", "Brothers", "Goodmark"]
  superseded_by TEXT, -- If part was replaced by another component
  
  -- TRIM PACKAGE ASSOCIATIONS
  standard_on_trims TEXT[], -- ['Scottsdale', 'Cheyenne', 'Silverado']
  optional_on_trims TEXT[],
  not_available_on_trims TEXT[],
  related_rpo_codes TEXT[], -- RPO codes that include this component
  
  -- REFERENCE SOURCES
  source_documents UUID[], -- Links to library_documents
  reference_pages JSONB, -- { "doc_id": "xxx", "pages": [42, 43] }
  
  -- IMPORTANCE FOR ANALYSIS
  identification_priority INTEGER DEFAULT 5, -- 1-10, how important to identify this
  year_dating_significance INTEGER DEFAULT 0, -- 0-10, how much this helps date the vehicle
  trim_identification_value INTEGER DEFAULT 0, -- 0-10, how much this indicates trim level
  originality_indicator INTEGER DEFAULT 0, -- 0-10, how much this proves OEM vs modified
  
  -- METADATA
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  verified_by UUID REFERENCES auth.users(id),
  is_verified BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_component_def UNIQUE (make, model_family, component_name, year_range_start, year_range_end)
);

CREATE INDEX idx_component_defs_make_model ON component_definitions(make, model_family);
CREATE INDEX idx_component_defs_year ON component_definitions(year_range_start, year_range_end);
CREATE INDEX idx_component_defs_category ON component_definitions(component_category);
CREATE INDEX idx_component_defs_name ON component_definitions(component_name);
CREATE INDEX idx_component_defs_priority ON component_definitions(identification_priority DESC);

-- ============================================
-- KNOWLEDGE GAPS
-- ============================================

-- Track what reference data is missing and blocking analysis
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHERE WAS THIS GAP DISCOVERED
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  discovered_during_analysis_id UUID, -- Links to image_analysis_records when created
  discovered_by UUID REFERENCES auth.users(id),
  
  -- WHAT VEHICLE/CONTEXT TRIGGERED THIS
  vehicle_context JSONB, -- { year, make, model, series, trim }
  
  -- THE GAP
  gap_type TEXT NOT NULL, -- 'missing_reference', 'ambiguous_component', 'unknown_variation', 'conflicting_sources'
  description TEXT NOT NULL,
  affected_components TEXT[], -- Which components can't be identified without this
  
  -- WHAT WOULD RESOLVE IT
  required_reference_type TEXT, -- 'assembly_manual', 'parts_catalog', 'rpo_guide', 'paint_chart'
  required_reference_title TEXT, -- "1981-1987 C/K Assembly Manual - Body Chapter"
  required_reference_specificity TEXT, -- What specific pages/sections needed
  
  -- PRIORITY (auto-calculated based on impact)
  priority INTEGER DEFAULT 5, -- 1-10
  impact_count INTEGER DEFAULT 1, -- How many analyses blocked by this
  last_encountered TIMESTAMPTZ DEFAULT NOW(),
  
  -- RESOLUTION
  status TEXT DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'wont_fix'
  resolved_at TIMESTAMPTZ,
  resolved_by_document_id UUID REFERENCES library_documents(id),
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_gaps_status ON knowledge_gaps(status) WHERE status = 'open';
CREATE INDEX idx_knowledge_gaps_priority ON knowledge_gaps(priority DESC);
CREATE INDEX idx_knowledge_gaps_impact ON knowledge_gaps(impact_count DESC);
CREATE INDEX idx_knowledge_gaps_vehicle ON knowledge_gaps((vehicle_context->>'make'), (vehicle_context->>'model_family'));

-- ============================================
-- REFERENCE COVERAGE TRACKING
-- ============================================

-- Track what reference data we have vs need for each YMM
CREATE TABLE IF NOT EXISTS reference_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- SCOPE
  make TEXT NOT NULL,
  model_family TEXT NOT NULL,
  year_range_start INTEGER NOT NULL,
  year_range_end INTEGER NOT NULL,
  
  -- TOPIC COVERAGE
  topic TEXT NOT NULL, -- 'body_panels', 'trim_packages', 'electrical', 'mechanical', 'paint_codes', 'rpo_codes'
  coverage_status TEXT DEFAULT 'missing', -- 'complete', 'partial', 'missing'
  coverage_percentage INTEGER DEFAULT 0, -- 0-100
  
  -- WHAT WE HAVE
  available_documents UUID[], -- reference to library_documents
  available_sources JSONB, -- { "assembly_manual": true, "parts_catalog": false }
  
  -- WHAT WE NEED
  missing_references TEXT[], -- List of needed but unavailable documents
  gap_description TEXT, -- What specifically is missing
  
  -- IMPACT
  blocked_analyses_count INTEGER DEFAULT 0, -- How many analyses can't complete due to gaps
  
  -- TRACKING
  last_assessed TIMESTAMPTZ DEFAULT NOW(),
  assessed_by UUID REFERENCES auth.users(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_coverage_topic UNIQUE (make, model_family, year_range_start, year_range_end, topic)
);

CREATE INDEX idx_ref_coverage_make_model ON reference_coverage(make, model_family);
CREATE INDEX idx_ref_coverage_year ON reference_coverage(year_range_start, year_range_end);
CREATE INDEX idx_ref_coverage_topic ON reference_coverage(topic);
CREATE INDEX idx_ref_coverage_status ON reference_coverage(coverage_status);
CREATE INDEX idx_ref_coverage_incomplete ON reference_coverage(coverage_status) WHERE coverage_status != 'complete';

-- ============================================
-- IMAGE ANALYSIS RECORDS (with epistemic tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS image_analysis_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHAT WAS ANALYZED
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- ANALYSIS CONTEXT
  analysis_tier INTEGER NOT NULL, -- 1, 2, 3, etc.
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_by_model TEXT, -- 'claude-3-haiku', 'gpt-4o', etc.
  
  -- REFERENCE AVAILABILITY AT TIME OF ANALYSIS
  references_available UUID[], -- library_documents that were indexed
  references_used UUID[], -- which docs were actually consulted
  references_missing TEXT[], -- what was needed but unavailable
  reference_coverage_snapshot JSONB, -- snapshot of coverage at analysis time
  
  -- THE FINDINGS (epistemic categories)
  confirmed_findings JSONB, -- Facts backed by citations
  inferred_findings JSONB, -- Reasonable conclusions without citations
  unknown_items JSONB, -- Things that couldn't be determined
  
  -- KNOWLEDGE GAPS DISCOVERED
  gaps_discovered UUID[], -- Links to knowledge_gaps
  
  -- HANDOFF FOR FUTURE ANALYSIS
  research_queue JSONB, -- Prioritized list of needed references
  handoff_notes TEXT, -- Free-form notes for next analysis pass
  reanalysis_triggers TEXT[], -- Conditions that should trigger re-analysis
  
  -- AUDIT TRAIL
  supersedes UUID REFERENCES image_analysis_records(id), -- Previous analysis
  superseded_by UUID REFERENCES image_analysis_records(id), -- Newer analysis
  superseded_at TIMESTAMPTZ,
  superseded_reason TEXT, -- Why re-analysis was needed
  
  -- QUALITY METRICS
  overall_confidence DECIMAL,
  citation_count INTEGER DEFAULT 0,
  inference_count INTEGER DEFAULT 0,
  unknown_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_records_image ON image_analysis_records(image_id);
CREATE INDEX idx_analysis_records_vehicle ON image_analysis_records(vehicle_id);
CREATE INDEX idx_analysis_records_tier ON image_analysis_records(analysis_tier);
CREATE INDEX idx_analysis_records_current ON image_analysis_records(image_id, analysis_tier) WHERE superseded_by IS NULL;

-- ============================================
-- COMPONENT IDENTIFICATIONS (per-image findings)
-- ============================================

CREATE TABLE IF NOT EXISTS component_identifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- LINKS
  analysis_record_id UUID NOT NULL REFERENCES image_analysis_records(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  component_definition_id UUID REFERENCES component_definitions(id), -- NULL if not in our database yet
  
  -- THE IDENTIFICATION
  component_type TEXT NOT NULL, -- 'grille', 'bumper', 'wheel', etc.
  identification TEXT, -- What we think it is
  part_number TEXT, -- If identifiable
  brand TEXT, -- If applicable (aftermarket)
  
  -- EPISTEMIC STATUS
  status TEXT NOT NULL, -- 'confirmed', 'inferred', 'unknown'
  confidence DECIMAL CHECK (confidence >= 0 AND confidence <= 1),
  
  -- SOURCING (for confirmed)
  source_references JSONB, -- [{ "document_id": "xxx", "page": 42, "excerpt": "..." }]
  citation_text TEXT, -- Human-readable citation
  
  -- REASONING (for inferred)
  inference_basis TEXT, -- Why we think this is what it is
  inference_method TEXT, -- 'pattern_matching', 'cross_reference', 'visual_similarity'
  
  -- GAPS (for unknown)
  blocking_gaps TEXT[], -- What references are needed to confirm
  alternative_possibilities TEXT[], -- What else it might be
  
  -- VISUAL DATA
  bounding_box JSONB, -- Where in image { x, y, width, height }
  visible_features TEXT[], -- What specific features are visible
  condition_notes TEXT,
  
  -- VALIDATION
  human_validated BOOLEAN DEFAULT FALSE,
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  validation_notes TEXT,
  correction_applied TEXT, -- If human corrected the identification
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_component_ids_analysis ON component_identifications(analysis_record_id);
CREATE INDEX idx_component_ids_image ON component_identifications(image_id);
CREATE INDEX idx_component_ids_vehicle ON component_identifications(vehicle_id);
CREATE INDEX idx_component_ids_type ON component_identifications(component_type);
CREATE INDEX idx_component_ids_status ON component_identifications(status);
CREATE INDEX idx_component_ids_unvalidated ON component_identifications(human_validated) WHERE human_validated = FALSE;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE component_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_analysis_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE component_identifications ENABLE ROW LEVEL SECURITY;

-- Everyone can read component definitions
CREATE POLICY "component_defs_read_all" ON component_definitions FOR SELECT TO public USING (true);
CREATE POLICY "component_defs_auth_create" ON component_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "component_defs_creator_update" ON component_definitions FOR UPDATE TO authenticated USING (created_by = auth.uid() OR auth.uid() IN (SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'));

-- Everyone can read knowledge gaps
CREATE POLICY "gaps_read_all" ON knowledge_gaps FOR SELECT TO public USING (true);
CREATE POLICY "gaps_auth_create" ON knowledge_gaps FOR INSERT TO authenticated WITH CHECK (true);

-- Everyone can read coverage
CREATE POLICY "coverage_read_all" ON reference_coverage FOR SELECT TO public USING (true);
CREATE POLICY "coverage_auth_update" ON reference_coverage FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Analysis records - read if vehicle is public or user has access
CREATE POLICY "analysis_records_read" ON image_analysis_records 
  FOR SELECT TO public 
  USING (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.id = image_analysis_records.vehicle_id AND v.is_public = true)
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = image_analysis_records.vehicle_id AND v.user_id = auth.uid())
  );

CREATE POLICY "analysis_records_create" ON image_analysis_records FOR INSERT TO authenticated WITH CHECK (true);

-- Component identifications - same as analysis records
CREATE POLICY "component_ids_read" ON component_identifications 
  FOR SELECT TO public 
  USING (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.id = component_identifications.vehicle_id AND v.is_public = true)
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = component_identifications.vehicle_id AND v.user_id = auth.uid())
  );

CREATE POLICY "component_ids_create" ON component_identifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "component_ids_validate" ON component_identifications FOR UPDATE TO authenticated 
  USING (created_by = auth.uid() OR auth.uid() IN (SELECT id FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin'));

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get available references for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_references(p_vehicle_id UUID)
RETURNS TABLE(
  document_id UUID,
  document_title TEXT,
  document_type TEXT,
  page_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ld.id,
    ld.title,
    ld.document_type,
    ld.page_count
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  JOIN vehicle_library_links vll ON vll.library_id = rl.id
  WHERE vll.vehicle_id = p_vehicle_id
  ORDER BY ld.is_factory_original DESC, ld.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Check reference coverage for a vehicle
CREATE OR REPLACE FUNCTION check_vehicle_reference_coverage(p_vehicle_id UUID)
RETURNS TABLE(
  topic TEXT,
  coverage_status TEXT,
  coverage_percentage INTEGER,
  missing_references TEXT[]
) AS $$
DECLARE
  v_vehicle RECORD;
BEGIN
  SELECT year, make, model, series INTO v_vehicle
  FROM vehicles WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    rc.topic,
    rc.coverage_status,
    rc.coverage_percentage,
    rc.missing_references
  FROM reference_coverage rc
  WHERE rc.make = v_vehicle.make
    AND (rc.model_family = v_vehicle.model OR rc.model_family IS NULL)
    AND v_vehicle.year >= rc.year_range_start
    AND v_vehicle.year <= rc.year_range_end
  ORDER BY 
    CASE rc.coverage_status
      WHEN 'missing' THEN 1
      WHEN 'partial' THEN 2
      WHEN 'complete' THEN 3
    END,
    rc.topic;
END;
$$ LANGUAGE plpgsql;

-- Log a knowledge gap (called by analysis functions)
CREATE OR REPLACE FUNCTION log_knowledge_gap(
  p_analysis_id UUID,
  p_vehicle_id UUID,
  p_gap_type TEXT,
  p_description TEXT,
  p_required_reference TEXT,
  p_affected_components TEXT[]
)
RETURNS UUID AS $$
DECLARE
  v_vehicle RECORD;
  v_gap_id UUID;
  v_existing_gap_id UUID;
BEGIN
  SELECT year, make, model, series INTO v_vehicle
  FROM vehicles WHERE id = p_vehicle_id;
  
  -- Check if similar gap already exists
  SELECT id INTO v_existing_gap_id
  FROM knowledge_gaps
  WHERE gap_type = p_gap_type
    AND required_reference_title = p_required_reference
    AND vehicle_context->>'make' = v_vehicle.make
    AND vehicle_context->>'model' = v_vehicle.model
    AND status = 'open'
  LIMIT 1;
  
  IF v_existing_gap_id IS NOT NULL THEN
    -- Update existing gap
    UPDATE knowledge_gaps
    SET impact_count = impact_count + 1,
        last_encountered = NOW(),
        priority = LEAST(10, priority + 1) -- Increase priority
    WHERE id = v_existing_gap_id;
    
    RETURN v_existing_gap_id;
  ELSE
    -- Create new gap
    INSERT INTO knowledge_gaps (
      discovered_during_analysis_id,
      vehicle_context,
      gap_type,
      description,
      required_reference_type,
      required_reference_title,
      affected_components,
      priority
    ) VALUES (
      p_analysis_id,
      jsonb_build_object(
        'year', v_vehicle.year,
        'make', v_vehicle.make,
        'model', v_vehicle.model,
        'series', v_vehicle.series
      ),
      p_gap_type,
      p_description,
      CASE 
        WHEN p_required_reference ILIKE '%assembly%manual%' THEN 'assembly_manual'
        WHEN p_required_reference ILIKE '%parts%catalog%' THEN 'parts_catalog'
        WHEN p_required_reference ILIKE '%rpo%' THEN 'rpo_guide'
        WHEN p_required_reference ILIKE '%paint%' THEN 'paint_chart'
        ELSE 'other'
      END,
      p_required_reference,
      p_affected_components,
      5 -- Default priority
    )
    RETURNING id INTO v_gap_id;
    
    RETURN v_gap_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA: GM C/K TRUCKS (1973-1987)
-- ============================================

-- Body components
INSERT INTO component_definitions (make, model_family, year_range_start, year_range_end, component_category, component_name, component_subcategory, visual_identifiers, distinguishing_features, identification_priority, year_dating_significance, trim_identification_value, originality_indicator) VALUES
  ('Chevrolet', 'C/K', 1973, 1980, 'body', 'grille', 'front_end', '{"shape": "rectangular", "location": "front center", "bars": "horizontal"}', ARRAY['horizontal chrome bars', 'single headlight buckets', 'bowtie center'], 9, 10, 5, 8),
  ('Chevrolet', 'C/K', 1981, 1987, 'body', 'grille', 'front_end', '{"shape": "rectangular", "location": "front center", "bars": "horizontal"}', ARRAY['horizontal chrome bars', 'dual headlight buckets', 'bowtie center or side'], 9, 10, 5, 8),
  ('Chevrolet', 'C/K', 1973, 1987, 'body', 'front_bumper', 'front_end', '{"location": "front", "material": "chrome or painted"}', ARRAY['chrome finish standard', 'may have rubber strip', 'optional guards'], 7, 3, 3, 7),
  ('Chevrolet', 'C/K', 1973, 1987, 'body', 'fender_passenger', 'body_panel', '{"location": "front right", "size": "large panel"}', ARRAY['stampings', 'date codes inside', 'vent holes'], 6, 5, 2, 9),
  ('Chevrolet', 'C/K', 1973, 1987, 'body', 'fender_driver', 'body_panel', '{"location": "front left", "size": "large panel"}', ARRAY['stampings', 'date codes inside', 'vent holes'], 6, 5, 2, 9),
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'fender_emblem', 'exterior_trim', '{"location": "front fender", "type": "badge"}', ARRAY['trim level indicator', 'Scottsdale/Cheyenne/Silverado text', 'model designation'], 10, 5, 10, 6),
  ('Chevrolet', 'C/K', 1973, 1987, 'glass', 'windshield', 'glass', '{"location": "front", "size": "large"}', ARRAY['chrome trim optional', 'rubber gasket or molding', 'tinted option'], 5, 1, 4, 5),
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'door_molding', 'exterior_trim', '{"location": "door sides", "type": "protective strip"}', ARRAY['chrome or stainless', 'body color option', 'may have vinyl insert'], 6, 2, 7, 6),
  ('Chevrolet', 'C/K', 1973, 1987, 'mechanical', 'locking_hubs', 'drivetrain', '{"location": "front wheels", "type": "manual or auto"}', ARRAY['manual turn dial', 'auto locking', 'aftermarket conversion'], 7, 3, 3, 5)
ON CONFLICT (make, model_family, component_name, year_range_start, year_range_end) DO NOTHING;

-- Wheels and tires (common configurations)
INSERT INTO component_definitions (make, model_family, year_range_start, year_range_end, component_category, component_name, component_subcategory, visual_identifiers, distinguishing_features, common_aftermarket_brands, identification_priority) VALUES
  ('Chevrolet', 'C/K', 1973, 1987, 'wheels', 'rally_wheel', 'wheels', '{"style": "steel with trim ring", "finish": "body color or silver"}', ARRAY['trim ring', 'center cap', 'dog dish style'], ARRAY['Cragar', 'American Racing'], 8),
  ('Chevrolet', 'C/K', 1973, 1987, 'wheels', 'aluminum_wheel', 'wheels', '{"style": "cast aluminum", "finish": "polished or painted"}', ARRAY['5 or 6 lug', 'various spoke patterns'], ARRAY['American Racing', 'Centerline', 'Weld'], 8),
  ('Chevrolet', 'C/K', 1973, 1987, 'wheels', 'steel_wheel', 'wheels', '{"style": "stamped steel", "finish": "painted"}', ARRAY['standard equipment', 'hubcap or bare'], NULL, 6)
ON CONFLICT (make, model_family, component_name, year_range_start, year_range_end) DO NOTHING;

-- Trim packages (what comes with each)
INSERT INTO component_definitions (make, model_family, year_range_start, year_range_end, component_category, component_name, component_subcategory, visual_identifiers, standard_on_trims, related_rpo_codes, identification_priority, trim_identification_value) VALUES
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'scottsdale_package', 'trim_package', '{"emblem": "Scottsdale", "features": "chrome bumpers, basic interior"}', ARRAY['Scottsdale'], ARRAY['YE8'], 10, 10),
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'cheyenne_package', 'trim_package', '{"emblem": "Cheyenne", "features": "upgraded interior, chrome trim"}', ARRAY['Cheyenne'], ARRAY['YE9'], 10, 10),
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'silverado_package', 'trim_package', '{"emblem": "Silverado", "features": "premium interior, full chrome"}', ARRAY['Silverado'], ARRAY['Z84'], 10, 10),
  ('Chevrolet', 'C/K', 1973, 1987, 'trim', 'custom_deluxe_package', 'trim_package', '{"emblem": "Custom Deluxe", "features": "mid-level trim"}', ARRAY['Custom Deluxe'], ARRAY['YF5'], 10, 10)
ON CONFLICT (make, model_family, component_name, year_range_start, year_range_end) DO NOTHING;

-- ============================================
-- SEED REFERENCE COVERAGE (GM C/K Trucks)
-- ============================================

-- Initialize coverage tracking for GM trucks
INSERT INTO reference_coverage (make, model_family, year_range_start, year_range_end, topic, coverage_status, coverage_percentage, missing_references, gap_description) VALUES
  ('Chevrolet', 'C/K', 1973, 1980, 'body_panels', 'missing', 0, ARRAY['1973-1980 C/K Assembly Manual - Body Chapter', '1973-1980 Parts Catalog - Body Section'], 'Need assembly manual for panel date code locations and parts catalog for OEM part numbers'),
  ('Chevrolet', 'C/K', 1981, 1987, 'body_panels', 'missing', 0, ARRAY['1981-1987 C/K Assembly Manual - Body Chapter', '1981-1987 Parts Catalog - Body Section'], 'Need assembly manual for panel date code locations and parts catalog for OEM part numbers'),
  ('Chevrolet', 'C/K', 1973, 1980, 'trim_packages', 'partial', 30, ARRAY['1973-1980 Sales Brochures', '1973-1980 RPO Guide'], 'Have basic RPO codes, need detailed equipment lists and visual identification guides'),
  ('Chevrolet', 'C/K', 1981, 1987, 'trim_packages', 'partial', 40, ARRAY['1981-1987 Sales Brochures', '1981-1987 RPO Guide'], 'Have basic RPO codes, need detailed equipment lists and visual identification guides'),
  ('Chevrolet', 'C/K', 1973, 1987, 'paint_codes', 'missing', 0, ARRAY['GM Paint Code Charts 1973-1987', 'Dupont/PPG Formula Books'], 'No paint code reference data available'),
  ('Chevrolet', 'C/K', 1973, 1987, 'wheels_tires', 'missing', 10, ARRAY['Factory Wheel Option Guide', 'Tire Size Application Charts'], 'Basic wheel styles known, need factory specifications and option codes'),
  ('Chevrolet', 'C/K', 1973, 1987, 'mechanical', 'partial', 25, ARRAY['Engine Specifications Guide', 'Transmission Application Chart'], 'Have RPO codes for engines/trans, need visual identification markers'),
  ('Chevrolet', 'C/K', 1973, 1987, 'electrical', 'missing', 0, ARRAY['Electrical System Diagrams', 'Component Location Guide'], 'No electrical system reference data')
ON CONFLICT (make, model_family, year_range_start, year_range_end, topic) DO NOTHING;

-- ============================================
-- FUNCTIONS: Gap Discovery and Resolution
-- ============================================

-- Update coverage when document is uploaded
CREATE OR REPLACE FUNCTION update_coverage_on_upload()
RETURNS TRIGGER AS $$
DECLARE
  v_library RECORD;
  v_topic TEXT;
BEGIN
  -- Get library context
  SELECT * INTO v_library
  FROM reference_libraries
  WHERE id = NEW.library_id;
  
  -- Determine topic from document type
  v_topic := CASE
    WHEN NEW.document_type ILIKE '%assembly%manual%' OR NEW.document_type ILIKE '%body%' THEN 'body_panels'
    WHEN NEW.document_type ILIKE '%brochure%' OR NEW.document_type ILIKE '%sales%' THEN 'trim_packages'
    WHEN NEW.document_type ILIKE '%paint%' OR NEW.document_type ILIKE '%color%' THEN 'paint_codes'
    WHEN NEW.document_type ILIKE '%parts%catalog%' THEN 'body_panels'
    WHEN NEW.document_type ILIKE '%rpo%' OR NEW.document_type ILIKE '%option%' THEN 'trim_packages'
    ELSE 'general'
  END;
  
  -- Update coverage
  UPDATE reference_coverage
  SET available_documents = array_append(COALESCE(available_documents, ARRAY[]::UUID[]), NEW.id),
      coverage_status = CASE 
        WHEN coverage_status = 'missing' THEN 'partial'
        WHEN coverage_status = 'partial' AND coverage_percentage < 80 THEN 'partial'
        ELSE 'complete'
      END,
      coverage_percentage = LEAST(100, coverage_percentage + 20),
      last_assessed = NOW()
  WHERE make = v_library.make
    AND (model_family = v_library.series OR model_family IS NULL)
    AND v_library.year >= year_range_start
    AND v_library.year <= year_range_end
    AND topic = v_topic;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_coverage_on_upload ON library_documents;
CREATE TRIGGER trg_update_coverage_on_upload
  AFTER INSERT ON library_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_coverage_on_upload();

-- ============================================
-- VIEWS
-- ============================================

-- View: Top priority knowledge gaps
CREATE OR REPLACE VIEW top_priority_gaps AS
SELECT 
  kg.id,
  kg.gap_type,
  kg.description,
  kg.required_reference_title,
  kg.affected_components,
  kg.impact_count,
  kg.priority,
  kg.vehicle_context->>'year' as year,
  kg.vehicle_context->>'make' as make,
  kg.vehicle_context->>'model' as model,
  kg.last_encountered,
  kg.created_at
FROM knowledge_gaps kg
WHERE kg.status = 'open'
ORDER BY kg.priority DESC, kg.impact_count DESC, kg.last_encountered DESC
LIMIT 20;

-- View: Coverage gaps by make/model
CREATE OR REPLACE VIEW coverage_gaps_by_vehicle AS
SELECT 
  make,
  model_family,
  year_range_start,
  year_range_end,
  COUNT(*) FILTER (WHERE coverage_status = 'complete') as topics_complete,
  COUNT(*) FILTER (WHERE coverage_status = 'partial') as topics_partial,
  COUNT(*) FILTER (WHERE coverage_status = 'missing') as topics_missing,
  ROUND(AVG(coverage_percentage)) as avg_coverage,
  SUM(blocked_analyses_count) as total_blocked
FROM reference_coverage
GROUP BY make, model_family, year_range_start, year_range_end
ORDER BY total_blocked DESC, avg_coverage ASC;

-- ============================================
-- GRANTS
-- ============================================

GRANT SELECT ON component_definitions TO authenticated, anon;
GRANT SELECT ON knowledge_gaps TO authenticated, anon;
GRANT SELECT ON reference_coverage TO authenticated, anon;
GRANT SELECT ON image_analysis_records TO authenticated, anon;
GRANT SELECT ON component_identifications TO authenticated, anon;

GRANT ALL ON component_definitions TO service_role;
GRANT ALL ON knowledge_gaps TO service_role;
GRANT ALL ON reference_coverage TO service_role;
GRANT ALL ON image_analysis_records TO service_role;
GRANT ALL ON component_identifications TO service_role;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE component_definitions IS 'Master catalog of vehicle components with visual identification criteria';
COMMENT ON TABLE knowledge_gaps IS 'Tracks missing reference data discovered during analysis';
COMMENT ON TABLE reference_coverage IS 'Coverage map of available vs needed reference data by YMM and topic';
COMMENT ON TABLE image_analysis_records IS 'Full analysis records with epistemic tracking (confirmed/inferred/unknown)';
COMMENT ON TABLE component_identifications IS 'Per-image component identifications with confidence and sourcing';

COMMENT ON COLUMN component_definitions.visual_identifiers IS 'JSONB describing how to visually identify this component';
COMMENT ON COLUMN component_definitions.year_dating_significance IS '0-10 score: how much this component helps date the vehicle';
COMMENT ON COLUMN component_definitions.trim_identification_value IS '0-10 score: how much this indicates trim level';
COMMENT ON COLUMN component_definitions.originality_indicator IS '0-10 score: how much this proves OEM vs modified';

COMMENT ON COLUMN knowledge_gaps.impact_count IS 'How many analyses have been blocked by this missing reference';
COMMENT ON COLUMN knowledge_gaps.priority IS 'Auto-adjusted priority based on impact';

COMMENT ON FUNCTION log_knowledge_gap IS 'Log a knowledge gap discovered during analysis, de-duplicates automatically';
COMMENT ON FUNCTION check_vehicle_reference_coverage IS 'Check what reference coverage exists for a specific vehicle';

