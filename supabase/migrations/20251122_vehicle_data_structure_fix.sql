-- Vehicle Data Structure Fix
-- Separates jumbled fields and enables SPID-based verification
-- Migration: 20251122_vehicle_data_structure_fix

-- Add proper field separation to vehicles table
ALTER TABLE vehicles 
  ADD COLUMN IF NOT EXISTS model_series TEXT,        -- C10, C20, K10, K20
  ADD COLUMN IF NOT EXISTS cab_config TEXT,          -- Regular Cab, Extended Cab, Crew Cab (3+3)
  ADD COLUMN IF NOT EXISTS trim_level TEXT,          -- Silverado, Cheyenne, Custom Deluxe
  
  -- Engine details (separate from bundled field)
  ADD COLUMN IF NOT EXISTS engine_displacement TEXT, -- 454, 350, 305 (cubic inches)
  ADD COLUMN IF NOT EXISTS engine_liters NUMERIC,    -- 7.4, 5.7, 5.0
  ADD COLUMN IF NOT EXISTS engine_type TEXT,         -- V8, L6, V6
  ADD COLUMN IF NOT EXISTS engine_code TEXT,         -- LS4, L31, LT1 (RPO code)
  
  -- Transmission details (separate from vague "automatic")
  ADD COLUMN IF NOT EXISTS transmission_model TEXT,  -- TH400, TH350, 4L60E, SM465
  ADD COLUMN IF NOT EXISTS transmission_type TEXT,   -- Automatic, Manual
  ADD COLUMN IF NOT EXISTS transmission_code TEXT;   -- M40, M38, M20 (RPO code)

-- Add model_code and sequence to vehicle_spid_data
ALTER TABLE vehicle_spid_data
  ADD COLUMN IF NOT EXISTS model_code TEXT,
  ADD COLUMN IF NOT EXISTS sequence_number TEXT;

-- Create RPO code lookup table
CREATE TABLE IF NOT EXISTS rpo_code_definitions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- engine, transmission, trim, drivetrain, comfort, chassis
  description TEXT,
  
  -- Decoded values for auto-fill
  engine_displacement TEXT,
  engine_liters NUMERIC,
  transmission_model TEXT,
  transmission_type TEXT,
  trim_name TEXT,
  
  -- Metadata
  years_applicable TEXT[], -- Which years this code was used
  make TEXT DEFAULT 'GM',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Populate common RPO codes
INSERT INTO rpo_code_definitions (code, name, category, description, engine_displacement, engine_liters) VALUES
  ('LS4', '454ci V8 Engine', 'engine', 'Big Block 454 cubic inch V8', '454', 7.4),
  ('L19', '454ci V8 Engine (HD)', 'engine', 'Heavy Duty 454 cubic inch V8', '454', 7.4),
  ('L31', '350ci V8 Engine', 'engine', 'Small Block 350 cubic inch V8', '350', 5.7),
  ('LT1', '350ci V8 Performance', 'engine', 'Performance 350 cubic inch V8', '350', 5.7),
  ('L05', '305ci V8 Engine', 'engine', 'Small Block 305 cubic inch V8', '305', 5.0),
  ('LL4', '292ci Inline-6', 'engine', '292 cubic inch inline 6-cylinder', '292', 4.8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rpo_code_definitions (code, name, category, description, transmission_model, transmission_type) VALUES
  ('M40', 'TH400 Automatic', 'transmission', 'Turbo-Hydramatic 400 3-Speed Automatic', 'TH400', 'Automatic'),
  ('M38', 'TH350 Automatic', 'transmission', 'Turbo-Hydramatic 350 3-Speed Automatic', 'TH350', 'Automatic'),
  ('M20', 'SM465 Manual', 'transmission', 'SM465 4-Speed Manual Heavy Duty', 'SM465', 'Manual'),
  ('M21', 'SM420 Manual', 'transmission', 'SM420 4-Speed Manual', 'SM420', 'Manual'),
  ('MT1', '4L60E Automatic', 'transmission', '4L60E 4-Speed Automatic Electronic', '4L60E', 'Automatic')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rpo_code_definitions (code, name, category, description, trim_name) VALUES
  ('Z84', 'Silverado Package', 'trim', 'Silverado trim package with upgraded interior', 'Silverado'),
  ('YE9', 'Cheyenne Package', 'trim', 'Cheyenne trim package', 'Cheyenne'),
  ('YF5', 'Custom Deluxe', 'trim', 'Custom Deluxe trim package', 'Custom Deluxe'),
  ('YE8', 'Scottsdale Package', 'trim', 'Scottsdale trim package', 'Scottsdale')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rpo_code_definitions (code, name, category, description) VALUES
  ('G80', 'Locking Rear Differential', 'drivetrain', 'Automatic locking rear differential'),
  ('KC4', 'Electric Transfer Case', 'drivetrain', 'Electric shift transfer case for 4WD'),
  ('Z62', 'Off-Road Package', 'chassis', 'Heavy duty off-road suspension package'),
  ('AU3', 'Power Door Locks', 'convenience', 'Electric power door locks'),
  ('C60', 'Air Conditioning', 'comfort', 'Factory air conditioning system'),
  ('N33', 'Tilt Steering', 'convenience', 'Tilt steering wheel'),
  ('U35', 'Electric Speedometer', 'instrumentation', 'Electronic speedometer'),
  ('ZQ3', 'Heavy Duty Cooling', 'engine', 'Heavy duty radiator and cooling system')
ON CONFLICT (code) DO NOTHING;

-- Grant access
GRANT SELECT ON rpo_code_definitions TO authenticated;
GRANT ALL ON rpo_code_definitions TO service_role;

-- Comments
COMMENT ON TABLE rpo_code_definitions IS 'GM RPO (Regular Production Option) code definitions for auto-decoding SPID data';
COMMENT ON COLUMN vehicles.model_series IS 'Body series designation (C10, C20, K10, K20, etc.)';
COMMENT ON COLUMN vehicles.cab_config IS 'Cab configuration (Regular, Extended, Crew)';
COMMENT ON COLUMN vehicles.trim_level IS 'Factory trim package (Silverado, Cheyenne, Custom)';
COMMENT ON COLUMN vehicles.engine_code IS 'RPO code for engine (LS4, L31, LT1, etc.)';
COMMENT ON COLUMN vehicles.transmission_code IS 'RPO code for transmission (M40, M38, M20, etc.)';

