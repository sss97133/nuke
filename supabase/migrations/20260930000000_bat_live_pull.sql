-- The live BaT pull: every live lot's comments and bids, read on a schedule through the deployed reader
-- (extract-bat-core), so the live card can show the bid's percentile at time-to-close and the lot's activity
-- (bids, bidders, comment velocity) against comparable lots. Session data-audit, 2026-09-30.
-- Proposed by data-audit; the lead ships it, then enables the two jobs after the preconditions below are live.
--
-- WHY: on 2026-09-29, 1 of 1,213 live BaT lots had its comments and bids in prod (the SL500, read by hand).
-- Neither hook meant for live lots records anything. sync-live-auctions' bid snapshots have matched 0 lots per run
-- since 2026-07-22, and its 6-hour extract-auction-comments trigger returned 368 x HTTP 500 on 09-29
-- (docs/ledger/2026-09-30_bat-data-coverage-audit.md §4.1).
--
-- MEASURED: 14 live no-reserve lots, 2026-09-29 23:47-23:53Z, sequential 2 s apart, {"url", "prefer_snapshot": false}.
--   First read:
--     wall p50 9.3 s (max 11.1 s). Reader phases after the BaT fetch took p50 7.9 s, of which
--     vehicle_write was 4.8 s (precondition 2 below).
--     DB exec was at most 20.1 s for the pass: the pg_stat_statements delta, all activity, so about
--     1.4 s per lot.
--     Rows per lot: 24 comments (6 of them bids), 154 image links, 1 auction_events, 1 vehicle_events,
--     3 timeline_events, 1 observation. 12 of 14 lots gained a VIN.
--   Re-read 4 minutes later:
--     wall p50 3.8 s. DB exec at most 3.8 s for the pass, about 0.27 s per lot.
--     0 duplicate rows; the only new rows were new comments (2).
--   REST p50 (anon GET vehicles?select=id&limit=1, 10 samples each): 0.210 s before the first pass,
--   0.209 s after it, 0.207 s after the second.
--
-- PRECONDITIONS: extract-bat-core, bat-data lane. Leave the jobs paused until both are deployed.
--   1. A lot whose end time is still in the future is live. Today the reader writes auction_events.outcome
--      'bid_to' (or 'reserve_not_met', and vehicles.auction_outcome with it) mid-auction; it should write
--      'live' and leave vehicles.auction_outcome alone.
--   2. vehicles.auction_end_date is not superseded by the date-only value. Today every live read rewrites
--      '2026-09-30T18:23:00Z' to '2026-09-30' through the chokepoint, and sync-live-auctions writes the
--      timestamp back, so each read ping-pongs. Meanwhile market_pulse_live() reads midnight, which moves the
--      hours-left for the heat tag and drops a lot ending today off the board until the next sync.
--   bat_listings: live lots have no bat_listings row (0 of 1,213 on 09-29), so during the auction their bids
--   are comment-only: auction_comments.comment_type = 'bid', with amount, time and bidder, which is what the
--   card reads. bat_bids receives them at settlement, once bat-closed-lots-sync has created the row. This
--   migration does not change that.
--
-- DESIGN: existing organs only (SCHEMA_LAW §1, §4).
--   live_auction_sources (slug 'bat') is the health row: last_successful_sync, last_sync_error,
--     consecutive_failures and health_status. The pull's settings, its REST probe ring and the last run's
--     counts live in scraping_config->'live_pull'.
--   monitored_auctions is the per-lot schedule: last_synced_at (dispatched), next_poll_at, poll_interval_ms,
--     last_comment_count, last_comment_synced_at and sync_latency_ms. Its 211 BaT rows are from 2026-02,
--     left by the dead poller.
--   extract-bat-core is the only writer of testimony. These functions write only schedule and health state.
--
-- THE JOBS (both created PAUSED):
--   bat-live-pull runs every minute:
--     1. Account the previous pass. A lot counts as read when its auction_events row was written after
--        dispatch; rows landed = comment rows now minus the last count.
--     2. Skip the run when a pass is still in flight, or when REST p50 over the last 10 probes is over 2 s.
--     3. Sync the schedule.
--     4. Dispatch 3 due lots, those ending within 48 h first.
--   bat-live-pull-check runs every 15 min. It fails, which shows in v_job_health, when dispatched lots aren't
--     being read, when reads land no comment rows, when lots fall 2 h overdue, or when the pull has stopped or
--     stayed paused for 2 h. Otherwise it returns the counts.
-- Cadence per lot:
--   - first read at once;
--   - every 24 h while more than 48 h are left;
--   - every 6 h from 48 h down to 12 h;
--   - every hour in the last 12 h.
-- That is about 24 reads a lot. With about 170 lots closing a day (169 over 08-28..09-26), that's about 4,000
-- reads a day (about 170 an hour) against the ceiling of 180 an hour. At the measured costs, DB exec is about
-- 170 × 1.4 s + 3,900 × 0.27 s ≈ 22 min a day. BaT fetches run at 3 a minute (the BaT row's limit is 20).
-- The first pass over the current 1,213 live lots takes about 7 h, with lots ending within 48 h done in the first ~2.5 h.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

UPDATE public.live_auction_sources
SET scraping_config = coalesce(scraping_config, '{}'::jsonb) || jsonb_build_object('live_pull', coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object(
      'lots_per_run', 3,
      'pause_rest_p50_ms', 2000,
      'priority_window_hours', 48,
      'cadence_minutes', jsonb_build_object('over_48h', 1440, 'h12_to_48', 360, 'under_12h', 60),
      'reader', 'extract-bat-core',
      'migration', '20260930000000_bat_live_pull'))
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
    -- 4. Dispatch: lots ending within the priority window first (never-read first, then soonest end), then the rest.
    FOR r IN
      SELECT m.id, m.external_auction_url, m.auction_end_time
      FROM monitored_auctions m
      WHERE m.source_id = v_src AND m.is_live AND m.auction_end_time > v_now
        AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now)
      ORDER BY (m.auction_end_time <= v_now + v_window) DESC, m.next_poll_at NULLS FIRST, m.auction_end_time
      LIMIT greatest(coalesce(p_lots, 0), 0)
    LOOP
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
          'comment_rows_landed', v_rows, 'dispatched', v_sent, 'rest_p50_ms', round(v_p50),
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
                            'dispatched', v_sent, 'rest_p50_ms', round(v_p50), 'skipped', v_skip);
