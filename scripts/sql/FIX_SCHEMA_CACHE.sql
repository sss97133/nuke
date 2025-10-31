-- Fix: Remove any references to non-existent 'created_by' column in vehicles table
-- Run this in Supabase SQL Editor to fix the schema cache error

-- The vehicles table uses 'user_id' and 'uploaded_by' for ownership tracking
-- NOT 'created_by'

-- 1. Drop any views that might reference created_by
DROP VIEW IF EXISTS vehicles_with_owner CASCADE;
DROP VIEW IF EXISTS vehicle_ownership_view CASCADE;
DROP VIEW IF EXISTS vehicles_extended CASCADE;

-- 2. Refresh the schema cache for PostgREST
SELECT pg_notify('pgrst', 'reload schema');

-- 3. Verify vehicles table columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
  AND column_name IN ('user_id', 'uploaded_by', 'discovered_by', 'created_by')
ORDER BY column_name;

-- Expected result: Should show user_id, uploaded_by, discovered_by
-- Should NOT show created_by

-- 4. If the issue persists, restart PostgREST from Supabase Dashboard:
-- Settings > Database > Connection pooling > Restart

