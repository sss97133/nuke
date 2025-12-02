-- Update BaT vehicle prices from skylar's BaT profile
-- Source: https://bringatrailer.com/member/skylarwilliams/

-- 1995 K2500 Suburban - Sold for $16,250
UPDATE vehicles 
SET current_value = 16250, sale_price = 16250
WHERE (year = 1995 AND make ILIKE '%chev%' AND model ILIKE '%suburban%' AND model ILIKE '%2500%')
  AND (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4');

-- 1997 Lexus LX450 - Sold for $13,750
UPDATE vehicles
SET current_value = 13750, sale_price = 13750
WHERE year = 1997 AND make ILIKE '%lexus%' AND model ILIKE '%lx%'
  AND (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4');

-- 1932 Ford Roadster - Bid to $75,000
UPDATE vehicles
SET current_value = 75000
WHERE year = 1932 AND make ILIKE '%ford%' AND model ILIKE '%roadster%'
  AND (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4');

-- 1932 Ford Roadster (duplicate if exists) - Bid to $64,000
UPDATE vehicles
SET current_value = 64000
WHERE year = 1932 AND make ILIKE '%ford%' AND model ILIKE '%roadster%'
  AND current_value = 0
  AND (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' OR uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4');

SELECT 'Updated BaT vehicle prices from skylar BaT profile';

