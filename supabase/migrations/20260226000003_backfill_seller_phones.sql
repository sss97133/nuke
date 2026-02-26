-- Backfill seller phones from stored vehicle descriptions
-- Extracts phone numbers from vehicles.description for CL listings
-- that are already linked to acquisition_pipeline but have no seller_id

-- -----------------------------------------------------------------------
-- 1. Extract phones, upsert pipeline_sellers
-- -----------------------------------------------------------------------
WITH phone_extractions AS (
  SELECT
    ap.id                                                                 AS pipeline_id,
    ap.discovery_url,
    (regexp_match(ap.discovery_url, 'https?://([^.]+)\.craigslist\.org'))[1] AS region,
    CASE
      -- (xxx) xxx-xxxx  or  (xxx) xxx xxxx
      WHEN v.description ~ '\(\d{3}\)\s*\d{3}[-.\s]\d{4}'
        THEN regexp_replace(
               (regexp_match(v.description, '\(\d{3}\)\s*\d{3}[-.\s]\d{4}'))[1],
               '\D', '', 'g')
      -- xxx-xxx-xxxx  or  xxx.xxx.xxxx  or  xxx xxx xxxx
      WHEN v.description ~ '\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b'
        THEN regexp_replace(
               (regexp_match(v.description, '\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b'))[1],
               '\D', '', 'g')
      -- 1-xxx-xxx-xxxx
      WHEN v.description ~ '\b1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'
        THEN RIGHT(regexp_replace(
               (regexp_match(v.description, '\b1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'))[1],
               '\D', '', 'g'), 10)
    END AS phone
  FROM acquisition_pipeline ap
  JOIN vehicles v ON v.id = ap.vehicle_id
  WHERE ap.discovery_url LIKE 'https://%.craigslist.org%'
    AND ap.seller_id IS NULL
    AND v.description IS NOT NULL
),
valid AS (
  SELECT pipeline_id, discovery_url, region, phone
  FROM phone_extractions
  WHERE phone IS NOT NULL
    AND LENGTH(phone) = 10
    AND phone ~ '^\d{10}$'
    -- Exclude obvious non-phones (all same digit, sequential, etc.)
    AND phone NOT IN ('0000000000','1111111111','2222222222','3333333333',
                      '4444444444','5555555555','6666666666','7777777777',
                      '8888888888','9999999999','1234567890','0123456789')
),
-- Aggregate per phone: listing count, regions seen
seller_stats AS (
  SELECT
    phone,
    COUNT(*)                              AS listing_count,
    COUNT(DISTINCT region)                AS region_count,
    array_agg(DISTINCT region)            AS regions_seen,
    MIN(pipeline_id::text)::uuid          AS sample_pipeline_id
  FROM valid
  GROUP BY phone
)
INSERT INTO pipeline_sellers (
  phone,
  listing_count,
  region_count,
  regions_seen,
  platforms_seen,
  first_seen_at,
  last_seen_at
)
SELECT
  phone,
  listing_count,
  region_count,
  regions_seen,
  ARRAY['craigslist'],
  NOW(),
  NOW()
FROM seller_stats
ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
  listing_count  = pipeline_sellers.listing_count + EXCLUDED.listing_count,
  region_count   = GREATEST(pipeline_sellers.region_count, EXCLUDED.region_count),
  regions_seen   = (
    SELECT array_agg(DISTINCT r)
    FROM unnest(pipeline_sellers.regions_seen || EXCLUDED.regions_seen) r
  ),
  last_seen_at   = NOW(),
  updated_at     = NOW();

-- -----------------------------------------------------------------------
-- 2. Link pipeline entries back to their seller
-- -----------------------------------------------------------------------
WITH phone_extractions AS (
  SELECT
    ap.id AS pipeline_id,
    CASE
      WHEN v.description ~ '\(\d{3}\)\s*\d{3}[-.\s]\d{4}'
        THEN regexp_replace(
               (regexp_match(v.description, '\(\d{3}\)\s*\d{3}[-.\s]\d{4}'))[1],
               '\D', '', 'g')
      WHEN v.description ~ '\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b'
        THEN regexp_replace(
               (regexp_match(v.description, '\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b'))[1],
               '\D', '', 'g')
      WHEN v.description ~ '\b1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'
        THEN RIGHT(regexp_replace(
               (regexp_match(v.description, '\b1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'))[1],
               '\D', '', 'g'), 10)
    END AS phone
  FROM acquisition_pipeline ap
  JOIN vehicles v ON v.id = ap.vehicle_id
  WHERE ap.discovery_url LIKE 'https://%.craigslist.org%'
    AND ap.seller_id IS NULL
    AND v.description IS NOT NULL
),
valid AS (
  SELECT pipeline_id, phone
  FROM phone_extractions
  WHERE phone IS NOT NULL
    AND LENGTH(phone) = 10
    AND phone ~ '^\d{10}$'
    AND phone NOT IN ('0000000000','1111111111','2222222222','3333333333',
                      '4444444444','5555555555','6666666666','7777777777',
                      '8888888888','9999999999','1234567890','0123456789')
)
UPDATE acquisition_pipeline ap
SET
  seller_id      = ps.id,
  seller_contact = v.phone
FROM valid v
JOIN pipeline_sellers ps ON ps.phone = v.phone
WHERE ap.id = v.pipeline_id;

-- -----------------------------------------------------------------------
-- 3. Update dealer_score: +30 for cross-posters, +20 for region_count > 3,
--    +20 for listing_count > 5
-- -----------------------------------------------------------------------
UPDATE pipeline_sellers
SET
  is_cross_poster = (region_count > 1),
  dealer_score    = LEAST(100,
    CASE WHEN region_count > 1  THEN 30 ELSE 0 END +
    CASE WHEN region_count > 3  THEN 20 ELSE 0 END +
    CASE WHEN listing_count > 5 THEN 20 ELSE 0 END
  ),
  tags = CASE
    WHEN region_count > 1 THEN ARRAY['cross_poster']
    ELSE ARRAY[]::text[]
  END,
  updated_at = NOW();

-- -----------------------------------------------------------------------
-- 4. Verify
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                           AS total_sellers,
  COUNT(*) FILTER (WHERE listing_count > 1)          AS multi_listing,
  COUNT(*) FILTER (WHERE is_cross_poster)            AS cross_posters,
  COUNT(*) FILTER (WHERE dealer_score >= 50)         AS likely_dealers,
  MAX(listing_count)                                 AS max_listings,
  MAX(region_count)                                  AS max_regions
FROM pipeline_sellers;
