-- Fix vehicles with sale_price but missing sale_date
-- This addresses 14 vehicles with price but no sale_date

CREATE OR REPLACE FUNCTION fix_missing_sale_dates()
RETURNS TABLE(
  vehicle_id UUID,
  sale_price NUMERIC,
  sale_date DATE,
  source TEXT
) AS $$
DECLARE
  v_vehicle RECORD;
  v_sale_date DATE;
  v_source TEXT;
BEGIN
  FOR v_vehicle IN
    SELECT 
      v.id,
      v.sale_price,
      v.sale_date,
      v.bat_auction_url,
      bl.sale_date as bat_sale_date,
      el.sold_at as external_sold_at,
      el.final_price as external_final_price
    FROM vehicles v
    LEFT JOIN bat_listings bl ON bl.vehicle_id = v.id AND bl.listing_status = 'sold'
    LEFT JOIN external_listings el ON el.vehicle_id = v.id AND el.listing_status = 'sold'
    WHERE v.sale_price IS NOT NULL 
      AND v.sale_price > 0
      AND v.sale_date IS NULL
  LOOP
    -- Determine sale_date from available sources
    v_sale_date := COALESCE(
      v_vehicle.sale_date,
      v_vehicle.bat_sale_date,
      v_vehicle.external_sold_at::DATE
    );

    v_source := CASE
      WHEN v_vehicle.bat_sale_date IS NOT NULL THEN 'bat_listings'
      WHEN v_vehicle.external_sold_at IS NOT NULL THEN 'external_listings'
      ELSE 'unknown'
    END;

    -- Update if we found a date
    IF v_sale_date IS NOT NULL THEN
      UPDATE vehicles
      SET 
        sale_date = v_sale_date,
        updated_at = NOW()
      WHERE id = v_vehicle.id;
    END IF;

    RETURN QUERY SELECT 
      v_vehicle.id,
      v_vehicle.sale_price,
      v_sale_date,
      v_source;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the fix
SELECT * FROM fix_missing_sale_dates();

