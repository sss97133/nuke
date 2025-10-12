-- Delete all auth.users and dependent data
-- This handles all foreign key dependencies properly

-- ===================================================================
-- STEP 1: DELETE ALL DEPENDENT DATA FIRST
-- ===================================================================

-- Delete from tables that reference profiles or users
DELETE FROM public.engagement_metrics;
DELETE FROM public.vehicles;
DELETE FROM public.timeline_events;
DELETE FROM public.vehicle_images;
DELETE FROM public.skynalysis_analyses;
DELETE FROM public.ai_processors WHERE user_id IS NOT NULL;

-- Delete all profiles (this references auth.users)
DELETE FROM public.profiles;

-- ===================================================================
-- STEP 2: DELETE ALL AUTH USERS
-- ===================================================================

-- This should now work without foreign key violations
DELETE FROM auth.users;

-- ===================================================================
-- STEP 3: VERIFICATION
-- ===================================================================

-- Check that everything is clean
SELECT 'auth.users' as table_name, COUNT(*) as remaining_count FROM auth.users
UNION ALL
SELECT 'profiles' as table_name, COUNT(*) as remaining_count FROM public.profiles
UNION ALL
SELECT 'vehicles' as table_name, COUNT(*) as remaining_count FROM public.vehicles
UNION ALL
SELECT 'engagement_metrics' as table_name, COUNT(*) as remaining_count FROM public.engagement_metrics
UNION ALL
SELECT 'timeline_events' as table_name, COUNT(*) as remaining_count FROM public.timeline_events
UNION ALL
SELECT 'vehicle_images' as table_name, COUNT(*) as remaining_count FROM public.vehicle_images
UNION ALL
SELECT 'skynalysis_analyses' as table_name, COUNT(*) as remaining_count FROM public.skynalysis_analyses;

-- Status message
DO $$
BEGIN
  RAISE NOTICE '✅ All auth.users deleted successfully';
  RAISE NOTICE '✅ All dependent data cleaned up';
  RAISE NOTICE '🎯 Database is now clean and ready for fresh sign-ups';
  RAISE NOTICE '📧 Email confirmation is disabled, so sign-ups should work immediately';
END $$;
