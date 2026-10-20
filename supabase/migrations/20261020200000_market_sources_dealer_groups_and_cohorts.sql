-- Sources board: dealer groups, private-seller cohorts and owners, measured so nothing is counted twice.
-- Measured 2026-10-19 (scripts/data/source-holders.mjs, receipt in the owner's logs): 37 dealer organizations hold
-- 32,349 organization_vehicles rows, and 25,206 of their 28,695 vehicles are BaT lots the dealer itself sold, already
-- held under the BaT row; only 18 of the 37 had an observation_sources row, so the board could not see the rest.
-- 177 'other' organizations (BaT seller handles) hold 33,333 rows with no source row at all. Of 285,375 BaT lots,
-- 54,618 name a seller (organization, identity or handle); 230,757 carry none (154,738 null, 127,910 blank).
-- BaT's 'Private Party or Dealer' line is not retained in vehicle_events.metadata, so private and dealer are told
-- apart by registration (a dealer source row), never guessed from the line.
--
-- What changes:
--   * market_source_days gains venue_lots / venue_slug (lots a source sold through a venue the board already counts,
--     shown apart, never added to held or to landing totals), members (sellers in a cohort row) and species (set on
--     cohort rows, which have no observation_sources row).
--   * source_species gains 'private_seller': sellers on a venue who are not registered as a dealer source, ranked as
--     count-only cohorts; no handle leaves the database.
--   * 17 dealer organizations holding 50+ vehicles get their observation_sources row, species dealer, with the evidence
--     measured above. Two organizations sharing a registered dealer's website (a second Fantasy Junction row, Michael's
--     Motor Cars PA) fold into that dealer instead of a row of their own.
--   * record_market_source_day() (cloned from the live 20261019073000 body, md5 4e601c56, 2026-10-19): a dealer's held
--     count is the vehicles it holds that it did not sell through BaT; its BaT lots go to venue_lots; the board's
--     organization_seller_stats totals (BaT listings) no longer stand in for held. The writer also records the four
--     private-seller cohort rows (50+, 10-49, 2-9, 1 lot) plus the lots with no seller recorded, and one row per
--     owner_private source with the vehicles its observations cover.
-- Replayable: every statement is idempotent.
SET statement_timeout = '120s';
SET lock_timeout = '5s';

-- A new enum value is usable only once committed, so it is added before the transaction below.
DO $$ BEGIN
  IF to_regtype('public.source_species') IS NOT NULL THEN
    ALTER TYPE public.source_species ADD VALUE IF NOT EXISTS 'private_seller' AFTER 'media_forum_video';
  END IF;
END $$;

BEGIN;

ALTER TABLE public.market_source_days
  ADD COLUMN IF NOT EXISTS venue_lots bigint,
  ADD COLUMN IF NOT EXISTS venue_slug text,
  ADD COLUMN IF NOT EXISTS members integer,
  ADD COLUMN IF NOT EXISTS species public.source_species;
COMMENT ON COLUMN public.market_source_days.venue_lots IS
  'Lots this source sold through a venue the board already counts (venue_slug), shown apart from landed_lots and never '
  'added to held or landing totals: a dealer''s BaT lots are BaT''s lots. Unit: lots (vehicle_events rows). Grain: one '
  'source per day. Clock: recorded_at.';
COMMENT ON COLUMN public.market_source_days.venue_slug IS
  'The venue venue_lots were sold through (bat). NULL when venue_lots is NULL.';
COMMENT ON COLUMN public.market_source_days.members IS
  'Cohort rows only: the sellers in the cohort (landed_lots is their lots). NULL on source rows. Unit: sellers.';
COMMENT ON COLUMN public.market_source_days.species IS
  'Cohort rows only (no observation_sources row to read it from): private_seller. NULL on source rows, whose species '
  'the reader takes from observation_sources.';

