-- Allow null user_id for automated/imported images
-- These images come from BaT extraction, Wayback Machine, etc. and have no user context

-- Drop the NOT NULL constraint on user_id
ALTER TABLE vehicle_images ALTER COLUMN user_id DROP NOT NULL;

-- Add a check: if source is 'user_upload', user_id must be provided
-- Otherwise (bat_import, external, etc.) user_id can be null
COMMENT ON COLUMN vehicle_images.user_id IS 'User who uploaded the image. NULL for automated imports (bat_import, external sources)';

-- Create index for finding orphaned/system images efficiently
CREATE INDEX IF NOT EXISTS idx_vehicle_images_null_user
ON vehicle_images(created_at DESC)
WHERE user_id IS NULL;
