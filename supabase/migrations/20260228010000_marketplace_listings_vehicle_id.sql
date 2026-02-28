-- Add vehicle_id column to marketplace_listings to link FB listings to vehicle records
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_vehicle_id ON marketplace_listings(vehicle_id) WHERE vehicle_id IS NOT NULL;
