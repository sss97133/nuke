-- Comprehensive Schema Fix
-- This migration fixes all known schema conflicts and missing columns

-- Add missing columns to vehicles table if they don't exist
DO $$ 
BEGIN
    -- Add source column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicles' AND column_name = 'source') THEN
        ALTER TABLE vehicles ADD COLUMN source TEXT DEFAULT 'User Submission';
    END IF;
    
    -- Add is_public column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicles' AND column_name = 'is_public') THEN
        ALTER TABLE vehicles ADD COLUMN is_public BOOLEAN DEFAULT true;
    END IF;
    
    -- Add sale_price column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicles' AND column_name = 'sale_price') THEN
        ALTER TABLE vehicles ADD COLUMN sale_price DECIMAL(12,2);
    END IF;
    
    -- Add is_for_sale column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicles' AND column_name = 'is_for_sale') THEN
        ALTER TABLE vehicles ADD COLUMN is_for_sale BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Ensure discovered_vehicles table exists with all required columns
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

-- Add missing columns to discovered_vehicles if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' AND column_name = 'is_active') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' AND column_name = 'discovery_source') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_source TEXT CHECK (discovery_source IN (
            'search', 'recommendation', 'social_share', 'direct_link', 
            'auction_site', 'dealer_listing', 'user_submission'
        ));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' AND column_name = 'interest_level') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN interest_level TEXT CHECK (interest_level IN ('casual', 'moderate', 'high', 'urgent'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' AND column_name = 'notes') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN notes TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' AND column_name = 'discovery_context') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_context TEXT;
    END IF;
END $$;

-- Ensure vehicle_user_permissions table exists
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
    
    UNIQUE(vehicle_id, user_id, role) DEFERRABLE INITIALLY DEFERRED
);

-- Create all necessary indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_source ON vehicles(source);
CREATE INDEX IF NOT EXISTS idx_vehicles_public ON vehicles(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_vehicles_for_sale ON vehicles(is_for_sale) WHERE is_for_sale = true;

CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_user ON discovered_vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_vehicle ON discovered_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_active ON discovered_vehicles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_interest ON discovered_vehicles(interest_level);

CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_vehicle ON vehicle_user_permissions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_user ON vehicle_user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_role ON vehicle_user_permissions(role);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_active ON vehicle_user_permissions(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE discovered_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_user_permissions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Users can manage their own discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Users can manage their own discovered vehicles" ON discovered_vehicles
    FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public read access to discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Public read access to discovered vehicles" ON discovered_vehicles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Vehicle owners can manage permissions" ON vehicle_user_permissions;
CREATE POLICY "Vehicle owners can manage permissions" ON vehicle_user_permissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_user_permissions.vehicle_id 
            AND v.user_id = auth.uid()
        )
        OR auth.uid() = user_id
    );

DROP POLICY IF EXISTS "Public read access to vehicle permissions" ON vehicle_user_permissions;
CREATE POLICY "Public read access to vehicle permissions" ON vehicle_user_permissions
    FOR SELECT USING (true);

-- Create the user_vehicle_roles view that's referenced in the code
DROP VIEW IF EXISTS user_vehicle_roles;

CREATE VIEW user_vehicle_roles AS
SELECT 
    vup.user_id,
    vup.vehicle_id,
    vup.role,
    vup.is_active,
    vup.granted_at,
    v.make,
    v.model,
    v.year,
    v.vin
FROM vehicle_user_permissions vup
JOIN vehicles v ON v.id = vup.vehicle_id
WHERE vup.is_active = true;

ALTER VIEW user_vehicle_roles SET (security_invoker = true);

-- Comments
COMMENT ON TABLE discovered_vehicles IS 'Tracks vehicles that users have discovered and are interested in';
COMMENT ON TABLE vehicle_user_permissions IS 'Manages user permissions and roles for specific vehicles';
COMMENT ON VIEW user_vehicle_roles IS 'View combining user permissions with vehicle details';
