-- live_lot_temperature: the comparable lots are folded once, and read with one bitmap scan.
--
-- A live BaT lot's page asks "where does this bid sit against past lots of the same make and model, at this many hours
-- to close". pg_stat_statements since 2026-09-29: anon 265 calls, mean 1,838 ms, max 7,893 ms (the function's own 8 s
-- statement_timeout); authenticated 21 calls, mean 2,801 ms, max 6,994 ms. Measured 2026-10-14, as anon, for the 2003
-- Porsche 911 Turbo (441 comparable vehicles, the function reads 300) and the 1998 911 Carrera S (352):
--   through the function: first call 13,358 ms and 10,066 ms, then 3,796 ms and 1,682 ms
--   the function's statement, EXPLAIN ANALYZE, warm: 2,402-2,974 ms and 2,259-2,494 ms
-- Two causes, from the plan:
--   * CPU: `lots` joined every comment row of the 300 comparables (34,281 rows) to the 206 closes with a nested loop that
--     scans the closes once per row, 7 million comparisons, about 2.0 s of the 2.4 s. The planner takes every CTE here for
--     one row and never reconsiders.
--   * I/O: the comments of 300 vehicles are read one index scan at a time, a heap page at a time, from a table of 20
--     million rows (11 GB): 6,300-10,500 buffers read in sequence when cold.
--
-- After:
--   * `lot_folded` folds the comment rows to one row per (vehicle, listing) in one pass: the row count, and the bid rows as
--     aligned arrays (time, bidder, amount). `lot_close` joins that to the closes first (about 320 x 206, materialized),
--     and `lots` counts the bids posted h hours before each close from the arrays, once per lot. Same counts, same
--     distinct bidders, same maximum; lots x lots instead of rows x lots.
--   * The comments are read with one `vehicle_id = ANY (the 300 ids)` scan, and enable_indexscan is off for this function, so
--     it is a bitmap heap scan: the pages are prefetched (effective_io_concurrency is 200 here) instead of fetched one at
--     a time. The repo already keeps a bitmap preference local to one reader (_read_photo_library_owner_images, 20261005034243).
--
-- Measured 2026-10-14, as anon, the final statement as a generic plan (what a SQL function runs), warm:
--   2003 Porsche 911 Turbo      before 2,476-2,974 ms   after 458-476 ms
--   1998 Porsche 911 Carrera S  before 2,307-2,494 ms   after 418-437 ms
--   a 22-vehicle cohort         before 49 ms            after 35-43 ms
-- Cold, on cohorts of 300 comparables not read before, same generic plan, anon: folded with plain index scans 4,197-5,111 ms
-- (S2000, TR6, Boxster, Land Cruiser FZJ80); folded with the bitmap read 1,444-2,477 ms (Bronco, 911 Carrera Cabriolet,
-- Corvette Convertible, 280SL). Buffers read are about the same (5,900-9,500); the prefetch overlaps them. The cold "before" is
-- the two first calls above, on other cohorts of the same size.
-- Same answers: the live statement and the new one compared in a single SQL statement (one snapshot) on 11 ids on 2026-10-14,
-- live lots with 0 to 172 priced comparables, a live lot with none, a sold vehicle and a test vehicle: 0 differ.
--
-- Return shape, signature, STABLE, SECURITY INVOKER, search_path, statement_timeout and grants are unchanged. No table,
-- policy, row or cron change. Source guard: replaced only from the 2026-10-14 definition (md5 below); a re-run is a no-op.
-- Contract: supabase/sql/test_live_lot_temperature_folded.sql (CI job live-lot-temperature-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.live_lot_temperature(uuid)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.live_lot_temperature(uuid) is missing; this migration replaces it';
  END IF;
  IF md5(v_def) <> '3cb206dc2585f7ccfda94a099088b70b'  -- gitleaks:allow (md5 checksum of the 2026-10-14 function definition, not a secret)
     AND v_def NOT LIKE '%live_lot_folded_v1%' THEN
    RAISE EXCEPTION 'live_lot_temperature is not the 2026-10-14 definition this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.live_lot_temperature(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
 SET lock_timeout TO '2s'
 SET enable_indexscan TO 'off'
AS $function$
  -- live_lot_folded_v1
  -- enable_indexscan is off for this function only: it reads the rows of up to 300 comparable vehicles from tables far larger
  -- than memory, and a bitmap scan prefetches those heap pages where an index scan fetches them one at a time.
  WITH lot AS (   -- the live lot, with an end time that has a clock (a bare date would move h by up to a day)
    SELECT v.id,
           v.make,
           v.model,
           v.auction_end_date::timestamptz AS ends_at,
           substring(v.listing_url FROM '/listing/([^/?#]+)') AS slug
    FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND v.sale_status = 'auction_live'
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
      AND v.listing_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
  ),
  own AS (   -- the lot's own rows from this listing, as of its last read
    SELECT count(*) AS n_rows,
           count(*) FILTER (WHERE c.comment_type = 'bid') AS bids,
           count(DISTINCT c.author_username) FILTER (WHERE c.comment_type = 'bid') AS bidders,
           max(c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid,
           max(c.created_at) AS last_row_at
    FROM lot
    JOIN auction_comments c ON c.vehicle_id = lot.id
    WHERE substring(c.source_url FROM '/listing/([^/?#]+)') = lot.slug
  ),
  at AS (    -- when it was read, and the hours to close at that moment
    SELECT lot.*,
           r.read_at,
           extract(epoch FROM (lot.ends_at - r.read_at)) / 3600.0 AS h
    FROM lot
    CROSS JOIN own
    CROSS JOIN LATERAL (
      SELECT least(now(), greatest(own.last_row_at, (
               SELECT max(e.updated_at) FROM auction_events e
               WHERE e.vehicle_id = lot.id
                 AND substring(e.source_url FROM '/listing/([^/?#]+)') = lot.slug))) AS read_at
    ) r
    WHERE own.n_rows > 0
      AND lot.ends_at > now()
  ),
  cand AS (  -- comparable vehicles: same make and model, a BaT listing, not live; the 300 most recent
    -- Exact make and model through idx_vehicles_make_model. Under RLS (SECURITY INVOKER, anon) a qual that calls a
    -- non-leakproof function such as lower() can't be an index condition, and that plan read the whole table
    -- (timed out at 15 s as anon); plain text equality is leakproof: 0.76 s cold for 1,245 SL500 rows.
    SELECT v.id, v.sale_status,
           substring(v.listing_url FROM '/listing/([^/?#]+)') AS slug,
           v.auction_end_date AS ends
    FROM vehicles v
    WHERE v.make = (SELECT at.make FROM at)
      AND v.model = (SELECT at.model FROM at)
      AND v.id <> p_vehicle_id
      AND v.deleted_at IS NULL
      AND v.merged_into_vehicle_id IS NULL
      AND v.sale_status IS DISTINCT FROM 'auction_live'
      AND v.listing_url ~ 'bringatrailer\.com/listing/'
    ORDER BY v.auction_end_date DESC NULLS LAST
    LIMIT 300
  ),
  lot_folded AS (  -- their BaT comment and bid rows, folded to one row per listing slug in one pass: every row counted
                   -- (n_rows) and the bid rows kept as aligned arrays (event time only: posted_at). The joins below are
                   -- then lots x lots, not rows x lots (K5-sized cohorts: 34,000 rows x 206 lots, run as a nested loop).
    SELECT c.vehicle_id,
           substring(c.source_url FROM '/listing/([^/?#]+)') AS slug,
           count(*) AS n_rows,
           array_agg(c.posted_at       ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_at,
           array_agg(c.author_username ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_by,
           array_agg(c.bid_amount      ORDER BY c.posted_at, c.author_username, c.bid_amount) FILTER (WHERE c.comment_type = 'bid') AS bid_amt
    FROM auction_comments c
    WHERE c.vehicle_id = ANY (ARRAY(SELECT cand.id FROM cand))   -- one bitmap scan over all the comparables, not one scan each
      AND c.platform = 'bat'
      AND c.posted_at IS NOT NULL
      AND c.source_url ~ '/listing/[^/?#]+'
    GROUP BY 1, 2
  ),
  closes AS (  -- one close per lot: auction_events.auction_end_date for that listing (latest row), else the vehicle's
               -- own end when it is this listing's and carries a clock. A lot with neither has no h: unknown, not counted.
               -- C5: auction_comments.hours_until_close is not read here; it was derived from ingest time on 73% of rows.
    SELECT k.vehicle_id, k.slug,
           COALESCE(ev.auction_end_date,
                    CASE WHEN cand.slug = k.slug AND cand.ends ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                         THEN cand.ends::timestamptz END) AS closed_at
    FROM lot_folded k
    JOIN cand ON cand.id = k.vehicle_id
    LEFT JOIN LATERAL (
      SELECT e.auction_end_date FROM auction_events e
      WHERE e.vehicle_id = k.vehicle_id
        AND e.auction_end_date IS NOT NULL
        AND substring(e.source_url FROM '/listing/([^/?#]+)') = k.slug
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 1
    ) ev ON true
  ),
  lot_close AS MATERIALIZED (  -- each folded lot with its close: lots x lots, joined before anything is computed per lot
    SELECT f.vehicle_id, f.slug, f.n_rows, cl.closed_at, f.bid_at, f.bid_by, f.bid_amt
    FROM lot_folded f
    JOIN closes cl ON cl.vehicle_id = f.vehicle_id AND cl.slug = f.slug
    WHERE cl.closed_at IS NOT NULL
  ),
  lots AS (  -- each lot with a known close, counted from bid rows posted h or more hours before that close
    SELECT lc.vehicle_id,
           lc.slug,
           lc.n_rows,
           lc.closed_at,
           b.bids,
           b.bidders,
           b.bid
    FROM at
    CROSS JOIN lot_close lc
    CROSS JOIN LATERAL (
      SELECT count(*) AS bids,
             count(DISTINCT u.a) AS bidders,
             max(u.amt) AS bid
      FROM unnest(lc.bid_at, lc.bid_by, lc.bid_amt) AS u(t, a, amt)
      WHERE u.t <= lc.closed_at - at.h * interval '1 hour'
    ) b
  ),
  comp AS (  -- one row per finished listing (a lot on two vehicles counts once), with whether it sold
    SELECT DISTINCT ON (l.slug)
           l.slug, l.closed_at, l.bids, l.bidders, l.bid,
           COALESCE(ev.outcome = 'sold', cand.sale_status = 'sold') AS sold
    FROM lots l
    JOIN cand ON cand.id = l.vehicle_id
    LEFT JOIN LATERAL (
      SELECT e.outcome FROM auction_events e
      WHERE e.vehicle_id = l.vehicle_id
        AND substring(e.source_url FROM '/listing/([^/?#]+)') = l.slug
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 1
    ) ev ON true
    WHERE l.closed_at < now()
      AND l.slug IS DISTINCT FROM (SELECT slug FROM at)
    ORDER BY l.slug, l.n_rows DESC
  ),
  price AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE c.bid < own.bid) AS below,
           count(*) FILTER (WHERE c.bid = own.bid) AS same,
           COALESCE(jsonb_agg(c.bid ORDER BY c.bid), '[]'::jsonb) AS comps,
           min(c.closed_at) AS first_close,
           max(c.closed_at) AS last_close
    FROM comp c
    CROSS JOIN own
    WHERE c.sold AND c.bid IS NOT NULL
  ),
  activity AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE c.bids < own.bids) AS bids_below,
           count(*) FILTER (WHERE c.bids = own.bids) AS bids_same,
           count(*) FILTER (WHERE c.bidders < own.bidders) AS bidders_below,
           count(*) FILTER (WHERE c.bidders = own.bidders) AS bidders_same,
           COALESCE(jsonb_agg(c.bids ORDER BY c.bids), '[]'::jsonb) AS comps,
           COALESCE(jsonb_agg(c.bidders ORDER BY c.bidders), '[]'::jsonb) AS comps_bidders,
           min(c.closed_at) AS first_close,
           max(c.closed_at) AS last_close
    FROM comp c
    CROSS JOIN own
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lot) THEN jsonb_build_object('status', 'not_live')
    WHEN (SELECT l.ends_at FROM lot l) <= now() THEN jsonb_build_object('status', 'ended')
    WHEN NOT EXISTS (SELECT 1 FROM at) THEN jsonb_build_object('status', 'not_read')
    ELSE (
      SELECT jsonb_build_object(
        'status', 'ok',
        'make', at.make,
        'model', at.model,
        'read_at', at.read_at,
        'ends_at', at.ends_at,
        'hours_left', round(at.h::numeric, 2),
        'min_comparables', 8,
        'vehicles_cap', 300,
        'vehicles_considered', (SELECT count(*) FROM cand),
        'lots_without_close', (SELECT count(*) FROM closes WHERE closed_at IS NULL),
        'price', jsonb_build_object(
          'bid', own.bid,
          'n', price.n, 'below', price.below, 'same', price.same,
          'first_close', price.first_close, 'last_close', price.last_close,
          'comps', price.comps),
        'activity', jsonb_build_object(
          'bids', own.bids, 'bidders', own.bidders,
          'n', activity.n,
          'bids_below', activity.bids_below, 'bids_same', activity.bids_same,
          'bidders_below', activity.bidders_below, 'bidders_same', activity.bidders_same,
          'first_close', activity.first_close, 'last_close', activity.last_close,
          'comps', activity.comps, 'comps_bidders', activity.comps_bidders))
      FROM at, own, price, activity
    )
  END;
$function$;

COMMIT;

-- Live verification (after apply), as anon through PostgREST, a live BaT lot with a large cohort, e.g. a 2003 Porsche 911 Turbo
-- (select id from vehicles where sale_status='auction_live' and platform_source='bringatrailer' and model ilike '911 Turbo%'):
--   POST /rest/v1/rpc/live_lot_temperature {"p_vehicle_id":"<id>"}   -- status ok, vehicles_considered 300; warm under 1 s, cold under 4 s (before: 3.8 s warm, 10-13 s cold, timeouts at 8 s)
