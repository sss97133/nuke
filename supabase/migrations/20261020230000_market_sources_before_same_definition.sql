-- Sources board reader: a week-earlier reading counts only when it counted the same thing, and shorter group units.
-- Live after 20261020201000 (2026-10-19 22:20 PT, logged-out capture): dealers whose BaT lots were set apart showed a
-- red "-3,135 since Oct 9" because held_lots_before came from a reading taken under the old definition (BaT lots
-- inside held). The reader now carries a before reading only when both readings agree on whether venue lots are
-- set apart. The two new groups' units ("BaT lots, by seller cohort", "vehicles with owner records") collided with the
-- next column header on the board, so they are the short "BaT lots" and "vehicles"; the group title says the rest.
-- Re-read from the 20261020201000 body; only the ago CTE, the two before columns and the units change.
SET statement_timeout = '60s';
SET lock_timeout = '5s';
BEGIN;

CREATE OR REPLACE FUNCTION public.source_species_groups()
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT jsonb_agg(jsonb_build_object('species', s, 'label', public.source_species_label(s::public.source_species),
                                      'unit', u, 'counts_as_held', h) ORDER BY o)
  FROM (VALUES
    (1, 'timed_auction', 'lots held', true),
    (2, 'block_house', 'lots held', true),
    (3, 'dealer', 'vehicles held', true),
    (4, 'classifieds', 'posts held', true),
    (5, 'auth_walled_marketplace', 'listings held', true),
    (6, 'aggregator', 'pages read, not listings held', false),
    (7, 'private_seller', 'BaT lots', false),
    (8, 'owner_private', 'vehicles', false)
  ) g(o, s, u, h) $$;

