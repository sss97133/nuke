-- Fix the trigger that's looking for profile_id instead of user_id
-- This is causing the "column profile_id does not exist" error

-- Drop the existing trigger function if it exists
DROP FUNCTION IF EXISTS handle_vehicle_activity CASCADE;

-- Recreate the function with the correct column reference
CREATE OR REPLACE FUNCTION handle_vehicle_activity()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Create profile if it doesn't exist
    INSERT INTO profiles (id, email, username)
    VALUES (
      NEW.user_id,
      (SELECT email FROM auth.users WHERE id = NEW.user_id),
      (SELECT email FROM auth.users WHERE id = NEW.user_id)
    )
    ON CONFLICT (id) DO NOTHING;
    
    -- Update profile stats - use user_id, not profile_id
    UPDATE profile_stats
    SET vehicles_added = vehicles_added + 1
    WHERE profile_id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_vehicle_activity ON vehicles;
CREATE TRIGGER on_vehicle_activity
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION handle_vehicle_activity();
