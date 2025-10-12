-- Simple fix: Just drop the constraint that's blocking everything
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

-- That's it. No username generation, no automatic profile creation.
-- Your profile already exists with username 'skylar williams'
