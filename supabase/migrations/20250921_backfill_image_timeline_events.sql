-- Backfill timeline events for vehicle images
-- This ensures all vehicle images have corresponding timeline events

-- First, let's examine the K5 Blazer structure to understand the working pattern
DO $$
DECLARE
    k5_vehicle_id UUID;
    sample_event RECORD;
BEGIN
    -- Find the K5 Blazer
    SELECT id INTO k5_vehicle_id 
    FROM vehicles 
    WHERE LOWER(make) LIKE '%chev%' AND LOWER(model) LIKE '%k5%' 
    LIMIT 1;
    
    IF k5_vehicle_id IS NOT NULL THEN
        RAISE NOTICE 'Found K5 Blazer ID: %', k5_vehicle_id;
        
        -- Show sample timeline event structure
        SELECT * INTO sample_event
        FROM vehicle_timeline_events 
        WHERE vehicle_id = k5_vehicle_id 
        AND event_type = 'image_upload'
        LIMIT 1;
        
        IF sample_event IS NOT NULL THEN
            RAISE NOTICE 'Sample timeline event structure:';
            RAISE NOTICE 'Event Type: %, Category: %, Title: %', 
                sample_event.event_type, 
                sample_event.event_category, 
                sample_event.title;
            RAISE NOTICE 'Metadata: %', sample_event.metadata;
        END IF;
    END IF;
END $$;

-- Create timeline events for images that don't have them
INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    event_category,
    title,
    description,
    event_date,
    created_at,
    confidence_score,
    metadata
)
SELECT 
    vi.vehicle_id,
    v.user_id,
    'image_upload' as event_type,
    'documentation' as event_category,
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
    COALESCE(vi.created_at, v.created_at) as event_date,
    COALESCE(vi.created_at, v.created_at) as created_at,
    95 as confidence_score,
    jsonb_build_object(
        'image_id', vi.id,
        'image_url', vi.image_url,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'file_size', vi.file_size,
        'mime_type', vi.mime_type,
        'source', 'backfill_migration',
        'backfilled_at', NOW(),
        'original_upload_date', vi.created_at
    ) as metadata
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE NOT EXISTS (
    -- Only create if timeline event doesn't already exist
    SELECT 1 FROM vehicle_timeline_events vte
    WHERE vte.vehicle_id = vi.vehicle_id
    AND vte.event_type = 'image_upload'
    AND vte.metadata->>'image_id' = vi.id::text
)
AND vi.vehicle_id IS NOT NULL
AND v.user_id IS NOT NULL;

-- Report on what was created
DO $$
DECLARE
    total_images INTEGER;
    images_with_timeline INTEGER;
    images_without_timeline INTEGER;
    events_created INTEGER;
BEGIN
    -- Count total images
    SELECT COUNT(*) INTO total_images 
    FROM vehicle_images vi
    JOIN vehicles v ON vi.vehicle_id = v.id;
    
    -- Count images with timeline events
    SELECT COUNT(DISTINCT vi.id) INTO images_with_timeline
    FROM vehicle_images vi
    JOIN vehicles v ON vi.vehicle_id = v.id
    JOIN vehicle_timeline_events vte ON vte.vehicle_id = vi.vehicle_id
    WHERE vte.event_type = 'image_upload'
    AND vte.metadata->>'image_id' = vi.id::text;
    
    -- Count images without timeline events
    images_without_timeline := total_images - images_with_timeline;
    
    -- Count events created in this migration (approximate)
    SELECT COUNT(*) INTO events_created
    FROM vehicle_timeline_events
    WHERE event_type = 'image_upload'
    AND metadata->>'source' = 'backfill_migration'
    AND created_at >= NOW() - INTERVAL '1 minute';
    
    RAISE NOTICE '=== IMAGE TIMELINE BACKFILL REPORT ===';
    RAISE NOTICE 'Total vehicle images: %', total_images;
    RAISE NOTICE 'Images with timeline events: %', images_with_timeline;
    RAISE NOTICE 'Images without timeline events: %', images_without_timeline;
    RAISE NOTICE 'Timeline events created: %', events_created;
    RAISE NOTICE '=====================================';
END $$;

-- Update any timeline events that are missing image references in metadata
UPDATE vehicle_timeline_events 
SET metadata = metadata || jsonb_build_object(
    'image_url', vi.image_url,
    'image_id', vi.id
)
FROM vehicle_images vi
WHERE vehicle_timeline_events.vehicle_id = vi.vehicle_id
AND vehicle_timeline_events.event_type = 'image_upload'
AND vehicle_timeline_events.metadata->>'image_url' = vi.image_url
AND vehicle_timeline_events.metadata->>'image_id' IS NULL;

-- Final verification query
DO $$
DECLARE
    vehicle_record RECORD;
BEGIN
    RAISE NOTICE 'VEHICLE IMAGE TIMELINE STATUS:';
    FOR vehicle_record IN 
        SELECT 
            v.id,
            v.make,
            v.model,
            v.year,
            COUNT(vi.id) as image_count,
            COUNT(vte.id) as timeline_event_count
        FROM vehicles v
        LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
        LEFT JOIN vehicle_timeline_events vte ON v.id = vte.vehicle_id 
            AND vte.event_type = 'image_upload'
        WHERE v.user_id IS NOT NULL
        GROUP BY v.id, v.make, v.model, v.year
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
END $$;
