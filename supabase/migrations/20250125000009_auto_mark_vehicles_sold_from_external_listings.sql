-- ==========================================================================
-- AUTO-MARK VEHICLES AS SOLD FROM EXTERNAL LISTINGS
-- ==========================================================================
-- Purpose: Automatically update organization_vehicles and vehicles when
--          external_listings (BaT, etc.) are marked as sold
-- ==========================================================================

-- Function to automatically mark vehicles as sold when external listing is sold
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
    
    -- Update organization_vehicles for this vehicle and organization
    UPDATE organization_vehicles
    SET 
      listing_status = 'sold',
      sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, CURRENT_DATE),
      sale_price = COALESCE(NEW.final_price, NEW.current_bid),
      updated_at = NOW()
    WHERE 
      vehicle_id = NEW.vehicle_id
      AND organization_id = NEW.organization_id
      AND (listing_status IS NULL OR listing_status != 'sold');  -- Only update if not already sold
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Also update the vehicles table if it has sale tracking fields
    UPDATE vehicles
    SET 
      sale_price = COALESCE(NEW.final_price, NEW.current_bid, vehicles.sale_price),
      sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, vehicles.sale_date),
      sale_status = 'sold',
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

-- Create trigger on external_listings
DROP TRIGGER IF EXISTS trigger_auto_mark_vehicle_sold ON external_listings;
CREATE TRIGGER trigger_auto_mark_vehicle_sold
  AFTER INSERT OR UPDATE OF listing_status, final_price, sold_at, end_date
  ON external_listings
  FOR EACH ROW
  WHEN (NEW.listing_status = 'sold')
  EXECUTE FUNCTION auto_mark_vehicle_sold_from_external_listing();

-- Also handle bulk updates: if external_listings already has sold records
-- that weren't synced to organization_vehicles, create a function to backfill
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
  UPDATE organization_vehicles ov
  SET 
    listing_status = 'sold',
    sale_date = COALESCE(sl.sold_at::DATE, sl.end_date::DATE, ov.sale_date),
    sale_price = COALESCE(sl.final_price, ov.sale_price),
    updated_at = NOW()
  FROM sold_listings sl
  WHERE 
    ov.vehicle_id = sl.vehicle_id
    AND ov.organization_id = sl.organization_id
    AND (ov.listing_status IS NULL OR ov.listing_status != 'sold')
  RETURNING 
    ov.vehicle_id,
    ov.organization_id,
    1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION auto_mark_vehicle_sold_from_external_listing() TO authenticated;
GRANT EXECUTE ON FUNCTION backfill_sold_status_from_external_listings() TO authenticated;

-- Add comments
COMMENT ON FUNCTION auto_mark_vehicle_sold_from_external_listing() IS 
  'Automatically marks vehicles as sold in organization_vehicles when external_listings status changes to sold. Handles BaT and other auction platform imports.';

COMMENT ON FUNCTION backfill_sold_status_from_external_listings() IS 
  'Backfills sold status for vehicles that have sold external_listings but organization_vehicles was not updated. Run this after importing historical BaT sales.';

COMMENT ON TRIGGER trigger_auto_mark_vehicle_sold ON external_listings IS 
  'Automatically updates organization_vehicles and vehicles when external listing is marked as sold';

