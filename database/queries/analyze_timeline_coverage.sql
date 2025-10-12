-- Quick analysis of timeline coverage across all vehicles
-- Run this first to understand the scope before backfilling

-- Find the roadster and other vehicles with missing timeline events
SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    COUNT(vi.id) as total_images,
    COUNT(CASE WHEN te.metadata->>'image_id' IS NOT NULL THEN 1 END) as images_with_timeline,
    COUNT(vi.id) - COUNT(CASE WHEN te.metadata->>'image_id' IS NOT NULL THEN 1 END) as missing_timeline_events,
    CASE 
        WHEN COUNT(vi.id) = 0 THEN 'No Images'
        WHEN COUNT(CASE WHEN te.metadata->>'image_id' IS NOT NULL THEN 1 END) = 0 THEN 'No Timeline Events'
        WHEN COUNT(vi.id) = COUNT(CASE WHEN te.metadata->>'image_id' IS NOT NULL THEN 1 END) THEN 'Complete'
        ELSE 'Partial Coverage'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id 
    AND te.metadata->>'image_id' = vi.id::text
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
ORDER BY 
    CASE 
        WHEN LOWER(v.model) LIKE '%roadster%' THEN 0
        ELSE 1
    END,
    COUNT(vi.id) DESC;

-- Summary statistics
SELECT 
    COUNT(*) as total_vehicles,
    COUNT(CASE WHEN image_count > 0 THEN 1 END) as vehicles_with_images,
    COUNT(CASE WHEN timeline_count = 0 AND image_count > 0 THEN 1 END) as vehicles_needing_backfill,
    SUM(image_count) as total_images,
    SUM(timeline_count) as total_timeline_events,
    SUM(image_count) - SUM(timeline_count) as missing_timeline_events
FROM (
    SELECT 
        v.id,
        COUNT(vi.id) as image_count,
        COUNT(CASE WHEN te.metadata->>'image_id' IS NOT NULL THEN 1 END) as timeline_count
    FROM vehicles v
    LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
    LEFT JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id 
        AND te.metadata->>'image_id' = vi.id::text
    WHERE v.user_id IS NOT NULL
    GROUP BY v.id
) stats;
