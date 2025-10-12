-- Add support for external image references and enhanced image metadata

-- Add columns to vehicle_images table for external image support
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user_upload', -- 'user_upload', 'bat_listing', 'scraped_listing', 'external_link'
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- Add document_type for listing photos to evidence_documents (skip if type doesn't exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_document_type') THEN
        ALTER TYPE evidence_document_type ADD VALUE IF NOT EXISTS 'listing_photo';
    END IF;
END $$;

-- Create function to get images with source information
CREATE OR REPLACE FUNCTION get_vehicle_images_with_source(p_vehicle_id UUID)
RETURNS TABLE (
    id UUID,
    image_url TEXT,
    filename TEXT,
    source TEXT,
    source_url TEXT,
    is_external BOOLEAN,
    file_size BIGINT,
    mime_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vi.id,
        vi.image_url,
        vi.filename,
        vi.source,
        vi.source_url,
        vi.is_external,
        vi.file_size,
        vi.mime_type,
        vi.created_at
    FROM vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
    ORDER BY vi.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create index for better performance on source queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_source ON vehicle_images(source);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_external ON vehicle_images(is_external) WHERE is_external = true;
