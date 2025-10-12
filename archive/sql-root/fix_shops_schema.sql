-- Fix existing shops table by adding missing columns
-- This will extend the existing structure without breaking it

-- Add missing columns to shops table
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS slug TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'automotive',
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS address_line1 TEXT,
ADD COLUMN IF NOT EXISTS address_line2 TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS postal_code TEXT,
ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US',
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS banner_url TEXT,
ADD COLUMN IF NOT EXISTS hours_of_operation JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS created_by UUID;

-- Add foreign key constraint for created_by
ALTER TABLE shops
ADD CONSTRAINT IF NOT EXISTS fk_shops_created_by
FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- Update slug column to be unique if not already
CREATE UNIQUE INDEX IF NOT EXISTS shops_slug_unique ON shops(slug) WHERE slug IS NOT NULL;

-- Add check constraints
ALTER TABLE shops
ADD CONSTRAINT IF NOT EXISTS valid_email
CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),

ADD CONSTRAINT IF NOT EXISTS valid_slug
CHECK (slug IS NULL OR (slug ~* '^[a-z0-9-]+$' AND LENGTH(slug) >= 3)),

ADD CONSTRAINT IF NOT EXISTS valid_coordinates
CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);

-- Now create the other tables that don't exist yet
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

-- Create verification types
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

CREATE TABLE IF NOT EXISTS shop_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    status verification_status NOT NULL DEFAULT 'pending',
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ,
    verification_data JSONB DEFAULT '{}',
    notes TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shop_id)
);

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

CREATE TABLE IF NOT EXISTS shop_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    phone TEXT,
    email TEXT,
    hours_of_operation JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    location_id UUID REFERENCES shop_locations(id) ON DELETE CASCADE,
    license_type TEXT NOT NULL,
    license_number TEXT NOT NULL,
    issuing_authority TEXT,
    issued_date DATE,
    expiration_date DATE,
    document_id UUID REFERENCES shop_documents(id),
    is_active BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    location_id UUID REFERENCES shop_locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    manager_id UUID REFERENCES shop_members(id),
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for new columns and tables
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shops_category ON shops(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shops_created_by ON shops(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shops_location ON shops(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_shop_id ON shop_admin_actions(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_admin_user_id ON shop_admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_shop_admin_actions_created_at ON shop_admin_actions(created_at);

CREATE INDEX IF NOT EXISTS idx_shop_notifications_shop_id ON shop_notifications(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_user_id ON shop_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_read_at ON shop_notifications(read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shop_verification_shop_id ON shop_verification(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_verification_status ON shop_verification(status);

CREATE INDEX IF NOT EXISTS idx_shop_documents_shop_id ON shop_documents(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_documents_type ON shop_documents(document_type);

CREATE INDEX IF NOT EXISTS idx_shop_locations_shop_id ON shop_locations(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_locations_primary ON shop_locations(shop_id, is_primary) WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_shop_licenses_shop_id ON shop_licenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_location_id ON shop_licenses(location_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_expiration ON shop_licenses(expiration_date) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_shop_departments_shop_id ON shop_departments(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_departments_location_id ON shop_departments(location_id);

-- Add update triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create triggers if they don't exist
DO $$ BEGIN
    CREATE TRIGGER update_shop_verification_updated_at BEFORE UPDATE ON shop_verification FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TRIGGER update_shop_documents_updated_at BEFORE UPDATE ON shop_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TRIGGER update_shop_locations_updated_at BEFORE UPDATE ON shop_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TRIGGER update_shop_licenses_updated_at BEFORE UPDATE ON shop_licenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TRIGGER update_shop_departments_updated_at BEFORE UPDATE ON shop_departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Enable RLS on all tables
ALTER TABLE shop_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_departments ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies
CREATE POLICY "Users can view shop notifications" ON shop_notifications FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_notifications.shop_id AND user_id = auth.uid())
);

CREATE POLICY "Shop members can view documents" ON shop_documents FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_documents.shop_id AND user_id = auth.uid())
);

CREATE POLICY "Users can view shop locations" ON shop_locations FOR SELECT USING (
    EXISTS (SELECT 1 FROM shops WHERE id = shop_locations.shop_id AND active = true)
);

CREATE POLICY "Shop members can view licenses" ON shop_licenses FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_licenses.shop_id AND user_id = auth.uid())
);

CREATE POLICY "Shop members can view departments" ON shop_departments FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_members WHERE shop_id = shop_departments.shop_id AND user_id = auth.uid())
);

COMMIT;