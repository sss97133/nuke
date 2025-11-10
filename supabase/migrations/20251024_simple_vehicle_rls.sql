-- =====================================================
-- SIMPLE VEHICLE RLS POLICIES - Wikipedia Model
-- =====================================================
-- Date: October 24, 2025
-- Allow ANY authenticated user to edit ANY vehicle
-- Track changes via audit log instead of preventing edits
-- =====================================================

DO $$
DECLARE
  has_admin_table BOOLEAN := to_regclass('public.admin_users') IS NOT NULL;
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping simple vehicle RLS setup: public.vehicles does not exist.';
    RETURN;
  END IF;

  -- Ensure RLS is enabled
  EXECUTE 'ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY';

  -- Drop any existing policies that could conflict
  EXECUTE 'DROP POLICY IF EXISTS "Public can view all vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Owners can update vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Owners can update their vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Contributors can update vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Owners can delete vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view all vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Anyone can view vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Vehicle creators can delete" ON public.vehicles';

  -- 1. Anyone can view any vehicle (public read)
  EXECUTE 'CREATE POLICY "Anyone can view vehicles" ON public.vehicles FOR SELECT USING (true)';

  -- 2. Authenticated users can create vehicles
  EXECUTE $policy$
    CREATE POLICY "Authenticated users can create vehicles"
      ON public.vehicles
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() IS NOT NULL)
  $policy$;

  -- 3. ANY authenticated user can edit ANY vehicle (Wikipedia model)
  EXECUTE $policy$
    CREATE POLICY "Any authenticated user can edit vehicles"
      ON public.vehicles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL)
  $policy$;

  -- 4. Only creator or admins can delete (safety measure)
  IF has_admin_table THEN
    EXECUTE $policy$
      CREATE POLICY "Vehicle creators can delete"
        ON public.vehicles
        FOR DELETE
        TO authenticated
        USING (
          auth.uid() = user_id 
          OR auth.uid() = uploaded_by
          OR EXISTS (
            SELECT 1
            FROM public.admin_users au
            WHERE au.user_id = auth.uid()
              AND au.is_active = TRUE
              AND au.admin_level IN ('admin', 'super_admin')
          )
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY "Vehicle creators can delete"
        ON public.vehicles
        FOR DELETE
        TO authenticated
        USING (
          auth.uid() = user_id 
          OR auth.uid() = uploaded_by
        )
    $policy$;
  END IF;

  RAISE NOTICE 'Vehicle RLS policies simplified! Any authenticated user can now edit any vehicle.';
END
$$;

