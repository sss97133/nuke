-- Fix vehicle save issue by disabling problematic triggers
-- Run this in Supabase SQL editor

-- Drop any triggers that try to create profiles on vehicle insert
DROP TRIGGER IF EXISTS on_vehicle_created ON public.vehicles;
DROP TRIGGER IF EXISTS create_profile_on_vehicle_insert ON public.vehicles;
DROP TRIGGER IF EXISTS ensure_profile_exists ON public.vehicles;

-- Drop the function if it exists
DROP FUNCTION IF EXISTS public.handle_vehicle_created();
DROP FUNCTION IF EXISTS public.create_profile_on_vehicle_insert();
DROP FUNCTION IF EXISTS public.ensure_profile_exists();

-- Check if there are any other triggers on vehicles table
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'vehicles';

-- Ensure profiles table accepts our usernames
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk;

-- Add a simpler username constraint that allows more formats
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_check 
CHECK (username ~ '^[a-zA-Z0-9_]+$' OR username IS NULL);

-- Create/update profile for current user with valid username
INSERT INTO public.profiles (id, email, username, full_name, is_public, is_professional)
SELECT 
    id,
    email,
    COALESCE(
        LOWER(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-z0-9_]', '', 'g')),
        'user_' || SUBSTRING(id::text, 1, 8)
    ),
    COALESCE(raw_user_meta_data->>'full_name', ''),
    false,
    false
FROM auth.users
WHERE email = 'shkylar@gmail.com'
ON CONFLICT (id) 
DO UPDATE SET 
    username = EXCLUDED.username
WHERE profiles.username IS NULL OR profiles.username = '';
