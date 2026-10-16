-- Disposable PG17 fixtures; reuse the sanctioned creator's actual contract (it builds organizations, write_receipts and
-- create_organization_batch). Contract for 20261018050000_market_source_org_logos.sql. Synthetic rows only; never production.
--   * a market whose organization is missing gets one, created once through create_organization_batch, with the site as
--     its key, no country and the type marketplace, and is linked; a market whose organization exists is linked to it;
--   * a market's recorded logo is a copy at nuke.ag of the asset the house publishes, and organizations.metadata.logo says
--     where the house published it (source_url), where it was found, how, when, which surface it needs and its width/height,
--     without dropping the row's other metadata; the wrong image Bring a Trailer, Mecum and Broad Arrow recorded is replaced
--     and named in metadata.logo.replaced;
--   * a market with no logo file on its own site (Craigslist) is linked and left without a logo, and a second
--     organization on the same site is not touched; PCarMarket keeps its link and has no logo;
--   * a name or site that does not match, a link to another organization, or a different logo already recorded makes the
--     whole block refuse and change nothing (the earlier rows roll back too);
--   * replay changes nothing.
\set ON_ERROR_STOP on
\ir test_create_organization_batch_contract.sql

ALTER TABLE public.organizations ADD COLUMN logo_url text, ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.observation_sources (
  slug text PRIMARY KEY, display_name text, category text,
  business_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL
);

INSERT INTO public.organizations (id, business_name, website, business_type, is_public, logo_url, metadata) VALUES
  ('eb426570-c8e7-43c3-a4f1-8807ed9e075c', 'Bonhams', 'https://www.bonhams.com', 'auction_house', true, NULL, '{}'),
  ('29d2afda-96dd-45e3-b649-620556bde874', 'Gooding & Company', 'https://goodingco.com', 'auction_house', true, NULL, '{}'),
  ('98a2e93e-b814-4fda-b48a-0bb5440b7d00', 'Gooding and Company', 'https://www.goodingco.com', 'auction_house', true,
   'https://www.goodingco.com/static/images/logo.png?v=3890a1d0e57d6f059cf3e97bb238a3f3', '{}'), -- gitleaks:allow (a public asset address, not a credential)
  ('3f8d4e4f-d9cb-41b5-9b3b-58ec2325ea37', 'RM Sotheby''s', 'https://rmsothebys.com', 'auction_house', true, NULL, '{}'),
  ('0daa5b15-5105-48f0-b6d5-68c71be8dcfb', 'Barn Finds', 'https://barnfinds.com', 'other', true, NULL,
   '{"org_intake":{"source":"barnfinds"}}'),
  ('6694c750-b216-47c8-a337-d36b4fb8e26b', 'Facebook Marketplace', 'https://www.facebook.com/marketplace', 'marketplace', true, NULL, '{}'),
  ('822cae29-f80e-4859-9c48-a1485a543152', 'Cars & Bids', 'https://carsandbids.com', 'auction_house', false, NULL, '{}'),
  ('624b7f80-c4c7-455d-8f0a-f7ae7ff67a42', 'Craigslist', 'https://craigslist.org', 'marketplace', true, NULL, '{}'),
  ('b91ea58b-9371-4937-9ebb-93c70ec5485e', 'craigslist, Inc.', 'https://craigslist.org', 'other', true,
   'https://www.craigslist.org/images/logo_purple_peace.png', '{}'),
  ('78ec3d7e-6365-48e3-8294-cee2c1e5b7f5', 'eBay Motors', 'https://www.ebay.com/motors', 'marketplace', true, NULL, '{}'),
  ('37b84b5e-ee28-410a-bea5-8d4851e39525', 'SBX Cars', 'https://www.sbxcars.com', 'dealer', false, NULL, '{}'),
  ('bb6253c0-cb83-4d1c-b95c-09c811064af7', 'Beverly Hills Car Club', 'https://www.beverlyhillscarclub.com', 'dealer', true,
   'https://www.beverlyhillscarclub.com/template/images/logo.png', '{}'),
  ('f7c80592-6725-448d-9b32-2abf3e011cf8', 'PCarMarket', 'https://www.pcarmarket.com', 'auction_house', true, NULL, '{}'),
  ('d2bd6370-11d1-4af0-8dd2-3de2c3899166', 'Bring a Trailer', 'https://bringatrailer.com', 'auction_house', true,
   'https://bringatrailer.com/wp-content/uploads/2026/01/Screenshot-2026-01-06-at-08-39-18-Welcome-to-Arizona-Car-Week-2026-17563.png', '{}'),
  ('d2f587a0-5993-4d2c-9032-0fb3dd94d995', 'Mecum Auctions', 'https://www.mecum.com', 'auction_house', true,
   'https://res.cloudinary.com/mecum/images/v1748467657/media/mecum-auctions-register-to-bid-auctioneer-2025/mecum-auctions-register-to-bid-auctioneer-2025.jpg?_i=AA', '{}'),
  ('bf7f8e55-4abc-45dc-aae0-1df86a9f365a', 'Broad Arrow Auctions', 'https://www.broadarrowauctions.com', 'auction_house', true,
   'https://dealeraccelerate-all.s3.amazonaws.com/bagauction/marketing_assets/597/broad-arrow-group-auction.jpg', '{}');
