-- Vehicles missing VIN, grouped by source.
-- Run in Supabase SQL Editor. Use result to prioritize BaT/auction sites (quick VIN re-extract), then examine others.

-- 1) Derive source from auction_source or discovery_url, then count missing-VIN vehicles per source.
WITH missing_vin AS (
  SELECT
    id,
    year,
    make,
    model,
    discovery_url,
    bat_auction_url,
    profile_origin,
    discovery_source,
    auction_source,
    -- Single label for grouping: prefer auction_source, else derive from URL
    COALESCE(
      auction_source,
      CASE
        WHEN COALESCE(discovery_url, bat_auction_url, '') ~* 'bringatrailer\.com|batauctions\.com' THEN 'Bring a Trailer'
        WHEN COALESCE(discovery_url, '') ~* 'carsandbids\.com' THEN 'Cars & Bids'
        WHEN COALESCE(discovery_url, '') ~* 'pcarmarket\.com' THEN 'PCarMarket'
        WHEN COALESCE(discovery_url, '') ~* 'mecum\.com' THEN 'Mecum'
        WHEN COALESCE(discovery_url, '') ~* 'collectingcars\.com' THEN 'Collecting Cars'
        WHEN COALESCE(discovery_url, '') ~* 'broadarrowauctions\.com' THEN 'Broad Arrow'
        WHEN COALESCE(discovery_url, '') ~* 'rmsothebys\.com' THEN 'RM Sothebys'
        WHEN COALESCE(discovery_url, '') ~* 'goodingco\.com' THEN 'Gooding'
        WHEN COALESCE(discovery_url, '') ~* 'hemmings\.com' THEN 'Hemmings'
        WHEN COALESCE(discovery_url, '') ~* 'sbx\.(cars|com)' THEN 'SBX Cars'
        WHEN COALESCE(discovery_url, '') ~* 'craigslist\.(com|org)' THEN 'Craigslist'
        WHEN COALESCE(discovery_url, '') ~* 'classic\.com' THEN 'Classic.com'
        WHEN COALESCE(discovery_url, '') ~* 'ebay\.com' THEN 'eBay'
        WHEN COALESCE(discovery_url, '') ~* 'facebook\.com' THEN 'Facebook'
        WHEN COALESCE(discovery_url, '') != '' THEN 'Unknown URL'
        ELSE COALESCE(profile_origin::text, discovery_source::text, 'No URL')
      END
    ) AS source_label
  FROM vehicles
  WHERE (vin IS NULL OR TRIM(vin) = '')
)
SELECT
  source_label,
  COUNT(*) AS missing_vin_count,
  -- High likelihood of VIN on listing page (BaT, C&B, PCarMarket, Mecum, etc.)
  CASE
    WHEN source_label IN (
      'Bring a Trailer', 'Cars & Bids', 'PCarMarket', 'Mecum',
      'Collecting Cars', 'Broad Arrow', 'RM Sothebys', 'Gooding', 'Hemmings'
    ) THEN 'High (auction)'
    WHEN source_label IN ('SBX Cars', 'Classic.com') THEN 'Medium'
    WHEN source_label IN ('Craigslist', 'eBay', 'Facebook', 'Unknown URL') THEN 'Low'
    ELSE 'Examine'
  END AS vin_likelihood
FROM missing_vin
GROUP BY source_label
ORDER BY
  CASE
    WHEN source_label IN (
      'Bring a Trailer', 'Cars & Bids', 'PCarMarket', 'Mecum',
      'Collecting Cars', 'Broad Arrow', 'RM Sothebys', 'Gooding', 'Hemmings'
    ) THEN 0
    WHEN source_label IN ('SBX Cars', 'Classic.com') THEN 1
    ELSE 2
  END,
  missing_vin_count DESC;

-- =============================================================================
-- 2) High-likelihood only (BaT + auction sites): id, url, source — for re-extract.
-- Run this after (1) to get a list to feed into bat-simple-extract or similar.
-- =============================================================================
WITH missing_vin AS (
  SELECT
    id,
    year,
    make,
    model,
    COALESCE(discovery_url, bat_auction_url) AS url,
    COALESCE(
      auction_source,
      CASE
        WHEN COALESCE(discovery_url, bat_auction_url, '') ~* 'bringatrailer\.com|batauctions\.com' THEN 'Bring a Trailer'
        WHEN COALESCE(discovery_url, '') ~* 'carsandbids\.com' THEN 'Cars & Bids'
        WHEN COALESCE(discovery_url, '') ~* 'pcarmarket\.com' THEN 'PCarMarket'
        WHEN COALESCE(discovery_url, '') ~* 'mecum\.com' THEN 'Mecum'
        WHEN COALESCE(discovery_url, '') ~* 'collectingcars\.com' THEN 'Collecting Cars'
        WHEN COALESCE(discovery_url, '') ~* 'broadarrowauctions\.com' THEN 'Broad Arrow'
        WHEN COALESCE(discovery_url, '') ~* 'rmsothebys\.com' THEN 'RM Sothebys'
        WHEN COALESCE(discovery_url, '') ~* 'goodingco\.com' THEN 'Gooding'
        WHEN COALESCE(discovery_url, '') ~* 'hemmings\.com' THEN 'Hemmings'
        ELSE NULL
      END
    ) AS source_label
  FROM vehicles
  WHERE (vin IS NULL OR TRIM(vin) = '')
    AND (discovery_url IS NOT NULL OR bat_auction_url IS NOT NULL)
)
SELECT id, year, make, model, source_label, url
FROM missing_vin
WHERE source_label IN (
  'Bring a Trailer', 'Cars & Bids', 'PCarMarket', 'Mecum',
  'Collecting Cars', 'Broad Arrow', 'RM Sothebys', 'Gooding', 'Hemmings'
)
ORDER BY source_label, year DESC, make, model
LIMIT 500;
