-- Check existing timeline events for this vehicle
SELECT 
    id,
    event_type, 
    event_date, 
    title, 
    description,
    created_at
FROM vehicle_timeline_events 
WHERE vehicle_id = '92a39d4c-abd1-47b1-971d-dffe173c5793'
ORDER BY event_date DESC
LIMIT 10;

-- Check if images exist for this vehicle
SELECT COUNT(*) as image_count
FROM vehicle_images
WHERE vehicle_id = '92a39d4c-abd1-47b1-971d-dffe173c5793';

-- Manually insert a test batch upload event
INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    event_date,
    title,
    description,
    metadata,
    created_at,
    updated_at
) VALUES (
    '92a39d4c-abd1-47b1-971d-dffe173c5793',
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'batch_image_upload',
    '2025-09-17',
    '30 Photos Added',
    'Batch upload of 30 restoration images from today',
    '{"count": 30, "source": "RobustImageUpload", "contributor_role": "restorer"}'::jsonb,
    NOW(),
    NOW()
);

-- Also create one for historical upload
INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    event_date,
    title,
    description,
    metadata,
    created_at,
    updated_at
) VALUES (
    '92a39d4c-abd1-47b1-971d-dffe173c5793',
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'restoration',
    '2022-06-15',
    'Major Restoration Work',
    'Comprehensive restoration including 400+ documentation photos',
    '{"work_type": "full_restoration", "images": 400}'::jsonb,
    NOW(),
    NOW()
);

-- Check the results
SELECT 
    id,
    event_type, 
    event_date, 
    title, 
    description,
    metadata
FROM vehicle_timeline_events 
WHERE vehicle_id = '92a39d4c-abd1-47b1-971d-dffe173c5793'
ORDER BY event_date DESC;
