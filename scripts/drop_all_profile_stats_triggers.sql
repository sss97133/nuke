-- Drop ALL profile_stats related triggers and functions blocking vehicle saves

-- 1. Find and drop all triggers on vehicles table
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
        RAISE NOTICE 'Dropped trigger: %', r.trigger_name;
    END LOOP;
END $$;

-- 2. Drop the specific function causing this error
DROP FUNCTION IF EXISTS update_profile_stats_on_vehicle_change() CASCADE;

-- 3. Drop any other profile_stats related functions
DROP FUNCTION IF EXISTS handle_vehicle_activity() CASCADE;
DROP FUNCTION IF EXISTS increment_profile_vehicle_count() CASCADE;
DROP FUNCTION IF EXISTS decrement_profile_vehicle_count() CASCADE;

-- 4. List any remaining triggers (should be none)
SELECT trigger_name, event_manipulation
FROM information_schema.triggers  
WHERE event_object_table = 'vehicles';

-- 5. Test vehicle save
INSERT INTO public.vehicles (user_id, make, model, year, is_public) 
VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'La Salle', 'Coupe', 1939, false) 
RETURNING id;
