-- Photo reading flow: an assay that fails when photos wait and nothing reads them, and the yield refresh brought
-- inside its statement budget.
--
-- Read from production 2026-11-10 15:10-15:19 UTC (owner library, user-owned vehicle_images only):
--   * Every logged Gemini call by photo-pipeline-orchestrator answered HTTP 402 from 2026-10-15 on; OpenAI answered
--     only 429 after 2026-11-04 (last success that day); llm_cost_tracking has no orchestrator row after 2026-11-07.
--   * Crons photo-pipeline-drain and photo-pipeline-drain-b both "succeeded" 298 times in 6 h while the function
--     answered {"message":"No pending images","processed":0}: a pg_net post succeeds whatever the function returns.
--   * Cron photo-analysis-yield-hourly failed every run since 2026-11-03 (statement timeout at 10 s inside
--     photo_analysis_yield_daily_refresh); photo_analysis_yield_daily has 0 rows.
--   * image_descriptions held 10,777 classifier_v2 rows at prompt version v98 against 31k+ user-owned image rows; the
--     last one was written 2026-11-09.
-- So a stopped pipeline and an idle one look the same, and the instrument that would show the difference is itself
-- stopped. Two pieces:
--  1. assay_photo_reading_flow(p_raise): reads small tables only (user_image_counts, image_descriptions,
--     user_image_deep_reads, image_observations, the pending-user partial index, photo_pipeline_retry_state,
--     photo_pipeline_provider_state, llm_cost_tracking, job_assay_readings, platform_config) and returns one reading.
--     It raises on two states that reading the photos clears:
--     (a) pending photos, claimable or backing off, have waited over 6 h and no classifier reading landed in 6 h
--         (a first reading's description row, a paid call answering 200, or the frame reader reporting accepted frames);
--     (b) photos were given up on (terminal retry rows) after the provider refused them: no credit, quota or key.
--     It does NOT raise on photos that are 'completed' without a current reading (about 21,000 on 2026-11-10): the
--     status column cannot say which those are, and no queue holds them, so an alarm on that number could never be
--     cleared. The reading reports first readings by prompt version so the gap stays visible; closing it needs a
--     per-image record of which level was read under which contract.
--     Cron photo-reading-flow-watch (hourly) calls it, so v_job_health shows the job failed and pipeline_heartbeat
--     raises its alarm. assay_photo_reading_flow(false) returns the same reading without raising.
--  2. photo_analysis_yield_daily_refresh: the loop found its users with an unindexed scan of vehicle_images
--     (ai_processing_status = 'completed' AND ai_processing_completed_at >= ...); it now finds them from
--     photo_land_progress (one row per landed image, 27k rows) and from user_image_counts (users who uploaded in the
--     last two days), so a completion whose landing failed is still measured.
--     The function-level statement_timeout is dropped: a setting applied inside a running statement does not extend
--     that statement, which is why the cron died at the role default. The cron command carries the leading SET that
--     sibling crons use. The function was applied to production without a migration; this is its first repo copy.
-- Nothing here reads an image, calls a model or writes a testimony table.
-- Revert: supabase/sql/revert_20261113100000_photo_reading_flow_assay.sql.
-- Contract: supabase/sql/test_photo_reading_flow_assay.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
  -- a refusal by the provider (no credit, no quota, no key), as photo_pipeline_note_failure classes it
  c_refusals    constant text[]   := ARRAY['classifier_rate_limited', 'provider_cooldown', 'classifier_usage_budget_exceeded', 'classifier_key_missing'];
  v_cfg jsonb; v_cut timestamptz := '-infinity';
  v_total bigint; v_by_version jsonb; v_last_read timestamptz; v_desc_6h bigint; v_desc_24h bigint; v_by_producer jsonb;
  v_deep_total bigint; v_deep_72h bigint; v_deep_last timestamptz; v_placed_by_producer jsonb;
  v_pending bigint; v_claimable bigint; v_backoff bigint; v_parked bigint; v_waiting bigint; v_oldest_waiting timestamptz;
  v_terminal bigint; v_given_up bigint; v_terminal_by_class jsonb;
  v_provider jsonb; v_last_provider_ok timestamptz; v_calls_24h bigint; v_ok_24h bigint; v_ok_6h bigint;
  v_readers jsonb; v_reader_accepted_6h bigint; v_live_6h boolean; v_reasons text[] := '{}'; v_out jsonb;
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
         count(*) FILTER (WHERE q.parked),
         count(*) FILTER (WHERE q.live AND q.created_at < now() - c_queue_wait),
         min(q.created_at) FILTER (WHERE q.live AND q.created_at < now() - c_queue_wait)
    INTO v_pending, v_claimable, v_backoff, v_parked, v_waiting, v_oldest_waiting
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

  -- A classifier reading landed in the window if any of three independent records says so: a first reading's
  -- description row, a paid call that answered 200 (covers re-reads), or the frame reader reporting accepted frames.
  v_live_6h := v_desc_6h > 0 OR v_ok_6h > 0 OR v_reader_accepted_6h > 0;

  IF v_waiting > 0 AND NOT v_live_6h THEN
    v_reasons := v_reasons || format('%s pending photos have waited over 6 h (oldest since %s; %s claimable now, %s backing off) and no classifier reading landed in 6 h',
                                     v_waiting, to_char(v_oldest_waiting, 'YYYY-MM-DD HH24:MI'), v_claimable, v_backoff);
  END IF;
  IF v_given_up > 0 THEN
    v_reasons := v_reasons || format('%s photos were given up on after the provider refused them (no credit, quota or key); they are not retried until reopened',
                                     v_given_up);
  END IF;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v1',
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
      'successes_6h', v_ok_6h),
    'readers', v_readers);

  IF p_raise AND cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'photo reading stalled: %', array_to_string(v_reasons, '; ');
  END IF;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.assay_photo_reading_flow(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_photo_reading_flow(boolean) TO service_role;
COMMENT ON FUNCTION public.assay_photo_reading_flow(boolean) IS
  'Reading of whether user-owned photos are being read: first readings by prompt version against all user-owned image rows, readings landed by producer, deep verdict count, the pending queue as the claim sees it (claimable, backing off, parked, waiting over 6 h), terminal retry rows by error, the paid provider''s last success and the subscription readers'' heartbeats. Raises (p_raise) when pending photos have waited over 6 h with no classifier reading landed in 6 h, or when photos were given up on after a provider refusal. Cron photo-reading-flow-watch. Service role only. Migration 20261113100000.';

-- The yield refresh, as live on 2026-11-10 except for the user loop's source and the dropped function-level timeout.
CREATE OR REPLACE FUNCTION public.photo_analysis_yield_daily_refresh(p_hours integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare u record; n int := 0;
begin
  for u in
    -- users with a photo landed in the window, and users who uploaded in the last two days (so a completion whose
    -- landing failed, which leaves no photo_land_progress row, is still measured as zero yield rather than missed)
    select vi.user_id
      from public.photo_land_progress p
      join public.vehicle_images vi on vi.id = p.image_id
     where p.landed_at >= now() - make_interval(hours => p_hours)
       and vi.user_id is not null
    union
    select c.user_id
      from public.user_image_counts c
     where c.created_day >= (now() at time zone 'utc')::date - 1
     group by c.user_id
    having sum(c.n_all) > 0
  loop
    n := n + public.photo_analysis_yield_snapshot_run(u.user_id, now() - make_interval(hours => p_hours), now());
    insert into public.photo_analysis_yield_daily (user_id, day, photos, filed_photos, filed_pct, median_rows_beyond_status, pct_zero_beyond_status, pct_zero_analysis, rows_total, rows_analysis, mean_tables_touched, mean_coverage, mean_extraction, landing_rate, cited_evidence, mean_confidence, mismatch_rows, make_agree_pct)
    select u.user_id, b.day, b.photos, b.filed_photos, b.filed_pct, b.median_rows_beyond_status, b.pct_zero_beyond_status, b.pct_zero_analysis, b.rows_total, b.rows_analysis, b.mean_tables_touched, b.mean_coverage, b.mean_extraction, b.landing_rate, b.cited_evidence, b.mean_confidence, b.mismatch_rows, b.make_agree_pct
    from public.photo_analysis_yield_by_day(u.user_id, now() - interval '3 days', now() + interval '1 hour') b
    on conflict (user_id, day) do update set photos=excluded.photos, filed_photos=excluded.filed_photos, filed_pct=excluded.filed_pct, median_rows_beyond_status=excluded.median_rows_beyond_status, pct_zero_beyond_status=excluded.pct_zero_beyond_status, pct_zero_analysis=excluded.pct_zero_analysis, rows_total=excluded.rows_total, rows_analysis=excluded.rows_analysis, mean_tables_touched=excluded.mean_tables_touched, mean_coverage=excluded.mean_coverage, mean_extraction=excluded.mean_extraction, landing_rate=excluded.landing_rate, cited_evidence=excluded.cited_evidence, mean_confidence=excluded.mean_confidence, mismatch_rows=excluded.mismatch_rows, make_agree_pct=excluded.make_agree_pct, computed_at=now();
  end loop;
  return n;
end $function$;
ALTER FUNCTION public.photo_analysis_yield_daily_refresh(integer) RESET statement_timeout;
COMMENT ON FUNCTION public.photo_analysis_yield_daily_refresh(integer) IS
  'Hourly yield refresh (cron photo-analysis-yield-hourly): for each user with a photo landed in the last p_hours (photo_land_progress) or uploaded in the last two days (user_image_counts), re-snapshots that window and upserts three days of photo_analysis_yield_daily. Users never come from a scan of vehicle_images. Migration 20261113100000.';

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('photo-reading-flow-watch', 'photo-analysis-yield-hourly') LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
  PERFORM cron.schedule('photo-reading-flow-watch', '37 * * * *',
    $cmd$SET statement_timeout = '20s'; SELECT public.assay_photo_reading_flow();$cmd$);
  PERFORM cron.schedule('photo-analysis-yield-hourly', '17 * * * *',
    $cmd$SET statement_timeout = '55s'; SELECT public.photo_analysis_yield_daily_refresh(2);$cmd$);
END $$;

DO $chk$
BEGIN
  IF to_regprocedure('public.assay_photo_reading_flow(boolean)') IS NULL THEN RAISE EXCEPTION 'assay_photo_reading_flow missing'; END IF;
  IF has_function_privilege('anon', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assay_photo_reading_flow must be service_role only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.photo_analysis_yield_daily_refresh(integer)')
                AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'statement_timeout=%')) THEN
    RAISE EXCEPTION 'photo_analysis_yield_daily_refresh still carries a function-level statement_timeout';
  END IF;
END $chk$;
