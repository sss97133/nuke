-- Vehicle Relationship Verification System
-- Allows organization members to verify vehicle relationships (inventory, consignment, service)
-- and mark vehicles as sold only with proof (BAT URL, receipt, etc.)

-- Create vehicle_relationship_verifications table
CREATE TABLE IF NOT EXISTS vehicle_relationship_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_vehicle_id UUID REFERENCES organization_vehicles(id) ON DELETE CASCADE NOT NULL,
    requested_by_user_id UUID REFERENCES auth.users(id) NOT NULL,
    verification_type TEXT NOT NULL CHECK (verification_type IN ('relationship', 'sale', 'status_change')),
    current_relationship_type TEXT,
    proposed_relationship_type TEXT,
    proposed_status TEXT,
    proof_type TEXT CHECK (proof_type IN ('bat_url', 'receipt', 'contract', 'photo_metadata', 'other')),
    proof_url TEXT,
    proof_document_id UUID REFERENCES vehicle_documents(id),
    notes TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    reviewed_by_user_id UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create notifications table for org members
CREATE TABLE IF NOT EXISTS organization_vehicle_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
    organization_vehicle_id UUID REFERENCES organization_vehicles(id) ON DELETE CASCADE NOT NULL,
    verification_id UUID REFERENCES vehicle_relationship_verifications(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('relationship_verification', 'sale_verification', 'status_change_request')),
    message TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed', 'resolved')),
    assigned_to_user_id UUID REFERENCES auth.users(id),
    created_by_user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_relationship_verifications_org_vehicle ON vehicle_relationship_verifications(organization_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_relationship_verifications_status ON vehicle_relationship_verifications(status);
CREATE INDEX IF NOT EXISTS idx_org_vehicle_notifications_org ON organization_vehicle_notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_vehicle_notifications_assigned ON organization_vehicle_notifications(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_org_vehicle_notifications_status ON organization_vehicle_notifications(status);

-- RLS Policies
ALTER TABLE vehicle_relationship_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_vehicle_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view verifications for vehicles in orgs they're members of
CREATE POLICY "Org members can view verifications" ON vehicle_relationship_verifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_vehicles ov
            JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
            WHERE ov.id = vehicle_relationship_verifications.organization_vehicle_id
                AND oc.user_id = auth.uid()
                AND oc.status = 'active'
        )
    );

-- Users can create verifications for vehicles in orgs they're members of
CREATE POLICY "Org members can create verifications" ON vehicle_relationship_verifications
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_vehicles ov
            JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
            WHERE ov.id = vehicle_relationship_verifications.organization_vehicle_id
                AND oc.user_id = auth.uid()
                AND oc.status = 'active'
        )
        AND requested_by_user_id = auth.uid()
    );

-- Org owners/managers can approve/reject verifications
CREATE POLICY "Org owners can manage verifications" ON vehicle_relationship_verifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_vehicles ov
            JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
            WHERE ov.id = vehicle_relationship_verifications.organization_vehicle_id
                AND oc.user_id = auth.uid()
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'co_founder', 'manager', 'board_member')
        )
    );

-- Users can view notifications assigned to them or for orgs they're members of
CREATE POLICY "Users can view their notifications" ON organization_vehicle_notifications
    FOR SELECT USING (
        assigned_to_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM organization_contributors oc
            WHERE oc.organization_id = organization_vehicle_notifications.organization_id
                AND oc.user_id = auth.uid()
                AND oc.status = 'active'
        )
    );

-- System can create notifications (via service role)
CREATE POLICY "Service role can create notifications" ON organization_vehicle_notifications
    FOR INSERT WITH CHECK (true);

-- Function to auto-create notifications when verification is requested
CREATE OR REPLACE FUNCTION notify_org_members_of_verification()
RETURNS TRIGGER AS $$
DECLARE
    org_id UUID;
    org_vehicle RECORD;
