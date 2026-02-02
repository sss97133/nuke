-- Facebook Marketplace Import System
-- Captures private party listings AND sale outcomes

-- 1. Register Facebook Marketplace as observation source
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations, url_pattern)
VALUES (
  'facebook_marketplace',
  'Facebook Marketplace',
  'marketplace',
  0.60,  -- Lower trust than auctions (less verification)
  ARRAY['listing', 'price_change', 'sale', 'delisting'],
  'facebook.com/marketplace/item/'
) ON CONFLICT (slug) DO UPDATE SET
  supported_observations = EXCLUDED.supported_observations,
  url_pattern = EXCLUDED.url_pattern;

-- 2. Marketplace listings table (extends external_listings)
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identifiers
  external_id TEXT NOT NULL,  -- FB item ID extracted from URL
  platform TEXT NOT NULL DEFAULT 'facebook_marketplace',
  url TEXT NOT NULL,

  -- Vehicle link (nullable until matched)
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

  -- Listing data (what we scrape)
  title TEXT,
  asking_price NUMERIC,
  description TEXT,
  location_city TEXT,
  location_state TEXT,
  location_zip TEXT,
  seller_name TEXT,
  seller_joined_date DATE,

  -- Extracted vehicle info
  extracted_year INTEGER,
  extracted_make TEXT,
  extracted_model TEXT,
  extracted_vin TEXT,
  extracted_mileage INTEGER,

  -- Images
  image_urls JSONB DEFAULT '[]',
  thumbnail_url TEXT,

  -- Tracking
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  first_price NUMERIC,  -- Original asking price
  current_price NUMERIC,  -- Latest price (tracks drops)
  price_history JSONB DEFAULT '[]',  -- [{price, date}, ...]

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'sold', 'removed', 'expired')),
  days_listed INTEGER GENERATED ALWAYS AS (
    EXTRACT(DAY FROM (COALESCE(sold_at, removed_at, NOW()) - first_seen_at))
  ) STORED,

  -- Sale outcome (THE VALUABLE DATA)
  sold_at TIMESTAMPTZ,
  sold_price NUMERIC,
  sold_price_source TEXT CHECK (sold_price_source IN ('owner_reported', 'community_reported', 'inferred')),
  sold_to_type TEXT CHECK (sold_to_type IN ('private_party', 'dealer', 'unknown')),

  -- Removal tracking
  removed_at TIMESTAMPTZ,
  removal_reason TEXT,  -- 'sold', 'relisted', 'expired', 'unknown'

  -- User contribution
  contributed_by UUID REFERENCES auth.users(id),
  ownership_verified BOOLEAN DEFAULT FALSE,

  -- Metadata
  raw_scrape_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(platform, external_id)
);

-- Indexes for common queries
CREATE INDEX idx_marketplace_listings_vehicle ON marketplace_listings(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_marketplace_listings_status ON marketplace_listings(status, platform);
CREATE INDEX idx_marketplace_listings_location ON marketplace_listings(location_state, location_city);
CREATE INDEX idx_marketplace_listings_ymm ON marketplace_listings(extracted_year, extracted_make, extracted_model);
CREATE INDEX idx_marketplace_listings_price ON marketplace_listings(current_price) WHERE status = 'active';
CREATE INDEX idx_marketplace_listings_sold ON marketplace_listings(sold_at, sold_price) WHERE sold_at IS NOT NULL;

-- 3. Price change tracking
CREATE TABLE IF NOT EXISTS marketplace_price_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  old_price NUMERIC,
  new_price NUMERIC,
  change_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN old_price > 0 THEN ((new_price - old_price) / old_price * 100) ELSE NULL END
  ) STORED,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'scrape'  -- 'scrape', 'user_report'
);

CREATE INDEX idx_price_changes_listing ON marketplace_price_changes(listing_id, detected_at DESC);

