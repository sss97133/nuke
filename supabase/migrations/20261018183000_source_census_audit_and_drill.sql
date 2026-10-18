-- Audit public.source_census and public.market_sources_read() across RM Sotheby's, Bonhams, Gooding,
-- Collecting Cars, PCarMarket, Hemmings, and Classic.com (plus SBX Cars and GAA Classic Cars), and
-- enrich public.market_source_landing_read() with source stats so clicking any row on /sources drills
-- cleanly into its vehicles and stats.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.source_census
  ADD COLUMN IF NOT EXISTS universe_active integer,
  ADD COLUMN IF NOT EXISTS estimated_turnover_per_day integer,
  ADD COLUMN IF NOT EXISTS by_year jsonb,
  ADD COLUMN IF NOT EXISTS by_category jsonb,
  ADD COLUMN IF NOT EXISTS raw_response jsonb,
  ADD COLUMN IF NOT EXISTS census_url text,
  ADD COLUMN IF NOT EXISTS census_notes text;

ALTER TABLE public.observation_sources
  ADD COLUMN IF NOT EXISTS decay_half_life_days integer;

-- Classic.com is a marketplace & auction venue with its own listings (/veh/ and /a/) and a market_venue_label('classic-com')
-- entry ('Classic.com'); promote it from 'aggregator' to 'marketplace' so market_sources_read() ranks it on the Sources board.
UPDATE public.observation_sources
SET category = 'marketplace'
WHERE slug = 'classic-com'
  AND category IS DISTINCT FROM 'marketplace';

UPDATE public.observation_sources
SET category = 'auction'
WHERE slug = 'gaa-classic-cars'
  AND category IS DISTINCT FROM 'auction';

-- Remove stale 'unknown' placeholder census rows (universe_total IS NULL) and idempotent re-run rows for audited sources
DELETE FROM public.source_census c
USING public.observation_sources o
WHERE c.source_id = o.id
  AND o.slug IN (
    'rm-sothebys',
    'bonhams',
    'gooding',
    'collecting-cars',
    'pcarmarket',
    'hemmings',
    'classic-com',
    'sbx-cars',
    'gaa-classic-cars'
  )
  AND (
    (c.census_method = 'unknown' AND c.universe_total IS NULL)
    OR c.census_at = '2026-10-17 18:00:00+00'::timestamptz
  );

-- Insert verified Regime 1 / Regime 2 whole-source census rows (2026-10-17 audit)
INSERT INTO public.source_census (
  source_id,
  universe_total,
  universe_historical,
  universe_active,
  by_year,
  census_method,
  census_confidence,
  census_url,
  raw_response,
  census_notes,
  census_at
)
SELECT
  o.id,
  v.universe_total,
  v.universe_historical,
  v.universe_active,
  v.by_year::jsonb,
  v.census_method,
  v.census_confidence,
  v.census_url,
  v.raw_response::jsonb,
  v.census_notes,
  '2026-10-17 18:00:00+00'::timestamptz
