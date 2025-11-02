-- OEM Reference Database
-- Factory-accurate model names, trim levels, options
-- Based on Marti Report standards and factory build sheets

-- ============================================
-- PART 1: MODEL REFERENCE (Factory Models)
-- ============================================

CREATE TABLE IF NOT EXISTS oem_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Manufacturer info
  make TEXT NOT NULL,               -- "GMC", "Chevrolet", "Ford"
  division TEXT,                    -- "GMC Truck", "Chevrolet Motor Division"
  
  -- Model identification
  model_name TEXT NOT NULL,         -- "Sierra", "Silverado", "Jimmy"
  model_family TEXT,                -- "C/K Series", "GMT400", "S-10"
  body_style TEXT,                  -- "Pickup", "SUV", "Van"
  
  -- Year availability
  year_start INTEGER NOT NULL,
  year_end INTEGER,                 -- NULL = still in production
  
  -- Platform/chassis
  platform_code TEXT,               -- "GMT400", "GMT800", "Panther"
  chassis_generation TEXT,          -- "Third Generation", "OBS"
  
  -- Factory codes
  rpm_code TEXT,                    -- Regular Production Option code
  body_code TEXT,                   -- Factory body style code
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_model_year_range UNIQUE (make, model_name, year_start, year_end)
);

CREATE INDEX IF NOT EXISTS idx_oem_models_make_year ON oem_models(make, year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_oem_models_name ON oem_models(model_name);

-- ============================================
-- PART 2: TRIM REFERENCE (Factory Trim Levels)
-- ============================================

CREATE TABLE IF NOT EXISTS oem_trim_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Association
  make TEXT NOT NULL,
  model_family TEXT,                -- "C/K Series", "S-10", "Silverado"
  
  -- Trim details
  trim_name TEXT NOT NULL,          -- "Cheyenne", "Scottsdale", "Silverado", "High Sierra"
  trim_level TEXT,                  -- "Base", "Mid", "Premium", "Luxury"
  marketing_name TEXT,              -- Marketing version of name
  
  -- Year availability
  year_start INTEGER NOT NULL,
  year_end INTEGER,
  
  -- Factory code
  trim_code TEXT,                   -- Factory trim package code
  
  -- Features included
  standard_features TEXT[],         -- Array of standard features
  optional_packages TEXT[],         -- Available option packages
  
  -- Pricing (historical)
  base_msrp_usd INTEGER,           -- Original MSRP
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_trim_year UNIQUE (make, model_family, trim_name, year_start)
);

