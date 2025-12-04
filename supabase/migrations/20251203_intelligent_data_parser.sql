-- ============================================
-- INTELLIGENT DATA STRUCTURING SYSTEM
-- ============================================
-- Parse unstructured model names into proper fields:
-- model, trim, series, drivetrain, engine, transmission

-- ============================================
-- 1. PARSING RULES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS data_parsing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  make TEXT NOT NULL,
  
  -- What to extract
  component_type TEXT NOT NULL CHECK (component_type IN ('model', 'trim', 'series', 'drivetrain', 'engine', 'transmission', 'body_style')),
  
  -- Pattern to match
  pattern TEXT NOT NULL, -- Regex pattern
  
  -- Extraction logic
  extract_group INTEGER DEFAULT 1, -- Which regex group to extract
  replacement_value TEXT, -- If matched, set to this value (for normalization)
  
  -- Priority (lower = higher priority)
  priority INTEGER DEFAULT 100,
  
  -- Examples
  example_input TEXT,
  example_output TEXT,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Chevrolet/GMC truck parsing rules
INSERT INTO data_parsing_rules (make, component_type, pattern, extract_group, replacement_value, priority, example_input, example_output) VALUES
  -- TRIM LEVELS (Chevrolet/GMC)
  ('CHEVROLET', 'trim', '\s+(Silverado|Scottsdale|Cheyenne|Custom Deluxe|Big 10|CST)\b', 1, NULL, 10, 'K10 Silverado', 'Silverado'),
  ('GMC', 'trim', '\s+(Sierra Classic|Sierra|SLE|SLS|SLT|Denali)\b', 1, NULL, 10, 'Jimmy Sierra Classic', 'Sierra Classic'),
  
  -- SERIES (V1500, C1500, etc.)
  ('CHEVROLET', 'series', '\s+(V1500|V2500|C1500|K1500|C2500|K2500)\b', 1, NULL, 20, 'Blazer V1500', 'V1500'),
  ('GMC', 'series', '\s+(V1500|V2500|C1500|K1500|C2500|K2500)\b', 1, NULL, 20, 'Suburban V1500', 'V1500'),
  
  -- DRIVETRAIN
  ('CHEVROLET', 'drivetrain', '\s+([24]×[24]|[24]x[24]|4WD|2WD|AWD|RWD|FWD)\b', 1, NULL, 30, 'C10 4×4', '4×4'),
  ('GMC', 'drivetrain', '\s+([24]×[24]|[24]x[24]|4WD|2WD|AWD|RWD|FWD)\b', 1, NULL, 30, 'Jimmy 4×4', '4×4'),
  
  -- TRANSMISSION
  ('CHEVROLET', 'transmission', '\s+(\d+)-Speed\b', 1, NULL, 40, 'Corvette 4-Speed', '4-Speed'),
  ('GMC', 'transmission', '\s+(\d+)-Speed\b', 1, NULL, 40, 'Jimmy 4-Speed', '4-Speed'),
  
  -- ENGINE (L72, 427, etc.)
  ('CHEVROLET', 'engine', '\s+(L\d{2}|LS\d|LT\d)\b', 1, NULL, 50, 'Corvette L72', 'L72'),
  ('CHEVROLET', 'engine', '\s+(\d{3})/(\d{3})\b', 1, NULL, 51, 'Corvette 427/425', '427/425'),
  ('GMC', 'engine', '\s+(L\d{2}|LS\d|LT\d)\b', 1, NULL, 50, 'Jimmy LS3', 'LS3'),
  
  -- BODY STYLE
  ('CHEVROLET', 'body_style', '\s+(Coupe|Convertible|Sedan|Wagon|Hatchback|Roadster)\b', 1, NULL, 60, 'Corvette Coupe', 'Coupe'),
  ('GMC', 'body_style', '\s+(Crew Cab|Extended Cab|Regular Cab|Woody)\b', 1, NULL, 60, 'Jimmy Woody', 'Woody')
ON CONFLICT DO NOTHING;

