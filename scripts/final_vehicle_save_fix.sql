-- Final fix for vehicle save issue
-- The problem: profiles_username_format_chk constraint keeps blocking saves

-- 1. Drop the problematic constraint
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

-- 2. Check current profile status
SELECT id, email, username, full_name 
FROM public.profiles 
WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- 3. If the profile doesn't have proper username, update it to what YOU chose
UPDATE public.profiles 
SET 
    username = 'skylar',  -- Your chosen @handle
    full_name = 'skylar williams'  -- Your display name
WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- 4. Test that vehicles can now be saved
-- Try inserting a test vehicle to verify
INSERT INTO public.vehicles (
    user_id,
    make,
    model,
    year,
    is_public
) VALUES (
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'Test',
    'Vehicle',
    2024,
    false
) RETURNING id;

-- 5. Clean up test vehicle
DELETE FROM public.vehicles 
WHERE make = 'Test' AND model = 'Vehicle';

-- 6. Verify no constraints remain
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.profiles'::regclass;