CREATE INDEX IF NOT EXISTS idx_oem_trim_make_year ON oem_trim_levels(make, year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_oem_trim_name ON oem_trim_levels(trim_name);

-- ============================================
-- PART 3: DRIVETRAIN CODES (C/K/V/R System)
-- ============================================

CREATE TABLE IF NOT EXISTS oem_drivetrain_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Code definition
  code TEXT NOT NULL UNIQUE,        -- "C", "K", "V", "R"
  description TEXT NOT NULL,        -- "2WD", "4WD Part-time", "4WD All-wheel", "RWD"
  manufacturer TEXT NOT NULL,       -- "GM", "Ford", "Dodge"
  
  -- Technical details
  drive_wheels TEXT,                -- "Rear", "Front", "All Four"
  transfer_case_type TEXT,          -- "Part-time", "Full-time", "On-demand"
  
  -- Year usage
  used_from INTEGER,
  used_until INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivetrain_code ON oem_drivetrain_codes(code);

-- ============================================
-- PART 4: WEIGHT CLASS REFERENCE (1500/2500/3500)
-- ============================================

CREATE TABLE IF NOT EXISTS oem_weight_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Classification
  class_code TEXT NOT NULL,         -- "1500", "2500", "3500", "10", "20", "30"
  description TEXT NOT NULL,        -- "1/2 ton", "3/4 ton", "1 ton"
  manufacturer TEXT NOT NULL,
  
  -- Specifications
  gvwr_min_lbs INTEGER,            -- Gross Vehicle Weight Rating minimum
  gvwr_max_lbs INTEGER,            -- GVWR maximum
  payload_capacity_lbs INTEGER,    -- Typical payload
  towing_capacity_lbs INTEGER,     -- Typical towing
  
  -- Year usage
  used_from INTEGER,
  used_until INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_class_code ON oem_weight_classes(class_code);

-- ============================================
-- PART 5: INITIAL DATA - GM TRUCKS (1973-2000)
-- ============================================

-- Insert GM Models
INSERT INTO oem_models (make, model_name, model_family, body_style, year_start, year_end, platform_code) VALUES
  -- GMC Full-Size Trucks/SUVs
  ('GMC', 'Sierra', 'C/K Series', 'Pickup', 1988, 1998, 'GMT400'),
  ('GMC', 'Sierra', 'C/K Series', 'Pickup', 1999, 2006, 'GMT800'),
  ('GMC', 'Suburban', 'C/K Series', 'SUV', 1973, 1991, 'Squarebody'),
  ('GMC', 'Suburban', 'C/K Series', 'SUV', 1992, 1999, 'GMT400'),
  ('GMC', 'Jimmy', 'S-Series', 'SUV', 1983, 1991, 'S-10'),
  ('GMC', 'Jimmy', 'K5 Series', 'SUV', 1973, 1991, 'Squarebody'),
  ('GMC', 'Yukon', 'C/K Series', 'SUV', 1992, 1999, 'GMT400'),
  
  -- Chevrolet Full-Size Trucks/SUVs
  ('Chevrolet', 'Silverado', 'C/K Series', 'Pickup', 1999, 2006, 'GMT800'),
  ('Chevrolet', 'Cheyenne', 'C/K Series', 'Pickup', 1973, 1998, 'Various'),
  ('Chevrolet', 'Scottsdale', 'C/K Series', 'Pickup', 1975, 1980, 'Squarebody'),
  ('Chevrolet', 'Custom Deluxe', 'C/K Series', 'Pickup', 1973, 1987, 'Squarebody'),
  ('Chevrolet', 'Suburban', 'C/K Series', 'SUV', 1973, 1991, 'Squarebody'),
  ('Chevrolet', 'Suburban', 'C/K Series', 'SUV', 1992, 1999, 'GMT400'),
  ('Chevrolet', 'Blazer', 'K5 Series', 'SUV', 1973, 1991, 'Squarebody'),
  ('Chevrolet', 'Tahoe', 'C/K Series', 'SUV', 1995, 1999, 'GMT400')
ON CONFLICT (make, model_name, year_start, year_end) DO NOTHING;

-- Insert GM Trim Levels (Squarebody Era: 1973-1987)
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, year_start, year_end) VALUES
  -- Chevrolet C/K Trims
  ('Chevrolet', 'C/K Series', 'Custom', 'Base', 1973, 1980),
  ('Chevrolet', 'C/K Series', 'Custom Deluxe', 'Base', 1973, 1987),
  ('Chevrolet', 'C/K Series', 'Scottsdale', 'Mid', 1975, 1980),
  ('Chevrolet', 'C/K Series', 'Cheyenne', 'Mid', 1973, 1998),
  ('Chevrolet', 'C/K Series', 'Silverado', 'Premium', 1975, 1998),
  ('Chevrolet', 'C/K Series', 'Cheyenne Super', 'Premium', 1973, 1980),
  
  -- GMC C/K Trims (GMT400 Era: 1988-1998)
  ('GMC', 'C/K Series', 'Sierra', 'Base', 1988, 1998),
  ('GMC', 'C/K Series', 'Sierra Classic', 'Mid', 1988, 1993),
  ('GMC', 'C/K Series', 'Sierra SLE', 'Premium', 1988, 1998),
  ('GMC', 'C/K Series', 'Sierra SLT', 'Luxury', 1994, 1998),
  ('GMC', 'C/K Series', 'High Sierra', 'Premium', 1973, 1987),
  
  -- GMT800 Era (1999-2006)
  ('GMC', 'GMT800', 'Work Truck', 'Base', 1999, 2006),
  ('GMC', 'GMT800', 'SLE', 'Mid', 1999, 2006),
  ('GMC', 'GMT800', 'SLT', 'Premium', 1999, 2006),
  ('GMC', 'GMT800', 'Denali', 'Luxury', 2001, 2006),
  ('Chevrolet', 'GMT800', 'Work Truck', 'Base', 1999, 2006),
  ('Chevrolet', 'GMT800', 'LS', 'Mid', 1999, 2006),
  ('Chevrolet', 'GMT800', 'LT', 'Premium', 1999, 2006),
  ('Chevrolet', 'GMT800', 'LTZ', 'Luxury', 2005, 2006)
ON CONFLICT (make, model_family, trim_name, year_start) DO NOTHING;