FROM public.observation_sources o
JOIN (
  VALUES
    (
      'rm-sothebys',
      55740,
      55735,
      5,
      NULL,
      'search_index',
      0.90::numeric(3,2),
      'https://rmsothebys.com/api/search/SearchLots',
      '{"automobiles":55740,"automobiles_historical":55735,"automobiles_active":5,"motorcycles":2001,"all_categories":99435}',
      'RM Sothebys official SearchLots API (category=Automobiles: 55,740 lots; 55,735 past + 5 current; +2,001 Motorcycles)'
    ),
    (
      'bonhams',
      34101,
      34068,
      33,
      '{"2003":2490,"2004":2964,"2005":962,"2006":870,"2007":970,"2008":1179,"2009":1446,"2010":1361,"2011":1399,"2012":1214,"2013":1397,"2014":1535,"2015":1379,"2016":1344,"2017":1444,"2018":1649,"2019":2176,"2020":1397,"2021":1481,"2022":1240,"2023":1422,"2024":1160,"2025":899,"2026":712,"2027":11}',
      'search_index',
      0.88::numeric(3,2),
      'https://api01.bonhams.com/api/search/lots/',
      '{"department":"MOT-CAR","historical_lots":34068,"active_lots":33,"total_lots":34101}',
      'Bonhams Typesense search index (department.code:MOT-CAR, 2003-2027 motor car lots)'
    ),
    (
      'gooding',
      9600,
      9600,
      0,
      NULL,
      'sitemap',
      0.88::numeric(3,2),
      'https://www.goodingco.com/sitemap.xml',
      '{"sitemap_total_urls":10191,"lot_urls":9600,"auction_urls":86}',
      'Gooding & Company sitemap.xml distinct /lot/ URLs across 86 auctions (2026-10-17)'
    ),
    (
      'collecting-cars',
      20578,
      20110,
      468,
      '{"2019":76,"2020":1038,"2021":2604,"2022":3237,"2023":3506,"2024":3420,"2025":3324,"2026":3365}',
      'search_index',
      0.95::numeric(3,2),
      'https://dora.production.collecting.com/multi_search',
      '{"lotType_car":20578,"sold":20110,"live":183,"comingsoon":285,"lotType_bike":863,"all_lot_types":34371}',
      'Collecting Cars Typesense production_listings index filtered to lotType:=car (20,110 sold + 183 live + 285 comingsoon)'
    ),
    (
      'pcarmarket',
      19446,
      19373,
      73,
      '{"2019":545,"2020":1399,"2021":1899,"2022":2630,"2023":3584,"2024":4058,"2025":2955,"2026":2214}',
      'sitemap',
      0.88::numeric(3,2),
      'https://www.pcarmarket.com/sitemap.xml',
      '{"sitemap_results":19284,"sitemap_auctions_vehicles":22,"sitemap_marketplace_vehicles":51,"deduped_bare_slugs":19446}',
      'PCarMarket sitemap-results.xml (19,284) + live auctions (22) + marketplace vehicles (51), deduplicating /auction/marketplace- bare slugs'
    ),
    (
      'hemmings',
      36496,
      11496,
      25000,
      NULL,
      'search_index',
      0.85::numeric(3,2),
      'https://www.hemmings.com/auctions/why-hemmings',
      '{"targets_are_lots":false,"hemmings_auctions_historical":11496,"hemmings_auctions_live":51,"marketplace_active_listings":25000}',
      'Hemmings Auctions historical archive (11,496 completed online auctions since 2019) + 25,000 active marketplace classifieds/make-offer listings'
    ),
    (
      'classic-com',
      1054187,
      1019187,
      35000,
      NULL,
      'search_index',
      0.92::numeric(3,2),
      'https://www.classic.com/search',
      '{"total_listings":1054187,"searchable_vehicle_lots":1051638,"for_sale":35000,"auctions_tracked":1387,"dealers_tracked":2146}',
      'Classic.com search index total (1,054,187 indexed listings across historical results and ~35,000 active listings)'
    ),
    (
      'sbx-cars',
      655,
      655,
      0,
      NULL,
      'bounded',
      0.85::numeric(3,2),
      'https://sbxcars.com/auctions',
      '{"max_sequential_lot_number":655,"first_lot_year":2024,"last_lot_year":2026}',
      'SBX Cars sequential public auction lot IDs (Lot# 1..655 at sbxcars.com/listing/<id>/<slug>, Apr 2024 - Apr 2026)'
    ),
    (
      'gaa-classic-cars',
      22440,
      21690,
      750,
      NULL,
      'bounded',
      0.80::numeric(3,2),
      'https://www.gaaclassiccars.com/vehicles/results',
      '{"auction_branches":33,"avg_lots_per_branch":680,"max_vehicle_id":46528}',
      'GAA Classic Cars published auction dockets (33 tri-annual Greensboro auctions 2017-2026 at ~680 vehicles/sale)'
    )
) AS v(
  slug,
  universe_total,
  universe_historical,
  universe_active,
  by_year,
  census_method,
  census_confidence,
  census_url,
  raw_response,
  census_notes
) ON o.slug = v.slug;

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
      WHERE (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count', 'docket_and_broadcast_census'))
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), (c.universe_total IS NOT NULL) DESC, c.census_at DESC
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
      WHERE (c.universe_total IS NULL OR c.universe_historical IS NOT NULL
             OR c.census_method IN ('enumerated', 'search_index', 'sitemap', 'bounded', 'api_count', 'docket_and_broadcast_census'))
        AND NOT (c.census_method = 'unknown' AND c.universe_total IS NULL)
      ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), (c.universe_total IS NOT NULL) DESC, c.census_at DESC
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
           CASE WHEN p.universe_total >= coalesce(l.landed_lots, 0) THEN p.universe_total ELSE NULL END,
           CASE WHEN p.universe_total >= coalesce(l.landed_lots, 0) THEN p.census_method ELSE NULL END,
           CASE WHEN p.universe_total >= coalesce(l.landed_lots, 0) THEN p.census_confidence ELSE NULL END,
           CASE WHEN p.universe_total >= coalesce(l.landed_lots, 0) THEN p.census_at ELSE NULL END,
           nullif(mq.sales, 0), mq.usd, f.sales_12m, f.usd_12m,
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
END;
$$;

REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

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
      SELECT 'sbx', 'sbxcars'
      UNION ALL
      SELECT 'ebay', 'ebaymotors'
      UNION ALL
      SELECT 'wwwoldcaronlinecom', 'oldcaronline'
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

REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;

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
  v_stats jsonb := NULL;
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
      SELECT 'sbx' WHERE v_nslug = 'sbxcars'
      UNION
      SELECT 'ebay' WHERE v_nslug = 'ebaymotors'
      UNION
      SELECT 'wwwoldcaronlinecom' WHERE v_nslug = 'oldcaronline'
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
          SELECT 'rmsothebys' WHERE 'rmsothebys' = ANY($1::text[])
          UNION
          SELECT 'broad_arrow' WHERE 'broadarrow' = ANY($1::text[])
          UNION
          SELECT 'ebay_motors' WHERE 'ebaymotors' = ANY($1::text[])
          UNION
          SELECT 'collecting_cars' WHERE 'collectingcars' = ANY($1::text[])
          UNION
          SELECT 'collecting-cars' WHERE 'collectingcars' = ANY($1::text[])
          UNION
          SELECT 'classic.com' WHERE 'classiccom' = ANY($1::text[])
          UNION
          SELECT 'classic-com' WHERE 'classiccom' = ANY($1::text[])
          UNION
          SELECT 'sbx-cars' WHERE 'sbxcars' = ANY($1::text[])
          UNION
          SELECT 'sbx' WHERE 'sbxcars' = ANY($1::text[])
          UNION
          SELECT 'facebook_marketplace' WHERE 'facebookmarketplace' = ANY($1::text[])
          UNION
          SELECT 'facebook-saved' WHERE 'facebookmarketplace' = ANY($1::text[])
          UNION
          SELECT 'classiccars' WHERE 'classiccarscom' = ANY($1::text[])
          UNION
          SELECT 'classiccars.com' WHERE 'classiccarscom' = ANY($1::text[])
          UNION
          SELECT 'www.oldcaronline.com' WHERE 'oldcaronline' = ANY($1::text[])
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

    SELECT jsonb_build_object(
      'source', d.source_slug,
      'name', d.display_name,
      'category', d.category,
      'house', d.house,
      'held_lots', d.landed_lots,
      'held_at', d.landed_at,
      'population', d.population,
      'population_method', d.population_method,
      'population_confidence', d.population_confidence,
      'population_at', d.population_at,
      'coverage_share', CASE
        WHEN d.population IS NOT NULL AND d.population > 0 AND d.landed_lots IS NOT NULL
        THEN round((least(1.0, d.landed_lots::numeric / d.population::numeric))::numeric, 4)
        ELSE NULL
      END,
      'map_sales', d.map_sales,
      'map_usd', d.map_usd,
      'sales_12m', d.sales_12m,
      'usd_12m', d.usd_12m,
      'sales_prior_12m', d.sales_prior_12m,
      'usd_prior_12m', d.usd_prior_12m,
      'months', coalesce(d.months, '[]'::jsonb)
    )
    INTO v_stats
    FROM public.market_source_days d
    WHERE d.day = (SELECT max(day) FROM public.market_source_days)
      AND (
        d.source_slug = v_clean_source
        OR regexp_replace(lower(d.source_slug), '[^a-z0-9]', '', 'g') = v_nslug
      )
    ORDER BY (d.source_slug = v_clean_source) DESC, d.landed_lots DESC NULLS LAST
    LIMIT 1;
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
    ), '[]'::jsonb),
    'stats', v_stats
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
END;
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

DO $refresh$
BEGIN
  IF (SELECT count(*) FROM public.market_source_days) > 0 THEN
    PERFORM public.record_market_source_day();
  END IF;
END;
$refresh$;

COMMIT;
