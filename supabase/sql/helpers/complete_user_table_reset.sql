-- COMPLETE USER TABLE RESET
-- This drops and recreates both auth.users and public.profiles tables
-- WARNING: This will destroy ALL user data permanently

-- ===================================================================
-- STEP 1: DROP EXISTING STRUCTURES
-- ===================================================================

-- Drop triggers first (try all possible names)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS create_profile ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user_trigger ON auth.users;

-- Drop functions with CASCADE to handle dependencies
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Drop RLS policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;

-- Drop the profiles table completely
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Clean up all tables that reference auth.users (foreign key dependencies)
-- This prevents foreign key constraint violations when deleting users
DELETE FROM public.engagement_metrics WHERE user_id IS NOT NULL;
DELETE FROM public.vehicles WHERE user_id IS NOT NULL;
DELETE FROM public.timeline_events WHERE user_id IS NOT NULL;
DELETE FROM public.vehicle_images WHERE user_id IS NOT NULL;
DELETE FROM public.skynalysis_analyses WHERE user_id IS NOT NULL;
DELETE FROM public.ai_processors WHERE user_id IS NOT NULL;

-- Note: We cannot drop auth.users as it's managed by Supabase
-- Instead, we'll delete all data from it after cleaning dependencies
DELETE FROM auth.users;

-- ===================================================================
-- STEP 2: RECREATE PROFILES TABLE
-- ===================================================================

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  username TEXT UNIQUE,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  user_type TEXT DEFAULT 'user',
  reputation_score INTEGER DEFAULT 0,
  social_links JSONB DEFAULT '{}',
  streaming_links JSONB DEFAULT '{}',
  home_location TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,
  skills JSONB DEFAULT '[]',
  active_garage_id UUID,
  default_garage_id UUID,
  ai_analysis JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================================
-- STEP 3: ENABLE RLS AND CREATE POLICIES
-- ===================================================================

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Policy: Allow inserts for new user creation (used by trigger)
CREATE POLICY "Enable insert for authenticated users only" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- ===================================================================
-- STEP 4: CREATE TRIGGER FUNCTION
-- ===================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert a new profile for the newly created user
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NOW(),
    NOW()
  );
  
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log the error but don't fail the user creation
    RAISE LOG 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ===================================================================
-- STEP 5: CREATE TRIGGER
-- ===================================================================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===================================================================
-- STEP 6: GRANT PERMISSIONS
-- ===================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Grant permissions on profiles table
GRANT ALL ON public.profiles TO postgres, anon, authenticated, service_role;

-- Grant execute on function
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, anon, authenticated, service_role;

-- ===================================================================
-- STEP 7: VERIFICATION
-- ===================================================================

-- Verify table was created
SELECT COUNT(*) as profile_count FROM public.profiles;

-- Verify RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'profiles';

-- Verify policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'profiles';

-- Verify trigger exists
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'users' AND trigger_schema = 'auth';

-- Final status
DO $$
BEGIN
  RAISE NOTICE '✅ Complete user table reset completed successfully!';
  RAISE NOTICE '✅ profiles table recreated with proper structure';
  RAISE NOTICE '✅ RLS policies applied';
  RAISE NOTICE '✅ Trigger function created and applied';
  RAISE NOTICE '✅ All permissions granted';
  RAISE NOTICE '🎯 Ready for fresh user sign-ups!';
END $$;
