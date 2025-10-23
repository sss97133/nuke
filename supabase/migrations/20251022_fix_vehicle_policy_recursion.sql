-- ===================================================================
-- FIX VEHICLE RLS POLICY RECURSION
-- October 22, 2025
-- ===================================================================
-- This fixes the infinite recursion error when updating vehicles
-- The issue is caused by complex policy checks that reference the same table

-- Drop all existing policies on vehicles
DROP POLICY IF EXISTS "Public can view all vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON vehicles;

-- Re-create simple, non-recursive policies

-- 1. Allow public read access (SELECT)
CREATE POLICY "Public can view all vehicles"
  ON vehicles
  FOR SELECT
  USING (true);

-- 2. Allow authenticated users to create their own vehicles (INSERT)
CREATE POLICY "Authenticated users can create vehicles"
  ON vehicles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Allow owners to update their vehicles (UPDATE)
-- SIMPLIFIED: Only check user_id/owner_id, don't query other tables
CREATE POLICY "Owners can update vehicles"
  ON vehicles
  FOR UPDATE
  USING (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
  )
  WITH CHECK (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
  );

-- 4. Allow contributors to update vehicles (separate policy)
-- This avoids recursion by not checking vehicles table in the subquery
CREATE POLICY "Contributors can update vehicles"
  ON vehicles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_contributors 
      WHERE vehicle_contributors.vehicle_id = vehicles.id 
      AND vehicle_contributors.user_id = auth.uid()
    )
  );

-- 5. Allow owners to delete their vehicles (DELETE)
CREATE POLICY "Owners can delete vehicles"
  ON vehicles
  FOR DELETE
  USING (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
  );

-- Verify RLS is enabled
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

