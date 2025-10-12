-- Add Missing Critical Tables
-- Run this in Supabase SQL Editor to add any missing tables

-- Check and create discovered_vehicles table
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
    
    -- Prevent duplicate entries
    UNIQUE(vehicle_id, user_id)
);

-- Check and create vehicle_user_permissions table
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
    
    -- Prevent duplicate active permissions for same user/vehicle/role
    UNIQUE(vehicle_id, user_id, role) WHERE is_active = true
);

-- Check and create vehicle_timeline_events table (if missing)
CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'LIFE', 'MAINTENANCE', 'REPAIR', 'MODIFICATION', 'INSPECTION', 
        'ACCIDENT', 'PURCHASE', 'SALE', 'REGISTRATION', 'INSURANCE'
    )),
    event_title TEXT NOT NULL,
    event_description TEXT,
    event_date DATE NOT NULL,
    mileage INTEGER,
    cost DECIMAL(10,2),
    location TEXT,
    metadata JSONB DEFAULT '{}',
    media_urls TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_user ON discovered_vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_vehicle ON discovered_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_permissions_user ON vehicle_user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_permissions_vehicle ON vehicle_user_permissions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_vehicle ON vehicle_timeline_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_date ON vehicle_timeline_events(event_date DESC);

-- Enable RLS on new tables
ALTER TABLE discovered_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_timeline_events ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (secure by default)
CREATE POLICY "Users can manage their own discovered vehicles" ON discovered_vehicles
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view permissions for their vehicles" ON vehicle_user_permissions
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
    );

CREATE POLICY "Vehicle owners can manage timeline events" ON vehicle_timeline_events
    FOR ALL USING (
        EXISTS (SELECT 1 FROM vehicles WHERE id = vehicle_id AND user_id = auth.uid())
    );

-- Verify tables were created
SELECT 
    table_name,
    CASE WHEN table_name IN (
        'discovered_vehicles', 'vehicle_user_permissions', 'vehicle_timeline_events'
    ) THEN '✅ CREATED' ELSE '❓ CHECK' END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('discovered_vehicles', 'vehicle_user_permissions', 'vehicle_timeline_events')
ORDER BY table_name;
