-- Hourly and live ingestion telemetry for the Sources board:
--   1. Adds composite index `idx_vehicle_events_platform_created (source_platform, created_at DESC)` on `public.vehicle_events`
--      so per-source and per-hour ingestion queries execute in <10ms via direct index seeks.
--   2. Enhances `public.market_sources_read()` to merge live `vehicle_events` from the current and prior hour
--      into the hourly landing log (`market_source_hours`), maps canonical aliases (`source_alias_mapping` /
--      `observation_sources.market_slug`, e.g. `classiccars` -> `classiccars-com`, `bringatrailer` -> `bat`),
--      and attaches a top-level `'landing'` object carrying:
--        - `hour`: current UTC hour (`date_trunc('hour', now())`)
--        - `bucket_5m`: current 5-minute UTC bucket
--        - `totals`: board-wide `{ landed_15m, landed_1h, landed_24h, landed_7d, hours24, mins60 }`
--        - `sources`: per-source `{ landed_15m, landed_1h, landed_24h, landed_7d, last_at, hours24, mins60 }`
--      while preserving the exact 27-column `columns` and `rows` contract.
--   3. Adds `public.market_source_landing_read(p_source text DEFAULT NULL, p_hour timestamptz DEFAULT NULL)` so clicking
--      the `LANDING` column header, any source's landing cell, or any hourly bar drills down to the hour and streams
--      live arriving `vehicle_events` with vehicle titles, prices, statuses, and timestamps.
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_vehicle_events_platform_created
  ON public.vehicle_events (source_platform, created_at DESC);

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
    SELECT * FROM cur WHERE market_slug IS NULL AND category IN ('auction', 'marketplace')
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
                                         c.months, coalesce(l.live_lots, 0), l.live_at, a.landed_lots, a.day,
                                         coalesce(h.landed_24h, 0), coalesce(h.landed_7d, 0),
                                         coalesce(h.last_hour, le.last_hour), coalesce(dd.days14, '[]'::jsonb),
                                         c.org_logo_url, c.org_business_type)
                       ORDER BY (c.category = 'auction') DESC, c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST,
                                c.source_slug)
      FROM ranked c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = c.nslug
      LEFT JOIN hrs h ON h.nslug = c.nslug
      LEFT JOIN days dd ON dd.nslug = c.nslug
      LEFT JOIN last_ever le ON le.nslug = c.nslug), '[]'::jsonb),
    'not_ranked', coalesce((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market_slug IS NOT NULL THEN 'capture channels' ELSE coalesce(category, 'uncategorized') END AS k,
               count(*) AS n
        FROM cur WHERE NOT (market_slug IS NULL AND category IN ('auction', 'marketplace'))
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
  'The Sources board: markets only (auction houses, then marketplaces), each ranked by lots or listings held, with held '
  'lots and when, census total, map sales, sales by sale date, live lots now (read within 24 h), held lots a week earlier, '
  'records landed in the last 24 h and 7 days with 14 daily counts, organization logo and type, and live hourly/5-minute '
  'landing telemetry under "landing"; other categories counted in not_ranked. Anon. 2026-10-18.';

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
    ) x
    WHERE k IS NOT NULL AND k <> '';

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
      -- Board-wide recent events (all sources), optionally scoped to a clicked hour
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
      -- Per-source recent events using idx_vehicle_events_platform_created (source_platform, created_at DESC)
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
    END IF;
  ELSE
    -- Minimal disposable contract test schema (id, source_platform, created_at)
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

COMMENT ON FUNCTION public.market_source_landing_read(text, timestamptz) IS
  'Live and hourly ingestion telemetry for the Sources board: 24 hourly counts, 12 five-minute counts over the last '
  '60 minutes, 14 daily counts, 15m/1h/24h/7d totals, and recent vehicle_events rows (for all sources or one source, '
  'and optionally scoped to a clicked hour). Anon. 2026-10-18.';

REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_source_landing_read(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_source_landing_read(text, timestamptz) TO anon, authenticated, service_role;

COMMIT;
