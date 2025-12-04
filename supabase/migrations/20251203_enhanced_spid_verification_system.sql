-- Enhanced SPID Verification System with VIN Decoding
-- Migration: 20251203_enhanced_spid_verification_system
-- Purpose: Auto-trigger VIN decoding and comprehensive verification when SPID is detected

-- 1. Create VIN decode cache table
CREATE TABLE IF NOT EXISTS vin_decode_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT UNIQUE NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT false,
  
  -- Decoded vehicle data
  year INTEGER,
  make TEXT,
  model TEXT,
  trim TEXT,
  engine_size TEXT,
  engine_cylinders INTEGER,
  displacement_cc INTEGER,
  displacement_liters TEXT,
  fuel_type TEXT,
  transmission TEXT,
  transmission_speeds TEXT,
  drivetrain TEXT,
  body_type TEXT,
  doors INTEGER,
  manufacturer TEXT,
  plant_country TEXT,
  plant_city TEXT,
  series TEXT,
  vehicle_type TEXT,
  gvwr TEXT,
  brake_system TEXT,
  
  -- Metadata
  error_message TEXT,
  confidence INTEGER DEFAULT 0,
  decoded_at TIMESTAMPTZ DEFAULT NOW(),
  provider TEXT DEFAULT 'nhtsa',
  raw_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vin_decode_cache_vin ON vin_decode_cache(vin);
CREATE INDEX IF NOT EXISTS idx_vin_decode_cache_valid ON vin_decode_cache(valid);
CREATE INDEX IF NOT EXISTS idx_vin_decode_cache_decoded_at ON vin_decode_cache(decoded_at);

-- Enable RLS
ALTER TABLE vin_decode_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (VIN data is public information)
DROP POLICY IF EXISTS "Anyone can view VIN decode cache" ON vin_decode_cache;
CREATE POLICY "Anyone can view VIN decode cache" 
  ON vin_decode_cache FOR SELECT 
  TO PUBLIC
  USING (true);

-- Service role can insert/update
DROP POLICY IF EXISTS "Service role can manage VIN cache" ON vin_decode_cache;
CREATE POLICY "Service role can manage VIN cache" 
  ON vin_decode_cache FOR ALL 
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 2. Create comprehensive verification results table
CREATE TABLE IF NOT EXISTS vehicle_comprehensive_verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  
  -- Verification sources
  has_spid BOOLEAN DEFAULT false,
  has_vin_decode BOOLEAN DEFAULT false,
  has_title BOOLEAN DEFAULT false,
  has_registration BOOLEAN DEFAULT false,
  
  -- Cross-verification results
  vin_verified BOOLEAN DEFAULT NULL,
  year_verified BOOLEAN DEFAULT NULL,
  make_verified BOOLEAN DEFAULT NULL,
  model_verified BOOLEAN DEFAULT NULL,
  engine_verified BOOLEAN DEFAULT NULL,
  transmission_verified BOOLEAN DEFAULT NULL,
  color_verified BOOLEAN DEFAULT NULL,
  
  -- Verification scores
  overall_confidence INTEGER DEFAULT 0, -- 0-100
  data_completeness INTEGER DEFAULT 0, -- 0-100
  
  -- Discrepancies
  discrepancies JSONB DEFAULT '[]'::JSONB,
  
  -- Verification metadata
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  verified_by TEXT DEFAULT 'system',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id) -- One verification record per vehicle
);

CREATE INDEX IF NOT EXISTS idx_vehicle_comprehensive_verification_vehicle_id 
  ON vehicle_comprehensive_verification(vehicle_id);

-- Enable RLS
ALTER TABLE vehicle_comprehensive_verification ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view verification for their vehicles" ON vehicle_comprehensive_verification;
CREATE POLICY "Users can view verification for their vehicles" 
  ON vehicle_comprehensive_verification FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_comprehensive_verification.vehicle_id
      AND v.uploaded_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view verification for public vehicles" ON vehicle_comprehensive_verification;
CREATE POLICY "Users can view verification for public vehicles" 
  ON vehicle_comprehensive_verification FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_comprehensive_verification.vehicle_id
      AND v.is_public = TRUE
    )
  );

DROP POLICY IF EXISTS "Service role can manage verification" ON vehicle_comprehensive_verification;
CREATE POLICY "Service role can manage verification" 
  ON vehicle_comprehensive_verification FOR ALL 
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 3. Function to trigger VIN decoding via Edge Function
CREATE OR REPLACE FUNCTION trigger_vin_decode(
  p_vin TEXT,
  p_vehicle_id UUID,
  p_source TEXT DEFAULT 'spid'
) RETURNS void AS $$
DECLARE
  v_response TEXT;
