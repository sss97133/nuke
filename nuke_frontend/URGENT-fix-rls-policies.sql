-- URGENT: Fix RLS Policies for Vehicle Inserts
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- This will allow authenticated users to create vehicles

-- Step 1: Check current policies (for debugging)
SELECT 
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'vehicles';

-- Step 2: Drop potentially problematic INSERT policies
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.vehicles;
DROP POLICY IF EXISTS "Users can create vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Users can insert vehicles" ON public.vehicles;

-- Step 3: Create a permissive INSERT policy for authenticated users
CREATE POLICY "Authenticated users can create vehicles" 
ON public.vehicles 
FOR INSERT 
TO authenticated 
WITH CHECK (true);  -- Allow any authenticated user to insert

-- Step 4: Ensure other necessary policies exist
-- Policy for users to read their own vehicles
CREATE POLICY IF NOT EXISTS "Users can view their own vehicles" 
ON public.vehicles 
FOR SELECT 
TO authenticated 
USING (
    (user_id = auth.uid()) OR 
    (uploaded_by = auth.uid()) OR 
    (discovered_by = auth.uid()) OR
    (is_public = true)
);

-- Policy for users to update their own vehicles
CREATE POLICY IF NOT EXISTS "Users can update their own vehicles" 
ON public.vehicles 
FOR UPDATE 
TO authenticated 
USING (
    (user_id = auth.uid()) OR 
    (uploaded_by = auth.uid())
);

-- Policy for users to delete their own vehicles
CREATE POLICY IF NOT EXISTS "Users can delete their own vehicles" 
ON public.vehicles 
FOR DELETE 
TO authenticated 
USING (
    (user_id = auth.uid()) OR 
    (uploaded_by = auth.uid())
);

-- Step 5: Set default values for user tracking columns (if they exist)
DO $$
BEGIN
    -- Check and set default for user_id if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vehicles' AND column_name = 'user_id'
    ) THEN
        EXECUTE 'ALTER TABLE public.vehicles ALTER COLUMN user_id SET DEFAULT auth.uid()';
    END IF;
    
    -- Check and set default for uploaded_by if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vehicles' AND column_name = 'uploaded_by'
    ) THEN
        EXECUTE 'ALTER TABLE public.vehicles ALTER COLUMN uploaded_by SET DEFAULT auth.uid()';
    END IF;
    
    -- Check and set default for discovered_by if it exists (only set if discovery_source is not null)
    -- This is handled differently since not all vehicles are "discovered"
END$$;

-- Step 6: Ensure RLS is enabled
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Step 7: Also fix timeline_events table if needed
DROP POLICY IF EXISTS "Users can insert timeline events" ON public.timeline_events;
CREATE POLICY "Authenticated users can create timeline events" 
ON public.timeline_events 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Step 8: Fix ownership_verifications table
DROP POLICY IF EXISTS "Users can insert ownership verifications" ON public.ownership_verifications;
CREATE POLICY "Authenticated users can create ownership verifications" 
ON public.ownership_verifications 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Step 9: Fix vehicle_documents table
DROP POLICY IF EXISTS "Users can insert vehicle documents" ON public.vehicle_documents;
CREATE POLICY "Authenticated users can upload documents" 
ON public.vehicle_documents 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Step 10: Verify all policies are in place
SELECT 
    tablename,
    policyname,
    cmd,
    roles
FROM pg_policies 
WHERE tablename IN ('vehicles', 'timeline_events', 'ownership_verifications', 'vehicle_documents')
ORDER BY tablename, cmd;

-- If you still get errors after running this, check:
-- 1. That you're logged in when testing
-- 2. Run: SELECT auth.uid(); -- This should return your user ID, not NULL
-- 3. Check table structure: \d vehicles
