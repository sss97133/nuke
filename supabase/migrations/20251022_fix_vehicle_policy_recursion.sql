-- ===================================================================
-- FIX VEHICLE RLS POLICY RECURSION
-- October 22, 2025
-- ===================================================================
-- This fixes the infinite recursion error when updating vehicles
-- The issue is caused by complex policy checks that reference the same table

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle policy recursion fix: public.vehicles does not exist.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY';

  -- Drop any existing policies before recreating simplified versions
  PERFORM 1
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'vehicles'
    AND policyname IN (
      'Public can view all vehicles',
      'Authenticated users can create vehicles',
      'Users can update their own vehicles',
      'Owners can update their vehicles',
      'Owners can update vehicles',
      'Contributors can update vehicles',
      'Users can delete their own vehicles',
      'Owners can delete vehicles'
    );

  IF FOUND THEN
    EXECUTE 'DROP POLICY IF EXISTS "Public can view all vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Owners can update their vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Owners can update vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Contributors can update vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles';
    EXECUTE 'DROP POLICY IF EXISTS "Owners can delete vehicles" ON public.vehicles';
  END IF;

  -- 1. Allow public read access (SELECT)
  EXECUTE 'CREATE POLICY "Public can view all vehicles" ON public.vehicles FOR SELECT USING (true)';

  -- 2. Allow authenticated users to create their own vehicles (INSERT)
  EXECUTE 'CREATE POLICY "Authenticated users can create vehicles" ON public.vehicles FOR INSERT WITH CHECK (auth.uid() = user_id)';

  -- 3. Allow owners to update their vehicles (UPDATE) without recursion
  EXECUTE $policy$
    CREATE POLICY "Owners can update their vehicles"
      ON public.vehicles
      FOR UPDATE
      USING (auth.uid() = user_id OR auth.uid() = owner_id)
      WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id)
  $policy$;

  -- 4. Allow contributors to update vehicles when active contributor records exist
  IF to_regclass('public.vehicle_contributors') IS NULL THEN
    RAISE NOTICE 'Skipping contributor update policy: public.vehicle_contributors does not exist.';
  ELSE
    EXECUTE $policy$
      CREATE POLICY "Contributors can update vehicles"
        ON public.vehicles
        FOR UPDATE
        USING (
          EXISTS (
            SELECT 1 FROM public.vehicle_contributors 
            WHERE vehicle_contributors.vehicle_id = vehicles.id 
              AND vehicle_contributors.user_id = auth.uid()
              AND vehicle_contributors.status = 'active'
          )
        )
    $policy$;
  END IF;

  -- 5. Allow owners to delete their vehicles (DELETE)
  EXECUTE $policy$
    CREATE POLICY "Owners can delete vehicles"
      ON public.vehicles
      FOR DELETE
      USING (auth.uid() = user_id OR auth.uid() = owner_id)
  $policy$;
END
$$;

