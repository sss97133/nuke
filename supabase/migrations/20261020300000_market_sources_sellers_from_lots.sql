-- The Sources board reads BaT sellers from the lot row, auction_events, not from vehicle_events.
--
-- A BaT seller is only that lot's seller: resellers exist, and ownership is a chain of stewardship, so every lot is keyed
-- to its own seller. record_market_source_day() built the five private-seller cohorts (bat-sellers-50-plus, -10-49, -2-9,
-- -1, -none) and each dealer's venue_lots from vehicle_events, where the seller is sparse (seller_identifier on 0.8% of
-- BaT rows, a seller identity on 37,782 of 285,375, set only for dealers on bat_seller_monitors). auction_events names a
-- seller identity on 261,354 of 267,982 BaT lots (2026-10-20 read).
--
-- Changes (everything else in the function is the live definition, unchanged):
--   * cohorts: one row per BaT lot (auction_events can hold a lot twice, by url variant or by two vehicle rows, so a lot
--     is keyed by its listing slug and the copy that names a seller wins, then the latest capture); its seller is the
--     seller identity, else, only when the lot has no identity, its non-blank seller name; lots are counted per seller
--     and banded by lots; sellers registered as dealer sources (a monitored handle on a dealer organization of
--     v_dealer_ids) are left out; lots naming no seller at all stay in bat-sellers-none.
--   * venue_lots: a dealer's lots are the lots whose seller is that dealer's identity (per lot), replacing the
--     vehicle_events source_organization_id join, which tagged every BaT lot of a vehicle with the dealer
--     (extract-bat-core). Held (own-site) logic is unchanged; the vehicles a dealer sold through BaT still stay out of held.
--   * v_has_sellers (a vehicle_events column probe) becomes v_has_lots (the three tables the lot read needs).
--
-- Based on the live definition of public.record_market_source_day() read 2026-10-20, md5 of pg_get_functiondef:
-- 38f6e9af38bcc3d276e78ae553e170bd. Idempotent (CREATE OR REPLACE keeps the definer, search_path and grants).
-- Dry run before shipping: see the PR body.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.record_market_source_day()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
  v_more integer;
  v_has_org_data boolean := (
    to_regclass('public.organization_vehicles') IS NOT NULL
    AND to_regclass('public.organization_seller_stats') IS NOT NULL
  );
  v_has_lots boolean := (
    to_regclass('public.auction_events') IS NOT NULL
    AND to_regclass('public.bat_seller_monitors') IS NOT NULL
    AND to_regclass('public.external_identities') IS NOT NULL
  );
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
    ), dealer_ident AS MATERIALIZED (
      -- a dealer organization's BaT identity: its seller monitor's username, matched to the identity of that handle
      SELECT DISTINCT m.organization_id AS org_id, i.id AS ident_id, lower(i.handle) AS handle_lc
      FROM public.bat_seller_monitors m
      JOIN public.external_identities i ON i.platform = 'bat' AND lower(i.handle) = lower(m.seller_username)
      WHERE m.organization_id = ANY(v_dealer_ids)
    ), lot_keys AS MATERIALIZED (
      -- the lots a dealer identity (or, with no identity, its handle as a seller name) appears on, by listing slug,
      -- read through the seller-identity, open-seller-name and listing-slug indexes
      SELECT lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS lot_key
      FROM public.auction_events a
      WHERE a.source IN ('bat', 'bringatrailer')
        AND a.seller_external_identity_id IN (SELECT ident_id FROM dealer_ident)
      UNION
      SELECT lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))
      FROM public.auction_events a
      WHERE a.source IN ('bat', 'bringatrailer')
        AND a.seller_external_identity_id IS NULL AND a.seller_name IS NOT NULL
        AND lower(nullif(trim(a.seller_name), '')) IN (SELECT handle_lc FROM dealer_ident)
    ), lot_rows AS MATERIALIZED (
      -- every copy of those lots: auction_events can hold a lot twice (a url variant, or two vehicle rows folded from
      -- one lot)
      SELECT k.lot_key, a.vehicle_id,
             a.seller_external_identity_id AS sid, lower(nullif(trim(a.seller_name), '')) AS sname,
             a.auction_end_date, a.created_at, a.id
      FROM lot_keys k
      JOIN public.auction_events a
        ON lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = k.lot_key
       AND a.source IN ('bat', 'bringatrailer')
    ), bat_lots AS MATERIALIZED (
      -- one row per lot, the copy that names a seller first, then the latest capture (the same rule the cohorts use)
      SELECT DISTINCT ON (lot_key) lot_key, sid, sname
      FROM lot_rows
      ORDER BY lot_key, (sid IS NOT NULL) DESC, (sname IS NOT NULL) DESC, auction_end_date DESC NULLS LAST, created_at DESC, id
    ), venue AS MATERIALIZED (
      -- the dealer's own BaT lots: the lot's seller is the dealer's identity (or, with no identity, its handle as a name)
      SELECT d.nslug, x.lot_key
      FROM (
        SELECT l.lot_key, di.org_id
        FROM bat_lots l JOIN dealer_ident di ON di.ident_id = l.sid
        UNION
        SELECT l.lot_key, di.org_id
        FROM bat_lots l JOIN dealer_ident di ON l.sid IS NULL AND di.handle_lc = l.sname
      ) x
      JOIN d_orgs d ON d.org_id = x.org_id
    ), venue_veh AS (
      -- every vehicle row a dealer lot sits on, so a lot captured on two vehicle rows keeps both out of held
      SELECT DISTINCT v.nslug, r.vehicle_id
      FROM venue v
      JOIN lot_rows r ON r.lot_key = v.lot_key
      WHERE r.vehicle_id IS NOT NULL
    ), venue_lan AS (
      SELECT nslug, count(DISTINCT lot_key)::bigint AS venue_lots FROM venue GROUP BY 1
    ), ov_lan AS (
      SELECT d.nslug,
             count(DISTINCT ov.vehicle_id)::bigint AS own_vehicles,
             count(*) FILTER (WHERE ov.listing_status = 'sold')::bigint AS ov_sold,
             max(ov.created_at) AS ov_at
      FROM d_orgs d
      JOIN public.organization_vehicles ov ON ov.organization_id = d.org_id
      WHERE NOT EXISTS (SELECT 1 FROM venue_veh v WHERE v.nslug = d.nslug AND v.vehicle_id = ov.vehicle_id)
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

  -- Private sellers: BaT sellers not registered as a dealer source, as count-only cohorts by lots. Each lot is read once
  -- from auction_events, the lot row, and its seller is that lot's own: the seller identity, else (only when the lot has
  -- none) its non-blank seller name. A reseller is a seller per lot. The lots with neither are recorded apart so the
  -- board shows how much of BaT names a seller at all. A dealer's lots, found by its monitored handle, stay out. No
  -- handle is written.
  IF v_has_lots THEN
    EXECUTE $cohorts$
      INSERT INTO public.market_source_days (
        day, source_slug, display_name, category, house, landed_lots, landed_at, recorded_at,
        venue_lots, venue_slug, members, species
      )
      WITH dealer_ident AS MATERIALIZED (
        SELECT DISTINCT i.id AS ident_id, lower(i.handle) AS handle_lc
        FROM public.bat_seller_monitors m
        JOIN public.external_identities i ON i.platform = 'bat' AND lower(i.handle) = lower(m.seller_username)
        WHERE m.organization_id = ANY($1)
      ), bat_lots AS MATERIALIZED (
        SELECT DISTINCT ON (lot_key) lot_key, sid, sname
        FROM (
          SELECT coalesce(lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')), lower(a.source_url), a.id::text) AS lot_key,
                 a.seller_external_identity_id AS sid,
                 lower(nullif(trim(a.seller_name), '')) AS sname,
                 a.auction_end_date, a.created_at, a.id
          FROM public.auction_events a
          WHERE a.source IN ('bat', 'bringatrailer')
        ) z
        ORDER BY lot_key, (sid IS NOT NULL) DESC, (sname IS NOT NULL) DESC, auction_end_date DESC NULLS LAST, created_at DESC, id
      ), ev AS (
        SELECT CASE WHEN l.sid IS NOT NULL THEN 'id:' || l.sid::text
                    WHEN l.sname IS NOT NULL THEN 'h:' || l.sname END AS seller_key
        FROM bat_lots l
        WHERE NOT coalesce(l.sid IN (SELECT ident_id FROM dealer_ident)
                           OR (l.sid IS NULL AND l.sname IN (SELECT handle_lc FROM dealer_ident)), false)
      ), sellers AS (
        SELECT seller_key, count(*) AS lots
        FROM ev
        WHERE seller_key IS NOT NULL
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
$function$

;
