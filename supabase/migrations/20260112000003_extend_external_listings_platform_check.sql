-- ============================================================================
-- Extend external_listings.platform CHECK to support more auction platforms
-- ============================================================================
-- We want external_listings to be the universal landing pad for *all* marketplaces/auctions.
-- This migration expands the allowed platform set without removing existing values.

DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  -- Drop existing constraint (name is stable in prod, but keep IF EXISTS for safety)
  ALTER TABLE public.external_listings
    DROP CONSTRAINT IF EXISTS external_listings_platform_check;

  -- Recreate with expanded set
  ALTER TABLE public.external_listings
    ADD CONSTRAINT external_listings_platform_check
    CHECK (
      platform = ANY (ARRAY[
        -- Auctions
        'bat'::text,
        'cars_and_bids'::text,
        'mecum'::text,
        'barrettjackson'::text,
        'russoandsteele'::text,
        'pcarmarket'::text,
        'sbx'::text,
        'bonhams'::text,
        'rmsothebys'::text,

        -- Classifieds / marketplaces
        'ebay_motors'::text,
        'facebook_marketplace'::text,
        'autotrader'::text,
        'hemmings'::text,
        'classic_com'::text,
        'craigslist'::text,
        'copart'::text,
        'iaai'::text
      ])
    );
END
$$;

