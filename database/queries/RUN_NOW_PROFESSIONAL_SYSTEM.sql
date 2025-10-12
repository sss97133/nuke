-- 🚀 QUICK PROFESSIONAL SYSTEM SETUP
-- Copy this into Supabase SQL Editor to enable Browse Professionals

-- Create professional_profiles table
CREATE TABLE IF NOT EXISTS professional_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT CHECK (business_type IN (
    'garage', 'independent', 'dealership', 'mobile', 'specialty_shop', 
    'body_shop', 'detailing', 'inspection', 'appraisal'
  )),
  specializations TEXT[], 
  hourly_rate_min DECIMAL(10,2),
  hourly_rate_max DECIMAL(10,2),
  service_radius_miles INTEGER,
  years_experience INTEGER,
  
  -- Location
  city TEXT,
  state TEXT,
  zip_code TEXT,
  
  -- Stats
  total_vehicles_worked INTEGER DEFAULT 0,
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  
  -- Verification
  is_verified BOOLEAN DEFAULT false,
  
  -- Profile
  description TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the view that Browse Professionals expects
CREATE OR REPLACE VIEW user_professional_status AS
SELECT 
  pp.user_id,
  p.email,
  p.full_name,
  p.username,
  pp.business_name,
  pp.business_type,
  pp.specializations,
  pp.hourly_rate_min,
  pp.hourly_rate_max,
  pp.service_radius_miles,
  pp.years_experience,
  pp.total_vehicles_worked,
  pp.average_rating,
  pp.total_reviews,
  pp.is_verified as business_verified,
  pp.city,
  pp.state,
  pp.zip_code,
  pp.description,
  COALESCE(pp.total_reviews, 0) as review_count,
  0 as verified_certifications, -- Placeholder
  COALESCE(array_length(pp.specializations, 1), 0) as specialization_count,
  'professional' as user_type,
  pp.created_at
FROM professional_profiles pp
JOIN profiles p ON p.id = pp.user_id
WHERE pp.is_verified = true;

-- Enable RLS
ALTER TABLE professional_profiles ENABLE ROW LEVEL SECURITY;

-- Professional profiles are publicly viewable
CREATE POLICY "Professional profiles are public" ON professional_profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own professional profile" ON professional_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT ON user_professional_status TO authenticated, anon;
GRANT ALL ON professional_profiles TO authenticated;

-- Insert sample data (your profile as a professional)
INSERT INTO professional_profiles (
  user_id, business_name, business_type, specializations, 
  hourly_rate_min, hourly_rate_max, service_radius_miles,
  years_experience, city, state, is_verified, description
) VALUES 
(
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'Skylar''s Automotive', 
  'independent',
  ARRAY['engine', 'diagnostics', 'maintenance'],
  75.00, 125.00, 50,
  10, 'San Francisco', 'CA', true,
  'Experienced automotive professional specializing in engine diagnostics and performance tuning.'
)
ON CONFLICT (user_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  is_verified = true,
  updated_at = NOW();

-- Add a few more sample professionals for testing
INSERT INTO professional_profiles (
  user_id, business_name, business_type, specializations, 
  hourly_rate_min, hourly_rate_max, service_radius_miles,
  years_experience, city, state, is_verified, description
) 
SELECT 
  gen_random_uuid(),
  business_name,
  business_type,
  specializations,
  hourly_rate_min,
  hourly_rate_max,
  service_radius_miles,
  years_experience,
  city,
  state,
  is_verified,
  description
FROM (VALUES
  ('Bay Area Motors', 'garage', ARRAY['transmission', 'engine', 'electrical'], 85.00, 150.00, 75, 15, 'Oakland', 'CA', true, 'Full-service automotive repair specializing in European vehicles.'),
  ('Mobile Mechanic Pro', 'mobile', ARRAY['diagnostics', 'maintenance', 'brakes'], 65.00, 100.00, 25, 8, 'San Jose', 'CA', true, 'Mobile automotive services - we come to you for convenient repairs.'),
  ('Performance Plus', 'specialty_shop', ARRAY['performance', 'tuning', 'modifications'], 100.00, 200.00, 100, 12, 'Sacramento', 'CA', true, 'High-performance vehicle modifications and racing preparation.')
) AS sample_data(business_name, business_type, specializations, hourly_rate_min, hourly_rate_max, service_radius_miles, years_experience, city, state, is_verified, description);

-- Create basic vehicle service roles table for project management
CREATE TABLE IF NOT EXISTS vehicle_service_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  
  role TEXT NOT NULL CHECK (role IN (
    'mechanic', 'appraiser', 'detailer', 'inspector', 'photographer'
  )),
  
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

-- Create work sessions table
CREATE TABLE IF NOT EXISTS vehicle_work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_role_id UUID REFERENCES vehicle_service_roles(id) ON DELETE SET NULL,
  
  session_type TEXT NOT NULL CHECK (session_type IN (
    'diagnosis', 'repair', 'maintenance', 'inspection', 'detailing'
  )),
  
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

-- Enable RLS on new tables
ALTER TABLE vehicle_service_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_work_sessions ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies
CREATE POLICY "Vehicle owners and service providers can view roles" ON vehicle_service_roles
  FOR SELECT USING (
    auth.uid() = service_provider_id OR
    auth.uid() = granted_by OR
    EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
  );

CREATE POLICY "Vehicle owners can grant service roles" ON vehicle_service_roles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
  );

CREATE POLICY "Work sessions viewable by involved parties" ON vehicle_work_sessions
  FOR SELECT USING (
    auth.uid() = service_provider_id OR
    EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
  );

CREATE POLICY "Service providers can manage their work sessions" ON vehicle_work_sessions
  FOR ALL USING (auth.uid() = service_provider_id);

-- Grant permissions
GRANT ALL ON vehicle_service_roles TO authenticated;
GRANT ALL ON vehicle_work_sessions TO authenticated;

-- Verify setup
SELECT 'Professional System Setup Complete!' as status;
SELECT 'Sample professionals available:', COUNT(*) FROM user_professional_status;
