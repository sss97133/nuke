-- BaT Comment Tracking System
-- Stores comments from Bring a Trailer listings for vehicle history and user tracking

-- ============================================
-- BaT USERS TABLE
-- ============================================
-- Track BaT usernames for future matching with N-Zero users
CREATE TABLE IF NOT EXISTS bat_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bat_username TEXT NOT NULL UNIQUE,
  bat_profile_url TEXT,
  display_name TEXT,
  
  -- User matching (if BaT user later creates N-Zero account)
  n_zero_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  match_confidence INTEGER DEFAULT 0 CHECK (match_confidence >= 0 AND match_confidence <= 100),
  
  -- Activity tracking
  total_comments INTEGER DEFAULT 0,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_users_username ON bat_users(bat_username);
CREATE INDEX IF NOT EXISTS idx_bat_users_n_zero_user ON bat_users(n_zero_user_id) WHERE n_zero_user_id IS NOT NULL;

-- ============================================
-- BaT LISTINGS TABLE (Enhanced)
-- ============================================
-- Track BaT listings with full auction details
CREATE TABLE IF NOT EXISTS bat_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  
  -- Listing identifiers
  bat_listing_url TEXT NOT NULL UNIQUE,
  bat_lot_number TEXT,
  bat_listing_title TEXT,
  
  -- Auction dates
  auction_start_date DATE,
  auction_end_date DATE,
  sale_date DATE,
  
  -- Pricing
  sale_price INTEGER,
  reserve_price INTEGER,
  starting_bid INTEGER,
  final_bid INTEGER,
  
  -- Participants
  seller_username TEXT,
  buyer_username TEXT,
  seller_bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  buyer_bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  
  -- Activity metrics
  comment_count INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  
  -- Status
  listing_status TEXT DEFAULT 'ended' CHECK (listing_status IN ('active', 'ended', 'sold', 'no_sale', 'cancelled')),
  
  -- Scraping metadata
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_listings_vehicle ON bat_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_listings_url ON bat_listings(bat_listing_url);
CREATE INDEX IF NOT EXISTS idx_bat_listings_dates ON bat_listings(auction_start_date, auction_end_date);
CREATE INDEX IF NOT EXISTS idx_bat_listings_seller ON bat_listings(seller_bat_user_id);
CREATE INDEX IF NOT EXISTS idx_bat_listings_buyer ON bat_listings(buyer_bat_user_id);

