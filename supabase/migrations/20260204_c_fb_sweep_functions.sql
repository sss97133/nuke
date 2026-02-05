-- ============================================================================
-- FACEBOOK MARKETPLACE SWEEP FUNCTIONS
-- ============================================================================
-- Additional functions for disappearance detection and reappearance handling
-- ============================================================================

BEGIN;

-- ============================================================================
-- LISTING DISAPPEARANCES TABLE
-- ============================================================================
-- Track disappeared listings to detect sales
CREATE TABLE IF NOT EXISTS fb_listing_disappearances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Listing reference
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,

  -- Tracking
  first_missed_sweep_id UUID REFERENCES fb_sweep_jobs(id),
  last_missed_sweep_id UUID REFERENCES fb_sweep_jobs(id),
  consecutive_misses INTEGER DEFAULT 1,

  -- Last known state
  last_seen_at TIMESTAMPTZ,
  last_seen_price NUMERIC,
  last_seen_location_id UUID REFERENCES fb_marketplace_locations(id),

  -- Resolution
  status TEXT DEFAULT 'missing' CHECK (status IN (
    'missing',           -- Currently not found
    'confirmed_sold',    -- User confirmed sale
    'inferred_sold',     -- 3+ misses, presumed sold
    'relisted',          -- Came back after disappearing
    'expired',           -- Too old, stopped tracking
    'false_positive'     -- Sweep error, not actually gone
  )),

  -- Reappearance tracking
  reappeared_at TIMESTAMPTZ,
  reappeared_price NUMERIC,
  reappeared_sweep_id UUID REFERENCES fb_sweep_jobs(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(listing_id)
);

CREATE INDEX idx_fb_disappearances_listing ON fb_listing_disappearances(listing_id);
CREATE INDEX idx_fb_disappearances_status ON fb_listing_disappearances(status);
CREATE INDEX idx_fb_disappearances_misses ON fb_listing_disappearances(consecutive_misses DESC);

