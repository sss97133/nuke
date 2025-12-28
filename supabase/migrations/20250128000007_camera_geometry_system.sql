-- Camera Geometry System
-- Tracks three critical angles per image:
-- 1. Sensor plane angle (angle from sensor plane towards subject)
-- 2. Subject-to-camera angle (angle from subject to camera)
-- 3. Lens angle of view (field of view / FOV)

BEGIN;

-- Extend image_angle_spectrum with camera geometry
ALTER TABLE image_angle_spectrum
ADD COLUMN IF NOT EXISTS sensor_plane_angle NUMERIC,  -- Angle from sensor plane towards subject (degrees)
ADD COLUMN IF NOT EXISTS subject_to_camera_angle NUMERIC,  -- Angle from subject to camera (degrees)
ADD COLUMN IF NOT EXISTS lens_angle_of_view NUMERIC,  -- Lens FOV (degrees)
ADD COLUMN IF NOT EXISTS focal_length_mm NUMERIC,  -- Focal length in mm
ADD COLUMN IF NOT EXISTS sensor_size_mm NUMERIC,  -- Sensor size (diagonal or width)
ADD COLUMN IF NOT EXISTS crop_factor NUMERIC,  -- Crop factor (1.0 for full frame)
ADD COLUMN IF NOT EXISTS camera_position_x_m NUMERIC,  -- Camera X position (meters)
ADD COLUMN IF NOT EXISTS camera_position_y_m NUMERIC,  -- Camera Y position (meters)
ADD COLUMN IF NOT EXISTS camera_position_z_m NUMERIC,  -- Camera Z position (meters)
ADD COLUMN IF NOT EXISTS subject_center_x_m NUMERIC,  -- Subject center X (meters)
ADD COLUMN IF NOT EXISTS subject_center_y_m NUMERIC,  -- Subject center Y (meters)
ADD COLUMN IF NOT EXISTS subject_center_z_m NUMERIC;  -- Subject center Z (meters)

