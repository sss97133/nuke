-- Allow external_listings.organization_id to be NULL
-- Needed for public auction listings where we cannot reliably attribute a seller organization yet
-- (e.g. imported Bring a Trailer live auctions).
DO $$
BEGIN
  IF to_regclass('public.external_listings') IS NOT NULL THEN
    -- Drop NOT NULL to allow public listings without an org association.
    BEGIN
      ALTER TABLE public.external_listings
        ALTER COLUMN organization_id DROP NOT NULL;
    EXCEPTION
      WHEN undefined_column THEN
        -- Column missing in some environments; nothing to do.
        NULL;
    END;
  END IF;
END
$$;


