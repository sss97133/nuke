-- live_bid_tape: the last few minutes of Bring a Trailer bids, once each, for the live board's tape and bid sound.
--
-- The live stream (extract-bat-core, live_stream mode) admits each BaT bid as a vehicle_observations row of kind 'bid'
-- about a minute after it is placed (median 55 s, measured 2026-10-15), one row per transport (direct_html,
-- missed_comments, public_pusher), so one bid can appear two or three times (110 of 172 vehicle+amount pairs in a
-- 20-minute read). It also backfills a lot's earlier bids when a stream session connects (ingested now, placed days
-- ago). This read returns each bid placed in the last p_minutes once, keyed by BaT's own comment id, with its amount,
-- its own time (the native comment timestamp) and the scheduled end after it (BaT moves the end two minutes past a
-- late bid). No bidder names. SECURITY INVOKER: the observation read policy already admits public bids on public
-- vehicles to anonymous readers, and this read adds nothing to what they may see.
-- Contract: supabase/sql/test_live_bid_tape.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_bid_tape(p_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '5s'
AS $function$
  WITH w AS MATERIALIZED (
    SELECT statement_timestamp() AS as_of, least(greatest(coalesce(p_minutes, 5), 1), 30) AS minutes
  ), raw AS (
    SELECT o.vehicle_id, o.observed_at, o.ingested_at,
           o.structured_data #>> '{public_live_frame,data,comment,id}' AS comment_id,
           o.structured_data #>> '{public_live_frame,data,comment,bidAmount}' AS amount_text,
           o.structured_data #>> '{public_live_frame,data,comment,end_timestamp}' AS end_text
    FROM public.vehicle_observations o CROSS JOIN w
    WHERE o.kind = 'bid'
      AND o.ingested_at > w.as_of - make_interval(mins => w.minutes + 15)
      AND o.observed_at > w.as_of - make_interval(mins => w.minutes)
      AND o.observed_at <= w.as_of + interval '1 minute'
      AND o.source_identifier LIKE 'public-live:%'
      AND o.vehicle_id IS NOT NULL
      AND NOT coalesce(o.is_superseded, false)
  ), b AS (
    SELECT DISTINCT ON (comment_id) vehicle_id, observed_at, comment_id, amount_text::numeric AS amount,
           CASE WHEN end_text ~ '^[0-9]{9,11}$' THEN to_timestamp(end_text::bigint) END AS end_at
    FROM raw
    WHERE comment_id ~ '^[0-9]{1,12}$' AND amount_text ~ '^[0-9]{1,10}([.][0-9]+)?$'
    ORDER BY comment_id, ingested_at, observed_at
  )
  SELECT jsonb_build_object(
    'as_of', (SELECT as_of FROM w),
    'minutes', (SELECT minutes FROM w),
    'source', 'Bring a Trailer bids from its live feed, as Nuke records them, once per bid',
    'bids', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.comment_id, 'vehicle_id', b.vehicle_id,
                                                          'amount', b.amount, 'bid_at', b.observed_at, 'end_at', b.end_at)
                                       ORDER BY b.observed_at DESC, b.comment_id)
                      FROM b WHERE b.amount > 0), '[]'::jsonb))
$function$;

COMMENT ON FUNCTION public.live_bid_tape(integer) IS
  'The last p_minutes (1-30, default 5) of Bring a Trailer bids from the live stream (vehicle_observations kind bid, '
  'source_identifier public-live:*), once per BaT comment id: {as_of, minutes, source, bids: [{id, vehicle_id, amount, '
  'bid_at, end_at}]}, newest first. No bidder names. Read by the live board''s bid tape.';
REVOKE ALL ON FUNCTION public.live_bid_tape(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_bid_tape(integer) TO anon, authenticated, service_role;

COMMIT;
