-- Create Admin Function for Test Vehicle Creation
-- This function bypasses RLS and creates a test vehicle for timeline testing

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the function that will allow creating test vehicles with proper admin privileges
CREATE OR REPLACE FUNCTION public.admin_create_test_vehicle(test_vin TEXT, test_user_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- This is critical - allows function to run with definer's permissions
AS $$
DECLARE
  new_vehicle_id UUID;
  default_user_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- Use provided user_id or default if null
  IF test_user_id IS NULL THEN
    test_user_id := default_user_id;
  END IF;

  -- Check if a vehicle with this VIN already exists
  SELECT id INTO new_vehicle_id FROM vehicles WHERE vin = test_vin LIMIT 1;
  
  -- If vehicle exists, return its ID
  IF FOUND THEN
    RETURN new_vehicle_id;
  END IF;
  
  -- Create new test vehicle with SECURITY DEFINER privileges (bypasses RLS)
  INSERT INTO vehicles (
    id,
    vin, 
    make, 
    model, 
    year,
    user_id,
    created_at
  ) VALUES (
    uuid_generate_v4(),
    test_vin,
    'Test',
    'Timeline Tester',
    2024,
    test_user_id,
    NOW()
  )
  RETURNING id INTO new_vehicle_id;
  
  RETURN new_vehicle_id;
END;
$$;

-- Grant execute permission to authenticated users and anon
GRANT EXECUTE ON FUNCTION public.admin_create_test_vehicle TO authenticated, anon;
