-- ==========================================================================
-- BACKFILL SOLD VEHICLES DATA
-- ==========================================================================
-- Purpose: Backfill missing sale_date and sale_price for vehicles marked as sold
--          Uses data from vehicles table, BaT URLs, and timeline events
-- ==========================================================================

-- Comprehensive backfill function for sold vehicles
CREATE OR REPLACE FUNCTION backfill_sold_vehicles_comprehensive()
RETURNS TABLE(
  vehicle_id UUID,
  organization_id UUID,
  actions_taken TEXT[],
  sale_date DATE,
  sale_price NUMERIC
) AS $$
DECLARE
  rec RECORD;
  actions TEXT[];
  final_sale_date DATE;
  final_sale_price NUMERIC;
BEGIN
  -- Process all sold vehicles missing sale_date or sale_price
  FOR rec IN
    SELECT 
      ov.id as org_vehicle_id,
      ov.vehicle_id,
      ov.organization_id,
      ov.sale_date as ov_sale_date,
      ov.sale_price as ov_sale_price,
      v.sale_date as v_sale_date,
      v.sale_price as v_sale_price,
      v.bat_auction_url,
      v.created_at as vehicle_created_at,
      v.updated_at as vehicle_updated_at,
      ov.created_at as org_vehicle_created_at,
      te.event_date as timeline_sale_date,
      te.cost_amount as timeline_sale_price,
      te.metadata->>'bat_url' as timeline_bat_url
    FROM organization_vehicles ov
    JOIN vehicles v ON v.id = ov.vehicle_id
    LEFT JOIN timeline_events te ON 
      te.vehicle_id = ov.vehicle_id 
      AND te.event_type = 'sale'
      AND te.metadata->>'source' = 'bat_import'
    WHERE 
      ov.listing_status = 'sold'
      AND (ov.sale_date IS NULL OR ov.sale_price IS NULL)
  LOOP
    actions := ARRAY[]::TEXT[];
    final_sale_date := rec.ov_sale_date;
    final_sale_price := rec.ov_sale_price;
    
    -- Priority 1: Use timeline event date (most accurate for BaT imports)
    IF final_sale_date IS NULL AND rec.timeline_sale_date IS NOT NULL THEN
      final_sale_date := rec.timeline_sale_date::DATE;
      actions := array_append(actions, 'sale_date from timeline_event');
    END IF;
    
    -- Priority 2: Use vehicle.sale_date
    IF final_sale_date IS NULL AND rec.v_sale_date IS NOT NULL THEN
      final_sale_date := rec.v_sale_date;
      actions := array_append(actions, 'sale_date from vehicles table');
    END IF;
    
    -- Priority 3: For BaT imports, use created_at as fallback (BaT imports happen close to sale date)
    IF final_sale_date IS NULL AND (rec.bat_auction_url IS NOT NULL OR rec.timeline_bat_url IS NOT NULL) THEN
      -- Use the earlier of vehicle_created_at or org_vehicle_created_at
      final_sale_date := LEAST(
        COALESCE(rec.vehicle_created_at::DATE, CURRENT_DATE),
        COALESCE(rec.org_vehicle_created_at::DATE, CURRENT_DATE)
      );
      actions := array_append(actions, 'sale_date estimated from created_at (BaT import)');
    END IF;
    
    -- Priority 4: Last resort - use created_at (less accurate)
    IF final_sale_date IS NULL THEN
      final_sale_date := LEAST(
        COALESCE(rec.vehicle_created_at::DATE, CURRENT_DATE),
        COALESCE(rec.org_vehicle_created_at::DATE, CURRENT_DATE)
      );
      actions := array_append(actions, 'sale_date estimated from created_at (fallback)');
    END IF;
    
    -- Sale price: Priority 1 - timeline event
    IF final_sale_price IS NULL AND rec.timeline_sale_price IS NOT NULL THEN
      final_sale_price := rec.timeline_sale_price;
      actions := array_append(actions, 'sale_price from timeline_event');
    END IF;
    
    -- Sale price: Priority 2 - vehicles table
    IF final_sale_price IS NULL AND rec.v_sale_price IS NOT NULL THEN
      final_sale_price := rec.v_sale_price;
      actions := array_append(actions, 'sale_price from vehicles table');
    END IF;
    
    -- Update organization_vehicles if we found data
    IF final_sale_date IS NOT NULL OR final_sale_price IS NOT NULL THEN
      UPDATE organization_vehicles ov_update
      SET 
        sale_date = COALESCE(final_sale_date, ov_update.sale_date),
        sale_price = COALESCE(final_sale_price, ov_update.sale_price),
        updated_at = NOW()
      WHERE ov_update.id = rec.org_vehicle_id;
      
      -- Also update vehicles table to keep in sync
      UPDATE vehicles v_update
      SET 
        sale_date = COALESCE(final_sale_date, v_update.sale_date),
        sale_price = COALESCE(final_sale_price, v_update.sale_price),
        sale_status = 'sold',
        updated_at = NOW()
      WHERE v_update.id = rec.vehicle_id;
      
      RETURN QUERY SELECT 
        rec.vehicle_id,
        rec.organization_id,
        actions,
        final_sale_date,
        final_sale_price;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute
GRANT EXECUTE ON FUNCTION backfill_sold_vehicles_comprehensive() TO authenticated;

COMMENT ON FUNCTION backfill_sold_vehicles_comprehensive() IS 
  'Comprehensive backfill for sold vehicles: fills missing sale_date and sale_price from multiple sources (timeline_events, vehicles table, BaT URLs, created_at fallback)';

