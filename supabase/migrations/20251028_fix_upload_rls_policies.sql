-- Fix Upload RLS Policies - October 28, 2025
-- Addresses security issues and missing contributor permissions for uploads

BEGIN;

-- ============================================================================
-- FIX #1: Remove dangerous timeline_events INSERT policy
-- ============================================================================
-- This policy allowed ANYONE to insert timeline events for ANY vehicle
-- Keep only the restrictive policy that checks vehicle ownership

DROP POLICY IF EXISTS "authenticated_can_insert_timeline_events" ON timeline_events;

-- Verify the good policy exists (created in earlier migration)
-- If not, create it:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'timeline_events' 
    AND policyname = 'Users can create timeline events for their vehicles'
  ) THEN
    CREATE POLICY "Users can create timeline events for their vehicles" ON timeline_events
      FOR INSERT WITH CHECK (
        auth.uid() = user_id 
        AND EXISTS (
          SELECT 1 FROM vehicles 
          WHERE vehicles.id = timeline_events.vehicle_id 
          AND (vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())
        )
      );
  END IF;
END $$;

-- ============================================================================
-- FIX #2: Add contributor support to vehicle_images INSERT
-- ============================================================================
-- Currently only vehicle owner can upload images
-- Need to allow contributors with active permissions

-- Drop old restrictive policy if exists
DROP POLICY IF EXISTS "authenticated_upload_vehicle_images" ON vehicle_images;

-- Create comprehensive INSERT policy that includes contributors
CREATE POLICY "Vehicle owners and contributors can upload images" ON vehicle_images
  FOR INSERT 
  WITH CHECK (
    auth.uid() = user_id  -- User must be uploading as themselves
    AND (
      -- Vehicle owner (via uploaded_by)
      EXISTS (
        SELECT 1 FROM vehicles v 
        WHERE v.id = vehicle_id 
        AND v.uploaded_by = auth.uid()
      )
      -- OR vehicle owner (via owner_id)
      OR EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = vehicle_id
        AND v.owner_id = auth.uid()
      )
      -- OR active contributor role
      OR EXISTS (
        SELECT 1 FROM vehicle_contributor_roles vcr
        WHERE vcr.vehicle_id = vehicle_images.vehicle_id
        AND vcr.user_id = auth.uid()
        AND COALESCE(vcr.is_active, true) = true
      )
      -- OR has vehicle permissions
      OR EXISTS (
        SELECT 1 FROM vehicle_user_permissions vup
        WHERE vup.vehicle_id = vehicle_images.vehicle_id
        AND vup.user_id = auth.uid()
        AND COALESCE(vup.is_active, true) = true
      )
    )
  );

-- ============================================================================
-- FIX #3: Ensure UPDATE/DELETE policies include contributors
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "owner_manage_vehicle_images" ON vehicle_images;

-- UPDATE policy
CREATE POLICY "Owners and contributors can update images" ON vehicle_images
  FOR UPDATE
  USING (
    auth.uid() = user_id  -- User who uploaded the image
    OR EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_id 
      AND (v.uploaded_by = auth.uid() OR v.owner_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM vehicle_contributor_roles vcr
      WHERE vcr.vehicle_id = vehicle_images.vehicle_id
      AND vcr.user_id = auth.uid()
      AND COALESCE(vcr.is_active, true) = true
    )
  );

-- DELETE policy  
CREATE POLICY "Owners and contributors can delete images" ON vehicle_images
  FOR DELETE
  USING (
    auth.uid() = user_id  -- User who uploaded the image
    OR EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_id 
      AND (v.uploaded_by = auth.uid() OR v.owner_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM vehicle_contributor_roles vcr
      WHERE vcr.vehicle_id = vehicle_images.vehicle_id
      AND vcr.user_id = auth.uid()
      AND COALESCE(vcr.is_active, true) = true
    )
  );

-- ============================================================================
-- FIX #4: Clean up duplicate storage.objects policies
-- ============================================================================

-- Remove redundant vehicle-data policies (keep only the essential ones)
DROP POLICY IF EXISTS "list: auth vehicle-data" ON storage.objects;
DROP POLICY IF EXISTS "read: public vehicle-data" ON storage.objects;
DROP POLICY IF EXISTS "allow_public_read_vehicle_data" ON storage.objects;

-- Keep these essential policies:
-- - public_read_vehicle_data_vehicles (SELECT for 'vehicles/%' paths)
-- - auth_write_vehicle_data (INSERT)
-- - auth_update_vehicle_data (UPDATE)  
-- - auth_delete_vehicle_data (DELETE)

-- Remove redundant vehicle-images policies
DROP POLICY IF EXISTS "allow_public_read_vehicle_images" ON storage.objects;

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
CREATE POLICY IF NOT EXISTS "auth upload vehicle documents" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'vehicle-data'
    AND name LIKE 'vehicles/%/documents/%'
    AND auth.role() = 'authenticated'
  );

-- ============================================================================
-- FIX #6: Verify tool-data bucket policies work with frontend paths
-- ============================================================================

-- Frontend uses: {userId}/receipts/{timestamp}_{filename}
-- Current policy checks: (foldername(name))[1] = auth.uid()::text

-- This should work correctly - verify with test
-- If issues occur, add explicit policy:
CREATE POLICY IF NOT EXISTS "auth upload user receipts" ON storage.objects
  FOR INSERT  
  WITH CHECK (
    bucket_id = 'tool-data'
    AND name LIKE (auth.uid()::text || '/receipts/%')
    AND auth.role() = 'authenticated'
  );

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Show all vehicle_images policies
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  RAISE NOTICE '=== vehicle_images RLS Policies ===';
  FOR policy_record IN 
    SELECT policyname, cmd FROM pg_policies 
    WHERE tablename = 'vehicle_images' AND schemaname = 'public'
    ORDER BY cmd, policyname
  LOOP
    RAISE NOTICE '  % (%)', policy_record.cmd, policy_record.policyname;
  END LOOP;
END $$;

-- Show all timeline_events policies
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  RAISE NOTICE '=== timeline_events RLS Policies ===';
  FOR policy_record IN 
    SELECT policyname, cmd FROM pg_policies 
    WHERE tablename = 'timeline_events' AND schemaname = 'public'
    ORDER BY cmd, policyname
  LOOP
    RAISE NOTICE '  % (%)', policy_record.cmd, policy_record.policyname;
  END LOOP;
END $$;

-- Show storage policies for key buckets
DO $$
DECLARE
  policy_record RECORD;
  bucket_name TEXT;
BEGIN
  FOR bucket_name IN SELECT DISTINCT bucket_id FROM (
    VALUES ('vehicle-images'), ('vehicle-data'), ('tool-data')
  ) AS v(bucket_id)
  LOOP
    RAISE NOTICE '=== % bucket policies ===', bucket_name;
    FOR policy_record IN 
      SELECT policyname, cmd FROM pg_policies 
      WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND qual LIKE '%' || bucket_name || '%'
      OR with_check LIKE '%' || bucket_name || '%'
      ORDER BY cmd, policyname
    LOOP
      RAISE NOTICE '  % (%)', policy_record.cmd, policy_record.policyname;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION NOTES
-- ============================================================================
-- 1. Test image uploads as vehicle owner ✓
-- 2. Test image uploads as contributor (should NOW work)
-- 3. Test receipt uploads (should continue working)
-- 4. Test document uploads to vehicle_documents (should continue working)
-- 5. Verify timeline events are created with proper permissions
-- 6. Check browser console for any RLS errors

