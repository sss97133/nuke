-- This migration adds vehicle-centric functions to support the authentication flow

-- Function to check if a user has any vehicles
CREATE OR REPLACE FUNCTION public.has_vehicles(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  vehicle_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO vehicle_count
  FROM public.vehicles
  WHERE user_id = user_uuid;
  
  RETURN vehicle_count > 0;
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.has_vehicles TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_vehicles TO anon;

-- Function to add a test vehicle (for initial setup)
CREATE OR REPLACE FUNCTION public.add_test_vehicle(
  user_uuid UUID,
  vehicle_make TEXT DEFAULT 'Test',
  vehicle_model TEXT DEFAULT 'Model',
  vehicle_year INTEGER DEFAULT 2023
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_vehicle_id UUID;
BEGIN
  INSERT INTO public.vehicles (
    id,
    user_id,
    make,
    model,
    year,
    trust_score,
    verification_level
  ) VALUES (
    gen_random_uuid(),
    user_uuid,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    50, -- default trust score
    1 -- default verification level
  )
  RETURNING id INTO new_vehicle_id;
  
  RETURN new_vehicle_id;
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.add_test_vehicle TO authenticated;
