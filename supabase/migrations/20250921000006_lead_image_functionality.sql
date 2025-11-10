-- ============================================================================
-- LEAD IMAGE FUNCTIONALITY - Vehicle Images Table Updates
-- ============================================================================

-- Add missing columns to vehicle_images table for lead image functionality
DO $$ 
BEGIN
    -- Add storage_path column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'storage_path') THEN
        ALTER TABLE vehicle_images ADD COLUMN storage_path TEXT;
    END IF;

    -- Add filename column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'filename') THEN
        ALTER TABLE vehicle_images ADD COLUMN filename TEXT;
    END IF;

    -- Add mime_type column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'mime_type') THEN
        ALTER TABLE vehicle_images ADD COLUMN mime_type TEXT;
    END IF;

    -- Add file_size column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'file_size') THEN
        ALTER TABLE vehicle_images ADD COLUMN file_size BIGINT;
    END IF;

    -- Ensure is_primary column exists and has proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'is_primary') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_primary BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Create index on is_primary for better lead image queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_is_primary ON vehicle_images(vehicle_id, is_primary) WHERE is_primary = true;

-- Create function to ensure only one primary image per vehicle
CREATE OR REPLACE FUNCTION ensure_single_primary_image()
RETURNS TRIGGER AS $$
BEGIN
    -- If setting this image as primary, clear all other primary flags for this vehicle
    IF NEW.is_primary = true THEN
        UPDATE vehicle_images 
        SET is_primary = false 
        WHERE vehicle_id = NEW.vehicle_id 
        AND id != NEW.id 
        AND is_primary = true;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to maintain single primary image constraint
DROP TRIGGER IF EXISTS trigger_ensure_single_primary_image ON vehicle_images;
CREATE TRIGGER trigger_ensure_single_primary_image
    BEFORE INSERT OR UPDATE ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_image();

-- Function to set first image as primary if no primary exists
CREATE OR REPLACE FUNCTION set_first_image_as_primary_if_none()
RETURNS TRIGGER AS $$
BEGIN
    -- After insert, check if this vehicle has any primary image
    IF NOT EXISTS (
        SELECT 1 FROM vehicle_images 
        WHERE vehicle_id = NEW.vehicle_id 
        AND is_primary = true
    ) THEN
        -- Set the oldest image as primary
        UPDATE vehicle_images 
        SET is_primary = true 
        WHERE id = (
            SELECT id FROM vehicle_images 
            WHERE vehicle_id = NEW.vehicle_id 
            ORDER BY created_at ASC 
            LIMIT 1
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-set primary image
DROP TRIGGER IF EXISTS trigger_set_first_primary ON vehicle_images;
CREATE TRIGGER trigger_set_first_primary
    AFTER INSERT ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION set_first_image_as_primary_if_none();

-- Comments
COMMENT ON COLUMN vehicle_images.storage_path IS 'Storage path in Supabase storage bucket';
COMMENT ON COLUMN vehicle_images.filename IS 'Original filename of uploaded image';
COMMENT ON COLUMN vehicle_images.mime_type IS 'MIME type of the image file';
COMMENT ON COLUMN vehicle_images.file_size IS 'File size in bytes';
COMMENT ON COLUMN vehicle_images.is_primary IS 'Whether this is the primary/lead image for the vehicle';
COMMENT ON FUNCTION ensure_single_primary_image IS 'Ensures only one image per vehicle can be marked as primary';
COMMENT ON FUNCTION set_first_image_as_primary_if_none IS 'Automatically sets first image as primary if no primary exists';
