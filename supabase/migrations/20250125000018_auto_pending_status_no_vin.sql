-- Automatically set vehicle status to 'pending' if no VIN exists
-- This extends the existing image-based pending logic to also check for VIN

-- Update the existing function to also check for VIN
CREATE OR REPLACE FUNCTION update_vehicle_status_by_images(p_vehicle_id UUID)
RETURNS VOID AS $$
DECLARE
  image_count INTEGER;
  current_status TEXT;
  vehicle_vin TEXT;
BEGIN
  -- Skip if vehicle_id is NULL (personal photo library images)
  IF p_vehicle_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current status and VIN
  SELECT status, vin INTO current_status, vehicle_vin
  FROM vehicles
  WHERE id = p_vehicle_id;

  -- Count images for this vehicle
  SELECT COUNT(*) INTO image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;

  -- Determine if vehicle should be pending
  -- Pending if: no images OR no VIN (and status is not already 'pending' or 'archived')
  -- Only auto-set to pending if status is 'active', 'draft', or NULL
  IF (image_count = 0 OR vehicle_vin IS NULL OR TRIM(vehicle_vin) = '') 
     AND current_status IN ('active', 'draft', NULL) THEN
    UPDATE vehicles
    SET 
      status = 'pending',
      updated_at = NOW()
    WHERE id = p_vehicle_id
    AND status != 'pending';
    
  -- If images exist AND VIN exists and status is 'pending', set back to 'active'
  ELSIF image_count > 0 
        AND vehicle_vin IS NOT NULL 
        AND TRIM(vehicle_vin) != ''
        AND current_status = 'pending' THEN
    UPDATE vehicles
    SET 
      status = 'active',
      updated_at = NOW()
    WHERE id = p_vehicle_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Update the fix function to also check for VIN
CREATE OR REPLACE FUNCTION fix_vehicles_without_images()
RETURNS TABLE(
  vehicle_id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  old_status TEXT,
  new_status TEXT,
  image_count BIGINT,
  has_vin BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH vehicles_to_fix AS (
    SELECT 
      v.id,
      v.year,
      v.make,
      v.model,
      v.status,
      v.vin,
      COUNT(vi.id) as img_count
    FROM vehicles v
    LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
    WHERE v.status IN ('active', 'draft', NULL)
    GROUP BY v.id, v.year, v.make, v.model, v.status, v.vin
    HAVING COUNT(vi.id) = 0 OR v.vin IS NULL OR TRIM(v.vin) = ''
  )
  UPDATE vehicles v
  SET 
    status = 'pending',
    updated_at = NOW()
  FROM vehicles_to_fix vtf
  WHERE v.id = vtf.id
  RETURNING 
    v.id,
    v.year,
    v.make,
    v.model,
    vtf.status as old_status,
    v.status as new_status,
    vtf.img_count::BIGINT,
    (vtf.vin IS NOT NULL AND TRIM(vtf.vin) != '') as has_vin;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to check VIN on vehicle update
CREATE OR REPLACE FUNCTION check_vehicle_vin_on_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only check if VIN changed or status changed
  IF (OLD.vin IS DISTINCT FROM NEW.vin) OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM update_vehicle_status_by_images(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for vehicle updates
DROP TRIGGER IF EXISTS trigger_check_vehicle_vin_on_update ON vehicles;
CREATE TRIGGER trigger_check_vehicle_vin_on_update
  AFTER UPDATE OF vin, status ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_vin_on_update();

COMMENT ON FUNCTION update_vehicle_status_by_images(UUID) IS 'Helper function to update vehicle status based on image count and VIN presence';
COMMENT ON FUNCTION check_vehicle_vin_on_update() IS 'Trigger function: checks vehicle status after VIN is updated';

