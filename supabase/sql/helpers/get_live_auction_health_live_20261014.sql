-- Live definitions of get_live_auction_health() and get_live_auction_health(date) on 2026-10-14 05:46Z (pg_get_functiondef),
-- base64 SHA-256 3Uq6wBTj5f5lwXN2i+IzF0N2E8PWtHseAAnZN2hBAto= and vexAqbXh+D0e+xUoPin84xWhsEAww/HJdjkJSoo+m50=. Test fixture only.
CREATE OR REPLACE FUNCTION public.get_live_auction_health(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH day_bounds AS MATERIALIZED (
  SELECT coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date) AS day,
    coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS starts,
    (coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)+1)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS ends
), candidates AS MATERIALIZED (
  SELECT m.vehicle_id,rtrim(m.external_auction_url,'/') AS url,m.auction_end_time AS ends,
    nullif(m.stream_state->>'terminal_observation_id','')::uuid AS terminal_id
  FROM public.monitored_auctions m
  JOIN public.live_auction_sources s ON s.id=m.source_id AND s.slug='bat'
  CROSS JOIN day_bounds b
  WHERE m.auction_end_time>=b.starts AND m.auction_end_time<b.ends
  UNION ALL
  SELECT e.vehicle_id,rtrim(e.source_url,'/'),e.ended_at,NULL::uuid
  FROM public.vehicle_events e CROSS JOIN day_bounds b
  WHERE e.source_platform='bat' AND e.event_type='auction'
    AND e.ended_at>=b.starts AND e.ended_at<b.ends
  UNION ALL
  SELECT a.vehicle_id,rtrim(a.source_url,'/'),a.auction_end_date,NULL::uuid
  FROM public.auction_events a CROSS JOIN day_bounds b
  WHERE a.source='bat' AND a.auction_end_date>=b.starts AND a.auction_end_date<b.ends
), lots AS MATERIALIZED (
  -- One source listing across caches and parent aliases; a missing URL stays
  -- separate by vehicle rather than disappearing from the denominator.
  SELECT url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END AS unbound_vehicle,
    array_agg(DISTINCT vehicle_id) AS vehicle_ids,max(ends) AS scheduled_end,
    array_agg(DISTINCT terminal_id) FILTER(WHERE terminal_id IS NOT NULL) AS terminal_ids
  FROM candidates
  GROUP BY url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END
), reconciled AS MATERIALIZED (
  SELECT l.*,CASE WHEN cardinality(result.outcomes)=1 THEN coalesce(result.latest_end,l.scheduled_end)
      ELSE greatest(result.latest_end,l.scheduled_end) END AS closes_at,
    coalesce(result.outcomes,ARRAY[]::text[]) AS outcomes,
    receipt.has_native_receipt,receipt.late_native_admission
  FROM lots l
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT a.outcome) FILTER(WHERE a.outcome IN ('sold','reserve_not_met','cancelled')) AS outcomes,
      max(a.auction_end_date) AS latest_end
    FROM public.auction_events a
    WHERE a.vehicle_id=ANY(l.vehicle_ids) AND a.source='bat'
      AND a.source_url IN (l.url,l.url||'/')
  ) result ON true
  LEFT JOIN LATERAL (
    SELECT count(*)>0 AS has_native_receipt,
      coalesce(bool_or(o.structured_data->>'clock_basis'='native_comment_timestamp'
        AND o.ingested_at>o.observed_at+interval '2 seconds'),false) AS late_native_admission
    FROM public.vehicle_observations o
    WHERE o.id=ANY(l.terminal_ids) AND o.vehicle_id=ANY(l.vehicle_ids)
      AND o.source_url IN (l.url,l.url||'/') AND o.kind='sale_result'
      AND o.extraction_method='bat_public_live_v1'
  ) receipt ON true
), today AS MATERIALIZED (
  -- An extension into tomorrow moves the lot out of today's denominator.
  SELECT r.* FROM reconciled r CROSS JOIN day_bounds b
  WHERE r.closes_at>=b.starts AND r.closes_at<b.ends
), settlement AS MATERIALIZED (
  SELECT jsonb_build_object(
    'date',(SELECT day FROM day_bounds),'timezone','America/Los_Angeles',
    'status',CASE WHEN count(*)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE cardinality(outcomes)>1 OR
        (closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0))>0 THEN 'failed'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0)>0 THEN 'pending'
      ELSE 'passed' END,
    'expected_known_lots',count(*),
    'due_known_lots',count(*) FILTER(WHERE closes_at<=now()),
    'upcoming_known_lots',count(*) FILTER(WHERE closes_at>now()),
    'confirmed_closed_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1),
    'sold_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['sold']::text[]),
    'reserve_not_met_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['reserve_not_met']::text[]),
    'cancelled_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['cancelled']::text[]),
    'unresolved_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0),
    'overdue_result_lots',count(*) FILTER(WHERE closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0),
    'conflicting_result_lots',count(*) FILTER(WHERE cardinality(outcomes)>1),
    'unbound_lots',count(*) FILTER(WHERE nullif(url,'') IS NULL),
    'native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND has_native_receipt),
    'late_native_terminal_admission_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND late_native_admission),
    'closed_without_native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND NOT has_native_receipt),
    'terminal_capture_status',CASE
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1
        AND (NOT has_native_receipt OR late_native_admission))>0 THEN 'failed'
      ELSE 'passed' END,
    'native_event_to_admission_slo_seconds',2,
    'result_grace_seconds',300,
    'inventory_scope','Known BaT listings in Nuke monitors and auction caches, deduplicated by source URL',
    'source_inventory_completeness','unverified',
    'continuous_capture_completeness','unverified; a terminal receipt can be late recovery',
    'checked_at',now()) AS reading
  FROM today
), closing AS MATERIALIZED (
  SELECT m.*, EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
    WHERE (session.value->>'connected')::boolean
      AND session.value->>'error' IS NULL
      AND (session.value->>'at')::timestamptz>now()-interval '3 seconds'
      AND NOT ((session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds')) AS covered,
    EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
      WHERE (session.value->>'at')::timestamptz>now()-interval '3 seconds'
        AND (session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds') AS admission_overdue
  FROM public.monitored_auctions m JOIN public.live_auction_sources source ON source.id=m.source_id AND source.slug='bat'
  WHERE m.auction_end_time<=now()+interval '15 minutes' AND m.auction_end_time>now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM public.auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled'))
), stream AS (
  SELECT jsonb_build_object('status',CASE WHEN (SELECT reading->>'status'='failed'
      OR reading->>'terminal_capture_status'='failed' FROM settlement) THEN 'failed' WHEN count(*)=0 THEN 'idle'
    WHEN count(*) FILTER(WHERE NOT is_live OR NOT covered OR admission_overdue OR coalesce((stream_state->>'unqualified_frames')::integer,0)>0)>0 THEN 'failed' ELSE 'passed' END,
    'eligible_lots',count(*),'covered_lots',count(*) FILTER(WHERE is_live AND covered),
    'missing_lots',count(*) FILTER(WHERE NOT is_live OR NOT covered),
    'admission_overdue_lots',count(*) FILTER(WHERE admission_overdue),
    'unqualified_lots',count(*) FILTER(WHERE coalesce((stream_state->>'unqualified_frames')::integer,0)>0),
    'receipt_to_admission_slo_seconds',2,'heartbeat_stale_after_seconds',3,
    'source_publication_lag','unknown unless native comment timestamp is present',
    'daily_settlement',(SELECT reading FROM settlement),
    'coverage_scope','current subscriptions and acknowledgement queues; outages can lose non-replayable extension/stat events',
    'checked_at',now()) AS reading FROM closing
)
SELECT jsonb_build_object(
  'total_monitored',(SELECT count(*) FROM public.monitored_auctions WHERE is_live),
  'soft_close_count',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND is_in_soft_close),
  'overdue_sync',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND next_poll_at<now()-interval '2 minutes'),
  'avg_bid_dollars',(SELECT round(avg(current_bid_cents)::numeric/100,2) FROM public.monitored_auctions WHERE is_live AND current_bid_cents>0),
  'total_bids',(SELECT sum(bid_count) FROM public.monitored_auctions WHERE is_live),
  'platforms',(SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'active_auctions',s.active_count,'health_status',s.health_status))
    FROM (SELECT source.slug,source.health_status,count(m.id) AS active_count FROM public.live_auction_sources source
      LEFT JOIN public.monitored_auctions m ON m.source_id=source.id AND m.is_live WHERE source.is_active
      GROUP BY source.id,source.slug,source.health_status) s),
  'cron_status',(SELECT jsonb_build_object('job_id',j.jobid,'last_run',d.start_time,'last_status',d.status)
    FROM cron.job j LEFT JOIN LATERAL(SELECT start_time,status FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY start_time DESC LIMIT 1)d ON true
    WHERE j.jobname='bat-live-pull'),
  'last_sync',(SELECT max(updated_at) FROM public.monitored_auctions WHERE is_live),
  'closing_stream',(SELECT reading FROM stream),
  'daily_closes',(SELECT reading FROM settlement),'checked_at',now());
$function$

;

CREATE OR REPLACE FUNCTION public.get_live_auction_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ SELECT public.get_live_auction_health((now() AT TIME ZONE 'America/Los_Angeles')::date); $function$

;
