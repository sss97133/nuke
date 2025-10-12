-- Fix La Salle vehicle display issues

-- 1. Set primary image for La Salle
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
    ORDER BY created_at
    LIMIT 1
);

-- 2. Verify images exist and primary is set
SELECT 
    vi.id,
    vi.file_name,
    vi.is_primary,
    vi.created_at,
    v.make || ' ' || v.model as vehicle
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE v.make = 'La Salle' 
AND v.model = 'Coupe' 
AND v.year = 1939
ORDER BY vi.created_at;
