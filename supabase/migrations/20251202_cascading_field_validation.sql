-- ============================================
-- CASCADING FIELD VALIDATION SYSTEM
-- ============================================
-- Hierarchical constraints: Make → Model → Drivetrain → Options
-- Each level constrains valid options at the next level

-- ============================================
-- 1. MODEL-DRIVETRAIN RULES
-- ============================================
-- For Chevrolet/GMC trucks, the model prefix (C/K) is determined by drivetrain:
-- C-series = 2WD (Conventional)
-- K-series = 4WD (4x4)

CREATE TABLE IF NOT EXISTS model_drivetrain_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Applicability
  make TEXT NOT NULL,
  model_pattern TEXT NOT NULL, -- regex pattern like '^C[0-9]' or '^K[0-9]'
  
  -- Allowed drivetrains for this model pattern
  allowed_drivetrains TEXT[] NOT NULL,
  
  -- Auto-correction rules
  auto_correct BOOLEAN DEFAULT TRUE,
  correction_model_prefix TEXT, -- If drivetrain doesn't match, use this prefix
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Chevrolet/GMC C/K rules
INSERT INTO model_drivetrain_rules (make, model_pattern, allowed_drivetrains, auto_correct, correction_model_prefix, notes) VALUES
  -- C-series (2WD only)
  ('CHEVROLET', '^C[0-9]', ARRAY['2WD', 'RWD', NULL], TRUE, 'K', 'C-series must be 2WD; if 4WD detected, change to K-series'),
  ('GMC', '^C[0-9]', ARRAY['2WD', 'RWD', NULL], TRUE, 'K', 'C-series must be 2WD; if 4WD detected, change to K-series'),
  
  -- K-series (4WD only)
  ('CHEVROLET', '^K[0-9]', ARRAY['4WD', '4x4', 'AWD', NULL], TRUE, 'C', 'K-series must be 4WD; if 2WD detected, change to C-series'),
  ('GMC', '^K[0-9]', ARRAY['4WD', '4x4', 'AWD', NULL], TRUE, 'C', 'K-series must be 4WD; if 2WD detected, change to C-series'),
  
  -- Blazer (always K5 = 4WD, S-10 Blazer can be 2WD)
  ('CHEVROLET', '^K5 Blazer', ARRAY['4WD', '4x4', 'AWD', NULL], FALSE, NULL, 'K5 Blazer is always 4WD'),
  ('CHEVROLET', '^Blazer$', ARRAY['2WD', '4WD', '4x4', 'RWD', NULL], FALSE, NULL, 'S-10 Blazer can be either'),
  
  -- Suburban (can be C or K depending on drivetrain)
  ('CHEVROLET', '^Suburban', ARRAY['2WD', '4WD', '4x4', 'RWD', 'AWD', NULL], FALSE, NULL, 'Suburban available in both 2WD and 4WD')
ON CONFLICT DO NOTHING;

-- ============================================
-- 2. MODEL-YEAR RULES
-- ============================================
-- Certain models only available in certain year ranges

CREATE TABLE IF NOT EXISTS model_year_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  
  year_start INTEGER NOT NULL,
  year_end INTEGER NOT NULL,
  
  -- What to do if year is out of range
  action TEXT DEFAULT 'warn' CHECK (action IN ('warn', 'correct', 'reject')),
  suggested_model TEXT, -- Alternative model for out-of-range years
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(make, model)
);

