-- record_market_source_day: a docket_and_broadcast_census figure is a model of our own capture, not a source's total.
-- Its rows sum what we hold (vehicle_events, listing_page_snapshots across dockets, broadcast frames); the fold header
-- (20261018213000) already says a model of our own capture is never a source's total, but the method was listed among the
-- exact census methods. Measured 2026-10-18 07:07Z: Barrett-Jackson's market_sources_read row shows population 64,000 at
-- confidence 0.92 from that method, and all five of its source_census rows (2026-01-28 to 2026-10-16) carry the same
-- hand-set 64,000 and note; the only measured figures are in the 10-16 row's raw_response (sitemap_listed_distinct 35,790,
-- held_event_urls 39,696). The method joins capture_model, turnover_model and window_extrapolated as excluded, so such a
-- source's population is unknown until an exact census or a labelled reference exists. Nothing else changes (live md5
-- 47e4de17 matched the 20261018213000 body 2026-10-18 07:22Z); source_census rows are left as they are.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

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
           now()
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
      usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

DO $refresh$
BEGIN
  IF (SELECT count(*) FROM public.market_source_days) > 0 THEN
    PERFORM public.record_market_source_day();
  END IF;
END;
$refresh$;

COMMIT;
