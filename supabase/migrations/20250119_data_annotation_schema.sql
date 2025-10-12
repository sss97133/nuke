-- Data Annotation System
-- Track data provenance, sources, and verification for all vehicle fields

-- Vehicle Data Sources Table
CREATE TABLE vehicle_data_sources (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Source Information
    source_type TEXT NOT NULL CHECK (source_type IN (
        'user_input', 'ai_extraction', 'service_record', 'government_record', 
        'insurance_record', 'dealer_record', 'manufacturer_data', 'inspection_report',
        'receipt', 'photo_metadata', 'third_party_api'
    )),
    source_name TEXT NOT NULL,
    source_url TEXT,
    extraction_method TEXT CHECK (extraction_method IN (
        'manual', 'ocr', 'ai_vision', 'api_call', 'form_input'
    )),
    confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    data_extracted JSONB DEFAULT '{}',
    extraction_metadata JSONB DEFAULT '{}',
    
    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Vehicle Field Annotations
CREATE TABLE vehicle_field_annotations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    field_value TEXT NOT NULL,
    data_source_id UUID REFERENCES vehicle_data_sources(id) ON DELETE CASCADE,
    confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
        'unverified', 'user_verified', 'professional_verified', 'disputed'
    )),
    verification_notes TEXT,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Data Source Conflicts
CREATE TABLE data_source_conflicts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    primary_source_id UUID REFERENCES vehicle_data_sources(id) ON DELETE CASCADE,
    conflicting_source_id UUID REFERENCES vehicle_data_sources(id) ON DELETE CASCADE,
    
    -- Conflict Details
    conflict_type TEXT NOT NULL CHECK (conflict_type IN (
        'value_mismatch', 'confidence_dispute', 'source_reliability'
    )),
    conflict_description TEXT NOT NULL,
    
    -- Resolution
    resolution_status TEXT DEFAULT 'unresolved' CHECK (resolution_status IN (
        'unresolved', 'resolved', 'accepted_variance', 'merged_sources'
    )),
    resolution_method TEXT CHECK (resolution_method IN (
        'higher_confidence', 'newer_data', 'professional_verification', 'manual_review'
    )),
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Constraints
    CHECK (primary_source_id != conflicting_source_id),
    UNIQUE(primary_source_id, conflicting_source_id)
);

-- Vehicle Modifications Tracking
CREATE TABLE vehicle_modifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    change_reason TEXT NOT NULL,
    data_source_id UUID REFERENCES vehicle_data_sources(id),
    modified_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    modification_type TEXT NOT NULL CHECK (modification_type IN (
        'correction', 'update', 'verification', 'dispute_resolution'
    )),
    confidence_impact INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for Performance
CREATE INDEX idx_vehicle_data_sources_vehicle ON vehicle_data_sources(vehicle_id);
CREATE INDEX idx_vehicle_data_sources_confidence ON vehicle_data_sources(confidence_score DESC);
CREATE INDEX idx_vehicle_data_sources_source_type ON vehicle_data_sources(source_type);
CREATE INDEX idx_vehicle_field_annotations_vehicle ON vehicle_field_annotations(vehicle_id);
CREATE INDEX idx_vehicle_field_annotations_primary ON vehicle_field_annotations(vehicle_id, field_name, is_primary);
CREATE INDEX idx_data_source_conflicts_vehicle_field ON data_source_conflicts(vehicle_id, field_name);
CREATE INDEX idx_data_source_conflicts_unresolved ON data_source_conflicts(resolution_status) WHERE resolution_status = 'unresolved';
CREATE INDEX idx_vehicle_modifications_vehicle ON vehicle_modifications(vehicle_id);
CREATE INDEX idx_vehicle_modifications_type ON vehicle_modifications(modification_type);

-- Row Level Security
ALTER TABLE vehicle_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_field_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_source_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_modifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vehicle_data_sources
CREATE POLICY "Users can view data sources for vehicles they own" ON vehicle_data_sources
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_data_sources.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create data sources for their vehicles" ON vehicle_data_sources
    FOR INSERT WITH CHECK (
        auth.uid() = created_by AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_data_sources.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

-- RLS Policies for vehicle_field_annotations
CREATE POLICY "Users can view field annotations for their vehicles" ON vehicle_field_annotations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_field_annotations.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

-- RLS Policies for data_source_conflicts
CREATE POLICY "Users can view conflicts for their vehicles" ON data_source_conflicts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = data_source_conflicts.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

-- RLS Policies for vehicle_modifications
CREATE POLICY "Users can manage modifications for their vehicles" ON vehicle_modifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_modifications.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

-- Functions for Data Annotation Management

-- Function to update field annotations when sources change
CREATE OR REPLACE FUNCTION update_field_annotation()
RETURNS TRIGGER AS $$
BEGIN
    -- This function is simplified since we're using a different annotation structure
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to detect data conflicts
CREATE OR REPLACE FUNCTION detect_data_conflicts()
RETURNS TRIGGER AS $$
BEGIN
    -- Find conflicting annotations for the same field with different values
    INSERT INTO data_source_conflicts (
        vehicle_id, field_name, primary_source_id, conflicting_source_id,
        conflict_type, conflict_description
    )
    SELECT DISTINCT
        NEW.vehicle_id,
        NEW.field_name,
        NEW.data_source_id,
        vfa.data_source_id,
        'value_mismatch',
        'Different values found for ' || NEW.field_name || ': "' || NEW.field_value || '" vs "' || vfa.field_value || '"'
    FROM vehicle_field_annotations vfa
    WHERE vfa.vehicle_id = NEW.vehicle_id
    AND vfa.field_name = NEW.field_name
    AND vfa.field_value != NEW.field_value
    AND vfa.data_source_id != NEW.data_source_id
    ON CONFLICT (primary_source_id, conflicting_source_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to detect conflicts
CREATE TRIGGER detect_data_conflicts_trigger
    AFTER INSERT OR UPDATE ON vehicle_field_annotations
    FOR EACH ROW
    EXECUTE FUNCTION detect_data_conflicts();
