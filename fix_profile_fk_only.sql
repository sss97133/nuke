-- Standalone migration file to fix only the profiles foreign key constraint
-- This addresses the specific issue reported by a0.dev for the phone app

-- Drop the existing constraint (if any)
DO $$
BEGIN
  -- Attempt to drop the constraint if it exists
  BEGIN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'No constraint named profiles_id_fkey exists or another error occurred';
  END;
  
  -- Check for other potential constraint names
  BEGIN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_foreign;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'No constraint named profiles_id_foreign exists or another error occurred';
  END;
END $$;

-- Add the correct constraint pointing to auth.users
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_id_fkey
FOREIGN KEY (id)
REFERENCES auth.users(id)
ON DELETE CASCADE;