END;
$fn$;

COMMENT ON FUNCTION public.bat_live_pull_run(integer, boolean) IS
  'The live BaT pull (2026-09-30): accounts the previous pass (read = the lot''s auction_events row written after dispatch; rows landed = new auction_comments), skips when a pass is in flight or REST p50 over the last 10 probes is over 2 s, syncs monitored_auctions from the live board, and dispatches p_lots due lots to extract-bat-core (ending within 48 h first). Health: live_auction_sources slug bat. Check: bat_live_pull_check().';
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
         count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.next_poll_at < now() - interval '2 hours')
    INTO v_disp, v_read, v_read3, v_over
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
  IF v_over >= 25 THEN
    RAISE EXCEPTION 'bat-live-pull: % live lots are over 2 h past their next read (raise lots_per_run or check the pull)', v_over;
  END IF;

  RETURN format('ok: %s of %s dispatched lots read in the last hour; %s comment rows landed in 3 h; %s lots overdue; last run %s',
                v_read, v_disp, v_rows, v_over, v_last);
END;
$fn$;

COMMENT ON FUNCTION public.bat_live_pull_check() IS
  'Fails when the live BaT pull does not land rows: lots dispatched but not read, reads that land no comment rows, lots 2 h overdue, or a pull that stopped or stayed paused for 2 h. Scheduled as bat-live-pull-check so the failure shows in v_job_health.';
REVOKE ALL ON FUNCTION public.bat_live_pull_check() FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  v_id  bigint;
  v_pull  text := $cmd$SELECT set_config('app.writer', 'bat-live-pull', true); SET statement_timeout = '50s'; SELECT public.bat_live_pull_run(3);$cmd$;
  v_check text := $cmd$SET statement_timeout = '50s'; SELECT public.bat_live_pull_check();$cmd$;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'bat-live-pull';
  IF v_id IS NULL THEN
    v_id := cron.schedule('bat-live-pull', '* * * * *', v_pull);
    PERFORM cron.alter_job(job_id := v_id, active := false);   -- off until the reader preconditions are live
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '* * * * *', command := v_pull);
  END IF;

  v_id := NULL;
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'bat-live-pull-check';
  IF v_id IS NULL THEN
    v_id := cron.schedule('bat-live-pull-check', '*/15 * * * *', v_check);
    PERFORM cron.alter_job(job_id := v_id, active := false);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '*/15 * * * *', command := v_check);
  END IF;
END
$do$;

-- Live verification after apply, before enabling:
--   select jobid, jobname, schedule, active from cron.job where jobname like 'bat-live-pull%';   -- both active = false
--   select public.bat_live_pull_run(0, true);   -- accounting, probe and schedule sync only: dispatched 0
--   select count(*) from monitored_auctions m join live_auction_sources s on s.id = m.source_id and s.slug = 'bat' where m.is_live;   -- about the live board's count
-- Enable, once preconditions 1 and 2 are deployed:
--   select cron.alter_job(jobid, active := true) from cron.job where jobname in ('bat-live-pull', 'bat-live-pull-check');
-- After an hour:
--   select * from v_job_health where jobname like 'bat-live-pull%';
--   select scraping_config #> '{live_pull,last_run}', health_status, last_sync_error from live_auction_sources where slug = 'bat';
--   select public.bat_live_pull_check();
-- Stop: select cron.alter_job(jobid, active := false) from cron.job where jobname like 'bat-live-pull%';
