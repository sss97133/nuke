-- ============================================
-- VEHICLE NOMENCLATURE STANDARDIZATION SYSTEM
-- ============================================
-- Factory-correct naming for makes, models, trims
-- Price validation and mileage sanity checks

-- ============================================
-- 1. CANONICAL MAKE NAMES
-- ============================================
CREATE TABLE IF NOT EXISTS canonical_makes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Canonical (factory-correct) name
  canonical_name TEXT NOT NULL UNIQUE,
  
  -- Display variations
  display_name TEXT NOT NULL, -- "Chevrolet"
  short_name TEXT, -- "Chevy"
  
  -- All known aliases (for matching)
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['chevrolet', 'chevy', 'chev', 'CHEVROLET']
  
  -- Metadata
  country_of_origin TEXT,
  founded_year INTEGER,
  parent_company TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common makes
INSERT INTO canonical_makes (canonical_name, display_name, short_name, aliases, country_of_origin) VALUES
  ('CHEVROLET', 'Chevrolet', 'Chevy', ARRAY['chevrolet', 'chevy', 'chev', 'CHEVROLET', 'CHEVY', 'CHEV', 'Chev', 'Chevy'], 'USA'),
  ('GMC', 'GMC', 'GMC', ARRAY['gmc', 'GMC', 'Gmc', 'G.M.C.'], 'USA'),
  ('FORD', 'Ford', 'Ford', ARRAY['ford', 'FORD', 'Ford'], 'USA'),
  ('DODGE', 'Dodge', 'Dodge', ARRAY['dodge', 'DODGE', 'Dodge'], 'USA'),
  ('JEEP', 'Jeep', 'Jeep', ARRAY['jeep', 'JEEP', 'Jeep'], 'USA'),
  ('TOYOTA', 'Toyota', 'Toyota', ARRAY['toyota', 'TOYOTA', 'Toyota'], 'Japan'),
  ('HONDA', 'Honda', 'Honda', ARRAY['honda', 'HONDA', 'Honda'], 'Japan'),
  ('NISSAN', 'Nissan', 'Nissan', ARRAY['nissan', 'NISSAN', 'Nissan', 'datsun', 'Datsun', 'DATSUN'], 'Japan'),
  ('BMW', 'BMW', 'BMW', ARRAY['bmw', 'BMW', 'Bmw'], 'Germany'),
  ('MERCEDES-BENZ', 'Mercedes-Benz', 'Mercedes', ARRAY['mercedes-benz', 'mercedes', 'MERCEDES-BENZ', 'MERCEDES', 'Mercedes-Benz', 'Mercedes', 'MB'], 'Germany'),
  ('PORSCHE', 'Porsche', 'Porsche', ARRAY['porsche', 'PORSCHE', 'Porsche'], 'Germany'),
  ('VOLKSWAGEN', 'Volkswagen', 'VW', ARRAY['volkswagen', 'VOLKSWAGEN', 'Volkswagen', 'vw', 'VW', 'Vw'], 'Germany'),
  ('JAGUAR', 'Jaguar', 'Jag', ARRAY['jaguar', 'JAGUAR', 'Jaguar', 'jag'], 'UK'),
  ('LAND ROVER', 'Land Rover', 'Land Rover', ARRAY['land rover', 'LAND ROVER', 'Land Rover', 'landrover'], 'UK'),
  ('SUBARU', 'Subaru', 'Subaru', ARRAY['subaru', 'SUBARU', 'Subaru'], 'Japan'),
  ('PLYMOUTH', 'Plymouth', 'Plymouth', ARRAY['plymouth', 'PLYMOUTH', 'Plymouth'], 'USA'),
  ('PONTIAC', 'Pontiac', 'Pontiac', ARRAY['pontiac', 'PONTIAC', 'Pontiac'], 'USA'),
  ('OLDSMOBILE', 'Oldsmobile', 'Olds', ARRAY['oldsmobile', 'OLDSMOBILE', 'Oldsmobile', 'olds'], 'USA'),
  ('BUICK', 'Buick', 'Buick', ARRAY['buick', 'BUICK', 'Buick'], 'USA'),
  ('CADILLAC', 'Cadillac', 'Caddy', ARRAY['cadillac', 'CADILLAC', 'Cadillac', 'caddy'], 'USA'),
  ('CHRYSLER', 'Chrysler', 'Chrysler', ARRAY['chrysler', 'CHRYSLER', 'Chrysler'], 'USA'),
  ('INTERNATIONAL', 'International', 'IH', ARRAY['international', 'INTERNATIONAL', 'International', 'international harvester', 'IH'], 'USA')
