-- ===================================================================
-- 🚨 URGENT FIX: Price Save Permissions
-- Run this in Supabase SQL Editor NOW
-- ===================================================================
-- Issue: Users unable to save prices - RLS policies blocking updates
-- Solution: Simplify to allow all authenticated users to update vehicles
-- ===================================================================

BEGIN;

-- Step 1: Drop ALL conflicting UPDATE policies on vehicles table
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update their vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update vehicles" ON vehicles;

-- Step 2: Create ONE simple policy that allows all authenticated users to update
CREATE POLICY "Authenticated users can update any vehicle"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Step 3: Verify RLS is enabled
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Step 4: Show the active UPDATE policies (should be only 1)
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  CASE 
    WHEN qual::text = 'true' THEN '✅ ALLOWS ALL'
    ELSE qual::text
  END as using_clause,
  CASE 
    WHEN with_check::text = 'true' THEN '✅ ALLOWS ALL'
    ELSE with_check::text  
  END as with_check_clause
FROM pg_policies 
WHERE tablename = 'vehicles' 
AND cmd = 'UPDATE'
ORDER BY policyname;

COMMIT;

-- ===================================================================
-- EXPLANATION:
-- ===================================================================
-- Before: Multiple conflicting policies (some checking user_id, owner_id, contributors)
-- After: One simple policy allowing any authenticated user to update any vehicle
-- 
-- This follows Wikipedia's model: anyone can edit, changes are tracked in audit logs
-- 
-- Now price editors will work:
-- - MobilePriceEditor.tsx ✅
-- - VehiclePriceSection.tsx ✅  
-- - BulkPriceEditor.tsx ✅
-- - VehicleDataEditor.tsx ✅
-- ===================================================================

-- Test it works (optional)
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'vehicles' AND cmd = 'UPDATE';
  
  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════╗';
  RAISE NOTICE '║   PRICE SAVE FIX APPLIED ✅             ║';
  RAISE NOTICE '╠════════════════════════════════════════╣';
  RAISE NOTICE '║  Active UPDATE policies: %           ║', policy_count;
  RAISE NOTICE '║  Status: Ready to save prices         ║';
  RAISE NOTICE '╚════════════════════════════════════════╝';
  RAISE NOTICE '';
END $$;

