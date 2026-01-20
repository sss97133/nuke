-- VIN validation: allow legacy chassis/serial identifiers + respect non-vehicle listings
--
-- Why:
-- - Collector/auction data often contains pre-ISO/legacy "VIN serial" identifiers (4-16 chars).
-- - Our system also ingests non-vehicle items (parts/tools/memorabilia) into `vehicles` (flagged via `vehicles.listing_kind`).
-- - A strict "17 chars only" VIN rule breaks legitimate legacy vehicles and blocks public visibility for non-vehicle lots.

BEGIN;

-- ==========================================================================
-- 1) VIN validation function (format + check-digit when applicable)
-- ==========================================================================
CREATE OR REPLACE FUNCTION validate_vin(p_vin TEXT)
RETURNS JSONB AS $$
DECLARE
  v_vin TEXT;
  v_len INTEGER;
  v_check_digit CHAR(1);
  v_calc_digit INTEGER;
  v_transliteration TEXT := 'AJ1BK2CL3DM4EN5FP6GR7HS8JT9UV0WX0YZ0';
  v_weights INTEGER[] := ARRAY[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  v_sum INTEGER := 0;
  v_pos INTEGER;
  v_char CHAR(1);
  v_val INTEGER;
BEGIN
  v_vin := UPPER(TRIM(COALESCE(p_vin, '')));
  v_len := LENGTH(v_vin);

  IF v_len = 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'blank',
      'reason', 'VIN is blank',
      'vin', v_vin
    );
  END IF;

  -- Reject obviously fake VINs (common patterns)
  IF v_vin ~ '^(VIVA|TEST|FAKE|XXXX|0000|1111|ZZZZ)' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'pattern_check',
      'reason', 'VIN appears to be a placeholder or fake identifier',
      'vin', v_vin
    );
  END IF;

  -- Reject invalid characters (no I, O, Q allowed in real VINs / chassis ids)
  IF v_vin !~ '^[A-HJ-NPR-Z0-9]+$' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'method', 'character_check',
      'reason', 'VIN contains invalid characters (I, O, Q not allowed)',
      'vin', v_vin
    );
  END IF;

  -- Legacy/collector vehicles sometimes use chassis/serial identifiers (non-17 length).
  -- Treat 4-16 char alphanumeric IDs as "valid format" (no check digit).
  IF v_len <> 17 THEN
    IF v_len < 4 OR v_len > 16 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'method', 'length_check',
        'reason', 'VIN must be 17 characters (modern) or 4-16 characters (legacy chassis/serial)',
        'vin', v_vin
      );
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'method', 'legacy_length',
      'reason', 'Non-17 VIN/chassis identifier accepted (check digit not validated)',
      'vin', v_vin
    );
  END IF;

  -- Modern VIN: ISO 3779 check digit validation
  v_check_digit := SUBSTRING(v_vin FROM 9 FOR 1);

  FOR i IN 1..17 LOOP
    v_char := SUBSTRING(v_vin FROM i FOR 1);

    IF v_char ~ '[0-9]' THEN
      v_val := v_char::INTEGER;
    ELSE
      v_pos := POSITION(v_char IN v_transliteration);
      IF v_pos > 0 THEN
        v_val := (v_pos - 1) % 10;
      ELSE
        v_val := 0;
      END IF;
    END IF;

    v_sum := v_sum + (v_val * v_weights[i]);
  END LOOP;

  v_calc_digit := v_sum % 11;

  IF (v_calc_digit = 10 AND v_check_digit = 'X') OR
     (v_calc_digit != 10 AND v_check_digit = v_calc_digit::TEXT) THEN
    RETURN jsonb_build_object(
      'valid', true,
      'method', 'check_digit',
      'reason', 'VIN passes ISO 3779 check digit validation',
      'vin', v_vin,
      'check_digit_match', true
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'method', 'check_digit',
    'reason', format(
      'Check digit mismatch: expected %s, found %s',
      CASE WHEN v_calc_digit = 10 THEN 'X' ELSE v_calc_digit::TEXT END,
      v_check_digit
    ),
    'vin', v_vin,
    'check_digit_match', false,
    'calculated_digit', CASE WHEN v_calc_digit = 10 THEN 'X' ELSE v_calc_digit::TEXT END,
    'actual_digit', v_check_digit
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ==========================================================================
-- 2) Public safety enforcement: only applies to listing_kind='vehicle'
-- ==========================================================================
CREATE OR REPLACE FUNCTION enforce_vin_public_safety()
RETURNS TRIGGER AS $$
BEGIN
  -- If trying to set is_public = true, enforce VIN requirements for real vehicles only.
  IF NEW.is_public = true AND COALESCE(NEW.listing_kind, 'vehicle') = 'vehicle' THEN
    -- Must have a VIN/chassis id
    IF NEW.vin IS NULL OR NEW.vin = '' THEN
      RAISE EXCEPTION 'Cannot set vehicle to public without a VIN/chassis identifier.';
    END IF;

    -- VIN must not be explicitly invalid
    IF NEW.vin_is_valid = false THEN
      RAISE EXCEPTION
        'Cannot set vehicle to public with invalid VIN: %. This VIN failed validation (%) and must be corrected before vehicle can be public.',
        NEW.vin,
        NEW.vin_validation_method;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_vin_public_safety ON vehicles;
CREATE TRIGGER trigger_enforce_vin_public_safety
  BEFORE INSERT OR UPDATE OF is_public, vin, listing_kind ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_vin_public_safety();

-- Re-run validation for legacy/chassis identifiers that may have been incorrectly marked invalid
-- under the old "17 characters only" logic.
UPDATE public.vehicles
SET vin = vin
WHERE vin IS NOT NULL
  AND vin <> ''
  AND vin_is_valid = false
  AND LENGTH(UPPER(TRIM(vin))) BETWEEN 4 AND 16;

COMMIT;

