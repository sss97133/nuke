-- EMERGENCY UNDO: Delete the timeline events I just created and restore the original state

-- Step 1: Delete all the timeline events I just created
DELETE FROM timeline_events 
WHERE source = 'photo_documentation'
AND metadata->>'source' = 'proper_photo_timeline';

-- Step 2: Check what's left
SELECT 
    'Remaining Timeline Events' as section,
    COUNT(*) as total_events,
    string_agg(DISTINCT source, ', ') as sources,
    string_agg(DISTINCT event_type, ', ') as event_types
FROM timeline_events;

-- Step 3: Show current state of vehicles
SELECT 
    'Current Vehicle State' as section,
    v.year,
    v.make,
    v.model,
    COUNT(vi.id) as image_count,
    COUNT(te.id) as timeline_count,
    CASE 
        WHEN COUNT(te.id) = 0 THEN '❌ No timeline events'
        WHEN COUNT(vi.id) = COUNT(te.id) THEN '✅ Complete'
        ELSE '⚠️ Partial'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(vi.id) > 0
ORDER BY v.year DESC, v.make, v.model;
