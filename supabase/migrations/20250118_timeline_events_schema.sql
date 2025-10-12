-- Timeline Events System
-- Immutable vehicle history with confidence scoring and multi-source verification

-- Timeline Events Table
CREATE TABLE timeline_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Event Classification
    event_type TEXT NOT NULL CHECK (event_type IN (
        'purchase', 'sale', 'registration', 'inspection', 'maintenance', 
        'repair', 'modification', 'accident', 'insurance_claim', 'recall',
        'ownership_transfer', 'lien_change', 'title_update', 'mileage_reading'
    )),
    event_category TEXT NOT NULL CHECK (event_category IN (
        'ownership', 'maintenance', 'legal', 'performance', 'cosmetic', 'safety'
    )),
    
    -- Event Details
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    mileage_at_event INTEGER,
    location TEXT,
    
    -- Source and Verification
    source_type TEXT NOT NULL CHECK (source_type IN (
        'user_input', 'service_record', 'government_record', 'insurance_record',
        'dealer_record', 'manufacturer_recall', 'inspection_report', 'receipt'
    )),
    confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
        'unverified', 'user_verified', 'professional_verified', 'multi_verified', 'disputed'
    )),
    
    -- Supporting Documentation
    documentation_urls TEXT[], -- Array of URLs to supporting documents/images
    receipt_amount DECIMAL(10,2), -- Cost associated with event
    receipt_currency TEXT DEFAULT 'USD',
    
    -- Metadata
    metadata JSONB DEFAULT '{}', -- Flexible storage for event-specific data
    affects_value BOOLEAN DEFAULT false, -- Does this event affect vehicle value?
    affects_safety BOOLEAN DEFAULT false, -- Safety-related event?
    affects_performance BOOLEAN DEFAULT false, -- Performance impact?
    
    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Constraints
    CONSTRAINT valid_event_date CHECK (event_date <= CURRENT_DATE),
    CONSTRAINT valid_mileage CHECK (mileage_at_event >= 0)
);

-- Timeline Event Verifications
CREATE TABLE timeline_event_verifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    verifier_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Verification Details
    verification_type TEXT NOT NULL CHECK (verification_type IN (
        'owner_confirmation', 'professional_inspection', 'document_review',
        'cross_reference', 'third_party_validation'
    )),
    verification_status TEXT NOT NULL CHECK (verification_status IN (
        'verified', 'disputed', 'needs_review', 'insufficient_evidence'
    )),
    confidence_adjustment INTEGER DEFAULT 0 CHECK (confidence_adjustment >= -100 AND confidence_adjustment <= 100),
    
    -- Verification Notes
    notes TEXT,
    supporting_evidence TEXT[], -- URLs to additional evidence
    
    -- Professional Credentials (if applicable)
    professional_license TEXT,
    professional_type TEXT CHECK (professional_type IN (
        'mechanic', 'appraiser', 'inspector', 'dealer', 'insurance_adjuster'
    )),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Prevent duplicate verifications by same person
    UNIQUE(timeline_event_id, verifier_id)
);

-- Timeline Event Conflicts
CREATE TABLE timeline_event_conflicts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    conflicting_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    
    -- Conflict Details
    conflict_type TEXT NOT NULL CHECK (conflict_type IN (
        'date_mismatch', 'mileage_inconsistency', 'duplicate_event', 'contradictory_info'
    )),
    conflict_description TEXT NOT NULL,
    resolution_status TEXT DEFAULT 'unresolved' CHECK (resolution_status IN (
        'unresolved', 'resolved', 'accepted_discrepancy', 'merged_events'
    )),
    resolution_notes TEXT,
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Prevent self-conflicts and duplicates
    CHECK (primary_event_id != conflicting_event_id),
    UNIQUE(primary_event_id, conflicting_event_id)
);

-- Indexes for Performance
CREATE INDEX idx_timeline_events_vehicle_id ON timeline_events(vehicle_id);
CREATE INDEX idx_timeline_events_event_date ON timeline_events(event_date DESC);
CREATE INDEX idx_timeline_events_event_type ON timeline_events(event_type);
CREATE INDEX idx_timeline_events_verification_status ON timeline_events(verification_status);
CREATE INDEX idx_timeline_events_confidence_score ON timeline_events(confidence_score DESC);
CREATE INDEX idx_timeline_event_verifications_event_id ON timeline_event_verifications(timeline_event_id);
CREATE INDEX idx_timeline_event_conflicts_primary ON timeline_event_conflicts(primary_event_id);

-- Row Level Security
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_conflicts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for timeline_events
CREATE POLICY "Users can view timeline events for vehicles they own" ON timeline_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create timeline events for their vehicles" ON timeline_events
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own timeline events" ON timeline_events
    FOR UPDATE USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

-- RLS Policies for timeline_event_verifications
CREATE POLICY "Users can view verifications for events they can see" ON timeline_event_verifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = timeline_event_verifications.timeline_event_id
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create verifications" ON timeline_event_verifications
    FOR INSERT WITH CHECK (auth.uid() = verifier_id);

-- RLS Policies for timeline_event_conflicts
CREATE POLICY "Users can view conflicts for their events" ON timeline_event_conflicts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE (te.id = timeline_event_conflicts.primary_event_id 
                   OR te.id = timeline_event_conflicts.conflicting_event_id)
            AND v.user_id = auth.uid()
        )
    );

-- Functions for Timeline Management
CREATE OR REPLACE FUNCTION update_timeline_event_confidence()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate confidence score based on verifications
    UPDATE timeline_events 
    SET confidence_score = LEAST(100, GREATEST(0, 
        50 + COALESCE((
            SELECT AVG(confidence_adjustment)
            FROM timeline_event_verifications 
            WHERE timeline_event_id = NEW.timeline_event_id
            AND verification_status = 'verified'
        ), 0)
    ))
    WHERE id = NEW.timeline_event_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update confidence scores
CREATE TRIGGER update_timeline_confidence_trigger
    AFTER INSERT OR UPDATE ON timeline_event_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_timeline_event_confidence();

-- Function to detect timeline conflicts
CREATE OR REPLACE FUNCTION detect_timeline_conflicts()
RETURNS TRIGGER AS $$
BEGIN
    -- Check for mileage inconsistencies
    INSERT INTO timeline_event_conflicts (primary_event_id, conflicting_event_id, conflict_type, conflict_description)
    SELECT 
        NEW.id,
        te.id,
        'mileage_inconsistency',
        'Mileage reading inconsistent with timeline order'
    FROM timeline_events te
    WHERE te.vehicle_id = NEW.vehicle_id
    AND te.id != NEW.id
    AND te.mileage_at_event IS NOT NULL
    AND NEW.mileage_at_event IS NOT NULL
    AND (
        (te.event_date < NEW.event_date AND te.mileage_at_event > NEW.mileage_at_event) OR
        (te.event_date > NEW.event_date AND te.mileage_at_event < NEW.mileage_at_event)
    )
    ON CONFLICT (primary_event_id, conflicting_event_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to detect conflicts
CREATE TRIGGER detect_timeline_conflicts_trigger
    AFTER INSERT OR UPDATE ON timeline_events
    FOR EACH ROW
    EXECUTE FUNCTION detect_timeline_conflicts();

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_timeline_events_updated_at 
    BEFORE UPDATE ON timeline_events 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
