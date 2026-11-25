-- Revert of 20261126054500_photo_flow_assay_capture_coverage.sql: assay_photo_reading_flow back to 20261125070000's
-- body (md5 9451a1281ddaa876dc0ba980aeeaba6d), with no capture_sets section.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.assay_photo_reading_flow(p_raise boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_scope_on boolean := false; v_rs record; v_stages jsonb := '{}'::jsonb; v_rs_reasons text[] := '{}';
  v_rs_due bigint; v_rs_oldest timestamptz; v_rs_claimed bigint; v_rs_receipts_6h bigint; v_rs_closed_6h bigint; v_rs_last timestamptz;
  v_rs_carried bigint; v_rs_skipped_6h bigint; v_rs_live_used integer;
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
    -- The two reading stages (20261120130000): what is due, what was written, and whether the chain to keyed data moves.
    -- Work that has been due for longer than the queue wait with no succeeded or closed receipt in the same window is a
    -- stall named by its stage; a receipt that only says the reader failed does not count as the stage moving.
    -- (only while the reading scope is on: with it off, work left in the queue is waiting to be dropped, not stalled)
    SELECT coalesce(config_value -> 'enabled' = 'true'::jsonb, false) INTO v_scope_on FROM platform_config WHERE config_key = 'image_stage_deep_reading';
    v_scope_on := coalesce(v_scope_on, false);
    FOR v_rs IN SELECT s.stage, s.live_daily_cap FROM image_pipeline_stages s WHERE s.applies_when IN ('filed_for_reading', 'deep_reading_landed') ORDER BY s.stage LOOP
      SELECT count(*) FILTER (WHERE status = 'queued' AND not_before <= now()),
             min(created_at) FILTER (WHERE status = 'queued' AND not_before <= now()),
             count(*) FILTER (WHERE status = 'claimed'),
             count(*) FILTER (WHERE status = 'queued' AND lane = 'live' AND not_before >= image_stage_next_day_start())
        INTO v_rs_due, v_rs_oldest, v_rs_claimed, v_rs_carried
        FROM image_stage_work WHERE stage = v_rs.stage AND status IN ('queued', 'claimed');
      -- a skip the reconciler wrote for an ineligible photo (error_class stage_eligibility) is not the stage moving
      SELECT count(*) FILTER (WHERE observed_at > now() - c_queue_wait),
             count(*) FILTER (WHERE observed_at > now() - c_queue_wait AND outcome IN ('succeeded', 'policy_skip')
                                    AND error_class IS DISTINCT FROM 'stage_eligibility'),
             count(*) FILTER (WHERE observed_at > now() - c_queue_wait AND outcome = 'policy_skip' AND error_class = 'stage_eligibility'),
             max(observed_at)
        INTO v_rs_receipts_6h, v_rs_closed_6h, v_rs_skipped_6h, v_rs_last
        FROM image_stage_receipts WHERE stage = v_rs.stage AND observed_at > now() - interval '7 days';
      -- the live lane's daily cap (20261125070000): claims used today (America/Los_Angeles) and the live items carried to
      -- the next day because the cap was reached
      v_rs_live_used := image_stage_live_claimed_today(v_rs.stage);
      v_stages := v_stages || jsonb_build_object(v_rs.stage, jsonb_build_object('due_now', v_rs_due, 'oldest_due_queued_at', v_rs_oldest,
        'claimed', v_rs_claimed, 'receipts_6h', v_rs_receipts_6h, 'succeeded_or_closed_6h', v_rs_closed_6h,
        'skipped_ineligible_6h', v_rs_skipped_6h, 'last_receipt_at', v_rs_last,
        'live_daily_cap', v_rs.live_daily_cap, 'live_claimed_today', v_rs_live_used, 'live_carried_to_next_day', v_rs_carried));
      IF v_stage_on AND v_scope_on AND v_rs_due > 0 AND v_rs_oldest < now() - c_queue_wait AND v_rs_closed_6h = 0 THEN
        v_rs_reasons := v_rs_reasons || format('%s_stalled: %s photos are due in the %s stage queue (oldest queued %s) and no receipt succeeded or closed one in 6 h',
                                               v_rs.stage, v_rs_due, v_rs.stage, to_char(v_rs_oldest AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'));
      END IF;
      -- Not a fault of the reader: the owner's daily bound on subscription reads was reached and work waits for tomorrow.
      -- It is raised so that v_job_health (which shows this job's last error) carries it; the room (image_stage_deep_reading
      -- max_open) is held by the carried items, so the stage's backfill waits too.
      IF v_stage_on AND v_scope_on AND v_rs_carried > 0 THEN
        v_rs_reasons := v_rs_reasons || format('%s_live_cap_reached: %s of %s live claims used today (America/Los_Angeles), %s photos carried to %s',
                                               v_rs.stage, v_rs_live_used, v_rs.live_daily_cap, v_rs_carried,
                                               to_char(image_stage_next_day_start() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') || ' PT');
      END IF;
    END LOOP;
    v_stage := v_stage || jsonb_build_object('stages', v_stages);
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
  v_reasons := v_reasons || v_rs_reasons;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v4',
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
END $function$

;

commit;
