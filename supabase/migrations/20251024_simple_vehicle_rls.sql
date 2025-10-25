-- =====================================================
-- SIMPLE VEHICLE RLS POLICIES - Wikipedia Model
-- =====================================================
-- Date: October 24, 2025
-- Allow ANY authenticated user to edit ANY vehicle
-- Track changes via audit log instead of preventing edits
-- =====================================================

-- Drop all existing complex vehicle policies
DROP POLICY IF EXISTS "Public can view all vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can delete vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can view their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can view all vehicles" ON vehicles;

-- =====================================================
-- SIMPLE POLICIES - Wikipedia Model
-- =====================================================

-- 1. Anyone can view any vehicle (public read)
CREATE POLICY "Anyone can view vehicles"
  ON vehicles
  FOR SELECT
  USING (true);

-- 2. Authenticated users can create vehicles
CREATE POLICY "Authenticated users can create vehicles"
  ON vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. ANY authenticated user can edit ANY vehicle (Wikipedia model)
CREATE POLICY "Any authenticated user can edit vehicles"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Only creator or admins can delete (safety measure)
CREATE POLICY "Vehicle creators can delete"
  ON vehicles
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id 
    OR auth.uid() = uploaded_by
    OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.is_admin = true
    )
  );

-- Ensure RLS is enabled
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Vehicle RLS policies simplified! Any authenticated user can now edit any vehicle.';
END$$;

