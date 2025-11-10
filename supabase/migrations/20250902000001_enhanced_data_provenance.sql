-- Enhanced data provenance and dynamic field support
-- This migration addresses the need for auditable AI data and expandable vehicle forms

-- 1. Create vehicle_field_sources table if it doesn't exist
CREATE TABLE IF NOT EXISTS vehicle_field_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    source_type TEXT NOT NULL, -- 'human_input', 'ai_scan', 'ai_extraction', 'ocr'
    confidence_score DECIMAL(3,2) DEFAULT 0.8,
    metadata JSONB DEFAULT '{}',
    user_id UUID REFERENCES auth.users(id),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new columns for enhanced provenance
ALTER TABLE vehicle_field_sources 
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS source_image_id UUID REFERENCES vehicle_images(id),
ADD COLUMN IF NOT EXISTS extraction_method TEXT, -- 'url_scraping', 'ocr', 'manual_entry', 'api_lookup'
ADD COLUMN IF NOT EXISTS raw_extracted_text TEXT, -- Original text that was processed
ADD COLUMN IF NOT EXISTS ai_reasoning TEXT, -- How AI arrived at this value
ADD COLUMN IF NOT EXISTS verification_notes TEXT; -- Human verification notes

-- 2. Create dynamic vehicle data table for expandable fields
CREATE TABLE IF NOT EXISTS vehicle_dynamic_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    field_value TEXT,
    field_type TEXT DEFAULT 'text', -- 'text', 'number', 'date', 'boolean', 'url'
    field_category TEXT, -- 'specs', 'pricing', 'history', 'maintenance', 'legal'
    display_order INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(vehicle_id, field_name)
);

-- 3. Create evidence documents table for storing source materials
CREATE TABLE IF NOT EXISTS evidence_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL, -- 'window_sticker', 'service_record', 'title', 'registration', 'manual'
    image_id UUID REFERENCES vehicle_images(id),
    extracted_text TEXT,
    confidence_score DECIMAL(3,2),
    processing_method TEXT, -- 'ocr', 'manual_transcription'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Link evidence to field sources
ALTER TABLE vehicle_field_sources 
ADD COLUMN IF NOT EXISTS evidence_document_id UUID REFERENCES evidence_documents(id);

-- 5. Create function to get full audit trail for a field
CREATE OR REPLACE FUNCTION get_field_audit_trail(
    p_vehicle_id UUID,
    p_field_name TEXT
)
RETURNS TABLE (
    source_type TEXT,
    source_url TEXT,
    source_image_url TEXT,
    extraction_method TEXT,
    raw_text TEXT,
    ai_reasoning TEXT,
    confidence DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE,
    verification_status BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vfs.source_type,
        vfs.source_url,
        vi.image_url as source_image_url,
        vfs.extraction_method,
        vfs.raw_extracted_text,
        vfs.ai_reasoning,
        vfs.confidence_score,
        vfs.created_at,
        vfs.is_verified
    FROM vehicle_field_sources vfs
    LEFT JOIN vehicle_images vi ON vfs.source_image_id = vi.id
    WHERE vfs.vehicle_id = p_vehicle_id 
    AND vfs.field_name = p_field_name
    ORDER BY vfs.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to add dynamic field with source tracking
CREATE OR REPLACE FUNCTION add_dynamic_vehicle_field(
    p_vehicle_id UUID,
    p_field_name TEXT,
    p_field_value TEXT,
    p_field_type TEXT DEFAULT 'text',
    p_field_category TEXT DEFAULT 'other',
    p_source_type TEXT DEFAULT 'ai_extraction',
    p_source_url TEXT DEFAULT NULL,
    p_source_image_id UUID DEFAULT NULL,
    p_extraction_method TEXT DEFAULT NULL,
    p_raw_text TEXT DEFAULT NULL,
    p_ai_reasoning TEXT DEFAULT NULL,
    p_confidence DECIMAL(3,2) DEFAULT 0.8,
    p_user_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    field_source_id UUID;
BEGIN
    -- Insert or update dynamic field
    INSERT INTO vehicle_dynamic_data (
        vehicle_id, field_name, field_value, field_type, field_category
    ) VALUES (
        p_vehicle_id, p_field_name, p_field_value, p_field_type, p_field_category
    )
    ON CONFLICT (vehicle_id, field_name) 
    DO UPDATE SET 
        field_value = EXCLUDED.field_value,
        field_type = EXCLUDED.field_type,
        field_category = EXCLUDED.field_category,
        updated_at = NOW();

    -- Track the source
    INSERT INTO vehicle_field_sources (
        vehicle_id, field_name, source_type, confidence_score,
        source_url, source_image_id, extraction_method,
        raw_extracted_text, ai_reasoning, user_id
    ) VALUES (
        p_vehicle_id, p_field_name, p_source_type, p_confidence,
        p_source_url, p_source_image_id, p_extraction_method,
        p_raw_text, p_ai_reasoning, p_user_id
    )
    RETURNING id INTO field_source_id;

    RETURN field_source_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Enable RLS on new tables
ALTER TABLE vehicle_dynamic_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vehicle_dynamic_data
DROP POLICY IF EXISTS "Users can view dynamic data for vehicles they own or that are public" ON vehicle_dynamic_data;
CREATE POLICY "Users can view dynamic data for vehicles they own or that are public"
    ON vehicle_dynamic_data FOR SELECT
    USING (
        vehicle_id IN (
            SELECT id FROM vehicles 
            WHERE user_id = auth.uid() OR is_public = true
        )
    );

DROP POLICY IF EXISTS "Users can modify dynamic data for vehicles they own" ON vehicle_dynamic_data;
CREATE POLICY "Users can modify dynamic data for vehicles they own"
    ON vehicle_dynamic_data FOR ALL
    USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );

-- RLS Policies for evidence_documents
DROP POLICY IF EXISTS "Users can view evidence for vehicles they own or that are public" ON evidence_documents;
CREATE POLICY "Users can view evidence for vehicles they own or that are public"
    ON evidence_documents FOR SELECT
    USING (
        vehicle_id IN (
            SELECT id FROM vehicles 
            WHERE user_id = auth.uid() OR is_public = true
        )
    );

DROP POLICY IF EXISTS "Users can modify evidence for vehicles they own" ON evidence_documents;
CREATE POLICY "Users can modify evidence for vehicles they own"
    ON evidence_documents FOR ALL
    USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );
