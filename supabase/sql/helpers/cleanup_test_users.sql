-- Clean up all test users from the database
-- This will delete both auth.users and their corresponding profiles

-- WARNING: This will delete ALL users in the database
-- Only run this in development/testing environments

-- 1. First, delete all profiles (this will cascade properly due to foreign keys)
DELETE FROM public.profiles;

-- 2. Delete all users from auth.users (requires service_role permissions)
-- Note: This might need to be run with elevated permissions
-- You may need to run this part in the Supabase Dashboard with service_role

-- List current users before deletion (for confirmation)
SELECT 
  id, 
  email, 
  created_at,
  email_confirmed_at,
  last_sign_in_at
FROM auth.users 
ORDER BY created_at DESC;

-- If you want to delete specific test users only, use this instead:
-- DELETE FROM auth.users WHERE email LIKE '%test%' OR email LIKE '%trace%' OR email LIKE '%example.com';

-- To delete ALL users (use with caution):
-- DELETE FROM auth.users;

-- Verify cleanup
SELECT COUNT(*) as remaining_profiles FROM public.profiles;
SELECT COUNT(*) as remaining_users FROM auth.users;
