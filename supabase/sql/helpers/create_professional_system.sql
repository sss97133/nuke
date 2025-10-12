-- Create Professional System Tables
-- This creates the missing tables for the professional/service provider system

-- Professional Profiles Table
CREATE TABLE IF NOT EXISTS professional_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT CHECK (business_type IN (
    'garage', 'independent', 'dealership', 'mobile', 'specialty_shop', 
    'body_shop', 'detailing', 'inspection', 'appraisal'
  )),
  specializations TEXT[], -- ['engine', 'transmission', 'paint', 'electrical', 'diagnostics']
  hourly_rate_min DECIMAL(10,2),
  hourly_rate_max DECIMAL(10,2),
  service_radius_miles INTEGER,
  certifications TEXT[],
  years_experience INTEGER,
  
  -- Service capabilities
  accepts_dropoff BOOLEAN DEFAULT false,
  accepts_mobile BOOLEAN DEFAULT false,
  can_stream_work BOOLEAN DEFAULT false,
  has_lift BOOLEAN DEFAULT false,
  has_diagnostic_tools BOOLEAN DEFAULT false,
  
  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Stats (calculated fields)
  total_vehicles_worked INTEGER DEFAULT 0,
  average_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  total_work_sessions INTEGER DEFAULT 0,
  
  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMPTZ,
  license_number TEXT,
  insurance_verified BOOLEAN DEFAULT false,
  
  -- Profile
  description TEXT,
  profile_image_url TEXT,
  portfolio_images TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle Service Roles (who can work on which vehicles)
CREATE TABLE IF NOT EXISTS vehicle_service_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES auth.users(id), -- Vehicle owner
  
  role TEXT NOT NULL CHECK (role IN (
    'mechanic', 'appraiser', 'detailer', 'inspector', 'photographer',
    'body_tech', 'diagnostician', 'parts_specialist', 'project_manager'
  )),
  
  permissions TEXT[] DEFAULT ARRAY['view', 'add_timeline', 'upload_images'],
  project_scope TEXT NOT NULL, -- "Engine rebuild", "Paint correction", etc.
  
  -- Commercial details
  hourly_rate DECIMAL(10,2),
  estimated_hours INTEGER,
  total_budget DECIMAL(10,2),
  
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Optional expiration
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate active roles
  UNIQUE(vehicle_id, service_provider_id, role) WHERE status = 'active'
);

-- Work Sessions (tracking actual work time and streaming)
CREATE TABLE IF NOT EXISTS vehicle_work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_role_id UUID REFERENCES vehicle_service_roles(id) ON DELETE SET NULL,
  
  session_type TEXT NOT NULL CHECK (session_type IN (
    'diagnosis', 'repair', 'maintenance', 'inspection', 'detailing', 
    'body_work', 'paint', 'parts_replacement', 'testing'
  )),
  
  project_scope TEXT NOT NULL,
  work_description TEXT,
  
  -- Session timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER, -- Calculated field
  
  -- Streaming/documentation
  is_streaming BOOLEAN DEFAULT false,
  stream_url TEXT,
  stream_platform TEXT, -- 'youtube', 'twitch', 'custom'
  
  -- Work tracking
  images_uploaded INTEGER DEFAULT 0,
  timeline_events_added INTEGER DEFAULT 0,
  parts_used TEXT[], -- Part numbers/descriptions
  tools_used TEXT[],
  
  -- Client interaction
  notes TEXT,
  client_notes TEXT, -- Notes from vehicle owner
  client_approved BOOLEAN DEFAULT false,
  client_rating INTEGER CHECK (client_rating >= 1 AND client_rating <= 5),
  
  -- Billing
  billable_hours DECIMAL(5,2),
  hourly_rate DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Professional Reviews (client feedback)
