-- Ensure SPID Verification Trigger Exists
-- This migration creates the trigger function and trigger for auto-verifying vehicle data from SPID sheets
-- Migration: 20250201_ensure_spid_verification_trigger

-- First, ensure vehicle_spid_data table exists (if not already created)
CREATE TABLE IF NOT EXISTS vehicle_spid_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  
  -- Extracted data
  vin TEXT,
  model_code TEXT,
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

-- Create or replace the verification function
CREATE OR REPLACE FUNCTION verify_vehicle_from_spid()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_record RECORD;
  verification_results JSONB;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record 
  FROM vehicles 
  WHERE id = NEW.vehicle_id;
  
  -- Initialize results
  verification_results := '{}'::JSONB;
  
  -- 1. VIN VERIFICATION
  IF NEW.vin IS NOT NULL AND NEW.vin != '' THEN
    IF vehicle_record.vin IS NULL OR vehicle_record.vin = '' THEN
      -- Auto-fill VIN if empty
      UPDATE vehicles 
      SET vin = NEW.vin,
          vin_source = 'spid',
          vin_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      NEW.vin_matches_vehicle := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('vin', 'auto_filled', 'value', NEW.vin);
    ELSE
      -- Check if VIN matches
      NEW.vin_matches_vehicle := (vehicle_record.vin = NEW.vin);
      
      IF NOT NEW.vin_matches_vehicle THEN
        verification_results := verification_results || 
          jsonb_build_object('vin', 'mismatch_detected', 
            'vehicle_vin', vehicle_record.vin, 
            'spid_vin', NEW.vin);
      ELSE
        verification_results := verification_results || 
          jsonb_build_object('vin', 'verified_match');
      END IF;
    END IF;
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL AND NEW.paint_code_exterior != '' THEN
    IF vehicle_record.color IS NULL OR vehicle_record.color = '' THEN
      -- Auto-fill paint code (convert to color name if possible, or store code)
      UPDATE vehicles 
      SET color = NEW.paint_code_exterior,
          color_source = 'spid',
          color_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      NEW.paint_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled', 'value', NEW.paint_code_exterior);
    ELSE
      -- Check if paint code matches (might need to decode)
      NEW.paint_verified := (vehicle_record.color = NEW.paint_code_exterior OR 
                            vehicle_record.color LIKE '%' || NEW.paint_code_exterior || '%');
      
      IF NOT NEW.paint_verified THEN
        verification_results := verification_results || 
          jsonb_build_object('paint_code', 'mismatch_detected',
            'vehicle_color', vehicle_record.color,
            'spid_paint_code', NEW.paint_code_exterior);
      ELSE
        verification_results := verification_results || 
          jsonb_build_object('paint_code', 'verified_match');
      END IF;
    END IF;
  END IF;
  
  -- 3. ENGINE CODE VERIFICATION
  IF NEW.engine_code IS NOT NULL AND NEW.engine_code != '' THEN
    IF vehicle_record.engine IS NULL OR vehicle_record.engine = '' THEN
      UPDATE vehicles 
      SET engine = NEW.engine_code,
          engine_source = 'spid',
          engine_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      verification_results := verification_results || 
        jsonb_build_object('engine', 'auto_filled', 'value', NEW.engine_code);
    ELSE
      -- Check if engine matches
      IF vehicle_record.engine != NEW.engine_code THEN
        verification_results := verification_results || 
          jsonb_build_object('engine', 'mismatch_detected',
            'vehicle_engine', vehicle_record.engine,
            'spid_engine_code', NEW.engine_code);
      ELSE
        verification_results := verification_results || 
          jsonb_build_object('engine', 'verified_match');
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
      
      verification_results := verification_results || 
        jsonb_build_object('transmission', 'auto_filled', 'value', NEW.transmission_code);
    ELSE
      -- Check if transmission matches
      IF vehicle_record.transmission != NEW.transmission_code THEN
        verification_results := verification_results || 
          jsonb_build_object('transmission', 'mismatch_detected',
            'vehicle_transmission', vehicle_record.transmission,
            'spid_transmission_code', NEW.transmission_code);
      ELSE
        verification_results := verification_results || 
          jsonb_build_object('transmission', 'verified_match');
      END IF;
    END IF;
  END IF;
  
  -- 5. RPO CODES - ADD TO VEHICLE OPTIONS (if vehicle_options table exists)
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    -- Check if vehicle_options table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_options') THEN
      -- Insert each RPO code as a vehicle option
      INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
      SELECT 
        NEW.vehicle_id,
        unnest(NEW.rpo_codes),
        'spid',
        TRUE
      ON CONFLICT (vehicle_id, option_code) DO NOTHING;
      
      NEW.options_added := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('rpo_codes_added', array_length(NEW.rpo_codes, 1),
          'codes', NEW.rpo_codes);
    END IF;
  END IF;
  
  -- 6. MODEL CODE - Can be used for verification
  IF NEW.model_code IS NOT NULL AND NEW.model_code != '' THEN
    verification_results := verification_results || 
      jsonb_build_object('model_code', 'extracted', 'value', NEW.model_code);
  END IF;
  
  -- Log verification results (if vehicle_verification_log table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_verification_log') THEN
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
  END IF;
  
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

-- Enable RLS if not already enabled
ALTER TABLE vehicle_spid_data ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON vehicle_spid_data TO authenticated;
GRANT ALL ON vehicle_spid_data TO service_role;

-- Comments
COMMENT ON TABLE vehicle_spid_data IS 'Stores extracted data from GM SPID (Service Parts Identification) sheets. Auto-verifies vehicle data when SPID is detected.';
COMMENT ON FUNCTION verify_vehicle_from_spid IS 'Automatically verifies and updates vehicle data when SPID is detected. Fills missing fields, verifies existing fields, and logs discrepancies.';

