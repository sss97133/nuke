-- Seller Intelligence Schema
--
-- Tracks dealers/flippers who post the same car across multiple CL regions.
-- Surfaces advertising tactics and builds seller profiles over time.
--
-- Designed to work in two phases:
--   Phase 1 (now)   — fingerprint-based cross-post detection (year/make/model/price)
--   Phase 2 (later) — contact-based dedup once process-cl-queue extracts phone/email

-- -----------------------------------------------------------------------
-- Seller profiles
-- -----------------------------------------------------------------------
CREATE TABLE pipeline_sellers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (at least one should be non-null for a real profile)
  phone           TEXT,                        -- normalized digits only, e.g. '2145559999'
  email           TEXT,
  cl_handle       TEXT,                        -- CL username/handle if visible in listing
  seller_name     TEXT,                        -- as stated in listing

  -- Classification
  seller_type     TEXT DEFAULT 'unknown' CHECK (seller_type IN ('private', 'dealer', 'flipper', 'wholesaler', 'unknown')),
  dealer_score    INT  DEFAULT 0 CHECK (dealer_score BETWEEN 0 AND 100),
  -- dealer_score factors:
  --   +30  is_cross_poster (same car, 2+ regions)
  --   +20  region_count > 3
  --   +20  listing_count > 5
  --   +20  multiple makes (not just one model type)
  --   +10  avg_days_listed < 14 (fast turnover)

  -- Activity (denormalized, updated by triggers/cron)
  listing_count         INT       DEFAULT 0,
  active_listing_count  INT       DEFAULT 0,
  region_count          INT       DEFAULT 0,
  regions_seen          TEXT[]    DEFAULT '{}',
  platforms_seen        TEXT[]    DEFAULT '{}',
  makes_seen            TEXT[]    DEFAULT '{}',

  -- Advertising tactics
  is_cross_poster       BOOLEAN   DEFAULT FALSE,  -- same car posted to 2+ regions
  cross_post_count      INT       DEFAULT 0,      -- # of cross-post groups attributed to this seller
  avg_days_listed       INT,                      -- how long listings typically stay active
  price_reduction_rate  NUMERIC,                  -- fraction of listings that had price drops (0–1)
  typical_price_drop_pct NUMERIC,                 -- avg % drop when they do cut price

  -- Pricing profile
  avg_asking_price      NUMERIC,
  avg_deal_score        NUMERIC,

  -- Tags / notes
  tags        TEXT[] DEFAULT '{}',   -- 'high_volume', 'cross_poster', 'price_dropper', 'suspected_dealer'
  notes       TEXT,

  -- Timestamps
  first_seen_at TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX pipeline_sellers_phone_idx ON pipeline_sellers (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX pipeline_sellers_email_idx ON pipeline_sellers (email) WHERE email IS NOT NULL;
CREATE INDEX pipeline_sellers_dealer_score_idx ON pipeline_sellers (dealer_score DESC);
CREATE INDEX pipeline_sellers_type_idx ON pipeline_sellers (seller_type);

-- -----------------------------------------------------------------------
-- Cross-post groups
-- A cross-post group = same physical car listed in multiple CL regions
-- -----------------------------------------------------------------------
CREATE TABLE pipeline_cross_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- How we matched
  match_method        TEXT NOT NULL CHECK (match_method IN ('vehicle_fingerprint', 'vin', 'phone', 'email')),
  vehicle_fingerprint TEXT,   -- 'year:make:model:price' used for fingerprint matches
  vin                 TEXT,   -- if VIN available

  -- Attribution (may be null if seller not yet identified)
  seller_id           UUID REFERENCES pipeline_sellers(id) ON DELETE SET NULL,

  -- Best representative listing
  primary_pipeline_id UUID REFERENCES acquisition_pipeline(id) ON DELETE SET NULL,

  -- All detected instances
  pipeline_ids        UUID[]    NOT NULL,   -- all acquisition_pipeline IDs for this car
  regions_seen        TEXT[]    NOT NULL,   -- CL regions: ['dallas', 'houston', 'austin']
  url_variants        TEXT[]    DEFAULT '{}',  -- all URLs observed
  price_variants      NUMERIC[] DEFAULT '{}',  -- prices seen (shows drops/raises across regions)

  -- Timing
  first_seen_at       TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pipeline_cross_posts_seller_idx       ON pipeline_cross_posts (seller_id);
CREATE INDEX pipeline_cross_posts_fingerprint_idx  ON pipeline_cross_posts (vehicle_fingerprint);
CREATE INDEX pipeline_cross_posts_primary_idx      ON pipeline_cross_posts (primary_pipeline_id);

-- -----------------------------------------------------------------------
-- Add seller linkage to acquisition_pipeline
-- -----------------------------------------------------------------------
ALTER TABLE acquisition_pipeline
  ADD COLUMN IF NOT EXISTS seller_id        UUID REFERENCES pipeline_sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cross_post_id    UUID REFERENCES pipeline_cross_posts(id) ON DELETE SET NULL;

CREATE INDEX acquisition_pipeline_seller_idx     ON acquisition_pipeline (seller_id);
CREATE INDEX acquisition_pipeline_cross_post_idx ON acquisition_pipeline (cross_post_id);

-- -----------------------------------------------------------------------
-- Backfill: detect existing cross-post groups by vehicle fingerprint
-- Any (year, make, model, asking_price) appearing in 2+ distinct URLs
-- -----------------------------------------------------------------------
WITH fingerprinted AS (
  SELECT
    id,
    COALESCE(year::TEXT, '?') || ':' || make || ':' || COALESCE(model, '?') || ':' || COALESCE(asking_price::TEXT, '?') AS fingerprint,
    -- Extract CL region from URL: https://{region}.craigslist.org/...
    (regexp_match(discovery_url, 'https://([^.]+)\.craigslist\.org'))[1] AS region,
    discovery_url,
    asking_price,
    deal_score,
    created_at
  FROM acquisition_pipeline
  WHERE discovery_url LIKE 'https://%.craigslist.org%'
    AND make IS NOT NULL
),
grouped AS (
  SELECT
    fingerprint,
    COUNT(DISTINCT region)                                          AS region_count,
    array_agg(DISTINCT region ORDER BY region)                     AS regions_seen,
    array_agg(id ORDER BY deal_score DESC NULLS LAST, created_at)  AS ids_ordered,
    array_agg(DISTINCT discovery_url)                              AS url_variants,
    array_agg(DISTINCT asking_price)                               AS price_variants,
    MIN(created_at)                                                AS first_seen_at,
    MAX(created_at)                                                AS last_seen_at
  FROM fingerprinted
  GROUP BY fingerprint
  HAVING COUNT(DISTINCT region) > 1   -- only cross-posters
)
INSERT INTO pipeline_cross_posts (
  match_method,
  vehicle_fingerprint,
  primary_pipeline_id,
  pipeline_ids,
  regions_seen,
  url_variants,
  price_variants,
  first_seen_at,
  last_seen_at
)
SELECT
  'vehicle_fingerprint',
  fingerprint,
  ids_ordered[1],    -- best-scored listing is primary
  ids_ordered,
  regions_seen,
  url_variants,
  price_variants,
  first_seen_at,
  last_seen_at
FROM grouped;

-- Link pipeline entries back to their cross_post group
UPDATE acquisition_pipeline ap
SET cross_post_id = cp.id
FROM pipeline_cross_posts cp
WHERE ap.id = ANY(cp.pipeline_ids);

-- -----------------------------------------------------------------------
-- View: dealer intelligence summary
-- -----------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cross_post_intel AS
SELECT
  cp.id,
  cp.vehicle_fingerprint,
  cp.match_method,
  cp.regions_seen,
  array_length(cp.regions_seen, 1)  AS region_count,
  array_length(cp.pipeline_ids, 1)  AS listing_count,
  cp.price_variants,
  CASE
    WHEN array_length(cp.price_variants, 1) > 1
      AND (SELECT MAX(v) FROM unnest(cp.price_variants) v) !=
          (SELECT MIN(v) FROM unnest(cp.price_variants) v)
    THEN TRUE ELSE FALSE
  END                                AS has_price_variation,
  -- Best listing's deal score
  ap.deal_score,
  ap.year, ap.make, ap.model,
  ap.asking_price,
  ap.location_city, ap.location_state,
  ap.discovery_url                   AS primary_url,
  cp.seller_id,
  ps.seller_type,
  ps.dealer_score,
  ps.phone,
  ps.email,
  cp.first_seen_at,
  cp.last_seen_at
FROM pipeline_cross_posts cp
LEFT JOIN acquisition_pipeline ap ON ap.id = cp.primary_pipeline_id
LEFT JOIN pipeline_sellers      ps ON ps.id = cp.seller_id
ORDER BY region_count DESC, cp.last_seen_at DESC;

-- -----------------------------------------------------------------------
-- Verify backfill
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                        AS cross_post_groups,
  SUM(array_length(pipeline_ids, 1))              AS affected_listings,
  MAX(array_length(regions_seen, 1))              AS max_regions_for_one_car,
  ROUND(AVG(array_length(regions_seen, 1)), 1)    AS avg_regions_per_group
FROM pipeline_cross_posts;
