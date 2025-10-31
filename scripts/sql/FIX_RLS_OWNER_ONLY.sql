-- URGENT: Run this in Supabase SQL Editor to fix RLS policies
-- Restricts updates to owners/contributors only

BEGIN;

-- Drop overly permissive policies on vehicles table
DROP POLICY IF EXISTS "Authenticated users can update any vehicle" ON vehicles;
DROP POLICY IF EXISTS "vehicles_admin_owner_update" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;

-- Create proper owner-based UPDATE policy
CREATE POLICY "Only owners and contributors can update vehicles"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    -- User is the vehicle owner
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR
    -- User is a contributor with edit permissions
    EXISTS (
      SELECT 1 FROM vehicle_contributors
      WHERE vehicle_id = vehicles.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'co_owner', 'restorer', 'moderator', 'consigner')
    )
  )
  WITH CHECK (
    -- Same check for new values
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM vehicle_contributors
      WHERE vehicle_id = vehicles.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'co_owner', 'restorer', 'moderator', 'consigner')
    )
  );

-- Fix vehicle_images table
DROP POLICY IF EXISTS "Anyone can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can insert images" ON vehicle_images;

CREATE POLICY "Only owners and contributors can upload images"
  ON vehicle_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE id = vehicle_images.vehicle_id
      AND (
        uploaded_by = auth.uid()
        OR user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors
          WHERE vehicle_id = vehicles.id
          AND user_id = auth.uid()
          AND role IN ('owner', 'co_owner', 'restorer', 'moderator', 'consigner')
        )
      )
    )
  );

-- Users can only delete their own images
DROP POLICY IF EXISTS "Users can delete images" ON vehicle_images;
DROP POLICY IF EXISTS "Anyone can delete images" ON vehicle_images;

CREATE POLICY "Users can delete their own images"
  ON vehicle_images
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Fix vehicle_documents table (if exists)
DROP POLICY IF EXISTS "Anyone can insert documents" ON vehicle_documents;
DROP POLICY IF EXISTS "Users can insert documents" ON vehicle_documents;
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON vehicle_documents;

CREATE POLICY "Only owners and contributors can upload documents"
  ON vehicle_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE id = vehicle_documents.vehicle_id
      AND (
        uploaded_by = auth.uid()
        OR user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors
          WHERE vehicle_id = vehicles.id
          AND user_id = auth.uid()
          AND role IN ('owner', 'co_owner', 'restorer', 'moderator', 'consigner')
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete documents" ON vehicle_documents;
DROP POLICY IF EXISTS "Anyone can delete documents" ON vehicle_documents;

CREATE POLICY "Users can delete their own documents"
  ON vehicle_documents
  FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

COMMIT;

-- Verify policies
SELECT 
  tablename, 
  policyname, 
  cmd,
  CASE WHEN permissive = 'PERMISSIVE' THEN '✅ ALLOWS' ELSE '🔒 RESTRICTS' END as type
FROM pg_policies 
WHERE tablename IN ('vehicles', 'vehicle_images', 'vehicle_documents')
  AND cmd IN ('UPDATE', 'INSERT', 'DELETE')
ORDER BY tablename, cmd;

