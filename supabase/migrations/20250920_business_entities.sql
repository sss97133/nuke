-- Migration: Business Entity System for Vehicle Management
-- Enables businesses to own vehicles and delegate responsibilities to technicians

-- Create business entity types
CREATE TYPE business_entity_type AS ENUM (
    'sole_proprietorship',
    'llc',
    'corporation',
    'partnership',
    'dealership',
    'restoration_shop',
    'service_center',
    'other'
);

-- Create responsibility levels
CREATE TYPE responsibility_level AS ENUM (
    'owner',           -- Full ownership and control
    'manager',         -- Can delegate and oversee
    'technician',      -- Can perform work and document
    'viewer',          -- Read-only access
    'contractor'       -- Temporary project-based access
);

-- Main business entities table
CREATE TABLE IF NOT EXISTS business_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Business information
    business_name TEXT NOT NULL,
    legal_name TEXT,
    business_type business_entity_type NOT NULL,
    
    -- Contact information
    primary_contact_email TEXT,
    primary_contact_phone TEXT,
    business_address TEXT,
    
    -- Registration details
    tax_id TEXT,
    business_license TEXT,
    registration_state TEXT,
    
    -- Platform integration
    created_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business team members (employees, contractors, etc.)
CREATE TABLE IF NOT EXISTS business_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_entity_id UUID NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Role information
    responsibility_level responsibility_level NOT NULL,
    job_title TEXT,
    department TEXT,
    
    -- Access control
    can_create_vehicles BOOLEAN DEFAULT false,
    can_edit_vehicles BOOLEAN DEFAULT false,
    can_delete_vehicles BOOLEAN DEFAULT false,
    can_manage_documents BOOLEAN DEFAULT false,
    can_manage_team BOOLEAN DEFAULT false,
    
    -- Employment details
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(business_entity_id, user_id)
);

-- Vehicle ownership by business entities
CREATE TABLE IF NOT EXISTS business_vehicle_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_entity_id UUID NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    
    -- Ownership details
    ownership_type TEXT CHECK (ownership_type IN ('owned', 'consignment', 'service', 'restoration', 'storage')) DEFAULT 'owned',
    acquisition_date DATE,
    acquisition_cost DECIMAL(12,2),
    current_value DECIMAL(12,2),
    
    -- Delegation
    primary_technician_id UUID REFERENCES auth.users(id),
    project_manager_id UUID REFERENCES auth.users(id),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(business_entity_id, vehicle_id)
);

-- Action attribution system
CREATE TABLE IF NOT EXISTS business_action_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What action was performed
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL, -- 'document_upload', 'timeline_event', 'vehicle_edit', etc.
    action_reference_id UUID, -- ID of the specific action (document_id, timeline_event_id, etc.)
    
    -- Business attribution
    business_entity_id UUID NOT NULL REFERENCES business_entities(id),
    performed_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Display information
    business_credit_name TEXT NOT NULL, -- "Nuke Ltd"
    technician_credit_name TEXT NOT NULL, -- "Skylar"
    action_description TEXT,
    
    -- Metadata
    action_data JSONB DEFAULT '{}',
    performed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_business_entities_name ON business_entities(business_name);
