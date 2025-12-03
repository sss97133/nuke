-- ============================================
-- VIN AS SOURCE OF TRUTH SYSTEM
-- ============================================
-- The VIN is the canonical authority for vehicle data.
-- All user-entered data should be validated against VIN-decoded data.

-- ============================================
-- 1. VIN DECODED DATA TABLE
-- ============================================
-- Stores the canonical data decoded from VINs

CREATE TABLE IF NOT EXISTS vin_decoded_data (
  vin TEXT PRIMARY KEY,
  
  -- Canonical vehicle info (from NHTSA)
  make TEXT,
  model TEXT,
  year INTEGER,
  trim TEXT,
  
  -- Body
  body_type TEXT,
  doors INTEGER,
  
  -- Engine
  engine_size TEXT,
  engine_cylinders INTEGER,
  engine_displacement_liters TEXT,
  fuel_type TEXT,
  
  -- Drivetrain
  transmission TEXT,
  drivetrain TEXT,  -- 2WD, 4WD, AWD, RWD, FWD
  
  -- Manufacturing
  manufacturer TEXT,
  plant_city TEXT,
  plant_country TEXT,
  vehicle_type TEXT,
  
  -- Metadata
  provider TEXT NOT NULL DEFAULT 'nhtsa',
  confidence NUMERIC DEFAULT 100,
  decoded_at TIMESTAMPTZ DEFAULT NOW(),
  raw_response JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vin_decoded_make_model ON vin_decoded_data(make, model);
CREATE INDEX idx_vin_decoded_year ON vin_decoded_data(year);

-- ============================================
-- 2. VEHICLE VIN CONFLICTS TABLE
-- ============================================
-- Tracks where user-entered data differs from VIN truth

CREATE TABLE IF NOT EXISTS vin_data_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  vin TEXT NOT NULL,
  
  -- The field with conflict
  field_name TEXT NOT NULL,
  
  -- What the user entered
  user_value TEXT,
  
  -- What the VIN says (canonical truth)
  vin_value TEXT,
  
  -- Resolution
  resolution TEXT CHECK (resolution IN ('pending', 'use_vin', 'use_user', 'manual')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, field_name)
);

CREATE INDEX idx_vin_conflicts_vehicle ON vin_data_conflicts(vehicle_id);
CREATE INDEX idx_vin_conflicts_pending ON vin_data_conflicts(resolution) WHERE resolution = 'pending';

-- ============================================
-- 3. COMPARISON FUNCTION
-- ============================================
-- Compares vehicle record to VIN-decoded data and returns conflicts

