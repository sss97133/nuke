-- Diagnostic script to check database state and RPC functions
-- Run this in Supabase SQL Editor to diagnose the issue

-- 1. Check if RPC functions exist
SELECT 
  routine_name,
  routine_type,
  data_type as return_type,
  routine_definition IS NOT NULL as has_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_user_vehicle_relationships',
    'get_unorganized_photos_optimized',
    'get_photo_library_stats'
  )
ORDER BY routine_name;

-- 2. Check vehicle_images table foreign keys to vehicles
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'vehicle_images'
  AND ccu.table_name = 'vehicles'
ORDER BY tc.constraint_name;

-- 3. Check if vehicle_id is nullable
SELECT 
  column_name,
  is_nullable,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vehicle_images'
  AND column_name IN ('vehicle_id', 'suggested_vehicle_id')
ORDER BY column_name;

-- 4. Check RPC function permissions
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  CASE p.prosecdef
    WHEN true THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END as security_type,
  array_to_string(p.proacl, ', ') as permissions
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_user_vehicle_relationships',
    'get_unorganized_photos_optimized',
    'get_photo_library_stats'
  )
ORDER BY p.proname;

-- 5. Test RPC function call (replace with actual user_id)
-- SELECT get_user_vehicle_relationships('0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid);


