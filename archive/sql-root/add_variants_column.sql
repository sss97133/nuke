-- Add variants column to vehicle_images table for multi-resolution support
-- This enables storing thumbnail, medium, and large image variants for performance

-- Check if column exists and add it if it doesn't
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicle_images'
        AND column_name = 'variants'
    ) THEN
        ALTER TABLE vehicle_images
        ADD COLUMN variants JSONB DEFAULT '{}';

        RAISE NOTICE 'Added variants column to vehicle_images table';
    ELSE
        RAISE NOTICE 'variants column already exists in vehicle_images table';
    END IF;
END $$;

-- Create index for efficient variant queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_variants
ON vehicle_images USING GIN (variants);

-- Verify the addition
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'vehicle_images'
AND column_name = 'variants';