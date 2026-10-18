-- Dealers & High-Volume Consignors on the Sources Board (2026-10-18)
--
-- 1. Classifies high-volume consignment dealers and direct dealers in `public.organizations` with
--    `entity_type = 'dealer'` and `business_type = 'dealer'` (and `GAA Classic Cars` as `auction_house`),
--    with canonical websites and hosted logos in `/source-logos/` where available.
-- 2. Registers and links direct dealers and high-volume consignment dealers in `public.observation_sources`
--    under `category = 'dealer'` (plus `gaa-classic-cars` under `category = 'auction'`), and reclassifies
--    `beverlyhillscarclub` from `'marketplace'` to `'dealer'`.
-- 3. Promotes `'dealer'` to the 3rd ranked section on the Sources board (`category IN ('auction', 'marketplace', 'dealer')`)
--    in `public.market_sources_read()`, `public.record_market_source_day()`, `public.record_market_source_hours()`, and
--    `public.market_source_landing_read()`:
--      - Combines direct landed lots (`mv_source_target_landed`), organization vehicle inventory (`organization_vehicles`),
--        and seller listing counts (`organization_seller_stats`).
--      - Computes dealer confirmed sales (`map_sales`, `map_usd`), 12-month sales (`sales_12m`, `usd_12m`,
--        `sales_prior_12m`, `usd_prior_12m`), and 24-month sparklines (`months`) from `mv_family_sales` and
--        sold dealer inventory (`organization_vehicles`).
--      - Surfaces active dealer inventory (`live_lots`, `live_at`) from `organization_seller_stats.active_listings`.
--      - Tracks hourly and daily dealer arrivals (`market_source_hours`) from both `vehicle_events` and
--        `organization_vehicles`.
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- Ensure minimal test DB has required columns/tables without locking production tables unnecessarily
DO $schema_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observation_sources' AND column_name = 'base_url'
  ) THEN
    ALTER TABLE public.observation_sources ADD COLUMN base_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observation_sources' AND column_name = 'decay_half_life_days'
  ) THEN
    ALTER TABLE public.observation_sources ADD COLUMN decay_half_life_days integer;
  END IF;

  IF to_regclass('public.organization_seller_stats') IS NULL THEN
    CREATE TABLE public.organization_seller_stats (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid UNIQUE NOT NULL,
      total_listings integer NOT NULL DEFAULT 0,
      total_sold integer NOT NULL DEFAULT 0,
      total_unsold integer NOT NULL DEFAULT 0,
      active_listings integer NOT NULL DEFAULT 0,
      total_gross_sales numeric,
      calculated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END
$schema_guard$;

-- 1. Production taxonomy, identity, and observation_sources registration
DO $taxonomy$
DECLARE
  v_prev_writer text := current_setting('app.writer', true);
BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    PERFORM set_config('app.writer', 'migration:market_sources_dealers', true);

    -- 1A. Fix organizations.entity_type, business_type, business_name, website, and logo_url for high-volume dealers
    UPDATE public.organizations o
       SET entity_type   = v.entity_type,
           business_type = v.business_type,
           business_name = coalesce(v.clean_name, o.business_name),
           website       = coalesce(v.website, nullif(o.website, '')),
           logo_url      = coalesce(v.logo_url, nullif(o.logo_url, '')),
           updated_at    = now()
      FROM (VALUES
        -- High-volume consignment dealers & brokers
        ('25937788-215a-4d3a-aca7-ea13fdfd9876'::uuid, 'dealer', 'dealer', 'Avant-Garde Collection', 'https://www.a-gc.com', 'https://nuke.ag/source-logos/avant-garde-collection.png'),
        ('13d2f0ca-2a4f-4cb7-b3b5-dc3db75f0b31'::uuid, 'dealer', 'dealer', 'Avant-Garde Collection', 'https://www.a-gc.com', 'https://nuke.ag/source-logos/avant-garde-collection.png'),
        ('6c5f451c-170f-41ab-9223-661ff084f0b6'::uuid, 'dealer', 'dealer', 'Avant-Garde Collection', 'https://www.a-gc.com', 'https://nuke.ag/source-logos/avant-garde-collection.png'),
        ('3e36cdee-4bba-4091-9779-4c14ccf975d4'::uuid, 'dealer', 'dealer', 'Wob', 'https://wobcars.com', NULL),
        ('758e46a9-6bdf-4db7-bd18-3aa3c2b874fd'::uuid, 'dealer', 'dealer', 'Wob Cars', 'https://wobcars.com', NULL),
        ('001416a3-09f5-4f14-8fa1-901eb2884138'::uuid, 'dealer', 'dealer', 'Collectible Classics', 'https://www.collectibleclassics.com', 'https://nuke.ag/source-logos/collectible-classics.png'),
        ('01336e9a-b286-450a-80b5-0b6b2aee4050'::uuid, 'dealer', 'dealer', 'Collectible Classics', 'https://www.collectibleclassics.com', 'https://nuke.ag/source-logos/collectible-classics.png'),
        ('1bd78d64-8ed9-486b-a6b9-a6cfda9e578e'::uuid, 'dealer', 'dealer', '1600veloce', 'https://www.1600veloce.com', 'https://nuke.ag/source-logos/1600veloce.png'),
        ('3f3d78f8-d165-4b06-97d3-7784da000bd4'::uuid, 'dealer', 'dealer', '1600veloce', 'https://www.1600veloce.com', 'https://nuke.ag/source-logos/1600veloce.png'),
        ('a4428b8e-96de-422f-9c93-ee1490e804b8'::uuid, 'dealer', 'dealer', 'Vantage Auto', 'https://www.vantageauto.com', 'https://nuke.ag/source-logos/vantage-auto.png'),
        ('7740e04e-278d-4ea3-94a3-b71441c24f1a'::uuid, 'dealer', 'dealer', 'Geneva Motor Cars', 'https://www.genevamotorcars.com', 'https://www.genevamotorcars.com/Dealer-Websites/Geneva-Motor-Cars-WI/images/logo.png'),
        ('2db3b4ae-d665-4b3d-873a-8134a79bea98'::uuid, 'dealer', 'dealer', 'Geneva Motor Cars', 'https://www.genevamotorcars.com', 'https://www.genevamotorcars.com/Dealer-Websites/Geneva-Motor-Cars-WI/images/logo.png'),
        ('934bdd98-268e-4873-a6b2-b372002b5ad1'::uuid, 'dealer', 'dealer', 'Geneva Motor Cars', 'https://www.genevamotorcars.com', 'https://www.genevamotorcars.com/Dealer-Websites/Geneva-Motor-Cars-WI/images/logo.png'),
        ('03108345-1e5e-41e4-8429-1c60efb2e265'::uuid, 'dealer', 'dealer', 'AEG Motorsports', 'https://www.aegmotorsports.com', 'https://nuke.ag/source-logos/aeg-motorsports.png'),
        ('df0fbe40-c2a9-42fe-a83c-b3267d7ae4df'::uuid, 'dealer', 'dealer', 'Michael''s Motor Cars', 'https://www.michaelsmotorcars.com', NULL),
        ('c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'dealer', 'dealer', 'Michael''s Motor Cars PA', 'https://www.michaelsmotorcars.com', NULL),
        ('335898bc-d660-4b27-a841-7d9388e66b3b'::uuid, 'dealer', 'dealer', 'Michael''s Motor Cars', 'https://www.michaelsmotorcars.com', NULL),
        ('0771329d-4912-401e-9001-7a1897171b4c'::uuid, 'dealer', 'dealer', 'Private Collection Motors', 'https://www.privatecollectionmotors.com', 'https://nuke.ag/source-logos/private-collection-motors.png'),
        ('12b82523-f75b-4741-8a02-2706230e4cfb'::uuid, 'dealer', 'dealer', 'Bullet Motorsports', 'https://www.bulletmotorsports.com', 'https://nuke.ag/source-logos/bullet-motorsports.png'),
        ('44f0d981-69bb-4dfc-8a6c-a01c3d8b05a1'::uuid, 'dealer', 'dealer', 'Bullet Motorsports', 'https://www.bulletmotorsports.com', 'https://nuke.ag/source-logos/bullet-motorsports.png'),
        ('1657102f-314d-4fab-9670-91681c274c73'::uuid, 'dealer', 'dealer', 'Bullet Motorsports', 'https://www.bulletmotorsports.com', 'https://nuke.ag/source-logos/bullet-motorsports.png'),
        ('98831922-9a81-4126-85bc-fada45622402'::uuid, 'dealer', 'dealer', 'Mohr Imports', 'https://www.mohrimports.com', 'https://nuke.ag/source-logos/mohr-imports.png'),
        ('91bd98d1-287e-4bfb-8591-12026a164805'::uuid, 'dealer', 'dealer', 'Mohr Imports', 'https://www.mohrimports.com', 'https://nuke.ag/source-logos/mohr-imports.png'),
        ('b0d446d5-b63c-493c-92b3-ce893a6edb9a'::uuid, 'dealer', 'dealer', 'Dean Laumbach', NULL, NULL),
        ('57296b09-4bbd-4d95-9050-05f5ba68ef86'::uuid, 'dealer', 'dealer', 'Silver Arrow Cars Ltd', 'https://silverarrowcars.com', NULL),
        ('0ecf2c28-cfc6-45a2-8925-a5e8da98bf10'::uuid, 'dealer', 'dealer', 'McQueens', 'https://www.mcqueenclassics.com', NULL),
        ('ded83585-bb4c-4076-8501-fd46b60d11b7'::uuid, 'dealer', 'dealer', 'McQueen Classics', 'https://www.mcqueenclassics.com', NULL),
        ('1383becb-ed93-4e24-b91d-99e7f925a9f8'::uuid, 'dealer', 'dealer', 'Fantasy Junction', 'https://www.fantasyjunction.com', 'https://nuke.ag/source-logos/fantasy-junction.png'),
        ('1d9122ea-1aaf-46ea-81ea-5f75cb259b69'::uuid, 'dealer', 'dealer', 'Fantasy Junction', 'https://www.fantasyjunction.com', 'https://nuke.ag/source-logos/fantasy-junction.png'),
        ('9e5b4895-75ad-4b57-b4e5-81853f16bb17'::uuid, 'dealer', 'dealer', 'Tactical Fleet', 'https://tacticalfleet.com', NULL),
        -- Direct-site dealers
        ('bb6253c0-cb83-4d1c-b95c-09c811064af7'::uuid, 'dealer', 'dealer', 'Beverly Hills Car Club', 'https://www.beverlyhillscarclub.com', 'https://nuke.ag/source-logos/beverlyhillscarclub.png'),
        ('39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid, 'dealer', 'dealer', 'L''Art de l''Automobile', 'https://www.lartdelautomobile.com', NULL),
        ('a2e9d8a9-ce2c-4f56-a30f-ba606325e6e6'::uuid, 'dealer', 'dealer', 'Streetside Classics', 'https://www.streetsideclassics.com', 'https://nuke.ag/source-logos/streetside-classics.png'),
        ('20e1d1e0-06b5-43b9-a994-7b5b9accb405'::uuid, 'dealer', 'dealer', 'Streetside Classics', 'https://www.streetsideclassics.com', 'https://nuke.ag/source-logos/streetside-classics.png'),
        ('40a98c8f-a6fe-478f-a9a6-864ae421f2f5'::uuid, 'dealer', 'dealer', 'Grand Prix Classics', 'https://www.grandprixclassics.com', 'https://nuke.ag/source-logos/grand-prix-classics.png'),
        ('8950c20f-aa86-410d-8705-692e9a73d29d'::uuid, 'dealer', 'dealer', 'Vanguard Motor Sales', 'https://www.vanguardmotorsales.com', 'https://nuke.ag/source-logos/vanguard-motor-sales.png'),
        ('cdb28fbb-0d1c-43e9-af06-81bbac2f301c'::uuid, 'dealer', 'dealer', 'Gateway Classic Cars', 'https://www.gatewayclassiccars.com', 'https://nuke.ag/source-logos/gateway-classic-cars.png'),
        ('69b08966-9df8-4c1b-9eab-4415271244a6'::uuid, 'dealer', 'dealer', 'Blue Chip Fleet', 'https://bluechipfleet.com', NULL),
        ('e08e7a9b-47bd-4030-b5eb-dc43a77ded73'::uuid, 'builder', 'builder', 'Velocity Restorations', 'https://velocityrestorations.com', 'https://nuke.ag/source-logos/velocity-restorations.png'),
        -- Additional active consignment dealers in organization_seller_stats
        ('88b0a268-ac57-4bde-92ba-ad14920ddbe0'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('b8e3479d-ab8c-4ae6-87ca-13dccb218eba'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('b30a2451-2c6c-4652-9ffd-2046a3abf722'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('29422ed2-541e-4ba3-a60b-2ed707b04bb9'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('dc369901-bf7b-4976-9397-51d006dccda8'::uuid, 'dealer', 'dealer', 'The Patina Group', 'https://www.sellwithtpg.com', NULL),
        ('a63044ac-c74c-4e10-8c38-a13c0f97ab6f'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('3e2e93ab-be02-47a5-9e96-37215a301aa4'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('d85b3a03-3067-4716-8f61-334b0b5c8637'::uuid, 'dealer', 'dealer', 'Exclusive Motor Club', 'https://www.exclusivemotorclub.com', NULL),
        ('a3b1e9dd-d911-40b1-b393-f61bc8b91626'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('061631f2-ed79-4bed-bbd4-ce2bcedb9ef8'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('c9f704e1-4250-46db-b8f4-d62f7833ff38'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('16a39ee4-4649-489c-91ca-bdba5b8e81fc'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('d16fd497-3968-41e1-8c17-2243d098c29a'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('34570f75-d916-4cf5-8eda-c95f75dca8f9'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('9784bbae-1690-48d8-964f-5828c08d79d6'::uuid, 'dealer', 'dealer', NULL, NULL, NULL),
        ('c3bbb232-a36d-4af3-b650-962052d98c3b'::uuid, 'dealer', 'dealer', 'Volo Auto Museum', 'https://www.volocars.com', NULL),
        ('b58252fa-bb1d-4372-8546-ec985534f3ba'::uuid, 'dealer', 'dealer', 'Advantage Auto Direct', 'https://advantageautodirect.com', NULL),
        -- GAA Classic Cars (Auction House)
        ('a2fc369e-004c-40f6-8faa-f6d46c5f88fd'::uuid, 'auction_house', 'auction_house', 'GAA Classic Cars', 'https://www.gaaclassiccars.com', 'https://nuke.ag/source-logos/gaa-classic-cars.png'),
        ('e0c18572-7848-4cd9-a2b4-d85c0590ef6e'::uuid, 'auction_house', 'auction_house', 'GAA Classic Cars', 'https://www.gaaclassiccars.com', 'https://nuke.ag/source-logos/gaa-classic-cars.png'),
        ('d23924ef-f84b-4363-96b5-79001f122498'::uuid, 'auction_house', 'auction_house', 'GAA Classic Cars', 'https://www.gaaclassiccars.com', 'https://nuke.ag/source-logos/gaa-classic-cars.png')
      ) AS v(org_id, entity_type, business_type, clean_name, website, logo_url)
     WHERE o.id = v.org_id;

    -- 1B. Reclassify existing observation_sources rows and link business_id
    UPDATE public.observation_sources
       SET category    = 'dealer',
           business_id = 'bb6253c0-cb83-4d1c-b95c-09c811064af7'::uuid,
           base_url    = coalesce(base_url, 'https://www.beverlyhillscarclub.com')
     WHERE slug = 'beverlyhillscarclub';

    UPDATE public.observation_sources
       SET category    = 'dealer',
           business_id = 'e08e7a9b-47bd-4030-b5eb-dc43a77ded73'::uuid,
           base_url    = coalesce(base_url, 'https://velocityrestorations.com')
     WHERE slug = 'velocity-restorations';

    UPDATE public.observation_sources
       SET business_id = '8950c20f-aa86-410d-8705-692e9a73d29d'::uuid
     WHERE slug = 'vanguard-motor-sales' AND business_id IS DISTINCT FROM '8950c20f-aa86-410d-8705-692e9a73d29d'::uuid;

    UPDATE public.observation_sources
       SET business_id = 'cdb28fbb-0d1c-43e9-af06-81bbac2f301c'::uuid
     WHERE slug = 'gateway-classic-cars' AND business_id IS DISTINCT FROM 'cdb28fbb-0d1c-43e9-af06-81bbac2f301c'::uuid;

    UPDATE public.observation_sources
       SET business_id = 'c3bbb232-a36d-4af3-b650-962052d98c3b'::uuid
     WHERE slug = 'volo-auto-museum' AND business_id IS NULL;

    -- 1C. Insert missing canonical observation_sources rows for dealers and GAA Classic Cars
    INSERT INTO public.observation_sources (slug, display_name, category, base_url, business_id)
    SELECT v.slug, v.display_name, v.category::public.source_category, v.base_url, v.business_id
      FROM (VALUES
        ('gaa-classic-cars',          'GAA Classic Cars',          'auction', 'https://www.gaaclassiccars.com',          'a2fc369e-004c-40f6-8faa-f6d46c5f88fd'::uuid),
        ('avant-garde-collection',    'Avant-Garde Collection',    'dealer',  'https://www.a-gc.com',                    '25937788-215a-4d3a-aca7-ea13fdfd9876'::uuid),
        ('wob',                       'Wob',                       'dealer',  'https://wobcars.com',                     '3e36cdee-4bba-4091-9779-4c14ccf975d4'::uuid),
        ('collectible-classics',      'Collectible Classics',      'dealer',  'https://www.collectibleclassics.com',     '001416a3-09f5-4f14-8fa1-901eb2884138'::uuid),
        ('1600veloce',                '1600veloce',                'dealer',  'https://www.1600veloce.com',              '1bd78d64-8ed9-486b-a6b9-a6cfda9e578e'::uuid),
        ('vantage-auto',              'Vantage Auto',              'dealer',  'https://www.vantageauto.com',             'a4428b8e-96de-422f-9c93-ee1490e804b8'::uuid),
        ('geneva-motorcars',          'Geneva Motor Cars',         'dealer',  'https://www.genevamotorcars.com',         '7740e04e-278d-4ea3-94a3-b71441c24f1a'::uuid),
        ('aeg-motorsports',           'AEG Motorsports',           'dealer',  'https://www.aegmotorsports.com',          '03108345-1e5e-41e4-8429-1c60efb2e265'::uuid),
        ('lart-de-lautomobile',       'L''Art de l''Automobile',   'dealer',  'https://www.lartdelautomobile.com',       '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid),
        ('michaels-motor-cars',       'Michael''s Motor Cars',     'dealer',  'https://www.michaelsmotorcars.com',       'df0fbe40-c2a9-42fe-a83c-b3267d7ae4df'::uuid),
        ('private-collection-motors', 'Private Collection Motors', 'dealer',  'https://www.privatecollectionmotors.com', '0771329d-4912-401e-9001-7a1897171b4c'::uuid),
        ('bullet-motorsports',        'Bullet Motorsports',        'dealer',  'https://www.bulletmotorsports.com',       '12b82523-f75b-4741-8a02-2706230e4cfb'::uuid),
        ('mohr-imports',              'Mohr Imports',              'dealer',  'https://www.mohrimports.com',             '98831922-9a81-4126-85bc-fada45622402'::uuid),
        ('dean-laumbach',             'Dean Laumbach',             'dealer',  NULL,                                      'b0d446d5-b63c-493c-92b3-ce893a6edb9a'::uuid),
        ('silver-arrow-cars',         'Silver Arrow Cars Ltd',     'dealer',  'https://silverarrowcars.com',             '57296b09-4bbd-4d95-9050-05f5ba68ef86'::uuid),
        ('mcqueens',                  'McQueens',                  'dealer',  'https://www.mcqueenclassics.com',         '0ecf2c28-cfc6-45a2-8925-a5e8da98bf10'::uuid),
        ('fantasy-junction',          'Fantasy Junction',          'dealer',  'https://www.fantasyjunction.com',         '1383becb-ed93-4e24-b91d-99e7f925a9f8'::uuid),
        ('tactical-fleet',            'Tactical Fleet',            'dealer',  'https://tacticalfleet.com',               '9e5b4895-75ad-4b57-b4e5-81853f16bb17'::uuid),
        ('blue-chip-fleet',           'Blue Chip Fleet',           'dealer',  'https://bluechipfleet.com',               '69b08966-9df8-4c1b-9eab-4415271244a6'::uuid)
      ) AS v(slug, display_name, category, base_url, business_id)
     WHERE NOT EXISTS (SELECT 1 FROM public.observation_sources o WHERE o.slug = v.slug);

    UPDATE public.observation_sources o
       SET display_name = v.display_name,
           category     = v.category::public.source_category,
           base_url     = coalesce(v.base_url, o.base_url),
           business_id  = coalesce(v.business_id, o.business_id)
      FROM (VALUES
        ('gaa-classic-cars',          'GAA Classic Cars',          'auction', 'https://www.gaaclassiccars.com',          'a2fc369e-004c-40f6-8faa-f6d46c5f88fd'::uuid),
        ('avant-garde-collection',    'Avant-Garde Collection',    'dealer',  'https://www.a-gc.com',                    '25937788-215a-4d3a-aca7-ea13fdfd9876'::uuid),
        ('wob',                       'Wob',                       'dealer',  'https://wobcars.com',                     '3e36cdee-4bba-4091-9779-4c14ccf975d4'::uuid),
        ('collectible-classics',      'Collectible Classics',      'dealer',  'https://www.collectibleclassics.com',     '001416a3-09f5-4f14-8fa1-901eb2884138'::uuid),
        ('1600veloce',                '1600veloce',                'dealer',  'https://www.1600veloce.com',              '1bd78d64-8ed9-486b-a6b9-a6cfda9e578e'::uuid),
        ('vantage-auto',              'Vantage Auto',              'dealer',  'https://www.vantageauto.com',             'a4428b8e-96de-422f-9c93-ee1490e804b8'::uuid),
        ('geneva-motorcars',          'Geneva Motor Cars',         'dealer',  'https://www.genevamotorcars.com',         '7740e04e-278d-4ea3-94a3-b71441c24f1a'::uuid),
        ('aeg-motorsports',           'AEG Motorsports',           'dealer',  'https://www.aegmotorsports.com',          '03108345-1e5e-41e4-8429-1c60efb2e265'::uuid),
        ('lart-de-lautomobile',       'L''Art de l''Automobile',   'dealer',  'https://www.lartdelautomobile.com',       '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid),
        ('michaels-motor-cars',       'Michael''s Motor Cars',     'dealer',  'https://www.michaelsmotorcars.com',       'df0fbe40-c2a9-42fe-a83c-b3267d7ae4df'::uuid),
        ('private-collection-motors', 'Private Collection Motors', 'dealer',  'https://www.privatecollectionmotors.com', '0771329d-4912-401e-9001-7a1897171b4c'::uuid),
        ('bullet-motorsports',        'Bullet Motorsports',        'dealer',  'https://www.bulletmotorsports.com',       '12b82523-f75b-4741-8a02-2706230e4cfb'::uuid),
        ('mohr-imports',              'Mohr Imports',              'dealer',  'https://www.mohrimports.com',             '98831922-9a81-4126-85bc-fada45622402'::uuid),
        ('dean-laumbach',             'Dean Laumbach',             'dealer',  NULL,                                      'b0d446d5-b63c-493c-92b3-ce893a6edb9a'::uuid),
        ('silver-arrow-cars',         'Silver Arrow Cars Ltd',     'dealer',  'https://silverarrowcars.com',             '57296b09-4bbd-4d95-9050-05f5ba68ef86'::uuid),
        ('mcqueens',                  'McQueens',                  'dealer',  'https://www.mcqueenclassics.com',         '0ecf2c28-cfc6-45a2-8925-a5e8da98bf10'::uuid),
        ('fantasy-junction',          'Fantasy Junction',          'dealer',  'https://www.fantasyjunction.com',         '1383becb-ed93-4e24-b91d-99e7f925a9f8'::uuid),
        ('tactical-fleet',            'Tactical Fleet',            'dealer',  'https://tacticalfleet.com',               '9e5b4895-75ad-4b57-b4e5-81853f16bb17'::uuid),
        ('blue-chip-fleet',           'Blue Chip Fleet',           'dealer',  'https://bluechipfleet.com',               '69b08966-9df8-4c1b-9eab-4415271244a6'::uuid)
      ) AS v(slug, display_name, category, base_url, business_id)
     WHERE o.slug = v.slug;

    -- 1D. Sync organization_seller_stats for direct-site dealers from organization_vehicles where missing
    IF to_regclass('public.organization_vehicles') IS NOT NULL THEN
      INSERT INTO public.organization_seller_stats (
        organization_id, total_listings, total_sold, total_unsold, active_listings, total_gross_sales,
        calculated_at, created_at, updated_at
      )
      SELECT ov.organization_id,
             count(*)::int,
             count(*) FILTER (WHERE ov.listing_status = 'sold')::int,
             0,
             count(*) FILTER (WHERE ov.listing_status = ANY (ARRAY['for_sale', 'new_arrival', 'consignment']))::int,
             sum(ov.sale_price) FILTER (WHERE ov.listing_status = 'sold' AND ov.sale_price > 0),
             now(), now(), now()
      FROM public.organization_vehicles ov
      WHERE ov.organization_id IN (
        'bb6253c0-cb83-4d1c-b95c-09c811064af7'::uuid,
        '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid
      )
      GROUP BY ov.organization_id
      ON CONFLICT (organization_id) DO UPDATE SET
        total_listings    = EXCLUDED.total_listings,
        total_sold        = EXCLUDED.total_sold,
        active_listings   = EXCLUDED.active_listings,
        total_gross_sales = coalesce(EXCLUDED.total_gross_sales, organization_seller_stats.total_gross_sales),
        calculated_at     = EXCLUDED.calculated_at,
        updated_at        = EXCLUDED.updated_at;
    END IF;

    PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  END IF;
END
$taxonomy$;

-- 2. Hourly landing writer: vehicle_events + dealer organization_vehicles arrivals (index-only scan)
CREATE OR REPLACE FUNCTION public.record_market_source_hours(p_hours integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_ov_rows integer := 0;
  v_from timestamptz := date_trunc('hour', now()) - make_interval(hours => least(greatest(coalesce(p_hours, 3), 1), 24 * 30) - 1);
BEGIN
  INSERT INTO public.market_source_hours (hour, source_key, records, recorded_at)
  SELECT date_trunc('hour', e.created_at),
         regexp_replace(regexp_replace(lower(e.source_platform), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g'),
         count(*),
         now()
  FROM public.vehicle_events e
  WHERE e.created_at >= v_from AND e.source_platform IS NOT NULL
  GROUP BY 1, 2
  ON CONFLICT (hour, source_key) DO UPDATE SET records = EXCLUDED.records, recorded_at = EXCLUDED.recorded_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF to_regclass('public.organization_vehicles') IS NOT NULL THEN
    EXECUTE $ov_hrs$
      WITH d_orgs AS (
        SELECT DISTINCT org_id, nslug
        FROM (
          SELECT o.business_id AS org_id,
                 regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') AS nslug
          FROM public.observation_sources o
          WHERE o.business_id IS NOT NULL
            AND o.category::text = 'dealer'
          UNION ALL
          SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
          WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
        ) x
        WHERE org_id IS NOT NULL AND nslug IS NOT NULL AND nslug <> ''
      ), ov_hr AS (
        SELECT d.nslug AS source_key,
               date_trunc('hour', ov.created_at) AS hour,
               count(*)::int AS records
        FROM d_orgs d
        CROSS JOIN LATERAL (
          SELECT ov.created_at
          FROM public.organization_vehicles ov
          WHERE ov.organization_id = d.org_id
            AND ov.created_at >= $1
        ) ov
        GROUP BY 1, 2
      )
      INSERT INTO public.market_source_hours (hour, source_key, records, recorded_at)
      SELECT hour, source_key, records, now()
      FROM ov_hr
      ON CONFLICT (hour, source_key) DO UPDATE
        SET records = GREATEST(market_source_hours.records, EXCLUDED.records),
            recorded_at = EXCLUDED.recorded_at
    $ov_hrs$ USING v_from;
    GET DIAGNOSTICS v_ov_rows = ROW_COUNT;
    v_rows := v_rows + v_ov_rows;
  END IF;

  RETURN v_rows;
END
$$;

COMMENT ON FUNCTION public.record_market_source_hours(integer) IS
  'Counts vehicle_events and dealer organization_vehicles rows landed per source per hour for the last p_hours hours '
  '(1 to 720), replacing those hours. Cron market-source-hours at :09; run once with 336 to fill 14 days. 2026-10-18.';
REVOKE ALL ON FUNCTION public.record_market_source_hours(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_hours(integer) TO service_role;

-- 3. Daily snapshot writer: combines mv_source_target_landed, dealer organization_vehicles (index-only scan),
--    organization_seller_stats, and dealer sales from mv_family_sales + sold dealer inventory.
CREATE OR REPLACE FUNCTION public.record_market_source_day()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_has_org_data boolean := (
    to_regclass('public.organization_vehicles') IS NOT NULL
    AND to_regclass('public.organization_seller_stats') IS NOT NULL
  );
  v_dealer_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_has_org_data THEN
    SELECT coalesce(array_agg(DISTINCT org_id), ARRAY[]::uuid[])
      INTO v_dealer_ids
      FROM (
        SELECT o.business_id AS org_id
        FROM public.observation_sources o
        WHERE o.business_id IS NOT NULL
          AND o.category::text IN ('dealer', 'shop')
        UNION
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid
        WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
      ) x
     WHERE org_id IS NOT NULL;

    INSERT INTO public.market_source_days (
      day, source_slug, display_name, category, house, landed_lots, landed_at,
      population, population_method, population_confidence, population_at,
      map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m, usd_prior_12m, months, recorded_at
    )
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             o.slug, o.display_name, o.category::text AS category,
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             public.market_venue_label(o.slug) AS house,
             o.business_id
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), (o.market_slug IS NOT NULL), o.created_at, o.slug
    ), d_orgs AS (
      SELECT DISTINCT org_id, nslug
      FROM (
        SELECT s.business_id AS org_id, s.nslug
        FROM src s
        WHERE s.business_id IS NOT NULL AND s.category IN ('dealer', 'shop')
        UNION ALL
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
        WHERE EXISTS (SELECT 1 FROM src WHERE nslug = 'michaelsmotorcars')
      ) x
      WHERE org_id IS NOT NULL
    ), pop_direct AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), c.census_at DESC
    ), lan AS (
      SELECT regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g') AS nslug,
             max(landed_lots) AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      GROUP BY 1
    ), ov_lan AS (
      SELECT d.nslug,
             sum(x.ov_rows)::bigint AS ov_rows,
             sum(x.ov_sold)::bigint AS ov_sold,
             max(x.ov_at) AS ov_at
      FROM d_orgs d
      CROSS JOIN LATERAL (
        SELECT count(*) AS ov_rows,
               count(*) FILTER (WHERE ov.listing_status = 'sold') AS ov_sold,
               max(ov.created_at) AS ov_at
        FROM public.organization_vehicles ov
        WHERE ov.organization_id = d.org_id
      ) x
      GROUP BY 1
    ), ss_lan AS (
      SELECT d.nslug,
             sum(ss.total_listings)::bigint AS total_listings,
             sum(ss.total_sold)::bigint AS total_sold,
             sum(ss.active_listings)::bigint AS active_listings,
             sum(ss.total_gross_sales)::numeric AS total_gross_sales,
             max(ss.calculated_at) AS calculated_at
      FROM d_orgs d
      JOIN public.organization_seller_stats ss ON ss.organization_id = d.org_id
      GROUP BY 1
    ), dv AS MATERIALIZED (
      SELECT DISTINCT ov.organization_id, ov.vehicle_id
      FROM public.organization_vehicles ov
      WHERE ov.organization_id = ANY(v_dealer_ids)
    ), dfam_raw AS MATERIALIZED (
      SELECT d.nslug,
             fs.vehicle_id,
             fs.sale_date,
             fs.usd::numeric AS usd
      FROM dv
      JOIN d_orgs d ON d.org_id = dv.organization_id
      JOIN public.mv_family_sales fs ON fs.vehicle_id = dv.vehicle_id
      WHERE fs.usd > 0 AND fs.sale_date <= current_date
    ), dov_sold_raw AS (
      SELECT d.nslug,
             coalesce(ov.sale_date, ov.created_at::date) AS sale_date,
             coalesce(ov.sale_price, 0)::numeric AS usd
      FROM d_orgs d
      CROSS JOIN LATERAL (
        SELECT ov.sale_date, ov.created_at, ov.sale_price
        FROM public.organization_vehicles ov
        WHERE ov.organization_id = d.org_id
          AND ov.listing_status = 'sold'
      ) ov
      WHERE d.nslug IN ('beverlyhillscarclub', 'lartdelautomobile')
    ), d_all_sales AS (
      SELECT nslug, sale_date, usd FROM dfam_raw
      UNION ALL
      SELECT nslug, sale_date, usd FROM dov_sold_raw
    ), dfam AS (
      SELECT nslug,
             count(*)::bigint AS map_sales,
             nullif(sum(usd) FILTER (WHERE usd > 0), 0) AS map_usd,
             count(*) FILTER (WHERE sale_date > current_date - 365)::bigint AS sales_12m,
             nullif(sum(usd) FILTER (WHERE sale_date > current_date - 365 AND usd > 0), 0) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365)::bigint AS sales_prior_12m,
             nullif(sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365 AND usd > 0), 0) AS usd_prior_12m
      FROM d_all_sales
      WHERE sale_date IS NOT NULL AND sale_date <= current_date
      GROUP BY 1
    ), dmon AS (
      SELECT nslug,
             jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, coalesce(u, 0)) ORDER BY m) AS months
      FROM (
        SELECT nslug,
               date_trunc('month', sale_date)::date AS m,
               count(*) AS n,
               sum(usd) FILTER (WHERE usd > 0) AS u
        FROM d_all_sales
        WHERE sale_date IS NOT NULL
          AND sale_date <= current_date
          AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
        GROUP BY 1, 2
      ) x
      GROUP BY 1
    ), mapq AS (
      SELECT source_name AS house,
             count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sales,
             sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS usd
      FROM public.mv_treemap_outcomes
      WHERE source_name IS NOT NULL
      GROUP BY 1
    ), fam AS (
      SELECT source AS house,
             count(*) FILTER (WHERE sale_date > current_date - 365) AS sales_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 365) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sales_prior_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS usd_prior_12m
      FROM public.mv_family_sales
      WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
      GROUP BY 1
    ), mon AS (
      SELECT house, jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, u) ORDER BY m) AS months
      FROM (SELECT source AS house, date_trunc('month', sale_date)::date AS m, count(*) AS n, sum(usd) AS u
            FROM public.mv_family_sales
            WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
              AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
            GROUP BY 1, 2) x
      GROUP BY 1
    ), combined AS (
      SELECT s.slug,
             s.display_name,
             s.category,
             s.house,
             s.nslug,
             CASE
               WHEN coalesce(l.landed_lots, 0) >= 500 THEN l.landed_lots
               ELSE nullif(GREATEST(coalesce(l.landed_lots, 0), coalesce(ov.ov_rows, 0), coalesce(ss.total_listings, 0)), 0)
             END AS eff_landed_lots,
             coalesce(l.landed_at, ss.calculated_at, ov.ov_at) AS eff_landed_at,
             nullif(GREATEST(coalesce(mq.sales, 0), coalesce(df.map_sales, 0), coalesce(ss.total_sold, 0), coalesce(ov.ov_sold, 0)), 0) AS eff_map_sales,
             coalesce(mq.usd, df.map_usd, nullif(ss.total_gross_sales, 0)) AS eff_map_usd,
             coalesce(f.sales_12m, df.sales_12m) AS eff_sales_12m,
             coalesce(f.usd_12m, df.usd_12m) AS eff_usd_12m,
             coalesce(f.sales_prior_12m, df.sales_prior_12m) AS eff_sales_prior_12m,
             coalesce(f.usd_prior_12m, df.usd_prior_12m) AS eff_usd_prior_12m,
             coalesce(mo.months, dm.months) AS eff_months
      FROM src s
      LEFT JOIN lan l ON l.nslug = s.nslug
      LEFT JOIN ov_lan ov ON ov.nslug = s.nslug
      LEFT JOIN ss_lan ss ON ss.nslug = s.nslug
      LEFT JOIN dfam df ON df.nslug = s.nslug
      LEFT JOIN dmon dm ON dm.nslug = s.nslug
      LEFT JOIN mapq mq ON mq.house = s.house
      LEFT JOIN fam f ON f.house = s.house
      LEFT JOIN mon mo ON mo.house = s.house
    )
    SELECT current_date,
           c.slug,
           c.display_name,
           c.category,
           c.house,
           c.eff_landed_lots,
           c.eff_landed_at,
           CASE WHEN pd.universe_total >= coalesce(c.eff_landed_lots, 0) THEN pd.universe_total ELSE NULL END,
           CASE WHEN pd.universe_total >= coalesce(c.eff_landed_lots, 0) THEN pd.census_method ELSE NULL END,
           CASE WHEN pd.universe_total >= coalesce(c.eff_landed_lots, 0) THEN pd.census_confidence::numeric ELSE NULL END,
           CASE WHEN pd.universe_total >= coalesce(c.eff_landed_lots, 0) THEN pd.census_at ELSE NULL END,
           c.eff_map_sales,
           c.eff_map_usd,
           c.eff_sales_12m,
           c.eff_usd_12m,
           c.eff_sales_prior_12m,
           c.eff_usd_prior_12m,
           c.eff_months,
           now()
    FROM combined c
    LEFT JOIN pop_direct pd ON pd.nslug = c.nslug
    WHERE coalesce(c.eff_landed_lots, 0) > 0 OR coalesce(c.eff_map_sales, 0) > 0 OR coalesce(c.eff_sales_12m, 0) > 0
    ON CONFLICT (day, source_slug) DO UPDATE SET
      display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
      landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
      population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
      population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
      sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
  ELSE
    -- Standard / disposable contract test path
    INSERT INTO public.market_source_days (
      day, source_slug, display_name, category, house, landed_lots, landed_at,
      population, population_method, population_confidence, population_at,
      map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m, usd_prior_12m, months, recorded_at
    )
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             o.slug, o.display_name, o.category::text AS category,
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             public.market_venue_label(o.slug) AS house
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), o.created_at, o.slug
    ), pop AS (
      SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
             regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), c.census_at DESC
    ), lan AS (
      SELECT regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g') AS nslug,
             max(landed_lots) AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      GROUP BY 1
    ), mapq AS (
      SELECT source_name AS house,
             count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sales,
             sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS usd
      FROM public.mv_treemap_outcomes
      WHERE source_name IS NOT NULL
      GROUP BY 1
    ), fam AS (
      SELECT source AS house,
             count(*) FILTER (WHERE sale_date > current_date - 365) AS sales_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 365) AS usd_12m,
             count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sales_prior_12m,
             sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS usd_prior_12m
      FROM public.mv_family_sales
      WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
      GROUP BY 1
    ), mon AS (
      SELECT house, jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, u) ORDER BY m) AS months
      FROM (SELECT source AS house, date_trunc('month', sale_date)::date AS m, count(*) AS n, sum(usd) AS u
            FROM public.mv_family_sales
            WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
              AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
            GROUP BY 1, 2) x
      GROUP BY 1
    )
    SELECT current_date, s.slug, s.display_name, s.category, s.house, l.landed_lots, l.landed_at,
           p.universe_total, p.census_method, p.census_confidence, p.census_at, nullif(mq.sales, 0), mq.usd, f.sales_12m, f.usd_12m,
           f.sales_prior_12m, f.usd_prior_12m, mo.months, now()
    FROM src s
    LEFT JOIN lan l USING (nslug)
    LEFT JOIN pop p USING (nslug)
    LEFT JOIN mapq mq ON mq.house = s.house
    LEFT JOIN fam f ON f.house = s.house
    LEFT JOIN mon mo ON mo.house = s.house
    WHERE coalesce(l.landed_lots, 0) > 0 OR coalesce(mq.sales, 0) > 0 OR coalesce(f.sales_12m, 0) > 0
    ON CONFLICT (day, source_slug) DO UPDATE SET
      display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
      landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
      population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
      population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
      sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
  END IF;
END
$$;

COMMENT ON FUNCTION public.record_market_source_day() IS
  'Writes today''s market_source_days row for every declared source holding data (held lots/listings/vehicles, whole-source '
  'or modeled pool-depth population, map sales, sales by sale date, and 24-month sparkline across auction houses, '
  'marketplaces, and dealers); a second call the same day replaces that day''s rows. Cron market-source-days, 10:47Z. '
  '2026-10-18.';
REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

-- 4. Board reader: pure SQL STABLE function ranking auction houses, marketplaces, and dealers
CREATE OR REPLACE FUNCTION public.market_sources_read()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    SELECT max(day) AS day FROM public.market_source_days
  ), cur AS (
    SELECT m.*, o.market_slug, regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') AS nslug,
           b.logo_url AS org_logo_url, b.business_type AS org_business_type
    FROM public.market_source_days m
    JOIN d ON m.day = d.day
    LEFT JOIN public.observation_sources o ON o.slug = m.source_slug
    LEFT JOIN public.organizations b ON b.id = o.business_id
  ), ranked AS (
    SELECT * FROM cur WHERE market_slug IS NULL AND category IN ('auction', 'marketplace', 'dealer')
  ), key_map AS (
    SELECT DISTINCT raw_key, canon_key
    FROM (
      SELECT nslug AS raw_key, nslug AS canon_key FROM ranked
      UNION ALL
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'),
             regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g')
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL
      UNION ALL
      SELECT 'classiccars', 'classiccarscom'
      UNION ALL
      SELECT 'bringatrailer', 'bat'
      UNION ALL
      SELECT 'hagerty', 'hagertymarketplace'
      UNION ALL
      SELECT 'wwwvanguardmotorsalescom', 'vanguardmotorsales'
      UNION ALL
      SELECT 'wwwgatewayclassiccarscom', 'gatewayclassiccars'
      UNION ALL
      SELECT 'wwwvelocityrestorationscom', 'velocityrestorations'
    ) km
  ), ago AS (
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots
    FROM public.market_source_days m CROSS JOIN d
    WHERE m.day <= d.day - 7
    ORDER BY m.source_slug, m.day DESC
  ), live AS (
    SELECT regexp_replace(lower(s.slug), '[^a-z0-9]', '', 'g') AS nslug,
           count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.updated_at > now() - interval '24 hours')
             AS live_lots,
           max(m.updated_at) FILTER (WHERE m.is_live AND m.auction_end_time > now()) AS live_at
    FROM public.live_auction_sources s
    JOIN public.monitored_auctions m ON m.source_id = s.id
    GROUP BY 1
  ), dealer_live AS (
    SELECT d_orgs.nslug,
           sum(ss.active_listings)::int AS live_lots,
           max(ss.calculated_at) AS live_at
    FROM (
      SELECT DISTINCT org_id, nslug
      FROM (
        SELECT o.business_id AS org_id,
               regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') AS nslug
        FROM public.observation_sources o
        WHERE o.business_id IS NOT NULL
          AND o.category::text = 'dealer'
        UNION ALL
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
        WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
      ) x
      WHERE org_id IS NOT NULL
    ) d_orgs
    JOIN public.organization_seller_stats ss ON ss.organization_id = d_orgs.org_id
    WHERE ss.active_listings > 0
    GROUP BY 1
  ), recent_ev AS (
    SELECT coalesce(km.canon_key, raw.raw_key) AS nslug,
           raw.created_at,
           date_trunc('hour', raw.created_at) AS hour,
           to_timestamp(floor(extract(epoch from raw.created_at) / 300) * 300) AS b5
    FROM (
      SELECT regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') AS raw_key,
             e.created_at
      FROM public.vehicle_events e
      WHERE e.created_at >= date_trunc('hour', now()) - interval '1 hour'
        AND e.source_platform IS NOT NULL
    ) raw
    LEFT JOIN key_map km ON km.raw_key = raw.raw_key
  ), live_hr_counts AS (
    SELECT nslug, hour, count(*)::int AS records, max(created_at) AS last_at
    FROM recent_ev
    GROUP BY 1, 2
  ), live_win AS (
    SELECT nslug,
           count(*) FILTER (WHERE created_at >= now() - interval '1 hour')::int AS landed_1h,
           count(*) FILTER (WHERE created_at >= now() - interval '15 minutes')::int AS landed_15m,
           max(created_at) AS last_at
    FROM recent_ev
    GROUP BY 1
  ), hist_norm AS (
    SELECT coalesce(km.canon_key, h.source_key) AS nslug,
           h.hour,
           sum(h.records)::int AS records
    FROM public.market_source_hours h
    LEFT JOIN key_map km ON km.raw_key = h.source_key
    WHERE h.hour >= date_trunc('day', now()) - interval '13 days'
    GROUP BY 1, 2
  ), hrs_merged AS (
    SELECT coalesce(h.nslug, l.nslug) AS nslug,
           coalesce(h.hour, l.hour) AS hour,
           GREATEST(coalesce(h.records, 0), coalesce(l.records, 0))::int AS records
    FROM hist_norm h
    FULL JOIN live_hr_counts l ON l.nslug = h.nslug AND l.hour = h.hour
  ), hrs AS (
    SELECT h.nslug,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '23 hours')::int AS landed_24h,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '167 hours')::int AS landed_7d,
           max(h.hour) FILTER (WHERE h.records > 0) AS last_hour
    FROM hrs_merged h
    GROUP BY 1
  ), days AS (
    SELECT k.nslug, jsonb_agg(coalesce(x.n, 0) ORDER BY k.day) AS days14
    FROM (SELECT DISTINCT nslug, gs::date AS day
          FROM hrs_merged,
               generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs) k
    LEFT JOIN (SELECT nslug, hour::date AS day, sum(records)::int AS n
               FROM hrs_merged
               GROUP BY 1, 2) x USING (nslug, day)
    GROUP BY 1
  ), last_ever AS (
    SELECT coalesce(km.canon_key, h.source_key) AS nslug,
           max(h.hour) AS last_hour
    FROM public.market_source_hours h
    LEFT JOIN key_map km ON km.raw_key = h.source_key
    WHERE h.records > 0
    GROUP BY 1
  ), h24_grid AS (
    SELECT gs AS hour, ord
    FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') WITH ORDINALITY AS t(gs, ord)
  ), hrs24_by_src AS (
    SELECT s.nslug,
           jsonb_agg(coalesce(hm.records, 0) ORDER BY g.ord) AS hours24
    FROM (SELECT DISTINCT nslug FROM ranked) s
    CROSS JOIN h24_grid g
    LEFT JOIN hrs_merged hm ON hm.nslug = s.nslug AND hm.hour = g.hour
    GROUP BY 1
  ), hrs24_total AS (
    SELECT coalesce(jsonb_agg(coalesce(x.n, 0) ORDER BY g.ord), '[]'::jsonb) AS hours24
    FROM h24_grid g
    LEFT JOIN (
      SELECT hm.hour, sum(hm.records)::int AS n
      FROM hrs_merged hm
      JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)
      WHERE hm.hour >= date_trunc('hour', now()) - interval '23 hours'
      GROUP BY 1
    ) x ON x.hour = g.hour
  ), b5_grid AS (
    SELECT gs AS b5, ord
    FROM generate_series(
      to_timestamp(floor(extract(epoch from now()) / 300) * 300) - interval '55 minutes',
      to_timestamp(floor(extract(epoch from now()) / 300) * 300),
      interval '5 minutes'
    ) WITH ORDINALITY AS t(gs, ord)
  ), b5_counts AS (
    SELECT nslug, b5, count(*)::int AS n
    FROM recent_ev
    WHERE b5 >= to_timestamp(floor(extract(epoch from now()) / 300) * 300) - interval '55 minutes'
    GROUP BY 1, 2
  ), mins60_by_src AS (
    SELECT s.nslug,
           jsonb_agg(coalesce(bc.n, 0) ORDER BY g.ord) AS mins60
    FROM (SELECT DISTINCT nslug FROM ranked) s
    CROSS JOIN b5_grid g
    LEFT JOIN b5_counts bc ON bc.nslug = s.nslug AND bc.b5 = g.b5
    GROUP BY 1
  ), mins60_total AS (
    SELECT coalesce(jsonb_agg(coalesce(x.n, 0) ORDER BY g.ord), '[]'::jsonb) AS mins60
    FROM b5_grid g
    LEFT JOIN (
      SELECT bc.b5, sum(bc.n)::int AS n
      FROM b5_counts bc
      JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)
      GROUP BY 1
    ) x ON x.b5 = g.b5
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'day', (SELECT day FROM d),
    'columns', jsonb_build_array('source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population',
                                 'population_method', 'population_confidence', 'population_at', 'map_sales', 'map_usd',
                                 'sales_12m', 'usd_12m', 'sales_prior_12m', 'usd_prior_12m', 'months', 'live_lots', 'live_at',
                                 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d', 'last_landed', 'days14',
                                 'logo_url', 'business_type'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months,
                                         coalesce(l.live_lots, dl.live_lots, 0),
                                         coalesce(l.live_at, dl.live_at),
                                         a.landed_lots, a.day,
                                         coalesce(h.landed_24h, 0), coalesce(h.landed_7d, 0),
                                         coalesce(h.last_hour, le.last_hour), coalesce(dd.days14, '[]'::jsonb),
                                         c.org_logo_url, c.org_business_type)
                       ORDER BY CASE c.category WHEN 'auction' THEN 1 WHEN 'marketplace' THEN 2 WHEN 'dealer' THEN 3 ELSE 4 END,
                                c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST, c.source_slug)
      FROM ranked c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = c.nslug
      LEFT JOIN dealer_live dl ON dl.nslug = c.nslug
      LEFT JOIN hrs h ON h.nslug = c.nslug
      LEFT JOIN days dd ON dd.nslug = c.nslug
      LEFT JOIN last_ever le ON le.nslug = c.nslug), '[]'::jsonb),
    'not_ranked', coalesce((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market_slug IS NOT NULL THEN 'capture channels' ELSE coalesce(category, 'uncategorized') END AS k,
               count(*) AS n
        FROM cur WHERE NOT (market_slug IS NULL AND category IN ('auction', 'marketplace', 'dealer'))
        GROUP BY 1) x), '{}'::jsonb),
    'landing', jsonb_build_object(
      'hour', date_trunc('hour', now()),
      'bucket_5m', to_timestamp(floor(extract(epoch from now()) / 300) * 300),
      'totals', jsonb_build_object(
        'landed_15m', coalesce((SELECT sum(w.landed_15m)::int FROM live_win w JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)), 0),
        'landed_1h', coalesce((SELECT sum(w.landed_1h)::int FROM live_win w JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)), 0),
        'landed_24h', coalesce((SELECT sum(h.landed_24h)::int FROM hrs h JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)), 0),
        'landed_7d', coalesce((SELECT sum(h.landed_7d)::int FROM hrs h JOIN (SELECT DISTINCT nslug FROM ranked) r USING (nslug)), 0),
        'hours24', (SELECT hours24 FROM hrs24_total),
        'mins60', (SELECT mins60 FROM mins60_total)
      ),
      'sources', coalesce((
        SELECT jsonb_object_agg(
          c.source_slug,
          jsonb_build_object(
            'landed_15m', coalesce(w.landed_15m, 0),
            'landed_1h', coalesce(w.landed_1h, 0),
            'landed_24h', coalesce(h.landed_24h, 0),
            'landed_7d', coalesce(h.landed_7d, 0),
            'last_at', coalesce(w.last_at, h.last_hour, le.last_hour),
            'hours24', coalesce(h24.hours24, '[]'::jsonb),
            'mins60', coalesce(m60.mins60, '[]'::jsonb)
          )
        )
        FROM ranked c
        LEFT JOIN hrs h ON h.nslug = c.nslug
        LEFT JOIN live_win w ON w.nslug = c.nslug
        LEFT JOIN last_ever le ON le.nslug = c.nslug
        LEFT JOIN hrs24_by_src h24 ON h24.nslug = c.nslug
        LEFT JOIN mins60_by_src m60 ON m60.nslug = c.nslug
      ), '{}'::jsonb)
    )
  );