BEGIN
  -- Call the decode-vin Edge Function via pg_net (if available)
  -- This is async - the function will update the vehicle when done
  BEGIN
    SELECT content INTO v_response
    FROM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/decode-vin',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'vin', p_vin,
        'vehicle_id', p_vehicle_id,
        'source', p_source
      )
    );
    
    RAISE NOTICE 'VIN decode triggered for %: %', p_vin, v_response;
  EXCEPTION
    WHEN OTHERS THEN
      -- If pg_net is not available or fails, log but don't fail the transaction
      RAISE WARNING 'Failed to trigger VIN decode for %: %', p_vin, SQLERRM;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enhanced SPID verification function with VIN decoding
CREATE OR REPLACE FUNCTION verify_vehicle_from_spid_enhanced()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_record RECORD;
  verification_results JSONB;
  v_discrepancies JSONB := '[]'::JSONB;
  v_vin_verified BOOLEAN := NULL;
  v_year_verified BOOLEAN := NULL;
  v_make_verified BOOLEAN := NULL;
  v_model_verified BOOLEAN := NULL;
  v_engine_verified BOOLEAN := NULL;
  v_transmission_verified BOOLEAN := NULL;
  v_color_verified BOOLEAN := NULL;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record 
  FROM vehicles 
  WHERE id = NEW.vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', NEW.vehicle_id;
  END IF;
  
  verification_results := '{}'::JSONB;
  
  -- 1. VIN VERIFICATION & DECODING
  IF NEW.vin IS NOT NULL AND NEW.vin != '' THEN
    -- Trigger VIN decoding (async)
    PERFORM trigger_vin_decode(NEW.vin, NEW.vehicle_id, 'spid');
    
    IF vehicle_record.vin IS NULL OR vehicle_record.vin = '' THEN
      -- Auto-fill VIN if empty
      UPDATE vehicles 
      SET vin = NEW.vin,
          vin_source = 'spid',
          vin_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_vin_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('vin', 'auto_filled', 'value', NEW.vin);
    ELSE
      -- Check if VINs match
      v_vin_verified := (vehicle_record.vin = NEW.vin);
      
      IF NOT v_vin_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'vin',
            'spid_value', NEW.vin,
            'vehicle_value', vehicle_record.vin,
            'severity', 'high'
          )
        );
      END IF;
      
      verification_results := verification_results || 
        jsonb_build_object(
          'vin', 
          CASE WHEN v_vin_verified THEN 'verified' ELSE 'mismatch' END,
          'spid_vin', NEW.vin,
          'vehicle_vin', vehicle_record.vin
        );
    END IF;
    
    NEW.vin_matches_vehicle := v_vin_verified;
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL AND NEW.paint_code_exterior != '' THEN
    IF vehicle_record.color IS NULL OR vehicle_record.color = '' THEN
      UPDATE vehicles 
      SET color = NEW.paint_code_exterior,
          color_source = 'spid',
          color_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_color_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled', 'value', NEW.paint_code_exterior);
    ELSE
      v_color_verified := (
        vehicle_record.color = NEW.paint_code_exterior OR 
        vehicle_record.color LIKE '%' || NEW.paint_code_exterior || '%'
      );
      
      IF NOT v_color_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'color',
            'spid_value', NEW.paint_code_exterior,
            'vehicle_value', vehicle_record.color,
            'severity', 'low'
          )
        );
      END IF;
    END IF;
    
    NEW.paint_verified := v_color_verified;
  END IF;
  
  -- 3. ENGINE CODE VERIFICATION
  IF NEW.engine_code IS NOT NULL AND NEW.engine_code != '' THEN
    IF vehicle_record.engine IS NULL OR vehicle_record.engine = '' THEN
      UPDATE vehicles 
      SET engine = NEW.engine_code,
          engine_source = 'spid',
          engine_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_engine_verified := TRUE;
    ELSE
      v_engine_verified := (vehicle_record.engine = NEW.engine_code OR
                           vehicle_record.engine LIKE '%' || NEW.engine_code || '%');
      
      IF NOT v_engine_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'engine',
            'spid_value', NEW.engine_code,
            'vehicle_value', vehicle_record.engine,
            'severity', 'medium'
          )
        );
      END IF;
    END IF;
  END IF;
  
  -- 4. TRANSMISSION CODE VERIFICATION
  IF NEW.transmission_code IS NOT NULL AND NEW.transmission_code != '' THEN
    IF vehicle_record.transmission IS NULL OR vehicle_record.transmission = '' THEN
      UPDATE vehicles 
      SET transmission = NEW.transmission_code,
          transmission_source = 'spid',
          transmission_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_transmission_verified := TRUE;
    ELSE
      v_transmission_verified := (vehicle_record.transmission = NEW.transmission_code OR
                                 vehicle_record.transmission LIKE '%' || NEW.transmission_code || '%');
      
      IF NOT v_transmission_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'transmission',
            'spid_value', NEW.transmission_code,
            'vehicle_value', vehicle_record.transmission,
            'severity', 'medium'
          )
        );
      END IF;
    END IF;
  END IF;
  
  -- 5. RPO CODES - ADD TO VEHICLE OPTIONS
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_options') THEN
      INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
      SELECT 
        NEW.vehicle_id,
        unnest(NEW.rpo_codes),
        'spid',
        TRUE
      ON CONFLICT (vehicle_id, option_code) DO UPDATE
      SET verified_by_spid = TRUE, source = 'spid';
      
      NEW.options_added := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('rpo_codes_added', array_length(NEW.rpo_codes, 1), 'codes', NEW.rpo_codes);
    END IF;
  END IF;
  
  -- 6. MODEL CODE VERIFICATION
  IF NEW.model_code IS NOT NULL AND NEW.model_code != '' THEN
    verification_results := verification_results || 
      jsonb_build_object('model_code', 'extracted', 'value', NEW.model_code);
  END IF;
  
  -- 7. Create/Update Comprehensive Verification Record
  INSERT INTO vehicle_comprehensive_verification (
    vehicle_id,
    has_spid,
    vin_verified,
    year_verified,
    make_verified,
    model_verified,
    engine_verified,
    transmission_verified,
    color_verified,
    discrepancies,
    overall_confidence,
    verified_at
  ) VALUES (
    NEW.vehicle_id,
    true,
    v_vin_verified,
    v_year_verified,
    v_make_verified,
    v_model_verified,
    v_engine_verified,
    v_transmission_verified,
    v_color_verified,
    v_discrepancies,
    NEW.extraction_confidence,
    NOW()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    has_spid = true,
    vin_verified = COALESCE(EXCLUDED.vin_verified, vehicle_comprehensive_verification.vin_verified),
    engine_verified = COALESCE(EXCLUDED.engine_verified, vehicle_comprehensive_verification.engine_verified),
    transmission_verified = COALESCE(EXCLUDED.transmission_verified, vehicle_comprehensive_verification.transmission_verified),
    color_verified = COALESCE(EXCLUDED.color_verified, vehicle_comprehensive_verification.color_verified),
    discrepancies = EXCLUDED.discrepancies,
    overall_confidence = GREATEST(EXCLUDED.overall_confidence, vehicle_comprehensive_verification.overall_confidence),
    verified_at = NOW(),
    updated_at = NOW();
  
  -- 8. Log verification results
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_verification_log') THEN
    INSERT INTO vehicle_verification_log (
      vehicle_id,
      verification_type,
      source,
      results
    ) VALUES (
      NEW.vehicle_id,
      'spid_comprehensive_verification',
      'spid_sheet',
      verification_results || jsonb_build_object('discrepancies', v_discrepancies)
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger and create new one
DROP TRIGGER IF EXISTS trigger_verify_vehicle_from_spid ON vehicle_spid_data;
DROP TRIGGER IF EXISTS trigger_verify_vehicle_from_spid_enhanced ON vehicle_spid_data;

CREATE TRIGGER trigger_verify_vehicle_from_spid_enhanced
  BEFORE INSERT OR UPDATE ON vehicle_spid_data
  FOR EACH ROW
  EXECUTE FUNCTION verify_vehicle_from_spid_enhanced();

-- Grant permissions
GRANT ALL ON vin_decode_cache TO authenticated;
GRANT ALL ON vin_decode_cache TO service_role;
GRANT ALL ON vehicle_comprehensive_verification TO authenticated;
GRANT ALL ON vehicle_comprehensive_verification TO service_role;

-- Comments
COMMENT ON TABLE vin_decode_cache IS 'Caches VIN decoding results from NHTSA VPIC API (7-day cache)';
COMMENT ON TABLE vehicle_comprehensive_verification IS 'Stores comprehensive verification status combining SPID, VIN decode, and other sources';
COMMENT ON FUNCTION verify_vehicle_from_spid_enhanced IS 'Enhanced SPID verification that triggers VIN decoding and cross-verification';
COMMENT ON FUNCTION trigger_vin_decode IS 'Triggers async VIN decoding via Edge Function';

