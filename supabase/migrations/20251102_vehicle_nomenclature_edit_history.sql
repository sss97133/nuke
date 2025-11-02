-- Vehicle Nomenclature & Edit History System
-- Handles granular sub-model taxonomy and tracks all data corrections

-- ============================================
-- PART 1: SUB-MODEL NOMENCLATURE TAXONOMY
-- ============================================

-- Vehicle nomenclature table
-- Captures the full naming hierarchy for accurate identification
CREATE TABLE IF NOT EXISTS vehicle_nomenclature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Core identification (from vehicles table)
  year INTEGER,
  make TEXT,
  model TEXT,
  
  -- Sub-model taxonomy
  trim TEXT,                    -- e.g., "Classic", "LT", "Sport"
  series TEXT,                  -- e.g., "C/K", "GMT400", "Sierra"
  body_designation TEXT,        -- e.g., "Suburban", "Silverado", "Crew Cab"
  
  -- Drivetrain nomenclature
  drive_type TEXT,              -- "C" (2WD), "K" (4WD), "V" (4WD AWD), "R" (RWD)
  weight_class TEXT,            -- "1500" (1/2 ton), "2500" (3/4 ton), "3500" (1 ton)
  wheelbase TEXT,               -- "SWB" (short), "LWB" (long), "EWB" (extended)
  bed_length TEXT,              -- "Standard", "Long", "Short"
  cab_style TEXT,               -- "Regular", "Extended", "Crew"
  
  -- Special designations
  is_dually BOOLEAN DEFAULT FALSE,
  is_diesel BOOLEAN DEFAULT FALSE,
  is_hd BOOLEAN DEFAULT FALSE,  -- Heavy Duty
  is_special_edition BOOLEAN DEFAULT FALSE,
  special_edition_name TEXT,    -- "Cheyenne", "Silverado", "SS", "Z71"
  
  -- Market designations
  package_code TEXT,            -- Factory option packages
  interior_trim_code TEXT,
  exterior_color_code TEXT,
  paint_code TEXT,
  
  -- OEM nomenclature
  oem_model_code TEXT,          -- Factory internal model code
  oem_chassis_code TEXT,        -- Chassis designation
  
  -- Metadata
  confidence_score INTEGER DEFAULT 50, -- 0-100
  source TEXT DEFAULT 'user_input',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_vehicle_nomenclature UNIQUE (vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_nomenclature_vehicle ON vehicle_nomenclature(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_nomenclature_drive_weight ON vehicle_nomenclature(drive_type, weight_class);

-- View: Full vehicle identification string
CREATE OR REPLACE VIEW vehicle_full_name AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  vn.trim,
  vn.series,
  vn.drive_type,
  vn.weight_class,
  vn.wheelbase,
  vn.cab_style,
  vn.is_dually,
  -- Generate full name: "1987 GMC Sierra Classic V1500 SWB"
  CONCAT_WS(' ',
    v.year,
    v.make,
    vn.series,
    v.model,
    vn.trim,
    CASE WHEN vn.drive_type IS NOT NULL AND vn.weight_class IS NOT NULL 
         THEN CONCAT(vn.drive_type, vn.weight_class) 
    END,
    vn.wheelbase,
    vn.cab_style,
    CASE WHEN vn.is_dually THEN 'Dually' END
  ) as full_name,
  -- Short name: "Sierra Classic V1500"
  CONCAT_WS(' ',
    vn.series,
    v.model,
    vn.trim,
    CASE WHEN vn.drive_type IS NOT NULL AND vn.weight_class IS NOT NULL 
         THEN CONCAT(vn.drive_type, vn.weight_class) 
    END
  ) as short_name
FROM vehicles v
LEFT JOIN vehicle_nomenclature vn ON vn.vehicle_id = v.id;

-- ============================================
-- PART 2: EDIT HISTORY & CHANGE TRACKING
-- ============================================

-- Vehicle edit history - tracks ALL changes to vehicle data
CREATE TABLE IF NOT EXISTS vehicle_edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- What changed
  field_name TEXT NOT NULL,     -- e.g., "make", "model", "nomenclature.drive_type"
  old_value TEXT,               -- Previous value (as JSON if complex)
  new_value TEXT,               -- New value (as JSON if complex)
  
  -- Who & When
  edited_by UUID NOT NULL REFERENCES auth.users(id),
  edited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Why (optional)
  change_reason TEXT,           -- "VIN decoder correction", "User input", "BaT import"
  source TEXT,                  -- "inline_edit", "bat_import", "dropbox_import", "vin_decoder"
  
  -- Confidence & Verification
  confidence_before INTEGER,    -- 0-100
  confidence_after INTEGER,     -- 0-100
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,               -- Additional context
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_history_vehicle ON vehicle_edit_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_edit_history_field ON vehicle_edit_history(field_name);
CREATE INDEX IF NOT EXISTS idx_edit_history_user ON vehicle_edit_history(edited_by);
CREATE INDEX IF NOT EXISTS idx_edit_history_date ON vehicle_edit_history(edited_at DESC);

-- View: Recent edits by vehicle
CREATE OR REPLACE VIEW vehicle_recent_edits AS
SELECT 
  veh.id,
  veh.vehicle_id,
  veh.field_name,
  veh.old_value,
  veh.new_value,
  veh.edited_at,
  veh.change_reason,
  p.full_name as edited_by_name,
  p.username as edited_by_username
FROM vehicle_edit_history veh
JOIN profiles p ON p.id = veh.edited_by
ORDER BY veh.edited_at DESC;

-- Function: Log vehicle field change
CREATE OR REPLACE FUNCTION log_vehicle_edit(
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_old_value TEXT,
  p_new_value TEXT,
  p_user_id UUID,
  p_source TEXT DEFAULT 'inline_edit',
  p_change_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_edit_id UUID;
BEGIN
  INSERT INTO vehicle_edit_history (
    vehicle_id,
    field_name,
    old_value,
    new_value,
    edited_by,
    change_reason,
    source
  ) VALUES (
    p_vehicle_id,
    p_field_name,
    p_old_value,
    p_new_value,
    p_user_id,
    p_change_reason,
    p_source
  )
  RETURNING id INTO v_edit_id;
  
  RETURN v_edit_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 3: SMART FIELD PARSING
-- ============================================

-- Function: Parse GMC/Chevy truck nomenclature
-- Example: "K1500" → drive_type: "K", weight_class: "1500"
CREATE OR REPLACE FUNCTION parse_truck_designation(designation TEXT)
RETURNS TABLE (
  drive_type TEXT,
  weight_class TEXT
) AS $$
BEGIN
  -- Match patterns like: C10, K10, C1500, K2500, V3500, etc.
  RETURN QUERY
  SELECT 
    SUBSTRING(designation FROM '^([CKVR])') as drive_type,
    CASE 
      WHEN designation ~ '10$' THEN '1500'
      WHEN designation ~ '15$' THEN '1500'
      WHEN designation ~ '20$' THEN '2500'
      WHEN designation ~ '25$' THEN '2500'
      WHEN designation ~ '30$' THEN '3500'
      WHEN designation ~ '35$' THEN '3500'
      WHEN designation ~ '1500' THEN '1500'
      WHEN designation ~ '2500' THEN '2500'
      WHEN designation ~ '3500' THEN '3500'
    END as weight_class;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Auto-populate nomenclature from model name
-- e.g., "Sierra Classic V1500" → parse and fill nomenclature fields
CREATE OR REPLACE FUNCTION auto_populate_nomenclature(p_vehicle_id UUID)
RETURNS VOID AS $$
DECLARE
  v_vehicle RECORD;
  v_parsed RECORD;
BEGIN
  -- Get vehicle data
  SELECT * INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN RETURN; END IF;
  
  -- Check if nomenclature exists
  IF EXISTS (SELECT 1 FROM vehicle_nomenclature WHERE vehicle_id = p_vehicle_id) THEN
    RETURN; -- Don't overwrite existing data
  END IF;
  
  -- Parse model name for truck designation (C/K/V + weight class)
  SELECT * INTO v_parsed
  FROM parse_truck_designation(v_vehicle.model);
  
  -- Insert initial nomenclature
  INSERT INTO vehicle_nomenclature (
    vehicle_id,
    year,
    make,
    model,
    drive_type,
    weight_class
  ) VALUES (
    p_vehicle_id,
    v_vehicle.year,
    v_vehicle.make,
    v_vehicle.model,
    v_parsed.drive_type,
    v_parsed.weight_class
  )
  ON CONFLICT (vehicle_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE vehicle_nomenclature IS 'Detailed sub-model taxonomy - handles C/K series, weight classes, trim levels, etc.';
COMMENT ON TABLE vehicle_edit_history IS 'Tracks all edits to vehicle data with full audit trail';
COMMENT ON FUNCTION parse_truck_designation IS 'Parses GMC/Chevy truck designations like K1500, C10, V3500';

