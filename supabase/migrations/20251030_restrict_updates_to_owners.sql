-- Restrict vehicle updates to owners/contributors only
-- This tightens the overly permissive policies we had before

BEGIN;

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can update any vehicle" ON vehicles;
DROP POLICY IF EXISTS "vehicles_admin_owner_update" ON vehicles;

-- Create proper owner-based UPDATE policy
CREATE POLICY "Only owners and contributors can update vehicles"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    -- User is the vehicle owner (uploaded_by or user_id)
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
    -- Same check for the new values
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

-- Ensure vehicle_images has proper RLS
DROP POLICY IF EXISTS "Anyone can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images" ON vehicle_images;

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

CREATE POLICY "Users can delete their own images"
  ON vehicle_images
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Ensure vehicle_documents has proper RLS
DROP POLICY IF EXISTS "Anyone can insert documents" ON vehicle_documents;
DROP POLICY IF EXISTS "Users can insert documents" ON vehicle_documents;

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

-- Users can only delete their own documents
DROP POLICY IF EXISTS "Users can delete documents" ON vehicle_documents;

CREATE POLICY "Users can delete their own documents"
  ON vehicle_documents
  FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

COMMIT;

-- Verification queries
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  cmd,
  CASE 
    WHEN roles = '{authenticated}' THEN 'authenticated'
    ELSE array_to_string(roles, ', ')
  END as roles
FROM pg_policies 
WHERE tablename IN ('vehicles', 'vehicle_images', 'vehicle_documents')
  AND cmd IN ('UPDATE', 'INSERT', 'DELETE')
ORDER BY tablename, cmd, policyname;

