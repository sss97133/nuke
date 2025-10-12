-- Fix remote database schema to match local development
-- Run this in Supabase Dashboard SQL Editor

-- 1. Fix profiles table - add missing columns
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS github_url TEXT,
ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'user',
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- 2. Create profile_completion table
CREATE TABLE IF NOT EXISTS profile_completion (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  completion_percentage INTEGER DEFAULT 0,
  missing_fields TEXT[],
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create profile_stats table
CREATE TABLE IF NOT EXISTS profile_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  total_points INTEGER DEFAULT 0,
  vehicles_contributed INTEGER DEFAULT 0,
  verifications_completed INTEGER DEFAULT 0,
  images_uploaded INTEGER DEFAULT 0,
  timeline_events INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create profile_activity table
CREATE TABLE IF NOT EXISTS profile_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  activity_title TEXT,
  activity_description TEXT,
  related_vehicle_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create profile_achievements table
CREATE TABLE IF NOT EXISTS profile_achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  points INTEGER DEFAULT 0,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- 6. Create user_contributions table
CREATE TABLE IF NOT EXISTS user_contributions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contribution_type TEXT NOT NULL,
  contribution_date DATE DEFAULT CURRENT_DATE,
  count INTEGER DEFAULT 1,
  related_vehicle_id UUID,
  metadata JSONB DEFAULT '{}'
);

-- 7. Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;

-- 8. Create RLS policies
-- Profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id OR is_public = true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Profile completion policies
DROP POLICY IF EXISTS "Users can view own completion" ON profile_completion;
CREATE POLICY "Users can view own completion" ON profile_completion
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own completion" ON profile_completion;
CREATE POLICY "Users can update own completion" ON profile_completion
  FOR ALL USING (auth.uid() = user_id);

-- Profile stats policies
DROP POLICY IF EXISTS "Users can view own stats" ON profile_stats;
CREATE POLICY "Users can view own stats" ON profile_stats
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own stats" ON profile_stats;
CREATE POLICY "Users can update own stats" ON profile_stats
  FOR ALL USING (auth.uid() = user_id);

-- Profile activity policies
DROP POLICY IF EXISTS "Users can view own activity" ON profile_activity;
CREATE POLICY "Users can view own activity" ON profile_activity
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own activity" ON profile_activity;
CREATE POLICY "Users can insert own activity" ON profile_activity
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Profile achievements policies
DROP POLICY IF EXISTS "Users can view own achievements" ON profile_achievements;
CREATE POLICY "Users can view own achievements" ON profile_achievements
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own achievements" ON profile_achievements;
CREATE POLICY "Users can insert own achievements" ON profile_achievements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User contributions policies
DROP POLICY IF EXISTS "Users can view own contributions" ON user_contributions;
CREATE POLICY "Users can view own contributions" ON user_contributions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own contributions" ON user_contributions;
CREATE POLICY "Users can insert own contributions" ON user_contributions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 9. Create profile creation trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, created_at, updated_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    now(),
    now()
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 10. Manually create profile for existing user (if needed)
-- This handles the case where user already exists but has no profile
INSERT INTO public.profiles (id, full_name, email, avatar_url, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  u.email,
  u.raw_user_meta_data->>'avatar_url',
  now(),
  now()
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- 11. Create storage buckets and policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'vehicle-images') THEN
    PERFORM storage.create_bucket('vehicle-images', public := true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'vehicle-data') THEN
    PERFORM storage.create_bucket('vehicle-data', public := true);
  END IF;
END $$;

-- Storage policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_authenticated_uploads_vehicle_images'
  ) THEN
    CREATE POLICY "allow_authenticated_uploads_vehicle_images"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vehicle-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_authenticated_uploads_vehicle_data'
  ) THEN
    CREATE POLICY "allow_authenticated_uploads_vehicle_data"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vehicle-data');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_public_read_vehicle_images'
  ) THEN
    CREATE POLICY "allow_public_read_vehicle_images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'vehicle-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_public_read_vehicle_data'
  ) THEN
    CREATE POLICY "allow_public_read_vehicle_data"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'vehicle-data');
  END IF;
END $$;
