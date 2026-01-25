-- Add Cars & Bids specific columns to vehicles table
-- These capture unique C&B content that's valuable for analysis

ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS dougs_take TEXT,
ADD COLUMN IF NOT EXISTS highlights TEXT,
ADD COLUMN IF NOT EXISTS equipment TEXT,
ADD COLUMN IF NOT EXISTS modifications TEXT,
ADD COLUMN IF NOT EXISTS known_flaws TEXT,
ADD COLUMN IF NOT EXISTS recent_service_history TEXT,
ADD COLUMN IF NOT EXISTS title_status TEXT,
ADD COLUMN IF NOT EXISTS seller_name TEXT,
ADD COLUMN IF NOT EXISTS comment_count INTEGER,
ADD COLUMN IF NOT EXISTS auction_status TEXT;

COMMENT ON COLUMN vehicles.dougs_take IS 'Doug DeMuro''s personal commentary on the vehicle (C&B exclusive)';
COMMENT ON COLUMN vehicles.highlights IS 'Key selling points and notable features';
COMMENT ON COLUMN vehicles.equipment IS 'Factory and aftermarket equipment list';
COMMENT ON COLUMN vehicles.modifications IS 'Modifications made to the vehicle';
COMMENT ON COLUMN vehicles.known_flaws IS 'Disclosed issues or imperfections';
COMMENT ON COLUMN vehicles.recent_service_history IS 'Recent maintenance and service records';
COMMENT ON COLUMN vehicles.title_status IS 'Title status (clean, salvage, rebuilt, etc)';
COMMENT ON COLUMN vehicles.seller_name IS 'Name or username of the seller';
COMMENT ON COLUMN vehicles.comment_count IS 'Number of comments on the auction';
COMMENT ON COLUMN vehicles.auction_status IS 'Status: active, ended, sold, reserve_not_met';

-- Index for auction analysis
CREATE INDEX IF NOT EXISTS idx_vehicles_auction_status ON vehicles(auction_status) WHERE auction_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_comment_count ON vehicles(comment_count DESC) WHERE comment_count IS NOT NULL;
