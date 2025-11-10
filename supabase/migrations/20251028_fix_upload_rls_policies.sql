-- Fix Upload RLS Policies - October 28, 2025
-- Addresses security issues and missing contributor permissions for uploads

-- ============================================================================
-- FIX #1: Remove dangerous timeline_events INSERT policy
-- ============================================================================
-- This policy allowed ANYONE to insert timeline events for ANY vehicle
-- Keep only the restrictive policy that checks vehicle ownership

DO $$
BEGIN
  IF to_regclass('public.timeline_events') IS NULL THEN
    RAISE NOTICE 'Skipping timeline_events policy updates: table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "authenticated_can_insert_timeline_events" ON public.timeline_events';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'timeline_events' 
    AND policyname = 'Users can create timeline events for their vehicles'
  ) THEN
    EXECUTE '
      CREATE POLICY "Users can create timeline events for their vehicles" ON public.timeline_events
        FOR INSERT WITH CHECK (
          auth.uid() = user_id 
          AND EXISTS (
            SELECT 1 FROM public.vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND (vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())
          )
        )';
  END IF;
END $$;

-- ============================================================================
-- FIX #2: Add contributor support to vehicle_images INSERT
-- ============================================================================
-- Currently only vehicle owner can upload images
-- Need to allow contributors with active permissions

DO $$
BEGIN
  IF to_regclass('public.vehicle_images') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle_images policy updates: table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "authenticated_upload_vehicle_images" ON public.vehicle_images';

  EXECUTE '
    CREATE POLICY "Vehicle owners and contributors can upload images" ON public.vehicle_images
      FOR INSERT 
      WITH CHECK (
        auth.uid() = user_id
        AND (
          EXISTS (
            SELECT 1 FROM public.vehicles v 
            WHERE v.id = vehicle_id 
            AND v.uploaded_by = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.vehicles v
            WHERE v.id = vehicle_id
            AND v.owner_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.vehicle_contributor_roles vcr
            WHERE vcr.vehicle_id = vehicle_images.vehicle_id
            AND vcr.user_id = auth.uid()
            AND COALESCE(vcr.is_active, true) = true
          )
          OR EXISTS (
            SELECT 1 FROM public.vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_images.vehicle_id
            AND vup.user_id = auth.uid()
            AND COALESCE(vup.is_active, true) = true
          )
        )
      )';
END $$;

-- ============================================================================
-- FIX #3: Ensure UPDATE/DELETE policies include contributors
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.vehicle_images') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "owner_manage_vehicle_images" ON public.vehicle_images';
  EXECUTE 'DROP POLICY IF EXISTS "Owners and contributors can update images" ON public.vehicle_images';
  EXECUTE 'DROP POLICY IF EXISTS "Owners and contributors can delete images" ON public.vehicle_images';

  EXECUTE '
    CREATE POLICY "Owners and contributors can update images" ON public.vehicle_images
      FOR UPDATE
      USING (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1 FROM public.vehicles v 
          WHERE v.id = vehicle_id 
          AND (v.uploaded_by = auth.uid() OR v.owner_id = auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = vehicle_images.vehicle_id
          AND vcr.user_id = auth.uid()
          AND COALESCE(vcr.is_active, true) = true
        )
      )';

  EXECUTE '
    CREATE POLICY "Owners and contributors can delete images" ON public.vehicle_images
      FOR DELETE
      USING (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1 FROM public.vehicles v 
          WHERE v.id = vehicle_id 
          AND (v.uploaded_by = auth.uid() OR v.owner_id = auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = vehicle_images.vehicle_id
          AND vcr.user_id = auth.uid()
          AND COALESCE(vcr.is_active, true) = true
        )
      )';
END
$$;

-- ============================================================================
-- FIX #4: Clean up duplicate storage.objects policies
-- ============================================================================

-- Remove redundant vehicle-data policies (keep only the essential ones)
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Skipping storage.objects cleanup: table does not exist.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "list: auth vehicle-data" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "read: public vehicle-data" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "allow_public_read_vehicle_data" ON storage.objects';
END
$$;

-- Keep these essential policies:
-- - public_read_vehicle_data_vehicles (SELECT for 'vehicles/%' paths)
-- - auth_write_vehicle_data (INSERT)
-- - auth_update_vehicle_data (UPDATE)  
-- - auth_delete_vehicle_data (DELETE)

-- Remove redundant vehicle-images policies
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "allow_public_read_vehicle_images" ON storage.objects';
END
$$;

-- The remaining policies are fine:
-- - public_read_vehicle_images (SELECT)
-- - allow_authenticated_uploads_vehicle_images (INSERT)
-- - authenticated update vehicle-images (UPDATE)
-- - authenticated delete vehicle-images (DELETE)

-- ============================================================================
-- FIX #5: Add helpful policy to vehicle-data for document uploads
-- ============================================================================

-- Ensure authenticated users can upload documents to vehicles/{vehicleId}/documents/
-- (This path is used by SmartInvoiceUploader and VehicleDocumentUploader)
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "auth upload vehicle documents" ON storage.objects';
  EXECUTE '
    CREATE POLICY "auth upload vehicle documents" ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = ''vehicle-data''
        AND name LIKE ''vehicles/%/documents/%''
        AND auth.role() = ''authenticated''
      )';
END
$$;

-- ============================================================================
-- FIX #6: Verify tool-data bucket policies work with frontend paths
-- ============================================================================

-- Frontend uses: {userId}/receipts/{timestamp}_{filename}
-- Current policy checks: (foldername(name))[1] = auth.uid()::text

-- This should work correctly - verify with test
-- Add explicit policy for clarity:
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "auth upload user receipts" ON storage.objects';
  EXECUTE '
    CREATE POLICY "auth upload user receipts" ON storage.objects
      FOR INSERT  
      WITH CHECK (
        bucket_id = ''tool-data''
        AND name LIKE (auth.uid()::text || ''/receipts/%'')
        AND auth.role() = ''authenticated''
      )';
END
$$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Show all vehicle_images policies
-- ============================================================================
-- POST-MIGRATION NOTES
-- ============================================================================
-- 1. Test image uploads as vehicle owner ✓
-- 2. Test image uploads as contributor (should NOW work)
-- 3. Test receipt uploads (should continue working)
-- 4. Test document uploads to vehicle_documents (should continue working)
-- 5. Verify timeline events are created with proper permissions
-- 6. Check browser console for any RLS errors

