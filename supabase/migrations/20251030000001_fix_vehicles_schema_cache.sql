-- Fix: Remove any references to non-existent 'created_by' column in vehicles table
-- This is causing schema cache errors on mobile add vehicle flow

-- The vehicles table uses 'user_id' and 'uploaded_by' for ownership tracking
-- NOT 'created_by'

-- 1. Drop any views that might reference created_by
DO $$
BEGIN
  IF to_regclass('public.vehicles_with_owner') IS NOT NULL THEN
    EXECUTE 'DROP VIEW vehicles_with_owner CASCADE';
  END IF;

  IF to_regclass('public.vehicle_ownership_view') IS NOT NULL THEN
    EXECUTE 'DROP VIEW vehicle_ownership_view CASCADE';
  END IF;

  IF to_regclass('public.vehicles_extended') IS NOT NULL THEN
    EXECUTE 'DROP VIEW vehicles_extended CASCADE';
  END IF;
END
$$;

-- 2. Refresh the schema cache for PostgREST
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END
$$;

-- 3. Add comment to clarify ownership columns
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle column comments: vehicles table does not exist.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.vehicles.user_id IS ''Primary owner - User who owns this vehicle''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'uploaded_by'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.vehicles.uploaded_by IS ''User who uploaded/created this vehicle record''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'discovered_by'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN public.vehicles.discovered_by IS ''User who discovered this vehicle (for non-owned vehicles)''';
  END IF;
END
$$;

-- Note: If PostgREST schema cache is still stale, run this in Supabase SQL Editor:
-- SELECT pg_notify('pgrst', 'reload schema');
-- OR restart the PostgREST instance from the Supabase dashboard

