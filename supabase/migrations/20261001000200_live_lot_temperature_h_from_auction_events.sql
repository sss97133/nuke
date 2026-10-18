-- C5 (docs/ledger/theory/data-machine-cases.md): live_lot_temperature keyed its comparable cohort on
-- auction_comments.hours_until_close, a derived time the 2026-01..04 loaders computed from ingest time. It is wrong
-- on 73% of checkable rows (median error about 2 years), right on 98.8% of rows written since 2026-09-27.
--
-- MEASURED before (2026-10-01 01:20Z, the SL500 cohort: Mercedes-Benz SL500, 300 vehicles, 312 lots, 17,893 rows):
--   183 lots have an auction_events end date; where both keys exist, 4,441 of 10,756 rows disagree by more than 1 h;
--   80 lots are mostly wrong. Under the old key the "bid at 2 h to close" equals the lot's final bid on 179 of 312
--   lots (every row passes a filter when h is 2 years off), and the median lot shows 20 bids by 2 h. Under the new
--   key: 7 of 183, and 6 bids. The old cohort measured the final price and called it the price at h.
--   Close source for the 314 lots: 185 auction_events, 28 the vehicle's own clocked end, 93 a bare date (unknown),
--   8 none. The live call on 99fcbbd4 (2001 SL500, 21.1 h left, bid $19,500): above 209 of 277 sold comparables.
--
-- CHANGE: h for a comparable row is event time minus event time: the lot's close (auction_events.auction_end_date for
--   that listing, latest row; else the vehicle's own end when it is this listing's and has a clock) minus posted_at.
--   hours_until_close is no longer read. A lot with no defensible close is not counted and is reported as
--   lots_without_close. Everything else in the function is the 20260930150000 text.
--   Point-in-time: a bid counts at h only if posted at or before close - h, from times the source published.
--
-- MEASURED after (2026-10-01 02:31Z, this body run as anon, 0.78 s warm, same lot at 15.1 h left, bid $19,500):
--   182 sold comparables with a close (was 277), 101 lots without a close not counted, bid above 157 of 182 (was 209
--   of 277 at 21.1 h). The comparables' bids at h are now their bids at h, not their finals.

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
  lot_rows AS (  -- their BaT comment and bid rows, keyed by listing slug (event time only: posted_at)
    SELECT c.vehicle_id,
           substring(c.source_url FROM '/listing/([^/?#]+)') AS slug,
           c.comment_type, c.bid_amount, c.author_username, c.posted_at
    FROM cand
    JOIN auction_comments c ON c.vehicle_id = cand.id
    WHERE c.platform = 'bat'
      AND c.posted_at IS NOT NULL
      AND c.source_url ~ '/listing/[^/?#]+'
  ),
  closes AS (  -- one close per lot: auction_events.auction_end_date for that listing (latest row), else the vehicle's
               -- own end when it is this listing's and carries a clock. A lot with neither has no h: unknown, not counted.
               -- C5: auction_comments.hours_until_close is not read here; it was derived from ingest time on 73% of rows.
    SELECT k.vehicle_id, k.slug,
           COALESCE(ev.auction_end_date,
                    CASE WHEN cand.slug = k.slug AND cand.ends ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                         THEN cand.ends::timestamptz END) AS closed_at
    FROM (SELECT DISTINCT r.vehicle_id, r.slug FROM lot_rows r) k
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
  lots AS (  -- each lot with a known close, counted from rows posted h or more hours before that close
    SELECT r.vehicle_id,
           r.slug,
           count(*) AS n_rows,
           cl.closed_at,
           count(*) FILTER (WHERE r.comment_type = 'bid' AND r.posted_at <= cl.closed_at - at.h * interval '1 hour') AS bids,
           count(DISTINCT r.author_username) FILTER (WHERE r.comment_type = 'bid' AND r.posted_at <= cl.closed_at - at.h * interval '1 hour') AS bidders,
           max(r.bid_amount) FILTER (WHERE r.comment_type = 'bid' AND r.posted_at <= cl.closed_at - at.h * interval '1 hour') AS bid
    FROM at
    CROSS JOIN lot_rows r
    JOIN closes cl ON cl.vehicle_id = r.vehicle_id AND cl.slug = r.slug
    WHERE cl.closed_at IS NOT NULL
    GROUP BY 1, 2, 4
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

GRANT EXECUTE ON FUNCTION public.live_lot_temperature(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify (read-only):
--   SELECT live_lot_temperature('99fcbbd4-25c8-4f63-86b8-efca13a7f359') #- '{price,comps}' #- '{activity,comps}' #- '{activity,comps_bidders}';
--   price.n about 213 or fewer; lots_without_close about 101; the SL500 row in the ledger carries the numbers.
