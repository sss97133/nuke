-- Fix external_listings marked sold but missing final_price
-- This addresses 5 listings marked sold but missing final_price

CREATE OR REPLACE FUNCTION fix_external_listings_missing_prices()
RETURNS TABLE(
  listing_id UUID,
  vehicle_id UUID,
  old_final_price NUMERIC,
  new_final_price NUMERIC,
  source TEXT
) AS $$
DECLARE
  v_listing RECORD;
  v_final_price NUMERIC;
  v_source TEXT;
BEGIN
  FOR v_listing IN
    SELECT 
      el.id,
      el.vehicle_id,
      el.final_price,
      el.listing_status,
      v.sale_price,
      bl.sale_price as bat_sale_price,
      bl.final_bid as bat_final_bid
    FROM external_listings el
    LEFT JOIN vehicles v ON v.id = el.vehicle_id
    LEFT JOIN bat_listings bl ON bl.vehicle_id = el.vehicle_id AND bl.listing_status = 'sold'
    WHERE el.listing_status = 'sold'
      AND el.final_price IS NULL
  LOOP
    -- Determine final_price from available sources
    v_final_price := COALESCE(
      v_listing.final_price,
      v_listing.sale_price,
      v_listing.bat_sale_price,
      v_listing.bat_final_bid
    );

    v_source := CASE
      WHEN v_listing.sale_price IS NOT NULL THEN 'vehicles.sale_price'
      WHEN v_listing.bat_sale_price IS NOT NULL THEN 'bat_listings.sale_price'
      WHEN v_listing.bat_final_bid IS NOT NULL THEN 'bat_listings.final_bid'
      ELSE 'unknown'
    END;

    -- Update if we found a price
    IF v_final_price IS NOT NULL THEN
      UPDATE external_listings
      SET 
        final_price = v_final_price,
        updated_at = NOW()
      WHERE id = v_listing.id;
    END IF;

    RETURN QUERY SELECT 
      v_listing.id,
      v_listing.vehicle_id,
      v_listing.final_price,
      v_final_price,
      v_source;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the fix
SELECT * FROM fix_external_listings_missing_prices();

