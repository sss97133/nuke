-- A Facebook listing's seller as a key, not a name. marketplace_listings.seller_name is display text (not unique, and a
-- private person's name); the seller's numeric Facebook id from the listing page's profile link is the identity, and
-- external_identities is the identity entity (data-machine.md: extend it, never mint a parallel one). Measured
-- 2026-10-19: 0 facebook rows in external_identities (697,279 bat); 513 listings already hold a numeric seller id in
-- contact_info or seller_profile_url; fb_marketplace_sellers (127 rows, idle since its collector stopped) is the older
-- parallel table and keeps its own fb_seller_id key untouched.
-- Writer: extract-facebook-marketplace (integrate.ts landSeller). The identity row carries no display name, because
-- external_identities is publicly readable and marketplace_listings is not.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS seller_identity_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_listings_seller_identity_id_fkey') THEN
    ALTER TABLE public.marketplace_listings
      ADD CONSTRAINT marketplace_listings_seller_identity_id_fkey
      FOREIGN KEY (seller_identity_id) REFERENCES public.external_identities(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$fk$;
-- Every row is NULL when the column is added, so validation reads nothing it can fail on.
ALTER TABLE public.marketplace_listings VALIDATE CONSTRAINT marketplace_listings_seller_identity_id_fkey;

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller_identity
  ON public.marketplace_listings (seller_identity_id) WHERE seller_identity_id IS NOT NULL;

COMMENT ON COLUMN public.marketplace_listings.seller_identity_id IS
  'The seller as an identity: external_identities row (platform ''facebook'', handle = the numeric Facebook user id read '
  'from the listing page''s Marketplace profile link, or an older collector''s contact_info.seller_fb_user_id). NULL when '
  'no profile link was captured; seller_name alone is never a key. Fill-only; writer extract-facebook-marketplace.';

COMMIT;
