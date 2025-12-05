-- ============================================
-- IMAGE-VEHICLE MISMATCH DETECTION SYSTEM
-- ============================================
-- Detects and flags images that don't match their associated vehicle
-- Uses AI validation results and metadata to identify mismatches

-- ============================================
-- 1. MISMATCH TRACKING TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS image_vehicle_mismatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What's mismatched
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  current_vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Detection
  detected_vehicle JSONB, /*
  {
    "year": 1974,
    "make": "FORD",
    "model": "Bronco",
    "confidence": 95
  }
  */
  expected_vehicle JSONB, /*
  {
    "year": 1971,
    "make": "FORD", 
    "model": "Bronco"
  }
  */
  
  -- Validation results
  validation_status TEXT CHECK (validation_status IN ('mismatch', 'uncertain', 'valid', 'not_validated')),
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  mismatch_reason TEXT,
  
  -- Suggested correct vehicle (if found)
  suggested_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  suggested_confidence INTEGER CHECK (suggested_confidence >= 0 AND suggested_confidence <= 100),
  
  -- Source of mismatch
  mismatch_source TEXT CHECK (mismatch_source IN (
    'ai_validation',
    'metadata_analysis',
    'user_report',
    'bulk_import_error',
    'scraper_error'
  )),
  
  -- Resolution
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_action TEXT CHECK (resolution_action IN (
    'moved_to_correct_vehicle',
    'removed_from_vehicle',
    'marked_as_uncertain',
    'confirmed_correct',
    'pending_review'
  )),
  resolution_notes TEXT,
  
  -- Metadata
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mismatch_image ON image_vehicle_mismatches(image_id);
CREATE INDEX idx_mismatch_vehicle ON image_vehicle_mismatches(current_vehicle_id);
CREATE INDEX idx_mismatch_suggested ON image_vehicle_mismatches(suggested_vehicle_id);
CREATE INDEX idx_mismatch_resolved ON image_vehicle_mismatches(resolved) WHERE resolved = false;
CREATE INDEX idx_mismatch_status ON image_vehicle_mismatches(validation_status);

COMMENT ON TABLE image_vehicle_mismatches IS 'Tracks images that do not match their associated vehicle - enables detection and resolution';

-- ============================================
-- 2. FUNCTION: DETECT MISMATCHES FROM AI VALIDATION
-- ============================================
CREATE OR REPLACE FUNCTION detect_image_mismatches_from_validation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_validation JSONB;
  v_vehicle_data RECORD;
  v_matches BOOLEAN;
  v_detected_vehicle JSONB;
  v_expected_vehicle JSONB;
BEGIN
  -- Only process if ai_scan_metadata has validation data
  IF NEW.ai_scan_metadata IS NULL OR NEW.ai_scan_metadata->'validation' IS NULL THEN
    RETURN NEW;
  END IF;

  v_validation := NEW.ai_scan_metadata->'validation';
  v_matches := (v_validation->>'matches_vehicle')::boolean;

  -- If validation says it matches, no mismatch
  IF v_matches = true THEN
    RETURN NEW;
  END IF;

  -- Get vehicle data
  SELECT year, make, model INTO v_vehicle_data
  FROM vehicles
  WHERE id = NEW.vehicle_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Build expected vehicle JSON
  v_expected_vehicle := jsonb_build_object(
    'year', v_vehicle_data.year,
    'make', v_vehicle_data.make,
    'model', v_vehicle_data.model
  );

  -- Get detected vehicle from validation
  v_detected_vehicle := v_validation->'detected_vehicle';

  -- Check if mismatch already exists
  IF NOT EXISTS (
    SELECT 1 FROM image_vehicle_mismatches
    WHERE image_id = NEW.id
    AND resolved = false
  ) THEN
    -- Insert mismatch record
    INSERT INTO image_vehicle_mismatches (
      image_id,
      current_vehicle_id,
      detected_vehicle,
      expected_vehicle,
      validation_status,
      confidence_score,
      mismatch_reason,
      mismatch_source
    ) VALUES (
      NEW.id,
      NEW.vehicle_id,
      v_detected_vehicle,
      v_expected_vehicle,
      'mismatch',
      (v_validation->>'confidence')::integer,
      v_validation->>'mismatch_reason',
      'ai_validation'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger to auto-detect mismatches when validation is added
DROP TRIGGER IF EXISTS trg_detect_image_mismatches ON vehicle_images;
CREATE TRIGGER trg_detect_image_mismatches
  AFTER INSERT OR UPDATE OF ai_scan_metadata ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.ai_scan_metadata->'validation' IS NOT NULL)
  EXECUTE FUNCTION detect_image_mismatches_from_validation();

