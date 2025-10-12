-- Clean up all test emails that caused bounces
-- This should help restore email sending privileges

-- Delete test users that caused bounces
DELETE FROM public.profiles 
WHERE email LIKE '%test%' 
   OR email LIKE '%trace%' 
   OR email LIKE '%example.com'
   OR email LIKE '%gmail.com' AND email LIKE '%test%'
   OR email IS NULL;

-- Delete corresponding auth users
DELETE FROM auth.users 
WHERE email LIKE '%test%' 
   OR email LIKE '%trace%' 
   OR email LIKE '%example.com'
   OR email LIKE '%gmail.com' AND email LIKE '%test%';

-- Verify cleanup
SELECT COUNT(*) as remaining_profiles FROM public.profiles;
SELECT id, email, created_at FROM public.profiles ORDER BY created_at DESC LIMIT 5;

-- Status message
DO $$
BEGIN
  RAISE NOTICE '✅ Bounced test emails cleaned up';
  RAISE NOTICE '📧 This should help restore email sending privileges';
  RAISE NOTICE '🎯 Ready to test with valid email addresses only';
END $$;
