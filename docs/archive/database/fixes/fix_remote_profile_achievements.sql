-- Create profile_achievements table on remote Supabase
CREATE TABLE IF NOT EXISTS profile_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL CHECK (achievement_type IN (
    'first_vehicle', 'profile_complete', 'first_image', 'contributor', 
    'vehicle_collector', 'image_enthusiast', 'community_member', 'verified_user'
  )),
  achievement_title TEXT NOT NULL,
  achievement_description TEXT,
  icon_url TEXT,
  points_awarded INTEGER DEFAULT 0,
  earned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_type)
);

-- Create profile_completion table
CREATE TABLE IF NOT EXISTS profile_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  basic_info_complete BOOLEAN DEFAULT false,
  avatar_uploaded BOOLEAN DEFAULT false,
  bio_added BOOLEAN DEFAULT false,
  social_links_added BOOLEAN DEFAULT false,
  first_vehicle_added BOOLEAN DEFAULT false,
  skills_added BOOLEAN DEFAULT false,
  location_added BOOLEAN DEFAULT false,
  total_completion_percentage INTEGER DEFAULT 0 CHECK (total_completion_percentage >= 0 AND total_completion_percentage <= 100),
  created_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Create profile_stats table
CREATE TABLE IF NOT EXISTS profile_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  vehicles_count INTEGER DEFAULT 0,
  images_count INTEGER DEFAULT 0,
  verifications_count INTEGER DEFAULT 0,
  contributions_count INTEGER DEFAULT 0,
  total_vehicles INTEGER DEFAULT 0,
  total_images INTEGER DEFAULT 0,
  total_contributions INTEGER DEFAULT 0,
  last_activity TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create profile_activity table
CREATE TABLE IF NOT EXISTS profile_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  activity_description TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_achievements_user_id ON profile_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_achievements_type ON profile_achievements(achievement_type);
CREATE INDEX IF NOT EXISTS idx_profile_completion_user_id ON profile_completion(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_stats_user_id ON profile_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_user_id ON profile_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_created_at ON profile_activity(created_at DESC);
