-- ==========================================================================
-- VIN VALIDATION & PUBLIC SAFETY SYSTEM
-- ==========================================================================
-- Purpose: Prevent vehicles with invalid VINs from going public
-- Safety: Invalid VINs like "VIVA-1762059695512" must never reach public view
-- ==========================================================================

-- Add vin_is_valid flag to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS vin_is_valid BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS vin_validation_method TEXT,
ADD COLUMN IF NOT EXISTS vin_validated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vehicles_vin_valid ON vehicles(vin_is_valid) WHERE vin_is_valid IS NOT NULL;

COMMENT ON COLUMN vehicles.vin_is_valid IS 'NULL = not yet validated, TRUE = valid VIN, FALSE = invalid/fake VIN';
COMMENT ON COLUMN vehicles.vin_validation_method IS 'How VIN was validated: nhtsa_api, check_digit, manual_override, etc';

-- ==========================================================================
-- VIN VALIDATION FUNCTION
-- ==========================================================================
-- Validates VIN format and check digit per ISO 3779 / SAE J853
-- ==========================================================================

CREATE OR REPLACE FUNCTION validate_vin(p_vin TEXT)
RETURNS JSONB AS $$
DECLARE
  v_vin TEXT;
  v_check_digit CHAR(1);
  v_calc_digit INTEGER;
  v_transliteration TEXT := 'AJ1BK2CL3DM4EN5FP6GR7HS8JT9UV0WX0YZ0';
  v_weights INTEGER[] := ARRAY[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  v_sum INTEGER := 0;
  v_pos INTEGER;
  v_char CHAR(1);
  v_val INTEGER;
BEGIN
  -- Normalize VIN
  v_vin := UPPER(TRIM(p_vin));
  
  -- Check length
  IF LENGTH(v_vin) != 17 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'length_check',
      'reason', 'VIN must be exactly 17 characters',
      'vin', v_vin
    );
  END IF;
  
  -- Check for invalid characters (no I, O, Q allowed in real VINs)
  IF v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'character_check',
      'reason', 'VIN contains invalid characters (I, O, Q not allowed)',
      'vin', v_vin
    );
  END IF;
  
  -- Check for obviously fake VINs (common patterns)
  IF v_vin ~ '^(VIVA|TEST|FAKE|XXXX|0000|1111|ZZZZ)' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'pattern_check',
      'reason', 'VIN appears to be a placeholder or fake identifier',
      'vin', v_vin
    );
  END IF;
  
  -- Extract check digit (position 9)
  v_check_digit := SUBSTRING(v_vin FROM 9 FOR 1);
  
  -- Calculate check digit
  FOR i IN 1..17 LOOP
    v_char := SUBSTRING(v_vin FROM i FOR 1);
    
    -- Convert character to numeric value
    IF v_char ~ '[0-9]' THEN
      v_val := v_char::INTEGER;
    ELSE
      -- Find position in transliteration string
      v_pos := POSITION(v_char IN v_transliteration);
      IF v_pos > 0 THEN
        v_val := (v_pos - 1) % 10;
      ELSE
        v_val := 0;
      END IF;
    END IF;
    
    -- Add weighted value to sum
    v_sum := v_sum + (v_val * v_weights[i]);
  END LOOP;
  
  -- Calculate check digit (sum mod 11)
  v_calc_digit := v_sum % 11;
  
  -- Compare calculated digit with actual
  IF (v_calc_digit = 10 AND v_check_digit = 'X') OR 
     (v_calc_digit != 10 AND v_check_digit = v_calc_digit::TEXT) THEN
    RETURN jsonb_build_object(
      'valid', true,
      'method', 'check_digit',
      'reason', 'VIN passes ISO 3779 check digit validation',
      'vin', v_vin,
      'check_digit_match', true
    );
  ELSE
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'check_digit',
      'reason', format('Check digit mismatch: expected %s, found %s', 
                      CASE WHEN v_calc_digit = 10 THEN 'X' ELSE v_calc_digit::TEXT END,
                      v_check_digit),
      'vin', v_vin,
      'check_digit_match', false,
      'calculated_digit', CASE WHEN v_calc_digit = 10 THEN 'X' ELSE v_calc_digit::TEXT END,
      'actual_digit', v_check_digit
    );
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION validate_vin IS 'Validates VIN format and check digit per ISO 3779 standard';

