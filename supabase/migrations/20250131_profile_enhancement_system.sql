-- Profile Enhancement System
-- Based on PROFILE_PIPELINE.md - GitHub-style contribution tracking and user progression

-- Profile completion tracking
CREATE TABLE profile_completion (
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

-- Achievement system for gamification
CREATE TABLE profile_achievements (
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

-- Activity feed for user actions (GitHub-style activity)
CREATE TABLE profile_activity (
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
  related_achievement_id UUID REFERENCES profile_achievements(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Aggregated user statistics
CREATE TABLE profile_stats (
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

-- User contributions tracking (GitHub-style contribution graph)
CREATE TABLE user_contributions (
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

-- Enhanced profiles table (if not exists)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  full_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  location TEXT,
  website_url TEXT,
  github_url TEXT,
  linkedin_url TEXT,
  user_type TEXT DEFAULT 'user' CHECK (user_type IN ('user', 'professional', 'dealer', 'admin')),
  is_verified BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_profile_completion_user_id ON profile_completion(user_id);
CREATE INDEX idx_profile_achievements_user_id ON profile_achievements(user_id);
CREATE INDEX idx_profile_achievements_type ON profile_achievements(achievement_type);
CREATE INDEX idx_profile_activity_user_id ON profile_activity(user_id);
CREATE INDEX idx_profile_activity_created_at ON profile_activity(created_at DESC);
CREATE INDEX idx_profile_stats_user_id ON profile_stats(user_id);
CREATE INDEX idx_user_contributions_user_id ON user_contributions(user_id);
CREATE INDEX idx_user_contributions_date ON user_contributions(contribution_date DESC);

-- Functions for profile management

-- Function to calculate profile completion percentage
CREATE OR REPLACE FUNCTION calculate_profile_completion(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  completion_count INTEGER := 0;
  total_fields INTEGER := 7; -- Number of completion fields
  completion_record profile_completion%ROWTYPE;
BEGIN
  SELECT * INTO completion_record 
  FROM profile_completion 
  WHERE user_id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Count completed fields
  IF completion_record.basic_info_complete THEN completion_count := completion_count + 1; END IF;
  IF completion_record.avatar_uploaded THEN completion_count := completion_count + 1; END IF;
  IF completion_record.bio_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.social_links_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.first_vehicle_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.skills_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.location_added THEN completion_count := completion_count + 1; END IF;
  
  RETURN (completion_count * 100) / total_fields;
END;
$$ LANGUAGE plpgsql;

-- Function to award achievements
CREATE OR REPLACE FUNCTION award_achievement(
  user_uuid UUID,
  achievement_type_param TEXT,
  achievement_title_param TEXT DEFAULT NULL,
  achievement_description_param TEXT DEFAULT NULL,
  points_param INTEGER DEFAULT 0
) RETURNS BOOLEAN AS $$
DECLARE
  default_title TEXT;
  default_description TEXT;
  default_points INTEGER;
BEGIN
  -- Set defaults based on achievement type
  CASE achievement_type_param
    WHEN 'first_vehicle' THEN
      default_title := 'First Vehicle';
      default_description := 'Added your first vehicle to the platform';
      default_points := 10;
    WHEN 'profile_complete' THEN
      default_title := 'Profile Complete';
      default_description := 'Completed your profile information';
      default_points := 25;
    WHEN 'first_image' THEN
      default_title := 'First Image';
      default_description := 'Uploaded your first vehicle image';
      default_points := 5;
    WHEN 'contributor' THEN
      default_title := 'Contributor';
      default_description := 'Made your first contribution to the platform';
      default_points := 15;
    WHEN 'vehicle_collector' THEN
      default_title := 'Vehicle Collector';
      default_description := 'Added 5 or more vehicles';
      default_points := 20;
    WHEN 'image_enthusiast' THEN
      default_title := 'Image Enthusiast';
      default_description := 'Uploaded 25 or more images';
      default_points := 15;
    WHEN 'community_member' THEN
      default_title := 'Community Member';
      default_description := 'Active community participant';
      default_points := 10;
    WHEN 'verified_user' THEN
      default_title := 'Verified User';
      default_description := 'Completed ownership verification';
      default_points := 5;
    ELSE
      default_title := 'Achievement';
      default_description := 'Earned an achievement';
      default_points := 0;
  END CASE;
  
  -- Insert achievement (will fail silently if duplicate due to UNIQUE constraint)
  INSERT INTO profile_achievements (
    user_id, achievement_type, achievement_title, achievement_description, points_awarded
  ) VALUES (
    user_uuid, 
    achievement_type_param,
    COALESCE(achievement_title_param, default_title),
    COALESCE(achievement_description_param, default_description),
    COALESCE(points_param, default_points)
  ) ON CONFLICT (user_id, achievement_type) DO NOTHING;
  
  -- Log activity
  INSERT INTO profile_activity (
    user_id, activity_type, activity_title, activity_description
  ) VALUES (
    user_uuid, 'achievement_earned', 
    'Earned: ' || COALESCE(achievement_title_param, default_title),
    COALESCE(achievement_description_param, default_description)
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

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

-- Trigger functions for automatic updates

-- Update profile completion when profiles change
CREATE OR REPLACE FUNCTION update_profile_completion_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure profile_completion record exists
  INSERT INTO profile_completion (user_id) 
  VALUES (NEW.id) 
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Update completion fields
  UPDATE profile_completion SET
    basic_info_complete = (NEW.full_name IS NOT NULL AND NEW.full_name != ''),
    avatar_uploaded = (NEW.avatar_url IS NOT NULL AND NEW.avatar_url != ''),
    bio_added = (NEW.bio IS NOT NULL AND NEW.bio != ''),
    location_added = (NEW.location IS NOT NULL AND NEW.location != ''),
    social_links_added = (NEW.website_url IS NOT NULL OR NEW.github_url IS NOT NULL OR NEW.linkedin_url IS NOT NULL),
    last_updated = NOW()
  WHERE user_id = NEW.id;
  
  -- Update completion percentage
  UPDATE profile_completion SET
    total_completion_percentage = calculate_profile_completion(NEW.id)
  WHERE user_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update stats when vehicles change
CREATE OR REPLACE FUNCTION update_profile_stats_on_vehicle_change()
RETURNS TRIGGER AS $$
DECLARE
  user_uuid UUID;
  vehicle_count INTEGER;
BEGIN
  -- Determine user_id based on operation
  IF TG_OP = 'DELETE' THEN
    user_uuid := OLD.user_id;
  ELSE
    user_uuid := NEW.user_id;
  END IF;
  
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
    updated_at = NOW()
  WHERE user_id = user_uuid;
  
  -- Award achievements
  IF TG_OP = 'INSERT' THEN
    -- First vehicle achievement
    IF vehicle_count = 1 THEN
      PERFORM award_achievement(user_uuid, 'first_vehicle');
      
      -- Update profile completion
      UPDATE profile_completion SET
        first_vehicle_added = true,
        last_updated = NOW()
      WHERE user_id = user_uuid;
    END IF;
    
    -- Vehicle collector achievement
    IF vehicle_count >= 5 THEN
      PERFORM award_achievement(user_uuid, 'vehicle_collector');
    END IF;
    
    -- Log contribution
    PERFORM log_contribution(user_uuid, 'vehicle_data', NEW.id);
    
    -- Log activity
    INSERT INTO profile_activity (
      user_id, activity_type, activity_title, activity_description, related_vehicle_id
    ) VALUES (
      user_uuid, 'vehicle_added', 
      'Added vehicle: ' || NEW.year || ' ' || NEW.make || ' ' || NEW.model,
      'Added a new vehicle to their collection',
      NEW.id
    );
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER profile_completion_trigger
  AFTER INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_completion_trigger();

CREATE TRIGGER vehicle_stats_trigger
  AFTER INSERT OR DELETE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_stats_on_vehicle_change();

-- Row Level Security (RLS) Policies

-- Profile completion - users can only see their own
ALTER TABLE profile_completion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile completion" ON profile_completion
  FOR SELECT USING (auth.uid() = user_id);

-- Achievements - public read, own write
ALTER TABLE profile_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view achievements" ON profile_achievements
  FOR SELECT USING (true);

-- Activity feed - public read (simplified)
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view activity" ON profile_activity
  FOR SELECT USING (true);

-- Stats - public read (simplified)
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view stats" ON profile_stats
  FOR SELECT USING (true);

-- Contributions - public read (simplified)
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view contributions" ON user_contributions
  FOR SELECT USING (true);

-- Profiles - public read, own write
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view profiles" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Comments for documentation
COMMENT ON TABLE profile_completion IS 'Tracks user profile completion progress for onboarding and gamification';
COMMENT ON TABLE profile_achievements IS 'Achievement system for user engagement and gamification';
COMMENT ON TABLE profile_activity IS 'Activity feed showing user actions and contributions';
COMMENT ON TABLE profile_stats IS 'Aggregated statistics for user profiles and leaderboards';
COMMENT ON TABLE user_contributions IS 'GitHub-style contribution tracking for user activity visualization';
COMMENT ON TABLE profiles IS 'Enhanced user profiles with social features and customization options';
