-- Fix Wrong Price Display ($1,800 Issue)

-- STEP 1: Check current price values
SELECT 
  id,
  year, make, model,
  current_value,     -- This is showing $1,800
  asking_price,
  purchase_price,
  sale_price,
  msrp,
  is_for_sale
FROM vehicles 
WHERE current_value = 1800  -- Or use specific vehicle ID
ORDER BY year DESC;

-- STEP 2: Update to correct value
-- Replace 'VEHICLE-ID' with actual UUID
-- Replace 140615 with correct value

UPDATE vehicles 
SET 
  current_value = 140615,  -- Correct estimated value
  updated_at = NOW()
WHERE id = 'VEHICLE-ID';

-- OR if vehicle is for sale with asking price:
UPDATE vehicles 
SET 
  asking_price = 140615,
  is_for_sale = true,
  updated_at = NOW()
WHERE id = 'VEHICLE-ID';

-- STEP 3: Verify the update
SELECT 
  id,
  year, make, model,
  current_value,
  asking_price,
  CASE 
    WHEN is_for_sale AND asking_price IS NOT NULL 
      THEN asking_price 
    WHEN current_value IS NOT NULL 
      THEN current_value 
    ELSE NULL 
  END as "Will Display",
  is_for_sale
FROM vehicles 
WHERE id = 'VEHICLE-ID';

