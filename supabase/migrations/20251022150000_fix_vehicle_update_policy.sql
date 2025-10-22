-- ===================================================================
-- FIX VEHICLE UPDATE POLICY RECURSION
-- October 22, 2025 - 3:00 PM
-- ===================================================================
-- Problem: The combined UPDATE policy with vehicle_contributors check
-- causes infinite recursion error (42P17)
-- Solution: Split into two separate policies to break the recursion

-- Drop the problematic combined policy
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;

-- Create Policy 1: Direct owners can update (no subquery, no recursion)
CREATE POLICY "Owners can update their vehicles"
  ON vehicles
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = owner_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);

-- Create Policy 2: Contributors can update (separate policy, breaks recursion)
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

-- Note: WITH CHECK is omitted on the contributor policy since it's 
-- evaluated separately from USING, which helps break the recursion loop

