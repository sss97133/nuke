-- Sources drill-down reader: held counts that are current, archived captures that say so, and whole-window sold figures.
-- Live 2026-10-20 05:23Z (eBay Motors): the panel read "Listings held 3,575" beside "Last 24 hours +17,583". The 3,575 is
-- the daily held-lot fold (mv_source_target_landed, measured 2026-10-19 10:27Z, 19 hours earlier); 18,069 more eBay rows
-- had landed since, 19,174 in all. The reader now carries `held_since`, the events created after that fold's clock, so the
-- panel can show both the measured count and what landed after it.
-- Also from that screenshot: every one of the 18,039 rows landed in 24 hours is a Wayback Machine capture of an eBay
-- page from 2009-2014. 2,509 read 'active' (the listing's state when captured, not now) and 2,546 had no date although
-- their capture time is on the row (metadata.page.archive.archive_timestamp). A recent row now carries `archived` and
-- `captured_at`, and an event with no clock of its own takes its capture time as its record date, last in the chain.
-- The sold count, sell-through and median sold price were computed from the 40 rows shown ("4 sold, 10%", over a window
-- that held 3,626 sold and 11,867 ended unsold); `window` now counts every event landed in the window (the selected hour,
-- else 24 hours; at most 30,000 rows, flagged `capped`).
-- Re-read from the live body (2026-10-20); only held_since, the window block, and the archive fields change.
SET statement_timeout = '60s';
SET lock_timeout = '5s';
BEGIN;

CREATE OR REPLACE FUNCTION public.market_source_landing_read(p_source text DEFAULT NULL::text, p_hour timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_window jsonb := NULL;
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
      'held_since', CASE
        WHEN d.landed_at IS NULL OR v_raw_platforms IS NULL THEN NULL
        ELSE (SELECT count(*)::int FROM public.vehicle_events se
              WHERE se.source_platform = ANY(v_raw_platforms) AND se.created_at > d.landed_at)
      END,
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

  -- Whole-window measures: every event landed in the window (the selected hour, else the last 24 hours), not the 40 shown.
  -- Statuses read as the source recorded them; an archived capture's 'active' is its state when captured.
  IF v_has_event_meta AND v_raw_platforms IS NOT NULL AND cardinality(v_raw_platforms) > 0 THEN
    EXECUTE $q$
      WITH win AS MATERIALIZED (
        SELECT e.event_status,
               coalesce(e.final_price, e.current_price, e.starting_price) AS price,
               coalesce(e.metadata #>> '{page,archive,archive_timestamp}', e.metadata->>'archive_timestamp') IS NOT NULL AS archived
        FROM public.vehicle_events e
        WHERE e.source_platform = ANY($1)
          AND CASE WHEN $2::timestamptz IS NOT NULL
                   THEN e.created_at >= $2 AND e.created_at < $2 + interval '1 hour'
                   ELSE e.created_at >= now() - interval '24 hours' END
        LIMIT 30000
      )
      SELECT jsonb_build_object(
        'since', CASE WHEN $2::timestamptz IS NOT NULL THEN $2 ELSE now() - interval '24 hours' END,
        'events', count(*),
        'capped', count(*) >= 30000,
        'sold', count(*) FILTER (WHERE event_status = 'sold'),
        'ended', count(*) FILTER (WHERE event_status IN ('ended', 'reserve_not_met', 'unsold', 'withdrawn')),
        'live', count(*) FILTER (WHERE event_status IN ('active', 'live', 'bid-goes-on', 'listed')),
        'archived', count(*) FILTER (WHERE archived),
        'sold_priced', count(*) FILTER (WHERE event_status = 'sold' AND price > 0),
        'median_sold_price', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
                                    FILTER (WHERE event_status = 'sold' AND price > 0))::numeric)
      )
      FROM win
    $q$ INTO v_window USING v_raw_platforms, v_target_hour;
  END IF;

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
          'created_at', x.created_at,
          'archived', x.archived,
          'captured_at', x.captured_at
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
                   substring(e.source_url from '/[a-z-]+-(19[89][0-9]|20[0-2][0-9])/docket/'),
                   arc.iso
                 ) AS record_date,
                 arc.iso AS captured_at,
                 arc.ts IS NOT NULL AS archived,
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
          CROSS JOIN LATERAL (
            SELECT t.ts, CASE WHEN t.ts ~ '^[0-9]{14}$' THEN substr(t.ts, 1, 4) || '-' || substr(t.ts, 5, 2) || '-' || substr(t.ts, 7, 2)
                                 || 'T' || substr(t.ts, 9, 2) || ':' || substr(t.ts, 11, 2) || ':' || substr(t.ts, 13, 2) || 'Z' END AS iso
            FROM (SELECT coalesce(e.metadata #>> '{page,archive,archive_timestamp}', e.metadata->>'archive_timestamp') AS ts) t
          ) arc
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
            substring(m.source_url from '/[a-z-]+-(19[89][0-9]|20[0-2][0-9])/docket/'),
            arc.iso
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
          'created_at', m.created_at,
          'archived', arc.ts IS NOT NULL,
          'captured_at', arc.iso
        ) ORDER BY m.created_at DESC), '[]'::jsonb)
        FROM matched m
        LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
        CROSS JOIN LATERAL (
          SELECT t.ts, CASE WHEN t.ts ~ '^[0-9]{14}$' THEN substr(t.ts, 1, 4) || '-' || substr(t.ts, 5, 2) || '-' || substr(t.ts, 7, 2)
                               || 'T' || substr(t.ts, 9, 2) || ':' || substr(t.ts, 11, 2) || ':' || substr(t.ts, 13, 2) || 'Z' END AS iso
          FROM (SELECT coalesce(m.metadata #>> '{page,archive,archive_timestamp}', m.metadata->>'archive_timestamp') AS ts) t
        ) arc
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

  RETURN v_summary || jsonb_build_object('recent', v_recent, 'window', v_window);
END;
$function$;

-- eBay Motors' species evidence was examined 2026-10-18, before the Internet Archive captures became its largest intake:
-- 18,194 of the 19,332 rows held on 2026-10-20 05:40Z read through them (extract-ebay-motors archive action), 1,121 through
-- Firecrawl, 17 through the Browse API (vehicle_events.metadata.source). The panel printed only the 1,121. Same grain and
-- clock as before (one source, species_evidence.examined_at); the species and the listing rule are unchanged.
DO $evidence$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'observation_sources' AND column_name = 'species_evidence') THEN
    EXECUTE $q$
      UPDATE public.observation_sources
      SET species_evidence = species_evidence || jsonb_build_object(
        'examined_at', '2026-10-20',
        'examined', jsonb_build_array(
          'listing_page_snapshots ebay https://www.ebay.com/sch/i.html?LH_BIN=1&_nkw=car&_sacat=6001 (direct fetch, HTTP 403, 2026-10-09 and 10-10)',
          'supabase/functions/extract-ebay-motors/browseApi.ts (eBay Browse API with an application token)',
          'supabase/functions/extract-ebay-motors/archiveLand.ts (Internet Archive captures of eBay item pages, read free)',
          'vehicle_events ebay_motors metadata.source and metadata.buying_options (19,332 rows, 2026-10-20)'),
        'seen', 'Direct fetches are refused (403); reads go through the token-gated Browse API, Firecrawl, or the Internet Archive''s captures of eBay item pages (2005-2013). Held 2026-10-20: 18,194 rows from archived pages (AUCTION 14,764, FIXED_PRICE 3,430), 1,121 through Firecrawl (FIXED_PRICE+BEST_OFFER 714, AUCTION 198, CLASSIFIED_AD 180, FIXED_PRICE 27, no format 2), 17 through the Browse API. An archived page''s status is its state when captured, not now.')
      WHERE slug = 'ebay_motors' AND species_evidence ->> 'examined_at' = '2026-10-18'
    $q$;
  END IF;
END
$evidence$;
COMMIT;
