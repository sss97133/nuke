-- Ensure vehicle_images table exists with all required columns
-- This migration is idempotent and safe to run multiple times

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    image_url TEXT NOT NULL,
    image_type TEXT DEFAULT 'general',
    image_category TEXT DEFAULT 'exterior',
    category TEXT DEFAULT 'general',
    position INTEGER DEFAULT 0,
    caption TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add all columns that might be missing (using IF NOT EXISTS pattern)
DO $$ 
BEGIN
    -- Basic file metadata
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'filename') THEN
        ALTER TABLE vehicle_images ADD COLUMN filename TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'file_name') THEN
        ALTER TABLE vehicle_images ADD COLUMN file_name TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'storage_path') THEN
        ALTER TABLE vehicle_images ADD COLUMN storage_path TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'file_size') THEN
        ALTER TABLE vehicle_images ADD COLUMN file_size BIGINT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'mime_type') THEN
        ALTER TABLE vehicle_images ADD COLUMN mime_type TEXT;
    END IF;
    
    -- Hash columns for duplicate detection
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'file_hash') THEN
        ALTER TABLE vehicle_images ADD COLUMN file_hash TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'perceptual_hash') THEN
        ALTER TABLE vehicle_images ADD COLUMN perceptual_hash TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'dhash') THEN
        ALTER TABLE vehicle_images ADD COLUMN dhash TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'duplicate_of') THEN
        ALTER TABLE vehicle_images ADD COLUMN duplicate_of UUID REFERENCES vehicle_images(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'is_duplicate') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_duplicate BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Location and date metadata
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'taken_at') THEN
        ALTER TABLE vehicle_images ADD COLUMN taken_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'latitude') THEN
        ALTER TABLE vehicle_images ADD COLUMN latitude DOUBLE PRECISION;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'longitude') THEN
        ALTER TABLE vehicle_images ADD COLUMN longitude DOUBLE PRECISION;
    END IF;
    
    -- Image variants and EXIF
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'variants') THEN
        ALTER TABLE vehicle_images ADD COLUMN variants JSONB;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'exif_data') THEN
        ALTER TABLE vehicle_images ADD COLUMN exif_data JSONB;
    END IF;
    
    -- Document classification
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'is_document') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_document BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'document_category') THEN
        ALTER TABLE vehicle_images ADD COLUMN document_category TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'document_classification') THEN
        ALTER TABLE vehicle_images ADD COLUMN document_classification TEXT;
    END IF;
    
    -- AI processing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'ai_processing_status') THEN
        ALTER TABLE vehicle_images ADD COLUMN ai_processing_status TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'ai_scan_metadata') THEN
        ALTER TABLE vehicle_images ADD COLUMN ai_scan_metadata JSONB;
    END IF;
    
    -- Organization and source
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'organization_status') THEN
        ALTER TABLE vehicle_images ADD COLUMN organization_status TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'source') THEN
        ALTER TABLE vehicle_images ADD COLUMN source TEXT DEFAULT 'user_upload';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'source_url') THEN
        ALTER TABLE vehicle_images ADD COLUMN source_url TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'is_external') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_external BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Sensitive content
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'is_sensitive') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_sensitive BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'sensitive_type') THEN
        ALTER TABLE vehicle_images ADD COLUMN sensitive_type TEXT;
    END IF;
    
    -- Rotation
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'rotation') THEN
        ALTER TABLE vehicle_images ADD COLUMN rotation INTEGER DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270));
    END IF;
    
    -- Process stage
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'process_stage') THEN
        ALTER TABLE vehicle_images ADD COLUMN process_stage TEXT;
    END IF;
    
    -- Documented by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'documented_by_user_id') THEN
        ALTER TABLE vehicle_images ADD COLUMN documented_by_user_id UUID REFERENCES auth.users(id);
    END IF;
    
    -- Thumbnail and medium URLs
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'thumbnail_url') THEN
        ALTER TABLE vehicle_images ADD COLUMN thumbnail_url TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_images' AND column_name = 'medium_url') THEN
        ALTER TABLE vehicle_images ADD COLUMN medium_url TEXT;
    END IF;
    
    -- Make vehicle_id nullable (for personal library images)
    ALTER TABLE vehicle_images ALTER COLUMN vehicle_id DROP NOT NULL;
    
END $$;

-- Enable Row Level Security
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_id ON vehicle_images(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_position ON vehicle_images(position);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_primary ON vehicle_images(is_primary);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_filename ON vehicle_images(filename);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_file_hash ON vehicle_images(file_hash);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_taken_at ON vehicle_images(taken_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_processing_status ON vehicle_images(ai_processing_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_is_document ON vehicle_images(is_document);

-- Create or replace RLS policies
DROP POLICY IF EXISTS "Users can view images for vehicles they own" ON vehicle_images;
CREATE POLICY "Users can view images for vehicles they own" ON vehicle_images
    FOR SELECT USING (
        vehicle_id IS NULL OR EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can view images for public vehicles" ON vehicle_images;
CREATE POLICY "Users can view images for public vehicles" ON vehicle_images
    FOR SELECT USING (
        vehicle_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.is_public = true
        )
    );

DROP POLICY IF EXISTS "Users can view their own images" ON vehicle_images;
CREATE POLICY "Users can view their own images" ON vehicle_images
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can insert images for their own vehicles" ON vehicle_images
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND (
            vehicle_id IS NULL OR EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can update images for their own vehicles" ON vehicle_images
    FOR UPDATE USING (
        auth.uid() = user_id AND (
            vehicle_id IS NULL OR EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can delete images for their own vehicles" ON vehicle_images
    FOR DELETE USING (
        auth.uid() = user_id AND (
            vehicle_id IS NULL OR EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
        )
    );

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_vehicle_images_updated_at ON vehicle_images;
CREATE TRIGGER update_vehicle_images_updated_at
    BEFORE UPDATE ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