CREATE OR REPLACE FUNCTION compare_vehicle_to_vin(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  vd RECORD;
  conflicts JSONB := '[]'::JSONB;
  corrections JSONB := '[]'::JSONB;
BEGIN
  -- Get vehicle
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF v IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;
  
  -- Check if we have VIN
  IF v.vin IS NULL OR LENGTH(v.vin) < 11 THEN
    RETURN jsonb_build_object('error', 'No valid VIN on vehicle');
  END IF;
  
  -- Get decoded VIN data
  SELECT * INTO vd FROM vin_decoded_data WHERE vin = UPPER(v.vin);
  IF vd IS NULL THEN
    RETURN jsonb_build_object('error', 'VIN not yet decoded', 'vin', v.vin, 'needs_decode', true);
  END IF;
  
  -- Compare fields and build conflicts/corrections
  
  -- Make
  IF vd.make IS NOT NULL AND v.make IS NOT NULL AND UPPER(v.make) != UPPER(vd.make) THEN
    conflicts := conflicts || jsonb_build_object(
      'field', 'make',
      'user_value', v.make,
      'vin_value', vd.make,
      'confidence', vd.confidence
    );
    corrections := corrections || jsonb_build_object(
      'field', 'make',
      'from', v.make,
      'to', vd.make
    );
  END IF;
  
  -- Model
  IF vd.model IS NOT NULL AND v.model IS NOT NULL AND UPPER(v.model) != UPPER(vd.model) THEN
    conflicts := conflicts || jsonb_build_object(
      'field', 'model',
      'user_value', v.model,
      'vin_value', vd.model,
      'confidence', vd.confidence
    );
    corrections := corrections || jsonb_build_object(
      'field', 'model',
      'from', v.model,
      'to', vd.model
    );
  END IF;
  
  -- Year
  IF vd.year IS NOT NULL AND v.year IS NOT NULL AND v.year != vd.year THEN
    conflicts := conflicts || jsonb_build_object(
      'field', 'year',
      'user_value', v.year,
      'vin_value', vd.year,
      'confidence', vd.confidence
    );
    corrections := corrections || jsonb_build_object(
      'field', 'year',
      'from', v.year,
      'to', vd.year
    );
  END IF;
  
  -- Drivetrain (critical for C/K series)
  IF vd.drivetrain IS NOT NULL AND v.drivetrain IS NOT NULL AND UPPER(v.drivetrain) != UPPER(vd.drivetrain) THEN
    conflicts := conflicts || jsonb_build_object(
      'field', 'drivetrain',
      'user_value', v.drivetrain,
      'vin_value', vd.drivetrain,
      'confidence', vd.confidence
    );
    corrections := corrections || jsonb_build_object(
      'field', 'drivetrain',
      'from', v.drivetrain,
      'to', vd.drivetrain
    );
  END IF;
  
  -- Transmission
  IF vd.transmission IS NOT NULL AND v.transmission IS NOT NULL AND UPPER(v.transmission) != UPPER(vd.transmission) THEN
    conflicts := conflicts || jsonb_build_object(
      'field', 'transmission',
      'user_value', v.transmission,
      'vin_value', vd.transmission,
      'confidence', vd.confidence
    );
  END IF;
  
  -- Engine
  IF vd.engine_displacement_liters IS NOT NULL AND v.engine_type IS NOT NULL THEN
    -- Fuzzy match - check if engine size appears in user's engine_type
    IF v.engine_type NOT ILIKE '%' || vd.engine_displacement_liters || '%' THEN
      conflicts := conflicts || jsonb_build_object(
        'field', 'engine_type',
        'user_value', v.engine_type,
        'vin_value', vd.engine_displacement_liters || 'L ' || COALESCE(vd.engine_cylinders::TEXT || '-cyl', ''),
        'confidence', vd.confidence
      );
    END IF;
  END IF;
  
  -- Build missing fields (things VIN has that vehicle doesn't)
  DECLARE
    missing JSONB := '[]'::JSONB;
  BEGIN
    IF v.make IS NULL AND vd.make IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'make', 'vin_value', vd.make);
    END IF;
    IF v.model IS NULL AND vd.model IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'model', 'vin_value', vd.model);
    END IF;
    IF v.year IS NULL AND vd.year IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'year', 'vin_value', vd.year);
    END IF;
    IF v.drivetrain IS NULL AND vd.drivetrain IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'drivetrain', 'vin_value', vd.drivetrain);
    END IF;
    IF v.transmission IS NULL AND vd.transmission IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'transmission', 'vin_value', vd.transmission);
    END IF;
    IF v.engine_type IS NULL AND vd.engine_displacement_liters IS NOT NULL THEN
      missing := missing || jsonb_build_object('field', 'engine_type', 'vin_value', vd.engine_displacement_liters || 'L');
    END IF;
    
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'vin', v.vin,
      'conflicts', conflicts,
      'corrections', corrections,
      'missing_fields', missing,
      'vin_confidence', vd.confidence,
      'is_valid', jsonb_array_length(conflicts) = 0
    );
  END;
END;
$$;

-- ============================================
-- 4. AUTO-POPULATE FROM VIN
-- ============================================
-- Fills in missing vehicle data from VIN decode

