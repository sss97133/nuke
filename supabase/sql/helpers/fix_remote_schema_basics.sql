-- fix_remote_schema_basics.sql
-- Purpose: Bring remote schema up to minimum fields/types the app expects.
-- Safe to rerun. Uses IF NOT EXISTS guards and CREATE OR REPLACE for views.

-- 1) Ensure vehicles has visibility/sale flags used by UI filters
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_for_sale boolean DEFAULT false;

-- 2) Ensure profiles has fields referenced by Profile page
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified boolean,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS id_verification_status text,
  ADD COLUMN IF NOT EXISTS id_document_type text,
  ADD COLUMN IF NOT EXISTS id_document_url text,
  ADD COLUMN IF NOT EXISTS verification_level text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS user_type text; -- fallback to text if enum not present

-- 3) Extend user_type enum if it exists (add 'professional' if missing)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'user_type'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'user_type' AND e.enumlabel = 'professional'
    ) THEN
      ALTER TYPE user_type ADD VALUE 'professional';
    END IF;
  END IF;
END $$;

-- 4) If profiles.user_type is currently text but enum exists, try to convert to enum safely
--    Only perform when table column is text and enum type exists
DO $$
DECLARE
  col_is_text boolean;
  enum_exists boolean;
BEGIN
  SELECT (data_type = 'text') INTO col_is_text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_type';

  SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_type') INTO enum_exists;

  IF col_is_text AND enum_exists THEN
    -- Create a temporary enum-compatible column, copy values where possible, then swap
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_type_enum user_type;
    -- Try-cast only valid values, leave others null
    UPDATE public.profiles
      SET user_type_enum = CASE WHEN user_type IN (
        SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname='user_type'
      ) THEN user_type::user_type ELSE NULL END;
    -- Drop old column and rename
    ALTER TABLE public.profiles DROP COLUMN user_type;
    ALTER TABLE public.profiles RENAME COLUMN user_type_enum TO user_type;
  END IF;
END $$;

-- 5) Provide minimal views used by the UI (create or replace with basic structure)
-- Handle the case where an object named profile_stats/professional_scores exists but is not a view.

-- Ensure profile_stats is a VIEW
DO $$
DECLARE kind text;
BEGIN
  SELECT c.relkind INTO kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'profile_stats';

  IF kind IS NOT NULL AND kind <> 'v' THEN
    -- Drop conflicting object (table/materialized view) so we can create a view
    EXECUTE 'DROP TABLE IF EXISTS public.profile_stats CASCADE';
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.profile_stats CASCADE';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.profile_stats AS
SELECT p.id AS user_id
FROM public.profiles p;

-- Ensure professional_scores is a VIEW
DO $$
DECLARE kind text;
BEGIN
  SELECT c.relkind INTO kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'professional_scores';

  IF kind IS NOT NULL AND kind <> 'v' THEN
    EXECUTE 'DROP TABLE IF EXISTS public.professional_scores CASCADE';
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.professional_scores CASCADE';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.professional_scores AS
SELECT p.id AS user_id,
       0::int AS score,
       now() AS updated_at
FROM public.profiles p;
