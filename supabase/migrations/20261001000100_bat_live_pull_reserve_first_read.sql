-- C1 (docs/ledger/theory/data-machine-cases.md): the live pull starves lots beyond 48 h, and its check is blind to
-- never-read lots.
--
-- WHY: bat_live_pull_run orders the due queue by (ends within 48 h) first. The window needs about 332 reads an hour at
-- peak against the ceiling of 180 (3 lots a minute), so the queue beyond the window never gets a slot, and a lot's first
-- read waits until it enters the window, already behind. bat_live_pull_check counts overdue as next_poll_at 2 h past,
-- which a never-dispatched lot (next_poll_at IS NULL) can never be, so the check read 0 overdue and exit 0.
--
-- MEASURED before (2026-10-01 01:00Z, monitored_auctions, BaT source, is_live and ending in the future):
--   12-48 h:   393 lots, 0 never dispatched, 0 overdue 2 h, 391 read at least once.
--   over 48 h: 824 lots, 517 never dispatched (489 of them in the schedule more than 2 h), 0 overdue, 306 read once.
--   bat_live_pull_check: ok, 0 lots overdue. v_job_health: 759 runs / 0 failed in 24 h.
--   (At 01:00Z no lot closes within 12 h; the ledger's 106 of 243 overdue at 19:45Z is the peak-hour symptom.)
--
-- CHANGE (both functions replaced whole; the rest of their text is the 20260930000000 definition):
--   bat_live_pull_run: reserve_first_read (default 1) of the p_lots slots go to never-dispatched lots, soonest end
--     first, whatever the window; the rest to the due queue as before; an unused reserve slot falls back to the queue.
--     last_run gains first_read_dispatched.
--   bat_live_pull_check: counts never-dispatched live lots in the schedule more than 2 h as overdue (v_never), and
--     fails when overdue + never-read >= 25. It will be red until the backlog drains: 489 lots at about 60 first reads
--     an hour less about 7 new lots an hour is about 9 h. That red is the truth the old check hid.
--
-- EXPECTED after: never_dispatched over 48 h falls by about 60 an hour; 12-48 h stays at 0 never dispatched.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb)
      || jsonb_build_object('reserve_first_read', 1, 'migration', '20261001000100_bat_live_pull_reserve_first_read'))
WHERE slug = 'bat';

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
           (SELECT max(e.updated_at) FROM auction_events e WHERE e.vehicle_id = m.vehicle_id) AS read_at
    FROM monitored_auctions m
    WHERE m.source_id = v_src
      AND m.vehicle_id IS NOT NULL
      AND m.last_synced_at > v_now - interval '6 hours'
      AND (m.last_comment_synced_at IS NULL OR m.last_comment_synced_at < m.last_synced_at)
  LOOP
    IF r.read_at >= r.last_synced_at THEN
      SELECT count(*) INTO v_n FROM auction_comments c WHERE c.vehicle_id = r.vehicle_id;
      UPDATE monitored_auctions
      SET last_comment_count     = v_n,
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
      AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.vehicle_id = m.vehicle_id AND e.updated_at >= m.last_synced_at)
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
  -- 3a. Every run: a lot whose end time has passed leaves the schedule (settlement reads its result).
  UPDATE monitored_auctions m SET is_live = false
  WHERE m.source_id = v_src AND m.is_live AND (m.auction_end_time IS NULL OR m.auction_end_time <= v_now);

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
        AND CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN v.auction_end_date::timestamptz END > v_now
        AND v.listing_url ~ '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+'
    ) l
    ON CONFLICT (source_id, external_auction_id) DO UPDATE
    SET is_live = true, vehicle_id = EXCLUDED.vehicle_id, auction_end_time = EXCLUDED.auction_end_time,
        external_auction_url = EXCLUDED.external_auction_url, priority = EXCLUDED.priority
    WHERE (m.is_live, m.vehicle_id, m.auction_end_time, m.priority)
          IS DISTINCT FROM (true, EXCLUDED.vehicle_id, EXCLUDED.auction_end_time, EXCLUDED.priority);

    UPDATE monitored_auctions m SET is_live = false
    WHERE m.source_id = v_src AND m.is_live
      AND NOT EXISTS (SELECT 1 FROM vehicles v
                      WHERE v.id = m.vehicle_id AND v.sale_status = 'auction_live' AND v.deleted_at IS NULL);
  END IF;

  IF v_skip IS NULL THEN
    -- 4. Dispatch. v_reserve slots go to never-dispatched lots (soonest end first, whatever the window); the rest go
    --    to the due queue as before: lots ending within the priority window first (never-read first, then soonest
    --    end), then the rest. An unused reserve slot falls back to the due queue.
    FOR r IN
      WITH due AS (
        SELECT m.id, m.external_auction_url, m.auction_end_time, m.next_poll_at
        FROM monitored_auctions m
        WHERE m.source_id = v_src AND m.is_live AND m.auction_end_time > v_now
          AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now)
      ), fresh AS (
        SELECT d.id FROM due d WHERE d.next_poll_at IS NULL
        ORDER BY d.auction_end_time
        LIMIT v_reserve
      ), rest AS (
        SELECT d.id FROM due d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id)
        ORDER BY (d.auction_end_time <= v_now + v_window) DESC, d.next_poll_at NULLS FIRST, d.auction_end_time
        LIMIT greatest(greatest(coalesce(p_lots, 0), 0) - (SELECT count(*) FROM fresh), 0)
      )
      SELECT d.id, d.external_auction_url, d.auction_end_time, (d.next_poll_at IS NULL) AS first_read
      FROM due d
      WHERE d.id IN (SELECT id FROM fresh UNION ALL SELECT id FROM rest)
      ORDER BY d.auction_end_time
    LOOP
      IF r.first_read THEN v_first := v_first + 1; END IF;
      v_cad := CASE
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
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'first_read_dispatched', v_first, 'rest_p50_ms', round(v_p50),
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
                            'dispatched', v_sent, 'first_read_dispatched', v_first, 'rest_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$fn$;

