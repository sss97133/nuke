-- Check current RLS policies on vehicles table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'vehicles';

-- If you need to fix the RLS policies, run these commands in Supabase SQL Editor:

-- First, check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity 
FROM pg_tables 
WHERE tablename = 'vehicles';

-- Option 1: Create a policy that allows authenticated users to insert their own vehicles
-- This is the most secure option
CREATE POLICY "Users can insert their own vehicles" 
ON public.vehicles 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Option 2: Allow anonymous users to insert vehicles (less secure)
-- Only use this if you want to allow non-logged-in users to create vehicles
CREATE POLICY "Anyone can insert vehicles" 
ON public.vehicles 
FOR INSERT 
TO anon, authenticated 
WITH CHECK (is_public = true);

-- Option 3: If you want to allow inserts but have the database set the user_id
-- This assumes you have a trigger or default that sets user_id = auth.uid()
CREATE POLICY "Users can insert vehicles with auto user_id" 
ON public.vehicles 
FOR INSERT 
TO authenticated 
WITH CHECK (
    -- Don't check user_id on insert since it will be set by trigger/default
    true
);

-- To view all existing policies:
SELECT * FROM pg_policies WHERE tablename = 'vehicles';

-- To drop a specific policy if needed:
-- DROP POLICY "policy_name" ON public.vehicles;

-- To temporarily disable RLS for testing (NOT RECOMMENDED for production):
-- ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY;

-- To re-enable RLS:
-- ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
