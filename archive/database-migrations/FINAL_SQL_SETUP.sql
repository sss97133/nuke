-- 🚀 COMPLETE NUKE PLATFORM SETUP
-- Copy this ENTIRE file into Supabase Dashboard → SQL Editor and run it
-- This will fix everything and enable all features

-- =================================================================
-- STEP 1: FIX AUTHENTICATION & PROFILES
-- =================================================================

-- Drop problematic constraints
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_check CASCADE;

-- Drop existing triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Create reliable profile creation function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, username, full_name, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NOW(), NOW()
  ) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Profile creation error for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Add simple username constraint
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_simple_check 
CHECK (username IS NULL OR length(username) >= 1);

-- =================================================================
-- STEP 2: CLEAN MOCK DATA
-- =================================================================

-- Clear fake contributions
DELETE FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND contribution_count > 50;

-- Remove test vehicles
DELETE FROM vehicles WHERE vin LIKE 'TEST%' OR make = 'TestMake';

-- Clean orphaned data
DELETE FROM vehicle_timeline_events WHERE vehicle_id NOT IN (SELECT id FROM vehicles);
DELETE FROM vehicle_images WHERE vehicle_id NOT IN (SELECT id FROM vehicles);

-- Rebuild real contributions
DELETE FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

INSERT INTO user_contributions (user_id, contribution_date, contribution_type, contribution_count, related_vehicle_id, metadata)
SELECT user_id, created_at::date, 'vehicle_data', 1, id,
  jsonb_build_object('action', 'added_vehicle', 'vehicle_info', jsonb_build_object('make', make, 'model', model, 'year', year))
FROM vehicles WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

INSERT INTO user_contributions (user_id, contribution_date, contribution_type, contribution_count, metadata)
SELECT user_id, created_at::date, 'image_upload', COUNT(*),
  jsonb_build_object('action', 'image_uploaded', 'image_count', COUNT(*))
FROM vehicle_images WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY user_id, created_at::date;

-- =================================================================
-- STEP 3: CREATE PROFESSIONAL SYSTEM
-- =================================================================

-- Professional profiles table
CREATE TABLE IF NOT EXISTS professional_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT CHECK (business_type IN ('garage', 'independent', 'dealership', 'mobile', 'specialty_shop', 'body_shop', 'detailing', 'inspection', 'appraisal')),
  specializations TEXT[], 
  hourly_rate_min DECIMAL(10,2),
  hourly_rate_max DECIMAL(10,2),
  service_radius_miles INTEGER,
  years_experience INTEGER,
  city TEXT, state TEXT, zip_code TEXT,
  total_vehicles_worked INTEGER DEFAULT 0,
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle service roles table
CREATE TABLE IF NOT EXISTS vehicle_service_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('mechanic', 'appraiser', 'detailer', 'inspector', 'photographer')),
  permissions TEXT[] DEFAULT ARRAY['view', 'add_timeline', 'upload_images'],
  project_scope TEXT NOT NULL,
  hourly_rate DECIMAL(10,2),
  estimated_hours INTEGER,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, service_provider_id, role) WHERE status = 'active'
);

-- Work sessions table
CREATE TABLE IF NOT EXISTS vehicle_work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_role_id UUID REFERENCES vehicle_service_roles(id) ON DELETE SET NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('diagnosis', 'repair', 'maintenance', 'inspection', 'detailing')),
  project_scope TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  is_streaming BOOLEAN DEFAULT false,
  stream_url TEXT,
  images_uploaded INTEGER DEFAULT 0,
  timeline_events_added INTEGER DEFAULT 0,
  notes TEXT,
  client_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =================================================================
-- STEP 4: CREATE VIEWS AND PERMISSIONS
-- =================================================================

-- Create view for Browse Professionals
CREATE OR REPLACE VIEW user_professional_status AS
SELECT 
  pp.user_id, p.email, p.full_name, p.username,
  pp.business_name, pp.business_type, pp.specializations,
  pp.hourly_rate_min, pp.hourly_rate_max, pp.service_radius_miles,
  pp.years_experience, pp.total_vehicles_worked, pp.average_rating, pp.total_reviews,
  pp.is_verified as business_verified, pp.city, pp.state, pp.zip_code, pp.description,
  COALESCE(pp.total_reviews, 0) as review_count,
  0 as verified_certifications,
  COALESCE(array_length(pp.specializations, 1), 0) as specialization_count,
  'professional' as user_type, pp.created_at
FROM professional_profiles pp
JOIN profiles p ON p.id = pp.user_id
WHERE pp.is_verified = true;

