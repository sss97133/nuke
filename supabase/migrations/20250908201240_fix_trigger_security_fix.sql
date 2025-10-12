-- Fix vehicle_activity_trigger to work with RLS
-- SECURITY DEFINER makes the function run with the privileges of the owner (usually postgres)
-- This allows the trigger to insert into user_contributions despite RLS

-- Drop existing function to recreate with SECURITY DEFINER
DROP FUNCTION IF EXISTS handle_vehicle_activity CASCADE;

-- Recreate with SECURITY DEFINER
CREATE OR REPLACE FUNCTION handle_vehicle_activity()
RETURNS TRIGGER
SECURITY DEFINER  -- This is the fix!
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert into user_contributions when a vehicle is added
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_contributions (
      user_id,
      contribution_date,
      contribution_type,
      contribution_count,
      related_vehicle_id,
      metadata
    ) VALUES (
      NEW.user_id,
      CURRENT_DATE,
      'vehicle_data',
      1,
      NEW.id,
      jsonb_build_object(
        'action', 'added_vehicle',
        'vehicle_info', jsonb_build_object(
          'make', NEW.make,
          'model', NEW.model,
          'year', NEW.year
        )
      )
    );
    
    -- Update profile stats
    UPDATE profile_stats
    SET vehicles_added = vehicles_added + 1
    WHERE profile_id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER vehicle_activity_trigger
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION handle_vehicle_activity();

-- Also fix any other triggers that might have the same issue
-- Check if there's a profile creation trigger
DROP FUNCTION IF EXISTS handle_new_user CASCADE;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Create profile if it doesn't exist
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  
  -- Create profile_stats if it doesn't exist
  INSERT INTO profile_stats (profile_id)
  VALUES (NEW.id)
  ON CONFLICT (profile_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger exists on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
