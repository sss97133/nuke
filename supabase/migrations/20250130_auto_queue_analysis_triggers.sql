-- Auto-queue analysis triggers
-- Automatically queue analysis when vehicles are created or images are added

-- Function to auto-queue expert valuation
CREATE OR REPLACE FUNCTION auto_queue_expert_valuation()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_id UUID;
  v_image_count INTEGER;
BEGIN
  -- Determine vehicle_id based on trigger context
  IF TG_TABLE_NAME = 'vehicles' THEN
    v_vehicle_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'vehicle_images' THEN
    v_vehicle_id := NEW.vehicle_id;
  ELSE
    RETURN NEW;
  END IF;
  
  -- Count images for this vehicle
  SELECT COUNT(*) INTO v_image_count
  FROM vehicle_images
  WHERE vehicle_id = v_vehicle_id
    AND (is_document IS NULL OR is_document = false);
  
  -- Only queue if vehicle has at least 1 image (for image analysis)
  -- Or if it's a new vehicle (for initial valuation)
  IF TG_TABLE_NAME = 'vehicles' OR v_image_count >= 1 THEN
    -- Queue with appropriate priority
    -- New vehicles get higher priority (3), image additions get normal priority (5)
    PERFORM queue_analysis(
      v_vehicle_id,
      'expert_valuation',
      CASE 
        WHEN TG_TABLE_NAME = 'vehicles' THEN 3 -- New vehicle = high priority
        ELSE 5 -- Image addition = normal priority
      END,
      'auto'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on vehicle creation
DROP TRIGGER IF EXISTS auto_queue_valuation_on_vehicle_create ON vehicles;
CREATE TRIGGER auto_queue_valuation_on_vehicle_create
  AFTER INSERT ON vehicles
  FOR EACH ROW
  WHEN (NEW.profile_origin IS NOT NULL) -- Only for imported/scraped vehicles
  EXECUTE FUNCTION auto_queue_expert_valuation();

-- Trigger on image addition (but only if vehicle has no existing valuation)
DROP TRIGGER IF EXISTS auto_queue_valuation_on_image_add ON vehicle_images;
CREATE TRIGGER auto_queue_valuation_on_image_add
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.is_document IS NULL OR NEW.is_document = false) -- Only non-document images
  EXECUTE FUNCTION auto_queue_expert_valuation();

-- Note: We don't trigger on UPDATE to avoid spam, only on new data

COMMENT ON FUNCTION auto_queue_expert_valuation IS 'Automatically queues expert valuation when vehicles are created or images are added';

