-- Extract prices from model names for vehicles without prices
-- Some vehicles have prices embedded in the model field (e.g., "4Runner SR5 4x4 Premium lift - $28,995")
-- This function extracts those prices and sets asking_price

CREATE OR REPLACE FUNCTION extract_prices_from_model_names()
RETURNS TABLE(
  vehicle_id UUID,
  extracted_price NUMERIC,
  model_text TEXT
) AS $$
DECLARE
  v_vehicle RECORD;
  v_price NUMERIC;
  v_model_clean TEXT;
BEGIN
  FOR v_vehicle IN
    SELECT 
      id,
      model,
      asking_price
    FROM vehicles
    WHERE sale_price IS NULL 
      AND asking_price IS NULL 
      AND current_value IS NULL 
      AND purchase_price IS NULL
      AND model LIKE '%$%'
  LOOP
    -- Extract price from model using regex
    -- Pattern: $XX,XXX or $XX,XXX.XX or $XXX,XXX
    v_model_clean := v_vehicle.model;
    
    -- Try to extract price (look for $ followed by numbers with optional commas and decimals)
    SELECT 
      (regexp_match(v_model_clean, '\$([0-9,]+\.?[0-9]*)'))[1]::TEXT
    INTO v_model_clean;
    
    -- Remove commas and convert to numeric
    IF v_model_clean IS NOT NULL THEN
      v_price := REPLACE(v_model_clean, ',', '')::NUMERIC;
      
      -- Only set if price is reasonable (between $100 and $10M)
      IF v_price >= 100 AND v_price <= 10000000 THEN
        UPDATE vehicles
        SET 
          asking_price = v_price,
          updated_at = NOW()
        WHERE id = v_vehicle.id;
        
        RETURN QUERY SELECT v_vehicle.id, v_price, v_vehicle.model;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the extraction
SELECT * FROM extract_prices_from_model_names();