INSERT INTO public.observation_sources (slug, display_name, category, business_id) VALUES
  ('bonhams', 'Bonhams', 'auction', 'eb426570-c8e7-43c3-a4f1-8807ed9e075c'),
  ('gooding', 'Gooding & Company', 'auction', '29d2afda-96dd-45e3-b649-620556bde874'),
  ('rm-sothebys', 'RM Sotheby''s', 'auction', '3f8d4e4f-d9cb-41b5-9b3b-58ec2325ea37'),
  ('barnfinds', 'Barn Finds', 'marketplace', '0daa5b15-5105-48f0-b6d5-68c71be8dcfb'),
  ('facebook_marketplace', 'Facebook Marketplace', 'marketplace', '6694c750-b216-47c8-a337-d36b4fb8e26b'),
  ('pcarmarket', 'PCarMarket', 'auction', 'f7c80592-6725-448d-9b32-2abf3e011cf8'),
  ('bat', 'Bring a Trailer', 'auction', 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'),
  ('mecum', 'Mecum Auctions', 'auction', 'd2f587a0-5993-4d2c-9032-0fb3dd94d995'),
  ('broad-arrow', 'Broad Arrow Auctions', 'auction', 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a'),
  ('cars-and-bids', 'Cars & Bids', 'auction', NULL), ('craigslist', 'Craigslist', 'marketplace', NULL),
  ('ebay_motors', 'eBay Motors (Browse API)', 'marketplace', NULL), ('sbx-cars', 'SBX Cars', 'auction', NULL),
  ('beverlyhillscarclub', 'Beverly Hills Car Club', 'marketplace', NULL), ('ksl', 'KSL Cars', 'marketplace', NULL),
  ('motorious', 'Motorious', 'marketplace', NULL), ('classiccars-com', 'ClassicCars.com', 'marketplace', NULL);

CREATE TEMP TABLE before_all AS SELECT id, to_jsonb(o) AS org FROM public.organizations o;
CREATE TEMP TABLE before_sources AS SELECT slug, business_id FROM public.observation_sources;

-- A drifted name, a link to another organization, and a different logo already recorded each refuse the whole block,
-- and the rows it reached before refusing roll back. The migration runs with ON_ERROR_STOP off, so the failure does not
-- end this script.
UPDATE public.organizations SET business_name = 'SBX Cars Dealer' WHERE id = '37b84b5e-ee28-410a-bea5-8d4851e39525';
\set ON_ERROR_STOP off
\ir ../migrations/20261018050000_market_source_org_logos.sql
\set ON_ERROR_STOP on
UPDATE public.organizations SET business_name = 'SBX Cars' WHERE id = '37b84b5e-ee28-410a-bea5-8d4851e39525';
SELECT pg_temp.ok('a drifted organization name refuses the block and nothing changes',
  NOT EXISTS (SELECT 1 FROM before_sources b JOIN public.observation_sources s USING (slug) WHERE b.business_id IS DISTINCT FROM s.business_id)
  AND NOT EXISTS (SELECT 1 FROM before_all b JOIN public.organizations o USING (id) WHERE b.org <> to_jsonb(o))
  AND (SELECT count(*) FROM public.organizations) = (SELECT count(*) FROM before_all)
  AND (SELECT count(*) FROM public.observation_sources WHERE business_id IS NULL) = 8);

UPDATE public.observation_sources SET business_id = 'bb6253c0-cb83-4d1c-b95c-09c811064af7' WHERE slug = 'cars-and-bids';
\set ON_ERROR_STOP off
\ir ../migrations/20261018050000_market_source_org_logos.sql
\set ON_ERROR_STOP on
UPDATE public.observation_sources SET business_id = NULL WHERE slug = 'cars-and-bids';
SELECT pg_temp.ok('a market linked to another organization refuses the block and nothing changes',
  NOT EXISTS (SELECT 1 FROM before_sources b JOIN public.observation_sources s USING (slug) WHERE b.business_id IS DISTINCT FROM s.business_id)
  AND NOT EXISTS (SELECT 1 FROM before_all b JOIN public.organizations o USING (id) WHERE b.org <> to_jsonb(o)));

UPDATE public.organizations SET logo_url = 'https://example.test/other.png' WHERE id = '78ec3d7e-6365-48e3-8294-cee2c1e5b7f5';
\set ON_ERROR_STOP off
\ir ../migrations/20261018050000_market_source_org_logos.sql
\set ON_ERROR_STOP on
UPDATE public.organizations SET logo_url = NULL WHERE id = '78ec3d7e-6365-48e3-8294-cee2c1e5b7f5';
SELECT pg_temp.ok('a different logo already recorded refuses the block and nothing changes',
  NOT EXISTS (SELECT 1 FROM before_sources b JOIN public.observation_sources s USING (slug) WHERE b.business_id IS DISTINCT FROM s.business_id)
  AND NOT EXISTS (SELECT 1 FROM before_all b JOIN public.organizations o USING (id) WHERE b.org <> to_jsonb(o))
  AND (SELECT count(*) FROM public.organizations) = (SELECT count(*) FROM before_all));

-- The real run.
\ir ../migrations/20261018050000_market_source_org_logos.sql

SELECT pg_temp.ok('all thirteen markets are linked, and the three missing organizations were created',
  (SELECT count(*) FROM public.observation_sources WHERE business_id IS NOT NULL) = 17
  AND (SELECT count(*) FROM public.organizations) = (SELECT count(*) FROM before_all) + 3);
SELECT pg_temp.ok('each market links to the organization named for it',
  (SELECT count(*) FROM public.observation_sources s JOIN public.organizations o ON o.id = s.business_id
    WHERE (s.slug, o.business_name) IN (('bonhams','Bonhams'), ('gooding','Gooding & Company'), ('rm-sothebys','RM Sotheby''s'),
      ('barnfinds','Barn Finds'), ('facebook_marketplace','Facebook Marketplace'), ('cars-and-bids','Cars & Bids'),
      ('craigslist','Craigslist'), ('ebay_motors','eBay Motors'), ('sbx-cars','SBX Cars'),
      ('beverlyhillscarclub','Beverly Hills Car Club'), ('ksl','KSL Cars'), ('motorious','Motorious'),
      ('classiccars-com','ClassicCars.com'))) = 13);
SELECT pg_temp.ok('the three created organizations came through the sanctioned creator, once each, with no country and no owner',
  (SELECT count(*) FROM public.organizations o JOIN public.observation_sources s ON s.business_id = o.id
    WHERE (s.slug, o.website) IN (('ksl','https://cars.ksl.com'), ('motorious','https://motorious.com'), ('classiccars-com','https://classiccars.com'))
      AND o.discovered_via = 'declared-source:' || s.slug AND o.business_type = 'marketplace' AND o.country IS NULL
      AND o.is_public = false AND o.discovered_by IS NULL AND o.uploaded_by IS NULL) = 3
  AND (SELECT count(*) FROM public.organizations WHERE website IN ('https://cars.ksl.com','https://motorious.com','https://classiccars.com')) = 3);
SELECT pg_temp.ok('fifteen markets record a hosted copy of the logo their house publishes, with where, how and when it was found',
  (SELECT count(*) FROM public.observation_sources s JOIN public.organizations o ON o.id = s.business_id
    WHERE o.logo_url ~ '^https://nuke[.]ag/source-logos/[a-z0-9_-]+[.](png|svg)$'
      AND o.metadata->'logo'->>'asset_url' = o.logo_url AND (o.metadata->'logo'->>'hosted')::boolean
      AND o.metadata->'logo'->>'source_url' ~ '^https://' AND o.metadata->'logo'->>'found_on' ~ '^https://'
      AND length(o.metadata->'logo'->>'found_how') > 10
      AND o.metadata->'logo'->>'observed_at' = '2026-10-15' AND o.metadata->'logo'->>'method' = 'official-site-asset'
      AND o.metadata->'logo'->>'surface' IN ('light', 'dark', 'any') AND (o.metadata->'logo'->>'aspect')::numeric > 0
      AND s.slug IN ('bonhams','gooding','rm-sothebys','barnfinds','facebook_marketplace','cars-and-bids','ebay_motors',
                     'sbx-cars','beverlyhillscarclub','ksl','motorious','classiccars-com','bat','mecum','broad-arrow')) = 15);
SELECT pg_temp.ok('the hosted copy is named for the market, and the house''s own address is kept as its source',
  (SELECT logo_url FROM public.organizations WHERE id = 'eb426570-c8e7-43c3-a4f1-8807ed9e075c') = 'https://nuke.ag/source-logos/bonhams.png'
  AND (SELECT metadata->'logo'->>'source_url' FROM public.organizations WHERE id = 'eb426570-c8e7-43c3-a4f1-8807ed9e075c')
    = 'https://www.bonhams.com/web-assets/bonhams-logo-neue-world.png'
  AND (SELECT logo_url FROM public.organizations WHERE id = '3f8d4e4f-d9cb-41b5-9b3b-58ec2325ea37') = 'https://nuke.ag/source-logos/rm-sothebys.svg'
  AND (SELECT logo_url FROM public.organizations WHERE website = 'https://cars.ksl.com') = 'https://nuke.ag/source-logos/ksl.png'
  AND (SELECT metadata->'logo'->>'source_url' FROM public.organizations WHERE website = 'https://cars.ksl.com')
    = 'https://ctfassets.ksldigital.com/prnz0r0d2myc/3e3b8aAYx5ETWVPHXI5YdC/77ece66492affd0e81879a12c9df2c54/ksl-classifieds-app-icon.png' -- gitleaks:allow (a public asset address, not a credential)
  AND (SELECT logo_url FROM public.organizations WHERE id = 'bb6253c0-cb83-4d1c-b95c-09c811064af7') = 'https://nuke.ag/source-logos/beverlyhillscarclub.png');
SELECT pg_temp.ok('the wrong image Bring a Trailer, Mecum and Broad Arrow recorded is replaced, and the old address is kept',
  (SELECT count(*) FROM public.organizations o
    WHERE (o.id, o.logo_url) IN (('d2bd6370-11d1-4af0-8dd2-3de2c3899166', 'https://nuke.ag/source-logos/bat.png'),
                                 ('d2f587a0-5993-4d2c-9032-0fb3dd94d995', 'https://nuke.ag/source-logos/mecum.png'),
                                 ('bf7f8e55-4abc-45dc-aae0-1df86a9f365a', 'https://nuke.ag/source-logos/broad-arrow.png'))
      AND o.metadata->'logo'->>'replaced' IS NOT NULL AND o.metadata->'logo'->>'replaced' <> o.logo_url) = 3
  AND (SELECT metadata->'logo'->>'replaced' FROM public.organizations WHERE id = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166') ~ 'Arizona-Car-Week');
SELECT pg_temp.ok('a row''s other metadata is kept',
  (SELECT metadata->'org_intake'->>'source' FROM public.organizations WHERE id = '0daa5b15-5105-48f0-b6d5-68c71be8dcfb') = 'barnfinds');
SELECT pg_temp.ok('Craigslist is linked and has no logo, and the other organization on its site is not touched',
  (SELECT logo_url IS NULL AND NOT (metadata ? 'logo') FROM public.organizations WHERE id = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42')
  AND (SELECT business_id FROM public.observation_sources WHERE slug = 'craigslist') = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'
  AND NOT EXISTS (SELECT 1 FROM before_all b JOIN public.organizations o USING (id)
                   WHERE b.id = 'b91ea58b-9371-4937-9ebb-93c70ec5485e' AND b.org <> to_jsonb(o)));
SELECT pg_temp.ok('PCarMarket and the duplicate Gooding row are untouched, and PCarMarket has no logo',
  NOT EXISTS (SELECT 1 FROM before_all b JOIN public.organizations o USING (id)
               WHERE b.id IN ('f7c80592-6725-448d-9b32-2abf3e011cf8', '98a2e93e-b814-4fda-b48a-0bb5440b7d00') AND b.org <> to_jsonb(o))
  AND (SELECT logo_url IS NULL FROM public.organizations WHERE id = 'f7c80592-6725-448d-9b32-2abf3e011cf8'));

-- Replay changes nothing.
CREATE TEMP TABLE after_first AS SELECT id, to_jsonb(o) AS org FROM public.organizations o;
CREATE TEMP TABLE after_first_sources AS SELECT slug, business_id FROM public.observation_sources;
\ir ../migrations/20261018050000_market_source_org_logos.sql
SELECT pg_temp.ok('replay creates no organization and changes no row',
  (SELECT count(*) FROM public.organizations) = (SELECT count(*) FROM after_first)
  AND NOT EXISTS (SELECT 1 FROM after_first a JOIN public.organizations o USING (id) WHERE a.org <> to_jsonb(o))
  AND NOT EXISTS (SELECT 1 FROM after_first_sources a JOIN public.observation_sources s USING (slug) WHERE a.business_id IS DISTINCT FROM s.business_id));
DO $$ BEGIN RAISE NOTICE 'ALL CONTRACTS PASSED: market source organization logos'; END $$;
