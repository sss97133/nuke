-- 3D Angle Spectrum System
-- Combines precise X,Y,Z coordinates with named zones for generalization
-- Goal: VERY specific but also queryable by zone

BEGIN;

-- Step 1: Create angle spectrum zones (named sections)
CREATE TABLE IF NOT EXISTS angle_spectrum_zones (
  zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name TEXT NOT NULL UNIQUE,  -- e.g. "front_quarter_driver_zone"
  display_name TEXT NOT NULL,      -- e.g. "Front Quarter Driver Zone"
  
  -- Coordinate ranges (in degrees)
  x_min NUMERIC,  -- Left-right: -90 (driver) to +90 (passenger)
  x_max NUMERIC,
  y_min NUMERIC,  -- Front-rear: -90 (front) to +90 (rear)
  y_max NUMERIC,
  z_min NUMERIC,  -- Elevation: 0 (ground) to 90 (overhead)
  z_max NUMERIC,
  
  -- Zone metadata
  domain TEXT NOT NULL,  -- exterior|interior|engine|undercarriage
  side_applicability TEXT,  -- driver|passenger|both|none
  typical_use_case TEXT,  -- appraisal|documentation|comparison
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_angle_zones_domain ON angle_spectrum_zones(domain);
CREATE INDEX idx_angle_zones_coords ON angle_spectrum_zones USING GIST (
  box(point(x_min, y_min), point(x_max, y_max))
);

-- Step 2: Create precise angle observations with 3D coordinates
CREATE TABLE IF NOT EXISTS image_angle_spectrum (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Precise 3D coordinates (in degrees)
  x_coordinate NUMERIC NOT NULL,  -- Azimuth: -90 to +90 (driver to passenger)
  y_coordinate NUMERIC NOT NULL,  -- Elevation angle: -90 to +90 (front to rear)
  z_coordinate NUMERIC NOT NULL,  -- Camera height: 0 to 90 (ground to overhead)
  
  -- Distance (in meters, optional)
  distance_meters NUMERIC,
  
  -- Zone assignment (which named zone this falls into)
  zone_id UUID REFERENCES angle_spectrum_zones(zone_id),
  zone_name TEXT,  -- Denormalized for quick queries
  
  -- Precise angle name (from taxonomy)
  canonical_angle_id UUID REFERENCES angle_taxonomy(angle_id),
  canonical_angle_key TEXT,  -- Denormalized
  
  -- Confidence and source
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL,  -- ai|human|import|derived
  source_model TEXT,  -- gpt-4o, claude, etc.
  
  -- Evidence
  evidence JSONB,  -- Features visible, reasoning, etc.
  
  observed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_angle_spectrum_image ON image_angle_spectrum(image_id);
CREATE INDEX idx_angle_spectrum_vehicle ON image_angle_spectrum(vehicle_id);
CREATE INDEX idx_angle_spectrum_zone ON image_angle_spectrum(zone_id);
CREATE INDEX idx_angle_spectrum_coords ON image_angle_spectrum USING GIST (
  point(x_coordinate, y_coordinate, z_coordinate)
);

-- Step 3: Function to determine zone from coordinates
CREATE OR REPLACE FUNCTION get_angle_zone(
  p_x NUMERIC,  -- Azimuth
  p_y NUMERIC,  -- Elevation
  p_z NUMERIC   -- Height
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_zone_id UUID;
BEGIN
  SELECT zone_id INTO v_zone_id
  FROM angle_spectrum_zones
  WHERE p_x BETWEEN COALESCE(x_min, -180) AND COALESCE(x_max, 180)
    AND p_y BETWEEN COALESCE(y_min, -180) AND COALESCE(y_max, 180)
    AND p_z BETWEEN COALESCE(z_min, -180) AND COALESCE(z_max, 180)
  ORDER BY 
    -- Prefer more specific zones (smaller ranges)
    (COALESCE(x_max, 180) - COALESCE(x_min, -180)) +
    (COALESCE(y_max, 180) - COALESCE(y_min, -180)) +
    (COALESCE(z_max, 180) - COALESCE(z_min, -180))
  LIMIT 1;
  
  RETURN v_zone_id;
END;
$$;

-- Step 4: Function to get canonical angle from coordinates
CREATE OR REPLACE FUNCTION get_canonical_angle_from_coords(
  p_x NUMERIC,
  p_y NUMERIC,
  p_z NUMERIC
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_zone_id UUID;
  v_zone_name TEXT;
  v_canonical_key TEXT;
BEGIN
  -- Get zone
  v_zone_id := get_angle_zone(p_x, p_y, p_z);
  
  IF v_zone_id IS NULL THEN
    RETURN 'unknown';
  END IF;
  
  SELECT zone_name, domain INTO v_zone_name, v_canonical_key
  FROM angle_spectrum_zones
  WHERE zone_id = v_zone_id;
  
  -- Map zone to canonical angle
  -- This is where we connect zones to precise taxonomy
  SELECT canonical_key INTO v_canonical_key
  FROM angle_taxonomy
  WHERE canonical_key LIKE v_zone_name || '%'
     OR canonical_key LIKE '%' || v_zone_name || '%'
  LIMIT 1;
  
  RETURN COALESCE(v_canonical_key, v_zone_name);
END;
$$;

-- Step 5: Seed zones with coordinate ranges
INSERT INTO angle_spectrum_zones (zone_name, display_name, x_min, x_max, y_min, y_max, z_min, z_max, domain, side_applicability, typical_use_case)
VALUES
  -- EXTERIOR ZONES
  ('front_quarter_driver_zone', 'Front Quarter Driver Zone', 
   -90, -30,  -- X: Driver side
   -60, -30,  -- Y: Front quarter
   0, 30,     -- Z: Ground to low elevation
   'exterior', 'driver', 'appraisal'),
   
  ('front_quarter_passenger_zone', 'Front Quarter Passenger Zone',
   30, 90,    -- X: Passenger side
   -60, -30,  -- Y: Front quarter
   0, 30,     -- Z: Ground to low elevation
   'exterior', 'passenger', 'appraisal'),
   
  ('front_three_quarter_driver_zone', 'Front Three-Quarter Driver Zone',
   -90, -45,  -- X: Driver side
   -45, -15,  -- Y: Front three-quarter
   0, 30,
   'exterior', 'driver', 'appraisal'),
   
  ('front_three_quarter_passenger_zone', 'Front Three-Quarter Passenger Zone',
   45, 90,    -- X: Passenger side
   -45, -15,  -- Y: Front three-quarter
   0, 30,
   'exterior', 'passenger', 'appraisal'),
   
  ('side_driver_zone', 'Side Driver Zone',
   -90, -60,  -- X: Driver side
   -15, 15,   -- Y: Side view
   0, 30,
   'exterior', 'driver', 'appraisal'),
   
  ('side_passenger_zone', 'Side Passenger Zone',
   60, 90,    -- X: Passenger side
   -15, 15,   -- Y: Side view
   0, 30,
   'exterior', 'passenger', 'appraisal'),
   
  ('rear_three_quarter_driver_zone', 'Rear Three-Quarter Driver Zone',
   -90, -45,  -- X: Driver side
   15, 45,    -- Y: Rear three-quarter
   0, 30,
   'exterior', 'driver', 'appraisal'),
   
  ('rear_three_quarter_passenger_zone', 'Rear Three-Quarter Passenger Zone',
   45, 90,    -- X: Passenger side
   15, 45,    -- Y: Rear three-quarter
   0, 30,
   'exterior', 'passenger', 'appraisal'),
   
  ('front_straight_zone', 'Front Straight Zone',
   -15, 15,   -- X: Center
   -90, -60,  -- Y: Straight front
   0, 30,
   'exterior', 'both', 'appraisal'),
   
  ('rear_straight_zone', 'Rear Straight Zone',
   -15, 15,   -- X: Center
   60, 90,    -- Y: Straight rear
   0, 30,
   'exterior', 'both', 'appraisal'),
   
  -- ENGINE BAY ZONES
  ('engine_bay_driver_zone', 'Engine Bay Driver Zone',
   -90, -30,  -- X: Driver side
   -30, 30,   -- Y: Center
   60, 90,    -- Z: High elevation (looking down)
   'engine', 'driver', 'documentation'),
   
  ('engine_bay_passenger_zone', 'Engine Bay Passenger Zone',
   30, 90,    -- X: Passenger side
   -30, 30,   -- Y: Center
   60, 90,    -- Z: High elevation
   'engine', 'passenger', 'documentation'),
   
  ('engine_bay_full_zone', 'Engine Bay Full Zone',
   -30, 30,   -- X: Center
   -30, 30,   -- Y: Center
   60, 90,    -- Z: High elevation
   'engine', 'both', 'documentation'),
   
  -- INTERIOR ZONES
  ('interior_dash_zone', 'Interior Dashboard Zone',
   -15, 15,   -- X: Center
   -60, -30,  -- Y: Front
   30, 60,    -- Z: Mid elevation
   'interior', 'both', 'documentation'),
   
  ('interior_driver_zone', 'Interior Driver Zone',
   -90, -30,  -- X: Driver side
   -30, 30,   -- Y: Center
   30, 60,
   'interior', 'driver', 'documentation'),
   
  ('interior_passenger_zone', 'Interior Passenger Zone',
   30, 90,    -- X: Passenger side
   -30, 30,   -- Y: Center
   30, 60,
   'interior', 'passenger', 'documentation')
ON CONFLICT (zone_name) DO NOTHING;

-- Step 6: Function to record angle observation with auto-zone detection
CREATE OR REPLACE FUNCTION record_angle_observation(
  p_image_id UUID,
  p_vehicle_id UUID,
  p_x NUMERIC,
  p_y NUMERIC,
  p_z NUMERIC,
  p_distance_meters NUMERIC DEFAULT NULL,
  p_confidence NUMERIC DEFAULT 0.5,
  p_source TEXT DEFAULT 'ai',
  p_source_model TEXT DEFAULT NULL,
  p_evidence JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_zone_id UUID;
  v_zone_name TEXT;
  v_canonical_angle_key TEXT;
  v_canonical_angle_id UUID;
  v_observation_id UUID;
BEGIN
  -- Determine zone
  v_zone_id := get_angle_zone(p_x, p_y, p_z);
  
  IF v_zone_id IS NOT NULL THEN
    SELECT zone_name INTO v_zone_name
    FROM angle_spectrum_zones
    WHERE zone_id = v_zone_id;
  END IF;
  
  -- Get canonical angle
  v_canonical_angle_key := get_canonical_angle_from_coords(p_x, p_y, p_z);
  
  IF v_canonical_angle_key != 'unknown' THEN
    SELECT angle_id INTO v_canonical_angle_id
    FROM angle_taxonomy
    WHERE canonical_key = v_canonical_angle_key
    LIMIT 1;
  END IF;
  
  -- Insert observation
  INSERT INTO image_angle_spectrum (
    image_id,
    vehicle_id,
    x_coordinate,
    y_coordinate,
    z_coordinate,
    distance_meters,
    zone_id,
    zone_name,
    canonical_angle_id,
    canonical_angle_key,
    confidence,
    source,
    source_model,
    evidence
  )
  VALUES (
    p_image_id,
    p_vehicle_id,
    p_x,
    p_y,
    p_z,
    p_distance_meters,
    v_zone_id,
    v_zone_name,
    v_canonical_angle_id,
    v_canonical_angle_key,
    p_confidence,
    p_source,
    p_source_model,
    p_evidence
  )
  RETURNING id INTO v_observation_id;
  
  RETURN v_observation_id;
END;
$$;

-- Step 7: View for querying angles by zone or coordinates
CREATE OR REPLACE VIEW angle_spectrum_view AS
SELECT 
  ias.id,
  ias.image_id,
  ias.vehicle_id,
  vi.image_url,
  
  -- Precise coordinates
  ias.x_coordinate,
  ias.y_coordinate,
  ias.z_coordinate,
  ias.distance_meters,
  
  -- Zone info
  ias.zone_name,
  asz.display_name as zone_display_name,
  asz.domain,
  asz.side_applicability,
  
  -- Canonical angle
  ias.canonical_angle_key,
  at.display_label as canonical_angle_label,
  
  -- Metadata
  ias.confidence,
  ias.source,
  ias.source_model,
  ias.evidence,
  ias.observed_at
FROM image_angle_spectrum ias
LEFT JOIN angle_spectrum_zones asz ON ias.zone_id = asz.zone_id
LEFT JOIN angle_taxonomy at ON ias.canonical_angle_id = at.angle_id
LEFT JOIN vehicle_images vi ON ias.image_id = vi.id;

COMMENT ON TABLE angle_spectrum_zones IS 
  'Named zones in 3D angle space - allows generalization while maintaining precision';

COMMENT ON TABLE image_angle_spectrum IS 
  'Precise 3D angle observations with automatic zone assignment';

COMMENT ON FUNCTION get_angle_zone IS 
  'Determines which named zone a set of X,Y,Z coordinates falls into';

COMMENT ON FUNCTION record_angle_observation IS 
  'Records a precise angle observation with automatic zone and canonical angle assignment';

COMMIT;

