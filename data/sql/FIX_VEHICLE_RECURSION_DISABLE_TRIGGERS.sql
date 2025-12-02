-- ==========================================================================
-- EMERGENCY FIX: DISABLE TRIGGERS CAUSING RECURSION
-- ==========================================================================
-- Problem: Triggers that UPDATE vehicles table during UPDATE cause RLS recursion
-- Solution: Temporarily disable problematic triggers
-- ==========================================================================

-- Disable the trigger that updates vehicles table from within an update trigger
ALTER TABLE vehicles DISABLE TRIGGER trigger_check_vehicle_vin_on_update;

-- Also check if there's a quality check trigger that might be problematic
-- (The quality check trigger shouldn't cause recursion as it only updates vehicle_quality_scores, not vehicles)
-- But let's also make sure the completion trigger doesn't cause issues
-- The completion trigger modifies NEW.completion_percentage which shouldn't cause recursion

-- Verify triggers are disabled
SELECT 
  trigger_name, 
  event_manipulation,
  action_timing,
  action_condition,
  action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'vehicles'
  AND trigger_name IN ('trigger_check_vehicle_vin_on_update')
ORDER BY trigger_name;

-- Show all active triggers on vehicles
SELECT 
  trigger_name, 
  event_manipulation,
  action_timing
FROM information_schema.triggers 
WHERE event_object_table = 'vehicles'
ORDER BY trigger_name;

