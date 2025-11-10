-- Business Entity System
-- Creates businesses as first-class tradable entities alongside users and vehicles

-- Core Business Entities Table
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Business Information
    business_name TEXT NOT NULL,
    legal_name TEXT, -- Official registered name if different
    business_type TEXT CHECK (business_type IN (
        'sole_proprietorship', 'partnership', 'llc', 'corporation', 
        'garage', 'dealership', 'restoration_shop', 'performance_shop', 
        'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
        'parts_supplier', 'fabrication', 'racing_team', 'other'
    )),
    industry_focus TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['classic_cars', 'exotics', 'daily_drivers', 'racing', 'restoration']
    
    -- Legal & Registration
    business_license TEXT,
    tax_id TEXT, -- EIN or similar
    registration_state TEXT,
    registration_date DATE,
    
    -- Contact Information
    email TEXT,
    phone TEXT,
    website TEXT,
    
    -- Location
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    country TEXT DEFAULT 'US',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Business Details
    description TEXT,
    specializations TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['engine_rebuild', 'paint', 'electrical', 'diagnostics']
    services_offered TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['maintenance', 'repair', 'restoration', 'custom_build']
    years_in_business INTEGER,
    employee_count INTEGER,
    facility_size_sqft INTEGER,
    
    -- Service Capabilities
    accepts_dropoff BOOLEAN DEFAULT false,
    offers_mobile_service BOOLEAN DEFAULT false,
    has_lift BOOLEAN DEFAULT false,
    has_paint_booth BOOLEAN DEFAULT false,
    has_dyno BOOLEAN DEFAULT false,
    has_alignment_rack BOOLEAN DEFAULT false,
    
    -- Business Hours
    hours_of_operation JSONB DEFAULT '{}', -- {"monday": {"open": "08:00", "close": "17:00"}, ...}
    
    -- Market Data
    hourly_rate_min DECIMAL(10,2),
    hourly_rate_max DECIMAL(10,2),
    service_radius_miles INTEGER,
    
    -- Reputation & Performance
    total_projects_completed INTEGER DEFAULT 0,
    total_vehicles_worked INTEGER DEFAULT 0,
    average_project_rating DECIMAL(3,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    repeat_customer_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    on_time_completion_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    
    -- Verification & Trust
    is_verified BOOLEAN DEFAULT false,
    verification_date TIMESTAMPTZ,
    verification_level TEXT CHECK (verification_level IN ('unverified', 'basic', 'premium', 'elite')),
    insurance_verified BOOLEAN DEFAULT false,
    license_verified BOOLEAN DEFAULT false,
    
    -- Business Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'for_sale', 'sold')),
    is_public BOOLEAN DEFAULT true,
    
    -- Market Value (for trading)
    estimated_value DECIMAL(15,2), -- Business valuation
    last_valuation_date DATE,
    is_for_sale BOOLEAN DEFAULT false,
    asking_price DECIMAL(15,2),
    
    -- Media
    logo_url TEXT,
    cover_image_url TEXT,
    portfolio_images TEXT[] DEFAULT ARRAY[]::TEXT[],
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business Ownership Table (supports multiple owners with shares)
CREATE TABLE IF NOT EXISTS business_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Ownership Details
    ownership_percentage DECIMAL(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
    ownership_type TEXT CHECK (ownership_type IN ('founder', 'partner', 'investor', 'employee_equity', 'acquired')),
    
    -- Legal
    ownership_title TEXT, -- 'CEO', 'Partner', 'Co-Owner', etc.
    voting_rights BOOLEAN DEFAULT true,
    
    -- Financial
    investment_amount DECIMAL(15,2),
    acquisition_date DATE NOT NULL,
    acquisition_price DECIMAL(15,2),
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'transferred', 'dissolved')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(business_id, owner_id) -- One ownership record per user per business
);

-- Business User Roles (employees, contractors, etc.)
CREATE TABLE IF NOT EXISTS business_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Role Information
    role_title TEXT NOT NULL, -- 'Mechanic', 'Manager', 'Appraiser', 'Detailer', etc.
    role_type TEXT CHECK (role_type IN ('owner', 'manager', 'employee', 'contractor', 'intern', 'consultant')),
    department TEXT, -- 'Service', 'Sales', 'Admin', 'Parts', etc.
    
    -- Permissions
    permissions TEXT[] DEFAULT ARRAY['view_business', 'view_projects'], -- Extensible permissions
    can_manage_vehicles BOOLEAN DEFAULT false,
    can_manage_users BOOLEAN DEFAULT false,
    can_create_projects BOOLEAN DEFAULT true,
    can_approve_timeline_events BOOLEAN DEFAULT false,
    
    -- Employment Details
    employment_type TEXT CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'temporary', 'volunteer')),
    hourly_rate DECIMAL(10,2),
    salary DECIMAL(12,2),
    start_date DATE NOT NULL,
    end_date DATE,
    
    -- Performance
    skill_level TEXT CHECK (skill_level IN ('apprentice', 'journeyman', 'expert', 'master')),
    specializations TEXT[] DEFAULT ARRAY[]::TEXT[],
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave', 'terminated')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure unique active role constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'business_user_roles'
          AND indexname = 'idx_business_user_roles_active_unique'
    ) THEN
        -- Index already exists
        NULL;
    ELSE
        EXECUTE 'CREATE UNIQUE INDEX idx_business_user_roles_active_unique ON business_user_roles (business_id, user_id, role_title) WHERE status = ''active''';
    END IF;