COMMENT ON FUNCTION public.bat_live_pull_run(integer, boolean) IS
  'The live BaT pull (2026-09-30, C1 2026-10-01): accounts the previous pass (read = the lot''s auction_events row written after dispatch; rows landed = new auction_comments), skips when a pass is in flight or REST p50 over the last 10 probes is over 2 s, syncs monitored_auctions from the live board, and dispatches p_lots due lots to extract-bat-core: reserve_first_read slots (default 1) to never-dispatched lots soonest end first, the rest ending within 48 h first. Health: live_auction_sources slug bat. Check: bat_live_pull_check().';
REVOKE ALL ON FUNCTION public.bat_live_pull_run(integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bat_live_pull_check()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_src    uuid;
  v_last   jsonb;
  v_at     timestamptz;
  v_paused timestamptz;
  v_err    text;
  v_disp   integer;
  v_read   integer;
  v_read3  integer;
  v_rows   bigint;
  v_over   integer;
  v_never  integer;
BEGIN
  SELECT id, scraping_config #> '{live_pull,last_run}', last_sync_error INTO v_src, v_last, v_err
  FROM live_auction_sources WHERE slug = 'bat';
  v_at     := (v_last ->> 'at')::timestamptz;
  v_paused := (v_last ->> 'paused_since')::timestamptz;

  IF v_at IS NULL OR v_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'bat-live-pull: no run since %', coalesce(v_at::text, 'it was created');
  END IF;
  IF v_paused IS NOT NULL AND v_paused < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'bat-live-pull: paused since % (%)', v_paused, coalesce(v_last ->> 'skipped', v_err);
  END IF;

  SELECT count(*) FILTER (WHERE m.last_synced_at BETWEEN now() - interval '70 minutes' AND now() - interval '10 minutes'),
         count(*) FILTER (WHERE m.last_synced_at BETWEEN now() - interval '70 minutes' AND now() - interval '10 minutes'
                            AND m.last_comment_synced_at >= m.last_synced_at AND m.sync_latency_ms IS NOT NULL),
         count(*) FILTER (WHERE m.last_synced_at > now() - interval '3 hours' AND m.last_comment_synced_at >= m.last_synced_at),
         count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.next_poll_at < now() - interval '2 hours'),
         count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.next_poll_at IS NULL AND m.created_at < now() - interval '2 hours')
    INTO v_disp, v_read, v_read3, v_over, v_never
  FROM monitored_auctions m WHERE m.source_id = v_src;

  IF v_disp >= 8 AND v_read * 2 < v_disp THEN
    RAISE EXCEPTION 'bat-live-pull: % of % lots dispatched 10-70 min ago were read (%)', v_read, v_disp, coalesce(v_err, 'no error recorded');
  END IF;

  SELECT count(*) INTO v_rows
  FROM auction_comments c
  WHERE c.created_at > now() - interval '3 hours'
    AND c.vehicle_id IN (SELECT m.vehicle_id FROM monitored_auctions m
                          WHERE m.source_id = v_src AND m.last_synced_at > now() - interval '3 hours');
  IF v_read3 >= 30 AND v_rows = 0 THEN
    RAISE EXCEPTION 'bat-live-pull: % reads in 3 h landed 0 comment rows', v_read3;
  END IF;
  -- C1: a lot never dispatched 2 h after entering the schedule is as overdue as one 2 h past its next read.
  IF v_over + v_never >= 25 THEN
    RAISE EXCEPTION 'bat-live-pull: % live lots are over 2 h past their next read and % live lots were never read 2 h after entering the schedule (raise lots_per_run or reserve_first_read, or check the pull)', v_over, v_never;
  END IF;

  RETURN format('ok: %s of %s dispatched lots read in the last hour; %s comment rows landed in 3 h; %s lots overdue; %s never read after 2 h; last run %s',
                v_read, v_disp, v_rows, v_over, v_never, v_last);
END;
$fn$;

COMMENT ON FUNCTION public.bat_live_pull_check() IS
  'Fails when the live BaT pull does not land rows: lots dispatched but not read, reads that land no comment rows, 25 or more lots 2 h overdue or never read 2 h after entering the schedule (C1), or a pull that stopped or stayed paused for 2 h. Scheduled as bat-live-pull-check so the failure shows in v_job_health.';
REVOKE ALL ON FUNCTION public.bat_live_pull_check() FROM PUBLIC, anon, authenticated;

-- Live verification after apply:
--   select public.bat_live_pull_check();   -- expected to raise with the never-read count until the backlog drains
--   select scraping_config #> '{live_pull,last_run}' from live_auction_sources where slug = 'bat';  -- first_read_dispatched 1
--   the bucket query from the header, an hour later: never_dispatched over 48 h down by about 60.
