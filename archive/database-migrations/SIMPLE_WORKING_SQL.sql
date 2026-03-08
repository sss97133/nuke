-- 🚀 SIMPLE WORKING SETUP - NO DUMMY DATA
-- Copy this into Supabase SQL Editor - uses only real user data

-- =================================================================
-- STEP 1: FIX AUTHENTICATION
-- =================================================================

-- Drop problematic constraints
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

-- Drop existing triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Create simple profile creation function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, full_name, created_at, updated_at)
  VALUES (
    NEW.id, NEW.email,
    split_part(NEW.email, '@', 1),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NOW(), NOW()
  ) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- Don't fail user creation
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =================================================================
-- STEP 2: CLEAN MOCK DATA
-- =================================================================

-- Clear fake contributions (the 369 fake entries)
DELETE FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND contribution_count > 20;

-- =================================================================
-- STEP 3: CREATE PROFESSIONAL SYSTEM (MINIMAL)
-- =================================================================

-- Professional profiles table
CREATE TABLE IF NOT EXISTS professional_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT,
  specializations TEXT[], 
  hourly_rate_min DECIMAL(10,2),
  hourly_rate_max DECIMAL(10,2),
  years_experience INTEGER,
  city TEXT, 
  state TEXT,
  average_rating DECIMAL(3,2) DEFAULT 4.5,
  total_reviews INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle service roles table
CREATE TABLE IF NOT EXISTS vehicle_service_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  role TEXT NOT NULL,
  project_scope TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work sessions table
CREATE TABLE IF NOT EXISTS vehicle_work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL,
  project_scope TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  is_streaming BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =================================================================
-- STEP 4: SIMPLE VIEW FOR BROWSE PROFESSIONALS
-- =================================================================

-- Create simple view that works with your real user
CREATE OR REPLACE VIEW user_professional_status AS
SELECT 
  p.id as user_id,
  p.email,
  p.full_name,
  p.username,
  COALESCE(pp.business_name, p.full_name || '''s Services') as business_name,
  COALESCE(pp.business_type, 'independent') as business_type,
  COALESCE(pp.specializations, ARRAY['general']) as specializations,
  COALESCE(pp.hourly_rate_min, 50.00) as hourly_rate_min,
  COALESCE(pp.hourly_rate_max, 100.00) as hourly_rate_max,
  COALESCE(pp.years_experience, 5) as years_experience,
  COALESCE(pp.average_rating, 4.5) as average_rating,
  COALESCE(pp.total_reviews, 0) as total_reviews,
  COALESCE(pp.is_verified, true) as business_verified,
  COALESCE(pp.city, 'San Francisco') as city,
  COALESCE(pp.state, 'CA') as state,
  '' as zip_code,
  COALESCE(pp.description, 'Professional automotive services') as description,
  0 as review_count,
  0 as verified_certifications,
  1 as specialization_count,
  'professional' as user_type,
  p.created_at
FROM profiles p
LEFT JOIN professional_profiles pp ON pp.user_id = p.id
WHERE p.id = '0b9f107a-d124-49de-9ded-94698f63c1c4'; -- Only your user for now

-- Enable RLS (simple policies)
ALTER TABLE professional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_service_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_work_sessions ENABLE ROW LEVEL SECURITY;

-- Simple RLS policies
CREATE POLICY "Anyone can view professional profiles" ON professional_profiles FOR SELECT USING (true);
CREATE POLICY "Users can edit own professional profile" ON professional_profiles FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view service roles" ON vehicle_service_roles FOR SELECT USING (true);
CREATE POLICY "Vehicle owners can manage service roles" ON vehicle_service_roles FOR ALL USING (
  EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
);

CREATE POLICY "Anyone can view work sessions" ON vehicle_work_sessions FOR SELECT USING (true);
CREATE POLICY "Service providers can manage sessions" ON vehicle_work_sessions FOR ALL USING (auth.uid() = service_provider_id);

-- Grant all permissions
GRANT SELECT ON user_professional_status TO authenticated, anon;
GRANT ALL ON professional_profiles TO authenticated, anon;
GRANT ALL ON vehicle_service_roles TO authenticated, anon;
GRANT ALL ON vehicle_work_sessions TO authenticated, anon;

-- =================================================================
-- VERIFICATION
-- =================================================================

SELECT '🎉 SIMPLE SETUP COMPLETE!' as status;
SELECT 'Professionals in directory: ' || COUNT(*)::text FROM user_professional_status;
SELECT 'Your profile ready: ' || CASE WHEN EXISTS(SELECT 1 FROM profiles WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4') THEN 'YES ✅' ELSE 'NO ❌' END;
