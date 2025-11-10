-- OEM Factory Specifications Database
-- Auto-populate vehicle specs from VIN + year/make/model

-- 1. Create comprehensive OEM specs table
CREATE TABLE IF NOT EXISTS oem_vehicle_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identification
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INTEGER NOT NULL,
  year_end INTEGER,
  trim_level TEXT,
  series TEXT, -- C10, K1500, etc.
  body_style TEXT, -- Pickup, Suburban, 2-door, 4-door
  
  -- Dimensions (inches unless noted)
  wheelbase_inches NUMERIC,
  length_inches NUMERIC,
  width_inches NUMERIC,
  height_inches NUMERIC,
  ground_clearance_inches NUMERIC,
  bed_length_inches NUMERIC, -- For trucks
  
  -- Weight (lbs)
  curb_weight_lbs INTEGER,
  gross_vehicle_weight_lbs INTEGER,
  payload_capacity_lbs INTEGER,
  towing_capacity_lbs INTEGER,
  
  -- Powertrain
  engine_size TEXT, -- "5.7L V8", "350 CID V8"
  engine_displacement_liters NUMERIC,
  engine_displacement_cid INTEGER,
  engine_config TEXT, -- V8, I6, V6
  horsepower INTEGER,
  torque_ft_lbs INTEGER,
  fuel_type TEXT, -- gasoline, diesel, propane
  transmission TEXT,
  drivetrain TEXT, -- 2WD, 4WD, AWD
  drive_type TEXT, -- C (2WD), K (4WD), V (4WD SUV)
  
  -- Fuel Economy
  mpg_city NUMERIC,
  mpg_highway NUMERIC,
  mpg_combined NUMERIC,
  fuel_tank_gallons NUMERIC,
  
  -- Specifications
  doors INTEGER,
  seats INTEGER,
  cab_style TEXT, -- Regular, Extended, Crew
  
  -- Factory Colors (array of available paint codes for this model/year)
  available_paint_codes TEXT[],
  
  -- Metadata
  source TEXT, -- 'NHTSA', 'GM_Heritage', 'Manual_Entry'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_oem_specs_make_model_year ON oem_vehicle_specs(make, model, year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_oem_specs_series ON oem_vehicle_specs(series);
CREATE INDEX IF NOT EXISTS idx_oem_specs_body_style ON oem_vehicle_specs(body_style);

-- 3. Insert comprehensive GM truck/SUV specs (sample - expand as needed)

-- 1977-1980 C/K 10 Pickup Short Bed
INSERT INTO oem_vehicle_specs (
  make, model, year_start, year_end, series, body_style, trim_level,
  wheelbase_inches, length_inches, width_inches, height_inches,
  curb_weight_lbs, payload_capacity_lbs, towing_capacity_lbs,
  engine_size, engine_displacement_cid, engine_config, horsepower, torque_ft_lbs,
  fuel_type, transmission, drivetrain, drive_type,
  mpg_city, mpg_highway, fuel_tank_gallons,
  doors, seats, cab_style,
  available_paint_codes,
  source
) VALUES
  -- 1977-1980 Chevrolet C10 Short Bed
  ('Chevrolet', 'C10', 1977, 1980, 'C10', 'Pickup Short Bed', 'Cheyenne',
   117.5, 194.1, 76.8, 72.8,
   3800, 1600, 6000,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '2WD', 'C',
   12, 16, 25,
   2, 3, 'Regular Cab',
   ARRAY['10', '40', '70', '50', '63', '67'],
   'GM_Heritage'),
  
  -- 1977-1980 Chevrolet K10 Short Bed (4WD)
  ('Chevrolet', 'K10', 1977, 1980, 'K10', 'Pickup Short Bed', 'Cheyenne',
   117.5, 194.1, 76.8, 75.3,
   4200, 1400, 5500,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '4WD', 'K',
   11, 14, 25,
   2, 3, 'Regular Cab',
   ARRAY['10', '40', '70', '50', '63', '67'],
   'GM_Heritage'),
  
  -- 1973-1980 Chevrolet K5 Blazer
  ('Chevrolet', 'K5 Blazer', 1973, 1980, 'K5', 'SUV 2-door', 'Cheyenne',
   106.5, 184.8, 79.5, 72.0,
   4400, 1200, 5000,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '4WD', 'K',
   10, 13, 25,
   2, 4, 'Full Size SUV',
   ARRAY['10', '40', '70', '50', '63', '67', '74'],
   'GM_Heritage'),
  
  -- 1973-1980 Chevrolet Suburban C10
  ('Chevrolet', 'Suburban', 1973, 1980, 'C10', 'SUV 4-door', 'Custom Deluxe',
   129.5, 219.9, 79.5, 75.4,
   5200, 1800, 7000,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '2WD', 'C',
   10, 14, 31,
   4, 9, 'Full Size SUV',
   ARRAY['10', '40', '70', '50', '63', '86'],
   'GM_Heritage'),
  
  -- 1973-1980 Chevrolet Suburban K10 (4WD)
  ('Chevrolet', 'Suburban', 1973, 1980, 'K10', 'SUV 4-door', 'Custom Deluxe',
   129.5, 219.9, 79.5, 77.9,
   5600, 1600, 6500,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '4WD', 'K',
   9, 12, 31,
   4, 9, 'Full Size SUV',
   ARRAY['10', '40', '70', '50', '63', '86'],
   'GM_Heritage'),
  
  -- 1988-1999 Chevrolet C1500 Silverado Extended Cab
  ('Chevrolet', 'C1500', 1988, 1999, 'C1500', 'Pickup Extended Cab', 'Silverado',
   131.5, 217.5, 76.8, 72.6,
   4200, 1650, 7500,
   '5.7L V8', 350, 'V8', 210, 300,
   'gasoline', '4-speed automatic', '2WD', 'C',
   14, 18, 25,
   4, 6, 'Extended Cab',
   ARRAY['10', '11', '40', '72', '80'],
   'NHTSA'),
  
  -- 1988-1999 Chevrolet K1500 Silverado Extended Cab (4WD)
  ('Chevrolet', 'K1500', 1988, 1999, 'K1500', 'Pickup Extended Cab', 'Silverado',
   131.5, 217.5, 76.8, 75.1,
   4600, 1500, 7000,
   '5.7L V8', 350, 'V8', 210, 300,
   'gasoline', '4-speed automatic', '4WD', 'K',
   13, 16, 25,
   4, 6, 'Extended Cab',
   ARRAY['10', '11', '40', '72', '80'],
   'NHTSA');

-- Add GMC equivalents (same specs, different make)
INSERT INTO oem_vehicle_specs (
  make, model, year_start, year_end, series, body_style, trim_level,
  wheelbase_inches, length_inches, width_inches, height_inches,
  curb_weight_lbs, payload_capacity_lbs, towing_capacity_lbs,
  engine_size, engine_displacement_cid, engine_config, horsepower, torque_ft_lbs,
  fuel_type, transmission, drivetrain, drive_type,
  mpg_city, mpg_highway, fuel_tank_gallons,
  doors, seats, cab_style,
  available_paint_codes,
  source
) VALUES
  -- 1977-1980 GMC K15 Sierra
  ('GMC', 'K15', 1977, 1980, 'K15', 'Pickup Short Bed', 'Sierra',
   117.5, 194.1, 76.8, 75.3,
   4200, 1400, 5500,
   '5.7L V8', 350, 'V8', 165, 255,
   'gasoline', '3-speed automatic', '4WD', 'K',
   11, 14, 25,
   2, 3, 'Regular Cab',
   ARRAY['10', '40', '70', '50', '63'],
   'GM_Heritage'),
  
  -- 1988-1999 GMC K1500 Sierra SLE
  ('GMC', 'K1500', 1988, 1999, 'K1500', 'Pickup Extended Cab', 'SLE',
   131.5, 217.5, 76.8, 75.1,
   4600, 1500, 7000,
   '5.7L V8', 350, 'V8', 210, 300,
   'gasoline', '4-speed automatic', '4WD', 'K',
   13, 16, 25,
   4, 6, 'Extended Cab',
   ARRAY['10', '11', '40', '72', '80'],
   'NHTSA');

-- 4. Create function to auto-populate vehicle specs
CREATE OR REPLACE FUNCTION auto_populate_vehicle_specs(
  p_vehicle_id UUID,
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_trim TEXT DEFAULT NULL,
  p_body_style TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_spec RECORD;
  v_updated_fields JSONB := '{}';
BEGIN
  -- Find matching OEM spec (prioritize exact trim match, then body style, then general)
  SELECT * INTO v_spec
  FROM oem_vehicle_specs
  WHERE make ILIKE p_make
    AND model ILIKE p_model
    AND year_start <= p_year
    AND (year_end IS NULL OR year_end >= p_year)
    AND (p_trim IS NULL OR trim_level ILIKE p_trim OR p_trim IS NULL)
    AND (p_body_style IS NULL OR body_style ILIKE p_body_style OR p_body_style IS NULL)
  ORDER BY 
    CASE WHEN trim_level ILIKE p_trim THEN 1 ELSE 2 END,
    CASE WHEN body_style ILIKE p_body_style THEN 1 ELSE 2 END
  LIMIT 1;
  
  IF v_spec.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No OEM specs found');
  END IF;
  
  -- Update vehicle with OEM specs (only if field is NULL or empty)
  UPDATE vehicles
  SET
    wheelbase_inches = COALESCE(wheelbase_inches, v_spec.wheelbase_inches),
    length_inches = COALESCE(length_inches, v_spec.length_inches),
    width_inches = COALESCE(width_inches, v_spec.width_inches),
    height_inches = COALESCE(height_inches, v_spec.height_inches),
    weight_lbs = COALESCE(weight_lbs, v_spec.curb_weight_lbs),
    engine_size = COALESCE(engine_size, v_spec.engine_size),
    horsepower = COALESCE(horsepower, v_spec.horsepower),
    torque = COALESCE(torque, v_spec.torque_ft_lbs),
    fuel_type = COALESCE(fuel_type, v_spec.fuel_type),
    transmission = COALESCE(transmission, v_spec.transmission),
    drivetrain = COALESCE(drivetrain, v_spec.drivetrain),
    doors = COALESCE(doors, v_spec.doors),
    seats = COALESCE(seats, v_spec.seats),
    body_style = COALESCE(body_style, v_spec.body_style),
    mpg_city = COALESCE(mpg_city, v_spec.mpg_city),
    mpg_highway = COALESCE(mpg_highway, v_spec.mpg_highway),
    mpg_combined = COALESCE(mpg_combined, v_spec.mpg_combined)
  WHERE id = p_vehicle_id;
  
  -- Build response with populated fields
  v_updated_fields := jsonb_build_object(
    'success', true,
    'source', v_spec.source,
    'specs', jsonb_build_object(
      'wheelbase_inches', v_spec.wheelbase_inches,
      'length_inches', v_spec.length_inches,
      'width_inches', v_spec.width_inches,
      'height_inches', v_spec.height_inches,
      'weight_lbs', v_spec.curb_weight_lbs,
      'engine_size', v_spec.engine_size,
      'horsepower', v_spec.horsepower,
      'torque_ft_lbs', v_spec.torque_ft_lbs,
      'drivetrain', v_spec.drivetrain,
      'doors', v_spec.doors,
      'seats', v_spec.seats,
      'mpg_city', v_spec.mpg_city,
      'mpg_highway', v_spec.mpg_highway
    )
  );
  
  RETURN v_updated_fields;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger to auto-populate on INSERT
CREATE OR REPLACE FUNCTION trigger_auto_populate_specs()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-populate specs when new vehicle is created
  IF NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL THEN
    PERFORM auto_populate_vehicle_specs(
      NEW.id,
      NEW.year,
      NEW.make,
      NEW.model,
      NEW.trim,
      NEW.body_style
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_populate_vehicle_specs ON vehicles;
CREATE TRIGGER trg_auto_populate_vehicle_specs
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_populate_specs();

-- 6. Enable RLS
ALTER TABLE oem_vehicle_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oem_specs_read" ON oem_vehicle_specs
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "oem_specs_write" ON oem_vehicle_specs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Add helpful views
CREATE OR REPLACE VIEW vehicle_spec_coverage AS
SELECT 
  make,
  model,
  COUNT(*) as variant_count,
  MIN(year_start) as earliest_year,
  MAX(COALESCE(year_end, 2025)) as latest_year,
  array_agg(DISTINCT trim_level) as trims,
  array_agg(DISTINCT body_style) as body_styles
FROM oem_vehicle_specs
GROUP BY make, model
ORDER BY make, model;

COMMENT ON TABLE oem_vehicle_specs IS 'Factory OEM specifications database for auto-populating vehicle data';
COMMENT ON FUNCTION auto_populate_vehicle_specs IS 'Auto-populates vehicle specs from OEM database based on year/make/model/trim';
COMMENT ON TRIGGER trg_auto_populate_vehicle_specs ON vehicles IS 'Automatically populates factory specs when new vehicle is created';