$$;

COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: auction houses, marketplaces, and dealers, each ranked by lots, listings, or vehicles held, with '
  'held counts and when, census/estimated pool total, map sales, sales by sale date, live lots/inventory now, held counts '
  'a week earlier, records landed in the last 24 h and 7 days with 14 daily counts, organization logo and type, and live '
  'hourly/5-minute landing telemetry under "landing"; other categories counted in not_ranked. Anon. 2026-10-18.';

REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;

-- 5. Enhance market_source_landing_read to also surface recent dealer organization_vehicles when a dealer is inspected
CREATE OR REPLACE FUNCTION public.market_source_landing_read(
  p_source text DEFAULT NULL,
  p_hour timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_source text := nullif(trim(coalesce(p_source, '')), '');
  v_nslug text := CASE WHEN v_clean_source IS NOT NULL THEN regexp_replace(lower(v_clean_source), '[^a-z0-9]', '', 'g') ELSE NULL END;
  v_target_hour timestamptz := CASE WHEN p_hour IS NOT NULL THEN date_trunc('hour', p_hour) ELSE NULL END;
  v_now_hour timestamptz := date_trunc('hour', now());
  v_now_b5 timestamptz := to_timestamp(floor(extract(epoch from now()) / 300) * 300);
  v_keys text[];
  v_raw_platforms text[];
  v_dealer_orgs uuid[];
  v_has_alias_table boolean;
  v_has_event_meta boolean;
  v_has_vehicles boolean;
  v_summary jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  IF v_nslug IS NOT NULL AND v_nslug <> '' THEN
    SELECT array_agg(DISTINCT k) INTO v_keys
    FROM (
      SELECT v_nslug AS k
      UNION
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g')
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL
        AND regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') = v_nslug
      UNION
      SELECT 'bringatrailer' WHERE v_nslug = 'bat'
      UNION
      SELECT 'classiccars' WHERE v_nslug = 'classiccarscom'
      UNION
      SELECT 'hagerty' WHERE v_nslug = 'hagertymarketplace'
      UNION
      SELECT 'wwwvanguardmotorsalescom' WHERE v_nslug = 'vanguardmotorsales'
      UNION
      SELECT 'wwwgatewayclassiccarscom' WHERE v_nslug = 'gatewayclassiccars'
      UNION
      SELECT 'wwwvelocityrestorationscom' WHERE v_nslug = 'velocityrestorations'
    ) x
    WHERE k IS NOT NULL AND k <> '';

    SELECT array_agg(DISTINCT org_id) INTO v_dealer_orgs
    FROM (
      SELECT o.business_id AS org_id
      FROM public.observation_sources o
      WHERE o.business_id IS NOT NULL
        AND o.category::text IN ('dealer', 'shop')
        AND regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') = v_nslug
      UNION
      SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid
      WHERE v_nslug = 'michaelsmotorcars'
    ) d
    WHERE org_id IS NOT NULL;

    SELECT to_regclass('public.source_alias_mapping') IS NOT NULL INTO v_has_alias_table;

    IF v_has_alias_table THEN
      EXECUTE $q$
        SELECT array_agg(DISTINCT x)
        FROM (
          SELECT unnest($1::text[]) AS x
          UNION
          SELECT lower($2)
          UNION
          SELECT replace(lower($2), '-', '_')
          UNION
          SELECT replace(lower($2), '_', '-')
          UNION
          SELECT o.slug
          FROM public.observation_sources o
          WHERE o.slug IS NOT NULL
            AND regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') = ANY($1::text[])
          UNION
          SELECT o.display_name
          FROM public.observation_sources o
          WHERE o.display_name IS NOT NULL
            AND regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') = ANY($1::text[])
          UNION
          SELECT sam.raw_value
          FROM public.source_alias_mapping sam
          WHERE regexp_replace(lower(sam.canonical_slug), '[^a-z0-9]', '', 'g') = ANY($1::text[])
             OR (sam.canonical_slug = 'ebay' AND 'ebaymotors' = ANY($1::text[]))
          UNION
          SELECT 'barrettjackson' WHERE 'barrettjackson' = ANY($1::text[])
          UNION
          SELECT 'cars_and_bids' WHERE 'carsandbids' = ANY($1::text[])
          UNION
          SELECT 'rm-sothebys' WHERE 'rmsothebys' = ANY($1::text[])
          UNION
          SELECT 'broad_arrow' WHERE 'broadarrow' = ANY($1::text[])
          UNION
          SELECT 'ebay_motors' WHERE 'ebaymotors' = ANY($1::text[])
          UNION
          SELECT 'collecting_cars' WHERE 'collectingcars' = ANY($1::text[])
          UNION
          SELECT 'facebook_marketplace' WHERE 'facebookmarketplace' = ANY($1::text[])
          UNION
          SELECT 'facebook-saved' WHERE 'facebookmarketplace' = ANY($1::text[])
          UNION
          SELECT 'classiccars' WHERE 'classiccarscom' = ANY($1::text[])
          UNION
          SELECT 'classiccars.com' WHERE 'classiccarscom' = ANY($1::text[])
          UNION
          SELECT 'l''artdel''automobile' WHERE 'lartdelautomobile' = ANY($1::text[])
          UNION
          SELECT 'gaaclassiccars' WHERE 'gaaclassiccars' = ANY($1::text[])
          UNION
          SELECT 'www.vanguardmotorsales.com' WHERE 'vanguardmotorsales' = ANY($1::text[])
          UNION
          SELECT 'www.gatewayclassiccars.com' WHERE 'gatewayclassiccars' = ANY($1::text[])
        ) s
        WHERE x IS NOT NULL AND x <> ''
      $q$ INTO v_raw_platforms USING v_keys, v_clean_source;
    ELSE
      SELECT array_agg(DISTINCT x) INTO v_raw_platforms
      FROM (
        SELECT unnest(v_keys) AS x
        UNION
        SELECT lower(v_clean_source)
        UNION
        SELECT replace(lower(v_clean_source), '-', '_')
        UNION
        SELECT replace(lower(v_clean_source), '_', '-')
      ) s
      WHERE x IS NOT NULL AND x <> '';
    END IF;
  END IF;

  WITH recent_ev AS (
    SELECT regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') AS nslug,
           e.created_at,
           date_trunc('hour', e.created_at) AS hour,
           to_timestamp(floor(extract(epoch from e.created_at) / 300) * 300) AS b5
    FROM public.vehicle_events e
    WHERE e.created_at >= v_now_hour - interval '1 hour'
      AND e.source_platform IS NOT NULL
      AND (v_keys IS NULL OR regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') = ANY(v_keys))
  ), live_hr AS (
    SELECT hour, count(*)::int AS records, max(created_at) AS last_at
    FROM recent_ev
    GROUP BY 1
  ), hist_hr AS (
    SELECT h.hour, sum(h.records)::int AS records
    FROM public.market_source_hours h
    WHERE h.hour >= date_trunc('day', now()) - interval '13 days'
      AND (v_keys IS NULL OR h.source_key = ANY(v_keys))
    GROUP BY 1
  ), hrs_merged AS (
    SELECT coalesce(h.hour, l.hour) AS hour,
           GREATEST(coalesce(h.records, 0), coalesce(l.records, 0))::int AS records
    FROM hist_hr h
    FULL JOIN live_hr l ON l.hour = h.hour
  ), h24_grid AS (
    SELECT gs AS hour, ord
    FROM generate_series(v_now_hour - interval '23 hours', v_now_hour, interval '1 hour') WITH ORDINALITY AS t(gs, ord)
  ), b5_grid AS (
    SELECT gs AS b5, ord
    FROM generate_series(v_now_b5 - interval '55 minutes', v_now_b5, interval '5 minutes') WITH ORDINALITY AS t(gs, ord)
  ), d14_grid AS (
    SELECT gs::date AS day, ord
    FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') WITH ORDINALITY AS t(gs, ord)
  ), last_ever AS (
    SELECT max(hour) AS last_hour
    FROM public.market_source_hours
    WHERE records > 0 AND (v_keys IS NULL OR source_key = ANY(v_keys))
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'source', v_clean_source,
    'hour', v_now_hour,
    'selected_hour', v_target_hour,
    'bucket_5m', v_now_b5,
    'landed_15m', coalesce((SELECT count(*)::int FROM recent_ev WHERE created_at >= now() - interval '15 minutes'), 0),
    'landed_1h', coalesce((SELECT count(*)::int FROM recent_ev WHERE created_at >= now() - interval '1 hour'), 0),
    'landed_24h', coalesce((SELECT sum(records)::int FROM hrs_merged WHERE hour >= v_now_hour - interval '23 hours'), 0),
    'landed_7d', coalesce((SELECT sum(records)::int FROM hrs_merged WHERE hour >= v_now_hour - interval '167 hours'), 0),
    'last_landed', coalesce(
      (SELECT max(created_at) FROM recent_ev),
      (SELECT max(hour) FROM hrs_merged WHERE records > 0),
      (SELECT last_hour FROM last_ever)
    ),
    'hours24', coalesce((
      SELECT jsonb_agg(coalesce(hm.records, 0) ORDER BY g.ord)
      FROM h24_grid g
      LEFT JOIN hrs_merged hm ON hm.hour = g.hour
    ), '[]'::jsonb),
    'mins60', coalesce((
      SELECT jsonb_agg(coalesce(bc.n, 0) ORDER BY g.ord)
      FROM b5_grid g
      LEFT JOIN (
        SELECT b5, count(*)::int AS n
        FROM recent_ev
        WHERE b5 >= v_now_b5 - interval '55 minutes'
        GROUP BY 1
      ) bc ON bc.b5 = g.b5
    ), '[]'::jsonb),
    'days14', coalesce((
      SELECT jsonb_agg(coalesce(dc.n, 0) ORDER BY g.ord)
      FROM d14_grid g
      LEFT JOIN (
        SELECT hour::date AS day, sum(records)::int AS n
        FROM hrs_merged
        GROUP BY 1
      ) dc ON dc.day = g.day
    ), '[]'::jsonb)
  ) INTO v_summary;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_events' AND column_name = 'metadata'
  ) INTO v_has_event_meta;

  SELECT to_regclass('public.vehicles') IS NOT NULL INTO v_has_vehicles;

  IF v_has_event_meta AND v_has_vehicles THEN
    IF v_keys IS NULL THEN
      EXECUTE $q$
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'source', x.source_platform,
          'event_type', x.event_type,
          'event_status', x.event_status,
          'reserve', x.reserve,
          'price', x.price,
          'bid_count', x.bid_count,
          'year', x.year,
          'make', x.make,
          'model', x.model,
          'trim', x.trim,
          'vin', x.vin,
          'mileage', x.mileage,
          'record_date', x.record_date,
          'title', x.title,
          'raw_title', x.raw_title,
          'lot', x.lot,
          'vehicle_id', x.vehicle_id,
          'source_url', x.source_url,
          'created_at', x.created_at
        ) ORDER BY x.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT e.id,
                 e.source_platform,
                 e.event_type,
                 e.event_status,
                 CASE
                   WHEN (e.metadata->>'without_reserve') = 'true'
                     OR (e.metadata->>'no_reserve') = 'true'
                     OR (e.metadata->>'has_reserve') = 'false'
                     OR (e.metadata->>'reserve_status') = 'no_reserve'
                     OR (e.metadata->>'auction_type') ILIKE '%no reserve%'
                     THEN 'no_reserve'
                   WHEN (e.metadata->>'reserve_status') IN ('reserve_not_met', 'reserve_met')
                     THEN e.metadata->>'reserve_status'
                   WHEN (e.metadata->>'has_reserve') = 'true'
                     OR e.reserve_price IS NOT NULL
                     OR (e.metadata->>'auction_type') ILIKE '%reserve%'
                     THEN 'reserve'
                   ELSE nullif(trim(e.metadata->>'reserve_status'), '')
                 END AS reserve,
                 coalesce(e.final_price, e.current_price, e.starting_price) AS price,
                 e.bid_count,
                 v.year,
                 nullif(trim(v.make), '') AS make,
                 nullif(trim(v.model), '') AS model,
                 nullif(trim(v.trim), '') AS trim,
                 coalesce(
                   nullif(trim(v.vin), ''),
                   nullif(trim(e.metadata->>'vin'), ''),
                   nullif(trim(e.metadata->>'chassis_number'), '')
                 ) AS vin,
                 v.mileage,
                 coalesce(
                   e.sold_at::text,
                   e.ended_at::text,
                   e.started_at::text,
                   nullif(trim(e.metadata->>'sale_date'), ''),
                   nullif(trim(e.metadata->>'auction_date'), ''),
                   nullif(trim(e.metadata->>'sale_ends_on'), ''),
                   nullif(trim(e.metadata->>'sale_starts_on'), ''),
                   nullif(trim(e.metadata->'auction_session_days'->>0), ''),
                   nullif(trim(e.metadata->>'published_at'), ''),
                   nullif(trim(e.metadata->>'listing_posted_at'), ''),
                   substring(e.metadata->>'auction_name' from '((?:19[89][0-9]|20[0-2][0-9])(?:-[01][0-9]-[0-3][0-9])?)'),
                   substring(e.source_url from '/[a-z-]+-(19[89][0-9]|20[0-2][0-9])/docket/')
                 ) AS record_date,
                 coalesce(
                   nullif(trim(e.metadata->>'title'), ''),
                   nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
                   nullif(trim(e.source_listing_id), '')
                 ) AS title,
                 nullif(trim(e.metadata->>'title'), '') AS raw_title,
                 coalesce(
                   nullif(trim(e.metadata->>'lot_number'), ''),
                   nullif(trim(e.source_listing_id), '')
                 ) AS lot,
                 e.vehicle_id,
                 e.source_url,
                 e.created_at
          FROM public.vehicle_events e
          LEFT JOIN public.vehicles v ON v.id = e.vehicle_id
          WHERE e.source_platform IS NOT NULL
            AND (
              ($1::timestamptz IS NOT NULL AND e.created_at >= $1 AND e.created_at < $1 + interval '1 hour')
              OR ($1::timestamptz IS NULL AND e.created_at >= now() - interval '24 hours')
            )
          ORDER BY e.created_at DESC
          LIMIT 40
        ) x
      $q$ INTO v_recent USING v_target_hour;
    ELSE
      EXECUTE $q$
        WITH matched AS (
          SELECT e.id,
                 e.source_platform,
                 e.event_type,
                 e.event_status,
                 e.started_at,
                 e.ended_at,
                 e.sold_at,
                 e.reserve_price,
                 coalesce(e.final_price, e.current_price, e.starting_price) AS price,
                 e.bid_count,
                 e.metadata,
                 e.source_listing_id,
                 e.vehicle_id,
                 e.source_url,
                 e.created_at
          FROM unnest($1::text[]) AS p(plat)
          CROSS JOIN LATERAL (
            SELECT id, source_platform, event_type, event_status, started_at, ended_at, sold_at,
                   reserve_price, final_price, current_price, starting_price, bid_count,
                   metadata, source_listing_id, vehicle_id, source_url, created_at
            FROM public.vehicle_events e
            WHERE e.source_platform = p.plat
              AND ($2::timestamptz IS NULL OR (e.created_at >= $2 AND e.created_at < $2 + interval '1 hour'))
            ORDER BY e.created_at DESC
            LIMIT 40
          ) e
          ORDER BY e.created_at DESC
          LIMIT 40
        )
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id,
          'source', m.source_platform,
          'event_type', m.event_type,
          'event_status', m.event_status,
          'reserve', CASE
            WHEN (m.metadata->>'without_reserve') = 'true'
              OR (m.metadata->>'no_reserve') = 'true'
              OR (m.metadata->>'has_reserve') = 'false'
              OR (m.metadata->>'reserve_status') = 'no_reserve'
              OR (m.metadata->>'auction_type') ILIKE '%no reserve%'
              THEN 'no_reserve'
            WHEN (m.metadata->>'reserve_status') IN ('reserve_not_met', 'reserve_met')
              THEN m.metadata->>'reserve_status'
            WHEN (m.metadata->>'has_reserve') = 'true'
              OR m.reserve_price IS NOT NULL
              OR (m.metadata->>'auction_type') ILIKE '%reserve%'
              THEN 'reserve'
            ELSE nullif(trim(m.metadata->>'reserve_status'), '')
          END,
          'price', m.price,
          'bid_count', m.bid_count,
          'year', v.year,
          'make', nullif(trim(v.make), ''),
          'model', nullif(trim(v.model), ''),
          'trim', nullif(trim(v.trim), ''),
          'vin', coalesce(
            nullif(trim(v.vin), ''),
            nullif(trim(m.metadata->>'vin'), ''),
            nullif(trim(m.metadata->>'chassis_number'), '')
          ),
          'mileage', v.mileage,
          'record_date', coalesce(
            m.sold_at::text,
            m.ended_at::text,
            m.started_at::text,
            nullif(trim(m.metadata->>'sale_date'), ''),
            nullif(trim(m.metadata->>'auction_date'), ''),
            nullif(trim(m.metadata->>'sale_ends_on'), ''),
            nullif(trim(m.metadata->>'sale_starts_on'), ''),
            nullif(trim(m.metadata->'auction_session_days'->>0), ''),
            nullif(trim(m.metadata->>'published_at'), ''),
            nullif(trim(m.metadata->>'listing_posted_at'), ''),
            substring(m.metadata->>'auction_name' from '((?:19[89][0-9]|20[0-2][0-9])(?:-[01][0-9]-[0-3][0-9])?)'),
            substring(m.source_url from '/[a-z-]+-(19[89][0-9]|20[0-2][0-9])/docket/')
          ),
          'title', coalesce(
            nullif(trim(m.metadata->>'title'), ''),
            nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
            nullif(trim(m.source_listing_id), '')
          ),
          'raw_title', nullif(trim(m.metadata->>'title'), ''),
          'lot', coalesce(
            nullif(trim(m.metadata->>'lot_number'), ''),
            nullif(trim(m.source_listing_id), '')
          ),
          'vehicle_id', m.vehicle_id,
          'source_url', m.source_url,
          'created_at', m.created_at
        ) ORDER BY m.created_at DESC), '[]'::jsonb)
        FROM matched m
        LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
      $q$ INTO v_recent USING v_raw_platforms, v_target_hour;

      -- Fallback for dealer organizations whose inventory streams via organization_vehicles
      IF jsonb_array_length(coalesce(v_recent, '[]'::jsonb)) = 0
         AND v_dealer_orgs IS NOT NULL
         AND cardinality(v_dealer_orgs) > 0
         AND to_regclass('public.organization_vehicles') IS NOT NULL THEN
        EXECUTE $q_ov$
          WITH matched_ov AS (
            SELECT ov.id,
                   ov.vehicle_id,
                   ov.relationship_type,
                   ov.status,
                   ov.listing_status,
                   ov.asking_price,
                   ov.sale_price,
                   ov.sale_date,
                   ov.created_at
            FROM unnest($1::uuid[]) AS d(org_id)
            CROSS JOIN LATERAL (
              SELECT id, vehicle_id, relationship_type, status, listing_status,
                     asking_price, sale_price, sale_date, created_at
              FROM public.organization_vehicles ov
              WHERE ov.organization_id = d.org_id
                AND ($2::timestamptz IS NULL OR (ov.created_at >= $2 AND ov.created_at < $2 + interval '1 hour'))
              ORDER BY ov.created_at DESC
              LIMIT 40
            ) ov
            ORDER BY ov.created_at DESC
            LIMIT 40
          )
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id,
            'source', $3::text,
            'event_type', coalesce(m.relationship_type, 'inventory'),
            'event_status', coalesce(m.listing_status, m.status, 'active'),
            'reserve', NULL,
            'price', coalesce(m.sale_price, m.asking_price),
            'bid_count', NULL,
            'year', v.year,
            'make', nullif(trim(v.make), ''),
            'model', nullif(trim(v.model), ''),
            'trim', nullif(trim(v.trim), ''),
            'vin', nullif(trim(v.vin), ''),
            'mileage', v.mileage,
            'record_date', coalesce(m.sale_date::text, m.created_at::text),
            'title', nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
            'raw_title', NULL,
            'lot', NULL,
            'vehicle_id', m.vehicle_id,
            'source_url', NULL,
            'created_at', m.created_at
          ) ORDER BY m.created_at DESC), '[]'::jsonb)
          FROM matched_ov m
          LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
        $q_ov$ INTO v_recent USING v_dealer_orgs, v_target_hour, v_clean_source;
      END IF;
    END IF;
  ELSE
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'source', x.source_platform,
        'created_at', x.created_at
      ) ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT e.id, e.source_platform, e.created_at
        FROM public.vehicle_events e
        WHERE e.source_platform IS NOT NULL
          AND ($1::timestamptz IS NULL OR (e.created_at >= $1 AND e.created_at < $1 + interval '1 hour'))
          AND ($2::text[] IS NULL OR regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') = ANY($2))
        ORDER BY e.created_at DESC
        LIMIT 20
      ) x
    $q$ INTO v_recent USING v_target_hour, v_keys;
  END IF;

  IF v_target_hour IS NULL AND jsonb_array_length(coalesce(v_recent, '[]'::jsonb)) > 0 THEN
    IF (v_summary->>'last_landed') IS NULL OR (v_recent->0->>'created_at')::timestamptz > (v_summary->>'last_landed')::timestamptz THEN
      v_summary := jsonb_set(v_summary, '{last_landed}', to_jsonb(v_recent->0->>'created_at'));
    END IF;
  END IF;

  RETURN v_summary || jsonb_build_object('recent', v_recent);
END
$$;

REVOKE ALL ON FUNCTION public.market_source_landing_read(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_source_landing_read(text, timestamptz) TO anon, authenticated, service_role;

-- Clear fabricated turnover_model / capture_model / window_extrapolated population estimates from existing rows
UPDATE public.market_source_days
SET population = NULL,
    population_method = NULL,
    population_confidence = NULL,
    population_at = NULL
WHERE population_method IN ('turnover_model', 'capture_model', 'window_extrapolated');

COMMIT;