-- Seed year rules
INSERT INTO model_year_rules (make, model, year_start, year_end, action, suggested_model, notes) VALUES
  -- Chevrolet naming conventions changed in 1988
  ('CHEVROLET', 'C10', 1960, 1987, 'correct', 'C1500', 'C10 designation ended 1987; 1988+ is C1500'),
  ('CHEVROLET', 'K10', 1960, 1987, 'correct', 'K1500', 'K10 designation ended 1987; 1988+ is K1500'),
  ('CHEVROLET', 'C20', 1960, 1987, 'correct', 'C2500', 'C20 designation ended 1987; 1988+ is C2500'),
  ('CHEVROLET', 'K20', 1960, 1987, 'correct', 'K2500', 'K20 designation ended 1987; 1988+ is K2500'),
  ('CHEVROLET', 'C30', 1960, 1987, 'correct', 'C3500', 'C30 designation ended 1987; 1988+ is C3500'),
  ('CHEVROLET', 'K30', 1960, 1987, 'correct', 'K3500', 'K30 designation ended 1987; 1988+ is K3500'),
  
  ('CHEVROLET', 'C1500', 1988, 1998, 'correct', 'Silverado 1500', 'C1500 designation ended 1998; 1999+ is Silverado'),
  ('CHEVROLET', 'K1500', 1988, 1998, 'correct', 'Silverado 1500', 'K1500 designation ended 1998; 1999+ is Silverado'),
  
  ('CHEVROLET', 'K5 Blazer', 1969, 1994, 'warn', 'Tahoe', 'K5 Blazer ended 1994; 1995+ is Tahoe'),
  ('CHEVROLET', 'Silverado', 1999, 2099, 'warn', 'C1500', 'Silverado started 1999'),
  
  -- GMC
  ('GMC', 'C1500', 1988, 1998, 'correct', 'Sierra 1500', 'C1500 ended 1998; 1999+ is Sierra'),
  ('GMC', 'K1500', 1988, 1998, 'correct', 'Sierra 1500', 'K1500 ended 1998; 1999+ is Sierra'),
  ('GMC', 'Jimmy', 1970, 1991, 'warn', NULL, 'Full-size Jimmy ended 1991 (S-15 Jimmy continued)'),
  ('GMC', 'Sierra', 1999, 2099, 'warn', NULL, 'Sierra name started 1999')
ON CONFLICT (make, model) DO NOTHING;

-- ============================================
-- 3. FIELD DEPENDENCY RULES
-- ============================================
-- Generic rules for field dependencies

