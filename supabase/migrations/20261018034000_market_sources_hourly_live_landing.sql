-- Hourly and live ingestion telemetry for the Sources board:
--   1. Enhances `public.market_sources_read()` to merge live `vehicle_events` from the current and prior hour
--      into the hourly landing log (`market_source_hours`), and attaches a top-level `'landing'` object carrying:
--        - `hour`: current UTC hour (`date_trunc('hour', now())`)
--        - `bucket_5m`: current 5-minute UTC bucket
--        - `totals`: board-wide `{ landed_15m, landed_1h, landed_24h, landed_7d, hours24, mins60 }`
--        - `sources`: per-source `{ landed_15m, landed_1h, landed_24h, landed_7d, last_at, hours24, mins60 }`
--      while preserving the exact 27-column `columns` and `rows` contract.
--   2. Adds `public.market_source_landing_read(p_source text DEFAULT NULL, p_hour timestamptz DEFAULT NULL)` so clicking
--      the `LANDING` column header, any source's landing cell, or any hourly bar drills down to the hour and streams
--      live arriving `vehicle_events` with vehicle titles, prices, statuses, and timestamps.
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

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
    SELECT regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') AS nslug,
           e.created_at,
           date_trunc('hour', e.created_at) AS hour,
           to_timestamp(floor(extract(epoch from e.created_at) / 300) * 300) AS b5
    FROM public.vehicle_events e
    WHERE e.created_at >= date_trunc('hour', now()) - interval '1 hour'
      AND e.source_platform IS NOT NULL
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
  ), hrs_merged AS (
    SELECT coalesce(h.source_key, l.nslug) AS nslug,
           coalesce(h.hour, l.hour) AS hour,
           GREATEST(coalesce(h.records, 0), coalesce(l.records, 0))::int AS records
    FROM (
      SELECT source_key, hour, records
      FROM public.market_source_hours
      WHERE hour >= date_trunc('day', now()) - interval '13 days'
    ) h
    FULL JOIN live_hr_counts l ON l.nslug = h.source_key AND l.hour = h.hour
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
    SELECT source_key AS nslug, max(hour) AS last_hour FROM public.market_source_hours WHERE records > 0 GROUP BY 1
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
    ) x
    WHERE k IS NOT NULL AND k <> '';
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
    IF v_target_hour IS NOT NULL THEN
      EXECUTE $q$
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'source', x.source_platform,
          'event_type', x.event_type,
          'event_status', x.event_status,
          'price', x.price,
          'title', x.title,
          'lot', x.source_listing_id,
          'vehicle_id', x.vehicle_id,
          'source_url', x.source_url,
          'created_at', x.created_at
        ) ORDER BY x.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT e.id,
                 e.source_platform,
                 e.event_type,
                 e.event_status,
                 coalesce(e.final_price, e.current_price, e.starting_price) AS price,
                 coalesce(
                   nullif(trim(e.metadata->>'title'), ''),
                   nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
                   nullif(trim(e.source_listing_id), '')
                 ) AS title,
                 e.source_listing_id,
                 e.vehicle_id,
                 e.source_url,
                 e.created_at
          FROM public.vehicle_events e
          LEFT JOIN public.vehicles v ON v.id = e.vehicle_id
          WHERE e.created_at >= $1 AND e.created_at < $1 + interval '1 hour'
            AND e.source_platform IS NOT NULL
            AND ($2::text[] IS NULL OR regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') = ANY($2))
          ORDER BY e.created_at DESC
          LIMIT 20
        ) x
      $q$ INTO v_recent USING v_target_hour, v_keys;
    ELSIF v_keys IS NULL THEN
      EXECUTE $q$
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'source', x.source_platform,
          'event_type', x.event_type,
          'event_status', x.event_status,
          'price', x.price,
          'title', x.title,
          'lot', x.source_listing_id,
          'vehicle_id', x.vehicle_id,
          'source_url', x.source_url,
          'created_at', x.created_at
        ) ORDER BY x.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT e.id,
                 e.source_platform,
                 e.event_type,
                 e.event_status,
                 coalesce(e.final_price, e.current_price, e.starting_price) AS price,
                 coalesce(
                   nullif(trim(e.metadata->>'title'), ''),
                   nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
                   nullif(trim(e.source_listing_id), '')
                 ) AS title,
                 e.source_listing_id,
                 e.vehicle_id,
                 e.source_url,
                 e.created_at
          FROM public.vehicle_events e
          LEFT JOIN public.vehicles v ON v.id = e.vehicle_id
          WHERE e.created_at >= now() - interval '24 hours'
            AND e.source_platform IS NOT NULL
          ORDER BY e.created_at DESC
          LIMIT 20
        ) x
      $q$ INTO v_recent;
    ELSE
      EXECUTE $q$
        WITH target_hrs AS (
          SELECT $1::timestamptz AS hour
          UNION
          SELECT $1::timestamptz - interval '1 hour'
          UNION
          (SELECT hour FROM public.market_source_hours WHERE source_key = ANY($2) AND records > 0 ORDER BY hour DESC LIMIT 1)
        ), ordered_hrs AS (
          SELECT hour FROM target_hrs ORDER BY hour DESC
        ), matched AS (
          SELECT e.id,
                 e.source_platform,
                 e.event_type,
                 e.event_status,
                 coalesce(e.final_price, e.current_price, e.starting_price) AS price,
                 e.metadata,
                 e.source_listing_id,
                 e.vehicle_id,
                 e.source_url,
                 e.created_at
          FROM ordered_hrs h
          CROSS JOIN LATERAL (
            SELECT id, source_platform, event_type, event_status, final_price, current_price, starting_price,
                   metadata, source_listing_id, vehicle_id, source_url, created_at
            FROM public.vehicle_events e
            WHERE e.created_at >= h.hour AND e.created_at < h.hour + interval '1 hour'
              AND e.source_platform IS NOT NULL
              AND regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') = ANY($2)
            ORDER BY e.created_at DESC
            LIMIT 20
          ) e
          ORDER BY e.created_at DESC
          LIMIT 20
        )
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id,
          'source', m.source_platform,
          'event_type', m.event_type,
          'event_status', m.event_status,
          'price', m.price,
          'title', coalesce(
            nullif(trim(m.metadata->>'title'), ''),
            nullif(trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)), ''),
            nullif(trim(m.source_listing_id), '')
          ),
          'lot', m.source_listing_id,
          'vehicle_id', m.vehicle_id,
          'source_url', m.source_url,
          'created_at', m.created_at
        ) ORDER BY m.created_at DESC), '[]'::jsonb)
        FROM matched m
        LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
      $q$ INTO v_recent USING v_now_hour, v_keys;
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
