-- Update VIN directly using SQL (bypasses RLS and triggers when run as service role)
-- This updates the vehicle VIN for the 1978 GMC High Sierra

UPDATE vehicles
SET vin = 'TCZ148Z533444',
    updated_at = NOW()
WHERE id = '2b620b41-f53e-440c-aba0-ad61ed41c4a6'
RETURNING id, year, make, model, vin;

