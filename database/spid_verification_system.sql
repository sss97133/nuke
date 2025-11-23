-- SPID Verification System
-- Creates tables and triggers for automatic vehicle verification from SPID sheets

-- 1. Create vehicle_spid_data table
CREATE TABLE IF NOT EXISTS vehicle_spid_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  
  -- Extracted data
  vin TEXT,
  build_date TEXT,
  sequence_number TEXT,
  paint_code_exterior TEXT,
  paint_code_interior TEXT,
  rpo_codes TEXT[], -- Array of RPO codes
  engine_code TEXT,
  transmission_code TEXT,
  axle_ratio TEXT,
  
  -- Metadata
  extraction_confidence INTEGER, -- 0-100
  raw_text TEXT, -- Original OCR text
  extraction_model TEXT DEFAULT 'gpt-4o',
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Verification status
  vin_matches_vehicle BOOLEAN DEFAULT NULL,
  paint_verified BOOLEAN DEFAULT NULL,
  options_added BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id) -- One SPID per vehicle (updates if re-scanned)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_spid_vehicle_id ON vehicle_spid_data(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_spid_image_id ON vehicle_spid_data(image_id);

-- Enable RLS
ALTER TABLE vehicle_spid_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view SPID data for vehicles they own" ON vehicle_spid_data;
CREATE POLICY "Users can view SPID data for vehicles they own" 
  ON vehicle_spid_data FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_spid_data.vehicle_id
      AND v.uploaded_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view SPID data for public vehicles" ON vehicle_spid_data;
CREATE POLICY "Users can view SPID data for public vehicles" 
  ON vehicle_spid_data FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_spid_data.vehicle_id
      AND v.is_public = TRUE
    )
  );

-- Service role can insert/update
DROP POLICY IF EXISTS "Service role can manage SPID data" ON vehicle_spid_data;
CREATE POLICY "Service role can manage SPID data" 
  ON vehicle_spid_data FOR ALL 
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 2. Create vehicle_options table (if not exists)
CREATE TABLE IF NOT EXISTS vehicle_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  option_code TEXT NOT NULL,
  option_name TEXT,
  category TEXT, -- engine, transmission, interior, exterior, chassis
  source TEXT DEFAULT 'manual', -- manual, spid, decoded, inferred
  verified_by_spid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, option_code)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_options_vehicle_id ON vehicle_options(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_options_code ON vehicle_options(option_code);

-- Enable RLS
ALTER TABLE vehicle_options ENABLE ROW LEVEL SECURITY;

-- RLS for vehicle_options
DROP POLICY IF EXISTS "Users can view options for their vehicles" ON vehicle_options;
CREATE POLICY "Users can view options for their vehicles" 
  ON vehicle_options FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_options.vehicle_id
      AND v.uploaded_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view options for public vehicles" ON vehicle_options;
CREATE POLICY "Users can view options for public vehicles" 
  ON vehicle_options FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_options.vehicle_id
      AND v.is_public = TRUE
    )
  );

DROP POLICY IF EXISTS "Service role can manage options" ON vehicle_options;
CREATE POLICY "Service role can manage options" 
  ON vehicle_options FOR ALL 
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 3. Create verification log table
CREATE TABLE IF NOT EXISTS vehicle_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  verification_type TEXT NOT NULL, -- spid_auto_verification, manual_verification, etc
  source TEXT NOT NULL, -- spid_sheet, title, registration, etc
  results JSONB, -- Verification results
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_log_vehicle_id ON vehicle_verification_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_verification_log_type ON vehicle_verification_log(verification_type);

