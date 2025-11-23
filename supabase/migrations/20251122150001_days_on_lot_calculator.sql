-- ==========================================================================
-- DAYS ON LOT AUTO-CALCULATOR
-- ==========================================================================
-- Purpose: Calculate days_on_lot based on first photo date with high confidence
-- Method: Use earliest image with confidence >= 70 (arrival inspection quality)
-- ==========================================================================

-- ==========================================================================
-- FUNCTION: Calculate Days on Lot for a Vehicle
-- ==========================================================================

CREATE OR REPLACE FUNCTION calculate_days_on_lot(
  p_vehicle_id UUID,
  p_organization_id UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_arrival_date DATE;
  v_sale_date DATE;
  v_end_date DATE;
  v_days INTEGER;
BEGIN
  -- Get the earliest photo date with high confidence (>= 70)
  -- Priority:
  --   1. Images with angle = 'arrival' and high confidence
  --   2. Images with confidence >= 70
  --   3. Fallback to any image
  SELECT MIN(captured_at::DATE) INTO v_arrival_date
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND captured_at IS NOT NULL
    AND (
      (angle_classification = 'arrival' AND confidence_score >= 50) OR
      (confidence_score >= 70) OR
      (confidence_score IS NULL)  -- Include unscored images as fallback
    );
  
  -- If no images with dates, try timeline events
  IF v_arrival_date IS NULL THEN
    SELECT MIN(event_date::DATE) INTO v_arrival_date
    FROM timeline_events
    WHERE vehicle_id = p_vehicle_id
      AND event_date IS NOT NULL
      AND event_type IN ('arrival', 'inspection', 'acquisition');
  END IF;
  
  -- Still no date? Use vehicle creation date as last resort
  IF v_arrival_date IS NULL THEN
    SELECT created_at::DATE INTO v_arrival_date
    FROM vehicles
    WHERE id = p_vehicle_id;
  END IF;
  
  -- Determine end date (sale date or today)
  IF p_organization_id IS NOT NULL THEN
    -- Check org-specific sale date
    SELECT sale_date INTO v_sale_date
    FROM organization_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND organization_id = p_organization_id
      AND sale_date IS NOT NULL;
  END IF;
  
  -- If no org-specific sale date, check vehicle table
  IF v_sale_date IS NULL THEN
    SELECT 
      CASE 
        WHEN sale_status = 'sold' THEN CURRENT_DATE
        ELSE NULL
      END INTO v_sale_date
    FROM vehicles
    WHERE id = p_vehicle_id;
  END IF;
  
  -- Use sale date if sold, otherwise use today
  v_end_date := COALESCE(v_sale_date, CURRENT_DATE);
  
  -- Calculate days
  v_days := v_end_date - v_arrival_date;
  
  -- Return days (minimum 0)
  RETURN GREATEST(v_days, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_days_on_lot IS 'Calculate days on lot based on first high-confidence photo date';

-- ==========================================================================
-- TRIGGER: Auto-update days_on_lot in organization_vehicles
-- ==========================================================================

CREATE OR REPLACE FUNCTION update_days_on_lot_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalculate days_on_lot
  NEW.days_on_lot := calculate_days_on_lot(NEW.vehicle_id, NEW.organization_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_days_on_lot ON organization_vehicles;
CREATE TRIGGER trigger_update_days_on_lot
  BEFORE INSERT OR UPDATE OF vehicle_id, sale_date, status ON organization_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_days_on_lot_trigger();

-- ==========================================================================
-- TRIGGER: Update days_on_lot when images added
-- ==========================================================================

CREATE OR REPLACE FUNCTION update_vehicle_days_on_lot_from_image()
RETURNS TRIGGER AS $$
BEGIN
  -- Update all organization_vehicles records for this vehicle
  UPDATE organization_vehicles
  SET days_on_lot = calculate_days_on_lot(vehicle_id, organization_id),
      updated_at = NOW()
  WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
    AND status IN ('active', 'sold');
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_days_from_image ON vehicle_images;
CREATE TRIGGER trigger_update_days_from_image
  AFTER INSERT OR UPDATE OF captured_at, angle_classification, confidence_score ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_days_on_lot_from_image();

-- ==========================================================================
-- SCHEDULED JOB: Daily update of days_on_lot
-- ==========================================================================
-- Note: This requires pg_cron extension
-- Run this separately if pg_cron is available:
--
-- SELECT cron.schedule(
--   'update-days-on-lot',
--   '0 2 * * *',  -- Daily at 2 AM
--   $$
--   UPDATE organization_vehicles
--   SET days_on_lot = calculate_days_on_lot(vehicle_id, organization_id),
--       updated_at = NOW()
--   WHERE status IN ('active', 'for_sale')
--     AND listing_status IN ('for_sale', 'available');
--   $$
-- );

-- ==========================================================================
-- BACKFILL: Calculate days_on_lot for all existing vehicles
-- ==========================================================================

-- Update all active organization_vehicles
UPDATE organization_vehicles
SET days_on_lot = calculate_days_on_lot(vehicle_id, organization_id)
WHERE status IN ('active', 'sold', 'for_sale');

-- ==========================================================================
-- HELPER FUNCTION: Get arrival date for a vehicle
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_vehicle_arrival_date(p_vehicle_id UUID)
RETURNS DATE AS $$
DECLARE
  v_date DATE;
BEGIN
  -- Try high-confidence images first
  SELECT MIN(captured_at::DATE) INTO v_date
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND captured_at IS NOT NULL
    AND confidence_score >= 70;
  
  -- Fallback to any image
  IF v_date IS NULL THEN
    SELECT MIN(captured_at::DATE) INTO v_date
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND captured_at IS NOT NULL;
  END IF;
  
  -- Fallback to timeline
  IF v_date IS NULL THEN
    SELECT MIN(event_date::DATE) INTO v_date
    FROM timeline_events
    WHERE vehicle_id = p_vehicle_id
      AND event_date IS NOT NULL;
  END IF;
  
  -- Final fallback to creation date
  IF v_date IS NULL THEN
    SELECT created_at::DATE INTO v_date
    FROM vehicles
    WHERE id = p_vehicle_id;
  END IF;
  
  RETURN v_date;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_vehicle_arrival_date IS 'Get the best estimate of when vehicle arrived (first photo date)';

