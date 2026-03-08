-- Combined Shop Migrations
-- Execute this in Supabase SQL Editor
-- Run each section individually to avoid timeout issues

-- ========================================
-- 1. SHOPS CORE MIGRATION
-- ========================================

-- Create necessary ENUMs if they don't exist
DO $$ BEGIN
    CREATE TYPE shop_status AS ENUM ('active', 'inactive', 'pending', 'suspended');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE shop_category AS ENUM ('automotive', 'parts', 'service', 'restoration', 'custom', 'dealership', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE business_type AS ENUM ('sole_proprietorship', 'partnership', 'llc', 'corporation', 's_corp', 'non_profit', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create shops table
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    category shop_category NOT NULL DEFAULT 'automotive',
    status shop_status NOT NULL DEFAULT 'pending',

    -- Business Information
    business_name TEXT,
    business_type business_type,
    tax_id TEXT,
    license_number TEXT,

    -- Contact Information
    email TEXT,
    phone TEXT,
    website TEXT,

    -- Address
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT DEFAULT 'US',

    -- Geographic Data
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- Media
    logo_url TEXT,
    banner_url TEXT,

    -- Business Hours (JSON format)
    hours_of_operation JSONB DEFAULT '{}',

    -- Settings
    settings JSONB DEFAULT '{}',

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),

    -- Constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT valid_slug CHECK (slug ~* '^[a-z0-9-]+$' AND LENGTH(slug) >= 3),
    CONSTRAINT valid_coordinates CHECK (
        (latitude IS NULL AND longitude IS NULL) OR
        (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    )
);

-- Create shop_members table for managing shop access
CREATE TABLE IF NOT EXISTS shop_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    permissions JSONB DEFAULT '{}',
    invited_by UUID REFERENCES auth.users(id),
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(shop_id, user_id),
    CONSTRAINT valid_role CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer'))
);

-- ========================================
-- 2. SHOPS ADMIN INTEGRATION
-- ========================================

-- Create shop_admin_actions table for audit trail
CREATE TABLE IF NOT EXISTS shop_admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    admin_user_id UUID NOT NULL REFERENCES auth.users(id),
    action_type TEXT NOT NULL,
    action_details JSONB DEFAULT '{}',
    previous_values JSONB DEFAULT '{}',
    new_values JSONB DEFAULT '{}',
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_action_type CHECK (action_type IN ('status_change', 'verification', 'suspension', 'data_update', 'deletion'))
);

-- Create shop_notifications table
CREATE TABLE IF NOT EXISTS shop_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    data JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_notification_type CHECK (type IN ('info', 'warning', 'error', 'success'))
);

-- ========================================
-- 3. BUSINESS VERIFICATION SYSTEM
-- ========================================

DO $$ BEGIN
    CREATE TYPE verification_status AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE document_type AS ENUM ('business_license', 'tax_certificate', 'insurance', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create shop_verification table
CREATE TABLE IF NOT EXISTS shop_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    status verification_status NOT NULL DEFAULT 'pending',

    -- Verification Details
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ,

    -- Verification Data
    verification_data JSONB DEFAULT '{}',
    notes TEXT,
    rejection_reason TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(shop_id)
);

-- Create shop_documents table for business documents
CREATE TABLE IF NOT EXISTS shop_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 4. BUSINESS STRUCTURE SYSTEM
-- ========================================

-- Create shop_locations table for multi-location businesses
CREATE TABLE IF NOT EXISTS shop_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,

    -- Address
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',

    -- Geographic Data
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- Contact Info
    phone TEXT,
    email TEXT,

    -- Hours
    hours_of_operation JSONB DEFAULT '{}',

    -- Settings
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create shop_licenses table for location-specific licenses
CREATE TABLE IF NOT EXISTS shop_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    location_id UUID REFERENCES shop_locations(id) ON DELETE CASCADE,

    license_type TEXT NOT NULL,
    license_number TEXT NOT NULL,
    issuing_authority TEXT,
    issued_date DATE,
    expiration_date DATE,

    -- Document reference
    document_id UUID REFERENCES shop_documents(id),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create shop_departments for organizing business units