CREATE TABLE IF NOT EXISTS field_dependency_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  rule_name TEXT NOT NULL UNIQUE,
  
  -- When this condition is true
  condition_field TEXT NOT NULL,
  condition_operator TEXT NOT NULL CHECK (condition_operator IN ('=', '!=', 'IN', 'NOT IN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'BETWEEN')),
  condition_value TEXT, -- JSON-encoded for arrays
  
  -- Then this field must match
  dependent_field TEXT NOT NULL,
  dependent_operator TEXT NOT NULL,
  dependent_value TEXT,
  
  -- Or auto-correct to
  auto_correct_value TEXT,
  
  error_message TEXT NOT NULL,
  severity TEXT DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. VALIDATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION validate_vehicle_cascading(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  issues JSONB := '[]'::JSONB;
  corrections JSONB := '[]'::JSONB;
  rule RECORD;
  new_model TEXT;
BEGIN
  -- Get vehicle
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF v IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;
  
  -- Check model-drivetrain rules
  FOR rule IN 
    SELECT * FROM model_drivetrain_rules 
    WHERE make = v.make AND v.model ~ model_pattern
  LOOP
    -- Check if drivetrain is allowed
    IF v.drivetrain IS NOT NULL AND NOT (v.drivetrain = ANY(rule.allowed_drivetrains)) THEN
      issues := issues || jsonb_build_object(
        'type', 'model_drivetrain_mismatch',
        'field', 'model',
        'current_model', v.model,
        'current_drivetrain', v.drivetrain,
        'allowed_drivetrains', rule.allowed_drivetrains,
        'message', rule.notes
      );
      
      -- Auto-correct if enabled
      IF rule.auto_correct AND rule.correction_model_prefix IS NOT NULL THEN
        -- Replace first character with correction prefix
        new_model := rule.correction_model_prefix || substring(v.model from 2);
        corrections := corrections || jsonb_build_object(
          'field', 'model',
          'from', v.model,
          'to', new_model,
          'reason', 'Drivetrain ' || v.drivetrain || ' requires ' || rule.correction_model_prefix || '-series'
        );
      END IF;
    END IF;
  END LOOP;
  
  -- Check model-year rules
  FOR rule IN
    SELECT * FROM model_year_rules
    WHERE make = v.make AND model = v.model
  LOOP
    IF v.year IS NOT NULL AND (v.year < rule.year_start OR v.year > rule.year_end) THEN
      issues := issues || jsonb_build_object(
        'type', 'model_year_mismatch',
        'field', 'model',
        'current_model', v.model,
        'current_year', v.year,
        'valid_years', rule.year_start || '-' || rule.year_end,
        'suggested_model', rule.suggested_model,
        'message', rule.notes
      );
      
      IF rule.action = 'correct' AND rule.suggested_model IS NOT NULL THEN
        corrections := corrections || jsonb_build_object(
          'field', 'model',
          'from', v.model,
          'to', rule.suggested_model,
          'reason', 'Year ' || v.year || ' is outside valid range for ' || v.model
        );
      END IF;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'make', v.make,
    'model', v.model,
    'year', v.year,
    'drivetrain', v.drivetrain,
    'issues', issues,
    'corrections', corrections,
    'is_valid', jsonb_array_length(issues) = 0
  );
END;
$$;

-- ============================================
-- 5. AUTO-CORRECT FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION auto_correct_vehicle_cascading(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  validation JSONB;
  correction JSONB;
  corrections_applied INTEGER := 0;
BEGIN
  -- Get validation result
  validation := validate_vehicle_cascading(p_vehicle_id);
  
  -- Apply corrections
  FOR correction IN SELECT * FROM jsonb_array_elements(validation->'corrections')
  LOOP
    IF correction->>'field' = 'model' THEN
      UPDATE vehicles SET model = correction->>'to' WHERE id = p_vehicle_id;
      corrections_applied := corrections_applied + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'corrections_applied', corrections_applied,
    'corrections', validation->'corrections'
  );
END;
$$;

-- ============================================
-- 6. BATCH VALIDATION VIEW
-- ============================================

CREATE OR REPLACE VIEW vehicles_needing_cascading_correction AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.drivetrain,
  validate_vehicle_cascading(v.id) as validation
FROM vehicles v
WHERE 
  -- Only check vehicles that might have issues
  (v.make IN ('CHEVROLET', 'GMC') AND v.model ~ '^[CK][0-9]')
  OR (v.make IN ('CHEVROLET', 'GMC') AND v.model IN ('Blazer', 'K5 Blazer', 'Suburban', 'Jimmy'));

-- ============================================
-- 7. TRIGGER FOR ONGOING VALIDATION
-- ============================================

CREATE OR REPLACE FUNCTION trigger_validate_cascading()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  validation JSONB;
  correction JSONB;
BEGIN
  -- Only check if relevant fields changed
  IF TG_OP = 'UPDATE' AND 
     OLD.make = NEW.make AND 
     OLD.model = NEW.model AND 
     OLD.year = NEW.year AND 
     OLD.drivetrain = NEW.drivetrain THEN
    RETURN NEW;
  END IF;
  
  -- Validate and auto-correct
  validation := validate_vehicle_cascading(NEW.id);
  
  -- Apply corrections inline
  FOR correction IN SELECT * FROM jsonb_array_elements(validation->'corrections')
  LOOP
    IF correction->>'field' = 'model' THEN
      NEW.model := correction->>'to';
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Note: Don't create the trigger yet - let's test the functions first
-- CREATE TRIGGER trg_validate_cascading
--   BEFORE INSERT OR UPDATE ON vehicles
--   FOR EACH ROW
--   EXECUTE FUNCTION trigger_validate_cascading();

-- ============================================
-- 8. RLS
-- ============================================

ALTER TABLE model_drivetrain_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_year_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_dependency_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view rules" ON model_drivetrain_rules FOR SELECT USING (true);
CREATE POLICY "Anyone can view year rules" ON model_year_rules FOR SELECT USING (true);
CREATE POLICY "Anyone can view dependency rules" ON field_dependency_rules FOR SELECT USING (true);

COMMENT ON TABLE model_drivetrain_rules IS 'Rules linking model naming to drivetrain (C=2WD, K=4WD for Chevy/GMC trucks)';
COMMENT ON TABLE model_year_rules IS 'Valid year ranges for specific models (C10 = 1960-1987, C1500 = 1988-1998)';
COMMENT ON FUNCTION validate_vehicle_cascading IS 'Validates vehicle against cascading field rules, returns issues and suggested corrections';
COMMENT ON FUNCTION auto_correct_vehicle_cascading IS 'Automatically applies cascading corrections to a vehicle';

