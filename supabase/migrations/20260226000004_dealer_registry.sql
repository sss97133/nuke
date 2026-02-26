-- Dealer Intelligence Registry
-- Extends pipeline_sellers into a full national dealer profile system.
-- Every seller we've ever seen — dealers, flippers, wholesalers, shops — tracked
-- as a business intelligence entity, not just a blocklist entry.
--
-- Parts:
--   1. Extend pipeline_sellers with business identity + intel classification
--   2. seller_sightings — append-only event log (price history, activity cadence)
--   3. v_dealer_registry — primary query surface
--   4. seller_intel_rollup() — cron-driven rollup from sightings to profile

-- -----------------------------------------------------------------------
-- 1. Extend pipeline_sellers
-- -----------------------------------------------------------------------
ALTER TABLE pipeline_sellers
  ADD COLUMN IF NOT EXISTS business_name        TEXT,
  ADD COLUMN IF NOT EXISTS website              TEXT,
  ADD COLUMN IF NOT EXISTS primary_region       TEXT,
  ADD COLUMN IF NOT EXISTS primary_state        TEXT,

  ADD COLUMN IF NOT EXISTS business_type        TEXT
    CHECK (business_type IN (
      'licensed_dealer', 'restoration_shop', 'consignment_dealer',
      'wholesaler', 'broker', 'auction_rep', 'estate_liquidator',
      'flipper', 'collector_seller', 'unknown'
    )),

  ADD COLUMN IF NOT EXISTS specialties          TEXT[] DEFAULT '{}',
  -- muscle_cars | pony_cars | classic_trucks | european_classics | jdm |
  -- american_classics | hot_rods | resto_mods | numbers_matching |
  -- project_cars | high_volume | barn_finds

  ADD COLUMN IF NOT EXISTS eras_seen            INT4RANGE,
  -- e.g. '[1955,1975)' — queryable with && operator

  ADD COLUMN IF NOT EXISTS intel_value          TEXT DEFAULT 'comp_source'
    CHECK (intel_value IN (
      'comp_source',        -- their prices are market data
      'wholesale_target',   -- could source cars from them
      'restoration_partner',
      'watch_only',
      'blocklist'
    )),

  ADD COLUMN IF NOT EXISTS contact_status       TEXT DEFAULT 'not_contacted'
    CHECK (contact_status IN (
      'not_contacted', 'contacted', 'relationship_active', 'declined', 'blocked'
    )),

  ADD COLUMN IF NOT EXISTS relationship_notes   TEXT,

  ADD COLUMN IF NOT EXISTS median_asking_price  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_range_low      NUMERIC,
  ADD COLUMN IF NOT EXISTS price_range_high     NUMERIC,
  ADD COLUMN IF NOT EXISTS makes_histogram      JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS models_seen          TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS listings_per_month   NUMERIC,

  ADD COLUMN IF NOT EXISTS discovered_via       TEXT DEFAULT 'craigslist_scrape'
    CHECK (discovered_via IN (
      'craigslist_scrape', 'facebook_marketplace', 'manual_entry',
      'classic_com', 'bat_monitor', 'other'
    )),

  ADD COLUMN IF NOT EXISTS enrichment_status    TEXT DEFAULT 'raw'
    CHECK (enrichment_status IN ('raw', 'partial', 'enriched', 'verified')),

  ADD COLUMN IF NOT EXISTS last_enriched_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pipeline_sellers_business_type_idx
  ON pipeline_sellers (business_type) WHERE business_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_sellers_intel_value_idx
  ON pipeline_sellers (intel_value);
CREATE INDEX IF NOT EXISTS pipeline_sellers_primary_state_idx
  ON pipeline_sellers (primary_state) WHERE primary_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_sellers_specialties_idx
  ON pipeline_sellers USING GIN (specialties);
CREATE INDEX IF NOT EXISTS pipeline_sellers_last_seen_idx
  ON pipeline_sellers (last_seen_at DESC);

-- -----------------------------------------------------------------------
-- 2. seller_sightings — append-only event log
-- One row per listing per scrape. Never update. Source of truth for
-- all rollup fields on pipeline_sellers.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seller_sightings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  seller_id           UUID NOT NULL REFERENCES pipeline_sellers(id) ON DELETE CASCADE,
  pipeline_id         UUID REFERENCES acquisition_pipeline(id) ON DELETE SET NULL,

  platform            TEXT NOT NULL DEFAULT 'craigslist',
  region              TEXT,
  location_state      TEXT,

  url                 TEXT NOT NULL,
  year                INTEGER,
  make                TEXT,
  model               TEXT,
  asking_price        NUMERIC,

  listing_status      TEXT DEFAULT 'active'
    CHECK (listing_status IN ('active','price_drop','relisted','sold','removed','unknown')),

  deal_score          INTEGER,
  price_delta         NUMERIC,         -- null on first sighting; negative = drop
  is_new_listing      BOOLEAN DEFAULT TRUE,
  is_cross_region     BOOLEAN DEFAULT FALSE,
  vehicle_fingerprint TEXT,

  seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seller_sightings_seller_recent_idx
  ON seller_sightings (seller_id, seen_at DESC);
