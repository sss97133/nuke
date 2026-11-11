-- Photo reading flow assay, second version: the alarm counts only accepted readings, sees a reader that reads nothing,
-- and watches the stage queue.
--
-- Read from production 2026-11-10 17:23-17:35 UTC:
--   * The subscription readers' heartbeats land since 20261113100000 shipped (16:36 on). Both report frames > 0,
--     read 0 on every fire (frame reader: frames 20, errors 20, accepted 0). The frame reader's worklist had no memory
--     and no privacy hold: the newest 20 of the owner's 325 failed/pending rows are all held photos whose storage URL
--     answers HTTP 400, so each fire took the same 20. subscription-reader-watch stayed green: a row arrived.
-- Review findings on 20261113100000 (three, all reproduced on PostgreSQL 16 before this change):
--   1. The stall rule judged eligibility after capping the sample at the oldest 20,000 pending rows, so parked,
--      duplicate or terminal rows at the old end could fill the sample and hide newer actionable photos. Waiting
--      photos are now selected with the claim's eligibility before the cap.
--   2. The yield refresh found users from photo_land_progress and uploads in the last two days. A completion whose
--      landing failed, on a photo uploaded earlier, was measured by neither. When anything was read in the window, every
--      user with photos is now refreshed.
--   3. A paid call answering HTTP 200 counted as a reading landed, but the status is logged before the answer is
--      validated. Only accepted readings count now: a first reading's row, accepted frames in the frame reader's
--      heartbeat, or a succeeded stage receipt. Provider 200s stay in the reading as telemetry.
-- New rules:
--   * a reader that has taken photos and read none for over 2 h (reader-heartbeat.mjs carries zero_read_since and
--     zero_read_fires across fires; at least 3 fires), with its failures by type in the message;
--   * once the stage ledger (20261113110000) is switched on: work due in the classifier queue for over 6 h with no
--     receipt written in 6 h, or a reconciler that has not run for an hour.
-- Both functions are redefined in full; the crons and grants of 20261113100000 are unchanged.
-- Nothing here reads an image, calls a model or writes a testimony table.
-- Revert: supabase/sql/revert_20261113120000_photo_reading_flow_assay_v2.sql (restores the bodies of 20261113100000).
-- Contract: supabase/sql/test_photo_reading_flow_assay.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.assay_photo_reading_flow(p_raise boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c_queue_wait  constant interval := interval '6 hours';
  c_pending_cap constant integer  := 20000;
  c_reader_dry  constant interval := interval '2 hours';   -- a reader that takes photos and reads none for this long
  c_reader_fresh constant interval := interval '40 minutes';  -- the heartbeat watch's own freshness window
  -- a refusal by the provider (no credit, no quota, no key), as photo_pipeline_note_failure classes it
  c_refusals    constant text[]   := ARRAY['classifier_rate_limited', 'provider_cooldown', 'classifier_usage_budget_exceeded', 'classifier_key_missing'];
  v_cfg jsonb; v_cut timestamptz := '-infinity';
  v_total bigint; v_by_version jsonb; v_last_read timestamptz; v_desc_6h bigint; v_desc_24h bigint; v_by_producer jsonb;
  v_deep_total bigint; v_deep_72h bigint; v_deep_last timestamptz; v_placed_by_producer jsonb;
  v_pending bigint; v_claimable bigint; v_backoff bigint; v_parked bigint; v_waiting bigint; v_oldest_waiting timestamptz;
  v_terminal bigint; v_given_up bigint; v_terminal_by_class jsonb;
  v_provider jsonb; v_last_provider_ok timestamptz; v_calls_24h bigint; v_ok_24h bigint; v_ok_6h bigint;
  v_readers jsonb; v_reader_accepted_6h bigint; v_live_6h boolean; v_reasons text[] := '{}'; v_out jsonb;
  v_dry record; v_scfg jsonb; v_stage jsonb := NULL; v_stage_on boolean := false; v_stage_due bigint := 0; v_stage_oldest_due timestamptz;
  v_stage_claimed bigint := 0; v_stage_receipts_6h bigint := 0; v_stage_ok_6h bigint := 0; v_stage_last_receipt timestamptz; v_stage_last_run timestamptz;
BEGIN
  IF coalesce(auth.role(), 'postgres') NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'assay_photo_reading_flow: service admission required' USING ERRCODE = '42501';
  END IF;

  -- Population: every vehicle_images row with a user_id, from the signed counters (no vehicle_images scan).
  SELECT coalesce(sum(n_all), 0) INTO v_total FROM user_image_counts;

  -- Classifier level. The landing fold writes one classifier_v2 image_descriptions row per image, on its first
  -- reading only, stamped with the prompt version that read it. So these rows count first readings: an image first
  -- read under an older version keeps that stamp when re-read, and a re-read adds no row. Coverage by version is a
  -- diagnostic; the alarm below does not depend on a version.
  SELECT coalesce(jsonb_object_agg(ver, n), '{}'::jsonb) INTO v_by_version
    FROM (SELECT coalesce(source_version, 'unknown') AS ver, count(DISTINCT image_id) AS n
            FROM image_descriptions WHERE description_type = 'classifier_v2' GROUP BY 1) t;
  SELECT max(created_at),
         count(*) FILTER (WHERE created_at > now() - c_queue_wait),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours')
    INTO v_last_read, v_desc_6h, v_desc_24h
    FROM image_descriptions
   WHERE description_type = 'classifier_v2';
  SELECT coalesce(jsonb_object_agg(producer, n), '{}'::jsonb) INTO v_by_producer
    FROM (SELECT coalesce(evidence ->> 'model', 'unknown') AS producer, count(*) AS n
            FROM image_descriptions
           WHERE description_type = 'classifier_v2' AND created_at > now() - interval '72 hours'
           GROUP BY 1) p;

  -- Deep level, reported only: images carrying a deep verdict, and every producer that placed an image_observations
  -- row in 72 h (caller-byok is the reviewed deep reading). A deep reading says nothing about the classifier queue.
  SELECT count(*) INTO v_deep_total FROM user_image_deep_reads;
  SELECT coalesce(jsonb_object_agg(o.observed_by, o.n), '{}'::jsonb),
         coalesce(sum(o.n) FILTER (WHERE o.observed_by = 'caller-byok'), 0),
         max(o.last_at) FILTER (WHERE o.observed_by = 'caller-byok')
    INTO v_placed_by_producer, v_deep_72h, v_deep_last
    FROM (SELECT coalesce(observed_by, 'unknown') AS observed_by, count(*) AS n, max(observed_at) AS last_at
            FROM image_observations
           WHERE observed_at > now() - interval '72 hours'
           GROUP BY 1) o;

  -- Queue: user-owned pending photos (partial index idx_vehicle_images_pending_user), judged as
  -- claim_photo_pipeline_batch judges them, oldest first so a capped sample keeps the longest-waiting rows.
  --   claimable  the next drain tick would take it
  --   backoff    it has a retry row that is not terminal and not yet due
  --   parked     older than the claim's cut while platform_config photo_pipeline_backlog.enabled is false
  --   waiting    claimable or in backoff, and created more than 6 h ago
  SELECT config_value INTO v_cfg FROM platform_config WHERE config_key = 'photo_pipeline_backlog';
  IF v_cfg IS NOT NULL AND coalesce((v_cfg ->> 'enabled')::boolean, true) = false THEN
    v_cut := now() - make_interval(days => coalesce((v_cfg ->> 'recent_days')::int, 14));
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE q.live AND q.due),
         count(*) FILTER (WHERE q.live AND NOT q.due),
         count(*) FILTER (WHERE q.parked)
    INTO v_pending, v_claimable, v_backoff, v_parked
    FROM (SELECT v.created_at,
                 (v.is_duplicate = false AND v.image_url IS NOT NULL AND v.created_at >= v_cut AND r.terminal IS NOT TRUE
                  AND (r.image_id IS NULL OR r.next_attempt_at IS NOT NULL)) AS live,
                 (r.image_id IS NULL OR r.next_attempt_at <= now()) AS due,
                 (v.is_duplicate = false AND v.image_url IS NOT NULL AND v.created_at < v_cut AND r.terminal IS NOT TRUE) AS parked
            FROM vehicle_images v
            LEFT JOIN photo_pipeline_retry_state r ON r.image_id = v.id
           WHERE v.ai_processing_status = 'pending' AND v.user_id IS NOT NULL
           ORDER BY v.created_at ASC
           LIMIT c_pending_cap) q;
  -- Waiting: judged before the cap, so parked, duplicate or terminal rows at the old end of the queue cannot fill the
  -- sample and hide newer photos that are actionable and have waited.
  SELECT count(*), min(w.created_at)
    INTO v_waiting, v_oldest_waiting
    FROM (SELECT v.created_at
            FROM vehicle_images v
            LEFT JOIN photo_pipeline_retry_state r ON r.image_id = v.id
           WHERE v.ai_processing_status = 'pending' AND v.user_id IS NOT NULL
             AND v.is_duplicate = false AND v.image_url IS NOT NULL
             AND v.created_at >= v_cut AND v.created_at < now() - c_queue_wait
             AND r.terminal IS NOT TRUE AND (r.image_id IS NULL OR r.next_attempt_at IS NOT NULL)
           ORDER BY v.created_at ASC
           LIMIT c_pending_cap) w;

  -- Given up: photos whose retries ran out. A provider refusal is not a fault of the photo, so those need reopening.
  SELECT count(*),
         count(*) FILTER (WHERE last_error_class = ANY (c_refusals)
                                OR (last_http_status IN (401, 402, 403, 429) AND last_error_class LIKE 'classifier%')
                                OR rate_limited_attempts >= 12)
    INTO v_terminal, v_given_up
    FROM photo_pipeline_retry_state WHERE terminal;
  SELECT coalesce(jsonb_object_agg(cls, n), '{}'::jsonb) INTO v_terminal_by_class
    FROM (SELECT coalesce(last_error_class, 'unknown') || coalesce(' ' || last_http_status::text, '') AS cls, count(*) AS n
            FROM photo_pipeline_retry_state WHERE terminal GROUP BY 1) c;

  -- Provider: the breaker row and what the spend log says the paid classifier last did. Both writers put the HTTP
  -- status in task; google_block rows repeat a google row and are not calls.
  SELECT to_jsonb(s) INTO v_provider FROM photo_pipeline_provider_state s WHERE s.provider = 'classifier';
  SELECT max(created_at) FILTER (WHERE task = '200'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND provider <> 'google_block'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND task = '200'),
         count(*) FILTER (WHERE created_at > now() - c_queue_wait AND task = '200')
    INTO v_last_provider_ok, v_calls_24h, v_ok_24h, v_ok_6h
    FROM llm_cost_tracking
   WHERE caller = 'photo-pipeline-orchestrator';

  -- Readers: the subscription readers' last heartbeat (record_reader_heartbeat), and what the frame reader accepted
  -- if that heartbeat is inside the window.
  SELECT coalesce(jsonb_object_agg(a.jobname, jsonb_build_object('heartbeat_at', a.assayed_at, 'reading', a.reading)), '{}'::jsonb),
         coalesce(max(CASE WHEN a.jobname = 'subscription-frame-classifier' AND a.assayed_at > now() - c_queue_wait
                            AND jsonb_typeof(a.reading -> 'accepted') = 'number' THEN (a.reading ->> 'accepted')::numeric END), 0)::bigint
    INTO v_readers, v_reader_accepted_6h
    FROM job_assay_readings a
   WHERE a.jobname IN ('subscription-frame-classifier', 'subscription-document-reader');

  -- Stage ledger (migration 20261113110000), when it is deployed: the classifier stage's queue and receipts.
  IF to_regclass('public.image_stage_work') IS NOT NULL AND to_regclass('public.image_stage_receipts') IS NOT NULL THEN
    SELECT config_value INTO v_scfg FROM platform_config WHERE config_key = 'image_stage_reconciler';
    v_stage_on := coalesce((v_scfg ->> 'enabled')::boolean, false);
    SELECT count(*) FILTER (WHERE status = 'queued' AND not_before <= now()),
           min(created_at) FILTER (WHERE status = 'queued' AND not_before <= now()),
           count(*) FILTER (WHERE status = 'claimed')
      INTO v_stage_due, v_stage_oldest_due, v_stage_claimed
      FROM image_stage_work WHERE stage = 'classifier' AND status IN ('queued', 'claimed');
    SELECT count(*) FILTER (WHERE observed_at > now() - c_queue_wait),
           count(*) FILTER (WHERE observed_at > now() - c_queue_wait AND outcome = 'succeeded'),
           max(observed_at)
      INTO v_stage_receipts_6h, v_stage_ok_6h, v_stage_last_receipt
      FROM image_stage_receipts WHERE stage = 'classifier' AND observed_at > now() - interval '7 days';
    SELECT max(last_run_at) INTO v_stage_last_run FROM image_stage_reconciler_state;
    v_stage := jsonb_build_object('enabled', v_stage_on, 'user_ids', v_scfg -> 'user_ids', 'due_now', v_stage_due,
      'oldest_due_queued_at', v_stage_oldest_due, 'claimed', v_stage_claimed, 'receipts_6h', v_stage_receipts_6h,
      'succeeded_6h', v_stage_ok_6h, 'last_receipt_at', v_stage_last_receipt, 'reconciler_last_run_at', v_stage_last_run);
  END IF;

  -- A classifier reading landed in the window if a record of an accepted reading says so: a first reading's
  -- description row, the frame reader reporting accepted frames, or a succeeded stage receipt. A paid call answering
  -- HTTP 200 is not one: the status is logged before the answer is parsed and validated, so 200s with unusable output
  -- would keep a stalled queue looking healthy. It stays in the reading as provider telemetry.
  v_live_6h := v_desc_6h > 0 OR v_reader_accepted_6h > 0 OR v_stage_ok_6h > 0;

  IF v_waiting > 0 AND NOT v_live_6h THEN
    v_reasons := v_reasons || format('%s pending photos have waited over 6 h (oldest since %s; %s claimable now, %s backing off) and no classifier reading landed in 6 h',
                                     v_waiting, to_char(v_oldest_waiting, 'YYYY-MM-DD HH24:MI'), v_claimable, v_backoff);
  END IF;
  IF v_given_up > 0 THEN
    v_reasons := v_reasons || format('%s photos were given up on after the provider refused them (no credit, quota or key); they are not retried until reopened',
                                     v_given_up);
  END IF;
  -- A reader that reports in but reads nothing. reader-heartbeat.mjs carries zero_read_since / zero_read_fires across
  -- fires in which the reader took photos and read none; the heartbeat watch only checks that a row arrived.
  FOR v_dry IN
    SELECT a.jobname, a.reading ->> 'zero_read_since' AS since, a.reading ->> 'zero_read_fires' AS fires,
           coalesce(a.reading -> 'error_classes', '{}'::jsonb) AS classes
      FROM job_assay_readings a
     WHERE a.jobname IN ('subscription-frame-classifier', 'subscription-document-reader')
       AND a.assayed_at > now() - c_reader_fresh
       AND jsonb_typeof(a.reading -> 'frames') = 'number' AND (a.reading ->> 'frames')::numeric > 0
       AND jsonb_typeof(a.reading -> 'read') = 'number' AND (a.reading ->> 'read')::numeric = 0
       AND jsonb_typeof(a.reading -> 'zero_read_fires') = 'number' AND (a.reading ->> 'zero_read_fires')::numeric >= 3
       AND (a.reading ->> 'zero_read_since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     ORDER BY a.jobname
  LOOP
    IF v_dry.since::timestamptz < now() - c_reader_dry THEN
      v_reasons := v_reasons || format('%s has taken photos and read none since %s (%s runs); failures by type: %s',
                                       v_dry.jobname, to_char(v_dry.since::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), v_dry.fires,
                                       left(v_dry.classes::text, 300));
    END IF;
  END LOOP;
  -- The stage queue, once switched on: work is due and nobody has written a receipt, or the reconciler stopped running.
  IF v_stage_on AND v_stage_due > 0 AND v_stage_oldest_due < now() - c_queue_wait AND v_stage_receipts_6h = 0 THEN
    v_reasons := v_reasons || format('%s photos are due in the classifier stage queue (oldest queued %s) and no receipt was written in 6 h',
                                     v_stage_due, to_char(v_stage_oldest_due AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'));
  END IF;
  IF v_stage_on AND (v_stage_last_run IS NULL OR v_stage_last_run < now() - interval '1 hour') THEN
    v_reasons := v_reasons || format('the stage reconciler is switched on but last ran %s',
                                     coalesce(to_char(v_stage_last_run AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), 'never'));
  END IF;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v2',
    'population', 'vehicle_images rows with a user_id, every status (user_image_counts.n_all); listing photos are outside this assay',
    'classifier', jsonb_build_object(
      'image_rows_total', v_total,
      'images_first_read_by_prompt_version', v_by_version,
      'note', 'first readings only: a re-read adds no row and keeps the first version; the total includes duplicates, skipped and non-vehicle rows that are never read',
      'last_first_reading_at', v_last_read,
      'first_readings_6h', v_desc_6h, 'first_readings_24h', v_desc_24h,
      'first_readings_72h_by_producer', v_by_producer,
      'reading_landed_6h', v_live_6h),
    'deep', jsonb_build_object(
      'images_with_verdict', v_deep_total,
      'reviewed_readings_72h', v_deep_72h,
      'last_reviewed_reading_at', v_deep_last,
      'image_observations_72h_by_producer', v_placed_by_producer),
    'queue', jsonb_build_object(
      'pending_user_photos', v_pending,
      'sample_capped_at', c_pending_cap,
      'claimable_now', v_claimable,
      'backing_off', v_backoff,
      'parked_by_backlog_switch', v_parked,
      'waiting_over_6h', v_waiting,
      'oldest_waiting_since', v_oldest_waiting,
      'terminal_retry_rows', v_terminal,
      'terminal_by_error', v_terminal_by_class,
      'given_up_after_provider_refusal', v_given_up),
    'provider', jsonb_build_object(
      'breaker', v_provider,
      'last_success_at', v_last_provider_ok,
      'calls_24h', v_calls_24h,
      'successes_24h', v_ok_24h,
      'successes_6h', v_ok_6h,
      'note', 'HTTP 200 is logged before the answer is validated; it is telemetry, not a reading'),
    'readers', v_readers,
    'stage_queue', v_stage);

  IF p_raise AND cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'photo reading stalled: %', array_to_string(v_reasons, '; ');
  END IF;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.assay_photo_reading_flow(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_photo_reading_flow(boolean) TO service_role;
COMMENT ON FUNCTION public.assay_photo_reading_flow(boolean) IS
  'Reading of whether user-owned photos are being read: first readings by prompt version against all user-owned image rows, readings landed by producer, deep verdict count, the pending queue as the claim sees it (claimable, backing off, parked, waiting over 6 h), terminal retry rows by error, the paid provider''s calls (telemetry), the subscription readers'' heartbeats and the classifier stage queue. Raises (p_raise) when: pending photos have waited over 6 h with no accepted classifier reading in 6 h; photos were given up on after a provider refusal; a reader has taken photos and read none for over 2 h; the stage queue has work due for over 6 h and no receipt in 6 h; or the stage reconciler is on and has not run for an hour. Cron photo-reading-flow-watch. Service role only. Migrations 20261113100000, 20261113120000.';

-- The yield refresh: users to measure.
CREATE OR REPLACE FUNCTION public.photo_analysis_yield_daily_refresh(p_hours integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare u record; n int := 0; v_since timestamptz := now() - make_interval(hours => p_hours); v_read boolean;
begin
  -- Did any reader produce an accepted or answered reading in the window? If so every user with photos is measured,
  -- whatever the age of their uploads: a completion whose landing failed leaves no photo_land_progress row, and the
  -- only cheap record that it happened is that something was read. Idle hours stay cheap.
  v_read := exists (select 1 from public.llm_cost_tracking l where l.caller = 'photo-pipeline-orchestrator' and l.task = '200' and l.created_at >= v_since)
         or exists (select 1 from public.job_assay_readings a where a.jobname = 'subscription-frame-classifier' and a.assayed_at >= v_since
                     and jsonb_typeof(a.reading -> 'accepted') = 'number' and (a.reading ->> 'accepted')::numeric > 0);
  if not v_read and to_regclass('public.image_stage_receipts') is not null then
    v_read := exists (select 1 from public.image_stage_receipts r where r.observed_at >= v_since and r.outcome = 'succeeded');
  end if;
  for u in
    -- users with a photo landed in the window; users who uploaded in the last two days; and, when something was read in
    -- the window, every user with photos (a handful of rows in user_image_counts, never a scan of vehicle_images)
    select vi.user_id
      from public.photo_land_progress p
      join public.vehicle_images vi on vi.id = p.image_id
     where p.landed_at >= v_since
       and vi.user_id is not null
    union
    select c.user_id
      from public.user_image_counts c
     where c.created_day >= (now() at time zone 'utc')::date - 1
     group by c.user_id
    having sum(c.n_all) > 0
    union
    select c.user_id
      from public.user_image_counts c
     where v_read
     group by c.user_id
    having sum(c.n_all) > 0
  loop
    n := n + public.photo_analysis_yield_snapshot_run(u.user_id, v_since, now());
    insert into public.photo_analysis_yield_daily (user_id, day, photos, filed_photos, filed_pct, median_rows_beyond_status, pct_zero_beyond_status, pct_zero_analysis, rows_total, rows_analysis, mean_tables_touched, mean_coverage, mean_extraction, landing_rate, cited_evidence, mean_confidence, mismatch_rows, make_agree_pct)
    select u.user_id, b.day, b.photos, b.filed_photos, b.filed_pct, b.median_rows_beyond_status, b.pct_zero_beyond_status, b.pct_zero_analysis, b.rows_total, b.rows_analysis, b.mean_tables_touched, b.mean_coverage, b.mean_extraction, b.landing_rate, b.cited_evidence, b.mean_confidence, b.mismatch_rows, b.make_agree_pct
    from public.photo_analysis_yield_by_day(u.user_id, now() - interval '3 days', now() + interval '1 hour') b
    on conflict (user_id, day) do update set photos=excluded.photos, filed_photos=excluded.filed_photos, filed_pct=excluded.filed_pct, median_rows_beyond_status=excluded.median_rows_beyond_status, pct_zero_beyond_status=excluded.pct_zero_beyond_status, pct_zero_analysis=excluded.pct_zero_analysis, rows_total=excluded.rows_total, rows_analysis=excluded.rows_analysis, mean_tables_touched=excluded.mean_tables_touched, mean_coverage=excluded.mean_coverage, mean_extraction=excluded.mean_extraction, landing_rate=excluded.landing_rate, cited_evidence=excluded.cited_evidence, mean_confidence=excluded.mean_confidence, mismatch_rows=excluded.mismatch_rows, make_agree_pct=excluded.make_agree_pct, computed_at=now();
  end loop;
  return n;
end $function$;
ALTER FUNCTION public.photo_analysis_yield_daily_refresh(integer) RESET statement_timeout;
COMMENT ON FUNCTION public.photo_analysis_yield_daily_refresh(integer) IS
  'Hourly yield refresh (cron photo-analysis-yield-hourly): re-snapshots the last p_hours and upserts three days of photo_analysis_yield_daily for each user with a photo landed in the window (photo_land_progress), each user who uploaded in the last two days (user_image_counts) and, when any reader produced a reading in the window (a provider 200, accepted frames in the frame reader''s heartbeat, a succeeded stage receipt), every user with photos, so a completion whose landing failed is measured as zero yield whatever the age of the upload. Users never come from a scan of vehicle_images. Migrations 20261113100000, 20261113120000.';

DO $chk$
BEGIN
  IF has_function_privilege('anon', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assay_photo_reading_flow must be service_role only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.photo_analysis_yield_daily_refresh(integer)')
                AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'statement_timeout=%')) THEN
    RAISE EXCEPTION 'photo_analysis_yield_daily_refresh carries a function-level statement_timeout';
  END IF;
END $chk$;
COMMIT;