-- 4. Auto-verification function
CREATE OR REPLACE FUNCTION verify_vehicle_from_spid()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_record RECORD;
  verification_results JSONB := '{}'::JSONB;
  model_series_code TEXT;
  cab_code TEXT;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record 
  FROM vehicles 
  WHERE id = NEW.vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', NEW.vehicle_id;
  END IF;
  
  -- 0. DECODE MODEL CODE (if present)
  -- Example: CCE2436 → C20, Crew Cab, 1984
  IF NEW.model_code IS NOT NULL AND length(NEW.model_code) >= 6 THEN
    -- Extract body series from positions 4-5 (24 = C20)
    model_series_code := substring(NEW.model_code, 4, 2);
    
    UPDATE vehicles 
    SET model_series = CASE model_series_code
      WHEN '14' THEN 'C10'
      WHEN '15' THEN 'C10 Long'
      WHEN '24' THEN 'C20'
      WHEN '25' THEN 'C20 Long'
      WHEN '34' THEN 'C30'
      ELSE model_series
    END
    WHERE id = NEW.vehicle_id
      AND (model_series IS NULL OR model_series = '');
    
    -- Extract cab config from position 6 (3 = crew cab)
    cab_code := substring(NEW.model_code, 6, 1);
    
    UPDATE vehicles
    SET cab_config = CASE cab_code
      WHEN '3' THEN 'Crew Cab (3+3)'
      WHEN '4' THEN 'Regular Cab'
      WHEN '5' THEN 'Extended Cab'
      ELSE cab_config
    END
    WHERE id = NEW.vehicle_id
      AND (cab_config IS NULL OR cab_config = '');
    
    verification_results := verification_results || 
      jsonb_build_object(
        'model_code_decoded', true,
        'model_series', (SELECT model_series FROM vehicles WHERE id = NEW.vehicle_id),
        'cab_config', (SELECT cab_config FROM vehicles WHERE id = NEW.vehicle_id)
      );
  END IF;
  
  -- 1. VIN VERIFICATION
  IF NEW.vin IS NOT NULL AND NEW.vin != '' THEN
    IF vehicle_record.vin IS NULL OR vehicle_record.vin = '' THEN
      -- Auto-fill VIN if empty
      UPDATE vehicles 
      SET vin = NEW.vin
      WHERE id = NEW.vehicle_id;
      
      NEW.vin_matches_vehicle := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('vin', 'auto_filled', 'value', NEW.vin);
    ELSE
      -- Check if VINs match
      NEW.vin_matches_vehicle := (vehicle_record.vin = NEW.vin);
      
      verification_results := verification_results || 
        jsonb_build_object(
          'vin', 
          CASE WHEN NEW.vin_matches_vehicle THEN 'verified' ELSE 'mismatch' END,
          'spid_vin', NEW.vin,
          'vehicle_vin', vehicle_record.vin
        );
    END IF;
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL AND NEW.paint_code_exterior != '' THEN
    IF vehicle_record.paint_code IS NULL OR vehicle_record.paint_code = '' THEN
      -- Auto-fill paint code
      UPDATE vehicles 
      SET paint_code = NEW.paint_code_exterior
      WHERE id = NEW.vehicle_id;
      
      NEW.paint_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled', 'value', NEW.paint_code_exterior);
    ELSE
      -- Check if paint codes match
      NEW.paint_verified := (vehicle_record.paint_code = NEW.paint_code_exterior);
      
      verification_results := verification_results || 
        jsonb_build_object(
          'paint_code',
          CASE WHEN NEW.paint_verified THEN 'verified' ELSE 'mismatch' END,
          'spid_code', NEW.paint_code_exterior,
          'vehicle_code', vehicle_record.paint_code
        );
    END IF;
  END IF;
  
  -- 3. RPO CODES - DECODE AND UPDATE VEHICLE DATA
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    -- Insert each RPO code as a vehicle option WITH decoded names
    INSERT INTO vehicle_options (vehicle_id, option_code, option_name, category, source, verified_by_spid)
    SELECT 
      NEW.vehicle_id,
      code,
      COALESCE(rpo.name, 'Unknown Option'),
      COALESCE(rpo.category, 'unknown'),
      'spid',
      TRUE
    FROM unnest(NEW.rpo_codes) AS code
    LEFT JOIN rpo_code_definitions rpo ON rpo.code = code
    ON CONFLICT (vehicle_id, option_code) 
    DO UPDATE SET 
      option_name = EXCLUDED.option_name,
      category = EXCLUDED.category,
      verified_by_spid = TRUE,
      source = 'spid';
    
    NEW.options_added := TRUE;
    
    -- Decode trim from RPO codes (Z84=Silverado, YE9=Cheyenne, etc.)
    UPDATE vehicles v
    SET trim_level = rpo.trim_name
    FROM unnest(NEW.rpo_codes) AS code
    JOIN rpo_code_definitions rpo ON rpo.code = code
    WHERE v.id = NEW.vehicle_id
      AND rpo.trim_name IS NOT NULL
      AND (v.trim_level IS NULL OR v.trim_level = '')
    LIMIT 1;
    
    -- Decode engine from RPO codes (LS4=454, L31=350, etc.)
    UPDATE vehicles v
    SET 
      engine_code = rpo.code,
      engine_displacement = rpo.engine_displacement,
      engine_liters = rpo.engine_liters,
      engine_type = 'V8',
      engine = rpo.engine_displacement || 'ci V8 (' || rpo.engine_liters || 'L)'
    FROM unnest(NEW.rpo_codes) AS code
    JOIN rpo_code_definitions rpo ON rpo.code = code
    WHERE v.id = NEW.vehicle_id
      AND rpo.category = 'engine'
      AND (v.engine IS NULL OR v.engine = '')
    LIMIT 1;
    
    -- Decode transmission from RPO codes (M40=TH400, M38=TH350, etc.)
    UPDATE vehicles v
    SET 
      transmission_code = rpo.code,
      transmission_model = rpo.transmission_model,
      transmission_type = rpo.transmission_type,
      transmission = rpo.transmission_model || ' ' || rpo.transmission_type
    FROM unnest(NEW.rpo_codes) AS code
    JOIN rpo_code_definitions rpo ON rpo.code = code
    WHERE v.id = NEW.vehicle_id
      AND rpo.category = 'transmission'
      AND (v.transmission IS NULL OR v.transmission = '' OR v.transmission = 'automatic')
    LIMIT 1;
    
    verification_results := verification_results || 
      jsonb_build_object(
        'rpo_codes_added', array_length(NEW.rpo_codes, 1),
        'codes', NEW.rpo_codes,
        'trim_decoded', (SELECT trim_level FROM vehicles WHERE id = NEW.vehicle_id),
        'engine_decoded', (SELECT engine FROM vehicles WHERE id = NEW.vehicle_id),
        'transmission_decoded', (SELECT transmission FROM vehicles WHERE id = NEW.vehicle_id)
      );
  END IF;
  
  -- 4. ENGINE CODE
  IF NEW.engine_code IS NOT NULL AND NEW.engine_code != '' THEN
    IF vehicle_record.engine IS NULL OR vehicle_record.engine = '' THEN
      UPDATE vehicles 
      SET engine = NEW.engine_code
      WHERE id = NEW.vehicle_id;
      
      verification_results := verification_results || 
        jsonb_build_object('engine', 'auto_filled', 'value', NEW.engine_code);
    END IF;
  END IF;
  
  -- 5. TRANSMISSION CODE
  IF NEW.transmission_code IS NOT NULL AND NEW.transmission_code != '' THEN
    IF vehicle_record.transmission IS NULL OR vehicle_record.transmission = '' THEN
      UPDATE vehicles 
      SET transmission = NEW.transmission_code
      WHERE id = NEW.vehicle_id;
      
      verification_results := verification_results || 
        jsonb_build_object('transmission', 'auto_filled', 'value', NEW.transmission_code);
    END IF;
  END IF;
  
  -- Log verification results
  INSERT INTO vehicle_verification_log (
    vehicle_id,
    verification_type,
    source,
    results
  ) VALUES (
    NEW.vehicle_id,
    'spid_auto_verification',
    'spid_sheet',
    verification_results
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_verify_vehicle_from_spid ON vehicle_spid_data;

-- Create trigger
CREATE TRIGGER trigger_verify_vehicle_from_spid
  BEFORE INSERT OR UPDATE ON vehicle_spid_data
  FOR EACH ROW
  EXECUTE FUNCTION verify_vehicle_from_spid();

-- Grant permissions
GRANT ALL ON vehicle_spid_data TO authenticated;
GRANT ALL ON vehicle_options TO authenticated;
GRANT ALL ON vehicle_verification_log TO authenticated;

-- Comments
COMMENT ON TABLE vehicle_spid_data IS 'Stores extracted data from GM SPID (Service Parts Identification) sheets';
COMMENT ON TABLE vehicle_options IS 'Stores RPO codes and factory options for vehicles';
COMMENT ON TABLE vehicle_verification_log IS 'Logs all vehicle data verification events';
COMMENT ON FUNCTION verify_vehicle_from_spid IS 'Automatically verifies and updates vehicle data when SPID is detected';

