-- Clear Mock Contribution Data and Reset to Real Values
-- This will fix the 369 mock data issue

-- Clear all existing mock contribution data for skylar williams
DELETE FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Recalculate and insert real contribution data based on actual user activity

-- Insert vehicle creation contributions
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

-- Insert image upload contributions (grouped by date)
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

-- Update profile_stats with correct totals
UPDATE profile_stats SET
  total_contributions = (
    SELECT COALESCE(SUM(contribution_count), 0) 
    FROM user_contributions 
    WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  ),
  updated_at = NOW()
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Verify the results
SELECT 
  'user_contributions' as table_name,
  COUNT(*) as record_count,
  SUM(contribution_count) as total_contributions
FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'

UNION ALL

SELECT 
  'profile_stats' as table_name,
  1 as record_count,
  total_contributions
FROM profile_stats 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Show breakdown by contribution type
SELECT 
  contribution_type,
  COUNT(*) as days_with_activity,
  SUM(contribution_count) as total_count
FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY contribution_type
ORDER BY total_count DESC;
