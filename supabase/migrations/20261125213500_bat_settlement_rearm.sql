-- bat_settlement_rearm_v1: a throttled, self-ending job that puts the BaT settlement reads that failed during the
-- 2026-11-25 sale_price block back in the settlement queue, through the queue's re-pend writer, each one once.
--
-- WHY. From 2026-11-12 until 2026-11-25 09:53Z every auction_events write from the BaT reader failed with
-- 'record "new" has no field "sale_price"' (close_deal_on_sale, fixed by 20261125084210). A lot leaves the live
-- schedule (monitored_auctions.is_live) only when a sold / reserve_not_met / cancelled row lands, so 1,655 ended
-- lots stayed is_live (read-only count 2026-11-25 10:00Z: source bat, is_live, auction_end_time < now). Their
-- settlement items (import_queue, source 4d3f0c9e...) are finished and never claimed again: 935 failed (889 at
-- attempts 5), 530 complete (the reader's auction_events upsert is non-fatal, so the item completed with no outcome
-- written) (skeptic2's live count, 2026-11-25 ~10:40Z). claim_import_queue_batch claims status 'pending' only, and
-- bat-closed-lots-sync queues with ignoreDuplicates, so nothing re-pends them. The only other path is the puller's
-- closing slot: 1 lot per minute.
--
-- WHAT.
--   1. requeue_import_queue_item(id, reason, attempts_floor): the queue's re-pend writer. A complete or failed item
--      becomes pending, unlocked, claimable now, attempts raised to the floor, the reason and prior status kept in
--      revision_detail.requeued. Revision items are not touched (they leave only through resolve_revision_item).
--   2. Rule row: live_auction_sources (bat) scraping_config.live_pull.settle_rearm = {rows_per_minute 10,
--      attempted_before 2026-11-25T09:54:00Z, pause_when_closing_within_minutes 10, attempts_floor 7, basis}.
--   3. bat_settlement_rearm(): per call, unless a live BaT lot ends within the pause window, re-pends at most
--      rows_per_minute settlement items whose monitor is still is_live and ended over 10 min ago, status complete or
--      failed, last attempt (or update) before attempted_before; then posts one process-import-queue batch of that
--      size. attempts_floor 7: the claim makes it 8, so a failed re-read is final (the drain fails non-transient at 5
--      and transient at 8), i.e. one fetch per item. The claim stamps last_attempt_at, so an item is re-armed at most
--      once and a lot a re-read does not retire is not looped. Each call writes its gauge to job_assay_readings
--      (status running / paused_closing / done, rearmed this run and in total, re-armed lots retired, items left).
--      When none is left it sets its own cron job inactive and the gauge says done.
--   4. v_job_health: a job with no assay of its own shows its fresh job_assay_readings row (assay, assay_status), so
--      bat-settlement-rearm is visible there (patched in place; each anchor must match once).
--   5. Cron bat-settlement-rearm, every minute.
-- The 35 revision items of stuck lots stay with the revision queue; no BaT worker claims them, so the puller's
-- closing slot reads those lots. Transfers: a lot that resolves late seeds an ownership_transfers row through
-- auto_create_transfer_on_auction_close; platform_config transfer_notifications is {"enabled": false} (20261125084210),
-- so no message is sent.
-- Selection measured read-only on prod (EXPLAIN ANALYZE of the SELECT, 2026-11-25 10:15Z): 28 ms, monitored_auctions
-- seq scan (11.7k rows) then import_queue_listing_url_key; no index is built.
-- Rate: 10 per minute plus the drain's 10 per 5 minutes and the puller's closing slot, about 780 lots an hour while no
-- lot is closing, so the ~1,465 items take about 2 hours; the job pauses itself while lots close.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.requeue_import_queue_item(p_id uuid, p_reason text, p_attempts_floor integer DEFAULT 0)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'requeue_import_queue_item: a reason is required';
  END IF;
  UPDATE public.import_queue
  SET status = 'pending',
      attempts = greatest(coalesce(attempts, 0), greatest(coalesce(p_attempts_floor, 0), 0)),
      next_attempt_at = NULL, locked_at = NULL, locked_by = NULL,
      revision_detail = coalesce(revision_detail, '{}'::jsonb) || jsonb_build_object('requeued', jsonb_build_object(
        'at', now(), 'reason', p_reason, 'from_status', status, 'attempts_before', attempts)),
      updated_at = now()
  WHERE id = p_id AND status IN ('complete', 'failed');
  RETURN FOUND;
END;
$function$;

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object('settle_rearm', jsonb_build_object(
        'rows_per_minute', 10,
        'attempted_before', '2026-11-25T09:54:00Z',
        'pause_when_closing_within_minutes', 10,
        'attempts_floor', 7,
        'basis', 'BaT outcome writes failed 2026-11-12..2026-11-25 09:53Z (close_deal_on_sale, fixed by 20261125084210); '
                 || 'settlement items of the 1,655 lots left is_live were finished without an outcome; 10 a minute '
                 || 'beside the drain''s 10 per 5 minutes and the puller''s closing slot')))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,settle_rearm}' IS NULL;