CREATE TABLE IF NOT EXISTS shop_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    location_id UUID REFERENCES shop_locations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT,

    -- Department manager
    manager_id UUID REFERENCES shop_members(id),

    -- Settings
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- INDEXES AND CONSTRAINTS
-- ========================================

-- Shops indexes
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_category ON shops(category);
CREATE INDEX IF NOT EXISTS idx_shops_created_by ON shops(created_by);
CREATE INDEX IF NOT EXISTS idx_shops_location ON shops(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Shop members indexes
CREATE INDEX IF NOT EXISTS idx_shop_members_shop_id ON shop_members(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_user_id ON shop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_role ON shop_members(role);

-- Admin actions indexes
CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_shop_id ON shop_admin_actions(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_admin_user_id ON shop_admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_created_at ON shop_admin_actions(created_at);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_shop_notifications_shop_id ON shop_notifications(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_user_id ON shop_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_read_at ON shop_notifications(read_at) WHERE read_at IS NULL;

-- Verification indexes
CREATE INDEX IF NOT EXISTS idx_shop_verification_shop_id ON shop_verification(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_verification_status ON shop_verification(status);

-- Documents indexes
CREATE INDEX IF NOT EXISTS idx_shop_documents_shop_id ON shop_documents(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_documents_type ON shop_documents(document_type);

-- Locations indexes
CREATE INDEX IF NOT EXISTS idx_shop_locations_shop_id ON shop_locations(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_locations_primary ON shop_locations(shop_id, is_primary) WHERE is_primary = TRUE;

-- Licenses indexes
CREATE INDEX IF NOT EXISTS idx_shop_licenses_shop_id ON shop_licenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_location_id ON shop_licenses(location_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_expiration ON shop_licenses(expiration_date) WHERE is_active = TRUE;

-- Departments indexes
CREATE INDEX IF NOT EXISTS idx_shop_departments_shop_id ON shop_departments(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_departments_location_id ON shop_departments(location_id);

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all relevant tables
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_members_updated_at BEFORE UPDATE ON shop_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_verification_updated_at BEFORE UPDATE ON shop_verification FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_documents_updated_at BEFORE UPDATE ON shop_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_locations_updated_at BEFORE UPDATE ON shop_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_licenses_updated_at BEFORE UPDATE ON shop_licenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shop_departments_updated_at BEFORE UPDATE ON shop_departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- RLS POLICIES
-- ========================================

-- Enable RLS on all shop tables
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_departments ENABLE ROW LEVEL SECURITY;

-- Basic shop access policies
CREATE POLICY "Users can view active shops" ON shops FOR SELECT USING (status = 'active');
CREATE POLICY "Users can create shops" ON shops FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Shop owners can update their shops" ON shops FOR UPDATE USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shops.id AND user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Shop members policies
CREATE POLICY "Users can view shop memberships" ON shop_members FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM shop_members sm WHERE sm.shop_id = shop_members.shop_id AND sm.user_id = auth.uid() AND sm.role IN ('owner', 'admin'))
);
CREATE POLICY "Shop admins can manage members" ON shop_members FOR ALL USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_members.shop_id AND user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Notification policies
CREATE POLICY "Users can view their shop notifications" ON shop_notifications FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_notifications.shop_id AND user_id = auth.uid())
);

-- Document policies
CREATE POLICY "Shop members can view documents" ON shop_documents FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_documents.shop_id AND user_id = auth.uid())
);

-- Location policies
CREATE POLICY "Users can view shop locations" ON shop_locations FOR SELECT USING (
    EXISTS (SELECT 1 FROM shops WHERE id = shop_locations.shop_id AND status = 'active')
);

-- License policies
CREATE POLICY "Shop members can view licenses" ON shop_licenses FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_licenses.shop_id AND user_id = auth.uid())
);

-- Department policies
CREATE POLICY "Shop members can view departments" ON shop_departments FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_departments.shop_id AND user_id = auth.uid())
);

COMMIT;