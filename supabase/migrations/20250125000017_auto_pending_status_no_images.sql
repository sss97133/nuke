-- Automatically set vehicle status to 'pending' if no images exist
-- This handles BAT listings and all other vehicles that are created without images

-- Function to check and update vehicle status based on image count
-- This is a helper function that can be called from triggers
CREATE OR REPLACE FUNCTION update_vehicle_status_by_images(p_vehicle_id UUID)
RETURNS VOID AS $$
DECLARE
  image_count INTEGER;
  current_status TEXT;
BEGIN
  -- Skip if vehicle_id is NULL (personal photo library images)
  IF p_vehicle_id IS NULL THEN
    RETURN;
  END IF;

  -- Get current status
  SELECT status INTO current_status
  FROM vehicles
  WHERE id = p_vehicle_id;

  -- Count images for this vehicle
  SELECT COUNT(*) INTO image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;

  -- If no images and status is not already 'pending' or 'archived', set to pending
  -- Only auto-set to pending if status is 'active', 'draft', or NULL
  IF image_count = 0 AND current_status IN ('active', 'draft', NULL) THEN
    UPDATE vehicles
    SET 
      status = 'pending',
      updated_at = NOW()
    WHERE id = p_vehicle_id
    AND status != 'pending';
    
  -- If images exist and status is 'pending', set back to 'active'
  ELSIF image_count > 0 AND current_status = 'pending' THEN
    UPDATE vehicles
    SET 
      status = 'active',
      updated_at = NOW()
    WHERE id = p_vehicle_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for vehicle insert
CREATE OR REPLACE FUNCTION check_vehicle_images_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_vehicle_status_by_images(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for image insert
CREATE OR REPLACE FUNCTION check_vehicle_images_on_image_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.vehicle_id IS NOT NULL THEN
    PERFORM update_vehicle_status_by_images(NEW.vehicle_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for image delete
CREATE OR REPLACE FUNCTION check_vehicle_images_on_image_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.vehicle_id IS NOT NULL THEN
    PERFORM update_vehicle_status_by_images(OLD.vehicle_id);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After vehicle is created, check if it has images
DROP TRIGGER IF EXISTS trigger_check_vehicle_images_on_insert ON vehicles;
CREATE TRIGGER trigger_check_vehicle_images_on_insert
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_images_on_insert();

-- Trigger: After image is added, check if vehicle should be activated
DROP TRIGGER IF EXISTS trigger_check_vehicle_images_on_image_insert ON vehicle_images;
CREATE TRIGGER trigger_check_vehicle_images_on_image_insert
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.vehicle_id IS NOT NULL)
  EXECUTE FUNCTION check_vehicle_images_on_image_insert();

-- Trigger: After image is deleted, check if vehicle should be set to pending
DROP TRIGGER IF EXISTS trigger_check_vehicle_images_on_image_delete ON vehicle_images;
CREATE TRIGGER trigger_check_vehicle_images_on_image_delete
  AFTER DELETE ON vehicle_images
  FOR EACH ROW
  WHEN (OLD.vehicle_id IS NOT NULL)
  EXECUTE FUNCTION check_vehicle_images_on_image_delete();

-- Function to fix existing vehicles (can be called manually)
CREATE OR REPLACE FUNCTION fix_vehicles_without_images()
RETURNS TABLE(
  vehicle_id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  old_status TEXT,
  new_status TEXT,
  image_count BIGINT
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
      COUNT(vi.id) as img_count
    FROM vehicles v
    LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
    WHERE v.status IN ('active', 'draft', NULL)
    GROUP BY v.id, v.year, v.make, v.model, v.status
    HAVING COUNT(vi.id) = 0
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
    vtf.img_count::BIGINT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_vehicle_status_by_images(UUID) IS 'Helper function to update vehicle status based on image count';
COMMENT ON FUNCTION check_vehicle_images_on_insert() IS 'Trigger function: checks vehicle images after vehicle creation';
COMMENT ON FUNCTION check_vehicle_images_on_image_insert() IS 'Trigger function: checks vehicle status after image is added';
COMMENT ON FUNCTION check_vehicle_images_on_image_delete() IS 'Trigger function: checks vehicle status after image is deleted';
COMMENT ON FUNCTION fix_vehicles_without_images() IS 'One-time function to fix existing vehicles without images by setting them to pending status';

