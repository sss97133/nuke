-- data(organizations): each market's own logo for the Sources board, and the source-to-organization links it needs.
-- Owner, 2026-10-15/16: the board shows every market's own small logo, drawn by OrgLogo from organizations.logo_url through
-- observation_sources.business_id (market_sources_read, 20261018033000). Of the 19 markets 14 had no logo: six
-- organizations existed without one, five existed without the link (Cars & Bids, Craigslist, eBay Motors, SBX Cars,
-- Beverly Hills Car Club) and three did not exist (KSL Cars, Motorious, ClassicCars.com). Three more recorded the wrong
-- image: Bring a Trailer a promo photo (Arizona Car Week 2026), Mecum a photo of its auctioneer, Broad Arrow a white
-- wordmark on a black social card (update-org-from-website and create-org-from-url read og:image by guess).
-- Writers: the three missing organizations come from create_organization_batch, the sanctioned creator (entity key only,
-- never a blind INSERT). Nothing else writes a reviewed logo (enrich_organization has no logo column), so the links and
-- logos are guarded UPDATEs here, the path the repo already uses for platform entities (observation_sources is
-- migration-owned in pipeline_registry; precedent 20261010164828_source_public_organization_profiles). Every row is
-- checked against the organization's recorded name and site first, and the whole block refuses on drift.
-- Each logo is an asset the house publishes itself, found on its own site on 2026-10-15 (a header image, its schema.org
-- logo, its declared icon or its app icon; Craigslist and PCarMarket publish no logo file and keep the type icon). It is
-- kept as a copy at nuke.ag/source-logos (margins trimmed, 48 px tall, 77 KB for 15): loading it from the house would put a
-- request to 15 other sites on every market page view, and Bonhams (Cross-Origin-Resource-Policy: same-origin) and Broad
-- Arrow (blocked by the browser's resource policy) refuse outside use. organizations.logo_url is the hosted copy;
-- organizations.metadata.logo keeps where the house published it (source_url), the page it was found on, how, when, the
-- surface it needs (a dark mark needs a light one) and its width/height, and what it replaced.
-- Linking a source also lets the legacy trigger sync_external_listing_to_organization_vehicles tag future external_listings
-- updates of that platform; that table has had no insert since 2026-04-14.
-- No testimony, queue state, source activation, RLS policy or grant changes. Replay changes nothing.
-- Contract: supabase/sql/test_market_source_org_logos.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $logos$
DECLARE
  c_writer constant text := 'migration:market_source_org_logos';
  v_prev_writer text := current_setting('app.writer', true);
  t record;
  v_org uuid;
  v_found integer;
  v_intake jsonb;
  v_hosted text;
BEGIN
  PERFORM set_config('app.writer', c_writer, true);

  FOR t IN SELECT * FROM (VALUES
    -- source slug, organization id (NULL: created below), recorded name, recorded site (host and path), type of a created row,
    -- the house's own asset, page it was found on, how, surface it needs, width/height of the hosted copy, logo to replace
    ('bonhams', 'eb426570-c8e7-43c3-a4f1-8807ed9e075c'::uuid, 'Bonhams', 'bonhams.com', NULL,
     'https://www.bonhams.com/web-assets/bonhams-logo-neue-world.png', 'https://www.bonhams.com/',
     'og:image on the home page; the header draws the same lettering as inline SVG', 'light', 3.48, NULL),
    ('gooding', '29d2afda-96dd-45e3-b649-620556bde874'::uuid, 'Gooding & Company', 'goodingco.com', NULL,
     'https://www.goodingco.com/images/logo-larg.png', 'https://www.goodingco.com/',
     'schema.org Organization logo (JSON-LD) on the home page; it reads Gooding & Company while the header now draws Gooding Christie''s as inline SVG with no hosted file', 'any', 2.25, NULL),
    ('rm-sothebys', '3f8d4e4f-d9cb-41b5-9b3b-58ec2325ea37'::uuid, 'RM Sotheby''s', 'rmsothebys.com', NULL,
     'https://rmsothebys.com/images/logo.svg', 'https://rmsothebys.com/',
     'print logo image on the home page', 'dark', 5.68, 'https://nuke.ag/source-logos/rm-sothebys.svg'),
    ('barnfinds', '0daa5b15-5105-48f0-b6d5-68c71be8dcfb'::uuid, 'Barn Finds', 'barnfinds.com', NULL,
     'https://barnfinds.com/wp-content/uploads/2020/03/FB-Logo.gif', 'https://barnfinds.com/',
     'schema.org Organization logo (JSON-LD) on the home page', 'any', 1.15, NULL),
    ('facebook_marketplace', '6694c750-b216-47c8-a337-d36b4fb8e26b'::uuid, 'Facebook Marketplace', 'facebook.com/marketplace', NULL,
     'https://www.facebook.com/images/fb_icon_325x325.png', 'https://www.facebook.com/marketplace/',
     'Facebook''s own icon at its standard path on facebook.com; Marketplace has no logo file of its own and its page serves only a favicon', 'any', 1.00, NULL),
    ('cars-and-bids', '822cae29-f80e-4859-9c48-a1485a543152'::uuid, 'Cars & Bids', 'carsandbids.com', NULL,
     'https://carsandbids.com/carsandbids.png', 'https://carsandbids.com/',
     'og:image on the home page: the wordmark on a black card; the header draws it from an image embedded in the stylesheet, so no hosted file', 'dark', 5.16, NULL),
    ('craigslist', '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid, 'Craigslist', 'craigslist.org', NULL,
     'https://www.craigslist.org/favicon.ico', 'https://www.craigslist.org/',
     'the site''s own purple peace-symbol icon at /favicon.ico on craigslist.org', 'any', 1.00, NULL),
    ('pcarmarket', 'f7c80592-6725-448d-9b32-2abf3e011cf8'::uuid, 'PCarMarket', 'pcarmarket.com', NULL,
     'https://www.pcarmarket.com/favicon.svg', 'https://www.pcarmarket.com/',
     'the site''s own wheel emblem and header wordmark on pcarmarket.com', 'dark', 3.84, NULL),
    ('barrett-jackson', '7a3d0d2a-c738-4d8a-a199-1a687aa6cdf4'::uuid, 'Barrett-Jackson', 'barrett-jackson.com', NULL,
     'https://www.barrett-jackson.com/_next/static/media/186BJ_Logo_Tag.46033550.svg', 'https://www.barrett-jackson.com/',
     'header logo image on the home page', 'any', 3.98, NULL),
    ('collecting-cars', '0d435048-f2c5-47ba-bba0-4c18c6d58686'::uuid, 'Collecting Cars', 'collectingcars.com', NULL,
     'https://collectingcars.com/images/logos/collecting-cars-logo.svg', 'https://collectingcars.com/',
     'header logo image on the home page', 'any', 1.13, NULL),
    ('ebay_motors', '78ec3d7e-6365-48e3-8294-cee2c1e5b7f5'::uuid, 'eBay Motors', 'ebay.com/motors', NULL,
     'https://ir.ebaystatic.com/cr/v/c1/ebay-logo-1-1200x630-margin.png', 'https://www.ebay.com/motors',
     'og:image on the eBay Motors page; eBay Motors has no logo of its own and its header draws the eBay logo', 'any', 2.46, NULL),
    ('sbx-cars', '37b84b5e-ee28-410a-bea5-8d4851e39525'::uuid, 'SBX Cars', 'sbxcars.com', NULL,
     'https://sbxcars.com/assets/images/logos/sbx-cars-sb-2024.svg', 'https://sbxcars.com/',
     'header logo image on the home page', 'dark', 2.75, 'https://nuke.ag/source-logos/sbx-cars.svg'),
    ('beverlyhillscarclub', 'bb6253c0-cb83-4d1c-b95c-09c811064af7'::uuid, 'Beverly Hills Car Club', 'beverlyhillscarclub.com', NULL,
     'https://www.beverlyhillscarclub.com/template/images/logo.png', 'https://www.beverlyhillscarclub.com/',
     'header logo image on the home page', 'light', 0.85, NULL),
    ('ksl', NULL::uuid, 'KSL Cars', 'cars.ksl.com', 'marketplace',
     'https://ctfassets.ksldigital.com/prnz0r0d2myc/3e3b8aAYx5ETWVPHXI5YdC/77ece66492affd0e81879a12c9df2c54/ksl-classifieds-app-icon.png', 'https://cars.ksl.com/', -- gitleaks:allow (a public asset address, not a credential)
     'KSL Classifieds app icon, an image KSL hosts and shows on the home page; the header mark is embedded in a script, so no hosted file', 'any', 1.00, NULL),
    ('motorious', NULL::uuid, 'Motorious', 'motorious.com', 'marketplace',
     'https://storage.ghost.io/c/62/cf/62cf4eaa-3504-4d7c-bf19-95873eb32115/content/images/2020/02/m-logo-black-and-ornage-1.png', 'https://www.motorious.com/',
     'schema.org Organization logo (JSON-LD) on the home page, hosted on the site''s Ghost storage', 'light', 6.35, NULL),
    ('classiccars-com', NULL::uuid, 'ClassicCars.com', 'classiccars.com', 'marketplace',
     'https://classiccars.com/img/logos/Classic-Cars-Home-of-Classic-and-Modern-Vehicles.png', 'https://classiccars.com/',
     'header logo image and schema.org Organization logo (JSON-LD) on the home page', 'any', 2.58, NULL),
    ('bat', 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'::uuid, 'Bring a Trailer', 'bringatrailer.com', NULL,
     'https://bringatrailer.com/wp-content/themes/bringatrailer/assets/img/google-chrome-icon-192x192.png', 'https://bringatrailer.com/',
     'the site''s own 192 x 192 icon, declared in the head of its home page (link rel=icon); the header draws the wordmark as inline SVG, so no hosted wordmark file', 'any', 1.56, 'https://bringatrailer.com/wp-content/uploads/2026/01/Screenshot-2026-01-06-at-08-39-18-Welcome-to-Arizona-Car-Week-2026-17563.png'),
    ('mecum', 'd2f587a0-5993-4d2c-9032-0fb3dd94d995'::uuid, 'Mecum Auctions', 'mecum.com', NULL,
     'https://upload.wikimedia.org/wikipedia/en/3/36/Mecum_Auctions_logo.png', 'https://www.mecum.com/',
     'schema.org Organization logo (JSON-LD) on the home page, an image Wikimedia hosts; the header draws the wordmark as inline SVG, so no hosted file on its own domain', 'any', 2.31, 'https://res.cloudinary.com/mecum/images/v1748467657/media/mecum-auctions-register-to-bid-auctioneer-2025/mecum-auctions-register-to-bid-auctioneer-2025.jpg?_i=AA'),
    ('broad-arrow', 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a'::uuid, 'Broad Arrow Auctions', 'broadarrowauctions.com', NULL,
     'https://www.broadarrowauctions.com/assets/bagauction/bagauction_logo_header_new_black-fba661911428a9879adf63e5b878a8a2.png', 'https://www.broadarrowauctions.com/', -- gitleaks:allow (a public asset address, not a credential)
     'the header wordmark, drawn as the CSS background of the company-logo link on the home page (a.header-baa-company-logo)', 'light', 4.94, 'https://dealeraccelerate-all.s3.amazonaws.com/bagauction/marketing_assets/597/broad-arrow-group-auction.jpg')
  ) AS x(slug, org_id, org_name, site, created_type, logo, found_on, how, surface, aspect, replaces)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.slug = t.slug) THEN
      RAISE EXCEPTION 'Market source missing: %', t.slug;
    END IF;

    v_org := t.org_id;
    IF v_org IS NULL THEN
      -- No organization was recorded for this market. One already on its site is used as it is (replay, or a row made
      -- elsewhere: the name check below refuses a different entity); two are ambiguous, so refuse rather than choose;
      -- none is created through the sanctioned creator, with the name and canonical site only.
      SELECT count(*) INTO v_found FROM public.organizations o
        WHERE lower(regexp_replace(rtrim(o.website, '/'), '^https?://(www[.])?', '')) = t.site;
      IF v_found > 1 THEN
        RAISE EXCEPTION 'Ambiguous organization for %', t.slug;
      ELSIF v_found = 0 THEN
        v_intake := public.create_organization_batch(
          jsonb_build_array(jsonb_build_object('business_name', t.org_name, 'website', 'https://' || t.site)), t.slug, false);
        IF (v_intake->>'created')::int <> 1 OR (v_intake->>'conflicts')::int <> 0
           OR (v_intake->>'skipped_no_key')::int <> 0 THEN
          RAISE EXCEPTION 'Organization intake refused: %', t.slug;
        END IF;
      END IF;
      SELECT o.id INTO STRICT v_org FROM public.organizations o
        WHERE lower(regexp_replace(rtrim(o.website, '/'), '^https?://(www[.])?', '')) = t.site;
      IF v_found = 0 THEN
        -- The creator defaults country to US and leaves the type empty; no location was observed, so the country stays
        -- unknown on a row created here, as for Barn Finds (20261010164828).
        UPDATE public.organizations SET country = NULL, business_type = t.created_type WHERE id = v_org;
      END IF;
    END IF;

    -- Refuse drift rather than attach a market to a different entity.
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org AND o.business_name = t.org_name
        AND lower(regexp_replace(rtrim(o.website, '/'), '^https?://(www[.])?', '')) = t.site) THEN
      RAISE EXCEPTION 'Market organization identity drift: %', t.slug;
    END IF;
    IF EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.slug = t.slug
        AND s.business_id IS NOT NULL AND s.business_id <> v_org) THEN
      RAISE EXCEPTION 'Market source already linked to another organization: %', t.slug;
    END IF;
    UPDATE public.observation_sources SET business_id = v_org WHERE slug = t.slug AND business_id IS NULL;

    IF t.logo IS NOT NULL THEN
      -- The logo is a high-res transparent PNG copy kept at nuke.ag (nuke_frontend/public/source-logos), so no visitor's
      -- browser calls the house's site and a house that refuses outside use (Bonhams and Broad Arrow do) still shows.
      v_hosted := 'https://nuke.ag/source-logos/' || t.slug || '.png';
      -- A logo already recorded is replaced only when it is the house's own address, this hosted copy, or the wrong image
      -- this migration names; anything else is not ours to replace.
      IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org
          AND o.logo_url IS NOT NULL AND o.logo_url NOT IN (t.logo, v_hosted) AND o.logo_url IS DISTINCT FROM t.replaces) THEN
        RAISE EXCEPTION 'Market logo already recorded: %', t.slug;
      END IF;
      UPDATE public.organizations o SET logo_url = v_hosted,
        metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('logo', jsonb_build_object(
          'asset_url', v_hosted, 'source_url', t.logo, 'hosted', true, 'found_on', t.found_on, 'found_how', t.how,
          'observed_at', '2026-10-15', 'method', 'official-site-asset', 'surface', t.surface, 'aspect', t.aspect)
          || CASE WHEN t.replaces IS NOT NULL THEN jsonb_build_object('replaced', t.replaces) ELSE '{}'::jsonb END),
        updated_at = now()
      WHERE o.id = v_org AND (o.logo_url IS DISTINCT FROM v_hosted OR NOT (coalesce(o.metadata, '{}'::jsonb) ? 'logo')
        OR (o.metadata->'logo'->>'aspect')::numeric IS DISTINCT FROM t.aspect);
    END IF;
  END LOOP;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
END
$logos$;

COMMIT;
