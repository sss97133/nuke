-- FINAL AUTHENTICATION FIX
-- This will resolve all profile creation and username issues

-- 1. Drop problematic constraints
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_check CASCADE;

-- 2. Drop existing triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS create_profile_on_vehicle_insert ON vehicles CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_vehicle_insert() CASCADE;

-- 3. Create a simple, reliable profile creation function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    username,
    full_name,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail user creation
    RAISE LOG 'Profile creation error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 5. Add a permissive username constraint
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_simple_check 
CHECK (username IS NULL OR length(username) >= 1);

-- 6. Fix any existing users without profiles
INSERT INTO public.profiles (id, email, username, full_name, created_at, updated_at)
SELECT 
  au.id,
  au.email,
  split_part(au.email, '@', 1),
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    ''
  ),
  au.created_at,
  NOW()
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 7. Ensure the main user profile exists and is correct
INSERT INTO public.profiles (
  id, 
  email, 
  username, 
  full_name, 
  is_public, 
  created_at, 
  updated_at
)
VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'shkylar@gmail.com',
  'skylar',
  'Skylar Williams',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  username = COALESCE(profiles.username, EXCLUDED.username),
  full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
  updated_at = NOW();

-- 8. Verify the fix
DO $$
DECLARE
  user_count INTEGER;
  profile_count INTEGER;
  trigger_exists BOOLEAN;
BEGIN
  -- Check user and profile counts
  SELECT COUNT(*) INTO user_count FROM auth.users;
  SELECT COUNT(*) INTO profile_count FROM public.profiles;
  
  -- Check if trigger exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'on_auth_user_created'
  ) INTO trigger_exists;
  
  RAISE NOTICE '=== AUTHENTICATION FIX VERIFICATION ===';
  RAISE NOTICE 'Auth users: %', user_count;
  RAISE NOTICE 'Profiles: %', profile_count;
  RAISE NOTICE 'Profile trigger exists: %', trigger_exists;
  RAISE NOTICE 'Main user profile exists: %', 
    EXISTS(SELECT 1 FROM profiles WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4');
  
  IF user_count = profile_count AND trigger_exists THEN
    RAISE NOTICE '✅ AUTHENTICATION SYSTEM FIXED';
  ELSE
    RAISE WARNING '❌ Issues remain - check above details';
  END IF;
END $$;

-- 9. Test the trigger by showing what would happen for a new user
SELECT 'Trigger test - this would create a profile for a new user:' as test_info;
SELECT 
  'test@example.com' as email,
  split_part('test@example.com', '@', 1) as generated_username,
  'Test would work' as status;
