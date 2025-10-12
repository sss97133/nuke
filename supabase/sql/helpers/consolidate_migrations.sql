-- Consolidate Migration Issues
-- This addresses duplicate/conflicting migrations

-- 1. Ensure all essential tables exist with correct structure
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    vin TEXT UNIQUE,
    license_plate TEXT,
    color TEXT,
    mileage INTEGER,
    fuel_type TEXT,
    transmission TEXT,
    engine_size TEXT,
    drivetrain TEXT,
    body_style TEXT,
    msrp DECIMAL(10,2),
    current_value DECIMAL(10,2),
    purchase_price DECIMAL(10,2),
    purchase_date DATE,
    is_public BOOLEAN DEFAULT TRUE,
    sale_status TEXT CHECK (sale_status IN ('not_for_sale', 'for_sale', 'sold', 'pending')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Ensure profiles table has all necessary columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_professional BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'user';

-- 3. Create unique constraint on username (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'profiles_username_key' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN
        -- Constraint already exists, continue
        NULL;
END $$;

-- 4. Ensure vehicle_images table exists
CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    storage_path TEXT,
    filename TEXT,
    file_size INTEGER,
    mime_type TEXT,
    category TEXT CHECK (category IN ('exterior', 'interior', 'engine', 'undercarriage', 'damage', 'documents', 'other')),
    is_primary BOOLEAN DEFAULT FALSE,
    caption TEXT,
    metadata JSONB DEFAULT '{}',
    exif_data JSONB DEFAULT '{}',
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Ensure profile-related tables exist
CREATE TABLE IF NOT EXISTS profile_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    total_vehicles INTEGER DEFAULT 0,
    total_images INTEGER DEFAULT 0,
    total_contributions INTEGER DEFAULT 0,
    total_timeline_events INTEGER DEFAULT 0,
    total_verifications INTEGER DEFAULT 0,
    profile_views INTEGER DEFAULT 0,
    last_activity TIMESTAMP,
    total_points INTEGER DEFAULT 0,
    reputation_score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'vehicle_added', 'profile_updated', 'image_uploaded', 'achievement_earned',
        'contribution_made', 'verification_completed', 'timeline_event_added'
    )),
    activity_title TEXT NOT NULL,
    activity_description TEXT,
    related_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Create essential indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_id ON vehicle_images(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_stats_user_id ON profile_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_user_id ON profile_activity(user_id);

-- 7. Enable RLS on all tables
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;

-- 8. Create essential functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create update triggers
DROP TRIGGER IF EXISTS update_vehicles_updated_at ON vehicles;
CREATE TRIGGER update_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 10. Verify migration consolidation
SELECT 
    'Migration Consolidation Complete' as status,
    COUNT(*) as table_count
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'vehicles', 'profiles', 'vehicle_images', 'profile_stats', 
    'profile_activity', 'user_contributions'
);