-- ============================================================================
-- DETECT DISAPPEARED LISTINGS
-- ============================================================================
-- Finds listings not seen in recent sweeps and updates their status
CREATE OR REPLACE FUNCTION detect_disappeared_listings(
  p_sweep_job_id UUID,
  p_min_misses INTEGER DEFAULT 2,
  p_max_age_hours INTEGER DEFAULT 72
)
RETURNS TABLE (
  listing_id UUID,
  title TEXT,
  consecutive_misses INTEGER,
  last_seen_at TIMESTAMPTZ,
  last_price NUMERIC,
  new_status TEXT
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := NOW() - (p_max_age_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH active_listings AS (
    -- Get all active FB Marketplace listings
    SELECT ml.id, ml.title, ml.current_price, ml.last_seen_at
    FROM marketplace_listings ml
    WHERE ml.platform = 'facebook_marketplace'
      AND ml.status = 'active'
      AND ml.last_seen_at < NOW() - INTERVAL '1 hour' -- Not just seen
  ),
  missed_listings AS (
    -- Find listings not seen in this sweep
    SELECT al.id, al.title, al.current_price, al.last_seen_at
    FROM active_listings al
    WHERE NOT EXISTS (
      SELECT 1 FROM fb_listing_sightings fls
      WHERE fls.listing_id = al.id
        AND fls.sweep_job_id = p_sweep_job_id
    )
  )
  SELECT
    ml.id,
    ml.title,
    COALESCE(fd.consecutive_misses, 0) + 1 AS consecutive_misses,
    ml.last_seen_at,
    ml.current_price,
    CASE
      WHEN COALESCE(fd.consecutive_misses, 0) + 1 >= 3 THEN 'inferred_sold'
      WHEN COALESCE(fd.consecutive_misses, 0) + 1 >= p_min_misses THEN 'missing'
      ELSE 'watching'
    END AS new_status
  FROM missed_listings ml
  LEFT JOIN fb_listing_disappearances fd ON fd.listing_id = ml.id
  WHERE ml.last_seen_at > v_cutoff; -- Only track recent listings

  -- Update disappearance records
  INSERT INTO fb_listing_disappearances (
    listing_id,
    first_missed_sweep_id,
    last_missed_sweep_id,
    consecutive_misses,
    last_seen_at,
    last_seen_price,
    status
  )
  SELECT
    ml.id,
    p_sweep_job_id,
    p_sweep_job_id,
    1,
    ml.last_seen_at,
    ml.current_price,
    'missing'
  FROM missed_listings ml
  WHERE NOT EXISTS (
    SELECT 1 FROM fb_listing_disappearances fd WHERE fd.listing_id = ml.id
  )
  ON CONFLICT (listing_id) DO UPDATE SET
    last_missed_sweep_id = p_sweep_job_id,
    consecutive_misses = fb_listing_disappearances.consecutive_misses + 1,
    status = CASE
      WHEN fb_listing_disappearances.consecutive_misses + 1 >= 3 THEN 'inferred_sold'
      ELSE 'missing'
    END,
    updated_at = NOW();

  -- Mark high-confidence disappearances as sold in marketplace_listings
  UPDATE marketplace_listings ml
  SET
    status = 'sold',
    removed_at = NOW(),
    removal_reason = 'disappeared',
    sold_price_source = 'inferred'
  FROM fb_listing_disappearances fd
  WHERE fd.listing_id = ml.id
    AND fd.status = 'inferred_sold'
    AND ml.status = 'active';

END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HANDLE LISTING REAPPEARANCE
-- ============================================================================
-- When a previously-disappeared listing comes back
CREATE OR REPLACE FUNCTION handle_listing_reappearance(
  p_listing_id UUID,
  p_sweep_job_id UUID,
  p_new_price NUMERIC
)
RETURNS VOID AS $$
BEGIN
  -- Update disappearance record
  UPDATE fb_listing_disappearances SET
    status = 'relisted',
    reappeared_at = NOW(),
    reappeared_price = p_new_price,
    reappeared_sweep_id = p_sweep_job_id,
    updated_at = NOW()
  WHERE listing_id = p_listing_id
    AND status IN ('missing', 'inferred_sold');

  -- Restore marketplace listing to active if it was marked sold
  UPDATE marketplace_listings SET
    status = 'active',
    removed_at = NULL,
    removal_reason = NULL,
    sold_price_source = NULL,
    last_seen_at = NOW(),
    current_price = p_new_price
  WHERE id = p_listing_id
    AND status = 'sold';

END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ENHANCED SWEEP STATS
-- ============================================================================
CREATE OR REPLACE FUNCTION get_fb_marketplace_stats()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'locations', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM fb_marketplace_locations WHERE is_active = true),
      'swept_24h', (SELECT COUNT(*) FROM fb_marketplace_locations WHERE last_sweep_at > NOW() - INTERVAL '24 hours'),
      'swept_1h', (SELECT COUNT(*) FROM fb_marketplace_locations WHERE last_sweep_at > NOW() - INTERVAL '1 hour')
    ),
    'listings', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace'),
      'active', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active'),
      'sold', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'sold'),
      'vintage', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND extracted_year BETWEEN 1960 AND 1999),
      'new_24h', (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND first_seen_at > NOW() - INTERVAL '24 hours'),
      'avg_price', (SELECT ROUND(AVG(current_price)::numeric, 0) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active' AND current_price > 0)
    ),
    'disappearances', jsonb_build_object(
      'missing', (SELECT COUNT(*) FROM fb_listing_disappearances WHERE status = 'missing'),
      'inferred_sold', (SELECT COUNT(*) FROM fb_listing_disappearances WHERE status = 'inferred_sold'),
      'relisted', (SELECT COUNT(*) FROM fb_listing_disappearances WHERE status = 'relisted')
    ),
    'sweeps', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM fb_sweep_jobs),
      'completed_24h', (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'),
      'last_completed', (SELECT MAX(completed_at) FROM fb_sweep_jobs WHERE status = 'completed'),
      'running', (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'running')
    ),
    'health', jsonb_build_object(
      'status', CASE
        WHEN (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour') > 0 THEN 'healthy'
        WHEN (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '4 hours') > 0 THEN 'behind'
        ELSE 'stale'
      END,
      'vintage_focus', '1960-1999'
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SWEEP DASHBOARD VIEW
-- ============================================================================
CREATE OR REPLACE VIEW fb_sweep_dashboard AS
SELECT
  -- Locations
  (SELECT COUNT(*) FROM fb_marketplace_locations WHERE is_active = true) AS locations_active,
  (SELECT COUNT(*) FROM fb_marketplace_locations WHERE last_sweep_at > NOW() - INTERVAL '24 hours') AS locations_swept_24h,

  -- Listings
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace') AS total_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'active') AS active_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND status = 'sold') AS sold_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND extracted_year BETWEEN 1960 AND 1999) AS vintage_listings,
  (SELECT COUNT(*) FROM marketplace_listings WHERE platform = 'facebook_marketplace' AND first_seen_at > NOW() - INTERVAL '24 hours') AS new_24h,

  -- Disappearances
  (SELECT COUNT(*) FROM fb_listing_disappearances WHERE status = 'missing') AS missing_count,
  (SELECT COUNT(*) FROM fb_listing_disappearances WHERE status = 'inferred_sold') AS inferred_sold_count,

  -- Sweeps
  (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'running') AS sweeps_running,
  (SELECT MAX(completed_at) FROM fb_sweep_jobs WHERE status = 'completed') AS last_sweep_completed,

  -- Health
  CASE
    WHEN (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour') > 0 THEN 'healthy'
    WHEN (SELECT COUNT(*) FROM fb_sweep_jobs WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '4 hours') > 0 THEN 'behind'
    ELSE 'stale'
  END AS system_health;

COMMIT;
