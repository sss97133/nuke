-- Extend the approved closing-reader health assay; no testimony, schema columns,
-- table grants, writer ownership or cron schedules change.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.get_live_auction_health(p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog,public
AS $health$
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
$health$;
-- Existing no-argument API/privileges remain; explicit-date overload uses the
-- caller's table privileges. The existing definer executes it as its owner.
CREATE OR REPLACE FUNCTION public.get_live_auction_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$ SELECT public.get_live_auction_health((now() AT TIME ZONE 'America/Los_Angeles')::date); $$;
COMMENT ON FUNCTION public.get_live_auction_health(date) IS
  'Known BaT listing result reconciliation for a Pacific calendar day, plus existing current stream health. Indexed date candidates and vehicle/source URL lookups; source URL dedupe and independent native terminal receipts. Missing overdue results fail the existing job assay even when current streams are idle. Invoker privileges; no historical gap-free or source-wide inventory claim.';
COMMENT ON FUNCTION public.get_live_auction_health() IS
  'Existing health API and privileges; delegates to the date-qualified reader for today in America/Los_Angeles. daily_closes answers expected known lots, confirmed results and gaps from Nuke records; closing_stream includes the same settlement failure in the existing v_job_health assay.';
CREATE OR REPLACE FUNCTION public.bat_live_pull_run(p_lots integer DEFAULT 3, p_force_sync boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_src      uuid;
  v_cfg      jsonb;
  v_last     jsonb;
  v_now      timestamptz := now();
  v_probes   jsonb;
  v_lat      numeric[];
  v_p50      numeric;
  v_pause_ms integer;
  v_window   interval;
  v_skip     text := NULL;
  v_paused_since timestamptz;
  v_acc      integer := 0;
  v_read     integer := 0;
  v_failed   integer := 0;
  v_rows     bigint := 0;
  v_sent     integer := 0;
  v_n        bigint;
  v_req      bigint;
  v_key      text := get_service_role_key_for_cron();
  v_base     text := get_service_url();
  v_cad      interval;
  v_reserve  integer;
  v_first    integer := 0;
  v_stream_req bigint;
  v_stream_lots integer;
  r          record;
BEGIN
  SELECT id, coalesce(scraping_config -> 'live_pull', '{}'::jsonb) INTO v_src, v_cfg
  FROM live_auction_sources WHERE slug = 'bat';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'bat_live_pull_run: live_auction_sources has no bat row';
  END IF;
  v_pause_ms := coalesce((v_cfg ->> 'pause_rest_p50_ms')::integer, 2000);
  v_window   := make_interval(hours => coalesce((v_cfg ->> 'priority_window_hours')::integer, 48));
  v_last     := coalesce(v_cfg -> 'last_run', '{}'::jsonb);
  -- C1: slots per run held for lots never dispatched (next_poll_at IS NULL), so lots beyond the priority window
  -- get their first read instead of waiting for the window to have fewer than p_lots due lots (it never does at peak).
  v_reserve  := least(coalesce((v_cfg ->> 'reserve_first_read')::integer, 1), greatest(coalesce(p_lots, 0), 0));

  -- 1. Account the previous passes. The reader upserts the lot's auction_events row on every read.
  FOR r IN
    SELECT m.id, m.vehicle_id, m.last_synced_at, m.last_comment_count,
           e.updated_at AS read_at, e.auction_end_date AS read_end, e.outcome AS read_outcome
    FROM monitored_auctions m
    LEFT JOIN LATERAL (
      SELECT a.updated_at, a.auction_end_date, a.outcome FROM auction_events a
      WHERE a.vehicle_id = m.vehicle_id
        AND rtrim(a.source_url, '/') = rtrim(m.external_auction_url, '/')
      ORDER BY a.updated_at DESC LIMIT 1
    ) e ON true
    WHERE m.source_id = v_src
      AND m.vehicle_id IS NOT NULL
      AND m.last_synced_at > v_now - interval '6 hours'
      AND (m.last_comment_synced_at IS NULL OR m.last_comment_synced_at < m.last_synced_at)
  LOOP
    IF r.read_at >= r.last_synced_at THEN
      SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.vehicle_id;
      UPDATE monitored_auctions
      SET auction_end_time       = greatest(r.read_end, auction_end_time),
          is_live                = CASE WHEN r.read_outcome IN ('sold', 'reserve_not_met') THEN false ELSE is_live END,
          last_comment_count     = v_n,
          last_comment_synced_at = v_now,
          sync_latency_ms        = (extract(epoch FROM (r.read_at - r.last_synced_at)) * 1000)::integer
      WHERE id = r.id;
      v_acc  := v_acc + 1;
      v_read := v_read + 1;
      v_rows := v_rows + greatest(v_n - coalesce(r.last_comment_count, 0), 0);
    ELSIF r.last_synced_at < v_now - interval '10 minutes' THEN
      -- no read 10 min after dispatch: a failed read; accounted, retried in 30 min
      UPDATE monitored_auctions
      SET last_comment_synced_at = v_now,
          sync_latency_ms        = NULL,
          next_poll_at           = v_now + interval '30 minutes'
      WHERE id = r.id;
      v_acc    := v_acc + 1;
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  -- 2a. One pass at a time: a lot dispatched in the last 150 s (the reader's gateway limit) and not yet read.
  IF EXISTS (
    SELECT 1 FROM monitored_auctions m
    WHERE m.source_id = v_src
      AND m.last_synced_at > v_now - interval '150 seconds'
      AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                        AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                        AND e.updated_at >= m.last_synced_at)
  ) THEN
    v_skip := 'previous pass in flight';
  END IF;

  -- 2b. The pause rule, as the BaT loader's: REST p50 over the last 10 probes. A probe's latency is the gap
  --     from its dispatch to its response row; a timed-out or failed probe counts as 15 s.
  v_probes := coalesce(v_cfg -> 'rest_probes', '[]'::jsonb);
  SELECT array_agg(lat ORDER BY lat) INTO v_lat
  FROM (
    SELECT CASE WHEN h.timed_out OR h.status_code IS NULL OR h.status_code >= 500 THEN 15000
                ELSE greatest(extract(epoch FROM h.created) * 1000 - (p ->> 1)::numeric, 0) END AS lat
    FROM jsonb_array_elements(v_probes) p
    JOIN net._http_response h ON h.id = (p ->> 0)::bigint
  ) x;
  IF coalesce(array_length(v_lat, 1), 0) >= 3 THEN
    v_p50 := v_lat[(array_length(v_lat, 1) + 1) / 2];
    IF v_p50 > v_pause_ms THEN
      v_skip := coalesce(v_skip || '; ', '') || format('paused: REST p50 %s ms over the last %s probes', round(v_p50), array_length(v_lat, 1));
    END IF;
  END IF;
  -- A clock is never a terminal source event. Retire only qualified same-lot outcomes.
  UPDATE monitored_auctions m SET is_live=false
  WHERE m.source_id=v_src AND m.is_live AND EXISTS (
    SELECT 1 FROM auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/')
      AND a.outcome IN ('sold','reserve_not_met','cancelled'));

  IF v_skip IS NULL AND (p_force_sync OR extract(minute FROM v_now)::integer % 5 = 0
                         OR NOT EXISTS (SELECT 1 FROM monitored_auctions m WHERE m.source_id = v_src AND m.is_live)) THEN
    -- 3b. Every 5th minute: the schedule follows the live board, every live BaT row with a readable end time
    --     (new lots, end-time changes, the 48 h priority), and lots withdrawn or settled early leave it.
    INSERT INTO monitored_auctions AS m
      (source_id, external_auction_id, external_auction_url, vehicle_id, auction_end_time, is_live, current_bid_cents, priority)
    SELECT v_src, l.slug, 'https://bringatrailer.com/listing/' || l.slug, l.id, l.ends, true,
           (l.high_bid * 100)::bigint, CASE WHEN l.ends <= v_now + v_window THEN 1 ELSE 2 END
    FROM (
      SELECT v.id, v.high_bid,
             CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END AS ends,
             regexp_replace(regexp_replace(v.listing_url, '^https?://(www\.)?bringatrailer\.com/listing/', ''), '[/?#].*$', '') AS slug
      FROM vehicles v
      WHERE v.sale_status = 'auction_live'
        AND v.platform_source = 'bringatrailer'
        AND v.deleted_at IS NULL
        AND CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END > v_now - interval '24 hours'
        AND v.listing_url ~ '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+'
        AND NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = v.id
                        AND rtrim(a.source_url, '/') = rtrim(v.listing_url, '/')
                        AND a.outcome IN ('sold', 'reserve_not_met'))
    ) l
    ON CONFLICT (source_id, external_auction_id) DO UPDATE
    SET is_live = true, vehicle_id = EXCLUDED.vehicle_id, auction_end_time = greatest(m.auction_end_time, EXCLUDED.auction_end_time),
        external_auction_url = EXCLUDED.external_auction_url, priority = EXCLUDED.priority
    WHERE (m.is_live, m.vehicle_id, m.auction_end_time, m.priority)
          IS DISTINCT FROM (true, EXCLUDED.vehicle_id, greatest(m.auction_end_time, EXCLUDED.auction_end_time), EXCLUDED.priority);

  END IF;

  -- Reconcile known current-cache lots that never acquired a monitor. The
  -- canonical parent/native-post binding is required; board status and clock
  -- expiry cannot hide an unresolved source result from the existing reader.
  INSERT INTO monitored_auctions AS m
    (source_id,external_auction_id,external_auction_url,vehicle_id,
     auction_end_time,is_live,current_bid_cents,priority)
  SELECT DISTINCT ON (substring(e.source_url from '/listing/([^/?]+)'))
    v_src,substring(e.source_url from '/listing/([^/?]+)'),e.source_url,e.vehicle_id,
    e.ended_at,true,coalesce(round(e.current_price*100)::bigint,0),2
  FROM vehicle_events e JOIN vehicles v ON v.id=e.vehicle_id
  WHERE e.source_platform='bat' AND e.event_type='auction'
    AND e.ended_at>v_now-interval '24 hours' AND e.ended_at<=v_now+interval '15 minutes'
    AND v.deleted_at IS NULL AND v.platform_source='bringatrailer'
    AND v.origin_metadata->>'source'='bat_auctions_page'
    AND v.origin_metadata->>'external_id' ~ '^\d{4,}$'
    AND rtrim(v.listing_url,'/')=rtrim(e.source_url,'/')
    AND substring(e.source_url from '/listing/([^/?]+)') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM auction_events a WHERE a.vehicle_id=e.vehicle_id
      AND a.source_url IN (rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
      AND a.outcome IN ('sold','reserve_not_met','cancelled'))
  ORDER BY substring(e.source_url from '/listing/([^/?]+)'),e.updated_at DESC,e.vehicle_id LIMIT 5000
  ON CONFLICT(source_id,external_auction_id) DO NOTHING;

  -- Recover recent clock-retired monitors independently of HTML/board gates.
  -- The board's sale_status may already be not_sold because the clock expired;
  -- only a qualified same-source outcome is allowed to terminate capture.
  UPDATE monitored_auctions m SET is_live=true
  FROM vehicles v
  WHERE m.source_id=v_src AND NOT m.is_live
    AND m.vehicle_id=v.id AND v.deleted_at IS NULL
    AND v.origin_metadata->>'source'='bat_auctions_page'
    AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]*$'
    AND rtrim(v.listing_url,'/')=rtrim(m.external_auction_url,'/')
    AND m.auction_end_time>v_now-interval '24 hours'
    AND m.auction_end_time<=v_now+interval '15 minutes'
    AND NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/')
      AND a.outcome IN ('sold','reserve_not_met','cancelled'));

  -- Independent continuous coverage: one multiplexed public connection per minute,
  -- overlapping workers, EVERY closing lot, no p_lots or HTML in-flight bottleneck.
  SELECT count(*) INTO v_stream_lots FROM monitored_auctions
    WHERE source_id=v_src AND (is_live OR (stream_state->>'terminal_received_at')::timestamptz>v_now-interval '2 minutes')
      AND auction_end_time<=v_now+interval '15 minutes';
  IF v_stream_lots>0 THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream'),timeout_milliseconds:=150000);
  END IF;

  IF v_skip IS NULL THEN
    -- Closing-window lots take the existing slots first, oldest read first for fairness.
    -- Remaining slots preserve C1's first-read reserve and the existing hourly/daily cadences.
    FOR r IN
      WITH due AS (
        SELECT m.id, m.external_auction_url, m.auction_end_time, m.next_poll_at, m.last_synced_at
        FROM monitored_auctions m
        WHERE m.source_id = v_src AND m.is_live
          AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
            WHERE (session.value->>'connected')::boolean AND (session.value->>'at')::timestamptz>v_now-interval '3 seconds')
          AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               OR (m.auction_end_time <= v_now + interval '10 minutes'
                   AND (m.last_synced_at IS NULL OR m.last_synced_at <= v_now - interval '1 minute')))
      ), closing AS (
        SELECT d.id FROM due d WHERE d.auction_end_time <= v_now + interval '10 minutes'
        ORDER BY d.last_synced_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(coalesce(p_lots, 0), 0)
      ), fresh AS (
        SELECT d.id FROM due d WHERE d.next_poll_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM closing c WHERE c.id = d.id)
        ORDER BY d.auction_end_time
        LIMIT least(v_reserve, greatest(coalesce(p_lots, 0) - (SELECT count(*) FROM closing), 0))
      ), rest AS (
        SELECT d.id FROM due d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id)
          AND NOT EXISTS (SELECT 1 FROM closing c WHERE c.id = d.id)
        ORDER BY (d.auction_end_time <= v_now + v_window) DESC, d.next_poll_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(greatest(coalesce(p_lots, 0), 0) - (SELECT count(*) FROM fresh) - (SELECT count(*) FROM closing), 0)
      )
      SELECT d.id, d.external_auction_url, d.auction_end_time, (d.next_poll_at IS NULL) AS first_read
      FROM due d
      WHERE d.id IN (SELECT id FROM closing UNION ALL SELECT id FROM fresh UNION ALL SELECT id FROM rest)
      ORDER BY d.auction_end_time
    LOOP
      IF r.first_read THEN v_first := v_first + 1; END IF;
      v_cad := CASE
        WHEN r.auction_end_time <= v_now + interval '10 minutes' THEN interval '1 minute'
        WHEN r.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,under_12h}')::integer, 60))
        WHEN r.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,h12_to_48}')::integer, 360))
        ELSE make_interval(mins => coalesce((v_cfg #>> '{cadence_minutes,over_48h}')::integer, 1440))
      END;
      PERFORM net.http_post(
        url := v_base || '/functions/v1/extract-bat-core',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('url', r.external_auction_url, 'prefer_snapshot', false),
        timeout_milliseconds := 150000);
      UPDATE monitored_auctions
      SET last_synced_at   = v_now,
          next_poll_at     = v_now + v_cad,
          poll_interval_ms = (extract(epoch FROM v_cad) * 1000)::integer
      WHERE id = r.id;
      v_sent := v_sent + 1;
    END LOOP;
  END IF;

  IF v_skip LIKE '%paused:%' THEN
    v_paused_since := coalesce((v_last ->> 'paused_since')::timestamptz, v_now);
  END IF;

  -- A new REST probe every run, fired last so its measured latency leaves out the rest of this transaction
  -- (pg_net sends it after commit; the latency is the gap to its response row).
  v_req := net.http_get(
    url := v_base || '/rest/v1/vehicles?select=id&limit=1',
    headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 15000);
  v_probes := v_probes || jsonb_build_array(jsonb_build_array(v_req, (extract(epoch FROM clock_timestamp()) * 1000)::bigint));
  SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_probes
  FROM jsonb_array_elements(v_probes) WITH ORDINALITY t(e, o)
  WHERE o > jsonb_array_length(v_probes) - 10;

  UPDATE live_auction_sources
  SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}', v_cfg || jsonb_build_object(
        'rest_probes', v_probes,
        'last_run', jsonb_build_object(
          'at', v_now, 'accounted', v_acc, 'read', v_read, 'failed', v_failed,
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'first_read_dispatched', v_first,
          'stream_lots',v_stream_lots,'stream_request_id',v_stream_req,'rest_p50_ms', round(v_p50),
          'skipped', v_skip, 'paused_since', v_paused_since))),
      last_successful_sync = CASE WHEN v_read > 0 THEN v_now ELSE last_successful_sync END,
      consecutive_failures = CASE WHEN v_read > 0 THEN 0 WHEN v_failed > 0 THEN consecutive_failures + 1 ELSE consecutive_failures END,
      health_status = CASE WHEN v_skip LIKE '%paused:%' THEN 'degraded'
                           WHEN v_failed > 0 AND v_read = 0 THEN 'unhealthy'
                           WHEN v_failed > 0 THEN 'degraded'
                           WHEN v_read > 0 THEN 'healthy'
                           ELSE health_status END,
      last_sync_error = CASE WHEN v_skip LIKE '%paused:%' THEN v_skip
                             WHEN v_failed > 0 THEN format('%s of %s dispatched lots not read within 10 min', v_failed, v_acc)
                             WHEN v_read > 0 THEN NULL
                             ELSE last_sync_error END
  WHERE id = v_src;

  RETURN jsonb_build_object('accounted', v_acc, 'read', v_read, 'failed', v_failed, 'comment_rows_landed', v_rows,
                            'dispatched', v_sent, 'first_read_dispatched', v_first,'stream_lots',v_stream_lots,'stream_request_id',v_stream_req, 'rest_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$fn$;
COMMENT ON FUNCTION public.bat_live_pull_run(integer,boolean) IS
  'Existing BaT reader with continuous closing capture and bounded recovery of source-unsettled current-cache lots lacking a monitor. Requires the existing canonical source URL/native-post binding. Board status and elapsed deadlines do not suppress acquisition; all source testimony still enters through ingest-observation.';
COMMIT;