-- ============================================
-- BaT COMMENTS TABLE
-- ============================================
-- Store individual comments from BaT listings
CREATE TABLE IF NOT EXISTS bat_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bat_listing_id UUID NOT NULL REFERENCES bat_listings(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Commenter
  bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  bat_username TEXT NOT NULL, -- Denormalized for performance
  
  -- Comment content
  comment_text TEXT NOT NULL,
  comment_html TEXT, -- Original HTML if available
  
  -- Timestamps
  comment_timestamp TIMESTAMPTZ NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- BaT-specific metadata
  bat_comment_id TEXT, -- BaT's internal comment ID if available
  comment_url TEXT,
  is_seller_comment BOOLEAN DEFAULT FALSE,
  
  -- Engagement
  likes_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES bat_comments(id) ON DELETE SET NULL,
  
  -- Analysis
  sentiment_score NUMERIC(3,2), -- -1.0 to 1.0
  contains_question BOOLEAN DEFAULT FALSE,
  contains_bid BOOLEAN DEFAULT FALSE,
  contains_technical_info BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_comments_listing ON bat_comments(bat_listing_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_vehicle ON bat_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_user ON bat_comments(bat_user_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_timestamp ON bat_comments(comment_timestamp);
CREATE INDEX IF NOT EXISTS idx_bat_comments_username ON bat_comments(bat_username);

-- ============================================
-- VEHICLE COMMENT TIMELINE VIEW
-- ============================================
-- View to see BaT comments as timeline events for vehicles
CREATE OR REPLACE VIEW vehicle_bat_comment_timeline AS
SELECT 
  bc.id,
  bc.vehicle_id,
  bc.bat_listing_id,
  bl.bat_listing_url,
  bl.bat_listing_title,
  bc.comment_timestamp AS event_date,
  bc.comment_text AS description,
  bc.bat_username AS commenter,
  bc.bat_user_id,
  bc.is_seller_comment,
  bc.contains_technical_info,
  'bat_comment' AS event_type,
  'bat_listing' AS source,
  ARRAY[]::TEXT[] AS image_urls,
  jsonb_build_object(
    'bat_comment_id', bc.bat_comment_id,
    'comment_url', bc.comment_url,
    'likes_count', bc.likes_count,
    'sentiment_score', bc.sentiment_score
  ) AS metadata,
  bc.created_at,
  bc.updated_at
FROM bat_comments bc
JOIN bat_listings bl ON bc.bat_listing_id = bl.id
WHERE bc.vehicle_id IS NOT NULL;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update bat_user activity stats
CREATE OR REPLACE FUNCTION update_bat_user_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bat_users
  SET 
    total_comments = (
      SELECT COUNT(*) FROM bat_comments 
      WHERE bat_user_id = NEW.bat_user_id
    ),
    last_seen_at = GREATEST(
      COALESCE((SELECT MAX(comment_timestamp) FROM bat_comments WHERE bat_user_id = NEW.bat_user_id), NOW()),
      COALESCE(bat_users.last_seen_at, NOW())
    ),
    updated_at = NOW()
  WHERE id = NEW.bat_user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bat_user_stats
  AFTER INSERT OR UPDATE ON bat_comments
  FOR EACH ROW
  WHEN (NEW.bat_user_id IS NOT NULL)
  EXECUTE FUNCTION update_bat_user_stats();

-- Function to update bat_listing comment count
CREATE OR REPLACE FUNCTION update_bat_listing_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bat_listings
  SET 
    comment_count = (
      SELECT COUNT(*) FROM bat_comments 
      WHERE bat_listing_id = NEW.bat_listing_id
    ),
    updated_at = NOW()
  WHERE id = NEW.bat_listing_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bat_listing_comment_count
  AFTER INSERT OR UPDATE OR DELETE ON bat_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_bat_listing_comment_count();

-- Function to get or create bat_user
CREATE OR REPLACE FUNCTION get_or_create_bat_user(
  p_username TEXT,
  p_profile_url TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Try to find existing user
  SELECT id INTO v_user_id
  FROM bat_users
  WHERE bat_username = p_username
  LIMIT 1;
  
  -- Create if doesn't exist
  IF v_user_id IS NULL THEN
    INSERT INTO bat_users (bat_username, bat_profile_url, display_name)
    VALUES (p_username, p_profile_url, p_display_name)
    RETURNING id INTO v_user_id;
  ELSE
    -- Update last_seen_at and profile info if provided
    UPDATE bat_users
    SET 
      bat_profile_url = COALESCE(p_profile_url, bat_profile_url),
      display_name = COALESCE(p_display_name, display_name),
      last_seen_at = NOW(),
      updated_at = NOW()
    WHERE id = v_user_id;
  END IF;
  
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE bat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_comments ENABLE ROW LEVEL SECURITY;

-- Everyone can read BaT data (it's public information)
CREATE POLICY "Anyone can view bat_users" ON bat_users
  FOR SELECT USING (true);

CREATE POLICY "Anyone can view bat_listings" ON bat_listings
  FOR SELECT USING (true);

CREATE POLICY "Anyone can view bat_comments" ON bat_comments
  FOR SELECT USING (true);

-- Only service role can insert/update (via edge functions)
CREATE POLICY "Service role can manage bat_users" ON bat_users
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage bat_listings" ON bat_listings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage bat_comments" ON bat_comments
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE bat_users IS 'Track BaT usernames for future matching with N-Zero users';
COMMENT ON TABLE bat_listings IS 'Store BaT listing data with auction dates and participants';
COMMENT ON TABLE bat_comments IS 'Store individual comments from BaT listings for vehicle history';
COMMENT ON VIEW vehicle_bat_comment_timeline IS 'View BaT comments as timeline events for vehicles';

