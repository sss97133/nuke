-- IMMEDIATE FIX: Update 1974 Ford Bronco to correct market value
-- This will make it show $115,000 instead of $10,988

-- Find and update the Bronco
UPDATE vehicles 
SET 
  current_value = 115000,
  updated_at = NOW()
WHERE year = 1974 
  AND make = 'Ford' 
  AND model = 'Bronco'
  AND uploaded_by IN (
    SELECT id FROM auth.users WHERE email LIKE '%skylar%'
  );

-- Record the correction in price history
INSERT INTO vehicle_price_history (vehicle_id, price_type, value, source, confidence, as_of)
SELECT 
  id,
  'current',
  115000,
  'manual_correction',
  85,
  NOW()
FROM vehicles
WHERE year = 1974 
  AND make = 'Ford' 
  AND model = 'Bronco'
  AND uploaded_by IN (
    SELECT id FROM auth.users WHERE email LIKE '%skylar%'
  );

-- Verify the change
SELECT 
  id,
  year,
  make,
  model,
  current_value,
  updated_at
FROM vehicles
WHERE year = 1974 
  AND make = 'Ford' 
  AND model = 'Bronco';