CREATE OR REPLACE FUNCTION public.source_species_label(p public.source_species)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT CASE p::text
    WHEN 'timed_auction' THEN 'Timed with soft close'
    WHEN 'block_house' THEN 'Block houses'
    WHEN 'dealer' THEN 'Dealer sites'
    WHEN 'classifieds' THEN 'Classifieds'
    WHEN 'auth_walled_marketplace' THEN 'Auth-walled marketplaces'
    WHEN 'aggregator' THEN 'Aggregators'
    WHEN 'media_forum_video' THEN 'Media, forums, video'
    WHEN 'private_seller' THEN 'Private sellers'
    WHEN 'owner_private' THEN 'Owner''s private data'
  END $$;

-- Dealer organizations holding 50+ vehicles with no source row (2026-10-19). The two duplicates of registered dealers
-- (same website) are folded by the writer, not registered again. Each row's evidence is what was measured for it.
INSERT INTO public.observation_sources (slug, display_name, category, base_url, business_id)
SELECT v.slug, v.display_name, 'dealer', v.base_url, v.business_id
  FROM (VALUES
    ('choicedealsnc2017',      'choicedealsnc2017',      NULL,                                   '88b0a268-ac57-4bde-92ba-ad14920ddbe0'::uuid),
    ('denwerks',               'DENWERKS',               NULL,                                   'b30a2451-2c6c-4652-9ffd-2046a3abf722'::uuid),
    ('swvintage',              'SWVintage',              NULL,                                   'b8e3479d-ab8c-4ae6-87ca-13dccb218eba'::uuid),
    ('competitioncars',        'Competitioncars',        NULL,                                   '29422ed2-541e-4ba3-a60b-2ed707b04bb9'::uuid),
    ('the-patina-group',       'The Patina Group',       'https://www.sellwithtpg.com',          'dc369901-bf7b-4976-9397-51d006dccda8'::uuid),
    ('rarecars',               'Rarecars',               NULL,                                   'a63044ac-c74c-4e10-8c38-a13c0f97ab6f'::uuid),
    ('exclusive-motor-club',   'Exclusive Motor Club',   'https://www.exclusivemotorclub.com',   'd85b3a03-3067-4716-8f61-334b0b5c8637'::uuid),
    ('premierautofl',          'Premierautofl',          NULL,                                   '061631f2-ed79-4bed-bbd4-ce2bcedb9ef8'::uuid),
    ('performanceautogallery', 'performanceautogallery', NULL,                                   '3e2e93ab-be02-47a5-9e96-37215a301aa4'::uuid),
    ('genauautowerks',         'GenauAutoWerks',         NULL,                                   'a3b1e9dd-d911-40b1-b393-f61bc8b91626'::uuid),
    ('vintiquemotors',         'VintiqueMotors',         NULL,                                   'c9f704e1-4250-46db-b8f4-d62f7833ff38'::uuid),
    ('autogalerie-us',         'Autogalerie-us',         NULL,                                   '16a39ee4-4649-489c-91ca-bdba5b8e81fc'::uuid),
    ('corvettemike',           'CorvetteMike',           NULL,                                   '9784bbae-1690-48d8-964f-5828c08d79d6'::uuid),
    ('luxuryautomax',          'luxuryautomax',          NULL,                                   'd16fd497-3968-41e1-8c17-2243d098c29a'::uuid),
    ('collective-auto-group',  'Collective Auto Group',  'https://www.collectiveauto.com',       'b8a962a3-1aeb-44a2-92be-e23a7728c277'::uuid),
    ('viva-las-vegas-autos',   'Viva! Las Vegas Autos',  NULL,                                   'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'::uuid),
    ('casciomotors',           'casciomotors',           NULL,                                   '34570f75-d916-4cf5-8eda-c95f75dca8f9'::uuid)
  ) AS v(slug, display_name, base_url, business_id)
  JOIN public.organizations b ON b.id = v.business_id
 WHERE NOT EXISTS (SELECT 1 FROM public.observation_sources o WHERE o.slug = v.slug OR o.business_id = v.business_id);

