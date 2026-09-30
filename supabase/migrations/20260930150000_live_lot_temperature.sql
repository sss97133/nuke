-- live_lot_temperature(vehicle_id): a live BaT lot's price and activity, each placed among comparable past lots
-- at the same hours to close. Read by the vehicle page's two history strips (PRICE, ACTIVITY).
--
-- WHY: the board's hot/cold tag (heatOf in MarketPulse.tsx) is price only: the bid over a typical bid at this time
-- to close, cut at 0.8x and 1.25x. The owner (docs/features/ask-nuke/THEORY.md, owner notes 2026-09-29) asked for
-- percentiles, and for activity measured against comparables. Since 2026-09-30 bat-live-pull reads every live lot's
-- comments and bids into auction_comments (20260930000000_bat_live_pull.sql), so the live lot and its comparables
-- are counted from the same rows the same way.
--
-- WHAT IT COUNTS, as of the lot's last read (the reader upserts the lot's auction_events row on every read):
--   h         = hours from that read to the close.
--   the lot   = its bid rows so far: the high bid, the bid count and the distinct bidders (counted, never returned).
--   comparable lots = finished BaT lots of the same make and model (exact, through idx_vehicles_make_model), from
--               the 300 most recent vehicles by end date; one lot per listing slug; each counted only from its rows
--               posted h or more hours before its own close.
--   PRICE     = the lot's high bid against the high bid each comparable SOLD lot had at h (sold lots with a bid by
--               then; auction_events.outcome for that listing, else the vehicle's sale_status).
--   ACTIVITY  = the lot's bids and bidders against every comparable lot's bids and bidders at h (zeros count).
-- The band's cohort logic (scripts/market/live-bands.sql) runs in DuckDB over the local archive and leaves only the
-- band in prod (hammer_predictions), not its member lots, so this reads make and model from vehicles.
-- Fewer than 8 comparables: the page says "not enough comparables", never a guess.
--
-- READ-ONLY AND CHEAP: one SQL statement (LANGUAGE sql, STABLE, SECURITY INVOKER, so RLS applies as the caller: all
-- three tables have public read policies). No INSERT/UPDATE/DELETE, no temp tables, no volatile calls.
-- Lookups are indexed: vehicles by id and by (make, model); auction_comments by vehicle_id
-- (auction_comments_vehicle_content_hash_key leads with vehicle_id); auction_events by vehicle_id. At most 301
-- vehicles' comment rows are read.
-- MEASURED 2026-09-30 ~14:40Z, this body run as a plain SELECT under SET LOCAL ROLE anon and transaction_read_only
-- (nothing created): the SL500 (f8c68f0e), read 12:24Z at 5.1 h to close, took 4.0 s cold and 0.33 s warm.
-- 300 vehicles gave 305 finished lots. PRICE: bid $9,400 above 62 of 273 sold lots with a bid by then (23rd
-- percentile). ACTIVITY: 33 bids above 246 of 305 lots (6 level), 14 bidders above 233 of 305 (16 level).
-- A first version matched lower(make)/lower(model): as anon, RLS kept lower() out of the index condition and the
-- plan walked the whole table (15 s timeout), so it compares make and model exactly.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.live_lot_temperature(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path = public
 SET statement_timeout = '8s'
 SET lock_timeout = '2s'
AS $function$
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
    SELECT v.id, v.sale_status
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
  lots AS (  -- each of their BaT lots, counted from rows posted h or more hours before its own close
    SELECT c.vehicle_id,
           substring(c.source_url FROM '/listing/([^/?#]+)') AS slug,
           count(*) AS n_rows,
           max(c.posted_at + c.hours_until_close * interval '1 hour') AS closed_at,
           count(*) FILTER (WHERE c.comment_type = 'bid' AND c.hours_until_close >= at.h) AS bids,
           count(DISTINCT c.author_username) FILTER (WHERE c.comment_type = 'bid' AND c.hours_until_close >= at.h) AS bidders,
           max(c.bid_amount) FILTER (WHERE c.comment_type = 'bid' AND c.hours_until_close >= at.h) AS bid
    FROM at
    CROSS JOIN cand
    JOIN auction_comments c ON c.vehicle_id = cand.id
    WHERE c.platform = 'bat'
      AND c.hours_until_close IS NOT NULL
      AND c.posted_at IS NOT NULL
      AND c.source_url ~ '/listing/[^/?#]+'
    GROUP BY 1, 2
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

-- The page calls it as anon. Functions postgres creates in public get EXECUTE for postgres and service_role only
-- (pg_default_acl, read 2026-09-30), so the RPC needs this grant on the function. No table grants.
GRANT EXECUTE ON FUNCTION public.live_lot_temperature(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify (read-only):
--   SELECT live_lot_temperature('<a live BaT vehicle id>') #- '{price,comps}' #- '{activity,comps}' #- '{activity,comps_bidders}';
--   curl "$SUPA/rest/v1/rpc/live_lot_temperature" -H "apikey: $ANON" -d '{"p_vehicle_id":"<a live BaT vehicle id>"}'
