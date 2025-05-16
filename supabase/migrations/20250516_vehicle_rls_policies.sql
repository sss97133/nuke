-- Enable Row Level Security for all tables
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for vehicles table
DROP POLICY IF EXISTS "Users can view their own vehicles" ON vehicles;
CREATE POLICY "Users can view their own vehicles" 
ON vehicles FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
CREATE POLICY "Users can insert their own vehicles" 
ON vehicles FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
CREATE POLICY "Users can update their own vehicles" 
ON vehicles FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own vehicles" ON vehicles;
CREATE POLICY "Users can delete their own vehicles" 
ON vehicles FOR DELETE 
TO authenticated
USING (auth.uid() = user_id);

-- Create policy for vehicle_timeline table
DROP POLICY IF EXISTS "Users can view timeline for their vehicles" ON vehicle_timeline;
CREATE POLICY "Users can view timeline for their vehicles" 
ON vehicle_timeline FOR SELECT 
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_timeline.vehicle_id 
    AND vehicles.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add timeline entries for their vehicles" ON vehicle_timeline;
CREATE POLICY "Users can add timeline entries for their vehicles" 
ON vehicle_timeline FOR INSERT 
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_timeline.vehicle_id 
    AND vehicles.user_id = auth.uid()
  )
);

-- Create policy for profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" 
ON profiles FOR SELECT 
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" 
ON profiles FOR UPDATE 
TO authenticated
USING (auth.uid() = id);

-- Policy to allow insert for new users - needed for registration flow
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" 
ON profiles FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = id);

-- Allow public read access to shared vehicle data (if needed)
DROP POLICY IF EXISTS "Public can view public vehicle data" ON vehicles;
CREATE POLICY "Public can view public vehicle data" 
ON vehicles FOR SELECT 
TO anon
USING (verification_level = 'blockchain');

-- Create policy for anonymous users to have limited vehicle creation
DROP POLICY IF EXISTS "Anonymous users can create initial vehicles" ON vehicles;
CREATE POLICY "Anonymous users can create initial vehicles" 
ON vehicles FOR INSERT 
TO anon
WITH CHECK (
  auth.jwt() IS NOT NULL AND 
  user_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM auth.users 
    WHERE auth.users.id = auth.uid() 
    AND (auth.users.raw_app_meta_data->>'provider')::text = 'anonymous'
  )
);

-- Add this trigger to users table to automatically create a profile
CREATE OR REPLACE FUNCTION public.create_profile_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, updated_at)
  VALUES (NEW.id, NOW())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

-- Create trigger that runs after user creation
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_user();
