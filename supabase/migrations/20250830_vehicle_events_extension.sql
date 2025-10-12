-- Extend existing timeline_events for vehicle lifecycle events
-- This builds on the existing schema without breaking it

-- Add new event types for vehicle lifecycle
ALTER TABLE timeline_events DROP CONSTRAINT IF EXISTS timeline_events_event_type_check;
ALTER TABLE timeline_events ADD CONSTRAINT timeline_events_event_type_check 
CHECK (event_type IN (
    -- Existing types
    'purchase', 'sale', 'registration', 'inspection', 'maintenance', 
    'repair', 'modification', 'accident', 'insurance_claim', 'recall',
    'ownership_transfer', 'lien_change', 'title_update', 'mileage_reading',
    -- New lifecycle types
    'transport', 'evaluation', 'refurbishing', 'consignment', 'pickup', 'delivery'
));

-- Event Participants Table - tracks all people/entities involved in an event
CREATE TABLE IF NOT EXISTS timeline_event_participants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timeline_event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    
    -- Participant Identity (flexible - may or may not have user profile)
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- If they have a profile
    participant_name TEXT NOT NULL, -- Always store name
    participant_email TEXT, -- Optional contact
    participant_phone TEXT, -- Optional contact
    
    -- Role in this specific event
    participant_role TEXT NOT NULL CHECK (participant_role IN (
        'sales_agent', 'responsible_party', 'technical_owner', 'inspector', 
        'mechanic', 'transporter', 'appraiser', 'consigner', 'buyer', 'seller'
    )),
    
    -- Organization/Company (if applicable)
    organization_name TEXT, -- e.g., "Brownstone Transportation LLC"
    organization_type TEXT CHECK (organization_type IN (
        'dealership', 'transport_company', 'repair_shop', 'inspection_facility',
        'insurance_company', 'auction_house', 'private_party'
    )),
    
    -- Verification/Proof
    signature_url TEXT, -- Link to signature image/document
    id_verification_url TEXT, -- Link to ID photo/document
    authorization_document_url TEXT, -- Power of attorney, etc.
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure each participant has unique role per event
    UNIQUE(timeline_event_id, participant_role)
);

-- Event Locations Table - tracks locations that may not have full profiles yet
CREATE TABLE IF NOT EXISTS timeline_event_locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timeline_event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    
    -- Location Details
    location_name TEXT NOT NULL, -- e.g., "ABC Motors Dealership"
    location_type TEXT CHECK (location_type IN (
        'dealership', 'repair_shop', 'inspection_facility', 'transport_hub',
        'auction_house', 'storage_facility', 'private_residence', 'other'
    )),
    
    -- Address Information
    street_address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    country TEXT DEFAULT 'US',
    
    -- Contact Information
    phone TEXT,
    email TEXT,
    website TEXT,
    
    -- GPS Coordinates (for future mapping)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verification_date TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link images to specific events (extends existing vehicle_images)
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS image_context TEXT; -- e.g., "pickup_condition", "transport_damage", "delivery_confirmation"

-- Event Proof Documents - for signatures, receipts, etc.
CREATE TABLE IF NOT EXISTS timeline_event_proofs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timeline_event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    
    -- Document Details
    proof_type TEXT NOT NULL CHECK (proof_type IN (
        'signature', 'receipt', 'invoice', 'bill_of_lading', 'inspection_report',
        'photo_id', 'authorization', 'insurance_document', 'title_document'
    )),
    document_url TEXT NOT NULL, -- Supabase storage URL
    document_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    
    -- Metadata
    description TEXT,
    uploaded_by UUID REFERENCES auth.users(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES auth.users(id),
    verified_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_timeline_event_participants_event_id ON timeline_event_participants(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_participants_user_id ON timeline_event_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_locations_event_id ON timeline_event_locations(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_timeline_event ON vehicle_images(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_proofs_event_id ON timeline_event_proofs(timeline_event_id);

-- RLS Policies
ALTER TABLE timeline_event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_proofs ENABLE ROW LEVEL SECURITY;

-- Participants: Users can see participants for events on their vehicles
CREATE POLICY "Users can view event participants for their vehicles" ON timeline_event_participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_participants.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

-- Participants: Users can add participants to events on their vehicles
CREATE POLICY "Users can add participants to their vehicle events" ON timeline_event_participants
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_participants.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

-- Similar policies for locations and proofs
CREATE POLICY "Users can view event locations for their vehicles" ON timeline_event_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_locations.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can add locations to their vehicle events" ON timeline_event_locations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_locations.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view event proofs for their vehicles" ON timeline_event_proofs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_proofs.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can add proofs to their vehicle events" ON timeline_event_proofs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_proofs.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

-- Helper function to create a complete event with participants
CREATE OR REPLACE FUNCTION create_vehicle_event(
    p_vehicle_id UUID,
    p_event_type TEXT,
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_event_date DATE DEFAULT CURRENT_DATE,
    p_location_name TEXT DEFAULT NULL,
    p_participants JSONB DEFAULT '[]'::jsonb
) RETURNS UUID AS $$
DECLARE
    event_id UUID;
    participant JSONB;
BEGIN
    -- Create the main event
    INSERT INTO timeline_events (
        vehicle_id, user_id, event_type, event_category, title, description, event_date, location
    ) VALUES (
        p_vehicle_id, auth.uid(), p_event_type, 'ownership', p_title, p_description, p_event_date, p_location_name
    ) RETURNING id INTO event_id;
    
    -- Add participants if provided
    FOR participant IN SELECT * FROM jsonb_array_elements(p_participants)
    LOOP
        INSERT INTO timeline_event_participants (
            timeline_event_id, participant_name, participant_role, organization_name, participant_email
        ) VALUES (
            event_id,
            participant->>'name',
            participant->>'role',
            participant->>'organization',
            participant->>'email'
        );
    END LOOP;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
