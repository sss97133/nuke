-- Fix primary image for La Salle Coupe

-- 1. Find the vehicle
SELECT id, make, model, year 
FROM vehicles 
WHERE make = 'La Salle' 
AND model = 'Coupe' 
AND year = 1939
LIMIT 1;

-- 2. Check images for this vehicle (use the ID from above)
-- Replace VEHICLE_ID with actual ID from step 1
SELECT id, file_name, is_primary, created_at 
FROM vehicle_images 
WHERE vehicle_id = (
    SELECT id FROM vehicles 
    WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
    LIMIT 1
)
ORDER BY created_at;

-- 3. Set the first image as primary if none are primary
UPDATE vehicle_images 
SET is_primary = true
WHERE id = (
    SELECT id 
    FROM vehicle_images 
    WHERE vehicle_id = (
        SELECT id FROM vehicles 
        WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
        LIMIT 1
    )
    AND is_primary IS NOT true
    ORDER BY created_at 
    LIMIT 1
);

-- 4. Verify primary image is set
SELECT id, file_name, is_primary 
FROM vehicle_images 
WHERE vehicle_id = (
    SELECT id FROM vehicles 
    WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
    LIMIT 1
)
AND is_primary = true;
