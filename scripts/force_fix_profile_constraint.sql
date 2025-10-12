-- FORCE FIX: Remove ALL profile constraints and triggers
-- Run this in Supabase SQL Editor

-- 1. Find and list all constraints on profiles table
SELECT conname 
FROM pg_constraint 
WHERE conrelid = 'public.profiles'::regclass;

-- 2. Drop ALL check constraints on profiles table
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.profiles'::regclass 
        AND contype = 'c'
    ) LOOP
        EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ' || r.conname || ' CASCADE';
    END LOOP;
END $$;

-- 3. Drop ALL triggers on vehicles table that might create profiles
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'vehicles'
    ) LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || r.trigger_name || ' ON public.vehicles CASCADE';
    END LOOP;
END $$;

-- 4. Drop any functions that create profiles
DROP FUNCTION IF EXISTS public.handle_vehicle_created() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_vehicle_insert() CASCADE;
DROP FUNCTION IF EXISTS public.ensure_profile_exists() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 5. Ensure your profile exists with valid data
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
    username = 'shkylar',
    email = 'shkylar@gmail.com';

-- 6. Verify no constraints remain
SELECT 
    conname as constraint_name,
    contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'public.profiles'::regclass;

-- 7. Verify no triggers remain on vehicles
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'vehicles';
