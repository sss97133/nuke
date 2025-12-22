-- ==========================================================================
-- FIX AUTO-MARK VEHICLE SOLD TRIGGER
-- ==========================================================================
-- Purpose: Fix the trigger to handle cases where organization_vehicles
--          record doesn't exist yet (use INSERT ... ON CONFLICT)
-- ==========================================================================

-- Drop and recreate the function to handle missing organization_vehicles records
CREATE OR REPLACE FUNCTION auto_mark_vehicle_sold_from_external_listing()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  -- Only process when listing_status changes to 'sold'
  IF NEW.listing_status = 'sold' AND (OLD.listing_status IS NULL OR OLD.listing_status != 'sold') THEN
    
    -- Upsert organization_vehicles (create if doesn't exist, update if exists)
    INSERT INTO organization_vehicles (
      organization_id,
      vehicle_id,
      relationship_type,
      listing_status,
      sale_date,
      sale_price,
      status,
      updated_at
    )
    VALUES (
      NEW.organization_id,
      NEW.vehicle_id,
      'seller', -- Default relationship type for external listings
      'sold',
      COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, CURRENT_DATE),
      COALESCE(NEW.final_price, NEW.current_bid),
      'past', -- Mark as past since it's sold
      NOW()
    )
    ON CONFLICT (organization_id, vehicle_id, relationship_type)
    DO UPDATE SET
      listing_status = 'sold',
      sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, organization_vehicles.sale_date),
      sale_price = COALESCE(NEW.final_price, NEW.current_bid, organization_vehicles.sale_price),
      status = 'past',
      updated_at = NOW()
    WHERE (organization_vehicles.listing_status IS NULL OR organization_vehicles.listing_status != 'sold');
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Also update the vehicles table if it has sale tracking fields
    UPDATE vehicles
    SET 
      sale_price = COALESCE(NEW.final_price, NEW.current_bid, vehicles.sale_price),
      sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, vehicles.sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      updated_at = NOW()
    WHERE 
      id = NEW.vehicle_id
      AND (sale_status IS NULL OR sale_status != 'sold');  -- Only update if not already sold
    
    -- Log the update (optional, for debugging)
    IF affected_rows > 0 THEN
      RAISE NOTICE 'Auto-marked vehicle % as sold for organization % (from external listing %)', 
        NEW.vehicle_id, NEW.organization_id, NEW.id;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger (it should already exist, but this ensures it's correct)
DROP TRIGGER IF EXISTS trigger_auto_mark_vehicle_sold ON external_listings;
CREATE TRIGGER trigger_auto_mark_vehicle_sold
  AFTER INSERT OR UPDATE OF listing_status, final_price, sold_at, end_date
  ON external_listings
  FOR EACH ROW
  WHEN (NEW.listing_status = 'sold')
  EXECUTE FUNCTION auto_mark_vehicle_sold_from_external_listing();

-- Update the backfill function to also create missing records
CREATE OR REPLACE FUNCTION backfill_sold_status_from_external_listings()
RETURNS TABLE(
  vehicle_id UUID,
  organization_id UUID,
  updated_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH sold_listings AS (
    SELECT DISTINCT ON (el.vehicle_id, el.organization_id)
      el.vehicle_id,
      el.organization_id,
      el.final_price,
      el.sold_at,
      el.end_date
    FROM external_listings el
    WHERE el.listing_status = 'sold'
      AND (el.final_price IS NOT NULL OR el.sold_at IS NOT NULL)
    ORDER BY el.vehicle_id, el.organization_id, el.sold_at DESC NULLS LAST, el.end_date DESC NULLS LAST
  )
  INSERT INTO organization_vehicles (
    organization_id,
    vehicle_id,
    relationship_type,
    listing_status,
    sale_date,
    sale_price,
    status,
    updated_at
  )
  SELECT
    sl.organization_id,
    sl.vehicle_id,
    'seller',
    'sold',
    COALESCE(sl.sold_at::DATE, sl.end_date::DATE),
    sl.final_price,
    'past',
    NOW()
  FROM sold_listings sl
  WHERE NOT EXISTS (
    SELECT 1 FROM organization_vehicles ov
    WHERE ov.vehicle_id = sl.vehicle_id
      AND ov.organization_id = sl.organization_id
      AND ov.relationship_type = 'seller'
  )
  ON CONFLICT (organization_id, vehicle_id, relationship_type)
  DO UPDATE SET
    listing_status = 'sold',
    sale_date = COALESCE(EXCLUDED.sale_date, organization_vehicles.sale_date),
    sale_price = COALESCE(EXCLUDED.sale_price, organization_vehicles.sale_price),
    status = 'past',
    updated_at = NOW()
  WHERE (organization_vehicles.listing_status IS NULL OR organization_vehicles.listing_status != 'sold')
  RETURNING
    vehicle_id,
    organization_id,
    1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION auto_mark_vehicle_sold_from_external_listing() IS 
  'Automatically marks vehicles as sold in organization_vehicles when external_listings status changes to sold. Creates organization_vehicles record if it doesn''t exist.';

COMMENT ON FUNCTION backfill_sold_status_from_external_listings() IS 
  'Backfills sold status for vehicles that have sold external_listings but organization_vehicles was not updated. Creates missing organization_vehicles records.';

