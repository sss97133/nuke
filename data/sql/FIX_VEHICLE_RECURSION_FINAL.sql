-- ==========================================================================
-- EMERGENCY FIX: VEHICLE UPDATE RECURSION - FINAL FIX
-- ==========================================================================
-- Problem: Stack depth limit exceeded during vehicle updates
-- Root cause: RLS policy WITH CHECK clause causing recursion
-- Solution: Remove WITH CHECK clause - UPDATE only needs USING clause
-- ==========================================================================

-- Drop the existing simple policy
DROP POLICY IF EXISTS "vehicles_simple_update_policy" ON vehicles;

-- Create policy with ONLY USING clause (no WITH CHECK to avoid recursion)
-- WITH CHECK is only needed for INSERT operations
CREATE POLICY "vehicles_simple_update_policy"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    -- Direct column checks only - no subqueries that could cause recursion
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
  );

COMMENT ON POLICY "vehicles_simple_update_policy" ON vehicles IS 
  'Simple non-recursive update policy. Only checks USING clause to avoid stack overflow errors. WITH CHECK removed to prevent recursion.';

-- Verify the policy was created correctly
SELECT 
  policyname, 
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'vehicles' 
  AND policyname = 'vehicles_simple_update_policy';

-- Also ensure all triggers that modify vehicles use SECURITY DEFINER
-- (They should already, but let's make sure)

-- Show current policy
SELECT 
  policyname, 
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'vehicles' 
  AND cmd = 'UPDATE';

