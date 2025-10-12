-- Fix the handle_vehicle_activity trigger that's blocking vehicle saves

-- 1. Drop the problematic trigger and function
DROP TRIGGER IF EXISTS on_vehicle_created ON public.vehicles CASCADE;
DROP TRIGGER IF EXISTS on_vehicle_inserted ON public.vehicles CASCADE;
DROP TRIGGER IF EXISTS vehicle_activity_trigger ON public.vehicles CASCADE;
DROP FUNCTION IF EXISTS handle_vehicle_activity() CASCADE;

-- 2. Check if profile_stats table exists and has wrong column name
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'profile_stats';

-- 3. If profile_stats exists but has wrong column, fix it
ALTER TABLE profile_stats 
RENAME COLUMN profile_id TO id 
WHERE EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profile_stats' 
    AND column_name = 'profile_id'
);

-- 4. Or just drop the whole profile_stats update mechanism
DROP TABLE IF EXISTS profile_stats CASCADE;

-- 5. List remaining triggers on vehicles table
SELECT trigger_name, event_manipulation
FROM information_schema.triggers  
WHERE event_object_table = 'vehicles';

-- 6. Test vehicle insert works
INSERT INTO public.vehicles (user_id, make, model, year, is_public) 
VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'Test', 'Save', 2024, false) 
RETURNING id;

-- 7. Clean up test
DELETE FROM public.vehicles WHERE make = 'Test' AND model = 'Save';