-- ==========================================================================
-- AUTO-VALIDATE VINS ON INSERT/UPDATE
-- ==========================================================================

CREATE OR REPLACE FUNCTION auto_validate_vin_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_validation JSONB;
BEGIN
  -- Only validate if VIN is present and not already validated
  IF NEW.vin IS NOT NULL AND NEW.vin != '' THEN
    -- If VIN changed or not yet validated
    IF (OLD.vin IS NULL OR OLD.vin != NEW.vin OR OLD.vin_is_valid IS NULL) THEN
      v_validation := validate_vin(NEW.vin);
      
      NEW.vin_is_valid := (v_validation->>'valid')::BOOLEAN;
      NEW.vin_validation_method := v_validation->>'method';
      NEW.vin_validated_at := NOW();
      
      -- Log validation result
      RAISE NOTICE 'VIN validation for %: % (method: %)', 
        NEW.vin, 
        CASE WHEN NEW.vin_is_valid THEN 'VALID' ELSE 'INVALID' END,
        NEW.vin_validation_method;
    END IF;
  ELSE
    -- No VIN provided
    NEW.vin_is_valid := NULL;
    NEW.vin_validation_method := NULL;
    NEW.vin_validated_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_validate_vin ON vehicles;
CREATE TRIGGER trigger_auto_validate_vin
  BEFORE INSERT OR UPDATE OF vin ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION auto_validate_vin_trigger();

-- ==========================================================================
-- PUBLIC SAFETY ENFORCEMENT
-- ==========================================================================
-- Prevent vehicles with invalid VINs from going public
-- ==========================================================================

CREATE OR REPLACE FUNCTION enforce_vin_public_safety()
RETURNS TRIGGER AS $$
BEGIN
  -- If trying to set is_public = true, enforce VIN requirements
  IF NEW.is_public = true THEN
    -- Must have a VIN
    IF NEW.vin IS NULL OR NEW.vin = '' THEN
      RAISE EXCEPTION 'Cannot set vehicle to public without a VIN. Vehicle must have valid VIN to be publicly visible.';
    END IF;
    
    -- VIN must be valid (or at least not explicitly invalid)
    IF NEW.vin_is_valid = false THEN
      RAISE EXCEPTION 'Cannot set vehicle to public with invalid VIN: %. This VIN failed validation (%) and must be corrected before vehicle can be public.',
        NEW.vin,
        NEW.vin_validation_method;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_vin_public_safety ON vehicles;
CREATE TRIGGER trigger_enforce_vin_public_safety
  BEFORE INSERT OR UPDATE OF is_public, vin ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_vin_public_safety();

-- ==========================================================================
-- BACKFILL EXISTING VINS
-- ==========================================================================
-- Validate all existing VINs to identify problems
-- ==========================================================================

-- Update all vehicles with VINs to validate them
UPDATE vehicles
SET vin = vin  -- Trigger the validation
WHERE vin IS NOT NULL 
  AND vin != ''
  AND vin_is_valid IS NULL;

-- Force any vehicles with invalid VINs to be private
UPDATE vehicles
SET is_public = false
WHERE vin_is_valid = false
  AND is_public = true;

-- ==========================================================================
-- ADMIN VIEW: Invalid VINs Report
-- ==========================================================================

CREATE OR REPLACE VIEW invalid_vins_report AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.vin_is_valid,
  v.vin_validation_method,
  v.vin_validated_at,
  v.is_public,
  v.uploaded_by,
  v.created_at,
  validate_vin(v.vin) as validation_details,
  -- Count of images (to assess data quality)
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  -- Linked organizations
  (
    SELECT json_agg(json_build_object(
      'org_id', ov.organization_id,
      'org_name', b.business_name,
      'relationship', ov.relationship_type
    ))
    FROM organization_vehicles ov
    JOIN businesses b ON b.id = ov.organization_id
    WHERE ov.vehicle_id = v.id
    AND ov.status = 'active'
  ) as organizations
FROM vehicles v
WHERE v.vin_is_valid = false
ORDER BY v.created_at DESC;

COMMENT ON VIEW invalid_vins_report IS 'Admin view of all vehicles with invalid VINs for cleanup';

-- Grant access
GRANT SELECT ON invalid_vins_report TO authenticated;

