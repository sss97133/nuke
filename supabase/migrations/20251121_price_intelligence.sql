-- PRICE INTELLIGENCE SYSTEM
-- Tracks price history and market listings extracted from comments, posts, and external sources

-- Create price_history table to track all price changes over time
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  price NUMERIC(10, 2) NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('sale_price', 'asking_price', 'market_listing', 'current_value', 'purchase_price', 'msrp')),
  
  -- Source tracking
  source_type TEXT NOT NULL CHECK (source_type IN ('owner_entry', 'market_listing', 'comment_extraction', 'ai_extraction', 'manual_update', 'import')),
  source_platform TEXT, -- 'craigslist', 'bringatrailer', 'ebay', 'carsandbids', etc.
  source_url TEXT,
  source_comment_id UUID REFERENCES vehicle_comments(id) ON DELETE SET NULL,
  
  -- Verification and confidence
  verified_by_owner BOOLEAN DEFAULT FALSE,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  
  -- Metadata
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  valid_to TIMESTAMP WITH TIME ZONE, -- NULL means current
  
  -- Additional context
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Index for efficient querying
  CONSTRAINT unique_vehicle_price_valid_from UNIQUE (vehicle_id, valid_from, price_type)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_price_history_vehicle_id ON price_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_price_history_valid_range ON price_history(vehicle_id, valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_history_source_comment ON price_history(source_comment_id) WHERE source_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_history_platform ON price_history(source_platform) WHERE source_platform IS NOT NULL;

-- Create market_listings table for detailed tracking of external listings
CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Listing details
  platform TEXT NOT NULL, -- 'craigslist', 'bringatrailer', 'ebay', etc.
  listing_url TEXT NOT NULL,
  listing_id TEXT, -- External platform ID
  title TEXT,
  description TEXT,
  
  -- Price tracking
  asking_price NUMERIC(10, 2),
  sold_price NUMERIC(10, 2),
  price_currency TEXT DEFAULT 'USD',
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'expired', 'removed', 'unknown')),
  
  -- Dates
  listed_date TIMESTAMP WITH TIME ZONE,
  sold_date TIMESTAMP WITH TIME ZONE,
  last_seen_date TIMESTAMP WITH TIME ZONE,
  
  -- Discovery
  discovered_by TEXT, -- 'user_comment', 'ai_scan', 'manual_entry'
  discovered_comment_id UUID REFERENCES vehicle_comments(id) ON DELETE SET NULL,
  
  -- Verification
  verified_by_owner BOOLEAN DEFAULT FALSE,
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  
  -- Additional data
  images JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_listing_url UNIQUE (listing_url)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_market_listings_vehicle_id ON market_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_market_listings_platform ON market_listings(platform);
CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings(status);
CREATE INDEX IF NOT EXISTS idx_market_listings_comment ON market_listings(discovered_comment_id) WHERE discovered_comment_id IS NOT NULL;

-- RLS Policies
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_listings ENABLE ROW LEVEL SECURITY;

-- Anyone can view price history
CREATE POLICY "Price history is viewable by everyone"
  ON price_history FOR SELECT
  USING (true);

-- Only authenticated users can insert price history
CREATE POLICY "Authenticated users can insert price history"
  ON price_history FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Users can update their own entries
CREATE POLICY "Users can update their own price history"
  ON price_history FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM vehicles WHERE id = price_history.vehicle_id
  ));

-- Anyone can view market listings
CREATE POLICY "Market listings are viewable by everyone"
  ON market_listings FOR SELECT
  USING (true);

-- Only authenticated users can insert market listings
CREATE POLICY "Authenticated users can insert market listings"
  ON market_listings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Users can update their own listings
CREATE POLICY "Users can update their own market listings"
  ON market_listings FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM vehicles WHERE id = market_listings.vehicle_id
  ));

-- Function to automatically close old price records when new ones are added
CREATE OR REPLACE FUNCTION close_previous_price_records()
RETURNS TRIGGER AS $$
BEGIN
  -- Close any open price records of the same type for this vehicle
  UPDATE price_history
  SET valid_to = NEW.valid_from
  WHERE vehicle_id = NEW.vehicle_id
    AND price_type = NEW.price_type
    AND valid_to IS NULL
    AND id != NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to close previous records
CREATE TRIGGER trigger_close_previous_prices
  AFTER INSERT ON price_history
  FOR EACH ROW
  EXECUTE FUNCTION close_previous_price_records();

-- Function to get current best price for a vehicle (implements hierarchy)
CREATE OR REPLACE FUNCTION get_vehicle_best_price(p_vehicle_id UUID)
RETURNS TABLE (
  price NUMERIC(10, 2),
  price_type TEXT,
  source_type TEXT,
  confidence TEXT,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  WITH current_prices AS (
    SELECT 
      ph.price,
      ph.price_type,
      ph.source_type,
      ph.confidence,
      ph.updated_at,
      CASE ph.price_type
        WHEN 'sale_price' THEN 1
        WHEN 'market_listing' THEN 2
        WHEN 'asking_price' THEN 3
        WHEN 'current_value' THEN 4
        WHEN 'purchase_price' THEN 5
        ELSE 6
      END as priority,
      CASE ph.confidence
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END as confidence_priority
    FROM price_history ph
    WHERE ph.vehicle_id = p_vehicle_id
      AND ph.valid_to IS NULL
      AND ph.price > 0
  )
  SELECT 
    cp.price,
    cp.price_type,
    cp.source_type,
    cp.confidence,
    cp.updated_at
  FROM current_prices cp
  ORDER BY cp.priority ASC, cp.confidence_priority ASC, cp.updated_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to record price from comment (AI automation endpoint)
CREATE OR REPLACE FUNCTION record_price_from_comment(
  p_vehicle_id UUID,
  p_comment_id UUID,
  p_price NUMERIC(10, 2),
  p_platform TEXT,
  p_url TEXT,
  p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
  v_price_history_id UUID;
  v_listing_id UUID;
BEGIN
  -- Insert into price_history
  INSERT INTO price_history (
    vehicle_id,
    price,
    price_type,
    source_type,
    source_platform,
    source_url,
    source_comment_id,
    confidence
  ) VALUES (
    p_vehicle_id,
    p_price,
    'market_listing',
    'comment_extraction',
    p_platform,
    p_url,
    p_comment_id,
    p_confidence
  )
  RETURNING id INTO v_price_history_id;
  
  -- Also create/update market listing if URL provided
  IF p_url IS NOT NULL THEN
    INSERT INTO market_listings (
      vehicle_id,
      platform,
      listing_url,
      asking_price,
      status,
      discovered_by,
      discovered_comment_id,
      confidence,
      last_seen_date
    ) VALUES (
      p_vehicle_id,
      p_platform,
      p_url,
      p_price,
      'active',
      'user_comment',
      p_comment_id,
      p_confidence,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (listing_url) DO UPDATE SET
      asking_price = EXCLUDED.asking_price,
      last_seen_date = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO v_listing_id;
  END IF;
  
  RETURN v_price_history_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE price_history IS 'Tracks all price changes and estimates for vehicles over time';
COMMENT ON TABLE market_listings IS 'Detailed tracking of external marketplace listings (Craigslist, BaT, eBay, etc.)';
COMMENT ON FUNCTION get_vehicle_best_price IS 'Returns the best price for a vehicle based on hierarchy: sale > market listing > asking > current value';
COMMENT ON FUNCTION record_price_from_comment IS 'AI automation endpoint: Records a price extracted from a comment with source tracking';