CREATE INDEX IF NOT EXISTS seller_sightings_state_recent_idx
  ON seller_sightings (location_state, seen_at DESC) WHERE location_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS seller_sightings_make_idx
  ON seller_sightings (make, seen_at DESC) WHERE make IS NOT NULL;
CREATE INDEX IF NOT EXISTS seller_sightings_price_drop_idx
  ON seller_sightings (seen_at DESC) WHERE listing_status = 'price_drop';
CREATE INDEX IF NOT EXISTS seller_sightings_new_listing_idx
  ON seller_sightings (seen_at DESC) WHERE is_new_listing = TRUE;
CREATE INDEX IF NOT EXISTS seller_sightings_pipeline_idx
  ON seller_sightings (pipeline_id) WHERE pipeline_id IS NOT NULL;

-- Backfill sightings from existing acquisition_pipeline data
INSERT INTO seller_sightings (
  seller_id, pipeline_id, platform, region,
  location_state, url, year, make, model,
  asking_price, deal_score, is_new_listing,
  vehicle_fingerprint, seen_at
)
SELECT
  ap.seller_id,
  ap.id,
  'craigslist',
  (regexp_match(ap.discovery_url, 'https?://([^.]+)\.craigslist\.org'))[1],
  ap.location_state,
  ap.discovery_url,
  ap.year,
  ap.make,
  ap.model,
  ap.asking_price,
  ap.deal_score,
  TRUE,
  COALESCE(ap.year::TEXT,'?') || ':' || COALESCE(ap.make,'?') || ':' ||
    COALESCE(ap.model,'?') || ':' || COALESCE(ap.asking_price::TEXT,'?'),
  COALESCE(ap.discovery_date, ap.created_at)
FROM acquisition_pipeline ap
WHERE ap.seller_id IS NOT NULL
  AND ap.discovery_url LIKE 'https://%.craigslist.org%'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------
-- 3. v_dealer_registry — primary query surface
-- -----------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dealer_registry AS
SELECT
  ps.id,
  ps.phone,
  ps.email,
  ps.cl_handle,
  ps.seller_name,
  ps.business_name,
  ps.website,
  ps.business_type,
  ps.seller_type,
  ps.specialties,
  ps.eras_seen,
  ps.intel_value,
  ps.contact_status,
  ps.relationship_notes,
  ps.enrichment_status,
  ps.primary_region,
  ps.primary_state,
  ps.regions_seen,
  ps.region_count,
  ps.listing_count,
  ps.listings_per_month,
  ps.is_cross_poster,
  ps.cross_post_count,
  ps.platforms_seen,
  ps.dealer_score,
  ps.avg_asking_price,
  ps.median_asking_price,
  ps.price_range_low,
  ps.price_range_high,
  ps.avg_deal_score,
  ps.avg_days_listed,
  ps.price_reduction_rate,
  ps.makes_seen,
  ps.makes_histogram,
  ps.models_seen,
  ps.tags,
  ps.discovered_via,

  -- Computed use-case flags (derived, not stored)
  (ps.intel_value = 'comp_source' AND ps.listing_count >= 3
    AND ps.avg_asking_price IS NOT NULL)            AS is_comp_source,

  (ps.intel_value = 'wholesale_target'
    OR (ps.business_type IN ('wholesaler','licensed_dealer')
        AND ps.dealer_score >= 60
        AND ps.contact_status IN ('not_contacted','contacted')))
                                                    AS is_wholesale_candidate,

  (ps.business_type = 'restoration_shop'
    OR 'hot_rods'    = ANY(ps.specialties)
    OR 'resto_mods'  = ANY(ps.specialties))         AS is_restoration_lead,

  ('numbers_matching' = ANY(ps.specialties)
    OR 'barn_finds'   = ANY(ps.specialties))        AS is_provenance_specialist,

  (ps.last_seen_at > NOW() - INTERVAL '90 days')    AS active_90d,

  -- Recent activity from sightings
  (SELECT COUNT(*)::INT FROM seller_sightings ss
    WHERE ss.seller_id = ps.id
      AND ss.seen_at > NOW() - INTERVAL '30 days'
      AND ss.is_new_listing = TRUE)                 AS new_listings_last_30d,

  (SELECT ROUND(AVG(ss.asking_price))
    FROM seller_sightings ss
    WHERE ss.seller_id = ps.id
      AND ss.seen_at > NOW() - INTERVAL '90 days'
      AND ss.asking_price IS NOT NULL)              AS avg_price_last_90d,

  (SELECT ss.make FROM seller_sightings ss
    WHERE ss.seller_id = ps.id
    ORDER BY ss.seen_at DESC LIMIT 1)               AS last_seen_make,

  (SELECT ss.asking_price FROM seller_sightings ss
    WHERE ss.seller_id = ps.id
    ORDER BY ss.seen_at DESC LIMIT 1)               AS last_seen_price,

  ps.first_seen_at,
  ps.last_seen_at,
  ps.last_enriched_at,
  ps.created_at,
  ps.updated_at

