-- Provider Tracking System
-- Tracks dealers/auction houses and their listings for inventory monitoring

-- ============================================================================
-- LISTING PROVIDERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS listing_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Provider info
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('dealer', 'auction_house', 'marketplace')),
  website_url TEXT NOT NULL,
  classic_com_profile_url TEXT, -- Their Classic.com profile if exists
  
  -- Inventory access
  inventory_url TEXT, -- Main inventory page
  inventory_api_url TEXT, -- If they have API
  inventory_format TEXT, -- 'html', 'json', 'rss', 'sitemap'
  
  -- Scraping config
  scraper_type TEXT, -- 'generic', 'classiccars', 'affordableclassics', 'custom'
  scraper_config JSONB DEFAULT '{}', -- Site-specific parsing rules
  rate_limit_per_minute INTEGER DEFAULT 10,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_scraped_at TIMESTAMPTZ,
  total_listings_found INTEGER DEFAULT 0,
  total_vehicles_created INTEGER DEFAULT 0,
  last_error TEXT,
  
  -- Metadata
  verified_at TIMESTAMPTZ, -- When we verified they're real
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(website_url)
);

CREATE INDEX IF NOT EXISTS idx_listing_providers_active ON listing_providers(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_listing_providers_type ON listing_providers(provider_type);

-- ============================================================================
-- PROVIDER LISTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS provider_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES listing_providers(id) ON DELETE CASCADE,
  
  -- Listing info
  listing_url TEXT NOT NULL,
  listing_id TEXT, -- Provider's internal ID
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed', 'expired')),
  
  -- Vehicle data (raw from listing)
  raw_data JSONB DEFAULT '{}',
  extracted_vehicle_data JSONB, -- After AI extraction
  
  -- Status
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL, -- If profile created
  is_processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  
  -- Monitoring
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  price_history JSONB DEFAULT '[]', -- Track price changes
  
  UNIQUE(provider_id, listing_url)
);

CREATE INDEX IF NOT EXISTS idx_provider_listings_provider ON provider_listings(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_provider_listings_unprocessed ON provider_listings(provider_id, is_processed) WHERE is_processed = false;
CREATE INDEX IF NOT EXISTS idx_provider_listings_vehicle ON provider_listings(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE listing_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_listings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can manage providers" ON listing_providers
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage listings" ON provider_listings
  FOR ALL USING (auth.role() = 'service_role');

-- Allow authenticated users to view
CREATE POLICY "Users can view providers" ON listing_providers
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view listings" ON provider_listings
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update provider stats
CREATE OR REPLACE FUNCTION update_provider_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE listing_providers
  SET 
    total_listings_found = (
      SELECT COUNT(*) FROM provider_listings WHERE provider_id = NEW.provider_id
    ),
    total_vehicles_created = (
      SELECT COUNT(*) FROM provider_listings 
      WHERE provider_id = NEW.provider_id AND vehicle_id IS NOT NULL
    ),
    last_scraped_at = NOW(),
    updated_at = NOW()
  WHERE id = NEW.provider_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_provider_stats
  AFTER INSERT OR UPDATE ON provider_listings
  FOR EACH ROW
  EXECUTE FUNCTION update_provider_stats();

-- Function to track price changes
CREATE OR REPLACE FUNCTION track_price_change()
RETURNS TRIGGER AS $$
DECLARE
  current_price NUMERIC;
BEGIN
  -- Extract price from raw_data or extracted_vehicle_data
  current_price := COALESCE(
    (NEW.extracted_vehicle_data->>'price')::NUMERIC,
    (NEW.raw_data->>'asking_price')::NUMERIC,
    (NEW.raw_data->>'price')::NUMERIC
  );
  
  -- If price changed, add to history
  IF current_price IS NOT NULL AND (
    OLD.extracted_vehicle_data->>'price' IS DISTINCT FROM NEW.extracted_vehicle_data->>'price' OR
    OLD.raw_data->>'asking_price' IS DISTINCT FROM NEW.raw_data->>'asking_price'
  ) THEN
    NEW.price_history := COALESCE(OLD.price_history, '[]'::JSONB) || 
      jsonb_build_array(jsonb_build_object(
        'price', current_price,
        'timestamp', NOW()
      ));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_track_price_change
  BEFORE UPDATE ON provider_listings
  FOR EACH ROW
  WHEN (
    OLD.extracted_vehicle_data IS DISTINCT FROM NEW.extracted_vehicle_data OR
    OLD.raw_data IS DISTINCT FROM NEW.raw_data
  )
  EXECUTE FUNCTION track_price_change();

COMMENT ON TABLE listing_providers IS 'Dealers, auction houses, and marketplaces that list vehicles';
COMMENT ON TABLE provider_listings IS 'Individual listings from providers, tracked for monitoring and vehicle creation';

