-- Fix: Remove any references to non-existent 'created_by' column in vehicles table
-- This is causing schema cache errors on mobile add vehicle flow

-- The vehicles table uses 'user_id' and 'uploaded_by' for ownership tracking
-- NOT 'created_by'

-- 1. Drop any views that might reference created_by
DROP VIEW IF EXISTS vehicles_with_owner CASCADE;
DROP VIEW IF EXISTS vehicle_ownership_view CASCADE;
DROP VIEW IF EXISTS vehicles_extended CASCADE;

-- 2. Refresh the schema cache for PostgREST
NOTIFY pgrst, 'reload schema';

-- 3. Add comment to clarify ownership columns
COMMENT ON COLUMN vehicles.user_id IS 'Primary owner - User who owns this vehicle';
COMMENT ON COLUMN vehicles.uploaded_by IS 'User who uploaded/created this vehicle record';
COMMENT ON COLUMN vehicles.discovered_by IS 'User who discovered this vehicle (for non-owned vehicles)';

-- Note: If PostgREST schema cache is still stale, run this in Supabase SQL Editor:
-- SELECT pg_notify('pgrst', 'reload schema');
-- OR restart the PostgREST instance from the Supabase dashboard

