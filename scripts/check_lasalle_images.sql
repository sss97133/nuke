-- Check La Salle vehicle and its images

-- 1. Get the vehicle ID
SELECT id, make, model, year, user_id 
FROM vehicles 
WHERE make = 'La Salle' 
AND model = 'Coupe' 
AND year = 1939;

-- 2. Check all images for this vehicle
SELECT 
    id,
    file_name,
    is_primary,
    created_at,
    user_id,
    latitude,
    longitude
FROM vehicle_images 
WHERE vehicle_id = (
    SELECT id FROM vehicles 
    WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
    LIMIT 1
)
ORDER BY created_at;

-- 3. Make sure at least one image is marked as primary
UPDATE vehicle_images 
SET is_primary = true
WHERE id IN (
    SELECT id 
    FROM vehicle_images 
    WHERE vehicle_id = (
        SELECT id FROM vehicles 
        WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
        LIMIT 1
    )
    ORDER BY created_at
    LIMIT 1
)
AND NOT EXISTS (
    SELECT 1 FROM vehicle_images 
    WHERE vehicle_id = (
        SELECT id FROM vehicles 
        WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
        LIMIT 1
    )
    AND is_primary = true
);

-- 4. Verify a primary image exists
SELECT 'Primary image set' as status, COUNT(*) as count
FROM vehicle_images 
WHERE vehicle_id = (
    SELECT id FROM vehicles 
    WHERE make = 'La Salle' AND model = 'Coupe' AND year = 1939
    LIMIT 1
)
AND is_primary = true;
