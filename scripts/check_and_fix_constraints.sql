-- Check what constraints exist and forcefully remove them

-- 1. Show ALL constraints on profiles table
SELECT 
    con.conname AS constraint_name,
    con.contype AS type,
    pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public' 
AND rel.relname = 'profiles';

-- 2. FORCE DROP the specific constraint that's causing issues
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

-- 3. Drop any other username-related constraints
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_check CASCADE;

-- 4. Verify the constraint is gone
SELECT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'profiles_username_format_chk'
) as constraint_still_exists;

-- 5. Make sure profile exists without any constraint violations
UPDATE public.profiles 
SET username = 'shkylar'
WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- If profile doesn't exist, insert it
INSERT INTO public.profiles (id, email, username, full_name, is_public, is_professional)
VALUES (
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'shkylar@gmail.com',
    'shkylar',
    'skylar williams',
    false,
    false
)
ON CONFLICT (id) DO NOTHING;
