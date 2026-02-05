-- ============================================================================
-- FACEBOOK MARKETPLACE SWEEP INFRASTRUCTURE
-- ============================================================================
-- Tables and functions to support automated geographic sweeps
-- for vintage vehicle (1960-1999) collection
-- ============================================================================

BEGIN;

-- ============================================================================
-- SWEEP JOBS TABLE
-- ============================================================================
-- Track each sweep run
CREATE TABLE IF NOT EXISTS fb_sweep_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

  -- Progress
  locations_total INTEGER NOT NULL DEFAULT 0,
  locations_processed INTEGER NOT NULL DEFAULT 0,

  -- Results
  listings_found INTEGER NOT NULL DEFAULT 0,
  new_listings INTEGER NOT NULL DEFAULT 0,
  price_changes INTEGER NOT NULL DEFAULT 0,
  disappeared_detected INTEGER NOT NULL DEFAULT 0,

  -- Errors
  errors INTEGER NOT NULL DEFAULT 0,
  error_details JSONB DEFAULT '[]',

  -- Configuration
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fb_sweep_jobs_status ON fb_sweep_jobs(status);
CREATE INDEX idx_fb_sweep_jobs_started ON fb_sweep_jobs(started_at DESC);

COMMENT ON TABLE fb_sweep_jobs IS 'Track individual sweep runs across all locations';

-- ============================================================================
-- SWEEP QUEUE TABLE
-- ============================================================================
-- Queue of locations to process in current sweep
CREATE TABLE IF NOT EXISTS fb_sweep_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  sweep_job_id UUID NOT NULL REFERENCES fb_sweep_jobs(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES fb_marketplace_locations(id) ON DELETE CASCADE,

  -- Processing
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  listings_found INTEGER,
  new_listings INTEGER,
  price_changes INTEGER,
  query_time_ms INTEGER,

  -- Error tracking
  error TEXT,
  retry_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fb_sweep_queue_job ON fb_sweep_queue(sweep_job_id, status);
CREATE INDEX idx_fb_sweep_queue_location ON fb_sweep_queue(location_id);
CREATE INDEX idx_fb_sweep_queue_pending ON fb_sweep_queue(sweep_job_id, priority) WHERE status = 'pending';

COMMENT ON TABLE fb_sweep_queue IS 'Queue of locations to process within a sweep job';

-- ============================================================================
-- LISTING SIGHTINGS TABLE
-- ============================================================================
-- Track when each listing was seen (for disappearance detection)
CREATE TABLE IF NOT EXISTS fb_listing_sightings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  sweep_job_id UUID NOT NULL REFERENCES fb_sweep_jobs(id) ON DELETE CASCADE,

  -- Snapshot at time of sighting
  price_at_sighting NUMERIC,

  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fb_sightings_listing ON fb_listing_sightings(listing_id, seen_at DESC);
CREATE INDEX idx_fb_sightings_sweep ON fb_listing_sightings(sweep_job_id);

COMMENT ON TABLE fb_listing_sightings IS 'Record of each time a listing was observed in a sweep';

-- ============================================================================
-- SELLER PROFILES TABLE
-- ============================================================================
-- Track FB Marketplace sellers for behavioral analysis
CREATE TABLE IF NOT EXISTS fb_marketplace_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FB Identity (may not have all fields)
  fb_user_id TEXT,
  fb_profile_url TEXT,
  display_name TEXT,

  -- Activity metrics
  total_listings_seen INTEGER DEFAULT 0,
  active_listings INTEGER DEFAULT 0,
  sold_listings INTEGER DEFAULT 0,

  -- Behavioral signals
  avg_days_to_sell NUMERIC,
  avg_price_reduction_pct NUMERIC,
  listing_frequency_per_month NUMERIC,

  -- Inferred type
  seller_type TEXT CHECK (seller_type IN ('private_party', 'dealer', 'flipper', 'unknown')),
  dealer_likelihood_score NUMERIC CHECK (dealer_likelihood_score >= 0 AND dealer_likelihood_score <= 1),

  -- First/last activity
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),

  -- Raw data
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(fb_user_id)
);

CREATE INDEX idx_fb_sellers_type ON fb_marketplace_sellers(seller_type);
CREATE INDEX idx_fb_sellers_activity ON fb_marketplace_sellers(total_listings_seen DESC);

COMMENT ON TABLE fb_marketplace_sellers IS 'Seller profiles with behavioral scoring';

-- ============================================================================
-- ADD SELLER REFERENCE TO LISTINGS
-- ============================================================================
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS fb_seller_id UUID REFERENCES fb_marketplace_sellers(id);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller
  ON marketplace_listings(fb_seller_id) WHERE fb_seller_id IS NOT NULL;

