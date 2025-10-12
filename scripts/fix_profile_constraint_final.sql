-- FINAL FIX for profile username constraint issue
-- Run this in Supabase SQL Editor to permanently fix the issue

-- 1. Drop the problematic constraint
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

-- 2. Drop any triggers that auto-create profiles on vehicle insert
DROP TRIGGER IF EXISTS on_vehicle_created ON public.vehicles CASCADE;
DROP FUNCTION IF EXISTS public.handle_vehicle_created() CASCADE;
DROP TRIGGER IF EXISTS create_profile_on_vehicle_insert ON public.vehicles CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_vehicle_insert() CASCADE;

-- 3. Ensure your profile exists with a valid username
INSERT INTO public.profiles (id, email, username, full_name, is_public, is_professional)
VALUES (
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'shkylar@gmail.com',
    'shkylar',
    'skylar williams',
    false,
    false
)
ON CONFLICT (id) 
DO UPDATE SET 
    username = COALESCE(profiles.username, 'shkylar'),
    email = COALESCE(profiles.email, 'shkylar@gmail.com');

-- 4. Add a more permissive username constraint (optional)
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_check 
CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_-]+$');

-- 5. Verify the fix
SELECT id, email, username, full_name 
FROM public.profiles 
WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- 6. Check for any problematic triggers
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table
FROM information_schema.triggers
WHERE event_object_table IN ('vehicles', 'profiles');
