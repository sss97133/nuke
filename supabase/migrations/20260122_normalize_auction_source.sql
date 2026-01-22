-- ============================================================================
-- NORMALIZE AUCTION_SOURCE FIELD
-- ============================================================================
-- Problem:
-- The auction_source field has inconsistent values:
--   - "bat", "BaT", "Bring a Trailer", "bringatrailer" all mean the same thing
--   - Many records have NULL auction_source but valid discovery_url
--   - Counts by auction_source are unreliable
--
-- Solution:
-- Normalize auction_source based on discovery_url/listing_url patterns
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) Define canonical source names
-- ============================================================================
-- Standard names (matching external_listings.platform conventions):
--   - 'Bring a Trailer'
--   - 'Cars & Bids'
--   - 'Mecum'
--   - 'Craigslist'
--   - 'SBX Cars'
--   - 'Collecting Cars'
--   - 'Broad Arrow'
--   - 'RM Sothebys'
--   - 'Gooding'
--   - 'PCarMarket'
--   - 'Hemmings'
--   - 'Design Auto'
--   - 'Dealer' (generic dealer listings)
--   - 'User Submission' (manual entries)

-- ============================================================================
-- 2) Normalize based on discovery_url patterns
-- ============================================================================

-- Bring a Trailer variants
UPDATE vehicles
SET auction_source = 'Bring a Trailer'
WHERE COALESCE(discovery_url, listing_url, bat_auction_url, '') ~* 'bringatrailer\.com'
  AND auction_source IS DISTINCT FROM 'Bring a Trailer';

-- Cars & Bids
UPDATE vehicles
SET auction_source = 'Cars & Bids'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'carsandbids\.com'
  AND auction_source IS DISTINCT FROM 'Cars & Bids';

-- Craigslist
UPDATE vehicles
SET auction_source = 'Craigslist'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'craigslist\.(com|org)'
  AND auction_source IS DISTINCT FROM 'Craigslist';

-- Mecum
UPDATE vehicles
SET auction_source = 'Mecum'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'mecum\.com'
  AND auction_source IS DISTINCT FROM 'Mecum';

-- SBX Cars
UPDATE vehicles
SET auction_source = 'SBX Cars'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'sbx\.(cars|com)'
  AND auction_source IS DISTINCT FROM 'SBX Cars';

-- Collecting Cars
UPDATE vehicles
SET auction_source = 'Collecting Cars'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'collectingcars\.com'
  AND auction_source IS DISTINCT FROM 'Collecting Cars';

-- Broad Arrow
UPDATE vehicles
SET auction_source = 'Broad Arrow'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'broadarrowauctions\.com'
  AND auction_source IS DISTINCT FROM 'Broad Arrow';

-- RM Sotheby's
UPDATE vehicles
SET auction_source = 'RM Sothebys'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'rmsothebys\.com'
  AND auction_source IS DISTINCT FROM 'RM Sothebys';

-- Gooding & Company
UPDATE vehicles
SET auction_source = 'Gooding'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'goodingco\.com'
  AND auction_source IS DISTINCT FROM 'Gooding';

-- PCarMarket
UPDATE vehicles
SET auction_source = 'PCarMarket'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'pcarmarket\.com'
  AND auction_source IS DISTINCT FROM 'PCarMarket';

-- Hemmings
UPDATE vehicles
SET auction_source = 'Hemmings'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'hemmings\.com'
  AND auction_source IS DISTINCT FROM 'Hemmings';

-- Design Auto
UPDATE vehicles
SET auction_source = 'Design Auto'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'designauto\.com'
  AND auction_source IS DISTINCT FROM 'Design Auto';

-- BAT Auctions (another BaT domain)
UPDATE vehicles
SET auction_source = 'Bring a Trailer'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'batauctions\.com'
  AND auction_source IS DISTINCT FROM 'Bring a Trailer';

-- eBay Motors
UPDATE vehicles
SET auction_source = 'eBay Motors'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'ebay\.com/motors'
  AND auction_source IS DISTINCT FROM 'eBay Motors';

-- Facebook Marketplace
UPDATE vehicles
SET auction_source = 'Facebook Marketplace'
WHERE COALESCE(discovery_url, listing_url, '') ~* 'facebook\.com/marketplace'
  AND auction_source IS DISTINCT FROM 'Facebook Marketplace';