-- ============================================================================
-- SWEEP STATS FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION get_fb_marketplace_stats()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace'),
    'active_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active'),
    'sold_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'sold'),
    'locations_configured', (SELECT COUNT(*) FROM fb_marketplace_locations WHERE is_active = true),
    'locations_swept_today', (SELECT COUNT(*) FROM fb_marketplace_locations WHERE last_sweep_at > NOW() - INTERVAL '24 hours'),
    'last_sweep_at', (SELECT MAX(started_at) FROM fb_sweep_jobs WHERE status = 'completed'),
    'sweeps_last_7_days', (SELECT COUNT(*) FROM fb_sweep_jobs WHERE started_at > NOW() - INTERVAL '7 days'),
    'avg_listings_per_sweep', (SELECT ROUND(AVG(listings_found)) FROM fb_sweep_jobs WHERE status = 'completed' AND started_at > NOW() - INTERVAL '7 days'),
    'unique_sellers', (SELECT COUNT(*) FROM fb_marketplace_sellers),
    'vintage_year_range', '1960-1999'
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- DETECT DISAPPEARED LISTINGS FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION detect_disappeared_fb_listings(
  p_days_threshold INTEGER DEFAULT 3
)
RETURNS TABLE (
  listing_id UUID,
  title TEXT,
  last_price NUMERIC,
  days_listed INTEGER,
  last_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.title,
    ml.current_price,
    EXTRACT(DAY FROM (NOW() - ml.first_seen_at))::INTEGER,
    ml.last_seen_at
  FROM marketplace_listings ml
  WHERE ml.platform = 'facebook_marketplace'
    AND ml.status = 'active'
    AND ml.last_seen_at < NOW() - (p_days_threshold || ' days')::INTERVAL
  ORDER BY ml.last_seen_at ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SELLER ACTIVITY UPDATE TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_seller_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fb_seller_id IS NOT NULL THEN
    UPDATE fb_marketplace_sellers SET
      total_listings_seen = total_listings_seen + 1,
      active_listings = active_listings + 1,
      last_seen_at = NOW(),
      updated_at = NOW()
    WHERE id = NEW.fb_seller_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_seller_on_listing ON marketplace_listings;
CREATE TRIGGER trg_update_seller_on_listing
  AFTER INSERT ON marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION update_seller_activity();

-- ============================================================================
-- SWEEP DASHBOARD VIEW
-- ============================================================================
CREATE OR REPLACE VIEW fb_sweep_dashboard AS
SELECT
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace') AS total_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active') AS active_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'sold') AS sold_listings,
  (SELECT COUNT(*) FROM fb_marketplace_locations WHERE is_active = true) AS configured_locations,
  (SELECT COUNT(*) FROM fb_marketplace_locations WHERE last_sweep_at > NOW() - INTERVAL '24 hours') AS swept_today,
  (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'running') AS sweeps_running,
  (SELECT MAX(completed_at) FROM fb_sweep_jobs WHERE status = 'completed') AS last_completed_sweep,
  (SELECT COALESCE(SUM(new_listings), 0) FROM fb_sweep_jobs WHERE started_at > NOW() - INTERVAL '24 hours') AS new_listings_24h,
  (SELECT COALESCE(SUM(price_changes), 0) FROM fb_sweep_jobs WHERE started_at > NOW() - INTERVAL '24 hours') AS price_changes_24h,
  (SELECT COUNT(*) FROM fb_marketplace_sellers) AS unique_sellers,
  (SELECT AVG(current_price) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active') AS avg_active_price;

-- ============================================================================
-- VINTAGE VEHICLES VIEW (1960-1999)
-- ============================================================================
CREATE OR REPLACE VIEW fb_vintage_vehicles AS
SELECT
  ml.*,
  s.display_name AS seller_display_name,
  s.seller_type,
  s.total_listings_seen AS seller_total_listings,
  s.avg_days_to_sell AS seller_avg_days_to_sell,
  loc.name AS location_name,
  loc.state_code AS location_state
FROM marketplace_listings ml
LEFT JOIN fb_marketplace_sellers s ON s.id = ml.fb_seller_id
LEFT JOIN fb_marketplace_locations loc ON ml.location ILIKE '%' || loc.name || '%' OR loc.name ILIKE '%' || ml.location || '%'
WHERE ml.platform = 'facebook_marketplace'
  AND ml.extracted_year BETWEEN 1960 AND 1999
ORDER BY ml.last_seen_at DESC;

COMMENT ON VIEW fb_vintage_vehicles IS 'Vintage vehicles (1960-1999) with seller and location enrichment';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE fb_sweep_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_sweep_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_listing_sightings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_marketplace_sellers ENABLE ROW LEVEL SECURITY;

-- Public read for stats/dashboard
CREATE POLICY "Sweep jobs are readable" ON fb_sweep_jobs FOR SELECT USING (true);
CREATE POLICY "Sweep queue is readable" ON fb_sweep_queue FOR SELECT USING (true);
CREATE POLICY "Sightings are readable" ON fb_listing_sightings FOR SELECT USING (true);
CREATE POLICY "Sellers are readable" ON fb_marketplace_sellers FOR SELECT USING (true);

COMMIT;

-- ============================================================================
-- SUCCESS
-- ============================================================================
COMMENT ON SCHEMA public IS 'FB Marketplace sweep infrastructure deployed';
