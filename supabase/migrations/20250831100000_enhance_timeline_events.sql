-- Enhance timeline_events table with meaningful fields
-- Based on USER requirements for participant tracking, location, costs, and verification

-- Add new columns to timeline_events
ALTER TABLE timeline_events 
ADD COLUMN IF NOT EXISTS mileage_at_event INTEGER,
ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS cost_currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_coordinates POINT,
ADD COLUMN IF NOT EXISTS service_provider_name TEXT,
ADD COLUMN IF NOT EXISTS service_provider_type TEXT CHECK (service_provider_type IN ('dealer', 'independent_shop', 'mobile_mechanic', 'diy', 'specialty_shop', 'tire_shop', 'body_shop', 'detailer', 'other')),
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS warranty_info JSONB,
ADD COLUMN IF NOT EXISTS parts_used JSONB[], -- Array of parts with details
ADD COLUMN IF NOT EXISTS verification_documents JSONB[], -- Receipts, invoices, photos
ADD COLUMN IF NOT EXISTS is_insurance_claim BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS insurance_claim_number TEXT,
ADD COLUMN IF NOT EXISTS next_service_due_date DATE,
ADD COLUMN IF NOT EXISTS next_service_due_mileage INTEGER;

-- Create event_participants table for tracking multiple people involved
CREATE TABLE IF NOT EXISTS event_participants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- May be null for non-users
    role TEXT NOT NULL CHECK (role IN ('owner', 'mechanic', 'sales_agent', 'inspector', 'transport_driver', 'buyer', 'seller', 'witness', 'other')),
    name TEXT, -- For participants without accounts
    company TEXT,
    phone TEXT,
    email TEXT,
    signature_url TEXT, -- Digital signature if applicable
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(event_id, user_id) -- Prevent duplicate user participants per event
);

-- Create event_verifications table for proof/validation
CREATE TABLE IF NOT EXISTS event_verifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    verification_type TEXT NOT NULL CHECK (verification_type IN ('vin_photo', 'receipt', 'invoice', 'before_photo', 'after_photo', 'signature', 'witness_statement', 'obd_scan', 'inspection_report', 'other')),
    verification_url TEXT NOT NULL,
    verification_metadata JSONB DEFAULT '{}',
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create event_relationships table to link related events
CREATE TABLE IF NOT EXISTS event_relationships (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    child_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('caused_by', 'led_to', 'part_of', 'related_to', 'replaces', 'supersedes')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(parent_event_id, child_event_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_participants_event_id ON event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user_id ON event_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_event_verifications_event_id ON event_verifications(event_id);
CREATE INDEX IF NOT EXISTS idx_event_relationships_parent ON event_relationships(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_event_relationships_child ON event_relationships(child_event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_mileage ON timeline_events(mileage_at_event);
CREATE INDEX IF NOT EXISTS idx_timeline_events_service_provider ON timeline_events(service_provider_name);

-- Enable RLS on new tables
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_relationships ENABLE ROW LEVEL SECURITY;

-- RLS Policies for event_participants
CREATE POLICY "Users can view participants for their vehicle events" ON event_participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_participants.event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage participants for their events" ON event_participants
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_participants.event_id
            AND v.user_id = auth.uid()
        )
    );

-- RLS Policies for event_verifications
CREATE POLICY "Users can view verifications for their vehicle events" ON event_verifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_verifications.event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage verifications for their events" ON event_verifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_verifications.event_id
            AND v.user_id = auth.uid()
        )
    );

-- RLS Policies for event_relationships
CREATE POLICY "Users can view relationships for their vehicle events" ON event_relationships
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE (te.id = event_relationships.parent_event_id OR te.id = event_relationships.child_event_id)
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage relationships for their events" ON event_relationships
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE (te.id = event_relationships.parent_event_id OR te.id = event_relationships.child_event_id)
            AND v.user_id = auth.uid()
        )
    );

-- Update vehicle_timeline_events view to include new fields
DROP TABLE IF EXISTS vehicle_timeline_events CASCADE;
CREATE VIEW vehicle_timeline_events AS 
SELECT 
    te.*,
    -- Include participant count
    (SELECT COUNT(*) FROM event_participants WHERE event_id = te.id) as participant_count,
    -- Include verification count
    (SELECT COUNT(*) FROM event_verifications WHERE event_id = te.id) as verification_count,
    -- Include service provider info for quick access
    CASE 
        WHEN te.service_provider_name IS NOT NULL 
        THEN jsonb_build_object(
            'name', te.service_provider_name,
            'type', te.service_provider_type,
            'invoice', te.invoice_number
        )
        ELSE NULL
    END as service_info
FROM timeline_events te;

-- Grant permissions on view
GRANT SELECT ON vehicle_timeline_events TO authenticated;
GRANT SELECT ON vehicle_timeline_events TO anon;
