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
  USING (is_public = true);

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
      SELECT 1 FROM vehicle_user_permissions vup
      WHERE vup.vehicle_id = vehicles.id
        AND vup.user_id = auth.uid()
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
    )
  )
  WITH CHECK (
    auth.uid() = user_id 
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM vehicle_user_permissions vup
      WHERE vup.vehicle_id = vehicles.id
        AND vup.user_id = auth.uid()
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
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

-- Enable RLS on profiles and allow public read
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view all profiles" ON profiles;
CREATE POLICY "Public can view all profiles"
  ON profiles
  FOR SELECT
  USING (is_public = true);

-- Users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'timeline_events'
  ) THEN
    ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Public can view all timeline events" ON timeline_events;
    CREATE POLICY "Public can view all timeline events"
      ON timeline_events
      FOR SELECT
      USING (true);

    DROP POLICY IF EXISTS "Authenticated users can create timeline events" ON timeline_events;
    CREATE POLICY "Authenticated users can create timeline events"
      ON timeline_events
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
