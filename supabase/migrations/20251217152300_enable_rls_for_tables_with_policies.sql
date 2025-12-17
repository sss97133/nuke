-- Enable RLS on tables that have policies but RLS is disabled
-- This fixes the "Policy Exists RLS Disabled" security issue identified by Supabase advisors
-- 
-- Tables affected:
-- - image_set_members
-- - image_sets  
-- - image_vehicle_mismatches
-- - market_data
-- - receipts
-- - user_preferences
-- - vehicle_builds
-- - vehicle_interaction_requests
-- - vehicle_interaction_sessions

BEGIN;

-- Enable RLS on image_sets (even if already enabled, this is idempotent)
ALTER TABLE IF EXISTS image_sets ENABLE ROW LEVEL SECURITY;

-- Enable RLS on image_set_members (even if already enabled, this is idempotent)
ALTER TABLE IF EXISTS image_set_members ENABLE ROW LEVEL SECURITY;

-- Enable RLS on image_vehicle_mismatches
ALTER TABLE IF EXISTS image_vehicle_mismatches ENABLE ROW LEVEL SECURITY;

-- Enable RLS on market_data
ALTER TABLE IF EXISTS market_data ENABLE ROW LEVEL SECURITY;

-- Enable RLS on receipts
ALTER TABLE IF EXISTS receipts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on user_preferences
ALTER TABLE IF EXISTS user_preferences ENABLE ROW LEVEL SECURITY;

-- Enable RLS on vehicle_builds
ALTER TABLE IF EXISTS vehicle_builds ENABLE ROW LEVEL SECURITY;

-- Enable RLS on vehicle_interaction_requests
ALTER TABLE IF EXISTS vehicle_interaction_requests ENABLE ROW LEVEL SECURITY;

-- Enable RLS on vehicle_interaction_sessions
ALTER TABLE IF EXISTS vehicle_interaction_sessions ENABLE ROW LEVEL SECURITY;

COMMIT;

