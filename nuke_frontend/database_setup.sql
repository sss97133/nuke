-- Create missing database tables for VehicleProfile.tsx
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/[your-project]/sql

-- 1. vehicle_builds table
CREATE TABLE IF NOT EXISTS vehicle_builds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    build_name TEXT,
    total_spent DECIMAL(10,2) DEFAULT 0,
    total_budget DECIMAL(10,2),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    start_date DATE,
    target_completion_date DATE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_builds_vehicle_id ON vehicle_builds(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_builds_status ON vehicle_builds(status);

-- 2. vehicle_contributors table
CREATE TABLE IF NOT EXISTS vehicle_contributors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'consigner', 'contributor', 'viewer')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'rejected')),
    permissions TEXT[] DEFAULT '{}',
    notes TEXT,
    invited_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_contributors_vehicle_id ON vehicle_contributors(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_contributors_user_id ON vehicle_contributors(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_contributors_status ON vehicle_contributors(status);

-- 3. vehicle_receipts table
CREATE TABLE IF NOT EXISTS vehicle_receipts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    receipt_type TEXT NOT NULL DEFAULT 'maintenance' CHECK (receipt_type IN ('maintenance', 'parts', 'fuel', 'insurance', 'registration', 'other')),
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    currency TEXT DEFAULT 'USD',
    vendor_name TEXT NOT NULL,
    description TEXT NOT NULL,
    receipt_date DATE NOT NULL,
    image_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    created_by UUID NOT NULL REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_receipts_vehicle_id ON vehicle_receipts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_receipts_receipt_type ON vehicle_receipts(receipt_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_receipts_receipt_date ON vehicle_receipts(receipt_date);

-- 4. vehicle_moderators table
CREATE TABLE IF NOT EXISTS vehicle_moderators (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID REFERENCES profiles(id),
    permissions TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_moderators_vehicle_id ON vehicle_moderators(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_moderators_user_id ON vehicle_moderators(user_id);

-- 5. vehicle_sale_settings table
CREATE TABLE IF NOT EXISTS vehicle_sale_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    target_ready_hours INTEGER DEFAULT 0,
    asking_price DECIMAL(12,2),
    reserve_price DECIMAL(12,2),
    listing_status TEXT DEFAULT 'draft' CHECK (listing_status IN ('draft', 'active', 'sold', 'withdrawn')),
    show_pricing BOOLEAN DEFAULT TRUE,
    show_reserve BOOLEAN DEFAULT FALSE,
    marketing_description TEXT,
    sale_timeline JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_sale_settings_vehicle_id ON vehicle_sale_settings(vehicle_id);

-- 6. vehicle_interaction_sessions table
CREATE TABLE IF NOT EXISTS vehicle_interaction_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES profiles(id),
    participant_id UUID REFERENCES profiles(id),
    session_type TEXT DEFAULT 'tour' CHECK (session_type IN ('tour', 'inspection', 'demo', 'consultation')),
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    notes TEXT,
    recording_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_interaction_sessions_vehicle_id ON vehicle_interaction_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_interaction_sessions_host_id ON vehicle_interaction_sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_interaction_sessions_participant_id ON vehicle_interaction_sessions(participant_id);

-- 7. component_installations table
CREATE TABLE IF NOT EXISTS component_installations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    component_id UUID, -- May reference a components table if it exists
    component_name TEXT NOT NULL,
    component_type TEXT,
    manufacturer TEXT,
    model_number TEXT,
    installation_date DATE,
    removal_date DATE,
    status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'removed', 'replaced', 'maintenance')),
    notes TEXT,
    cost DECIMAL(10,2),
    warranty_info TEXT,
    installed_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_component_installations_vehicle_id ON component_installations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_component_installations_component_id ON component_installations(component_id);
CREATE INDEX IF NOT EXISTS idx_component_installations_status ON component_installations(status);

-- 8. vehicle_data table
CREATE TABLE IF NOT EXISTS vehicle_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    data_type TEXT NOT NULL,
    data_category TEXT,
    title TEXT,
    value_text TEXT,
    value_number DECIMAL(15,4),
    value_boolean BOOLEAN,
    value_date DATE,
    value_json JSONB,
    unit TEXT,
    source TEXT,
    verified BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_data_vehicle_id ON vehicle_data(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_data_data_type ON vehicle_data(data_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_data_data_category ON vehicle_data(data_category);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE vehicle_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_sale_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_interaction_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE component_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_data ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (you may need to adjust based on your auth setup)
-- Users can read data for vehicles they have access to
CREATE POLICY "Users can view vehicle builds" ON vehicle_builds FOR SELECT USING (true);
CREATE POLICY "Users can view contributors" ON vehicle_contributors FOR SELECT USING (true);
CREATE POLICY "Users can view receipts" ON vehicle_receipts FOR SELECT USING (true);
CREATE POLICY "Users can view moderators" ON vehicle_moderators FOR SELECT USING (true);
CREATE POLICY "Users can view sale settings" ON vehicle_sale_settings FOR SELECT USING (true);
CREATE POLICY "Users can view interaction sessions" ON vehicle_interaction_sessions FOR SELECT USING (true);
CREATE POLICY "Users can view component installations" ON component_installations FOR SELECT USING (true);
CREATE POLICY "Users can view vehicle data" ON vehicle_data FOR SELECT USING (true);

-- Users can insert/update their own data
CREATE POLICY "Users can insert vehicle builds" ON vehicle_builds FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can insert contributors" ON vehicle_contributors FOR INSERT WITH CHECK (auth.uid() = invited_by);
CREATE POLICY "Users can insert receipts" ON vehicle_receipts FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can insert interaction sessions" ON vehicle_interaction_sessions FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Users can insert component installations" ON component_installations FOR INSERT WITH CHECK (auth.uid() = installed_by);
CREATE POLICY "Users can insert vehicle data" ON vehicle_data FOR INSERT WITH CHECK (auth.uid() = created_by);

COMMENT ON TABLE vehicle_builds IS 'Tracks build projects, budgets, and spending for vehicles';
COMMENT ON TABLE vehicle_contributors IS 'Manages user roles and permissions for vehicle access';
COMMENT ON TABLE vehicle_receipts IS 'Stores receipts and expense records for vehicles';
COMMENT ON TABLE vehicle_moderators IS 'Assigns content moderators to vehicles';
COMMENT ON TABLE vehicle_sale_settings IS 'Configuration for vehicle sales and marketplace listings';
COMMENT ON TABLE vehicle_interaction_sessions IS 'Live streaming, tours, and interaction sessions';
COMMENT ON TABLE component_installations IS 'Tracks parts and component installations on vehicles';
COMMENT ON TABLE vehicle_data IS 'Extended vehicle specifications and technical data';