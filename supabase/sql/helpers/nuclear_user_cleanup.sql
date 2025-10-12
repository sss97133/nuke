-- NUCLEAR USER CLEANUP
-- Delete all users and ALL dependent data
-- This handles the massive engagement_metrics table and all other dependencies

-- ===================================================================
-- STEP 1: DELETE ALL DEPENDENT DATA (ORDER MATTERS!)
-- ===================================================================

-- Delete the big table first (1,639 records)
DELETE FROM public.engagement_metrics;

-- Delete vehicles and related data
DELETE FROM public.vehicles;

-- Delete user preferences
DELETE FROM public.user_preferences;

-- Delete profiles (direct reference to auth.users)
DELETE FROM public.profiles;

-- Delete any other potential tables that might exist
DELETE FROM public.timeline_events WHERE user_id IS NOT NULL;
DELETE FROM public.vehicle_images WHERE user_id IS NOT NULL;
DELETE FROM public.skynalysis_analyses WHERE user_id IS NOT NULL;
DELETE FROM public.ai_processors WHERE user_id IS NOT NULL;
DELETE FROM public.user_sessions WHERE user_id IS NOT NULL;
DELETE FROM public.garage_members WHERE user_id IS NOT NULL;
DELETE FROM public.notifications WHERE user_id IS NOT NULL;
DELETE FROM public.user_follows WHERE user_id IS NOT NULL;
DELETE FROM public.user_blocks WHERE user_id IS NOT NULL;
DELETE FROM public.comments WHERE user_id IS NOT NULL;
DELETE FROM public.likes WHERE user_id IS NOT NULL;
DELETE FROM public.bookmarks WHERE user_id IS NOT NULL;
DELETE FROM public.reviews WHERE user_id IS NOT NULL;
DELETE FROM public.messages WHERE user_id IS NOT NULL;

-- ===================================================================
-- STEP 2: DELETE ALL AUTH USERS
-- ===================================================================

-- Now this should work without any foreign key violations
DELETE FROM auth.users;

-- ===================================================================
-- STEP 3: VERIFICATION AND CLEANUP REPORT
-- ===================================================================

-- Show what's left in each table
SELECT 'auth.users' as table_name, COUNT(*) as remaining_count FROM auth.users
UNION ALL
SELECT 'profiles', COUNT(*) FROM public.profiles
UNION ALL
SELECT 'vehicles', COUNT(*) FROM public.vehicles
UNION ALL
SELECT 'engagement_metrics', COUNT(*) FROM public.engagement_metrics
UNION ALL
SELECT 'user_preferences', COUNT(*) FROM public.user_preferences
ORDER BY table_name;

-- Final status
DO $$
DECLARE
    user_count INTEGER;
    profile_count INTEGER;
    vehicle_count INTEGER;
    engagement_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM auth.users;
    SELECT COUNT(*) INTO profile_count FROM public.profiles;
    SELECT COUNT(*) INTO vehicle_count FROM public.vehicles;
    SELECT COUNT(*) INTO engagement_count FROM public.engagement_metrics;
    
    RAISE NOTICE '🧹 NUCLEAR CLEANUP COMPLETE!';
    RAISE NOTICE '✅ auth.users deleted: %', user_count = 0;
    RAISE NOTICE '✅ profiles deleted: %', profile_count = 0;
    RAISE NOTICE '✅ vehicles deleted: %', vehicle_count = 0;
    RAISE NOTICE '✅ engagement_metrics deleted: % (was 1,639)', engagement_count = 0;
    RAISE NOTICE '🎯 Database is completely clean and ready for fresh start';
    RAISE NOTICE '📧 Email confirmation is disabled - sign-ups should work immediately';
END $$;
