-- Add rotation and improve sensitive content fields for vehicle_images
-- Rotation: 0, 90, 180, 270 degrees (for display orientation)
-- Sensitive: For blurring faces, titles, personal info

DO $$ 
BEGIN
    -- Add rotation field (0, 90, 180, 270)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vehicle_images' AND column_name = 'rotation'
    ) THEN
        ALTER TABLE vehicle_images ADD COLUMN rotation INTEGER DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270));
        CREATE INDEX idx_vehicle_images_rotation ON vehicle_images(rotation);
        COMMENT ON COLUMN vehicle_images.rotation IS 'Display rotation in degrees: 0, 90, 180, 270';
    END IF;

    -- Ensure is_sensitive exists (should already be there)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vehicle_images' AND column_name = 'is_sensitive'
    ) THEN
        ALTER TABLE vehicle_images ADD COLUMN is_sensitive BOOLEAN DEFAULT FALSE;
        CREATE INDEX idx_vehicle_images_sensitive ON vehicle_images(is_sensitive);
        COMMENT ON COLUMN vehicle_images.is_sensitive IS 'True if image contains sensitive content (faces, personal info, titles, etc.) that should be blurred';
    END IF;

    -- Ensure sensitive_type exists (should already be there)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'vehicle_images' AND column_name = 'sensitive_type'
    ) THEN
        ALTER TABLE vehicle_images ADD COLUMN sensitive_type TEXT;
        COMMENT ON COLUMN vehicle_images.sensitive_type IS 'Type of sensitive content: face, title, license_plate, personal_info, etc.';
    END IF;
END $$;

