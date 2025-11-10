-- ===================================================================
-- FIX VEHICLE UPDATE POLICY RECURSION
-- October 22, 2025 - 3:00 PM
-- ===================================================================
-- Problem: The combined UPDATE policy with vehicle_contributors check
-- causes infinite recursion error (42P17)
-- Solution: Split into two separate policies to break the recursion

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle policy fix: public.vehicles does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles';

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicles'
      AND policyname = 'Owners can update their vehicles'
  ) THEN
    EXECUTE 'DROP POLICY "Owners can update their vehicles" ON public.vehicles';
  END IF;

  EXECUTE $policy$
    CREATE POLICY "Owners can update their vehicles"
      ON public.vehicles
      FOR UPDATE
      USING (auth.uid() = user_id OR auth.uid() = owner_id)
      WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id)
  $policy$;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicles'
      AND policyname = 'Contributors can update vehicles'
  ) THEN
    EXECUTE 'DROP POLICY "Contributors can update vehicles" ON public.vehicles';
  END IF;

  IF to_regclass('public.vehicle_contributors') IS NULL THEN
    RAISE NOTICE 'Skipping contributor policy: public.vehicle_contributors does not exist.';
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
END
$$;

-- Note: WITH CHECK is omitted on the contributor policy since it's 
-- evaluated separately from USING, which helps break the recursion loop