-- ============================================
-- 2. INTELLIGENT PARSER FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION parse_vehicle_model_string(
  p_make TEXT,
  p_model_string TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_model TEXT := p_model_string;
  v_trim TEXT := NULL;
  v_series TEXT := NULL;
  v_drivetrain TEXT := NULL;
  v_transmission TEXT := NULL;
  v_engine TEXT := NULL;
  v_body_style TEXT := NULL;
  v_rule RECORD;
  v_match TEXT[];
BEGIN
  -- Normalize make
  p_make := UPPER(COALESCE(p_make, ''));
  
  -- Process rules in priority order
  FOR v_rule IN 
    SELECT * FROM data_parsing_rules 
    WHERE make = p_make AND is_active = TRUE
    ORDER BY priority, id
  LOOP
    -- Try to match pattern
    v_match := regexp_match(p_model_string, v_rule.pattern, 'i');
    
    IF v_match IS NOT NULL THEN
      -- Extract the matched component
      CASE v_rule.component_type
        WHEN 'trim' THEN 
          v_trim := COALESCE(v_trim, v_match[v_rule.extract_group]);
          -- Remove from model string
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
        WHEN 'series' THEN 
          v_series := COALESCE(v_series, v_match[v_rule.extract_group]);
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
        WHEN 'drivetrain' THEN 
          v_drivetrain := COALESCE(v_drivetrain, v_match[v_rule.extract_group]);
          -- Normalize: 4×4 → 4WD, 2×4 → 2WD
          v_drivetrain := CASE
            WHEN v_drivetrain ~ '[4]×[4]|4x4|4WD' THEN '4WD'
            WHEN v_drivetrain ~ '[2]×[24]|2x[24]|2WD' THEN '2WD'
            ELSE v_drivetrain
          END;
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
        WHEN 'transmission' THEN 
          v_transmission := COALESCE(v_transmission, v_match[v_rule.extract_group] || '-Speed');
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
        WHEN 'engine' THEN 
          v_engine := COALESCE(v_engine, v_match[v_rule.extract_group]);
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
        WHEN 'body_style' THEN 
          v_body_style := COALESCE(v_body_style, v_match[v_rule.extract_group]);
          v_model := regexp_replace(v_model, v_rule.pattern, '', 'i');
      END CASE;
    END IF;
  END LOOP;
  
  -- Clean up model (remove extra spaces)
  v_model := regexp_replace(TRIM(v_model), '\s+', ' ', 'g');
  
  RETURN jsonb_build_object(
    'model', v_model,
    'trim', v_trim,
    'series', v_series,
    'drivetrain', v_drivetrain,
    'transmission', v_transmission,
    'engine', v_engine,
    'body_style', v_body_style,
    'original_input', p_model_string
  );
END;
$$;

-- ============================================
-- 3. BATCH PARSER
-- ============================================

CREATE OR REPLACE FUNCTION parse_and_structure_all_vehicles()
RETURNS TABLE (
  vehicle_id UUID,
  old_model TEXT,
  new_model TEXT,
  extracted_trim TEXT,
  extracted_series TEXT,
  extracted_drivetrain TEXT,
  fields_populated INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  parsed JSONB;
  fields_set INTEGER;
BEGIN
  FOR v IN 
    SELECT id, make, model, trim, series, drivetrain, transmission, engine_type, body_style
    FROM vehicles
    WHERE make IS NOT NULL AND model IS NOT NULL
  LOOP
    -- Parse the model string
    parsed := parse_vehicle_model_string(v.make, v.model);
    fields_set := 0;
    
    -- Update vehicle with extracted components
    IF (parsed->>'trim') IS NOT NULL AND v.trim IS NULL THEN
      UPDATE vehicles SET trim = (parsed->>'trim') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    IF (parsed->>'series') IS NOT NULL AND v.series IS NULL THEN
      UPDATE vehicles SET series = (parsed->>'series') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    IF (parsed->>'drivetrain') IS NOT NULL AND v.drivetrain IS NULL THEN
      UPDATE vehicles SET drivetrain = (parsed->>'drivetrain') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    IF (parsed->>'transmission') IS NOT NULL AND v.transmission IS NULL THEN
      UPDATE vehicles SET transmission = (parsed->>'transmission') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    IF (parsed->>'body_style') IS NOT NULL AND v.body_style IS NULL THEN
      UPDATE vehicles SET body_style = (parsed->>'body_style') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    -- Update model to cleaned version
    IF (parsed->>'model') != v.model THEN
      UPDATE vehicles SET model = (parsed->>'model') WHERE id = v.id;
      fields_set := fields_set + 1;
    END IF;
    
    -- Return results for this vehicle
    IF fields_set > 0 THEN
      RETURN QUERY SELECT 
        v.id,
        v.model,
        (parsed->>'model')::TEXT,
        (parsed->>'trim')::TEXT,
        (parsed->>'series')::TEXT,
        (parsed->>'drivetrain')::TEXT,
        fields_set;
    END IF;
  END LOOP;
END;
$$;

-- ============================================
-- 4. TEST THE PARSER
-- ============================================

-- Test examples
SELECT parse_vehicle_model_string('CHEVROLET', 'K5 Blazer Silverado V1500 4×4');
SELECT parse_vehicle_model_string('CHEVROLET', 'Corvette Coupe L72 427/425 4-Speed');
SELECT parse_vehicle_model_string('GMC', 'Jimmy Sierra Classic 4×4 4-Speed');

COMMENT ON TABLE data_parsing_rules IS 'Rules for parsing unstructured model strings into structured components';
COMMENT ON FUNCTION parse_vehicle_model_string IS 'Intelligently parses model string into model, trim, series, drivetrain, transmission, engine';
COMMENT ON FUNCTION parse_and_structure_all_vehicles IS 'Batch processes all vehicles to extract and organize data into proper fields';

