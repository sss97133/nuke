-- Add vehicle discovery tracking fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovered_by uuid REFERENCES profiles(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovery_source text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovery_url text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_listing_title text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_bids integer;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_comments integer;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_views integer;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_location text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_seller text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_status text DEFAULT 'available';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS auction_end_date timestamp with time zone;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_price numeric(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sale_date date;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS completion_percentage integer DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS displacement text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS interior_color text;

-- Create index for discovery tracking
CREATE INDEX IF NOT EXISTS idx_vehicles_discovered_by ON vehicles(discovered_by);
CREATE INDEX IF NOT EXISTS idx_vehicles_discovery_source ON vehicles(discovery_source);

-- Add comment for documentation
COMMENT ON COLUMN vehicles.discovered_by IS 'User who first discovered/imported this vehicle';
COMMENT ON COLUMN vehicles.discovery_source IS 'Source of vehicle discovery (bat_extension, manual, import, etc)';
COMMENT ON COLUMN vehicles.discovery_url IS 'Original URL where vehicle was discovered';
COMMENT ON COLUMN vehicles.bat_listing_title IS 'Original Bring a Trailer listing title';
COMMENT ON COLUMN vehicles.bat_bids IS 'Number of bids from BAT listing';
COMMENT ON COLUMN vehicles.bat_comments IS 'Number of comments from BAT listing';
COMMENT ON COLUMN vehicles.bat_views IS 'Number of views from BAT listing';
COMMENT ON COLUMN vehicles.bat_location IS 'Location from BAT listing';
COMMENT ON COLUMN vehicles.bat_seller IS 'Seller username from BAT listing';
COMMENT ON COLUMN vehicles.sale_status IS 'Current sale status (available, sold, discovered, etc)';
COMMENT ON COLUMN vehicles.auction_end_date IS 'When the auction ends/ended';
COMMENT ON COLUMN vehicles.sale_price IS 'Final sale price if sold';
COMMENT ON COLUMN vehicles.sale_date IS 'Date of sale if sold';
COMMENT ON COLUMN vehicles.status IS 'Vehicle profile status (draft, active, archived)';
COMMENT ON COLUMN vehicles.completion_percentage IS 'Percentage of required fields completed';
