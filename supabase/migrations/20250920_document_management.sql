-- Migration: Create document management system for vehicles
-- Handles receipts, invoices, titles, and other paperwork with PII protection

-- Create document categories
CREATE TYPE document_category AS ENUM (
    'receipt',
    'invoice', 
    'title',
    'registration',
    'insurance',
    'service_record',
    'parts_order',
    'shipping_document',
    'legal_document',
    'other'
);

-- Create document privacy levels
CREATE TYPE document_privacy AS ENUM (
    'public',        -- Anyone can view
    'owner_only',    -- Only vehicle owner can view
    'restricted'     -- Owner + specific authorized users
);

-- Main documents table
CREATE TABLE IF NOT EXISTS vehicle_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    
    -- Document metadata
    document_type document_category NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    document_date DATE,
    
    -- File information
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER,
    
    -- Privacy and security
    privacy_level document_privacy DEFAULT 'owner_only',
    contains_pii BOOLEAN DEFAULT false,
    pii_redacted_url TEXT, -- URL to version with PII removed
    
    -- Extracted data (for timeline events)
    extracted_data JSONB DEFAULT '{}',
    vendor_name TEXT,
    amount DECIMAL(10,2),
    currency TEXT DEFAULT 'USD',
    
    -- Parts/service specific fields
    parts_ordered TEXT[],
    service_performed TEXT,
    
    -- Timeline integration
    timeline_event_created BOOLEAN DEFAULT false,
    timeline_event_id UUID REFERENCES timeline_events(id),
    
    -- Metadata
    uploaded_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sensitive information vault (encrypted storage for PII)
CREATE TABLE IF NOT EXISTS document_sensitive_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
    
    -- Encrypted PII fields
    full_name_encrypted TEXT,
    address_encrypted TEXT,
    phone_encrypted TEXT,
    email_encrypted TEXT,
    ssn_encrypted TEXT,
    license_number_encrypted TEXT,
    
    -- Access control
    last_accessed TIMESTAMPTZ,
    accessed_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document access logs for audit trail
CREATE TABLE IF NOT EXISTS document_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
    accessed_by UUID REFERENCES auth.users(id),
    access_type TEXT CHECK (access_type IN ('view', 'download', 'edit', 'delete')),
    ip_address INET,
    user_agent TEXT,
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document tags for organization
CREATE TABLE IF NOT EXISTS document_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, tag)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle_id ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_type ON vehicle_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_date ON vehicle_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vendor ON vehicle_documents(vendor_name);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
CREATE INDEX IF NOT EXISTS idx_document_access_logs_document ON document_access_logs(document_id);

-- RLS Policies
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sensitive_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_tags ENABLE ROW LEVEL SECURITY;

-- Document viewing policies
CREATE POLICY "Public documents viewable by all" ON vehicle_documents
    FOR SELECT USING (privacy_level = 'public');

CREATE POLICY "Owner can view all their documents" ON vehicle_documents
    FOR SELECT USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Owner can manage their documents" ON vehicle_documents
    FOR ALL USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );

-- Sensitive data only accessible by owner
CREATE POLICY "Only owner can access sensitive data" ON document_sensitive_data
    FOR ALL USING (
        document_id IN (
            SELECT id FROM vehicle_documents WHERE vehicle_id IN (
                SELECT id FROM vehicles WHERE user_id = auth.uid()
            )
        )
    );

-- Access logs viewable by owner
CREATE POLICY "Owner can view document access logs" ON document_access_logs
    FOR SELECT USING (
        document_id IN (
            SELECT id FROM vehicle_documents WHERE vehicle_id IN (
                SELECT id FROM vehicles WHERE user_id = auth.uid()
            )
        )
    );

-- Function to create timeline event from document
CREATE OR REPLACE FUNCTION create_timeline_event_from_document()
RETURNS TRIGGER AS $$
DECLARE
    event_title TEXT;
    event_description TEXT;
    event_type TEXT;
BEGIN
    -- Only create event for certain document types
    IF NEW.document_type IN ('receipt', 'invoice', 'parts_order', 'service_record') AND 
       NEW.timeline_event_created = false THEN
        
        -- Determine event type and title based on document
        CASE NEW.document_type
            WHEN 'receipt' THEN
                event_type := 'purchase';
                event_title := COALESCE('Purchase from ' || NEW.vendor_name, 'Purchase receipt');
            WHEN 'invoice' THEN
                event_type := 'service';
                event_title := COALESCE('Service at ' || NEW.vendor_name, 'Service invoice');
            WHEN 'parts_order' THEN
                event_type := 'parts';
                event_title := 'Parts ordered';
            WHEN 'service_record' THEN
                event_type := 'maintenance';
                event_title := COALESCE(NEW.service_performed, 'Service performed');
        END CASE;
        
        event_description := COALESCE(NEW.description, 'Document uploaded: ' || NEW.title);
        
        -- Insert timeline event
        INSERT INTO timeline_events (
            vehicle_id,
            event_type,
            event_category,
            title,
            description,
            event_date,
            event_data,
            created_by,
            confidence_score
        ) VALUES (
            NEW.vehicle_id,
            event_type,
            'documentation',
            event_title,
            event_description,
            COALESCE(NEW.document_date, CURRENT_DATE),
            jsonb_build_object(
                'document_id', NEW.id,
                'document_type', NEW.document_type,
                'vendor', NEW.vendor_name,
                'amount', NEW.amount,
                'currency', NEW.currency,
                'parts', NEW.parts_ordered
            ),
            NEW.uploaded_by,
            85 -- Moderate confidence since it's from a document
        ) RETURNING id INTO NEW.timeline_event_id;
        
        -- Mark that timeline event was created
        NEW.timeline_event_created := true;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_timeline_from_document
    AFTER INSERT ON vehicle_documents
    FOR EACH ROW
    EXECUTE FUNCTION create_timeline_event_from_document();

-- Function to log document access
CREATE OR REPLACE FUNCTION log_document_access()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO document_access_logs (
        document_id,
        accessed_by,
        access_type
    ) VALUES (
        NEW.id,
        auth.uid(),
        TG_ARGV[0] -- Pass access type as argument
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE vehicle_documents IS 'Stores vehicle-related documents with PII protection';
COMMENT ON TABLE document_sensitive_data IS 'Encrypted storage for sensitive information extracted from documents';
COMMENT ON COLUMN vehicle_documents.pii_redacted_url IS 'URL to version of document with PII blacked out for public viewing';
COMMENT ON COLUMN vehicle_documents.extracted_data IS 'JSON data extracted from document via OCR/AI';
