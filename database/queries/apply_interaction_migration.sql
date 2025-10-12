-- This script will apply the vehicle interaction system migration
-- Run this against your remote database to create the missing tables

-- First, check if tables exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vehicle_interaction_requests') THEN
        RAISE NOTICE 'Creating vehicle_interaction_requests table...';
        
        -- Copy the migration content here
        -- You'll need to run the full migration from:
        -- supabase/migrations/20250915_vehicle_interaction_system.sql
        
    ELSE
        RAISE NOTICE 'Table vehicle_interaction_requests already exists';
    END IF;
END $$;

-- To apply this migration:
-- 1. Copy the full content from supabase/migrations/20250915_vehicle_interaction_system.sql
-- 2. Run it in the Supabase SQL editor or via command line
-- 3. The errors in the console will disappear once the tables are created