CREATE INDEX IF NOT EXISTS idx_business_team_members_business ON business_team_members(business_entity_id);
CREATE INDEX IF NOT EXISTS idx_business_team_members_user ON business_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_vehicle_ownership_business ON business_vehicle_ownership(business_entity_id);
CREATE INDEX IF NOT EXISTS idx_business_vehicle_ownership_vehicle ON business_vehicle_ownership(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_business_action_attributions_vehicle ON business_action_attributions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_business_action_attributions_business ON business_action_attributions(business_entity_id);

-- RLS Policies
ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_vehicle_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_action_attributions ENABLE ROW LEVEL SECURITY;

-- Business entities policies
CREATE POLICY "Users can view businesses they're part of" ON business_entities
    FOR SELECT USING (
        id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

CREATE POLICY "Business creators can manage their businesses" ON business_entities
    FOR ALL USING (created_by = auth.uid());

-- Team members policies
CREATE POLICY "Team members can view their business teams" ON business_team_members
    FOR SELECT USING (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

CREATE POLICY "Managers can manage team members" ON business_team_members
    FOR ALL USING (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() 
            AND responsibility_level IN ('owner', 'manager')
            AND can_manage_team = true
            AND is_active = true
        )
    );

-- Vehicle ownership policies
CREATE POLICY "Business team can view business vehicles" ON business_vehicle_ownership
    FOR SELECT USING (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

CREATE POLICY "Authorized team can manage business vehicles" ON business_vehicle_ownership
    FOR ALL USING (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() 
            AND (can_create_vehicles = true OR can_edit_vehicles = true)
            AND is_active = true
        )
    );

-- Action attributions policies
CREATE POLICY "Business team can view attributions" ON business_action_attributions
    FOR SELECT USING (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

CREATE POLICY "Team members can create attributions" ON business_action_attributions
    FOR INSERT WITH CHECK (
        business_entity_id IN (
            SELECT business_entity_id FROM business_team_members 
            WHERE user_id = auth.uid() AND is_active = true
        )
        AND performed_by_user_id = auth.uid()
    );

-- Helper function to check business vehicle access
CREATE OR REPLACE FUNCTION user_has_business_vehicle_access(
    p_user_id UUID,
    p_vehicle_id UUID,
    p_required_permission TEXT DEFAULT 'view'
)
RETURNS BOOLEAN AS $$
DECLARE
    has_access BOOLEAN := false;
BEGIN
    -- Check if user has access to this vehicle through business ownership
    SELECT EXISTS(
        SELECT 1 
        FROM business_vehicle_ownership bvo
        JOIN business_team_members btm ON btm.business_entity_id = bvo.business_entity_id
        WHERE bvo.vehicle_id = p_vehicle_id
        AND btm.user_id = p_user_id
        AND btm.is_active = true
        AND bvo.is_active = true
        AND (
            p_required_permission = 'view' OR
            (p_required_permission = 'edit' AND btm.can_edit_vehicles = true) OR
            (p_required_permission = 'manage_documents' AND btm.can_manage_documents = true) OR
            (p_required_permission = 'delete' AND btm.can_delete_vehicles = true)
        )
    ) INTO has_access;
    
    RETURN has_access;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create action attribution
CREATE OR REPLACE FUNCTION create_business_action_attribution(
    p_vehicle_id UUID,
    p_action_type TEXT,
    p_action_reference_id UUID,
    p_action_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    attribution_id UUID;
    business_info RECORD;
    user_info RECORD;
BEGIN
    -- Get business and user information
    SELECT 
        be.id as business_id,
        be.business_name,
        btm.responsibility_level,
        btm.job_title
    INTO business_info
    FROM business_vehicle_ownership bvo
    JOIN business_entities be ON be.id = bvo.business_entity_id
    JOIN business_team_members btm ON btm.business_entity_id = be.id
    WHERE bvo.vehicle_id = p_vehicle_id
    AND btm.user_id = auth.uid()
    AND btm.is_active = true
    AND bvo.is_active = true
    LIMIT 1;
    
    -- Get user display name
    SELECT email INTO user_info FROM auth.users WHERE id = auth.uid();
    
    IF business_info.business_id IS NOT NULL THEN
        INSERT INTO business_action_attributions (
            vehicle_id,
            action_type,
            action_reference_id,
            business_entity_id,
            performed_by_user_id,
            business_credit_name,
            technician_credit_name,
            action_description
        ) VALUES (
            p_vehicle_id,
            p_action_type,
            p_action_reference_id,
            business_info.business_id,
            auth.uid(),
            business_info.business_name,
            COALESCE(business_info.job_title || ' (' || user_info.email || ')', user_info.email),
            p_action_description
        ) RETURNING id INTO attribution_id;
    END IF;
    
    RETURN attribution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update vehicle_documents table to support business attribution
ALTER TABLE vehicle_documents 
ADD COLUMN IF NOT EXISTS business_attribution_id UUID REFERENCES business_action_attributions(id);

-- Comments
COMMENT ON TABLE business_entities IS 'Business entities that can own and manage vehicles';
COMMENT ON TABLE business_team_members IS 'Team members and their roles within business entities';
COMMENT ON TABLE business_vehicle_ownership IS 'Vehicles owned or managed by business entities';
COMMENT ON TABLE business_action_attributions IS 'Attribution system for business actions on vehicles';
