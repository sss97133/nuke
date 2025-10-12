-- Fix database schema for duplicate detection
-- Add missing columns to vehicle_images table

ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS file_hash TEXT,
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- Create indexes for efficient duplicate detection
CREATE INDEX IF NOT EXISTS idx_vehicle_images_hash ON vehicle_images(file_hash);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_hash ON vehicle_images(vehicle_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_taken_at ON vehicle_images(taken_at);

-- Create index for similarity searches
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_metadata ON vehicle_images(vehicle_id, file_name, file_size);

-- Add constraint to prevent exact duplicates at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_images_unique_hash 
ON vehicle_images(vehicle_id, file_hash) 
WHERE file_hash IS NOT NULL;
