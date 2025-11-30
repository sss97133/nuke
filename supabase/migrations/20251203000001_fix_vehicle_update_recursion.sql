-- ==========================================================================
-- EMERGENCY FIX: VEHICLE UPDATE RECURSION
-- ==========================================================================
-- Problem: "stack depth limit exceeded" error when updating vehicles
-- Cause: Complex RLS policy with nested subqueries causing recursion
-- Solution: Simplified policy that avoids recursion
-- ==========================================================================

-- Drop the problematic comprehensive policy
DROP POLICY IF EXISTS "vehicles_comprehensive_update_policy" ON vehicles;

-- Also drop any other conflicting update policies
DROP POLICY IF EXISTS "Owners can update their vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
DROP POLICY IF EXISTS "Only owners and contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "vehicles_update_by_contributors" ON vehicles;
DROP POLICY IF EXISTS "allow_owner_update_vehicles" ON vehicles;

-- Create a SIMPLE, NON-RECURSIVE update policy
-- Only check direct columns - NO subqueries, NO joins, NO recursion
CREATE POLICY "vehicles_simple_update_policy"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    -- Direct column checks only - no subqueries that could cause recursion
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
  )
  WITH CHECK (
    -- Same simple checks for WITH CHECK clause
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
  );

COMMENT ON POLICY "vehicles_simple_update_policy" ON vehicles IS 
  'Simple non-recursive update policy. Only checks direct ownership columns to avoid stack overflow errors.';

-- Verify the policy was created
SELECT 
  policyname, 
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'vehicles' 
  AND policyname = 'vehicles_simple_update_policy';