CREATE OR REPLACE FUNCTION public.market_sources_read()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH d AS (
    SELECT max(day) AS day FROM public.market_source_days
  ), cur AS (
    SELECT m.day, m.source_slug, m.display_name, m.category, m.house, m.landed_lots, m.landed_at, m.population,
           m.population_method, m.population_confidence, m.population_at, m.map_sales, m.map_usd, m.sales_12m, m.usd_12m,
           m.sales_prior_12m, m.usd_prior_12m, m.months, m.recorded_at, m.venue_lots, m.venue_slug, m.members,
           o.market_slug, coalesce(o.species, m.species) AS species, o.species_evidence,
           regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') AS nslug,
           b.logo_url AS org_logo_url, b.business_type AS org_business_type
    FROM public.market_source_days m
    JOIN d ON m.day = d.day
    LEFT JOIN public.observation_sources o ON o.slug = m.source_slug
    LEFT JOIN public.organizations b ON b.id = o.business_id
  ), ranked AS (
    SELECT * FROM cur WHERE market_slug IS NULL AND species::text IN ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator', 'private_seller', 'owner_private')
  ), held_keys AS (
    SELECT DISTINCT nslug FROM ranked WHERE species::text NOT IN ('aggregator', 'private_seller', 'owner_private')
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
  ), grade AS (
    SELECT c.source_slug,
           jsonb_build_object(
             'reference', r.universe_total, 'reference_method', r.census_method, 'reference_at', r.census_at,
             'census', c.population, 'census_method', c.population_method, 'census_at', c.population_at,
             'error', round((r.universe_total - c.population)::numeric / c.population, 4)
           ) AS population_grade
    FROM ranked c
    CROSS JOIN LATERAL (
      SELECT sc.universe_total, sc.census_method, sc.census_at
      FROM public.source_census sc
      JOIN public.observation_sources o ON o.id = sc.source_id
      WHERE regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') = c.nslug
        AND sc.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate')
        AND sc.universe_total > 0
        AND sc.census_at < c.population_at
      ORDER BY sc.census_at DESC
      LIMIT 1
    ) r
    WHERE c.population > 0
      AND c.population_method NOT IN ('owner_reference', 'catalogue_estimate', 'estimate')
  ), ago AS (
    -- the latest reading at least a week old, comparable only when it counted the same thing: a dealer reading
    -- taken before its BaT lots were set apart (venue_lots unset) is not the held count's own history
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots, m.venue_lots
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
      JOIN held_keys r USING (nslug)
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
      JOIN held_keys r USING (nslug)
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
                                 'logo_url', 'business_type', 'population_grade', 'species', 'species_label',
                                 'counts_as_held', 'species_evidence', 'venue_lots', 'venue_slug', 'members'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months,
                                         coalesce(l.live_lots, dl.live_lots, 0),
                                         coalesce(l.live_at, dl.live_at),
                                         CASE WHEN (a.venue_lots IS NULL) = (c.venue_lots IS NULL) THEN a.landed_lots END,
                                         CASE WHEN (a.venue_lots IS NULL) = (c.venue_lots IS NULL) THEN a.day END,
                                         coalesce(h.landed_24h, 0), coalesce(h.landed_7d, 0),
                                         coalesce(h.last_hour, le.last_hour), coalesce(dd.days14, '[]'::jsonb),
                                         c.org_logo_url, c.org_business_type, g.population_grade, c.species,
                                         public.source_species_label(c.species),
                                         c.species::text NOT IN ('aggregator', 'private_seller', 'owner_private'),
                                         c.species_evidence, c.venue_lots, c.venue_slug, c.members)
                       ORDER BY CASE c.species::text WHEN 'timed_auction' THEN 1 WHEN 'block_house' THEN 2 WHEN 'dealer' THEN 3
                                  WHEN 'classifieds' THEN 4 WHEN 'auth_walled_marketplace' THEN 5 WHEN 'aggregator' THEN 6
                                  WHEN 'private_seller' THEN 7 WHEN 'owner_private' THEN 8
                                  ELSE 9 END,
                                c.landed_lots DESC NULLS LAST, c.venue_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST,
                                c.source_slug)
      FROM ranked c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = c.nslug
      LEFT JOIN dealer_live dl ON dl.nslug = c.nslug
      LEFT JOIN hrs h ON h.nslug = c.nslug
      LEFT JOIN days dd ON dd.nslug = c.nslug
      LEFT JOIN last_ever le ON le.nslug = c.nslug
      LEFT JOIN grade g ON g.source_slug = c.source_slug), '[]'::jsonb),
    'not_ranked', coalesce((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market_slug IS NOT NULL THEN 'capture channels'
                    WHEN species IS NULL THEN 'no species evidence' ELSE species::text END AS k,
               count(*) AS n
        FROM cur WHERE NOT (market_slug IS NULL AND coalesce(species::text, '') IN ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator', 'private_seller', 'owner_private'))
        GROUP BY 1) x), '{}'::jsonb),
    'species_groups', public.source_species_groups(),
    'landing', jsonb_build_object(
      'hour', date_trunc('hour', now()),
      'bucket_5m', to_timestamp(floor(extract(epoch from now()) / 300) * 300),
      'totals', jsonb_build_object(
        'landed_15m', coalesce((SELECT sum(w.landed_15m)::int FROM live_win w JOIN held_keys r USING (nslug)), 0),
        'landed_1h', coalesce((SELECT sum(w.landed_1h)::int FROM live_win w JOIN held_keys r USING (nslug)), 0),
        'landed_24h', coalesce((SELECT sum(h.landed_24h)::int FROM hrs h JOIN held_keys r USING (nslug)), 0),
        'landed_7d', coalesce((SELECT sum(h.landed_7d)::int FROM hrs h JOIN held_keys r USING (nslug)), 0),
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
$function$;
COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: sources holding listings ranked by held lots within their species (source_species_groups(), the '
  'names of data-machine-cases.md §6), each row with its species, label, whether it counts as listings held (aggregators, '
  'private-seller cohorts and owner sources do not), its species evidence, its venue lots (a dealer''s BaT lots, apart), the '
  'venue and a cohort''s members; a week-earlier held count only from a reading that counted the same thing; capture '
  'channels, media sources and sources without species evidence counted in not_ranked. Board totals count listing-holding '
  'species only. 2026-10-19.';

COMMIT;