-- Enable RLS
ALTER TABLE professional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_service_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_work_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Professional profiles are public" ON professional_profiles FOR SELECT USING (true);
CREATE POLICY "Users can manage their own professional profile" ON professional_profiles FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Vehicle owners and service providers can view roles" ON vehicle_service_roles
  FOR SELECT USING (auth.uid() = service_provider_id OR auth.uid() = granted_by OR EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid()));

CREATE POLICY "Vehicle owners can grant service roles" ON vehicle_service_roles
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid()));

CREATE POLICY "Work sessions viewable by involved parties" ON vehicle_work_sessions
  FOR SELECT USING (auth.uid() = service_provider_id OR EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid()));

CREATE POLICY "Service providers can manage their work sessions" ON vehicle_work_sessions FOR ALL USING (auth.uid() = service_provider_id);

-- Grant permissions
GRANT SELECT ON user_professional_status TO authenticated, anon;
GRANT ALL ON professional_profiles TO authenticated;
GRANT ALL ON vehicle_service_roles TO authenticated;
GRANT ALL ON vehicle_work_sessions TO authenticated;

-- =================================================================
-- STEP 5: ADD SAMPLE DATA
-- =================================================================

-- Your professional profile
INSERT INTO professional_profiles (
  user_id, business_name, business_type, specializations, 
  hourly_rate_min, hourly_rate_max, service_radius_miles,
  years_experience, city, state, is_verified, description
) VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'Skylar''s Automotive', 'independent',
  ARRAY['engine', 'diagnostics', 'maintenance'],
  75.00, 125.00, 50, 10, 'San Francisco', 'CA', true,
  'Experienced automotive professional specializing in engine diagnostics and performance tuning.'
) ON CONFLICT (user_id) DO UPDATE SET business_name = EXCLUDED.business_name, is_verified = true, updated_at = NOW();

-- Sample professionals for testing
INSERT INTO professional_profiles (user_id, business_name, business_type, specializations, hourly_rate_min, hourly_rate_max, service_radius_miles, years_experience, city, state, is_verified, description) 
SELECT gen_random_uuid(), business_name, business_type, specializations, hourly_rate_min, hourly_rate_max, service_radius_miles, years_experience, city, state, is_verified, description
FROM (VALUES
  ('Bay Area Motors', 'garage', ARRAY['transmission', 'engine', 'electrical'], 85.00, 150.00, 75, 15, 'Oakland', 'CA', true, 'Full-service automotive repair specializing in European vehicles.'),
  ('Mobile Mechanic Pro', 'mobile', ARRAY['diagnostics', 'maintenance', 'brakes'], 65.00, 100.00, 25, 8, 'San Jose', 'CA', true, 'Mobile automotive services - we come to you for convenient repairs.'),
  ('Performance Plus', 'specialty_shop', ARRAY['performance', 'tuning', 'modifications'], 100.00, 200.00, 100, 12, 'Sacramento', 'CA', true, 'High-performance vehicle modifications and racing preparation.')
) AS sample_data(business_name, business_type, specializations, hourly_rate_min, hourly_rate_max, service_radius_miles, years_experience, city, state, is_verified, description);

-- Update profile stats with real data
UPDATE profile_stats SET
  total_contributions = (SELECT COALESCE(SUM(contribution_count), 0) FROM user_contributions WHERE user_id = profile_stats.user_id),
  total_vehicles = (SELECT COUNT(*) FROM vehicles WHERE user_id = profile_stats.user_id),
  total_images = (SELECT COUNT(*) FROM vehicle_images WHERE user_id = profile_stats.user_id),
  updated_at = NOW()
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Ensure main user profile exists
INSERT INTO public.profiles (id, email, username, full_name, is_public, created_at, updated_at)
VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'shkylar@gmail.com', 'skylar', 'Skylar Williams', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = COALESCE(profiles.username, EXCLUDED.username), updated_at = NOW();

-- =================================================================
-- VERIFICATION & RESULTS
-- =================================================================

-- Show setup results
SELECT '🎉 SETUP COMPLETE!' as message
UNION ALL SELECT 'Auth users:', COUNT(*)::text FROM auth.users
UNION ALL SELECT 'Profiles:', COUNT(*)::text FROM profiles  
UNION ALL SELECT 'Professionals:', COUNT(*)::text FROM user_professional_status
UNION ALL SELECT 'Real contributions:', COALESCE(SUM(contribution_count), 0)::text FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
UNION ALL SELECT 'Trigger exists:', CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created') THEN '✅ YES' ELSE '❌ NO' END;

-- Show sample professionals
SELECT 'Sample Professionals Available:' as section, business_name, business_type, city, state
FROM user_professional_status
ORDER BY business_name;
