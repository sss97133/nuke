-- live_bid_tape: read the window through the (kind, ingested_at) index, and apply the public filter once per bid.
--
-- 20261017062000 shipped live_bid_tape with its time window in a joined CTE and as SECURITY INVOKER. Measured
-- 2026-10-15 19:20Z as anon through PostgREST: HTTP 500 after 5.15 s (its own statement_timeout). EXPLAIN as anon:
-- the window from the CTE could not bound an index, so the planner walked idx_observations_vehicle_comment_bid end to
-- end with the window as a join filter (estimated cost 12.2M); with the bound in the WHERE clause the same read takes
-- one index range, but the observation read policy then still runs its vehicle subquery and
-- observation_is_public() on each candidate row (0.6 ms a row, ~0.8 s for 20 minutes of rows).
-- Now: the window bounds are expressions of statement_timestamp() and the parameter, so idx_observations_kind_time
-- serves the range; the read is SECURITY DEFINER and applies the policy's public path itself, once per deduplicated
-- bid: the vehicle is public, observation_is_public(kind, data) holds, and the row is not a garage owner correction.
-- It returns nothing the anonymous read policy would not return: amount, time, scheduled end, vehicle id; no names.
-- Contract: supabase/sql/test_live_bid_tape.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_bid_tape(p_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '5s'
AS $function$
  WITH raw AS (
    SELECT o.vehicle_id, o.observed_at, o.ingested_at, o.kind, o.structured_data,
           o.structured_data #>> '{public_live_frame,data,comment,id}' AS comment_id,
           o.structured_data #>> '{public_live_frame,data,comment,bidAmount}' AS amount_text,
           o.structured_data #>> '{public_live_frame,data,comment,end_timestamp}' AS end_text
    FROM public.vehicle_observations o
    WHERE o.kind = 'bid'
      AND o.ingested_at > statement_timestamp() - make_interval(mins => least(greatest(coalesce(p_minutes, 5), 1), 30) + 15)
      AND o.observed_at > statement_timestamp() - make_interval(mins => least(greatest(coalesce(p_minutes, 5), 1), 30))
      AND o.observed_at <= statement_timestamp() + interval '1 minute'
      AND o.source_identifier LIKE 'public-live:%'
      AND o.vehicle_id IS NOT NULL
      AND NOT coalesce(o.is_superseded, false)
      AND o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'
  ), b AS (
    SELECT DISTINCT ON (r.comment_id) r.vehicle_id, r.observed_at, r.comment_id, r.amount_text::numeric AS amount,
           CASE WHEN r.end_text ~ '^[0-9]{9,11}$' THEN to_timestamp(r.end_text::bigint) END AS end_at,
           r.kind, r.structured_data
    FROM raw r
    WHERE r.comment_id ~ '^[0-9]{1,12}$' AND r.amount_text ~ '^[0-9]{1,10}([.][0-9]+)?$'
    ORDER BY r.comment_id, r.ingested_at, r.observed_at
  )
  SELECT jsonb_build_object(
    'as_of', statement_timestamp(),
    'minutes', least(greatest(coalesce(p_minutes, 5), 1), 30),
    'source', 'Bring a Trailer bids from its live feed, as Nuke records them, once per bid',
    'bids', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.comment_id, 'vehicle_id', b.vehicle_id,
                                                          'amount', b.amount, 'bid_at', b.observed_at, 'end_at', b.end_at)
                                       ORDER BY b.observed_at DESC, b.comment_id)
                      FROM b JOIN public.vehicles v ON v.id = b.vehicle_id AND v.is_public
                      WHERE b.amount > 0 AND public.observation_is_public(b.kind, b.structured_data)), '[]'::jsonb))
$function$;

COMMENT ON FUNCTION public.live_bid_tape(integer) IS
  'The last p_minutes (1-30, default 5) of Bring a Trailer bids from the live stream (vehicle_observations kind bid, '
  'source_identifier public-live:*), once per BaT comment id, on public vehicles and public rows only: {as_of, minutes, '
  'source, bids: [{id, vehicle_id, amount, bid_at, end_at}]}, newest first. No bidder names. SECURITY DEFINER with the '
  'anonymous read policy''s public path applied in the read. Read by the live board''s bid tape.';
REVOKE ALL ON FUNCTION public.live_bid_tape(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_bid_tape(integer) TO anon, authenticated, service_role;

COMMIT;