ON CONFLICT (canonical_name) DO NOTHING;

-- ============================================
-- 2. CANONICAL MODEL NAMES (Chevrolet/GMC Trucks Focus)
-- ============================================
CREATE TABLE IF NOT EXISTS canonical_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to make
  make_canonical TEXT NOT NULL,
  
  -- Canonical model info
  canonical_name TEXT NOT NULL, -- "C10" (factory designation)
  display_name TEXT NOT NULL, -- "C/K 10" or "C10"
  
  -- Model details
  year_start INTEGER,
  year_end INTEGER,
  body_styles TEXT[], -- ['pickup', 'suburban', 'panel']
  
  -- Aliases for matching
  aliases TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- What this model should NOT be confused with
  disambiguation_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(make_canonical, canonical_name)
);

-- Seed Chevrolet/GMC truck models (1960-1998 focus)
INSERT INTO canonical_models (make_canonical, canonical_name, display_name, year_start, year_end, body_styles, aliases) VALUES
  -- C/K Series (1960-1998)
  ('CHEVROLET', 'C10', 'C10', 1960, 1987, ARRAY['pickup', 'short bed', 'long bed'], 
    ARRAY['c10', 'C-10', 'c-10', 'C 10', 'c 10', 'c/k 10', 'C/K 10', 'ck10', 'CK10']),
  ('CHEVROLET', 'C20', 'C20', 1960, 1987, ARRAY['pickup'], 
    ARRAY['c20', 'C-20', 'c-20', 'C 20', 'c 20', 'c/k 20', 'C/K 20']),
  ('CHEVROLET', 'C30', 'C30', 1960, 1987, ARRAY['pickup', 'dually'], 
    ARRAY['c30', 'C-30', 'c-30', 'C 30', 'c 30', 'c/k 30', 'C/K 30']),
  ('CHEVROLET', 'K10', 'K10', 1960, 1987, ARRAY['pickup', '4x4'], 
    ARRAY['k10', 'K-10', 'k-10', 'K 10', 'k 10', 'c/k 10 4x4']),
  ('CHEVROLET', 'K20', 'K20', 1960, 1987, ARRAY['pickup', '4x4'], 
    ARRAY['k20', 'K-20', 'k-20', 'K 20', 'k 20']),
  ('CHEVROLET', 'K30', 'K30', 1960, 1987, ARRAY['pickup', '4x4', 'dually'], 
    ARRAY['k30', 'K-30', 'k-30', 'K 30', 'k 30']),
  
  -- 1988+ naming (C1500, K1500, etc.)
  ('CHEVROLET', 'C1500', 'C1500', 1988, 1998, ARRAY['pickup'], 
    ARRAY['c1500', 'C-1500', '1500', 'c/k 1500']),
  ('CHEVROLET', 'K1500', 'K1500', 1988, 1998, ARRAY['pickup', '4x4'], 
    ARRAY['k1500', 'K-1500']),
  ('CHEVROLET', 'C2500', 'C2500', 1988, 1998, ARRAY['pickup'], 
    ARRAY['c2500', 'C-2500', '2500']),
  ('CHEVROLET', 'K2500', 'K2500', 1988, 1998, ARRAY['pickup', '4x4'], 
    ARRAY['k2500', 'K-2500']),
  ('CHEVROLET', 'C3500', 'C3500', 1988, 1998, ARRAY['pickup', 'dually'], 
    ARRAY['c3500', 'C-3500', '3500']),
  ('CHEVROLET', 'K3500', 'K3500', 1988, 1998, ARRAY['pickup', '4x4', 'dually'], 
    ARRAY['k3500', 'K-3500']),
    
  -- Special models
  ('CHEVROLET', 'K5 Blazer', 'K5 Blazer', 1969, 1991, ARRAY['suv', '4x4'], 
    ARRAY['k5 blazer', 'K5', 'k5', 'blazer k5', 'full size blazer']),
  ('CHEVROLET', 'Blazer', 'Blazer', 1969, 1994, ARRAY['suv'], 
    ARRAY['blazer', 'BLAZER']),
  ('CHEVROLET', 'Suburban', 'Suburban', 1935, 2024, ARRAY['suv'], 
    ARRAY['suburban', 'SUBURBAN', 'burb', 'burban']),
  ('CHEVROLET', 'S-10', 'S-10', 1982, 2004, ARRAY['compact pickup'], 
    ARRAY['s-10', 's10', 'S10', 'S 10']),
  ('CHEVROLET', 'Silverado', 'Silverado', 1999, 2024, ARRAY['pickup'], 
    ARRAY['silverado', 'SILVERADO']),
    
  -- Passenger cars
  ('CHEVROLET', 'Corvette', 'Corvette', 1953, 2024, ARRAY['sports car'], 
    ARRAY['corvette', 'CORVETTE', 'vette', 'Vette']),
  ('CHEVROLET', 'Camaro', 'Camaro', 1967, 2024, ARRAY['pony car', 'muscle car'], 
    ARRAY['camaro', 'CAMARO']),
  ('CHEVROLET', 'Impala', 'Impala', 1958, 2020, ARRAY['full size'], 
    ARRAY['impala', 'IMPALA']),
  ('CHEVROLET', 'Nova', 'Nova', 1962, 1988, ARRAY['compact'], 
    ARRAY['nova', 'NOVA', 'chevy ii', 'Chevy II']),
  ('CHEVROLET', 'Chevelle', 'Chevelle', 1964, 1977, ARRAY['muscle car', 'mid-size'], 
    ARRAY['chevelle', 'CHEVELLE']),
  ('CHEVROLET', 'El Camino', 'El Camino', 1959, 1987, ARRAY['car-truck'], 
    ARRAY['el camino', 'EL CAMINO', 'elcamino']),
    
  -- GMC equivalents
  ('GMC', 'C1500', 'C1500', 1960, 1998, ARRAY['pickup'], 
    ARRAY['c1500', 'C-1500', 'c15', 'C15']),
  ('GMC', 'K1500', 'K1500', 1960, 1998, ARRAY['pickup', '4x4'], 
    ARRAY['k1500', 'K-1500', 'k15', 'K15']),
  ('GMC', 'Jimmy', 'Jimmy', 1970, 2001, ARRAY['suv'], 
    ARRAY['jimmy', 'JIMMY']),
  ('GMC', 'Sierra', 'Sierra', 1999, 2024, ARRAY['pickup'], 
    ARRAY['sierra', 'SIERRA']),
  ('GMC', 'Suburban', 'Suburban', 1967, 1999, ARRAY['suv'], 
    ARRAY['suburban', 'SUBURBAN'])
