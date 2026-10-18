-- Approved closing-reader rollout repair: derived clock status is not source closure.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';

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
  'Existing hourly reader and first-read reserve plus minute dispatch of overlapping public WebSocket workers for every closing BaT lot. p_lots caps HTML fallback only. Native source outcomes retire lots; scheduled ends do not. Healthy stream sessions suppress redundant HTML. Coverage and admission lag are measured separately from cron exit status.';

COMMIT;
