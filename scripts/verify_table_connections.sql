-- Comprehensive table connection verification

-- 1) Check shops and related tables
SELECT 'shops' as table_check, COUNT(*) as record_count FROM shops
UNION ALL
SELECT 'shop_members', COUNT(*) FROM shop_members
UNION ALL
SELECT 'shop_invitations', COUNT(*) FROM shop_invitations
UNION ALL
SELECT 'shop_locations', COUNT(*) FROM shop_locations
UNION ALL
SELECT 'shop_licenses', COUNT(*) FROM shop_licenses
UNION ALL
SELECT 'shop_departments', COUNT(*) FROM shop_departments
UNION ALL
SELECT 'department_presets', COUNT(*) FROM department_presets
UNION ALL
SELECT 'contributor_onboarding', COUNT(*) FROM contributor_onboarding
UNION ALL
SELECT 'contributor_documentation', COUNT(*) FROM contributor_documentation
UNION ALL
SELECT 'vehicle_contributor_roles', COUNT(*) FROM vehicle_contributor_roles
UNION ALL
SELECT 'vehicle_contributors', COUNT(*) FROM vehicle_contributors
UNION ALL
SELECT 'vehicles', COUNT(*) FROM vehicles
UNION ALL
SELECT 'admin_users', COUNT(*) FROM admin_users
UNION ALL
SELECT 'admin_action_log', COUNT(*) FROM admin_action_log;

-- 2) Test foreign key relationships
SELECT 
  'FK Check: shops -> auth.users' as relationship_check,
  COUNT(*) as valid_count
FROM shops s
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.owner_user_id);

-- 3) Test shop_members foreign keys
SELECT 
  'FK Check: shop_members -> shops' as relationship_check,
  COUNT(*) as valid_count
FROM shop_members sm
WHERE EXISTS (SELECT 1 FROM shops s WHERE s.id = sm.shop_id);

-- 4) Test vehicle_contributor_roles foreign keys
SELECT 
  'FK Check: vehicle_contributor_roles -> vehicles' as relationship_check,
  COUNT(*) as valid_count
FROM vehicle_contributor_roles vcr
WHERE EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vcr.vehicle_id);

-- 5) Test department presets by business type
SELECT 
  business_type,
  COUNT(*) as preset_count,
  array_agg(department_name ORDER BY department_name) as departments
FROM department_presets
GROUP BY business_type
ORDER BY business_type;

-- 6) Check RLS policies are enabled
SELECT 
  schemaname,
  tablename,
  CASE WHEN rowsecurity THEN 'RLS Enabled' ELSE 'RLS Disabled' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'shops', 'shop_members', 'shop_invitations', 'shop_locations', 
    'shop_licenses', 'shop_departments', 'department_presets',
    'contributor_onboarding', 'contributor_documentation', 
    'vehicle_contributor_roles'
  )
ORDER BY tablename;