END;
$$;

-- Business Vehicle Fleet (vehicles owned/managed by business)
CREATE TABLE IF NOT EXISTS business_vehicle_fleet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    
    -- Fleet Role
    fleet_role TEXT CHECK (fleet_role IN (
        'inventory', 'project_car', 'customer_vehicle', 'company_vehicle', 
        'demo_vehicle', 'parts_car', 'completed_project', 'for_sale'
    )),
    
    -- Business Relationship
    relationship_type TEXT CHECK (relationship_type IN ('owned', 'consignment', 'customer_dropoff', 'lease', 'rental')),
    assigned_to UUID REFERENCES auth.users(id), -- Which employee is responsible
    
    -- Project Information
    project_name TEXT,
    project_status TEXT CHECK (project_status IN ('planning', 'in_progress', 'on_hold', 'completed', 'delivered')),
    estimated_completion DATE,
    project_budget DECIMAL(12,2),
    labor_hours_budgeted DECIMAL(8,2),
    labor_hours_actual DECIMAL(8,2),
    
    -- Financial
    acquisition_cost DECIMAL(12,2),
    acquisition_date DATE,
    target_sale_price DECIMAL(12,2),
    actual_sale_price DECIMAL(12,2),
    profit_margin DECIMAL(8,2), -- Calculated field
    
    -- Customer Information (if applicable)
    customer_id UUID REFERENCES auth.users(id),
    customer_contact_info JSONB DEFAULT '{}',
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'sold', 'returned')),
    
    -- Timestamps
    added_to_fleet TIMESTAMPTZ DEFAULT NOW(),
    removed_from_fleet TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure unique active vehicle constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'business_vehicle_fleet'
          AND indexname = 'idx_business_vehicle_fleet_active_unique'
    ) THEN
        NULL;
    ELSE
        EXECUTE 'CREATE UNIQUE INDEX idx_business_vehicle_fleet_active_unique ON business_vehicle_fleet (business_id, vehicle_id) WHERE status = ''active''';
    END IF;
END;
$$;

-- Business Timeline Events (business-level activities)
CREATE TABLE IF NOT EXISTS business_timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    
    -- Event Classification
    event_type TEXT NOT NULL CHECK (event_type IN (
        'founded', 'incorporated', 'license_acquired', 'facility_move', 'equipment_purchase',
        'employee_hired', 'employee_terminated', 'partnership', 'acquisition', 'certification',
        'award_received', 'milestone_reached', 'expansion', 'renovation', 'sale_listing',
        'ownership_transfer', 'closure', 'rebranding', 'other'
    )),
    event_category TEXT NOT NULL CHECK (event_category IN (
        'legal', 'operational', 'personnel', 'financial', 'recognition', 'growth', 'other'
    )),
    
    -- Event Details
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    location TEXT,
    
    -- Supporting Data
    documentation_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    cost_amount DECIMAL(12,2),
    cost_currency TEXT DEFAULT 'USD',
    
    -- Impact Assessment
    affects_valuation BOOLEAN DEFAULT false,
    affects_capacity BOOLEAN DEFAULT false,
    affects_reputation BOOLEAN DEFAULT false,
    
    -- Verification
    verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
        'unverified', 'user_verified', 'document_verified', 'third_party_verified'
    )),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(id);
CREATE INDEX IF NOT EXISTS idx_businesses_location ON businesses(city, state);
CREATE INDEX IF NOT EXISTS idx_businesses_type ON businesses(business_type);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);

CREATE INDEX IF NOT EXISTS idx_business_ownership_business ON business_ownership(business_id);
CREATE INDEX IF NOT EXISTS idx_business_ownership_owner ON business_ownership(owner_id);