CREATE OR REPLACE FUNCTION public.bat_settlement_rearm()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_queue   constant uuid := '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37';   -- bat settlement scrape_sources row
  v_reason  constant text := 'bat_settlement_rearm: settlement read finished without an outcome in the sale_price block';
  v_started timestamptz := clock_timestamp();
  v_src     uuid;
  v_rule    jsonb;
  v_rate    integer;
  v_cutoff  timestamptz;
  v_pause   integer;
  v_floor   integer;
  v_busy    integer := 0;
  v_rearmed integer := 0;
  v_left    integer;
  v_total   integer;
  v_retired integer;
  v_req     bigint;
  v_status  text;
  v_reading jsonb;
  r         record;
BEGIN
  SELECT id, scraping_config #> '{live_pull,settle_rearm}' INTO v_src, v_rule FROM live_auction_sources WHERE slug = 'bat';
  v_rate   := CASE WHEN v_rule ->> 'rows_per_minute' ~ '^\d{1,2}$' THEN least((v_rule ->> 'rows_per_minute')::integer, 50) END;
  v_cutoff := CASE WHEN pg_input_is_valid(v_rule ->> 'attempted_before', 'timestamptz') THEN (v_rule ->> 'attempted_before')::timestamptz END;
  v_pause  := CASE WHEN v_rule ->> 'pause_when_closing_within_minutes' ~ '^\d{1,3}$' THEN (v_rule ->> 'pause_when_closing_within_minutes')::integer END;
  v_floor  := CASE WHEN v_rule ->> 'attempts_floor' ~ '^\d$' THEN (v_rule ->> 'attempts_floor')::integer END;
  IF v_src IS NULL OR v_rate IS NULL OR v_cutoff IS NULL OR v_pause IS NULL OR v_floor IS NULL THEN
    RAISE EXCEPTION 'bat_settlement_rearm: rule row live_auction_sources(bat).scraping_config.live_pull.settle_rearm missing or malformed';
  END IF;

  -- Closing reads come first: no re-arm while a live lot ends within the pause window.
  SELECT count(*) INTO v_busy FROM monitored_auctions
  WHERE source_id = v_src AND is_live AND auction_end_time > now() AND auction_end_time <= now() + make_interval(mins => v_pause);

  IF v_busy = 0 AND v_rate > 0 THEN
    FOR r IN
      SELECT i.id
      FROM monitored_auctions m
      JOIN import_queue i ON i.listing_url IN (m.external_auction_url, m.external_auction_url || '/')
      WHERE m.source_id = v_src AND m.is_live
        AND m.auction_end_time < now() - interval '10 minutes'
        AND i.source_id = v_queue
        AND i.status IN ('complete', 'failed')
        AND coalesce(i.last_attempt_at, i.updated_at) < v_cutoff
      ORDER BY m.auction_end_time DESC, i.id
      LIMIT v_rate
      FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF public.requeue_import_queue_item(r.id, v_reason, v_floor) THEN v_rearmed := v_rearmed + 1; END IF;
    END LOOP;
    IF v_rearmed > 0 THEN
      v_req := net.http_post(
        url := get_service_url() || '/functions/v1/process-import-queue',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := jsonb_build_object('batch_size', v_rearmed, 'source_id', v_queue),
        timeout_milliseconds := 150000);
    END IF;
  END IF;

  SELECT count(*) INTO v_left
  FROM monitored_auctions m
  JOIN import_queue i ON i.listing_url IN (m.external_auction_url, m.external_auction_url || '/')
  WHERE m.source_id = v_src AND m.is_live
    AND m.auction_end_time < now() - interval '10 minutes'
    AND i.source_id = v_queue
    AND i.status IN ('complete', 'failed')
    AND coalesce(i.last_attempt_at, i.updated_at) < v_cutoff;

  SELECT count(*), count(*) FILTER (WHERE m.is_live IS FALSE) INTO v_total, v_retired
  FROM import_queue i
  LEFT JOIN monitored_auctions m ON m.source_id = v_src AND i.listing_url IN (m.external_auction_url, m.external_auction_url || '/')
  WHERE i.source_id = v_queue AND i.revision_detail #>> '{requeued,reason}' = v_reason;

  v_status := CASE WHEN v_left = 0 THEN 'done' WHEN v_busy > 0 THEN 'paused_closing' ELSE 'running' END;
  v_reading := jsonb_build_object('status', v_status, 'at', now(), 'rearmed_this_run', v_rearmed, 'rearmed_total', v_total,
    'rearmed_lots_retired', v_retired, 'left', v_left, 'closing_lots_in_pause_window', v_busy,
    'rows_per_minute', v_rate, 'request_id', v_req);
  INSERT INTO job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  VALUES ('bat-settlement-rearm', v_reading, now(),
          greatest(0, round(extract(epoch FROM clock_timestamp() - v_started) * 1000))::integer, now(), NULL,
          interval '1 minute', CASE WHEN v_status = 'done' THEN interval '30 days' ELSE interval '5 minutes' END)
  ON CONFLICT (jobname) DO UPDATE
    SET reading = EXCLUDED.reading, assayed_at = EXCLUDED.assayed_at, elapsed_ms = EXCLUDED.elapsed_ms,
        attempted_at = EXCLUDED.attempted_at, attempt_error = NULL, refresh_every = EXCLUDED.refresh_every,
        fresh_for = EXCLUDED.fresh_for;

  -- Self-ending: the candidate set can only shrink (the cutoff is in the past). Done: the job goes inactive and says so.
  IF v_left = 0 THEN
    PERFORM cron.alter_job(j.jobid, active := false) FROM cron.job j WHERE j.jobname = 'bat-settlement-rearm' AND j.active;
  END IF;

  RETURN v_reading;
