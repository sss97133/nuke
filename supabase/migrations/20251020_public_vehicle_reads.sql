-- ===================================================================
-- PUBLIC VEHICLE READS - October 20, 2025
-- Enables anonymous users to view all vehicles publicly
-- ===================================================================

-- Enable RLS on vehicles if not already enabled
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Allow public read access to vehicles
DROP POLICY IF EXISTS "Public can view all vehicles" ON vehicles;
CREATE POLICY "Public can view all vehicles"
  ON vehicles
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert their own vehicles
DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON vehicles;
CREATE POLICY "Authenticated users can create vehicles"
  ON vehicles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow owners and contributors to update vehicles
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
CREATE POLICY "Users can update their own vehicles"
  ON vehicles
  FOR UPDATE
  USING (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM vehicle_contributors 
      WHERE vehicle_id = vehicles.id 
      AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM vehicle_contributors 
      WHERE vehicle_id = vehicles.id 
      AND user_id = auth.uid()
    )
  );

-- Allow owners to delete vehicles
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON vehicles;
CREATE POLICY "Users can delete their own vehicles"
  ON vehicles
  FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = owner_id);

-- Enable RLS on vehicle_images and allow public read
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view all vehicle images" ON vehicle_images;
CREATE POLICY "Public can view all vehicle images"
  ON vehicle_images
  FOR SELECT
  USING (true);

-- Enable RLS on vehicle_timeline_events and allow public read
ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view all timeline events" ON vehicle_timeline_events;
CREATE POLICY "Public can view all timeline events"
  ON vehicle_timeline_events
  FOR SELECT
  USING (true);

-- Allow creators to insert and manage their own events
DROP POLICY IF EXISTS "Authenticated users can create timeline events" ON vehicle_timeline_events;
CREATE POLICY "Authenticated users can create timeline events"
  ON vehicle_timeline_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on profiles and allow public read
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view all profiles" ON profiles;
CREATE POLICY "Public can view all profiles"
  ON profiles
  FOR SELECT
  USING (true);

-- Users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
