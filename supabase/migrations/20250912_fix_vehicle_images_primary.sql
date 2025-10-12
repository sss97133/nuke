-- Fix vehicle images primary flag
-- Ensures at least one image per vehicle is marked as primary

-- First, set the first image for each vehicle as primary if no primary exists
UPDATE vehicle_images vi1
SET is_primary = true
WHERE vi1.id = (
  SELECT id 
  FROM vehicle_images vi2
  WHERE vi2.vehicle_id = vi1.vehicle_id
  AND NOT EXISTS (
    SELECT 1 
    FROM vehicle_images vi3 
    WHERE vi3.vehicle_id = vi1.vehicle_id 
    AND vi3.is_primary = true
  )
  ORDER BY vi2.created_at ASC, vi2.id ASC
  LIMIT 1
);

-- Create a function to auto-set primary image on insert if none exists
CREATE OR REPLACE FUNCTION auto_set_primary_image()
RETURNS TRIGGER AS $$
BEGIN
  -- If this is the first image for the vehicle, make it primary
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_images 
    WHERE vehicle_id = NEW.vehicle_id 
    AND id != NEW.id
  ) THEN
    NEW.is_primary = true;
  END IF;
  
  -- If no primary exists and this isn't already set as primary, make it primary
  IF NEW.is_primary IS NOT true AND NOT EXISTS (
    SELECT 1 FROM vehicle_images 
    WHERE vehicle_id = NEW.vehicle_id 
    AND is_primary = true
    AND id != NEW.id
  ) THEN
    NEW.is_primary = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-setting primary image
DROP TRIGGER IF EXISTS auto_set_primary_image_trigger ON vehicle_images;
CREATE TRIGGER auto_set_primary_image_trigger
BEFORE INSERT ON vehicle_images
FOR EACH ROW
EXECUTE FUNCTION auto_set_primary_image();

-- Also create a function to ensure only one primary image per vehicle
CREATE OR REPLACE FUNCTION ensure_single_primary_image()
RETURNS TRIGGER AS $$
BEGIN
  -- If setting this image as primary, unset all others for this vehicle
  IF NEW.is_primary = true THEN
    UPDATE vehicle_images 
    SET is_primary = false
    WHERE vehicle_id = NEW.vehicle_id 
    AND id != NEW.id
    AND is_primary = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to ensure only one primary
DROP TRIGGER IF EXISTS ensure_single_primary_trigger ON vehicle_images;
CREATE TRIGGER ensure_single_primary_trigger
BEFORE INSERT OR UPDATE ON vehicle_images
FOR EACH ROW
EXECUTE FUNCTION ensure_single_primary_image();
