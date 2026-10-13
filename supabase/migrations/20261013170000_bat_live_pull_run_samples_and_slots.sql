-- bat-live-pull: the pause rule samples the pull's own run time instead of a pg_net REST probe; an in-flight read costs
-- one slot instead of the whole pass; dispatch and accounting lock their rows with SKIP LOCKED.
--
-- WHY (skylar-2a, 2026-10-13; data-machine case C1 and the 2026-10-13 intake diagnosis):
--   1. The pause rule paused the pull for days. bat-live-pull-check failed 96 of 96 runs on 10-13 with 859 live lots over
--      2 h past their next read and 138 never read; last_run said "paused: REST p50 7766 ms over the last 10 probes" while
--      the same REST call made directly took 0.12 s. The probe went through pg_net, whose worker writes a batch's responses
--      only after the slowest request in the batch finishes, so the probe measured the slowest edge-function call sharing
--      its batch: over 176 probes in 3 h (10:48-13:46Z) the gap from the pull's commit to the probe's response row was
--      8.7 s at the median and 9.0 s in minutes with fewer than 10 other pg_net responses (correlation with burst size
--      -0.08). Raising the threshold from 2 s to 15 s at 06:45:56Z un-paused it (overdue 859 -> 591 by 13:44Z), but the
--      signal itself is wrong. The pull's own wall time is the stall signal the rule was meant to read: median 0.22 s,
--      p95 2.47 s over 18,784 runs since 09-30 (cron.job_run_details); the 2026-09-28/29 stall ran the heartbeat 138-224 s.
--   2. One unread dispatch skipped the whole next pass ("previous pass in flight"). Reads land at 12.7 s median and 29.5 s
--      p90 (sync_latency_ms, 763 reads in the 24 h to 13:49Z), so one slow read idled all six slots: at least 57 of the
--      120 minutes 13:59-15:59Z dispatched nothing, 173 reads/h against 360 possible, and the backlog stopped draining at
--      about 590 overdue lots.
--   3. The dispatch UPDATE deadlocked 10 times since 10-11 (3 on 10-13: 12:40, 13:30, 13:40Z) against other writers of
--      monitored_auctions rows, each failure costing the minute's dispatch.
--
-- WHAT (smallest forward edit of the 20261006060000 body, verified identical to production on 2026-10-13 13:4xZ by
-- pg_get_functiondef diff, whitespace only):
--   1. 2b: v_lat comes from live_pull.run_samples, the last 10 [run_at_ms, run_ms] pairs this function writes, against
--      live_pull.pause_run_p50_ms (default 15000); the skip text is "paused: run p50 N ms over the last K runs" so the
--      check function and health CASE ("paused:") are unchanged. The pg_net probe, rest_probes and pause_rest_p50_ms go.
--   2. 2a: v_inflight counts lots dispatched in the last 150 s and not yet read; v_slots = lots_per_run - v_inflight is
--      the run's slot count (closing and first-read caps are bounded by it), and in-flight lots are not due. Only when
--      v_slots is 0 does the run skip dispatch ("all N slots in flight"). The cap on concurrent reads is unchanged.
--   3. The three dispatch queues (closing, fresh, rest) pick their rows FROM monitored_auctions ... LIMIT n FOR UPDATE
--      OF m SKIP LOCKED, so a row another transaction holds is skipped before the LIMIT and the slot goes to the next
--      candidate; the accounting loop locks its rows the same way. The dispatch UPDATE then never waits or deadlocks.
--   4. last_run gains in_flight, slots_free, run_ms, run_p50_ms (rest_p50_ms goes); the config row loses rest_probes and
--      pause_rest_p50_ms and gains pause_run_p50_ms 15000. Cron 510 is not touched.
-- Unchanged: lots_per_run 6, closing_slots 1, reserve_first_read, cadences, the stream dispatch, the recovery inserts,
-- the 10-minute failed-read rule, grants, schedules. No testimony or schema change.
-- Expected: dispatch most minutes at 6 slots (up to 360 reads/h), the overdue count falling below the check's 25, and a
-- pause only when the pull's own median run time exceeds 15 s.
-- Contract test: supabase/sql/test_bat_live_pull_inflight_slots.sql (PostgreSQL 17 in CI).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.bat_live_pull_run(p_lots integer DEFAULT NULL, p_force_sync boolean DEFAULT false)
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
  v_samples  jsonb;
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
  v_inflight integer := 0;
  v_slots    integer;
  v_ms       integer;
  v_key      text := get_service_role_key_for_cron();
  v_base     text := get_service_url();
  v_cad      interval;
  v_reserve  integer;
  v_lots     integer;
  v_closing  integer;
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
  v_pause_ms := coalesce(CASE WHEN v_cfg ->> 'pause_run_p50_ms' ~ '^\d{1,6}$' THEN (v_cfg ->> 'pause_run_p50_ms')::integer END, 15000);
  v_window   := make_interval(hours => coalesce(CASE WHEN v_cfg ->> 'priority_window_hours' ~ '^\d{1,6}$' THEN (v_cfg ->> 'priority_window_hours')::integer END, 48));
  v_last     := coalesce(v_cfg -> 'last_run', '{}'::jsonb);
  -- C1: slots per run held for lots never dispatched (next_poll_at IS NULL), so lots beyond the priority window
  -- get their first read instead of waiting for the window to have fewer than p_lots due lots (it never does at peak).
  -- Slots per run come from live_pull.lots_per_run (default 6); p_lots overrides only when passed. Closing-window lots
  -- take at most live_pull.closing_slots (default 1): the native stream covers them, and spending every slot on them
  -- starved the hourly/daily cadences (2026-10-05: 220/220 closing lots took HTML slots; the check failed from 10Z).
  v_lots     := greatest(coalesce(p_lots, CASE WHEN v_cfg ->> 'lots_per_run' ~ '^\d{1,6}$' THEN (v_cfg ->> 'lots_per_run')::integer END, 6), 0);
  v_closing  := least(greatest(coalesce(CASE WHEN v_cfg ->> 'closing_slots' ~ '^\d{1,6}$' THEN (v_cfg ->> 'closing_slots')::integer END, 1), 0), v_lots);
  v_reserve  := least(coalesce(CASE WHEN v_cfg ->> 'reserve_first_read' ~ '^\d{1,6}$' THEN (v_cfg ->> 'reserve_first_read')::integer END, 1), v_lots);

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
    FOR UPDATE OF m SKIP LOCKED
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

  -- 2a. Slots this run: lots_per_run minus the lots dispatched in the last 150 s (the reader's gateway limit) and not
  --     yet read. Until 2026-10-13 one such lot skipped the whole pass; now it costs one slot for at most 150 s, and
  --     the cap on concurrent reads is the same. In-flight lots are not due (see the dispatch query).
  SELECT count(*) INTO v_inflight
  FROM monitored_auctions m
  WHERE m.source_id = v_src
    AND m.last_synced_at > v_now - interval '150 seconds'
    AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                      AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                      AND e.updated_at >= m.last_synced_at);
  v_slots   := greatest(v_lots - v_inflight, 0);
  v_closing := least(v_closing, v_slots);
  v_reserve := least(v_reserve, v_slots);
  IF v_slots = 0 AND v_lots > 0 THEN
    v_skip := format('all %s slots in flight', v_lots);
  END IF;

  -- 2b. The pause rule: this function's own wall time, the median of the last 10 runs' samples (live_pull.run_samples,
  --     [run_at_ms, run_ms] pairs written at the end of each run), against live_pull.pause_run_p50_ms (default 15000).
  --     A run that errors leaves no sample. The pg_net REST probe this replaces measured the pg_net worker's batch wait,
  --     not REST (header, WHY 1).
  v_samples := coalesce(v_cfg -> 'run_samples', '[]'::jsonb);
  SELECT array_agg((s ->> 1)::numeric ORDER BY (s ->> 1)::numeric) INTO v_lat
  FROM jsonb_array_elements(v_samples) s
  WHERE jsonb_typeof(s) = 'array' AND (s ->> 1) ~ '^\d{1,9}$';
  IF coalesce(array_length(v_lat, 1), 0) >= 3 THEN
    v_p50 := v_lat[(array_length(v_lat, 1) + 1) / 2];
    IF v_p50 > v_pause_ms THEN
      v_skip := coalesce(v_skip || '; ', '') || format('paused: run p50 %s ms over the last %s runs', round(v_p50), array_length(v_lat, 1));
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
          AND (m.last_synced_at IS NULL OR m.last_synced_at <= v_now - interval '150 seconds'   -- in flight: not due again
               OR EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id
                            AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                            AND e.updated_at >= m.last_synced_at))
      ), closing AS (
        -- Each queue locks the rows it picks (FOR UPDATE SKIP LOCKED): a row another transaction holds is skipped
        -- before the LIMIT, so the slot goes to the next candidate, and the UPDATE below never waits or deadlocks.
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND m.auction_end_time <= v_now + interval '10 minutes'
        ORDER BY m.last_synced_at NULLS FIRST, m.auction_end_time
        LIMIT v_closing
        FOR UPDATE OF m SKIP LOCKED
      ), fresh AS (
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND m.next_poll_at IS NULL
          AND coalesce(m.auction_end_time, 'infinity'::timestamptz) > v_now + interval '10 minutes'   -- closing lots only via closing's cap
        ORDER BY m.auction_end_time
        LIMIT least(v_reserve, greatest(v_slots - (SELECT count(*) FROM closing), 0))
        FOR UPDATE OF m SKIP LOCKED
      ), rest AS (
        SELECT m.id FROM monitored_auctions m
        WHERE m.id IN (SELECT id FROM due) AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = m.id)
          AND coalesce(m.auction_end_time, 'infinity'::timestamptz) > v_now + interval '10 minutes'   -- closing lots only via closing's cap
        ORDER BY (m.auction_end_time <= v_now + v_window) DESC, m.next_poll_at NULLS FIRST, m.auction_end_time
        LIMIT greatest(v_slots - (SELECT count(*) FROM fresh) - (SELECT count(*) FROM closing), 0)
        FOR UPDATE OF m SKIP LOCKED
      )
      SELECT m.id, m.external_auction_url, m.auction_end_time, (m.next_poll_at IS NULL) AS first_read
      FROM monitored_auctions m
      WHERE m.id IN (SELECT id FROM closing UNION ALL SELECT id FROM fresh UNION ALL SELECT id FROM rest)
      ORDER BY m.auction_end_time
    LOOP
      IF r.first_read THEN v_first := v_first + 1; END IF;
      v_cad := CASE
        WHEN r.auction_end_time <= v_now + interval '10 minutes' THEN interval '1 minute'
        WHEN r.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,under_12h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,under_12h}')::integer END, 60))
        WHEN r.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,h12_to_48}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,h12_to_48}')::integer END, 360))
        ELSE make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,over_48h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,over_48h}')::integer END, 1440))
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

  -- This run's wall time so far, transaction start to here, is the sample the next runs' pause rule reads; the write-back
  -- below is the only statement after it. Kept: the last 10.
  v_ms := greatest(round((extract(epoch FROM clock_timestamp()) - extract(epoch FROM v_now)) * 1000)::integer, 0);
  v_samples := v_samples || jsonb_build_array(jsonb_build_array((extract(epoch FROM v_now) * 1000)::bigint, v_ms));
  SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_samples
  FROM jsonb_array_elements(v_samples) WITH ORDINALITY t(e, o)
  WHERE o > jsonb_array_length(v_samples) - 10;

  UPDATE live_auction_sources
  SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}', (coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes') || jsonb_build_object(
        'run_samples', v_samples,
        'last_run', jsonb_build_object(
          'at', v_now, 'accounted', v_acc, 'read', v_read, 'failed', v_failed,
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'first_read_dispatched', v_first,
          'in_flight', v_inflight, 'slots_free', v_slots,
          'stream_lots',v_stream_lots,'stream_request_id',v_stream_req,'run_ms', v_ms,'run_p50_ms', round(v_p50),
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
                            'dispatched', v_sent, 'first_read_dispatched', v_first, 'in_flight', v_inflight, 'slots_free', v_slots,
                            'stream_lots',v_stream_lots,'stream_request_id',v_stream_req, 'run_ms', v_ms, 'run_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$fn$;

COMMENT ON FUNCTION public.bat_live_pull_run(integer,boolean) IS
  'Existing BaT reader with continuous closing capture and bounded recovery of source-unsettled current-cache lots lacking a monitor. Requires the existing canonical source URL/native-post binding. Board status and elapsed deadlines do not suppress acquisition; all source testimony still enters through ingest-observation. HTML slots per run: live_pull.lots_per_run (default 6; p_lots overrides only when passed); closing-window lots take at most live_pull.closing_slots (default 1) because the native stream covers them. A lot dispatched in the last 150 s and not yet read holds one slot and is not due again; the run pauses dispatch when the median of its own last 10 run times (live_pull.run_samples) exceeds live_pull.pause_run_p50_ms (default 15000 ms); the dispatch and accounting loops lock their rows FOR UPDATE SKIP LOCKED (2026-10-13).';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(scraping_config, '{live_pull}',
      ((scraping_config -> 'live_pull') - 'rest_probes' - 'pause_rest_p50_ms') || '{"pause_run_p50_ms": 15000}'::jsonb)
WHERE slug = 'bat' AND scraping_config ? 'live_pull';
COMMIT;

-- Verify after apply (read-only, scripts/data/q.sh):
--   select scraping_config #> '{live_pull,pause_run_p50_ms}', scraping_config ? 'rest_probes', scraping_config #> '{live_pull,last_run}'
--     from live_auction_sources where slug = 'bat';   -- 15000, false, then after a minute: in_flight, slots_free, run_ms, run_p50_ms present
--   select date_trunc('minute', last_synced_at), count(*) from monitored_auctions where last_synced_at > now() - interval '1 hour'
--     group by 1 order by 1;   -- most minutes at 6
--   select start_time, status, left(return_message, 120) from cron.job_run_details where jobid = 511 order by start_time desc limit 4;
-- Revert: a migration re-creating the 20261006060000 body; the config row's pause_run_p50_ms is then unread and harmless.
