-- Add premium auction platforms (Mecum, Barrett-Jackson, Russo and Steele) to external_listings.platform CHECK constraint
-- These platforms are supported by extract-premium-auction but were missing from the constraint
DO $$
DECLARE
  c_name text;
BEGIN
  IF to_regclass('public.external_listings') IS NULL THEN
    RETURN;
  END IF;

  -- Find the platform check constraint name (it may be auto-named).
  SELECT con.conname INTO c_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'external_listings'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%platform%'
    AND pg_get_constraintdef(con.oid) ILIKE '%IN (%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.external_listings DROP CONSTRAINT IF EXISTS %I', c_name);
  ELSE
    -- Best-effort fallback: common auto-generated name
    EXECUTE 'ALTER TABLE public.external_listings DROP CONSTRAINT IF EXISTS external_listings_platform_check';
  END IF;

  -- Recreate the constraint with premium auction platforms included.
  ALTER TABLE public.external_listings
    ADD CONSTRAINT external_listings_platform_check
    CHECK (
      platform IN (
        'bat',
        'cars_and_bids',
        'ebay_motors',
        'hemmings',
        'autotrader',
        'facebook_marketplace',
        'classic_com',
        'craigslist',
        'mecum',
        'barrettjackson',
        'russoandsteele'
      )
    );
END
$$;