CREATE INDEX IF NOT EXISTS idx_business_user_roles_business ON business_user_roles(business_id);
CREATE INDEX IF NOT EXISTS idx_business_user_roles_user ON business_user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_business_vehicle_fleet_business ON business_vehicle_fleet(business_id);
CREATE INDEX IF NOT EXISTS idx_business_vehicle_fleet_vehicle ON business_vehicle_fleet(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_business_timeline_events_business ON business_timeline_events(business_id);
CREATE INDEX IF NOT EXISTS idx_business_timeline_events_date ON business_timeline_events(event_date);

-- Enable RLS on all tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_vehicle_fleet ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_timeline_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Businesses: Public for verified businesses, owners can see their own
DROP POLICY IF EXISTS "Verified businesses are publicly viewable" ON businesses;
CREATE POLICY "Verified businesses are publicly viewable" ON businesses
    FOR SELECT USING (is_verified = true AND is_public = true);

DROP POLICY IF EXISTS "Business owners can view their businesses" ON businesses;
CREATE POLICY "Business owners can view their businesses" ON businesses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM business_ownership 
            WHERE business_ownership.business_id = businesses.id 
            AND business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        )
    );

DROP POLICY IF EXISTS "Business owners can update their businesses" ON businesses;
CREATE POLICY "Business owners can update their businesses" ON businesses
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM business_ownership 
            WHERE business_ownership.business_id = businesses.id 
            AND business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        )
    );

DROP POLICY IF EXISTS "Users can create businesses" ON businesses;
CREATE POLICY "Users can create businesses" ON businesses
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Business ownership policies
DROP POLICY IF EXISTS "Owners can view business ownership" ON business_ownership;
CREATE POLICY "Owners can view business ownership" ON business_ownership
    FOR SELECT USING (
        owner_id = auth.uid() OR 
        EXISTS (
            SELECT 1 FROM business_ownership bo2 
            WHERE bo2.business_id = business_ownership.business_id 
            AND bo2.owner_id = auth.uid()
            AND bo2.status = 'active'
        )
    );

DROP POLICY IF EXISTS "Users can create ownership records" ON business_ownership;
CREATE POLICY "Users can create ownership records" ON business_ownership
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Business user roles policies  
DROP POLICY IF EXISTS "Business members can view roles" ON business_user_roles;
CREATE POLICY "Business members can view roles" ON business_user_roles
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM business_ownership 
            WHERE business_ownership.business_id = business_user_roles.business_id 
            AND business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        )
    );

-- Business vehicle fleet policies
DROP POLICY IF EXISTS "Business owners can manage fleet" ON business_vehicle_fleet;
CREATE POLICY "Business owners can manage fleet" ON business_vehicle_fleet
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM business_ownership 
            WHERE business_ownership.business_id = business_vehicle_fleet.business_id 
            AND business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        )
    );

-- Business timeline events policies
DROP POLICY IF EXISTS "Business timeline events are viewable by business members" ON business_timeline_events;
CREATE POLICY "Business timeline events are viewable by business members" ON business_timeline_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM business_ownership 
            WHERE business_ownership.business_id = business_timeline_events.business_id 
            AND business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        ) OR
        EXISTS (
            SELECT 1 FROM business_user_roles 
            WHERE business_user_roles.business_id = business_timeline_events.business_id 
            AND business_user_roles.user_id = auth.uid()
            AND business_user_roles.status = 'active'
        )
    );

-- Functions to maintain data integrity

-- Function to create initial business ownership when business is created
DROP TRIGGER IF EXISTS trigger_create_initial_business_ownership ON businesses;

DROP FUNCTION IF EXISTS create_initial_business_ownership();

CREATE OR REPLACE FUNCTION create_initial_business_ownership()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO business_ownership (
        business_id, 
        owner_id, 
        ownership_percentage, 
        ownership_type, 
        ownership_title,
        acquisition_date
    ) VALUES (
        NEW.id, 
        auth.uid(), 
        100.00, 
        'founder', 
        'Founder/Owner',
        CURRENT_DATE
    )
    ON CONFLICT (business_id, owner_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_create_initial_business_ownership
    AFTER INSERT ON businesses
    FOR EACH ROW
    EXECUTE FUNCTION create_initial_business_ownership();

-- Function to update business stats when fleet changes
DROP TRIGGER IF EXISTS trigger_update_business_stats ON business_vehicle_fleet;

DROP FUNCTION IF EXISTS update_business_stats();

CREATE OR REPLACE FUNCTION update_business_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE businesses 
    SET total_vehicles_worked = (
        SELECT COUNT(*) 
        FROM business_vehicle_fleet 
        WHERE business_id = COALESCE(NEW.business_id, OLD.business_id)
        AND status = 'active'
    ),
    updated_at = NOW()
    WHERE id = COALESCE(NEW.business_id, OLD.business_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_business_stats
    AFTER INSERT OR UPDATE OR DELETE ON business_vehicle_fleet
    FOR EACH ROW
    EXECUTE FUNCTION update_business_stats();
