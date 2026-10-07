-- Comprehensive timeline events backfill for all vehicles
-- This script identifies and fixes missing timeline events across all vehicle profiles

-- First, analyze the scope of the problem
DO $$
DECLARE
    total_vehicles INTEGER;
    vehicles_with_images INTEGER;
    vehicles_with_timeline INTEGER;
    vehicles_missing_timeline INTEGER;
    total_images INTEGER;
    images_with_timeline INTEGER;
    images_missing_timeline INTEGER;
BEGIN
    -- Count total vehicles
    SELECT COUNT(*) INTO total_vehicles FROM vehicles;
    
    -- Count vehicles with images
    SELECT COUNT(DISTINCT vehicle_id) INTO vehicles_with_images 
    FROM vehicle_images;
    
    -- Count vehicles with timeline events
    SELECT COUNT(DISTINCT vehicle_id) INTO vehicles_with_timeline 
    FROM timeline_events;
    
    -- Count vehicles with images but no timeline events
    SELECT COUNT(DISTINCT vi.vehicle_id) INTO vehicles_missing_timeline
    FROM vehicle_images vi
    LEFT JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id
    WHERE te.vehicle_id IS NULL;
    
    -- Count total images
    SELECT COUNT(*) INTO total_images FROM vehicle_images;
    
    -- Count images with timeline events
    SELECT COUNT(DISTINCT vi.id) INTO images_with_timeline
    FROM vehicle_images vi
    JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id
    WHERE te.metadata->>'image_id' = vi.id::text;
    
    -- Count images without timeline events
    images_missing_timeline := total_images - images_with_timeline;
    
    RAISE NOTICE '=== TIMELINE BACKFILL ANALYSIS ===';
    RAISE NOTICE 'Total vehicles: %', total_vehicles;
    RAISE NOTICE 'Vehicles with images: %', vehicles_with_images;
    RAISE NOTICE 'Vehicles with timeline events: %', vehicles_with_timeline;
    RAISE NOTICE 'Vehicles missing timeline events: %', vehicles_missing_timeline;
    RAISE NOTICE '';
    RAISE NOTICE 'Total images: %', total_images;
    RAISE NOTICE 'Images with timeline events: %', images_with_timeline;
    RAISE NOTICE 'Images missing timeline events: %', images_missing_timeline;
    RAISE NOTICE '=====================================';
END $$;

-- Show specific vehicles that need backfill
DO $$
DECLARE
    vehicle_record RECORD;
BEGIN
    RAISE NOTICE 'VEHICLES NEEDING TIMELINE BACKFILL:';
    FOR vehicle_record IN 
        SELECT 
            v.id,
            v.year,
            v.make,
            v.model,
            COUNT(vi.id) as image_count,
            COUNT(te.id) as timeline_count
        FROM vehicles v
        JOIN vehicle_images vi ON v.id = vi.vehicle_id
        LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
            AND te.metadata->>'image_id' IS NOT NULL
        GROUP BY v.id, v.year, v.make, v.model
        HAVING COUNT(te.id) = 0
        ORDER BY COUNT(vi.id) DESC
    LOOP
        RAISE NOTICE '% % % (ID: %) - % images, % timeline events', 
            vehicle_record.year,
            vehicle_record.make, 
            vehicle_record.model,
            vehicle_record.id,
            vehicle_record.image_count,
            vehicle_record.timeline_count;
    END LOOP;
END $$;

-- Backfill timeline events for ALL vehicles with images but no timeline events
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    title,
    description,
    event_date,
    metadata,
    image_urls,
    source
)
SELECT 
    vi.vehicle_id,
    v.user_id,
    'maintenance' as event_type,
    CASE 
        WHEN vi.is_primary THEN 'Primary Image Upload'
        WHEN vi.category IS NOT NULL THEN 'Image Upload - ' || INITCAP(vi.category)
        ELSE 'Image Upload'
    END as title,
    CASE 
        WHEN vi.is_primary THEN 'Primary vehicle image uploaded to profile'
        WHEN vi.category IS NOT NULL THEN 'Image uploaded to ' || vi.category || ' category'
        ELSE 'Image uploaded to vehicle profile'
    END as description,
    COALESCE(vi.created_at::date, v.created_at::date) as event_date,
    jsonb_build_object(
        'image_id', vi.id,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'file_size', vi.file_size,
        'mime_type', vi.mime_type,
        'source', 'bulk_backfill',
        'backfilled_at', NOW()
    ) as metadata,
    ARRAY[vi.image_url] as image_urls,
    'user_input' as source
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE NOT EXISTS (
    SELECT 1 FROM timeline_events te
    WHERE te.vehicle_id = vi.vehicle_id
    AND te.metadata->>'image_id' = vi.id::text
)
AND v.user_id IS NOT NULL;

-- Report results
DO $$
DECLARE
    events_created INTEGER;
    vehicle_record RECORD;
BEGIN
    -- Count events created in this run
    SELECT COUNT(*) INTO events_created
    FROM timeline_events
    WHERE metadata->>'source' = 'bulk_backfill'
    AND created_at >= NOW() - INTERVAL '1 minute';
    
    RAISE NOTICE '=== BACKFILL RESULTS ===';
    RAISE NOTICE 'Timeline events created: %', events_created;
    RAISE NOTICE '';
    
    -- Show updated status for each vehicle
    RAISE NOTICE 'UPDATED VEHICLE STATUS:';
    FOR vehicle_record IN 
        SELECT 
            v.id,
            v.year,
            v.make,
            v.model,
            COUNT(vi.id) as image_count,
            COUNT(DISTINCT te.id) as timeline_event_count
        FROM vehicles v
        LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
        LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
            AND te.metadata->>'image_id' IS NOT NULL
        WHERE v.user_id IS NOT NULL
        GROUP BY v.id, v.year, v.make, v.model
        HAVING COUNT(vi.id) > 0
        ORDER BY v.year DESC, v.make, v.model
    LOOP
        RAISE NOTICE '% % % - Images: %, Timeline Events: %', 
            vehicle_record.year,
            vehicle_record.make, 
            vehicle_record.model,
            vehicle_record.image_count,
            vehicle_record.timeline_event_count;
    END LOOP;
    
    RAISE NOTICE '========================';
END $$;

-- Final verification - show any remaining issues
DO $$
DECLARE
    remaining_issues INTEGER;
BEGIN
    SELECT COUNT(DISTINCT vi.vehicle_id) INTO remaining_issues
    FROM vehicle_images vi
    LEFT JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id 
        AND te.metadata->>'image_id' = vi.id::text
    WHERE te.id IS NULL;
    
    IF remaining_issues > 0 THEN
        RAISE NOTICE 'WARNING: % vehicles still have images without timeline events', remaining_issues;
    ELSE
        RAISE NOTICE 'SUCCESS: All vehicles with images now have timeline events';
    END IF;
END $$;
