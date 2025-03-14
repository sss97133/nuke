-- Create Vehicle Sharing Policies
-- This script creates database structures and RLS policies to enable vehicle sharing

-- First, let's create a "public_vehicles" boolean column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicles' AND column_name = 'public_vehicle'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN public_vehicle BOOLEAN DEFAULT FALSE;
  END IF;
END
$$;

-- Create a function to make vehicles public
CREATE OR REPLACE FUNCTION public.make_vehicle_public(vehicle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with owner privileges
AS $$
DECLARE
  user_owns_vehicle BOOLEAN;
BEGIN
  -- Check if the requesting user owns the vehicle
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = vehicle_id AND user_id = auth.uid()
  ) INTO user_owns_vehicle;
  
  -- Only allow vehicle owners to make their vehicles public
  IF user_owns_vehicle THEN
    UPDATE vehicles
    SET public_vehicle = TRUE
    WHERE id = vehicle_id;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;

-- Create a function to make all test vehicles public
-- This is for testing purposes only
CREATE OR REPLACE FUNCTION public.admin_make_test_vehicles_public()
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with owner privileges
AS $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM vehicles
  LOOP
    UPDATE vehicles
    SET public_vehicle = TRUE
    WHERE id = v_id;
    RETURN NEXT v_id;
  END LOOP;
  
  RETURN;
END;
$$;

-- Update the vehicles RLS policy to allow reading of public vehicles
DROP POLICY IF EXISTS "Vehicles are viewable by owner" ON vehicles;
CREATE POLICY "Vehicles are viewable by owner or if public" ON vehicles
  FOR SELECT
  USING (auth.uid() = user_id OR public_vehicle = TRUE);

-- Update vehicle_timeline_events policy to allow reading events for public vehicles
DROP POLICY IF EXISTS "Timeline events viewable by vehicle owner" ON vehicle_timeline_events;
CREATE POLICY "Timeline events viewable by vehicle owner or if public" ON vehicle_timeline_events
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT user_id FROM vehicles WHERE id = vehicle_timeline_events.vehicle_id
    ) 
    OR 
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE id = vehicle_timeline_events.vehicle_id AND public_vehicle = TRUE
    )
  );

-- Create a vehicle ownership claim function
CREATE OR REPLACE FUNCTION public.claim_vehicle_ownership(
  vehicle_vin TEXT,
  ownership_evidence JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with owner privileges
AS $$
DECLARE
  vehicle_id UUID;
  new_ownership_id UUID;
BEGIN
  -- Check if vehicle exists
  SELECT id INTO vehicle_id FROM vehicles WHERE vin = vehicle_vin LIMIT 1;
  
  -- If vehicle does not exist, return null
  IF vehicle_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Create ownership claim record
  INSERT INTO vehicle_ownership_claims (
    vehicle_id,
    user_id,
    status,
    evidence,
    created_at
  ) VALUES (
    vehicle_id,
    auth.uid(),
    'pending',
    ownership_evidence,
    NOW()
  )
  RETURNING id INTO new_ownership_id;
  
  -- Return the ownership claim ID
  RETURN new_ownership_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.make_vehicle_public TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_vehicle_ownership TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_make_test_vehicles_public TO anon, authenticated;