-- 4. Watchlist for tracking listings (not owner's)
CREATE TABLE IF NOT EXISTS marketplace_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  notes TEXT,
  price_alert_threshold NUMERIC,  -- Notify if price drops below
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

-- 5. Community sale reports (crowdsourced)
CREATE TABLE IF NOT EXISTS marketplace_sale_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES auth.users(id),
  reported_sold_price NUMERIC,
  reported_sold_at DATE,
  sold_to_type TEXT CHECK (sold_to_type IN ('private_party', 'dealer', 'unknown')),
  confidence TEXT CHECK (confidence IN ('certain', 'likely', 'guess')),
  evidence_notes TEXT,  -- "Saw it at a dealer" etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Function to record price change
CREATE OR REPLACE FUNCTION record_marketplace_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.current_price IS DISTINCT FROM NEW.current_price THEN
    INSERT INTO marketplace_price_changes (listing_id, old_price, new_price)
    VALUES (NEW.id, OLD.current_price, NEW.current_price);

    -- Update price history JSON
    NEW.price_history = COALESCE(OLD.price_history, '[]'::jsonb) ||
      jsonb_build_object('price', NEW.current_price, 'date', NOW());
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_marketplace_price_change
  BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION record_marketplace_price_change();

-- 7. Function to process sale report consensus
CREATE OR REPLACE FUNCTION process_marketplace_sale_reports(p_listing_id UUID)
RETURNS VOID AS $$
DECLARE
  v_report_count INTEGER;
  v_avg_price NUMERIC;
  v_consensus_type TEXT;
BEGIN
  SELECT
    COUNT(*),
    AVG(reported_sold_price),
    MODE() WITHIN GROUP (ORDER BY sold_to_type)
  INTO v_report_count, v_avg_price, v_consensus_type
  FROM marketplace_sale_reports
  WHERE listing_id = p_listing_id;

  -- If 2+ reports agree, mark as sold
  IF v_report_count >= 2 THEN
    UPDATE marketplace_listings SET
      status = 'sold',
      sold_at = NOW(),
      sold_price = v_avg_price,
      sold_price_source = 'community_reported',
      sold_to_type = v_consensus_type
    WHERE id = p_listing_id AND status != 'sold';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 8. View for market analytics
CREATE OR REPLACE VIEW marketplace_analytics AS
SELECT
  extracted_make AS make,
  extracted_model AS model,
  extracted_year AS year,
  location_state AS state,
  COUNT(*) AS total_listings,
  COUNT(*) FILTER (WHERE status = 'active') AS active_listings,
  COUNT(*) FILTER (WHERE status = 'sold') AS sold_listings,
  AVG(current_price) FILTER (WHERE status = 'active') AS avg_asking_price,
  AVG(sold_price) FILTER (WHERE sold_price IS NOT NULL) AS avg_sold_price,
  AVG(days_listed) FILTER (WHERE status = 'sold') AS avg_days_to_sell,
  AVG((first_price - sold_price) / NULLIF(first_price, 0) * 100)
    FILTER (WHERE sold_price IS NOT NULL AND first_price IS NOT NULL) AS avg_discount_pct
FROM marketplace_listings
WHERE extracted_make IS NOT NULL
GROUP BY extracted_make, extracted_model, extracted_year, location_state;

-- 9. RLS policies
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sale_reports ENABLE ROW LEVEL SECURITY;

-- Anyone can read listings
CREATE POLICY "Marketplace listings are public"
  ON marketplace_listings FOR SELECT
  USING (true);

-- Only contributor can update their listing
CREATE POLICY "Contributors can update own listings"
  ON marketplace_listings FOR UPDATE
  USING (contributed_by = auth.uid());

-- Users manage their own watchlist
CREATE POLICY "Users manage own watchlist"
  ON marketplace_watchlist FOR ALL
  USING (user_id = auth.uid());

-- Authenticated users can report sales
CREATE POLICY "Authenticated users can report sales"
  ON marketplace_sale_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE marketplace_listings IS 'Facebook Marketplace vehicle listings with sale outcome tracking';
COMMENT ON COLUMN marketplace_listings.sold_price IS 'THE VALUABLE DATA - actual transaction price';
COMMENT ON COLUMN marketplace_listings.days_listed IS 'Time to sell - predictive indicator';