BEGIN
    -- Get organization ID from the vehicle link
    SELECT ov.organization_id, ov.vehicle_id, ov.relationship_type
    INTO org_vehicle
    FROM organization_vehicles ov
    WHERE ov.id = NEW.organization_vehicle_id;
    
    org_id := org_vehicle.organization_id;
    
    -- Create notifications for all active org members (owners, managers, board members get priority)
    INSERT INTO organization_vehicle_notifications (
        organization_id,
        organization_vehicle_id,
        verification_id,
        notification_type,
        message,
        priority,
        assigned_to_user_id,
        created_by_user_id
    )
    SELECT 
        org_id,
        NEW.organization_vehicle_id,
        NEW.id,
        NEW.verification_type,
        CASE 
            WHEN NEW.verification_type = 'sale' THEN 
                'Vehicle sale verification requested. Proof required: ' || COALESCE(NEW.proof_type, 'none')
            WHEN NEW.verification_type = 'relationship' THEN
                'Vehicle relationship verification requested: ' || COALESCE(NEW.current_relationship_type, 'unknown') || ' → ' || COALESCE(NEW.proposed_relationship_type, 'unknown')
            ELSE
                'Vehicle status change requested'
        END,
        CASE 
            WHEN oc.role IN ('owner', 'co_founder', 'manager', 'board_member') THEN 'high'
            ELSE 'normal'
        END,
        oc.user_id,
        NEW.requested_by_user_id
    FROM organization_contributors oc
    WHERE oc.organization_id = org_id
        AND oc.status = 'active'
        AND oc.user_id != NEW.requested_by_user_id; -- Don't notify the requester
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create notifications
DROP TRIGGER IF EXISTS trigger_notify_verification ON vehicle_relationship_verifications;
CREATE TRIGGER trigger_notify_verification
    AFTER INSERT ON vehicle_relationship_verifications
    FOR EACH ROW
    EXECUTE FUNCTION notify_org_members_of_verification();

-- Function to update vehicle status when verification is approved
CREATE OR REPLACE FUNCTION apply_approved_verification()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process when status changes to 'approved'
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        IF NEW.verification_type = 'sale' THEN
            -- Mark vehicle as sold with proof
            UPDATE organization_vehicles
            SET 
                status = 'sold',
                sale_date = COALESCE(NEW.proof_document_id::text, NOW()::date),
                sale_price = NULL, -- Will be set from proof document if available
                listing_status = 'sold',
                updated_at = NOW()
            WHERE id = NEW.organization_vehicle_id;
            
        ELSIF NEW.verification_type = 'relationship' AND NEW.proposed_relationship_type IS NOT NULL THEN
            -- Update relationship type
            UPDATE organization_vehicles
            SET 
                relationship_type = NEW.proposed_relationship_type,
                updated_at = NOW()
            WHERE id = NEW.organization_vehicle_id;
            
        ELSIF NEW.verification_type = 'status_change' AND NEW.proposed_status IS NOT NULL THEN
            -- Update status
            UPDATE organization_vehicles
            SET 
                status = NEW.proposed_status,
                updated_at = NOW()
            WHERE id = NEW.organization_vehicle_id;
        END IF;
        
        -- Mark notification as resolved
        UPDATE organization_vehicle_notifications
        SET 
            status = 'resolved',
            resolved_at = NOW()
        WHERE verification_id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to apply approved verifications
DROP TRIGGER IF EXISTS trigger_apply_verification ON vehicle_relationship_verifications;
CREATE TRIGGER trigger_apply_verification
    AFTER UPDATE OF status ON vehicle_relationship_verifications
    FOR EACH ROW
    EXECUTE FUNCTION apply_approved_verification();

-- Add constraint: sold status requires proof
ALTER TABLE organization_vehicles
ADD CONSTRAINT sold_requires_proof CHECK (
    status != 'sold' OR (
        sale_date IS NOT NULL 
        OR EXISTS (
            SELECT 1 FROM vehicle_relationship_verifications vrv
            WHERE vrv.organization_vehicle_id = organization_vehicles.id
                AND vrv.verification_type = 'sale'
                AND vrv.status = 'approved'
                AND vrv.proof_url IS NOT NULL
        )
        OR EXISTS (
            SELECT 1 FROM external_listings el
            WHERE el.vehicle_id = organization_vehicles.vehicle_id
                AND el.platform = 'bringatrailer'
                AND el.sold_at IS NOT NULL
        )
    )
);

