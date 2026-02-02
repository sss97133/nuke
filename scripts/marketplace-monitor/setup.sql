-- Facebook Marketplace Listings Table
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_id TEXT UNIQUE NOT NULL,
  title TEXT,
  price INTEGER,
  location TEXT,
  url TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  seller_name TEXT,
  search_query TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- For linking to vehicles later
  vehicle_id UUID REFERENCES vehicles(id),
  reviewed BOOLEAN DEFAULT FALSE,
  review_notes TEXT
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_marketplace_facebook_id ON marketplace_listings(facebook_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_scraped_at ON marketplace_listings(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_price ON marketplace_listings(price);
CREATE INDEX IF NOT EXISTS idx_marketplace_reviewed ON marketplace_listings(reviewed);

-- Enable RLS
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON marketplace_listings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- View for recent unreviewed listings
CREATE OR REPLACE VIEW marketplace_new_listings AS
SELECT
  id,
  facebook_id,
  title,
  price,
  location,
  url,
  image_url,
  search_query,
  scraped_at
FROM marketplace_listings
WHERE reviewed = FALSE
ORDER BY scraped_at DESC
LIMIT 100;
