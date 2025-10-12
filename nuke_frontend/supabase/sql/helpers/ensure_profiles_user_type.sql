BEGIN;

-- Ensure profiles table exists with user_type column used by RLS policies
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  user_type text DEFAULT 'user'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_type'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN user_type text DEFAULT 'user';
  END IF;
END $$;

COMMIT;
