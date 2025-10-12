-- Check VIN data in vehicles table
SELECT 
    id,
    make,
    model,
    year,
    vin,
    LENGTH(vin) as vin_length,
    CASE 
        WHEN LENGTH(vin) = 17 THEN 'Valid VIN'
        WHEN LENGTH(vin) < 17 THEN 'Too Short'
        WHEN LENGTH(vin) > 17 THEN 'Too Long'
        WHEN vin IS NULL THEN 'No VIN'
        ELSE 'Other'
    END as vin_status
FROM vehicles
ORDER BY created_at DESC
LIMIT 10;

-- Count VIN issues
SELECT 
    CASE 
        WHEN vin IS NULL OR vin = '' THEN 'Empty'
        WHEN LENGTH(vin) = 17 THEN 'Valid (17 chars)'
        WHEN LENGTH(vin) < 17 THEN 'Too Short (<17)'
        WHEN LENGTH(vin) > 17 THEN 'Too Long (>17)'
        ELSE 'Other'
    END as vin_category,
    COUNT(*) as count
FROM vehicles
GROUP BY vin_category
ORDER BY count DESC;
