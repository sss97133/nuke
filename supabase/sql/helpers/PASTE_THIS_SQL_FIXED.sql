-- First drop the existing trigger
DROP TRIGGER IF EXISTS vehicle_activity_trigger ON vehicles;

-- Drop and recreate the function with SECURITY DEFINER
DROP FUNCTION IF EXISTS handle_vehicle_activity CASCADE;

CREATE OR REPLACE FUNCTION handle_vehicle_activity()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
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
    SET vehicles_count = vehicles_count + 1
    WHERE user_id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Now create the trigger
CREATE TRIGGER vehicle_activity_trigger
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION handle_vehicle_activity();
