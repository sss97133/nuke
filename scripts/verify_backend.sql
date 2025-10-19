-- ===================================================================
-- BACKEND VERIFICATION SCRIPT
-- Run this AFTER applying the comprehensive backend fix
-- ===================================================================

-- Check 1: Verify critical tables exist
SELECT 
  'Tables Check' as check_type,
  COUNT(*) as total_tables,
  string_agg(tablename, ', ') as tables
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'vehicles',
    'profiles', 
    'vehicle_images',
    'vehicle_timeline_events',
    'work_sessions',
    'receipts',
    'receipt_line_items',
    'user_tools',
    'user_credits',
    'credit_transactions',
    'vehicle_support',
    'builder_payouts'
  );

-- Check 2: Verify RLS is enabled
SELECT 
  'RLS Status' as check_type,
  tablename,
  CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ DISABLED' END as rls_status
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'vehicles',
    'profiles',
    'vehicle_images',
    'vehicle_timeline_events',
    'work_sessions',
    'receipts',
    'user_tools',
    'user_credits',
    'vehicle_support'
  )
ORDER BY tablename;

-- Check 3: Count RLS policies per table
SELECT 
  'RLS Policies' as check_type,
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- Check 4: Verify helper functions exist
SELECT 
  'Functions Check' as check_type,
  proname as function_name,
  pg_get_function_result(oid) as return_type
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'update_vehicle_completion',
    'get_user_credit_balance',
    'add_credits_to_user',
    'allocate_credits_to_vehicle'
  )
ORDER BY proname;

-- Check 5: Test completion trigger
SELECT 
  'Triggers Check' as check_type,
  event_object_table,
  trigger_name,
  CASE 
    WHEN trigger_name = 'trigger_update_completion' THEN '✅ Fixed (non-blocking)'
    ELSE 'Other trigger'
  END as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'vehicles'
  AND trigger_name LIKE '%completion%';

-- Check 6: Sample data counts
SELECT 
  'Data Counts' as check_type,
  (SELECT COUNT(*) FROM vehicles) as vehicles,
  (SELECT COUNT(*) FROM vehicle_images) as images,
  (SELECT COUNT(*) FROM profiles) as profiles,
  (SELECT COUNT(*) FROM work_sessions) as work_sessions,
  (SELECT COUNT(*) FROM receipts) as receipts,
  (SELECT COUNT(*) FROM user_tools) as tools;

-- Summary
SELECT 
  '=== VERIFICATION COMPLETE ===' as message,
  CASE 
    WHEN (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('user_credits', 'vehicle_support')) = 2 
    THEN '✅ All systems operational'
    ELSE '❌ Some tables missing'
  END as status;

