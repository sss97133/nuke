-- Clean All Mock Data from Database
-- This will remove fake/test data and ensure only real user data remains

-- 1. Clear mock contributions (the 369 fake entries)
DELETE FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
AND contribution_count > 50; -- Mock data has unrealistic high counts

-- 2. Remove any test vehicles with obvious test patterns
DELETE FROM vehicles 
WHERE vin LIKE 'TEST%' 
OR vin LIKE 'MOCK%'
OR make = 'TestMake'
OR model = 'TestModel';

-- 3. Remove test users (be careful with this)
DELETE FROM profiles 
WHERE email LIKE 'test%@%'
OR email LIKE '%@test.com'
OR username LIKE 'test%';

-- 4. Clean up any timeline events for non-existent vehicles
DELETE FROM vehicle_timeline_events 
WHERE vehicle_id NOT IN (SELECT id FROM vehicles);

-- 5. Clean up orphaned images
DELETE FROM vehicle_images 
WHERE vehicle_id NOT IN (SELECT id FROM vehicles);

-- 6. Reset profile stats to match real data
UPDATE profile_stats SET
    total_contributions = (
        SELECT COALESCE(SUM(contribution_count), 0) 
        FROM user_contributions 
        WHERE user_id = profile_stats.user_id
    ),
    total_vehicles = (
        SELECT COUNT(*) 
        FROM vehicles 
        WHERE user_id = profile_stats.user_id
    ),
    total_images = (
        SELECT COUNT(*) 
        FROM vehicle_images 
        WHERE user_id = profile_stats.user_id
    ),
    updated_at = NOW()
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- 7. Rebuild real contributions from actual user activity
-- First, clear existing contributions for the main user
DELETE FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Rebuild from real vehicle data
INSERT INTO user_contributions (
    user_id,
    contribution_date,
    contribution_type,
    contribution_count,
    related_vehicle_id,
    metadata
)
SELECT 
    user_id,
    created_at::date as contribution_date,
    'vehicle_data' as contribution_type,
    1 as contribution_count,
    id as related_vehicle_id,
    jsonb_build_object(
        'action', 'added_vehicle',
        'vehicle_info', jsonb_build_object(
            'make', make,
            'model', model,
            'year', year
        )
    ) as metadata
FROM vehicles 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Rebuild from real image data (grouped by date)
INSERT INTO user_contributions (
    user_id,
    contribution_date,
    contribution_type,
    contribution_count,
    metadata
)
SELECT 
    user_id,
    created_at::date as contribution_date,
    'image_upload' as contribution_type,
    COUNT(*) as contribution_count,
    jsonb_build_object(
        'action', 'image_uploaded',
        'image_count', COUNT(*)
    ) as metadata
FROM vehicle_images 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY user_id, created_at::date;

-- Verify cleanup results
SELECT 'Cleanup Results' as section, '' as details
UNION ALL
SELECT 'Real Contributions', COALESCE(SUM(contribution_count), 0)::text 
FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
UNION ALL
SELECT 'Total Vehicles', COUNT(*)::text 
FROM vehicles WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
UNION ALL
SELECT 'Total Images', COUNT(*)::text 
FROM vehicle_images WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
UNION ALL
SELECT 'Profile Stats Match', 
    CASE WHEN ps.total_contributions = COALESCE(uc.total, 0) 
    THEN '✅ MATCH' ELSE '❌ MISMATCH' END
FROM profile_stats ps
LEFT JOIN (
    SELECT user_id, SUM(contribution_count) as total 
    FROM user_contributions 
    WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
    GROUP BY user_id
) uc ON ps.user_id = uc.user_id
WHERE ps.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';
