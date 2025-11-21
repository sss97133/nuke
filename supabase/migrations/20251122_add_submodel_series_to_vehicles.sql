-- Add submodel/series fields to vehicles table for proper GM truck nomenclature
-- Based on research: MODEL = series (C10/K10/K5), BODY = body_style (Pickup/Suburban/Jimmy), TRIM = trim level

-- Add series/submodel column to vehicles table for easier queries
-- This will store the chassis designation: C10, K10, K5, K1500, etc.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS series TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trim TEXT;

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_vehicles_series ON vehicles(series);
CREATE INDEX IF NOT EXISTS idx_vehicles_trim ON vehicles(trim);

-- Add confidence tracking for these fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS series_source TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS series_confidence INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trim_source TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trim_confidence INTEGER;

-- Update existing vehicles with nomenclature data if available
UPDATE vehicles v
SET 
  series = vn.series,
  trim = vn.trim,
  body_style = COALESCE(v.body_style, vn.body_designation),
  series_source = 'vehicle_nomenclature',
  series_confidence = vn.confidence_score,
  trim_source = 'vehicle_nomenclature',
  trim_confidence = vn.confidence_score
FROM vehicle_nomenclature vn
WHERE v.id = vn.vehicle_id
  AND (v.series IS NULL OR v.trim IS NULL OR v.body_style IS NULL);

-- Create helper view for full vehicle name
CREATE OR REPLACE VIEW vehicle_display_names AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.series,
  v.trim,
  v.body_style,
  -- Generate short name: "1973 GMC K5"
  CONCAT_WS(' ',
    v.year,
    v.make,
    COALESCE(v.series, v.model)
  ) as short_name,
  -- Generate full name: "1973 GMC K5 JIMMY Cheyenne"
  CONCAT_WS(' ',
    v.year,
    v.make,
    COALESCE(v.series, v.model),
    v.body_style,
    v.trim
  ) as full_name,
  -- Generate display name (auto-format): "1973 GMC K5 JIMMY" (skip redundant model if series exists)
  CONCAT_WS(' ',
    v.year,
    v.make,
    COALESCE(v.series, v.model),
    CASE 
      WHEN v.body_style IS NOT NULL AND v.body_style != v.model THEN v.body_style
      ELSE NULL
    END
  ) as display_name
FROM vehicles v;

-- Add comment explaining the structure
COMMENT ON COLUMN vehicles.series IS 'GM chassis designation (C10, K10, K5, C1500, K1500, etc.) - identifies platform and drivetrain';
COMMENT ON COLUMN vehicles.trim IS 'Trim level (Silverado, Cheyenne, Scottsdale, Custom Deluxe, Sierra, etc.)';
COMMENT ON VIEW vehicle_display_names IS 'Pre-formatted vehicle names for display in UI';

-- Function to parse series from model name for existing data
CREATE OR REPLACE FUNCTION extract_series_from_model(model_text TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  -- Match K5, C10, K10, C15, K15, etc. at the start of the string
  -- Uses regexp_match to capture the full designation (letter + number)
  result := (regexp_match(model_text, '^([CKV](?:5|10|15|20|25|30|35|1500|2500|3500))'))[1];
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill series from model for existing vehicles
UPDATE vehicles
SET series = extract_series_from_model(model)
WHERE model IS NOT NULL
  AND extract_series_from_model(model) IS NOT NULL;

-- Intelligently set body_style based on model name
UPDATE vehicles
SET body_style = CASE
  WHEN model ILIKE '%suburban%' THEN 'Suburban'
  WHEN model ILIKE '%blazer%' THEN 'Blazer'
  WHEN model ILIKE '%jimmy%' THEN 'Jimmy'
  WHEN series IN ('C10', 'K10', 'C15', 'K15', 'C20', 'K20', 'C25', 'K25', 'C30', 'K30', 'C1500', 'K1500', 'C2500', 'K2500', 'C3500', 'K3500') THEN 'Pickup'
  ELSE body_style
END
WHERE body_style IS NULL OR body_style = '' OR body_style ILIKE 'suv%';

COMMENT ON FUNCTION extract_series_from_model IS 'Extracts GM series designation from model name (e.g., K5 from K5 Blazer, K1500 from K1500 Silverado)';

