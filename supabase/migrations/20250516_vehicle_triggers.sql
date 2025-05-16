-- Create a database trigger to ensure every user has an initial vehicle
-- This aligns with the vehicle-centric architecture where vehicles are first-class entities

-- Function to create an initial vehicle for new users
CREATE OR REPLACE FUNCTION public.ensure_user_vehicle()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_exists BOOLEAN;
  new_vehicle_id UUID;
BEGIN
  -- Check if user already has a vehicle
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles 
    WHERE user_id = NEW.id
  ) INTO vehicle_exists;
  
  -- Only create a vehicle if the user doesn't have one
  IF NOT vehicle_exists THEN
    INSERT INTO public.vehicles (
      id,
      user_id,
      make,
      model,
      year,
      trust_score,
      verification_level,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      NEW.id,
      'New',
      'Vehicle', 
      EXTRACT(YEAR FROM NOW())::integer,
      50,
      1,
      NOW(),
      NOW()
    )
    RETURNING id INTO new_vehicle_id;
    
    -- Log creation for debugging
    RAISE NOTICE 'Created initial vehicle % for user %', new_vehicle_id, NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that runs after user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_user_vehicle();

-- Ensure RLS policies for vehicles are in place
DROP POLICY IF EXISTS "Users can view their own vehicles" ON vehicles;
CREATE POLICY "Users can view their own vehicles" 
ON vehicles FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own vehicles" ON vehicles;
CREATE POLICY "Users can create their own vehicles" 
ON vehicles FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
CREATE POLICY "Users can update their own vehicles" 
ON vehicles FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

-- Function to create a vehicle profile for users who don't have one
CREATE OR REPLACE FUNCTION public.ensure_user_has_vehicle(user_uuid UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  vehicle_exists BOOLEAN;
  new_vehicle_id UUID;
BEGIN
  -- Check if user already has a vehicle
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles 
    WHERE user_id = user_uuid
  ) INTO vehicle_exists;
  
  -- Only create a vehicle if the user doesn't have one
  IF NOT vehicle_exists THEN
    INSERT INTO public.vehicles (
      id,
      user_id,
      make,
      model,
      year,
      trust_score,
      verification_level,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      user_uuid,
      'New',
      'Vehicle', 
      EXTRACT(YEAR FROM NOW())::integer,
      50,
      1,
      NOW(),
      NOW()
    )
    RETURNING id INTO new_vehicle_id;
    
    RETURN new_vehicle_id;
  ELSE
    -- Get an existing vehicle id
    SELECT id INTO new_vehicle_id 
    FROM public.vehicles 
    WHERE user_id = user_uuid 
    LIMIT 1;
    
    RETURN new_vehicle_id;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.ensure_user_has_vehicle TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_has_vehicle TO anon;