FROM pipeline_sellers ps
WHERE ps.listing_count > 0
   OR EXISTS (SELECT 1 FROM seller_sightings ss WHERE ss.seller_id = ps.id LIMIT 1);

COMMENT ON VIEW v_dealer_registry IS
'Primary dealer intelligence query surface.
 Key patterns:
   WHERE primary_state = ''TX'' AND active_90d
   WHERE is_wholesale_candidate AND contact_status = ''not_contacted''
   WHERE is_restoration_lead
   WHERE ''muscle_cars'' = ANY(specialties)
   WHERE eras_seen && ''[1964,1974)''::int4range
   WHERE dealer_score >= 70 AND contact_status = ''not_contacted''';

-- -----------------------------------------------------------------------
-- 4. seller_intel_rollup() — cron-driven aggregation
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seller_intel_rollup(p_seller_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pipeline_sellers ps
  SET
    median_asking_price = sub.median_price,
    price_range_low     = sub.price_low,
    price_range_high    = sub.price_high,
    makes_histogram     = sub.makes_hist,
    models_seen         = sub.models_arr,
    primary_region      = sub.top_region,
    primary_state       = sub.top_state,
    eras_seen           = sub.era_range,
    listings_per_month  = sub.per_month,
    listing_count       = GREATEST(ps.listing_count, sub.total_sightings),
    last_seen_at        = GREATEST(ps.last_seen_at, sub.latest_seen),
    updated_at          = NOW()
  FROM (
    SELECT
      ss.seller_id,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ss.asking_price) AS median_price,
      MIN(ss.asking_price)   AS price_low,
      MAX(ss.asking_price)   AS price_high,
      (SELECT jsonb_object_agg(m, c) FROM (
         SELECT ss2.make AS m, COUNT(*) AS c
         FROM seller_sightings ss2
         WHERE ss2.seller_id = ss.seller_id AND ss2.make IS NOT NULL
         GROUP BY ss2.make ORDER BY c DESC
       ) mc)                 AS makes_hist,
      array_agg(DISTINCT ss.model) FILTER (WHERE ss.model IS NOT NULL) AS models_arr,
      MODE() WITHIN GROUP (ORDER BY ss.region)           AS top_region,
      MODE() WITHIN GROUP (ORDER BY ss.location_state)   AS top_state,
      CASE WHEN MIN(ss.year) IS NOT NULL AND MAX(ss.year) IS NOT NULL
           THEN int4range(MIN(ss.year), MAX(ss.year) + 1) END AS era_range,
      CASE WHEN MAX(ss.seen_at) > MIN(ss.seen_at)
           THEN COUNT(*) FILTER (WHERE ss.is_new_listing)::NUMERIC /
                GREATEST(EXTRACT(EPOCH FROM (MAX(ss.seen_at) - MIN(ss.seen_at))) / 2592000, 1)
           ELSE COUNT(*) FILTER (WHERE ss.is_new_listing) END AS per_month,
      COUNT(*)               AS total_sightings,
      MAX(ss.seen_at)        AS latest_seen
    FROM seller_sightings ss
    WHERE (p_seller_id IS NULL OR ss.seller_id = p_seller_id)
    GROUP BY ss.seller_id
  ) sub
  WHERE ps.id = sub.seller_id
    AND (p_seller_id IS NULL OR ps.id = p_seller_id);
END;
$$;

-- Run initial rollup against backfilled sightings
SELECT seller_intel_rollup();

-- -----------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM pipeline_sellers)    AS total_sellers,
  (SELECT COUNT(*) FROM seller_sightings)    AS total_sightings,
  (SELECT COUNT(*) FROM v_dealer_registry)   AS registry_visible;
