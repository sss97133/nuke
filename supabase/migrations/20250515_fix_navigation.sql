-- Function to check if a user has any vehicles (without test data)
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

-- Emergency function to fix stuck navigation
CREATE OR REPLACE FUNCTION public.fix_user_navigation(user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  profile_exists BOOLEAN;
BEGIN
  -- Check if profile exists
  SELECT EXISTS(
    SELECT 1 FROM public.profiles WHERE id = user_uuid
  ) INTO profile_exists;
  
  -- Create profile if it doesn't exist
  IF NOT profile_exists THEN
    INSERT INTO public.profiles (id, onboarding_completed, onboarding_step)
    VALUES (user_uuid, false, 0);
  END IF;
  
  -- Success
  RETURN TRUE;
END;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.fix_user_navigation TO authenticated;
GRANT EXECUTE ON FUNCTION public.fix_user_navigation TO service_role;
