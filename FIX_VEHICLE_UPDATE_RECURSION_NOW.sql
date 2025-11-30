-- ==========================================================================
-- EMERGENCY FIX: VEHICLE UPDATE RECURSION - RUN THIS NOW
-- ==========================================================================
-- Problem: "stack depth limit exceeded" error when updating vehicles
-- Cause: Complex RLS policy with nested subqueries causing infinite recursion
-- Solution: Simplified policy that avoids recursion
-- ==========================================================================
-- 
-- INSTRUCTIONS: Copy and paste this entire file into Supabase SQL Editor and run it
-- ==========================================================================

-- Drop ALL existing update policies on vehicles table
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'vehicles'
        AND cmd = 'UPDATE'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON vehicles', pol.policyname);
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
END $$;

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

-- Verify the policy was created correctly
SELECT 
  policyname, 
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'vehicles' 
  AND policyname = 'vehicles_simple_update_policy';

-- Show all remaining policies on vehicles table for verification
SELECT 
  policyname, 
  cmd,
  CASE WHEN cmd = 'SELECT' THEN 'READ' 
       WHEN cmd = 'INSERT' THEN 'CREATE'
       WHEN cmd = 'UPDATE' THEN 'UPDATE'
       WHEN cmd = 'DELETE' THEN 'DELETE'
       ELSE cmd END as operation
FROM pg_policies 
WHERE tablename = 'vehicles'
ORDER BY cmd, policyname;