-- Function to calculate sensor plane angle
-- This is the angle between the sensor plane normal and the vector to the subject
CREATE OR REPLACE FUNCTION calculate_sensor_plane_angle(
  camera_x NUMERIC,
  camera_y NUMERIC,
  camera_z NUMERIC,
  subject_x NUMERIC,
  subject_y NUMERIC,
  subject_z NUMERIC,
  camera_yaw NUMERIC,  -- Camera rotation around Z axis
  camera_pitch NUMERIC  -- Camera tilt up/down
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  -- Vector from camera to subject
  dx NUMERIC := subject_x - camera_x;
  dy NUMERIC := subject_y - camera_y;
  dz NUMERIC := subject_z - camera_z;
  
  -- Sensor plane normal (where camera is pointing)
  -- Assuming camera is pointing along its yaw/pitch direction
  sensor_normal_x NUMERIC;
  sensor_normal_y NUMERIC;
  sensor_normal_z NUMERIC;
  
  -- Angle between vectors
  dot_product NUMERIC;
  vector_magnitude NUMERIC;
  normal_magnitude NUMERIC;
  angle_rad NUMERIC;
  angle_deg NUMERIC;
BEGIN
  -- Calculate sensor plane normal from yaw/pitch
  -- Convert to radians
  sensor_normal_x := COS(RADIANS(camera_yaw)) * COS(RADIANS(camera_pitch));
  sensor_normal_y := SIN(RADIANS(camera_yaw)) * COS(RADIANS(camera_pitch));
  sensor_normal_z := SIN(RADIANS(camera_pitch));
  
  -- Calculate dot product
  dot_product := dx * sensor_normal_x + dy * sensor_normal_y + dz * sensor_normal_z;
  
  -- Calculate magnitudes
  vector_magnitude := SQRT(dx * dx + dy * dy + dz * dz);
  normal_magnitude := SQRT(sensor_normal_x * sensor_normal_x + 
                          sensor_normal_y * sensor_normal_y + 
                          sensor_normal_z * sensor_normal_z);
  
  -- Calculate angle
  angle_rad := ACOS(dot_product / (vector_magnitude * normal_magnitude));
  angle_deg := DEGREES(angle_rad);
  
  RETURN angle_deg;
END;
$$;

-- Function to calculate subject-to-camera angle
-- This is the angle from the subject's perspective looking at the camera
CREATE OR REPLACE FUNCTION calculate_subject_to_camera_angle(
  camera_x NUMERIC,
  camera_y NUMERIC,
  camera_z NUMERIC,
  subject_x NUMERIC,
  subject_y NUMERIC,
  subject_z NUMERIC,
  subject_orientation_yaw NUMERIC DEFAULT 0  -- Subject's forward direction
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  -- Vector from subject to camera
  dx NUMERIC := camera_x - subject_x;
  dy NUMERIC := camera_y - subject_y;
  dz NUMERIC := camera_z - subject_z;
  
  -- Subject's forward vector
  subject_forward_x NUMERIC := COS(RADIANS(subject_orientation_yaw));
  subject_forward_y NUMERIC := SIN(RADIANS(subject_orientation_yaw));
  subject_forward_z NUMERIC := 0;
  
  -- Angle between subject forward and camera direction
  dot_product NUMERIC;
  vector_magnitude NUMERIC;
  forward_magnitude NUMERIC;
  angle_rad NUMERIC;
  angle_deg NUMERIC;
BEGIN
  -- Calculate dot product
  dot_product := dx * subject_forward_x + dy * subject_forward_y + dz * subject_forward_z;
  
  -- Calculate magnitudes
  vector_magnitude := SQRT(dx * dx + dy * dy + dz * dz);
  forward_magnitude := SQRT(subject_forward_x * subject_forward_x + 
                           subject_forward_y * subject_forward_y + 
                           subject_forward_z * subject_forward_z);
  
  -- Calculate angle
  angle_rad := ACOS(dot_product / (vector_magnitude * forward_magnitude));
  angle_deg := DEGREES(angle_rad);
  
  RETURN angle_deg;
END;
$$;

-- Function to calculate lens angle of view from focal length
-- FOV = 2 * arctan(sensor_size / (2 * focal_length))
CREATE OR REPLACE FUNCTION calculate_lens_angle_of_view(
  focal_length_mm NUMERIC,
  sensor_size_mm NUMERIC,
  crop_factor NUMERIC DEFAULT 1.0
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  effective_focal_length NUMERIC;
  angle_rad NUMERIC;
  angle_deg NUMERIC;
BEGIN
  -- Apply crop factor
  effective_focal_length := focal_length_mm * crop_factor;
  
  -- Calculate FOV
  angle_rad := 2 * ATAN(sensor_size_mm / (2 * effective_focal_length));
  angle_deg := DEGREES(angle_rad);
  
  RETURN angle_deg;
END;
$$;

-- Enhanced function to record angle observation with full camera geometry
CREATE OR REPLACE FUNCTION record_angle_with_camera_geometry(
  p_image_id UUID,
  p_vehicle_id UUID,
  
  -- Basic coordinates (from previous system)
  p_x NUMERIC,  -- Azimuth
  p_y NUMERIC,  -- Elevation
  p_z NUMERIC,  -- Height
  
  -- Camera geometry
  p_camera_x_m NUMERIC,
  p_camera_y_m NUMERIC,
  p_camera_z_m NUMERIC,
  p_camera_yaw NUMERIC,
  p_camera_pitch NUMERIC,
  
  -- Subject position
  p_subject_x_m NUMERIC DEFAULT 0,  -- Vehicle center assumed at origin
  p_subject_y_m NUMERIC DEFAULT 0,
  p_subject_z_m NUMERIC DEFAULT 0,
  p_subject_orientation_yaw NUMERIC DEFAULT 0,  -- Vehicle forward direction
  
  -- Lens parameters
  p_focal_length_mm NUMERIC,
  p_sensor_size_mm NUMERIC,
  p_crop_factor NUMERIC DEFAULT 1.0,
  
  -- Other params
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
  
  -- Calculated angles
  v_sensor_plane_angle NUMERIC;
  v_subject_to_camera_angle NUMERIC;
  v_lens_angle_of_view NUMERIC;
BEGIN
  -- Calculate the three angles
  v_sensor_plane_angle := calculate_sensor_plane_angle(
    p_camera_x_m, p_camera_y_m, p_camera_z_m,
    p_subject_x_m, p_subject_y_m, p_subject_z_m,
    p_camera_yaw, p_camera_pitch
  );
  
  v_subject_to_camera_angle := calculate_subject_to_camera_angle(
    p_camera_x_m, p_camera_y_m, p_camera_z_m,
    p_subject_x_m, p_subject_y_m, p_subject_z_m,
    p_subject_orientation_yaw
  );
  
  v_lens_angle_of_view := calculate_lens_angle_of_view(
    p_focal_length_mm,
    p_sensor_size_mm,
    p_crop_factor
  );
  
  -- Determine zone (from previous system)
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
  
  -- Insert observation with all geometry
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
    evidence,
    -- Camera geometry
    sensor_plane_angle,
    subject_to_camera_angle,
    lens_angle_of_view,
    focal_length_mm,
    sensor_size_mm,
    crop_factor,
    camera_position_x_m,
    camera_position_y_m,
    camera_position_z_m,
    subject_center_x_m,
    subject_center_y_m,
    subject_center_z_m
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
    p_evidence,
    v_sensor_plane_angle,
    v_subject_to_camera_angle,
    v_lens_angle_of_view,
    p_focal_length_mm,
    p_sensor_size_mm,
    p_crop_factor,
    p_camera_x_m,
    p_camera_y_m,
    p_camera_z_m,
    p_subject_x_m,
    p_subject_y_m,
    p_subject_z_m
  )
  RETURNING id INTO v_observation_id;
  
  RETURN v_observation_id;
END;
$$;

-- Function to extract camera geometry from EXIF data
CREATE OR REPLACE FUNCTION extract_camera_geometry_from_exif(
  p_exif_data JSONB
)
RETURNS TABLE(
  focal_length_mm NUMERIC,
  sensor_size_mm NUMERIC,
  crop_factor NUMERIC,
  camera_make TEXT,
  camera_model TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_focal_length NUMERIC;
  v_sensor_width NUMERIC;
  v_sensor_height NUMERIC;
  v_sensor_diagonal NUMERIC;
  v_crop_factor NUMERIC;
  v_camera_make TEXT;
  v_camera_model TEXT;
BEGIN
  -- Extract from EXIF
  v_focal_length := (p_exif_data->>'FocalLength')::NUMERIC;
  v_sensor_width := (p_exif_data->>'SensorWidth')::NUMERIC;
  v_sensor_height := (p_exif_data->>'SensorHeight')::NUMERIC;
  v_camera_make := p_exif_data->>'Make';
  v_camera_model := p_exif_data->>'Model';
  
  -- Calculate sensor diagonal if width/height available
  IF v_sensor_width IS NOT NULL AND v_sensor_height IS NOT NULL THEN
    v_sensor_diagonal := SQRT(v_sensor_width * v_sensor_width + v_sensor_height * v_sensor_height);
  END IF;
  
  -- Determine crop factor from camera model (common values)
  -- Full frame = 1.0, APS-C = 1.5-1.6, Micro Four Thirds = 2.0
  v_crop_factor := CASE
    WHEN v_camera_model LIKE '%Full Frame%' OR v_camera_model LIKE '%FF%' THEN 1.0
    WHEN v_camera_model LIKE '%APS-C%' OR v_camera_model LIKE '%DX%' THEN 1.5
    WHEN v_camera_model LIKE '%Micro Four Thirds%' OR v_camera_model LIKE '%MFT%' THEN 2.0
    WHEN v_camera_model LIKE '%1 inch%' THEN 2.7
    ELSE 1.5  -- Default to APS-C
  END;
  
  RETURN QUERY SELECT
    v_focal_length,
    COALESCE(v_sensor_diagonal, 43.3),  -- Default to full frame diagonal
    v_crop_factor,
    v_camera_make,
    v_camera_model;
END;
$$;

-- Enhanced view with all camera geometry
CREATE OR REPLACE VIEW angle_spectrum_full_view AS
SELECT 
  ias.id,
  ias.image_id,
  ias.vehicle_id,
  vi.image_url,
  
  -- Basic coordinates
  ias.x_coordinate,
  ias.y_coordinate,
  ias.z_coordinate,
  ias.distance_meters,
  
  -- Zone info
  ias.zone_name,
  asz.display_name as zone_display_name,
  asz.domain,
  
  -- Canonical angle
  ias.canonical_angle_key,
  at.display_label as canonical_angle_label,
  
  -- Camera geometry (THE THREE ANGLES)
  ias.sensor_plane_angle,
  ias.subject_to_camera_angle,
  ias.lens_angle_of_view,
  
  -- Camera parameters
  ias.focal_length_mm,
  ias.sensor_size_mm,
  ias.crop_factor,
  
  -- Positions
  ias.camera_position_x_m,
  ias.camera_position_y_m,
  ias.camera_position_z_m,
  ias.subject_center_x_m,
  ias.subject_center_y_m,
  ias.subject_center_z_m,
  
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

COMMENT ON FUNCTION calculate_sensor_plane_angle IS 
  'Calculates angle from sensor plane normal towards subject (angle 1 of 3)';

COMMENT ON FUNCTION calculate_subject_to_camera_angle IS 
  'Calculates angle from subject perspective looking at camera (angle 2 of 3)';

COMMENT ON FUNCTION calculate_lens_angle_of_view IS 
  'Calculates lens field of view from focal length and sensor size (angle 3 of 3)';

COMMENT ON FUNCTION record_angle_with_camera_geometry IS 
  'Records angle observation with all three camera geometry angles calculated automatically';

COMMENT ON COLUMN image_angle_spectrum.sensor_plane_angle IS 
  'Angle from sensor plane towards subject (degrees)';

COMMENT ON COLUMN image_angle_spectrum.subject_to_camera_angle IS 
  'Angle from subject to camera (degrees)';

COMMENT ON COLUMN image_angle_spectrum.lens_angle_of_view IS 
  'Lens field of view / angle of view (degrees)';

COMMIT;