ON CONFLICT (make_canonical, canonical_name) DO NOTHING;

-- ============================================
-- 3. DATA VALIDATION RULES
-- ============================================
CREATE TABLE IF NOT EXISTS data_validation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  rule_name TEXT NOT NULL UNIQUE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('price', 'mileage', 'year', 'make', 'model', 'vin')),
  
  -- Validation parameters
  min_value NUMERIC,
  max_value NUMERIC,
  pattern TEXT, -- Regex pattern
  
  -- Rule logic
  error_level TEXT DEFAULT 'warning' CHECK (error_level IN ('info', 'warning', 'error', 'critical')),
  error_message TEXT NOT NULL,
  auto_fix_action TEXT, -- 'nullify', 'flag', 'correct'
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed validation rules
INSERT INTO data_validation_rules (rule_name, rule_type, min_value, max_value, pattern, error_level, error_message, auto_fix_action) VALUES
  -- Price rules
  ('price_too_low', 'price', NULL, 500, NULL, 'error', 'Price below $500 is suspicious for a vehicle', 'flag'),
  ('price_too_high', 'price', 5000000, NULL, NULL, 'warning', 'Price over $5M needs verification', 'flag'),
  ('price_is_view_count', 'price', 100000, 999999, NULL, 'error', 'Price looks like view count from auction site', 'nullify'),
  
  -- Mileage rules  
  ('mileage_too_high', 'mileage', 500000, NULL, NULL, 'error', 'Mileage over 500K is suspicious', 'flag'),
  ('mileage_is_auction_stat', 'mileage', 600000, NULL, NULL, 'critical', 'Mileage appears to be auction bid/view count', 'nullify'),
  ('mileage_negative', 'mileage', NULL, 0, NULL, 'error', 'Mileage cannot be negative', 'nullify'),
  
  -- Year rules
  ('year_future', 'year', 2026, NULL, NULL, 'error', 'Year cannot be in the future', 'flag'),
  ('year_too_old', 'year', NULL, 1885, NULL, 'warning', 'Year before automobiles were invented', 'flag'),
  
  -- Make rules (patterns that indicate parsing errors)
  ('make_is_descriptor', 'make', NULL, NULL, '^(Classic|Featured|Unknown|Fuel-Injected|.*-Powered|.*-Owned|Half-Scale|Gray|Exotic)$', 'critical', 'Make appears to be a descriptor, not actual make', 'flag'),
  
  -- Model rules
  ('model_contains_location', 'model', NULL, NULL, '(Fort Worth|Commerce Twp|Lithia Springs|Minneapolis|Jackson|Grand Rapids|Milford|Gladstone|Plymouth|O''Fallon)', 'error', 'Model contains location - needs cleanup', 'flag'),
  ('model_is_generic', 'model', NULL, NULL, '^(Truck|Vehicle|Car|Auto)$', 'warning', 'Model is too generic, needs specific model', 'flag'),
  
  -- VIN rules
  ('vin_invalid_length', 'vin', NULL, NULL, '^.{1,7}$|^.{18,}$', 'error', 'VIN length invalid (should be 8-17 chars)', 'flag'),
  ('vin_invalid_chars', 'vin', NULL, NULL, '[IOQ]', 'error', 'VIN contains invalid characters (I, O, Q)', 'flag')
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================
-- 4. VALIDATION RESULTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_validation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES data_validation_rules(id) ON DELETE CASCADE,
  
  -- Issue details
  field_name TEXT NOT NULL,
  current_value TEXT,
  error_level TEXT NOT NULL,
  error_message TEXT NOT NULL,
  
  -- Resolution
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'auto_fixed', 'manually_fixed', 'ignored', 'wont_fix')),
  fixed_value TEXT,
  fixed_by UUID,
  fixed_at TIMESTAMPTZ,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, rule_id, field_name)
);

