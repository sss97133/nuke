-- Add BAT auction data fields to vehicles table
-- These fields store Bring a Trailer auction information

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_auction_url TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_sold_price DECIMAL(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_sale_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_bid_count INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bat_view_count INTEGER;

-- Add usage pattern fields for vehicle status determination
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_daily_driver BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_weekend_car BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_track_car BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_show_car BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_project_car BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_garage_kept BOOLEAN DEFAULT FALSE;

-- Add indexes for BAT auction data
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_auction_url ON vehicles(bat_auction_url);
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_sale_date ON vehicles(bat_sale_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_sold_price ON vehicles(bat_sold_price);

-- Add indexes for usage patterns
CREATE INDEX IF NOT EXISTS idx_vehicles_daily_driver ON vehicles(is_daily_driver);
CREATE INDEX IF NOT EXISTS idx_vehicles_weekend_car ON vehicles(is_weekend_car);
CREATE INDEX IF NOT EXISTS idx_vehicles_track_car ON vehicles(is_track_car);
CREATE INDEX IF NOT EXISTS idx_vehicles_show_car ON vehicles(is_show_car);
CREATE INDEX IF NOT EXISTS idx_vehicles_project_car ON vehicles(is_project_car);
