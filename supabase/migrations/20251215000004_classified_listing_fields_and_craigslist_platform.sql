-- Classified listing fields + Craigslist platform support
-- Goal:
-- 1) Store listing title/location/posted/updated on vehicles (for UI + age math)
-- 2) Allow craigslist rows in external_listings (so listing telemetry is queryable)
-- 3) Keep everything IF NOT EXISTS-safe for clean resets

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    -- Durable source listing fields (used by UI; missing in some environments)
    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_url TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_source TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_posted_at TIMESTAMPTZ;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_updated_at TIMESTAMPTZ;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_title TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS listing_location TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    -- Description provenance (used by VehicleDescriptionCard)
    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS description_source TEXT;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS description_generated_at TIMESTAMPTZ;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    -- Helpful indexes
    CREATE INDEX IF NOT EXISTS idx_vehicles_listing_url ON public.vehicles(listing_url);
    CREATE INDEX IF NOT EXISTS idx_vehicles_listing_posted_at ON public.vehicles(listing_posted_at);
  END IF;
END
$$;

-- Extend external_listings.platform to include craigslist (best-effort; constraint may be auto-named).
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
    EXECUTE 'ALTER TABLE public.external_listings DROP CONSTRAINT IF EXISTS external_listings_platform_check';
    EXECUTE 'ALTER TABLE public.external_listings DROP CONSTRAINT IF EXISTS external_listings_platform_check1';
  END IF;

  -- Recreate the constraint with all known platforms included.
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
        'craigslist'
      )
    );
END
$$;


