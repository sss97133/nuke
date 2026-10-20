-- Sources drill-down heartbeat: what a source's activity is made of, one line per kind.
-- Owner, 2026-10-20: "ingestion of what, live or old listings or comments or bids? ... the heartbeat of the site."
-- market_source_landing_read counts vehicle_events only. This reader splits the last 24 hours (hourly) and the last 60
-- minutes (5-minute) into new listings (vehicle_events.created_at), bids and comments (auction_comments.created_at), and
-- backfill: a bid or comment captured more than 2 hours after it was posted on the site, which is old activity arriving
-- late, not the site's pulse. Sources with no auction_comments rows return zero bids and comments.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
BEGIN;

CREATE OR REPLACE FUNCTION public.market_source_pulse_read(p_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH k AS (
    SELECT array_remove(ARRAY[
      regexp_replace(lower(coalesce(p_source, '')), '[^a-z0-9]', '', 'g'),
      CASE WHEN lower(coalesce(p_source, '')) = 'bat' THEN 'bringatrailer' END
    ], NULL) AS keys
  ), t AS (
    SELECT date_trunc('hour', now()) AS h0,
           to_timestamp(floor(extract(epoch from now()) / 300) * 300) AS m0
  ), ev AS (
    SELECT 'listing'::text AS kind, e.created_at AS at
    FROM public.vehicle_events e, k, t
    WHERE e.created_at >= t.h0 - interval '23 hours'
      AND regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') = ANY(k.keys)
    UNION ALL
    SELECT CASE WHEN c.posted_at IS NOT NULL AND c.posted_at < c.created_at - interval '2 hours' THEN 'backfill'
                WHEN c.comment_type = 'bid' THEN 'bid' ELSE 'comment' END, c.created_at
    FROM public.auction_comments c, k, t
    WHERE c.created_at >= t.h0 - interval '23 hours'
      AND regexp_replace(lower(c.platform), '[^a-z0-9]', '', 'g') = ANY(k.keys)
  ), kinds(kind) AS (VALUES ('listing'), ('bid'), ('comment'), ('backfill'))
  SELECT jsonb_build_object(
    'as_of', now(),
    'hour', (SELECT h0 FROM t),
    'last', (SELECT jsonb_object_agg(kd.kind, (SELECT max(ev.at) FROM ev WHERE ev.kind = kd.kind)) FROM kinds kd),
    'hours24', (SELECT jsonb_object_agg(kd.kind, (
        SELECT jsonb_agg((SELECT count(*) FROM ev WHERE ev.kind = kd.kind AND date_trunc('hour', ev.at) = g) ORDER BY g)
        FROM generate_series((SELECT h0 FROM t) - interval '23 hours', (SELECT h0 FROM t), interval '1 hour') g
      )) FROM kinds kd),
    'mins60', (SELECT jsonb_object_agg(kd.kind, (
        SELECT jsonb_agg((SELECT count(*) FROM ev WHERE ev.kind = kd.kind
                            AND ev.at >= g AND ev.at < g + interval '5 minutes') ORDER BY g)
        FROM generate_series((SELECT m0 FROM t) - interval '55 minutes', (SELECT m0 FROM t), interval '5 minutes') g
      )) FROM kinds kd)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.market_source_pulse_read(text) TO anon, authenticated;
COMMIT;