UPDATE public.observation_sources o
   SET species = 'dealer', species_set = '{dealer}', species_evidence = e.evidence, updated_at = now()
  FROM (VALUES
    ('choicedealsnc2017', 'organization_vehicles 658 rows, 655 vehicles; vehicle_events with this organization as source_organization_id: 750, all BaT; 3 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('denwerks', 'organization_vehicles 477 rows, 473 vehicles; BaT lots it sold: 543; 1 vehicle not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('swvintage', 'organization_vehicles 468 rows, 460 vehicles; BaT lots it sold: 533; 3 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('competitioncars', 'organization_vehicles 418 rows, 416 vehicles; BaT lots it sold: 506; 2 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('the-patina-group', 'organization_vehicles 390 rows, 383 vehicles; BaT lots it sold: 465; 1 vehicle not sold through BaT by it; website https://www.sellwithtpg.com (not read yet)', 'as recorded on the organization'),
    ('rarecars', 'organization_vehicles 380 rows, 378 vehicles; BaT lots it sold: 441; 0 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('exclusive-motor-club', 'organization_vehicles 363 rows, 357 vehicles; BaT lots it sold: 319; 72 vehicles not sold through BaT by it; website https://www.exclusivemotorclub.com (not read yet)', 'as recorded on the organization'),
    ('premierautofl', 'organization_vehicles 361 rows, 354 vehicles; BaT lots it sold: 317; 84 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('performanceautogallery', 'organization_vehicles 323 rows, 323 vehicles; BaT lots it sold: 366; 2 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('genauautowerks', 'organization_vehicles 299 rows, 288 vehicles; BaT lots it sold: 333; 4 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('vintiquemotors', 'organization_vehicles 282 rows, 280 vehicles; BaT lots it sold: 325; 0 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('autogalerie-us', 'organization_vehicles 280 rows, 268 vehicles; BaT lots it sold: 318; 0 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('corvettemike', 'organization_vehicles 257 rows, 254 vehicles; BaT lots it sold: 289; 0 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('luxuryautomax', 'organization_vehicles 252 rows, 247 vehicles; BaT lots it sold: 302; 1 vehicle not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)'),
    ('collective-auto-group', 'organization_vehicles 251 rows, 222 vehicles; BaT lots it sold: 0; 222 vehicles held off BaT (18 with a BaT event under another seller, 135 with another platform''s event, 82 with none); website https://www.collectiveauto.com (not read yet)', 'as recorded on the organization'),
    ('viva-las-vegas-autos', 'organization_vehicles 241 rows, 181 vehicles; BaT lots it sold: 106; 110 vehicles not sold through BaT by it; no website recorded', 'as recorded on the organization (the owner''s dealership)'),
    ('casciomotors', 'organization_vehicles 169 rows, 164 vehicles; BaT lots it sold: 306; 0 vehicles not sold through BaT by it; no website recorded', 'by scripts/discover-dealer-sellers.mjs (15+ BaT lots across 3+ years)')
  ) AS v(slug, measured, typed)
  CROSS JOIN LATERAL (
    SELECT jsonb_build_object(
      'examined_at', '2026-10-19',
      'examined', jsonb_build_array(
        'organizations.business_type dealer, ' || v.typed,
        'organization_vehicles and vehicle_events for this organization, measured 2026-10-19 by scripts/data/source-holders.mjs: ' || v.measured),
      'seen', 'What we hold for it are mostly BaT timed-auction lots it sold (each lot''s own species is timed_auction, counted '
              'under the BaT row and shown here as venue_lots); its own inventory site, where one is recorded, is the dealer site '
              'and is not read yet. The dealer label rests on organizations.business_type, ' || v.typed || '; BaT''s ''Private Party '
              'or Dealer'' line is not retained in vehicle_events and was not re-read.',
      'doc', 'docs/ledger/theory/data-machine-cases.md §6 names dealers under Dealer sites',
      'listing_rule', 'held rows are BaT lots: their species comes from bat (timed_auction)') AS evidence
  ) e
 WHERE o.slug = v.slug AND o.species IS NULL;

CREATE OR REPLACE FUNCTION public.record_market_source_day()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_more integer;
  v_has_org_data boolean := (
    to_regclass('public.organization_vehicles') IS NOT NULL
    AND to_regclass('public.organization_seller_stats') IS NOT NULL
  );
  v_has_sellers boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_events' AND column_name = 'seller_identifier');
  v_dealer_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_has_org_data THEN
    -- Dealer organizations: those linked to a dealer or shop source row, plus organizations sharing such a source's
    -- website host (a second row for the same dealer), plus the one id folded before hosts were compared.
    SELECT coalesce(array_agg(DISTINCT org_id), ARRAY[]::uuid[])
      INTO v_dealer_ids
      FROM (
        SELECT o.business_id AS org_id
        FROM public.observation_sources o
        WHERE o.business_id IS NOT NULL
          AND o.category::text IN ('dealer', 'shop')
        UNION
        SELECT b2.id
        FROM public.observation_sources o
        JOIN public.organizations b ON b.id = o.business_id
        JOIN public.organizations b2
          ON b2.id <> b.id
         AND lower(regexp_replace(b2.website, '^https?://(www\.)?([^/]+).*$', '\2')) =
             lower(regexp_replace(b.website, '^https?://(www\.)?([^/]+).*$', '\2'))
        WHERE o.business_id IS NOT NULL AND o.category::text IN ('dealer', 'shop')
          AND b.website IS NOT NULL AND b2.website IS NOT NULL
        UNION
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid
        WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
      ) x
     WHERE org_id IS NOT NULL;

    INSERT INTO public.market_source_days (
      day, source_slug, display_name, category, house, landed_lots, landed_at,
      population, population_method, population_confidence, population_at,
      map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m, usd_prior_12m, months, recorded_at,
      venue_lots, venue_slug, members, species
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
        -- a second organization row for a registered dealer (same website host) folds into that dealer
        SELECT b2.id, s.nslug
        FROM src s
        JOIN public.organizations b ON b.id = s.business_id
        JOIN public.organizations b2
          ON b2.id <> b.id
         AND lower(regexp_replace(b2.website, '^https?://(www\.)?([^/]+).*$', '\2')) =
             lower(regexp_replace(b.website, '^https?://(www\.)?([^/]+).*$', '\2'))
        WHERE s.business_id IS NOT NULL AND s.category IN ('dealer', 'shop')
          AND b.website IS NOT NULL AND b2.website IS NOT NULL
        UNION ALL
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
        WHERE EXISTS (SELECT 1 FROM src WHERE nslug = 'michaelsmotorcars')
      ) x
      WHERE org_id IS NOT NULL
    ), cen AS (
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at,
             c.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate') AS is_reference
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.census_at < (current_date + 1)::timestamptz
        AND c.census_method NOT IN ('capture_model', 'turnover_model', 'window_extrapolated', 'docket_and_broadcast_census')
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
        AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count',
                                    'owner_reference', 'catalogue_estimate', 'estimate'))
    ), pop_direct AS (
      SELECT DISTINCT ON (nslug) nslug, universe_total, census_method, census_confidence, census_at
      FROM cen
      WHERE NOT is_reference
      ORDER BY nslug, (universe_total IS NOT NULL) DESC, census_at DESC
    ), lan AS (
      SELECT CASE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
               WHEN 'bringatrailer' THEN 'bat'
               WHEN 'classiccars' THEN 'classiccarscom'
               WHEN 'hagerty' THEN 'hagertymarketplace'
               WHEN 'sbx' THEN 'sbxcars'
               WHEN 'ebay' THEN 'ebaymotors'
               WHEN 'wwwoldcaronlinecom' THEN 'oldcaronline'
               WHEN 'wwwvanguardmotorsalescom' THEN 'vanguardmotorsales'
               WHEN 'wwwgatewayclassiccarscom' THEN 'gatewayclassiccars'
               WHEN 'wwwvelocityrestorationscom' THEN 'velocityrestorations'
               ELSE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
             END AS nslug,
             sum(landed_lots)::bigint AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      WHERE source_slug IS NOT NULL AND source_slug <> 'unknown' AND coalesce(landed_lots, 0) > 0
      GROUP BY 1
    ), venue AS MATERIALIZED (
      -- the dealer's own BaT lots: vehicle_events naming it as the seller, read through idx_vehicle_events_source_org
      SELECT d.nslug, e.vehicle_id
      FROM d_orgs d
      JOIN public.vehicle_events e ON e.source_organization_id = d.org_id
      WHERE lower(e.source_platform) IN ('bat', 'bringatrailer')
    ), venue_lan AS (
      SELECT nslug, count(*)::bigint AS venue_lots FROM venue GROUP BY 1
    ), ov_lan AS (
      SELECT d.nslug,
             count(DISTINCT ov.vehicle_id)::bigint AS own_vehicles,
             count(*) FILTER (WHERE ov.listing_status = 'sold')::bigint AS ov_sold,
             max(ov.created_at) AS ov_at
      FROM d_orgs d
      JOIN public.organization_vehicles ov ON ov.organization_id = d.org_id
      WHERE NOT EXISTS (SELECT 1 FROM venue v WHERE v.nslug = d.nslug AND v.vehicle_id = ov.vehicle_id)
      GROUP BY 1
    ), ss_lan AS (
      SELECT d.nslug,
             sum(ss.total_sold)::bigint AS total_sold,
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
             -- held: the fold's lots, else the vehicles a dealer holds that it did not sell through BaT
             CASE
               WHEN coalesce(l.landed_lots, 0) >= 500 THEN l.landed_lots
               ELSE nullif(GREATEST(coalesce(l.landed_lots, 0), coalesce(ov.own_vehicles, 0)), 0)
             END AS eff_landed_lots,
             coalesce(l.landed_at, ov.ov_at, ss.calculated_at) AS eff_landed_at,
             nullif(GREATEST(coalesce(mq.sales, 0), coalesce(df.map_sales, 0), coalesce(ss.total_sold, 0), coalesce(ov.ov_sold, 0)), 0) AS eff_map_sales,
             coalesce(mq.usd, df.map_usd, nullif(ss.total_gross_sales, 0)) AS eff_map_usd,
             coalesce(f.sales_12m, df.sales_12m) AS eff_sales_12m,
             coalesce(f.usd_12m, df.usd_12m) AS eff_usd_12m,
             coalesce(f.sales_prior_12m, df.sales_prior_12m) AS eff_sales_prior_12m,
             coalesce(f.usd_prior_12m, df.usd_prior_12m) AS eff_usd_prior_12m,
             coalesce(mo.months, dm.months) AS eff_months,
             nullif(vl.venue_lots, 0) AS eff_venue_lots
      FROM src s
      LEFT JOIN lan l ON l.nslug = s.nslug
      LEFT JOIN ov_lan ov ON ov.nslug = s.nslug
      LEFT JOIN venue_lan vl ON vl.nslug = s.nslug
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
           coalesce(pd.universe_total, pr.universe_total),
           coalesce(pd.census_method, pr.census_method),
           coalesce(pd.census_confidence, pr.census_confidence)::numeric,
           coalesce(pd.census_at, pr.census_at),
           c.eff_map_sales,
           c.eff_map_usd,
           c.eff_sales_12m,
           c.eff_usd_12m,
           c.eff_sales_prior_12m,
           c.eff_usd_prior_12m,
           c.eff_months,
           now(),
           c.eff_venue_lots,
           CASE WHEN c.eff_venue_lots IS NOT NULL THEN 'bat' END,
           NULL,
           NULL
    FROM combined c
    LEFT JOIN pop_direct pd ON pd.nslug = c.nslug AND pd.universe_total >= coalesce(c.eff_landed_lots, 0)
    LEFT JOIN LATERAL (
      SELECT r.universe_total, r.census_method, r.census_confidence, r.census_at
      FROM cen r
      WHERE pd.nslug IS NULL
        AND r.nslug = c.nslug AND r.is_reference
        AND r.universe_total >= coalesce(c.eff_landed_lots, 0)
      ORDER BY r.census_at DESC
      LIMIT 1
    ) pr ON true
    WHERE coalesce(c.eff_landed_lots, 0) > 0 OR coalesce(c.eff_map_sales, 0) > 0 OR coalesce(c.eff_sales_12m, 0) > 0
       OR coalesce(c.eff_venue_lots, 0) > 0
    ON CONFLICT (day, source_slug) DO UPDATE SET
      display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
      landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
      population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
      population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
      sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at,
      venue_lots = EXCLUDED.venue_lots, venue_slug = EXCLUDED.venue_slug, members = EXCLUDED.members,
      species = EXCLUDED.species;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
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
    ), cen AS (
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
             c.universe_total, c.census_method, c.census_confidence, c.census_at,
             c.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate') AS is_reference
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
      WHERE c.census_at < (current_date + 1)::timestamptz
        AND c.census_method NOT IN ('capture_model', 'turnover_model', 'window_extrapolated', 'docket_and_broadcast_census')
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
        AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count',
                                    'owner_reference', 'catalogue_estimate', 'estimate'))
    ), pop AS (
      SELECT DISTINCT ON (nslug) nslug, universe_total, census_method, census_confidence, census_at
      FROM cen
      WHERE NOT is_reference
      ORDER BY nslug, (universe_total IS NOT NULL) DESC, census_at DESC
    ), lan AS (
      SELECT CASE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
               WHEN 'bringatrailer' THEN 'bat'
               WHEN 'classiccars' THEN 'classiccarscom'
               WHEN 'hagerty' THEN 'hagertymarketplace'
               WHEN 'sbx' THEN 'sbxcars'
               WHEN 'ebay' THEN 'ebaymotors'
               WHEN 'wwwoldcaronlinecom' THEN 'oldcaronline'
               ELSE regexp_replace(regexp_replace(lower(source_slug), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'), '[^a-z0-9]', '', 'g')
             END AS nslug,
             sum(landed_lots)::bigint AS landed_lots,
             max(measured_at) AS landed_at
      FROM public.mv_source_target_landed
      WHERE source_slug IS NOT NULL AND source_slug <> 'unknown' AND coalesce(landed_lots, 0) > 0
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
           coalesce(p.universe_total, pr.universe_total),
           coalesce(p.census_method, pr.census_method),
           coalesce(p.census_confidence, pr.census_confidence),
           coalesce(p.census_at, pr.census_at),
           nullif(mq.sales, 0), mq.usd, f.sales_12m, f.usd_12m,
           f.sales_prior_12m, f.usd_prior_12m, mo.months, now()
    FROM src s
    LEFT JOIN lan l USING (nslug)
    LEFT JOIN pop p ON p.nslug = s.nslug AND p.universe_total >= coalesce(l.landed_lots, 0)
    LEFT JOIN LATERAL (
      SELECT r.universe_total, r.census_method, r.census_confidence, r.census_at
      FROM cen r
      WHERE p.nslug IS NULL
        AND r.nslug = s.nslug AND r.is_reference
        AND r.universe_total >= coalesce(l.landed_lots, 0)
      ORDER BY r.census_at DESC
      LIMIT 1
    ) pr ON true
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
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at,
      venue_lots = NULL, venue_slug = NULL, members = NULL, species = NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  -- Private sellers: BaT sellers not registered as a dealer source, as count-only cohorts by lots. A seller is an
  -- organization, an external identity or a non-blank handle, in that order; the lots with none are recorded apart so
  -- the board shows how much of BaT names a seller at all. No handle is written.
  IF v_has_sellers THEN
    EXECUTE $cohorts$
      INSERT INTO public.market_source_days (
        day, source_slug, display_name, category, house, landed_lots, landed_at, recorded_at,
        venue_lots, venue_slug, members, species
      )
      WITH dealer_orgs AS (
        SELECT unnest($1) AS id
      ), ev AS (
        SELECT coalesce('org:' || e.source_organization_id::text, 'id:' || e.seller_external_identity_id::text,
                        'h:' || lower(nullif(trim(e.seller_identifier), ''))) AS seller_key,
               e.source_organization_id AS org_id
        FROM public.vehicle_events e
        WHERE lower(e.source_platform) IN ('bat', 'bringatrailer')
      ), sellers AS (
        SELECT seller_key, count(*) AS lots
        FROM ev
        WHERE seller_key IS NOT NULL AND (org_id IS NULL OR org_id NOT IN (SELECT id FROM dealer_orgs))
        GROUP BY 1
      ), bands AS (
        SELECT CASE WHEN lots >= 50 THEN 1 WHEN lots >= 10 THEN 2 WHEN lots >= 2 THEN 3 ELSE 4 END AS band,
               count(*)::int AS members, sum(lots)::bigint AS lots
        FROM sellers GROUP BY 1
      ), rows_ AS (
        SELECT b.band, l.slug, l.name, b.members, b.lots
        FROM bands b
        JOIN (VALUES (1, 'bat-sellers-50-plus', 'Sellers with 50 or more BaT lots'),
                     (2, 'bat-sellers-10-49', 'Sellers with 10 to 49 BaT lots'),
                     (3, 'bat-sellers-2-9', 'Sellers with 2 to 9 BaT lots'),
                     (4, 'bat-sellers-1', 'Sellers with one BaT lot')) l(band, slug, name) ON l.band = b.band
        UNION ALL
        SELECT 5, 'bat-sellers-none', 'BaT lots with no seller recorded', 0, count(*)::bigint
        FROM ev WHERE seller_key IS NULL
      )
      SELECT current_date, r.slug, r.name, 'seller_cohort', NULL, r.lots, now(), now(),
             NULL, 'bat', r.members, 'private_seller'::public.source_species
      FROM rows_ r
      WHERE r.lots > 0
      ON CONFLICT (day, source_slug) DO UPDATE SET
        display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
        landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, recorded_at = EXCLUDED.recorded_at,
        venue_lots = EXCLUDED.venue_lots, venue_slug = EXCLUDED.venue_slug, members = EXCLUDED.members,
        species = EXCLUDED.species
    $cohorts$ USING v_dealer_ids;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_rows := v_rows + v_more;
  END IF;

  -- Owners: each owner_private source with the vehicles its observations cover. Counts only; the observations stay
  -- behind their own reads.
  IF to_regclass('public.vehicle_observations') IS NOT NULL THEN
    EXECUTE $owners$
      INSERT INTO public.market_source_days (
        day, source_slug, display_name, category, house, landed_lots, landed_at, recorded_at
      )
      SELECT current_date, o.slug, o.display_name, o.category::text, NULL, x.vehicles, x.last_at, now()
      FROM public.observation_sources o
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT v.vehicle_id)::bigint AS vehicles, max(v.observed_at) AS last_at
        FROM public.vehicle_observations v WHERE v.source_id = o.id
      ) x
      WHERE o.species::text = 'owner_private' AND x.vehicles > 0
      ON CONFLICT (day, source_slug) DO UPDATE SET
        display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
        landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, recorded_at = EXCLUDED.recorded_at
    $owners$;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_rows := v_rows + v_more;
  END IF;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.record_market_source_day() IS
  'Writes today''s market_source_days row for every declared source holding data (held lots/listings/vehicles, whole-source '
  'or labelled-reference population, map sales, sales by sale date, and 24-month sparkline across auction houses, '
  'marketplaces, and dealers), a dealer''s BaT lots apart in venue_lots (held counts only what it holds off BaT), the '
  'private-seller cohorts (BaT sellers not registered as a dealer source, by lots, plus the lots naming no seller) and each '
  'owner_private source''s vehicles; a second call the same day replaces that day''s rows. Cron market-source-days, 10:47Z. '
  '2026-10-19.';
REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

COMMIT;
