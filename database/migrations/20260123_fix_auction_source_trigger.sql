-- ============================================================================
-- FIX AUCTION SOURCE TRIGGER - Add more platforms
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
  url_to_check := COALESCE(NEW.discovery_url, NEW.listing_url, '');

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
      WHEN url_to_check ~* 'hagerty\.com' THEN 'Hagerty'
      WHEN url_to_check ~* 'barrett-jackson\.com' THEN 'Barrett-Jackson'
      WHEN url_to_check ~* 'bonhams\.com' THEN 'Bonhams'
      WHEN url_to_check ~* 'copart\.com' THEN 'Copart'
      WHEN url_to_check ~* 'iaai\.com' THEN 'IAAI'
      WHEN url_to_check <> '' THEN 'Unknown Source'
      ELSE 'User Submission'
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_set_auction_source IS
  'Automatically sets auction_source based on discovery_url/listing_url patterns. Updated 2026-01-23 with Hagerty, Barrett-Jackson, Bonhams, Copart, IAAI.';
