-- ============================================================================
-- Extend external_listings.platform CHECK to include all auction platforms
-- ============================================================================
-- Adding: collecting_cars, broad_arrow, gooding

DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  -- Drop existing constraint
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
        'collecting_cars'::text,
        'broad_arrow'::text,
        'gooding'::text,

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