-- ============================================================================
-- 3) Clean up legacy values
-- ============================================================================

-- Fix variations of BaT
UPDATE vehicles
SET auction_source = 'Bring a Trailer'
WHERE auction_source IN ('bat', 'BaT', 'bringatrailer', 'Bringatrailer', 'BAT');

-- Fix variations of C&B
UPDATE vehicles
SET auction_source = 'Cars & Bids'
WHERE auction_source IN ('cb', 'C&B', 'carsandbids', 'cars_and_bids', 'CarsAndBids');

-- Fix variations of Craigslist
UPDATE vehicles
SET auction_source = 'Craigslist'
WHERE auction_source IN ('cl', 'craigslist', 'CL');

-- Fix variations of Mecum
UPDATE vehicles
SET auction_source = 'Mecum'
WHERE auction_source IN ('mecum', 'MECUM');

-- ============================================================================
-- 4) Set default for remaining NULL values
-- ============================================================================

-- If still NULL and has discovery_url, mark as 'Unknown Source'
-- If no discovery_url, likely a user submission
UPDATE vehicles
SET auction_source = CASE
  WHEN COALESCE(discovery_url, listing_url, '') != '' THEN 'Unknown Source'
  ELSE 'User Submission'
END
WHERE auction_source IS NULL;

-- ============================================================================
-- 5) Create function to auto-set auction_source on insert/update
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_set_auction_source()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  url_to_check TEXT;
BEGIN
  -- Get the URL to check
  url_to_check := COALESCE(NEW.discovery_url, NEW.listing_url, '');

  -- Only auto-set if auction_source is NULL or generic
  IF NEW.auction_source IS NULL OR NEW.auction_source IN ('Unknown Source', 'User Submission') THEN
    NEW.auction_source := CASE
      WHEN url_to_check ~* 'bringatrailer\.com' THEN 'Bring a Trailer'
      WHEN url_to_check ~* 'carsandbids\.com' THEN 'Cars & Bids'
      WHEN url_to_check ~* 'craigslist\.(com|org)' THEN 'Craigslist'
      WHEN url_to_check ~* 'mecum\.com' THEN 'Mecum'
      WHEN url_to_check ~* 'sbx\.(cars|com)' THEN 'SBX Cars'
      WHEN url_to_check ~* 'collectingcars\.com' THEN 'Collecting Cars'
      WHEN url_to_check ~* 'broadarrowauctions\.com' THEN 'Broad Arrow'
      WHEN url_to_check ~* 'rmsothebys\.com' THEN 'RM Sothebys'
      WHEN url_to_check ~* 'goodingco\.com' THEN 'Gooding'
      WHEN url_to_check ~* 'pcarmarket\.com' THEN 'PCarMarket'
      WHEN url_to_check ~* 'hemmings\.com' THEN 'Hemmings'
      WHEN url_to_check ~* 'designauto\.com' THEN 'Design Auto'
      WHEN url_to_check ~* 'ebay\.com' THEN 'eBay Motors'
      WHEN url_to_check ~* 'facebook\.com' THEN 'Facebook Marketplace'
      WHEN url_to_check != '' THEN 'Unknown Source'
      ELSE 'User Submission'
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_set_auction_source ON public.vehicles;
CREATE TRIGGER trigger_auto_set_auction_source
  BEFORE INSERT OR UPDATE OF discovery_url, listing_url
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_auction_source();

COMMENT ON FUNCTION public.auto_set_auction_source IS
  'Automatically sets auction_source based on discovery_url/listing_url patterns.';

-- ============================================================================
-- 6) Create view for accurate source counts
-- ============================================================================

CREATE OR REPLACE VIEW vehicle_source_counts AS
SELECT
  auction_source,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'active') as active,
  COUNT(*) FILTER (WHERE status = 'sold' OR sale_status = 'sold') as sold,
  COUNT(*) FILTER (WHERE is_public = true) as public_visible,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sale_price IS NOT NULL OR asking_price IS NOT NULL OR high_bid IS NOT NULL) / COUNT(*), 1) as pct_with_price
FROM vehicles
WHERE listing_kind = 'vehicle' OR listing_kind IS NULL
GROUP BY auction_source
ORDER BY total DESC;

COMMENT ON VIEW vehicle_source_counts IS
  'Accurate vehicle counts by normalized auction_source.';

COMMIT;