-- ============================================
-- 3. FUNCTION: FIND SUGGESTED VEHICLE FOR MISMATCH
-- ============================================
CREATE OR REPLACE FUNCTION find_suggested_vehicle_for_mismatch(p_mismatch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_mismatch RECORD;
  v_detected_year INTEGER;
  v_detected_make TEXT;
  v_detected_model TEXT;
  v_suggested_vehicle_id UUID;
  v_match_score INTEGER;
BEGIN
  -- Get mismatch data
  SELECT 
    detected_vehicle,
    current_vehicle_id
  INTO v_mismatch
  FROM image_vehicle_mismatches
  WHERE id = p_mismatch_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Extract detected vehicle info
  v_detected_year := (v_mismatch.detected_vehicle->>'year')::integer;
  v_detected_make := v_mismatch.detected_vehicle->>'make';
  v_detected_model := v_mismatch.detected_vehicle->>'model';

  IF v_detected_year IS NULL OR v_detected_make IS NULL OR v_detected_model IS NULL THEN
    RETURN NULL;
  END IF;

  -- Find matching vehicle (allow 2 year variance)
  SELECT id INTO v_suggested_vehicle_id
  FROM vehicles
  WHERE make ILIKE v_detected_make
    AND model ILIKE v_detected_model
    AND ABS(year - v_detected_year) <= 2
    AND id != v_mismatch.current_vehicle_id
  ORDER BY ABS(year - v_detected_year) ASC
  LIMIT 1;

  -- Update mismatch with suggestion
  IF v_suggested_vehicle_id IS NOT NULL THEN
    UPDATE image_vehicle_mismatches
    SET suggested_vehicle_id = v_suggested_vehicle_id,
        suggested_confidence = (v_mismatch.detected_vehicle->>'confidence')::integer
    WHERE id = p_mismatch_id;
  END IF;

  RETURN v_suggested_vehicle_id;
END;
$$;

-- ============================================
-- 4. VIEW: ACTIVE MISMATCHES WITH SUGGESTIONS
-- ============================================
CREATE OR REPLACE VIEW active_image_mismatches AS
SELECT 
  m.id,
  m.image_id,
  vi.image_url,
  vi.category,
  vi.taken_at,
  vi.source,
  
  -- Current vehicle
  m.current_vehicle_id,
  v_current.year || ' ' || v_current.make || ' ' || v_current.model as current_vehicle,
  
  -- Detected vehicle
  m.detected_vehicle->>'year' as detected_year,
  m.detected_vehicle->>'make' as detected_make,
  m.detected_vehicle->>'model' as detected_model,
  m.detected_vehicle->>'confidence' as detected_confidence,
  
  -- Suggested vehicle
  m.suggested_vehicle_id,
  CASE 
    WHEN m.suggested_vehicle_id IS NOT NULL 
    THEN v_suggested.year || ' ' || v_suggested.make || ' ' || v_suggested.model
    ELSE NULL
  END as suggested_vehicle,
  m.suggested_confidence,
  
  -- Mismatch info
  m.validation_status,
  m.confidence_score,
  m.mismatch_reason,
  m.mismatch_source,
  m.detected_at,
  
  -- Resolution
  m.resolved,
  m.resolved_at,
  m.resolution_action

FROM image_vehicle_mismatches m
JOIN vehicle_images vi ON vi.id = m.image_id
JOIN vehicles v_current ON v_current.id = m.current_vehicle_id
LEFT JOIN vehicles v_suggested ON v_suggested.id = m.suggested_vehicle_id
WHERE m.resolved = false
ORDER BY m.confidence_score DESC, m.detected_at DESC;

COMMENT ON VIEW active_image_mismatches IS 'Active image-vehicle mismatches with suggested corrections';

-- ============================================
-- 5. FUNCTION: BULK VALIDATE VEHICLE IMAGES
-- ============================================
CREATE OR REPLACE FUNCTION bulk_validate_vehicle_images(
  p_vehicle_id UUID,
  p_force_revalidate BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle RECORD;
  v_images RECORD;
  v_result JSONB := '{"validated": 0, "matches": 0, "mismatches": 0, "errors": 0}'::jsonb;
BEGIN
  -- Get vehicle data
  SELECT year, make, model INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;

  -- Loop through images
  FOR v_images IN 
    SELECT id, image_url, ai_scan_metadata
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND (p_force_revalidate = true OR ai_scan_metadata->'validation' IS NULL)
  LOOP
    -- This would call the validate-bat-image function
    -- For now, just mark as needing validation
    v_result := jsonb_set(
      v_result,
      '{validated}',
      to_jsonb((v_result->>'validated')::integer + 1)
    );
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================
-- 6. RLS POLICIES
-- ============================================
ALTER TABLE image_vehicle_mismatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view mismatches" ON image_vehicle_mismatches
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage mismatches" ON image_vehicle_mismatches
  FOR ALL USING (true);

-- ============================================
-- 7. INITIAL DETECTION: SCAN EXISTING VALIDATIONS
-- ============================================
-- Find images with existing validation data that indicates mismatch
INSERT INTO image_vehicle_mismatches (
  image_id,
  current_vehicle_id,
  detected_vehicle,
  expected_vehicle,
  validation_status,
  confidence_score,
  mismatch_reason,
  mismatch_source
)
SELECT 
  vi.id,
  vi.vehicle_id,
  vi.ai_scan_metadata->'validation'->'detected_vehicle',
  jsonb_build_object(
    'year', v.year,
    'make', v.make,
    'model', v.model
  ),
  'mismatch',
  (vi.ai_scan_metadata->'validation'->>'confidence')::integer,
  vi.ai_scan_metadata->'validation'->>'mismatch_reason',
  'ai_validation'
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE vi.ai_scan_metadata->'validation'->>'matches_vehicle' = 'false'
  AND NOT EXISTS (
    SELECT 1 FROM image_vehicle_mismatches
    WHERE image_id = vi.id
  )
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION detect_image_mismatches_from_validation IS 'Auto-detects mismatches when AI validation is added to images';
COMMENT ON FUNCTION find_suggested_vehicle_for_mismatch IS 'Finds suggested correct vehicle for a mismatch based on detected vehicle data';

