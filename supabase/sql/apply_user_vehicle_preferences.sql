-- Apply User Vehicle Preferences Table
-- Run this in Supabase SQL Editor to create the table if it doesn't exist

-- Check if table exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'user_vehicle_preferences'
  ) THEN
    RAISE NOTICE 'Creating user_vehicle_preferences table...';
    
    -- Create table
    CREATE TABLE user_vehicle_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      
      -- Manual organization
      is_favorite BOOLEAN DEFAULT false,
      is_hidden BOOLEAN DEFAULT false,  -- Hide from personal view (still visible in org context)
      collection_name TEXT,  -- Custom collection name (null = not in collection)
      notes TEXT,  -- Personal notes about this vehicle
      
      -- Display preferences
      display_order INTEGER DEFAULT 0,  -- Custom sort order within collections
      
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      
      UNIQUE(user_id, vehicle_id)
    );

    -- Create indexes
    CREATE INDEX idx_user_vehicle_prefs_user ON user_vehicle_preferences(user_id);
    CREATE INDEX idx_user_vehicle_prefs_vehicle ON user_vehicle_preferences(vehicle_id);
    CREATE INDEX idx_user_vehicle_prefs_favorite ON user_vehicle_preferences(user_id, is_favorite) WHERE is_favorite = true;
    CREATE INDEX idx_user_vehicle_prefs_hidden ON user_vehicle_preferences(user_id, is_hidden) WHERE is_hidden = true;
    CREATE INDEX idx_user_vehicle_prefs_collection ON user_vehicle_preferences(user_id, collection_name) WHERE collection_name IS NOT NULL;

    -- Create updated_at trigger function if it doesn't exist
    CREATE OR REPLACE FUNCTION update_user_vehicle_prefs_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Create trigger
    CREATE TRIGGER update_user_vehicle_prefs_updated_at
      BEFORE UPDATE ON user_vehicle_preferences
      FOR EACH ROW
      EXECUTE FUNCTION update_user_vehicle_prefs_updated_at();

    -- Enable RLS
    ALTER TABLE user_vehicle_preferences ENABLE ROW LEVEL SECURITY;

    -- Create RLS policies
    CREATE POLICY "view_own_vehicle_preferences" ON user_vehicle_preferences
      FOR SELECT USING (user_id = auth.uid());

    CREATE POLICY "create_own_vehicle_preferences" ON user_vehicle_preferences
      FOR INSERT WITH CHECK (user_id = auth.uid());

    CREATE POLICY "update_own_vehicle_preferences" ON user_vehicle_preferences
      FOR UPDATE USING (user_id = auth.uid());

    CREATE POLICY "delete_own_vehicle_preferences" ON user_vehicle_preferences
      FOR DELETE USING (user_id = auth.uid());

    RAISE NOTICE '✅ user_vehicle_preferences table created successfully!';
  ELSE
    RAISE NOTICE '✅ user_vehicle_preferences table already exists';
  END IF;
END $$;

-- Verify table was created
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'user_vehicle_preferences' AND table_schema = 'public') as column_count
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'user_vehicle_preferences';

