-- Add transmission_model column to vehicles table
-- This stores specific transmission model codes like "6L90", "4L60E", "TH350", etc.

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission_model TEXT;

-- Add index for queries
CREATE INDEX IF NOT EXISTS idx_vehicles_transmission_model ON vehicles(transmission_model);

-- Add comment
COMMENT ON COLUMN vehicles.transmission_model IS 'Specific transmission model/code (e.g., 6L90, 4L60E, TH350, Getrag 260)';

