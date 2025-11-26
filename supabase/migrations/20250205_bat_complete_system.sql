-- Complete BaT Comment Tracking System with Scheduling and Notifications
-- Combines: tables, functions, notifications, and scheduling setup

-- ============================================
-- BaT USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bat_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bat_username TEXT NOT NULL UNIQUE,
  bat_profile_url TEXT,
  display_name TEXT,
  n_zero_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  match_confidence INTEGER DEFAULT 0 CHECK (match_confidence >= 0 AND match_confidence <= 100),
  total_comments INTEGER DEFAULT 0,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_users_username ON bat_users(bat_username);
CREATE INDEX IF NOT EXISTS idx_bat_users_n_zero_user ON bat_users(n_zero_user_id) WHERE n_zero_user_id IS NOT NULL;

-- ============================================
-- BaT LISTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bat_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  bat_listing_url TEXT NOT NULL UNIQUE,
  bat_lot_number TEXT,
  bat_listing_title TEXT,
  auction_start_date DATE,
  auction_end_date DATE,
  sale_date DATE,
  sale_price INTEGER,
  reserve_price INTEGER,
  starting_bid INTEGER,
  final_bid INTEGER,
  seller_username TEXT,
  buyer_username TEXT,
  seller_bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  buyer_bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  comment_count INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  listing_status TEXT DEFAULT 'ended' CHECK (listing_status IN ('active', 'ended', 'sold', 'no_sale', 'cancelled')),
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_listings_vehicle ON bat_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_listings_url ON bat_listings(bat_listing_url);
CREATE INDEX IF NOT EXISTS idx_bat_listings_dates ON bat_listings(auction_start_date, auction_end_date);

-- ============================================
-- BaT COMMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bat_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bat_listing_id UUID NOT NULL REFERENCES bat_listings(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  bat_username TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  comment_html TEXT,
  comment_timestamp TIMESTAMPTZ NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  bat_comment_id TEXT,
  comment_url TEXT,
  is_seller_comment BOOLEAN DEFAULT FALSE,
  likes_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES bat_comments(id) ON DELETE SET NULL,
  sentiment_score NUMERIC(3,2),
  contains_question BOOLEAN DEFAULT FALSE,
  contains_bid BOOLEAN DEFAULT FALSE,
  contains_technical_info BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_comments_listing ON bat_comments(bat_listing_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_vehicle ON bat_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_user ON bat_comments(bat_user_id);
CREATE INDEX IF NOT EXISTS idx_bat_comments_timestamp ON bat_comments(comment_timestamp);

-- ============================================
-- BaT SCRAPE JOBS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bat_scrape_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type TEXT NOT NULL DEFAULT 'full_scrape' CHECK (job_type IN ('full_scrape', 'incremental', 'comments_only')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  listings_found INTEGER DEFAULT 0,
  listings_scraped INTEGER DEFAULT 0,
  comments_extracted INTEGER DEFAULT 0,
  users_created INTEGER DEFAULT 0,
  vehicles_matched INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  error_message TEXT,
  error_stack TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_scrape_jobs_status ON bat_scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bat_scrape_jobs_created ON bat_scrape_jobs(created_at DESC);

-- ============================================
-- EXTEND ADMIN NOTIFICATIONS
-- ============================================
ALTER TABLE admin_notifications 
  DROP CONSTRAINT IF EXISTS admin_notifications_notification_type_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_notification_type_check
  CHECK (notification_type IN (
    'ownership_verification_pending',
    'vehicle_verification_pending', 
    'user_verification_pending',
    'fraud_alert',
    'system_alert',
    'bat_scrape_error',
    'bat_scrape_complete'
  ));

-- ============================================
-- VIEWS
-- ============================================
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

-- Get or create bat_user
CREATE OR REPLACE FUNCTION get_or_create_bat_user(
  p_username TEXT,
  p_profile_url TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM bat_users
  WHERE bat_username = p_username
  LIMIT 1;
  
  IF v_user_id IS NULL THEN
    INSERT INTO bat_users (bat_username, bat_profile_url, display_name)
    VALUES (p_username, p_profile_url, p_display_name)
    RETURNING id INTO v_user_id;
  ELSE
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

-- Update bat_user stats
CREATE OR REPLACE FUNCTION update_bat_user_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bat_users
  SET 
    total_comments = (SELECT COUNT(*) FROM bat_comments WHERE bat_user_id = NEW.bat_user_id),
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

-- Update listing comment count
CREATE OR REPLACE FUNCTION update_bat_listing_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bat_listings
  SET 
    comment_count = (SELECT COUNT(*) FROM bat_comments WHERE bat_listing_id = NEW.bat_listing_id),
    updated_at = NOW()
  WHERE id = NEW.bat_listing_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bat_listing_comment_count
  AFTER INSERT OR UPDATE OR DELETE ON bat_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_bat_listing_comment_count();

-- Notify admin of BaT scrape errors
CREATE OR REPLACE FUNCTION notify_admin_bat_scrape_error(
  p_error_message TEXT,
  p_error_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO admin_notifications (
    notification_type,
    title,
    message,
    priority,
    action_required,
    status,
    metadata
  ) VALUES (
    'bat_scrape_error',
    'BaT Scraping Error',
    p_error_message,
    4,
    'system_action',
    'pending',
    jsonb_build_object(
      'error_details', p_error_details,
      'created_at', NOW()
    )
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

-- Notify admin of BaT scrape completion
CREATE OR REPLACE FUNCTION notify_admin_bat_scrape_complete(
  p_listings_found INTEGER,
  p_listings_scraped INTEGER,
  p_comments_extracted INTEGER,
  p_vehicles_matched INTEGER
)
RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO admin_notifications (
    notification_type,
    title,
    message,
    priority,
    action_required,
    status,
    metadata
  ) VALUES (
    'bat_scrape_complete',
    'BaT Scraping Complete',
    format('Scraped %s listings, extracted %s comments, matched %s vehicles', 
           p_listings_scraped, p_comments_extracted, p_vehicles_matched),
    1,
    'system_action',
    'pending',
    jsonb_build_object(
      'listings_found', p_listings_found,
      'listings_scraped', p_listings_scraped,
      'comments_extracted', p_comments_extracted,
      'vehicles_matched', p_vehicles_matched,
      'completed_at', NOW()
    )
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE bat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_scrape_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view bat_users" ON bat_users FOR SELECT USING (true);
CREATE POLICY "Anyone can view bat_listings" ON bat_listings FOR SELECT USING (true);
CREATE POLICY "Anyone can view bat_comments" ON bat_comments FOR SELECT USING (true);
CREATE POLICY "Anyone can view bat_scrape_jobs" ON bat_scrape_jobs FOR SELECT USING (true);

CREATE POLICY "Service role can manage bat_users" ON bat_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage bat_listings" ON bat_listings FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage bat_comments" ON bat_comments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage bat_scrape_jobs" ON bat_scrape_jobs FOR ALL USING (auth.role() = 'service_role');

