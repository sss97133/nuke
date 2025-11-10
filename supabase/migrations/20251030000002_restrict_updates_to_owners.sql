-- Restrict vehicle updates to owners/contributors only
-- This tightens the overly permissive policies we had before

-- Drop the overly permissive policies
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle policy updates: vehicles table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update any vehicle" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "vehicles_admin_owner_update" ON public.vehicles';
  EXECUTE 'DROP POLICY IF EXISTS "Only owners and contributors can update vehicles" ON public.vehicles';

  EXECUTE '
    CREATE POLICY "Only owners and contributors can update vehicles"
      ON public.vehicles
      FOR UPDATE
      TO authenticated
      USING (
        auth.uid() = uploaded_by
        OR auth.uid() = user_id
        OR EXISTS (
          SELECT 1 FROM public.vehicle_contributors
          WHERE vehicle_id = vehicles.id
          AND user_id = auth.uid()
          AND role IN (''owner'', ''co_owner'', ''restorer'', ''moderator'', ''consigner'')
        )
      )
      WITH CHECK (
        auth.uid() = uploaded_by
        OR auth.uid() = user_id
        OR EXISTS (
          SELECT 1 FROM public.vehicle_contributors
          WHERE vehicle_id = vehicles.id
          AND user_id = auth.uid()
          AND role IN (''owner'', ''co_owner'', ''restorer'', ''moderator'', ''consigner'')
        )
      )';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.vehicle_images') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle_images insert policy creation: table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert images" ON public.vehicle_images';
  EXECUTE 'DROP POLICY IF EXISTS "Users can insert images" ON public.vehicle_images';
  EXECUTE 'DROP POLICY IF EXISTS "Only owners and contributors can upload images" ON public.vehicle_images';

  EXECUTE '
    CREATE POLICY "Only owners and contributors can upload images"
      ON public.vehicle_images
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.vehicles
          WHERE id = vehicle_images.vehicle_id
          AND (
            uploaded_by = auth.uid()
            OR user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.vehicle_contributors
              WHERE vehicle_id = vehicles.id
              AND user_id = auth.uid()
              AND role IN (''owner'', ''co_owner'', ''restorer'', ''moderator'', ''consigner'')
            )
          )
        )
      )';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.vehicle_images') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Users can delete images" ON public.vehicle_images';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own images" ON public.vehicle_images';

  EXECUTE '
    CREATE POLICY "Users can delete their own images"
      ON public.vehicle_images
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid())';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.vehicle_documents') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle_documents insert policy creation: table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Anyone can insert documents" ON public.vehicle_documents';
  EXECUTE 'DROP POLICY IF EXISTS "Users can insert documents" ON public.vehicle_documents';
  EXECUTE 'DROP POLICY IF EXISTS "Only owners and contributors can upload documents" ON public.vehicle_documents';

  EXECUTE '
    CREATE POLICY "Only owners and contributors can upload documents"
      ON public.vehicle_documents
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.vehicles
          WHERE id = vehicle_documents.vehicle_id
          AND (
            uploaded_by = auth.uid()
            OR user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.vehicle_contributors
              WHERE vehicle_id = vehicles.id
              AND user_id = auth.uid()
              AND role IN (''owner'', ''co_owner'', ''restorer'', ''moderator'', ''consigner'')
            )
          )
        )
      )';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.vehicle_documents') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Users can delete documents" ON public.vehicle_documents';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete their own documents" ON public.vehicle_documents';

  EXECUTE '
    CREATE POLICY "Users can delete their own documents"
      ON public.vehicle_documents
      FOR DELETE
      TO authenticated
      USING (uploaded_by = auth.uid())';
END
$$;