END;
$function$;

REVOKE ALL ON FUNCTION public.requeue_import_queue_item(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bat_settlement_rearm() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.requeue_import_queue_item(uuid, text, integer) FROM anon;
    REVOKE ALL ON FUNCTION public.bat_settlement_rearm() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.requeue_import_queue_item(uuid, text, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION public.bat_settlement_rearm() FROM authenticated;
  END IF;
END $$;

-- v_job_health: a job with no assay of its own shows its fresh job_assay_readings row.
DO $view$
DECLARE
  d  text := pg_get_viewdef('public.v_job_health'::regclass);
  n1 int  := (SELECT count(*) FROM regexp_matches(d, 'ELSE NULL::text\s+END AS assay_status', 'g'));
  n2 int  := (SELECT count(*) FROM regexp_matches(d, 'ELSE NULL::jsonb\s+END AS assay,', 'g'));
BEGIN
  IF position('job_assay_readings own' IN d) > 0 THEN RETURN; END IF;
  IF n1 <> 1 OR n2 <> 1 THEN RAISE EXCEPTION 'v_job_health assay anchors drifted: % / %', n1, n2; END IF;
  d := regexp_replace(d, 'ELSE NULL::text\s+END AS assay_status',
    'ELSE (SELECT own.reading ->> ''status'' FROM job_assay_readings own WHERE own.jobname = j.jobname '
    || 'AND own.assayed_at > statement_timestamp() - own.fresh_for) END AS assay_status');
  d := regexp_replace(d, 'ELSE NULL::jsonb\s+END AS assay,',
    'ELSE (SELECT own.reading FROM job_assay_readings own WHERE own.jobname = j.jobname '
    || 'AND own.assayed_at > statement_timestamp() - own.fresh_for) END AS assay,');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS ' || d;
END
$view$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bat-settlement-rearm') THEN
    PERFORM cron.schedule('bat-settlement-rearm', '* * * * *',
      $cmd$SET statement_timeout = '30s'; SELECT public.bat_settlement_rearm();$cmd$);
  END IF;
END $$;
