-- Diagnose what's different between K5 Blazer (working) and other vehicles (broken)

-- Step 1: Find the K5 Blazer vehicle ID
SELECT 
    'K5 Blazer Info' as section,
    id as vehicle_id,
    make,
    model,
    year
FROM vehicles 
WHERE LOWER(make) LIKE '%chev%' AND LOWER(model) LIKE '%k5%'
LIMIT 1;

-- Step 2: Check K5 Blazer's images
WITH k5_vehicle AS (
    SELECT id FROM vehicles 
    WHERE LOWER(make) LIKE '%chev%' AND LOWER(model) LIKE '%k5%'
    LIMIT 1
)
SELECT 
    'K5 Blazer Images' as section,
    COUNT(*) as total_images,
    COUNT(CASE WHEN is_primary THEN 1 END) as primary_images,
    COUNT(CASE WHEN category IS NOT NULL THEN 1 END) as categorized_images,
    string_agg(DISTINCT category, ', ') as categories
FROM vehicle_images vi
JOIN k5_vehicle kv ON vi.vehicle_id = kv.id;

-- Step 3: Check another vehicle's images (compare)
WITH other_vehicle AS (
    SELECT id, make, model, year FROM vehicles 
    WHERE NOT (LOWER(make) LIKE '%chev%' AND LOWER(model) LIKE '%k5%')
    AND user_id IS NOT NULL
    LIMIT 1
)
SELECT 
    'Other Vehicle (' || MAX(ov.make) || ' ' || MAX(ov.model) || ')' as section,
    COUNT(vi.*) as total_images,
    COUNT(CASE WHEN vi.is_primary THEN 1 END) as primary_images,
    COUNT(CASE WHEN vi.category IS NOT NULL THEN 1 END) as categorized_images,
    string_agg(DISTINCT vi.category, ', ') as categories
FROM vehicle_images vi
JOIN other_vehicle ov ON vi.vehicle_id = ov.id;

-- Step 4: Check timeline events for both
WITH k5_vehicle AS (
    SELECT id FROM vehicles 
    WHERE LOWER(make) LIKE '%chev%' AND LOWER(model) LIKE '%k5%'
    LIMIT 1
)
SELECT 
    'K5 Timeline Events' as section,
    COUNT(*) as total_events,
    COUNT(CASE WHEN event_type = 'maintenance' THEN 1 END) as maintenance_events,
    string_agg(DISTINCT event_type, ', ') as event_types
FROM timeline_events te
JOIN k5_vehicle kv ON te.vehicle_id = kv.id;

-- Step 5: Check what's actually broken - sample a few vehicles
SELECT 
    'Vehicle Comparison' as section,
    v.year,
    v.make,
    v.model,
    COUNT(vi.id) as image_count,
    COUNT(CASE WHEN vi.is_primary THEN 1 END) as primary_count,
    COUNT(te.id) as timeline_count,
    CASE 
        WHEN COUNT(vi.id) = 0 THEN '❌ No images'
        WHEN COUNT(CASE WHEN vi.is_primary THEN 1 END) = 0 THEN '❌ No primary image'
        WHEN COUNT(te.id) = 0 THEN '❌ No timeline events'
        ELSE '✅ Looks good'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
ORDER BY v.year DESC, v.make, v.model
LIMIT 10;
