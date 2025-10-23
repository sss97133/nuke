-- ===================================================================
-- EMERGENCY FIX FOR VEHICLE UPDATE RECURSION
-- Run this in Supabase SQL Editor NOW
-- ===================================================================

-- First, list all current policies to see what exists
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'vehicles';

-- DROP ALL POLICIES on vehicles (no matter what they're called)
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'vehicles'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON vehicles', pol.policyname);
    END LOOP;
END $$;

-- Now create clean, simple policies with NO RECURSION

-- 1. Public can read all vehicles
CREATE POLICY "allow_public_select_vehicles"
  ON vehicles FOR SELECT
  USING (true);

-- 2. Authenticated users can insert their own vehicles
CREATE POLICY "allow_user_insert_vehicles"
  ON vehicles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. SIMPLE update policy - only check direct columns
-- NO SUBQUERIES, NO JOINS, NO RECURSION
CREATE POLICY "allow_owner_update_vehicles"
  ON vehicles FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = owner_id);

-- 4. Simple delete policy
CREATE POLICY "allow_owner_delete_vehicles"
  ON vehicles FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = owner_id);

-- Ensure RLS is enabled
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Verify policies were created
SELECT 
  policyname, 
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'vehicles'
ORDER BY policyname;