CREATE TABLE IF NOT EXISTS professional_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  work_session_id UUID REFERENCES vehicle_work_sessions(id) ON DELETE SET NULL,
  
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  work_quality_rating INTEGER CHECK (work_quality_rating >= 1 AND work_quality_rating <= 5),
  communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
  timeliness_rating INTEGER CHECK (timeliness_rating >= 1 AND timeliness_rating <= 5),
  
  would_recommend BOOLEAN,
  is_verified BOOLEAN DEFAULT false, -- Verified that work actually happened
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate reviews
  UNIQUE(professional_id, reviewer_id, work_session_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_professional_profiles_business_type ON professional_profiles(business_type);
CREATE INDEX IF NOT EXISTS idx_professional_profiles_location ON professional_profiles(city, state);
CREATE INDEX IF NOT EXISTS idx_professional_profiles_rating ON professional_profiles(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_professional_profiles_verified ON professional_profiles(is_verified) WHERE is_verified = true;

CREATE INDEX IF NOT EXISTS idx_vehicle_service_roles_vehicle ON vehicle_service_roles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_roles_provider ON vehicle_service_roles(service_provider_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_roles_status ON vehicle_service_roles(status);

CREATE INDEX IF NOT EXISTS idx_work_sessions_vehicle ON vehicle_work_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_provider ON vehicle_work_sessions(service_provider_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_active ON vehicle_work_sessions(start_time DESC) WHERE end_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_professional_reviews_professional ON professional_reviews(professional_id);
CREATE INDEX IF NOT EXISTS idx_professional_reviews_rating ON professional_reviews(rating DESC);

-- Enable RLS
ALTER TABLE professional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_service_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Professional profiles are publicly viewable
CREATE POLICY "Professional profiles are public" ON professional_profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own professional profile" ON professional_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Vehicle service roles
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

-- Work sessions
CREATE POLICY "Work sessions viewable by involved parties" ON vehicle_work_sessions
  FOR SELECT USING (
    auth.uid() = service_provider_id OR
    EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
  );

CREATE POLICY "Service providers can manage their work sessions" ON vehicle_work_sessions
  FOR ALL USING (auth.uid() = service_provider_id);

-- Professional reviews are publicly viewable
CREATE POLICY "Professional reviews are public" ON professional_reviews
  FOR SELECT USING (true);

CREATE POLICY "Clients can create reviews for work they commissioned" ON professional_reviews
  FOR INSERT WITH CHECK (
    auth.uid() = reviewer_id AND
    EXISTS (
      SELECT 1 FROM vehicle_work_sessions ws
      JOIN vehicles v ON v.id = ws.vehicle_id
      WHERE ws.id = work_session_id AND v.user_id = auth.uid()
    )
  );

-- Create view for professional search (what the service was trying to query)
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
  pp.accepts_dropoff,
  pp.accepts_mobile,
  pp.can_stream_work,
  pp.description,
  pp.profile_image_url,
  COALESCE(pp.total_reviews, 0) as review_count,
  COALESCE(array_length(pp.certifications, 1), 0) as verified_certifications,
  COALESCE(array_length(pp.specializations, 1), 0) as specialization_count,
  'professional' as user_type, -- Default for this view
  pp.created_at
FROM professional_profiles pp
JOIN profiles p ON p.id = pp.user_id
WHERE pp.is_verified = true; -- Only show verified professionals

-- Grant permissions
GRANT SELECT ON user_professional_status TO authenticated, anon;
GRANT ALL ON professional_profiles TO authenticated;
GRANT ALL ON vehicle_service_roles TO authenticated;
GRANT ALL ON vehicle_work_sessions TO authenticated;
GRANT ALL ON professional_reviews TO authenticated;

-- Insert some sample data for testing
INSERT INTO professional_profiles (
  user_id, business_name, business_type, specializations, 
  hourly_rate_min, hourly_rate_max, service_radius_miles,
  years_experience, accepts_dropoff, accepts_mobile, can_stream_work,
  city, state, is_verified, description
) VALUES 
(
  '0b9f107a-d124-49de-9ded-94698f63c1c4', -- Your user ID
  'Skylar''s Garage', 
  'independent',
  ARRAY['engine', 'diagnostics', 'maintenance'],
  75.00, 125.00, 50,
  10, true, true, true,
  'San Francisco', 'CA', true,
  'Experienced automotive professional specializing in engine diagnostics and performance tuning.'
)
ON CONFLICT (user_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  is_verified = true,
  updated_at = NOW();

-- Verify the setup
SELECT 'Professional System Setup Complete' as status;
SELECT 'Sample professionals available:', COUNT(*) FROM user_professional_status;
