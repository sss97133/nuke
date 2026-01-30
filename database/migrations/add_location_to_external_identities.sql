-- Add location fields to external_identities
-- For tracking where users are located (from their vehicle sales, profile, etc.)

ALTER TABLE external_identities
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS postal_code TEXT,
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS location_source TEXT, -- 'vehicle_sale', 'profile', 'manual', 'geocoded'
ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Index for geographic queries
CREATE INDEX IF NOT EXISTS idx_external_identities_location
ON external_identities (country, state, city)
WHERE city IS NOT NULL;

-- Index for map queries (if using lat/lng)
CREATE INDEX IF NOT EXISTS idx_external_identities_coords
ON external_identities (latitude, longitude)
WHERE latitude IS NOT NULL;

COMMENT ON COLUMN external_identities.city IS 'City from most recent known location';
COMMENT ON COLUMN external_identities.state IS 'State/province from most recent known location';
COMMENT ON COLUMN external_identities.location_source IS 'How we determined location: vehicle_sale, profile, manual, geocoded';
