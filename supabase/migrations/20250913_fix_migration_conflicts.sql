-- Fix Migration Conflicts
-- This migration resolves conflicts between local and remote database schemas

-- First, let's add missing columns to existing tables if they don't exist

-- Add is_active column to discovered_vehicles if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'is_active') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Add other potentially missing columns to discovered_vehicles
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'discovery_source') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_source TEXT CHECK (discovery_source IN (
            'search', 'recommendation', 'social_share', 'direct_link', 
            'auction_site', 'dealer_listing', 'user_submission'
        ));
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'discovery_context') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_context TEXT;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'interest_level') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN interest_level TEXT CHECK (interest_level IN ('casual', 'moderate', 'high', 'urgent'));
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'notes') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN notes TEXT;
    END IF;
END $$;

-- Create indexes safely
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_active ON discovered_vehicles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_interest ON discovered_vehicles(interest_level);

-- Ensure vehicle_user_permissions table exists with all required columns
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

-- Create indexes for vehicle_user_permissions
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_vehicle ON vehicle_user_permissions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_user ON vehicle_user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_role ON vehicle_user_permissions(role);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_active ON vehicle_user_permissions(is_active) WHERE is_active = true;

-- Enable RLS on tables
ALTER TABLE discovered_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policies for discovered_vehicles
DROP POLICY IF EXISTS "Users can manage their own discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Users can manage their own discovered vehicles" ON discovered_vehicles
    FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public read access to discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Public read access to discovered vehicles" ON discovered_vehicles
    FOR SELECT USING (true);

-- RLS policies for vehicle_user_permissions
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

-- Comments
COMMENT ON TABLE discovered_vehicles IS 'Tracks vehicles that users have discovered and are interested in';
COMMENT ON TABLE vehicle_user_permissions IS 'Manages user permissions and roles for specific vehicles';
