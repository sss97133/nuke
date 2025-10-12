-- Add isPublic field to vehicles table for privacy controls
-- This allows users to make their vehicles private

-- Add the isPublic column with a default value of true (public by default)
ALTER TABLE vehicles 
ADD COLUMN isPublic BOOLEAN DEFAULT true;

-- Add an index for better query performance when filtering by privacy
CREATE INDEX idx_vehicles_is_public ON vehicles(isPublic);

-- Update existing vehicles to be public by default
UPDATE vehicles SET isPublic = true WHERE isPublic IS NULL;

-- Add a comment to document the field
COMMENT ON COLUMN vehicles.isPublic IS 'Whether the vehicle is publicly visible. Private vehicles are only accessible via direct links.'; 