CREATE INDEX idx_validation_issues_vehicle ON vehicle_validation_issues(vehicle_id);
CREATE INDEX idx_validation_issues_status ON vehicle_validation_issues(status) WHERE status = 'open';
CREATE INDEX idx_validation_issues_level ON vehicle_validation_issues(error_level);

-- ============================================
-- 5. NORMALIZATION FUNCTIONS
-- ============================================

-- Function: Normalize make name to canonical form
CREATE OR REPLACE FUNCTION normalize_make(input_make TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_canonical TEXT;
BEGIN
  -- Look up canonical name by checking aliases
  SELECT canonical_name INTO v_canonical
  FROM canonical_makes
  WHERE input_make = ANY(aliases)
     OR LOWER(input_make) = LOWER(canonical_name)
  LIMIT 1;
  
  -- Return canonical if found, otherwise return input with proper case
  IF v_canonical IS NOT NULL THEN
    RETURN v_canonical;
  ELSE
    RETURN INITCAP(input_make);
  END IF;
END;
$$;

-- Function: Normalize model name
CREATE OR REPLACE FUNCTION normalize_model(input_make TEXT, input_model TEXT, input_year INTEGER DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_canonical TEXT;
  v_make_canonical TEXT;
  v_cleaned_model TEXT;
BEGIN
  -- First normalize the make
  v_make_canonical := normalize_make(input_make);
  
  -- Clean the model - remove locations
  v_cleaned_model := regexp_replace(input_model, '\s+(in\s+)?[A-Z][a-z]+,?\s*[A-Z]{0,2}\s*$', '', 'gi');
  v_cleaned_model := regexp_replace(v_cleaned_model, '\s+(Fort Worth|Commerce Twp|Lithia Springs|Minneapolis|Jackson|Michigan|California|Oregon|Illinois|Kansas|Georgia).*$', '', 'gi');
  v_cleaned_model := TRIM(v_cleaned_model);
  
  -- Look up canonical model
  SELECT canonical_name INTO v_canonical
  FROM canonical_models
  WHERE make_canonical = v_make_canonical
    AND (
      v_cleaned_model = ANY(aliases)
      OR LOWER(v_cleaned_model) = LOWER(canonical_name)
      OR LOWER(v_cleaned_model) LIKE '%' || LOWER(canonical_name) || '%'
    )
    AND (input_year IS NULL OR input_year BETWEEN COALESCE(year_start, 1900) AND COALESCE(year_end, 2100))
  LIMIT 1;
  
  IF v_canonical IS NOT NULL THEN
    RETURN v_canonical;
  ELSE
    RETURN v_cleaned_model;
  END IF;
END;
$$;

-- Function: Validate and flag issues for a vehicle
CREATE OR REPLACE FUNCTION validate_vehicle(p_vehicle_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle RECORD;
  v_rule RECORD;
  v_issues_found INTEGER := 0;
  v_value TEXT;
BEGIN
  -- Get vehicle data
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF v_vehicle IS NULL THEN RETURN 0; END IF;
  
  -- Check each active rule
  FOR v_rule IN SELECT * FROM data_validation_rules WHERE is_active = TRUE LOOP
    v_value := NULL;
    
    -- Get the relevant field value
    CASE v_rule.rule_type
      WHEN 'price' THEN v_value := COALESCE(v_vehicle.sale_price, v_vehicle.current_value)::TEXT;
      WHEN 'mileage' THEN v_value := v_vehicle.mileage::TEXT;
      WHEN 'year' THEN v_value := v_vehicle.year::TEXT;
      WHEN 'make' THEN v_value := v_vehicle.make;
      WHEN 'model' THEN v_value := v_vehicle.model;
      WHEN 'vin' THEN v_value := v_vehicle.vin;
    END CASE;
    
    -- Skip if no value
    IF v_value IS NULL OR v_value = '' THEN CONTINUE; END IF;
    
    -- Check min/max bounds
    IF v_rule.min_value IS NOT NULL AND v_value::NUMERIC > v_rule.min_value THEN
      -- Fails minimum check (value is ABOVE min threshold = bad)
      INSERT INTO vehicle_validation_issues (vehicle_id, rule_id, field_name, current_value, error_level, error_message)
      VALUES (p_vehicle_id, v_rule.id, v_rule.rule_type, v_value, v_rule.error_level, v_rule.error_message)
      ON CONFLICT (vehicle_id, rule_id, field_name) DO UPDATE SET current_value = v_value, status = 'open';
      v_issues_found := v_issues_found + 1;
    END IF;
    
    IF v_rule.max_value IS NOT NULL AND v_value::NUMERIC < v_rule.max_value THEN
      -- Fails maximum check (value is BELOW max threshold = bad)
      INSERT INTO vehicle_validation_issues (vehicle_id, rule_id, field_name, current_value, error_level, error_message)
      VALUES (p_vehicle_id, v_rule.id, v_rule.rule_type, v_value, v_rule.error_level, v_rule.error_message)
      ON CONFLICT (vehicle_id, rule_id, field_name) DO UPDATE SET current_value = v_value, status = 'open';
      v_issues_found := v_issues_found + 1;
    END IF;
    
    -- Check pattern match
    IF v_rule.pattern IS NOT NULL AND v_value ~ v_rule.pattern THEN
      INSERT INTO vehicle_validation_issues (vehicle_id, rule_id, field_name, current_value, error_level, error_message)
      VALUES (p_vehicle_id, v_rule.id, v_rule.rule_type, v_value, v_rule.error_level, v_rule.error_message)
      ON CONFLICT (vehicle_id, rule_id, field_name) DO UPDATE SET current_value = v_value, status = 'open';
      v_issues_found := v_issues_found + 1;
    END IF;
  END LOOP;
  
  RETURN v_issues_found;
END;
$$;

-- ============================================
-- 6. BATCH VALIDATION
-- ============================================

-- Run validation on all vehicles
CREATE OR REPLACE FUNCTION validate_all_vehicles()
RETURNS TABLE (total_vehicles INTEGER, total_issues INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_total_vehicles INTEGER := 0;
  v_total_issues INTEGER := 0;
  v_issues INTEGER;
BEGIN
  FOR v_id IN SELECT id FROM vehicles LOOP
    v_issues := validate_vehicle(v_id);
    v_total_issues := v_total_issues + v_issues;
    v_total_vehicles := v_total_vehicles + 1;
  END LOOP;
  
  RETURN QUERY SELECT v_total_vehicles, v_total_issues;
END;
$$;

-- ============================================
-- 7. VIEWS
-- ============================================

-- Open validation issues dashboard
CREATE OR REPLACE VIEW validation_issues_dashboard AS
SELECT 
  vvi.error_level,
  vvi.field_name,
  dvr.rule_name,
  COUNT(*) as issue_count,
  dvr.auto_fix_action
FROM vehicle_validation_issues vvi
JOIN data_validation_rules dvr ON dvr.id = vvi.rule_id
WHERE vvi.status = 'open'
GROUP BY vvi.error_level, vvi.field_name, dvr.rule_name, dvr.auto_fix_action
ORDER BY 
  CASE vvi.error_level 
    WHEN 'critical' THEN 1 
    WHEN 'error' THEN 2 
    WHEN 'warning' THEN 3 
    ELSE 4 
  END,
  issue_count DESC;

-- Vehicles with issues
CREATE OR REPLACE VIEW vehicles_with_issues AS
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.make as raw_make,
  normalize_make(v.make) as normalized_make,
  v.model as raw_model,
  normalize_model(v.make, v.model, v.year) as normalized_model,
  COUNT(vvi.id) as issue_count,
  ARRAY_AGG(DISTINCT vvi.error_level) as error_levels
FROM vehicles v
LEFT JOIN vehicle_validation_issues vvi ON vvi.vehicle_id = v.id AND vvi.status = 'open'
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(vvi.id) > 0
ORDER BY COUNT(vvi.id) DESC;

-- ============================================
-- 8. RLS
-- ============================================
ALTER TABLE canonical_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_validation_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view canonical data" ON canonical_makes FOR SELECT USING (true);
CREATE POLICY "Anyone can view canonical models" ON canonical_models FOR SELECT USING (true);
CREATE POLICY "Anyone can view validation rules" ON data_validation_rules FOR SELECT USING (true);
CREATE POLICY "Anyone can view validation issues" ON vehicle_validation_issues FOR SELECT USING (true);

-- Service role can manage
CREATE POLICY "Service role manages canonical makes" ON canonical_makes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages canonical models" ON canonical_models FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages validation rules" ON data_validation_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages validation issues" ON vehicle_validation_issues FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE canonical_makes IS 'Factory-correct make names with aliases for normalization';
COMMENT ON TABLE canonical_models IS 'Factory-correct model names with year ranges and aliases';
COMMENT ON TABLE data_validation_rules IS 'Rules for validating vehicle data quality';
COMMENT ON TABLE vehicle_validation_issues IS 'Flagged data quality issues per vehicle';

