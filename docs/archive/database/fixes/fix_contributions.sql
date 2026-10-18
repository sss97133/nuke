-- Check what's currently in the user_contributions table
SELECT 
    user_id,
    contribution_date,
    contribution_type,
    contribution_count,
    COUNT(*) as records,
    SUM(contribution_count) as total_contributions
FROM user_contributions
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY user_id, contribution_date, contribution_type, contribution_count
ORDER BY contribution_date DESC
LIMIT 20;

-- Check total contributions
SELECT 
    COUNT(*) as total_records,
    SUM(contribution_count) as total_contributions,
    MIN(contribution_date) as earliest_date,
    MAX(contribution_date) as latest_date
FROM user_contributions
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- CLEAR ALL FAKE/INACCURATE CONTRIBUTIONS
-- This will force the system to use real timeline events instead
DELETE FROM user_contributions
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Verify they're deleted
SELECT COUNT(*) as remaining_contributions
FROM user_contributions
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Now check the real data sources that should be used instead:

-- Check vehicle timeline events (real contributions)
SELECT 
    DATE(event_date) as date,
    COUNT(*) as event_count,
    STRING_AGG(event_type, ', ') as event_types
FROM vehicle_timeline_events
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY DATE(event_date)
ORDER BY date DESC
LIMIT 20;

-- Check vehicle images (real contributions) 
SELECT 
    DATE(created_at) as upload_date,
    COUNT(*) as image_count
FROM vehicle_images
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY DATE(created_at)
ORDER BY upload_date DESC
LIMIT 20;