CREATE OR REPLACE FUNCTION populate_vehicle_from_vin(p_vehicle_id UUID, p_override_conflicts BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  vd RECORD;
  updates JSONB := '{}'::JSONB;
  fields_updated TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF v IS NULL THEN RETURN jsonb_build_object('error', 'Vehicle not found'); END IF;
  
  IF v.vin IS NULL OR LENGTH(v.vin) < 11 THEN
    RETURN jsonb_build_object('error', 'No valid VIN');
  END IF;
  
  SELECT * INTO vd FROM vin_decoded_data WHERE vin = UPPER(v.vin);
  IF vd IS NULL THEN
    RETURN jsonb_build_object('error', 'VIN not decoded', 'needs_decode', true);
  END IF;
  
  -- Populate missing fields
  IF v.make IS NULL AND vd.make IS NOT NULL THEN
    UPDATE vehicles SET make = vd.make WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'make');
  ELSIF p_override_conflicts AND v.make IS NOT NULL AND vd.make IS NOT NULL AND UPPER(v.make) != UPPER(vd.make) THEN
    UPDATE vehicles SET make = vd.make WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'make (overridden)');
  END IF;
  
  IF v.model IS NULL AND vd.model IS NOT NULL THEN
    UPDATE vehicles SET model = vd.model WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'model');
  ELSIF p_override_conflicts AND v.model IS NOT NULL AND vd.model IS NOT NULL AND UPPER(v.model) != UPPER(vd.model) THEN
    UPDATE vehicles SET model = vd.model WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'model (overridden)');
  END IF;
  
  IF v.year IS NULL AND vd.year IS NOT NULL THEN
    UPDATE vehicles SET year = vd.year WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'year');
  ELSIF p_override_conflicts AND v.year IS NOT NULL AND vd.year IS NOT NULL AND v.year != vd.year THEN
    UPDATE vehicles SET year = vd.year WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'year (overridden)');
  END IF;
  
  IF v.drivetrain IS NULL AND vd.drivetrain IS NOT NULL THEN
    UPDATE vehicles SET drivetrain = vd.drivetrain WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'drivetrain');
  ELSIF p_override_conflicts AND v.drivetrain IS NOT NULL AND vd.drivetrain IS NOT NULL THEN
    UPDATE vehicles SET drivetrain = vd.drivetrain WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'drivetrain (overridden)');
  END IF;
  
  IF v.transmission IS NULL AND vd.transmission IS NOT NULL THEN
    UPDATE vehicles SET transmission = vd.transmission WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'transmission');
  END IF;
  
  IF v.engine_type IS NULL AND vd.engine_displacement_liters IS NOT NULL THEN
    UPDATE vehicles SET engine_type = vd.engine_displacement_liters || 'L' WHERE id = p_vehicle_id;
    fields_updated := array_append(fields_updated, 'engine_type');
  END IF;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'vin', v.vin,
    'fields_updated', fields_updated,
    'count', array_length(fields_updated, 1)
  );
END;
$$;

-- ============================================
-- 5. VIEW: Vehicles Needing VIN Decode
-- ============================================

CREATE OR REPLACE VIEW vehicles_needing_vin_decode AS
SELECT 
  v.id,
  v.vin,
  LENGTH(v.vin) as vin_length,
  v.year,
  v.make,
  v.model,
  CASE 
    WHEN LENGTH(v.vin) = 17 THEN 'full_decode'
    WHEN LENGTH(v.vin) BETWEEN 11 AND 16 THEN 'partial_decode'
    ELSE 'legacy_vin'
  END as decode_type
FROM vehicles v
LEFT JOIN vin_decoded_data vd ON UPPER(v.vin) = vd.vin
WHERE v.vin IS NOT NULL 
  AND v.vin != ''
  AND LENGTH(v.vin) >= 11
  AND vd.vin IS NULL
ORDER BY LENGTH(v.vin) DESC, v.created_at DESC;

-- ============================================
-- 6. VIEW: VIN Conflicts Dashboard
-- ============================================

CREATE OR REPLACE VIEW vin_conflicts_dashboard AS
SELECT 
  v.id as vehicle_id,
  v.vin,
  v.year || ' ' || v.make || ' ' || v.model as user_vehicle,
  vd.year || ' ' || vd.make || ' ' || vd.model as vin_vehicle,
  compare_vehicle_to_vin(v.id) as comparison
FROM vehicles v
JOIN vin_decoded_data vd ON UPPER(v.vin) = vd.vin
WHERE v.vin IS NOT NULL AND LENGTH(v.vin) >= 11;

-- ============================================
-- 7. RLS
-- ============================================

ALTER TABLE vin_decoded_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE vin_data_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view decoded VINs" ON vin_decoded_data FOR SELECT USING (true);
CREATE POLICY "Service role manages decoded VINs" ON vin_decoded_data FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can view conflicts" ON vin_data_conflicts FOR SELECT USING (true);
CREATE POLICY "Service role manages conflicts" ON vin_data_conflicts FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE vin_decoded_data IS 'Canonical vehicle data decoded from VINs - source of truth';
COMMENT ON TABLE vin_data_conflicts IS 'Tracks where user-entered data differs from VIN-decoded truth';
COMMENT ON FUNCTION compare_vehicle_to_vin IS 'Compares vehicle record to VIN-decoded canonical data';
COMMENT ON FUNCTION populate_vehicle_from_vin IS 'Auto-fills vehicle fields from VIN-decoded data';