-- Insert Drivetrain Codes
INSERT INTO oem_drivetrain_codes (code, description, manufacturer, drive_wheels, transfer_case_type, used_from, used_until) VALUES
  ('C', '2WD Rear-wheel drive', 'GM', 'Rear', NULL, 1960, 1999),
  ('K', '4WD Part-time', 'GM', 'All Four', 'Part-time', 1960, 1999),
  ('V', '4WD All-wheel drive', 'GM', 'All Four', 'Full-time', 1980, 1999),
  ('R', 'RWD (1500 series)', 'GM', 'Rear', NULL, 1999, NULL),
  ('F', 'FWD', 'GM', 'Front', NULL, 1980, NULL)
ON CONFLICT (code) DO NOTHING;

-- Insert Weight Classes
INSERT INTO oem_weight_classes (class_code, description, manufacturer, gvwr_min_lbs, gvwr_max_lbs, used_from, used_until) VALUES
  ('1500', '1/2 ton light duty', 'GM', 6000, 7000, 1960, NULL),
  ('2500', '3/4 ton heavy duty', 'GM', 8600, 10000, 1960, NULL),
  ('3500', '1 ton heavy duty', 'GM', 10000, 14000, 1960, NULL),
  ('10', '1/2 ton (pre-1988)', 'GM', 6000, 7000, 1960, 1987),
  ('20', '3/4 ton (pre-1988)', 'GM', 8600, 10000, 1960, 1987),
  ('30', '1 ton (pre-1988)', 'GM', 10000, 14000, 1960, 1987)
ON CONFLICT DO NOTHING;

-- ============================================
-- PART 6: HELPER FUNCTIONS
-- ============================================

-- Function: Get available models for year/make
CREATE OR REPLACE FUNCTION get_available_models(p_year INTEGER, p_make TEXT)
RETURNS TABLE (
  model_name TEXT,
  model_family TEXT,
  body_style TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    om.model_name,
    om.model_family,
    om.body_style
  FROM oem_models om
  WHERE om.make = p_make
    AND om.year_start <= p_year
    AND (om.year_end IS NULL OR om.year_end >= p_year)
  ORDER BY om.model_name;
END;
$$ LANGUAGE plpgsql;

-- Function: Get available trim levels for year/make/model
CREATE OR REPLACE FUNCTION get_available_trims(
  p_year INTEGER, 
  p_make TEXT,
  p_model_family TEXT
)
RETURNS TABLE (
  trim_name TEXT,
  trim_level TEXT,
  trim_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    otl.trim_name,
    otl.trim_level,
    otl.trim_code
  FROM oem_trim_levels otl
  WHERE otl.make = p_make
    AND (otl.model_family = p_model_family OR otl.model_family IS NULL)
    AND otl.year_start <= p_year
    AND (otl.year_end IS NULL OR otl.year_end >= p_year)
  ORDER BY 
    CASE otl.trim_level
      WHEN 'Base' THEN 1
      WHEN 'Mid' THEN 2
      WHEN 'Premium' THEN 3
      WHEN 'Luxury' THEN 4
      ELSE 5
    END,
    otl.trim_name;
END;
$$ LANGUAGE plpgsql;

-- Function: Validate vehicle nomenclature against OEM data
CREATE OR REPLACE FUNCTION validate_vehicle_nomenclature(
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_trim TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_model_valid BOOLEAN;
  v_trim_valid BOOLEAN;
  v_suggestions JSONB;
BEGIN
  -- Check if model is valid for year
  SELECT EXISTS(
    SELECT 1 FROM oem_models
    WHERE make = p_make
      AND model_name = p_model
      AND year_start <= p_year
      AND (year_end IS NULL OR year_end >= p_year)
  ) INTO v_model_valid;
  
  -- Check if trim is valid
  SELECT EXISTS(
    SELECT 1 FROM oem_trim_levels
    WHERE make = p_make
      AND trim_name = p_trim
      AND year_start <= p_year
      AND (year_end IS NULL OR year_end >= p_year)
  ) INTO v_trim_valid;
  
  -- Get suggestions if invalid
  IF NOT v_model_valid THEN
    SELECT jsonb_agg(model_name)
    INTO v_suggestions
    FROM get_available_models(p_year, p_make);
  END IF;
  
  RETURN jsonb_build_object(
    'model_valid', v_model_valid,
    'trim_valid', v_trim_valid,
    'suggested_models', v_suggestions
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE oem_models IS 'Factory model names by year - ensures users select real models, not guesses';
COMMENT ON TABLE oem_trim_levels IS 'Factory trim levels (Cheyenne, Scottsdale, Silverado, High Sierra, etc.)';
COMMENT ON TABLE oem_drivetrain_codes IS 'C/K/V/R drivetrain designation system';
COMMENT ON TABLE oem_weight_classes IS '1500/2500/3500 weight class specifications';

