-- 🚨 CRITICAL DATABASE FIXES - RUN THIS IN SUPABASE SQL EDITOR
-- This will fix authentication, clean mock data, and ensure all tables exist
-- Copy and paste this entire file into Supabase Dashboard > SQL Editor

-- =================================================================
-- STEP 1: FIX AUTHENTICATION SYSTEM
-- =================================================================

-- Drop problematic constraints and triggers
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_format_chk CASCADE;

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_username_check CASCADE;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS create_profile_on_vehicle_insert ON vehicles CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_vehicle_insert() CASCADE;

-- Create reliable profile creation function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    username,
    full_name,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail user creation
    RAISE LOG 'Profile creation error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Add permissive username constraint
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_simple_check 
CHECK (username IS NULL OR length(username) >= 1);

-- =================================================================
-- STEP 2: CLEAN MOCK DATA
-- =================================================================

-- Clear the 369 fake contributions
DELETE FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
AND contribution_count > 50; -- Mock data has unrealistic counts

-- Remove test vehicles
DELETE FROM vehicles 
WHERE vin LIKE 'TEST%' 
OR vin LIKE 'MOCK%'
OR make = 'TestMake'
OR model = 'TestModel';

-- Clean up orphaned data
DELETE FROM vehicle_timeline_events 
WHERE vehicle_id NOT IN (SELECT id FROM vehicles);

DELETE FROM vehicle_images 
WHERE vehicle_id NOT IN (SELECT id FROM vehicles);

-- Rebuild real contributions from actual data
DELETE FROM user_contributions WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Insert real vehicle contributions
INSERT INTO user_contributions (
    user_id,
    contribution_date,
    contribution_type,
    contribution_count,
    related_vehicle_id,
    metadata
)
SELECT 
    user_id,
    created_at::date as contribution_date,
    'vehicle_data' as contribution_type,
    1 as contribution_count,
    id as related_vehicle_id,
    jsonb_build_object(
        'action', 'added_vehicle',
        'vehicle_info', jsonb_build_object(
            'make', make,
            'model', model,
            'year', year
        )
    ) as metadata
FROM vehicles 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Insert real image contributions
INSERT INTO user_contributions (
    user_id,
    contribution_date,
    contribution_type,
    contribution_count,
    metadata
)
SELECT 
    user_id,
    created_at::date as contribution_date,
    'image_upload' as contribution_type,
    COUNT(*) as contribution_count,
    jsonb_build_object(
        'action', 'image_uploaded',
        'image_count', COUNT(*)
    ) as metadata
FROM vehicle_images 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY user_id, created_at::date;

-- =================================================================
-- STEP 3: ENSURE CRITICAL TABLES EXIST
-- =================================================================

-- Create discovered_vehicles table if missing
CREATE TABLE IF NOT EXISTS discovered_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    discovery_source TEXT CHECK (discovery_source IN (
        'search', 'recommendation', 'social_share', 'direct_link', 
        'auction_site', 'dealer_listing', 'user_submission'
    )),
    discovery_context TEXT,
    interest_level TEXT CHECK (interest_level IN ('casual', 'moderate', 'high', 'urgent')),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vehicle_id, user_id)
);

-- Create vehicle_user_permissions table if missing
CREATE TABLE IF NOT EXISTS vehicle_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES auth.users(id),
    role TEXT NOT NULL CHECK (role IN (
        'owner', 'co_owner', 'sales_agent', 'mechanic', 'appraiser',
        'dealer_rep', 'inspector', 'photographer', 'contributor', 'moderator'
    )),
    permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
    context TEXT,
    is_active BOOLEAN DEFAULT true,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vehicle_id, user_id, role) WHERE is_active = true
);

-- Enable RLS on new tables
ALTER TABLE discovered_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_user_permissions ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies
CREATE POLICY "Users can manage their own discovered vehicles" ON discovered_vehicles
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view permissions for their vehicles" ON vehicle_user_permissions
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
    );

-- =================================================================
-- STEP 4: SIMPLIFY RLS POLICIES
-- =================================================================

-- Make profiles more accessible
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Anyone can view public profiles" ON profiles
    FOR SELECT USING (is_public = true OR auth.uid() = id);

-- Make vehicles more accessible
DROP POLICY IF EXISTS "Public vehicles are viewable by everyone" ON vehicles;
CREATE POLICY "Public vehicles viewable by all" ON vehicles
    FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- Make contributions publicly viewable
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view contributions" ON user_contributions;
CREATE POLICY "Contributions are publicly viewable" ON user_contributions
    FOR SELECT USING (true);

-- Make profile stats publicly viewable
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view stats" ON profile_stats;
CREATE POLICY "Stats are publicly viewable" ON profile_stats
    FOR SELECT USING (true);

-- =================================================================
-- STEP 5: UPDATE PROFILE STATS
-- =================================================================

-- Update profile stats to match real data
UPDATE profile_stats SET
    total_contributions = (
        SELECT COALESCE(SUM(contribution_count), 0) 
        FROM user_contributions 
        WHERE user_id = profile_stats.user_id
    ),
    total_vehicles = (
        SELECT COUNT(*) 
        FROM vehicles 
        WHERE user_id = profile_stats.user_id
    ),
    total_images = (
        SELECT COUNT(*) 
        FROM vehicle_images 
        WHERE user_id = profile_stats.user_id
    ),
    updated_at = NOW()
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Ensure main user profile exists
INSERT INTO public.profiles (
  id, 
  email, 
  username, 
  full_name, 
  is_public, 
  created_at, 
  updated_at
)
VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'shkylar@gmail.com',
  'skylar',
  'Skylar Williams',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  username = COALESCE(profiles.username, EXCLUDED.username),
  full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
  updated_at = NOW();

-- =================================================================
-- VERIFICATION
-- =================================================================

-- Show results
SELECT '🎯 AUTHENTICATION FIX RESULTS' as section, '' as details
UNION ALL
SELECT 'Auth users count', COUNT(*)::text FROM auth.users
UNION ALL
SELECT 'Profile count', COUNT(*)::text FROM public.profiles
UNION ALL
SELECT 'Trigger exists', 
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_name = 'on_auth_user_created'
    ) THEN '✅ YES' ELSE '❌ NO' END
UNION ALL
SELECT 'Main user profile exists', 
    CASE WHEN EXISTS(
        SELECT 1 FROM profiles 
        WHERE id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
    ) THEN '✅ YES' ELSE '❌ NO' END
UNION ALL
SELECT 'Real contributions count', 
    COALESCE(SUM(contribution_count), 0)::text 
    FROM user_contributions 
    WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
UNION ALL
SELECT '🚀 STATUS', 
    CASE WHEN (
        SELECT COUNT(*) FROM auth.users
    ) = (
        SELECT COUNT(*) FROM profiles
    ) AND EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_name = 'on_auth_user_created'
    ) THEN '✅ ALL SYSTEMS FIXED' 
    ELSE '❌ ISSUES REMAIN' END;

-- Show contribution breakdown
SELECT 
    '📊 CONTRIBUTION BREAKDOWN' as title,
    contribution_type,
    COUNT(*) as days_active,
    SUM(contribution_count) as total_count
FROM user_contributions 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
GROUP BY contribution_type
ORDER BY total_count DESC;
