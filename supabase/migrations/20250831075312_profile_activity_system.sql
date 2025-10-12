-- Profile Activity System for Remote Database
-- Creates profile activity tables and triggers

-- Create profile_activity table
CREATE TABLE IF NOT EXISTS profile_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Activity details
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'vehicle_added', 'profile_updated', 'image_uploaded', 'achievement_earned',
    'contribution_made', 'verification_completed', 'timeline_event_added'
  )),
  activity_title TEXT NOT NULL,
  activity_description TEXT,
  
  -- Related entities
  related_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create profile_stats table
CREATE TABLE IF NOT EXISTS profile_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  
  -- Core stats
  total_vehicles INTEGER DEFAULT 0,
  total_images INTEGER DEFAULT 0,
  total_contributions INTEGER DEFAULT 0,
  total_timeline_events INTEGER DEFAULT 0,
  total_verifications INTEGER DEFAULT 0,
  
  -- Social stats
  profile_views INTEGER DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  
  -- Activity tracking
  last_activity TIMESTAMP,
  total_points INTEGER DEFAULT 0,
  reputation_score INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create user_contributions table
CREATE TABLE IF NOT EXISTS user_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Contribution data
  contribution_date DATE NOT NULL,
  contribution_type TEXT NOT NULL CHECK (contribution_type IN (
    'vehicle_data', 'image_upload', 'timeline_event', 'verification', 'annotation'
  )),
  contribution_count INTEGER DEFAULT 1,
  
  -- Related entities
  related_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate daily contributions of same type
  UNIQUE(user_id, contribution_date, contribution_type, related_vehicle_id)
);

-- Create profile_achievements table
CREATE TABLE IF NOT EXISTS profile_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Achievement details
  achievement_type TEXT NOT NULL CHECK (achievement_type IN (
    'first_vehicle', 'profile_complete', 'first_image', 'contributor', 
    'vehicle_collector', 'image_enthusiast', 'community_member', 'verified_user'
  )),
  achievement_title TEXT NOT NULL,
  achievement_description TEXT,
  icon_url TEXT,
  points_awarded INTEGER DEFAULT 0,
  
  -- Timing
  earned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Prevent duplicate achievements
  UNIQUE(user_id, achievement_type)
);

-- Create profile_completion table
CREATE TABLE IF NOT EXISTS profile_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  
  -- Completion tracking fields
  basic_info_complete BOOLEAN DEFAULT false,
  avatar_uploaded BOOLEAN DEFAULT false,
  bio_added BOOLEAN DEFAULT false,
  social_links_added BOOLEAN DEFAULT false,
  first_vehicle_added BOOLEAN DEFAULT false,
  skills_added BOOLEAN DEFAULT false,
  location_added BOOLEAN DEFAULT false,
  
  -- Calculated completion
  total_completion_percentage INTEGER DEFAULT 0 CHECK (total_completion_percentage >= 0 AND total_completion_percentage <= 100),
  
  created_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_activity_user_id ON profile_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_created_at ON profile_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_stats_user_id ON profile_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contributions_user_id ON user_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contributions_date ON user_contributions(contribution_date DESC);
CREATE INDEX IF NOT EXISTS idx_profile_achievements_user_id ON profile_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_completion_user_id ON profile_completion(user_id);

-- Function to log user contributions
CREATE OR REPLACE FUNCTION log_contribution(
  user_uuid UUID,
  contribution_type_param TEXT,
  related_vehicle_uuid UUID DEFAULT NULL,
  contribution_metadata JSONB DEFAULT '{}'
) RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO user_contributions (
    user_id, contribution_date, contribution_type, 
    related_vehicle_id, metadata
  ) VALUES (
    user_uuid, CURRENT_DATE, contribution_type_param,
    related_vehicle_uuid, contribution_metadata
  ) ON CONFLICT (user_id, contribution_date, contribution_type, related_vehicle_id) 
  DO UPDATE SET 
    contribution_count = user_contributions.contribution_count + 1,
    metadata = contribution_metadata;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to create profile activity when vehicles are added
CREATE OR REPLACE FUNCTION create_vehicle_activity()
RETURNS TRIGGER AS $$
DECLARE
  user_uuid UUID;
  vehicle_count INTEGER;
  activity_title TEXT;
BEGIN
  user_uuid := NEW.user_id;
  
  -- Count user's vehicles
  SELECT COUNT(*) INTO vehicle_count 
  FROM vehicles 
  WHERE user_id = user_uuid;
  
  -- Ensure profile_stats record exists
  INSERT INTO profile_stats (user_id) 
  VALUES (user_uuid) 
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Update vehicle count
  UPDATE profile_stats SET
    total_vehicles = vehicle_count,
    last_activity = NOW(),
    updated_at = NOW()
  WHERE user_id = user_uuid;
  
  -- Create activity title
  activity_title := 'Added vehicle';
  IF NEW.year IS NOT NULL OR NEW.make IS NOT NULL OR NEW.model IS NOT NULL THEN
    activity_title := 'Added vehicle: ' || 
      COALESCE(NEW.year::text, '') || 
      CASE WHEN NEW.year IS NOT NULL AND (NEW.make IS NOT NULL OR NEW.model IS NOT NULL) THEN ' ' ELSE '' END ||
      COALESCE(NEW.make, '') ||
      CASE WHEN NEW.make IS NOT NULL AND NEW.model IS NOT NULL THEN ' ' ELSE '' END ||
      COALESCE(NEW.model, '');
  END IF;
  
  -- Log contribution
  PERFORM log_contribution(user_uuid, 'vehicle_data', NEW.id);
  
  -- Log activity
  INSERT INTO profile_activity (
    user_id, activity_type, activity_title, activity_description, related_vehicle_id, metadata
  ) VALUES (
    user_uuid, 'vehicle_added', 
    activity_title,
    'Added a new vehicle to their collection',
    NEW.id,
    jsonb_build_object(
      'vehicle_id', NEW.id,
      'make', NEW.make,
      'model', NEW.model,
      'year', NEW.year,
      'vin', NEW.vin
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS vehicle_activity_trigger ON vehicles;

-- Create trigger for vehicle additions
CREATE TRIGGER vehicle_activity_trigger
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION create_vehicle_activity();

-- Row Level Security (RLS) Policies

-- Activity - public read
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view activity" ON profile_activity;
CREATE POLICY "Anyone can view activity" ON profile_activity
  FOR SELECT USING (true);

-- Stats - public read
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view stats" ON profile_stats;
CREATE POLICY "Anyone can view stats" ON profile_stats
  FOR SELECT USING (true);

-- Contributions - public read
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view contributions" ON user_contributions;
CREATE POLICY "Anyone can view contributions" ON user_contributions
  FOR SELECT USING (true);

-- Achievements - public read
ALTER TABLE profile_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view achievements" ON profile_achievements;
CREATE POLICY "Anyone can view achievements" ON profile_achievements
  FOR SELECT USING (true);

-- Profile completion - users can only see their own
ALTER TABLE profile_completion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile completion" ON profile_completion;
CREATE POLICY "Users can view own profile completion" ON profile_completion
  FOR SELECT USING (auth.uid() = user_id);