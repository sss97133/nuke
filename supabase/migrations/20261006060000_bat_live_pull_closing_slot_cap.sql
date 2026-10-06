-- bat-live-pull: closing lots take at most one HTML slot; the slot count moves from cron 510's argument into config.
--
-- WHY (lane H, 2026-10-06; ~/nuke-logs/data-hygiene-20261005/H-LIVE-PULL.md): bat-live-pull-check failed every run from
-- 2026-10-05 10Z, overdue peaking at 453 lots. The three HTML slots went to closing-window lots first, every minute, although
-- the native stream (20261004182500) covers them: 220 of 220 lots closing 10-05 took HTML reads in their last 10 minutes,
-- and 220 of 220 also have a native terminal receipt. Daytime need is ~270 reads/h (17Z-19Z: 660-850) against ~164/h
-- effective at 3 slots. Replay of the slot allocation on the 10-06 lot set: 3 slots peak 135 overdue / 4 failing hours;
-- 4 slots 103 / 3 h; 6 slots with closing capped at 1: peak 1, 0 failing hours.
--
-- WHAT (smallest forward edit of the 20261004225710 body, verified identical to production on 2026-10-06):
--   1. v_lots   = p_lots when passed, else live_pull.lots_per_run, else 6. The config key existed but was never read.
--   2. v_closing = live_pull.closing_slots (default 1), capped by v_lots: the closing CTE's LIMIT. fresh and rest
--      skip closing-window lots, so the cap is not bypassed through the first-read reserve or the NULLS FIRST order.
--   3. The run writes back only rest_probes/last_run over the row's current live_pull, so a config edit made while a run
--      is in flight is no longer overwritten by that run's stale copy.
--   4. live_pull.lots_per_run 3 -> 6, closing_slots 1; cron 510 calls bat_live_pull_run() with no argument.
-- Unchanged: the pause rule (pause_rest_p50_ms 2000 over 10 REST probes), the one-pass-in-flight guard, reserve_first_read,
-- cadences, the stream dispatch, recovery inserts. No testimony, schema, grant or schedule change.
-- Load bound: at most 6 extract-bat-core HTML reads per minute; REST p50 was 3-4 ms at 05:00Z on 10-06, and the existing
-- pause rule halts dispatch above 2,000 ms -- the guard added after the 2026-09-28/29 DB stall (heartbeat runs of 138-224 s,
-- server restart 09-29 09:20Z).
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
  v_pause_ms := coalesce((v_cfg ->> 'pause_rest_p50_ms')::integer, 2000);
  v_window   := make_interval(hours => coalesce((v_cfg ->> 'priority_window_hours')::integer, 48));
  v_last     := coalesce(v_cfg -> 'last_run', '{}'::jsonb);
  -- C1: slots per run held for lots never dispatched (next_poll_at IS NULL), so lots beyond the priority window
  -- get their first read instead of waiting for the window to have fewer than p_lots due lots (it never does at peak).
  -- Slots per run come from live_pull.lots_per_run (default 6); p_lots overrides only when passed. Closing-window lots
  -- take at most live_pull.closing_slots (default 1): the native stream covers them, and spending every slot on them
  -- starved the hourly/daily cadences (2026-10-05: 220/220 closing lots took HTML slots; the check failed from 10Z).
  v_lots     := greatest(coalesce(p_lots, (v_cfg ->> 'lots_per_run')::integer, 6), 0);
  v_closing  := least(greatest(coalesce((v_cfg ->> 'closing_slots')::integer, 1), 0), v_lots);
  v_reserve  := least(coalesce((v_cfg ->> 'reserve_first_read')::integer, 1), v_lots);

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
        LIMIT v_closing
      ), fresh AS (
        SELECT d.id FROM due d WHERE d.next_poll_at IS NULL
          AND d.auction_end_time > v_now + interval '10 minutes'   -- closing-window lots only via closing's cap
        ORDER BY d.auction_end_time
        LIMIT least(v_reserve, greatest(v_lots - (SELECT count(*) FROM closing), 0))
      ), rest AS (
        SELECT d.id FROM due d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id)
          AND d.auction_end_time > v_now + interval '10 minutes'   -- closing-window lots only via closing's cap
        ORDER BY (d.auction_end_time <= v_now + v_window) DESC, d.next_poll_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(v_lots - (SELECT count(*) FROM fresh) - (SELECT count(*) FROM closing), 0)
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
  SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}', coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object(
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
  'Existing BaT reader with continuous closing capture and bounded recovery of source-unsettled current-cache lots lacking a monitor. Requires the existing canonical source URL/native-post binding. Board status and elapsed deadlines do not suppress acquisition; all source testimony still enters through ingest-observation. HTML slots per run: live_pull.lots_per_run (default 6; p_lots overrides only when passed); closing-window lots take at most live_pull.closing_slots (default 1) because the native stream covers them.';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(scraping_config, '{live_pull}',
      (scraping_config -> 'live_pull') || '{"lots_per_run": 6, "closing_slots": 1}'::jsonb)
WHERE slug = 'bat' AND scraping_config ? 'live_pull';

DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'bat-live-pull';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id,
      command := $cmd$SELECT set_config('app.writer', 'bat-live-pull', true); SET statement_timeout = '50s'; SELECT public.bat_live_pull_run();$cmd$);
  END IF;
END
$do$;
COMMIT;

-- Verify after apply (read-only):
--   select scraping_config #> '{live_pull,lots_per_run}', scraping_config #> '{live_pull,closing_slots}' from live_auction_sources where slug = 'bat';  -- 6, 1
--   select command from cron.job where jobname = 'bat-live-pull';   -- ends in bat_live_pull_run();
--   select scraping_config #> '{live_pull,last_run}' from live_auction_sources where slug = 'bat';  -- dispatched up to 6, skipped null
--   select start_time, status, left(return_message, 120) from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'bat-live-pull-check') order by start_time desc limit 4;
-- If a pre-migration run was in flight at commit, it can write back lots_per_run 3 once; re-run the UPDATE above.
-- Revert: set live_pull.lots_per_run 3 and closing_slots 3 (the old behaviour), no redeploy needed.
