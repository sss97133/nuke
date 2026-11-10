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
--     photo_pipeline_provider_state, llm_cost_tracking, job_assay_readings) and returns one reading. It raises when
--     (a) claimable pending photos have waited 6 h with no reading landed in 6 h, or (b) at least 500 user-owned
--     photos have no reading under the current classifier contract and no classifier or deep reading landed in 72 h.
--     Cron photo-reading-flow-watch (hourly) calls it, so v_job_health shows the job failed and pipeline_heartbeat
--     raises its alarm. assay_photo_reading_flow(false) returns the same reading without raising.
--  2. photo_analysis_yield_daily_refresh: the loop found its users with an unindexed scan of vehicle_images
--     (ai_processing_status = 'completed' AND ai_processing_completed_at >= ...); it now finds them from
--     photo_land_progress (one row per landed image, 27k rows), which the landing trigger stamps on every completion.
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
  -- The classifier contract the orchestrator stamps on a reading (classifierProvider.ts prompt_version). A reading
  -- under another version, or none, is not a current reading.
  c_contract    constant text     := 'v98';
  c_min_backlog constant bigint   := 500;
  c_queue_wait  constant interval := interval '6 hours';
  c_silence     constant interval := interval '72 hours';
  c_pending_cap constant integer  := 20000;
  v_total bigint; v_read bigint; v_legacy bigint; v_last_read timestamptz;
  v_read_6h bigint; v_read_24h bigint; v_read_72h bigint; v_by_producer jsonb;
  v_deep_total bigint; v_deep_72h bigint; v_deep_last timestamptz; v_placed_by_producer jsonb;
  v_pending bigint; v_claimable bigint; v_oldest_claimable timestamptz; v_terminal bigint;
  v_provider jsonb; v_last_provider_ok timestamptz; v_calls_24h bigint; v_ok_24h bigint;
  v_readers jsonb; v_unread bigint; v_reasons text[] := '{}'; v_out jsonb;
BEGIN
  IF coalesce(auth.role(), 'postgres') NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'assay_photo_reading_flow: service admission required' USING ERRCODE = '42501';
  END IF;

  -- Population: every vehicle_images row with a user_id, from the signed counters (no vehicle_images scan).
  SELECT coalesce(sum(n_all), 0) INTO v_total FROM user_image_counts;

  -- Classifier level: one image_descriptions row per image on its first reading (the landing fold writes it).
  SELECT count(DISTINCT image_id) FILTER (WHERE source_version = c_contract),
         count(DISTINCT image_id) FILTER (WHERE source_version IS DISTINCT FROM c_contract),
         max(created_at) FILTER (WHERE source_version = c_contract),
         count(*) FILTER (WHERE source_version = c_contract AND created_at > now() - c_queue_wait),
         count(*) FILTER (WHERE source_version = c_contract AND created_at > now() - interval '24 hours'),
         count(*) FILTER (WHERE source_version = c_contract AND created_at > now() - c_silence)
    INTO v_read, v_legacy, v_last_read, v_read_6h, v_read_24h, v_read_72h
    FROM image_descriptions
   WHERE description_type = 'classifier_v2';
  SELECT coalesce(jsonb_object_agg(producer, n), '{}'::jsonb) INTO v_by_producer
    FROM (SELECT coalesce(evidence ->> 'model', 'unknown') AS producer, count(*) AS n
            FROM image_descriptions
           WHERE description_type = 'classifier_v2' AND source_version = c_contract AND created_at > now() - c_silence
           GROUP BY 1) p;

  -- Deep level: images carrying a deep verdict; deep readings admitted through ingest_image_observation (observer
  -- caller-byok); and every producer that placed an image_observations row in the window, for visibility.
  SELECT count(*) INTO v_deep_total FROM user_image_deep_reads;
  SELECT coalesce(jsonb_object_agg(o.observed_by, o.n), '{}'::jsonb),
         coalesce(sum(o.n) FILTER (WHERE o.observed_by = 'caller-byok'), 0),
         max(o.last_at) FILTER (WHERE o.observed_by = 'caller-byok')
    INTO v_placed_by_producer, v_deep_72h, v_deep_last
    FROM (SELECT observed_by, count(*) AS n, max(observed_at) AS last_at
            FROM image_observations
           WHERE observed_at > now() - c_silence
           GROUP BY 1) o;

  -- Queue: user-owned pending photos (the partial index idx_vehicle_images_pending_user), judged as the claim does.
  SELECT count(*),
         count(*) FILTER (WHERE q.claimable),
         min(q.created_at) FILTER (WHERE q.claimable)
    INTO v_pending, v_claimable, v_oldest_claimable
    FROM (SELECT v.created_at,
                 (v.is_duplicate = false AND v.image_url IS NOT NULL
                  AND (r.image_id IS NULL
                       OR (r.terminal IS NOT TRUE AND r.next_attempt_at IS NOT NULL AND r.next_attempt_at <= now()))) AS claimable
            FROM vehicle_images v
            LEFT JOIN photo_pipeline_retry_state r ON r.image_id = v.id
           WHERE v.ai_processing_status = 'pending' AND v.user_id IS NOT NULL
           LIMIT c_pending_cap) q;
  SELECT count(*) INTO v_terminal FROM photo_pipeline_retry_state WHERE terminal;

  -- Provider: the breaker row and what the spend log says the paid classifier last did.
  SELECT to_jsonb(s) INTO v_provider FROM photo_pipeline_provider_state s WHERE s.provider = 'classifier';
  SELECT max(created_at) FILTER (WHERE input_tokens IS NOT NULL),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND provider <> 'google_block'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND input_tokens IS NOT NULL)
    INTO v_last_provider_ok, v_calls_24h, v_ok_24h
    FROM llm_cost_tracking
   WHERE caller = 'photo-pipeline-orchestrator';

  -- Readers: the subscription readers' last heartbeat (record_reader_heartbeat).
  SELECT coalesce(jsonb_object_agg(a.jobname, jsonb_build_object('heartbeat_at', a.assayed_at, 'reading', a.reading)), '{}'::jsonb)
    INTO v_readers
    FROM job_assay_readings a
   WHERE a.jobname IN ('subscription-frame-classifier', 'subscription-document-reader');

  v_unread := greatest(v_total - v_read, 0);

  IF v_claimable > 0 AND v_oldest_claimable < now() - c_queue_wait AND v_read_6h = 0 THEN
    v_reasons := v_reasons || format('%s claimable pending photos, oldest waiting since %s, and no reading landed in %s',
                                     v_claimable, to_char(v_oldest_claimable, 'YYYY-MM-DD HH24:MI'), c_queue_wait);
  END IF;
  IF v_unread >= c_min_backlog AND v_read_72h = 0 AND v_deep_72h = 0 THEN
    v_reasons := v_reasons || format('%s of %s user-owned photos have no reading under contract %s and no classifier or deep reading landed in %s (last classifier reading %s)',
                                     v_unread, v_total, c_contract, c_silence,
                                     coalesce(to_char(v_last_read, 'YYYY-MM-DD HH24:MI'), 'never'));
  END IF;

  v_out := jsonb_build_object(
    'status', CASE WHEN cardinality(v_reasons) = 0 THEN 'passed' ELSE 'failed' END,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now(),
    'method', 'assay_photo_reading_flow v1',
    'population', 'vehicle_images rows with a user_id, every status (user_image_counts.n_all); listing photos are outside this assay',
    'classifier', jsonb_build_object(
      'contract', c_contract,
      'images_total', v_total,
      'images_read_under_contract', v_read,
      'images_without_current_reading', v_unread,
      'images_read_under_other_versions', v_legacy,
      'last_reading_at', v_last_read,
      'readings_6h', v_read_6h, 'readings_24h', v_read_24h, 'readings_72h', v_read_72h,
      'readings_72h_by_producer', v_by_producer),
    'deep', jsonb_build_object(
      'images_with_verdict', v_deep_total,
      'readings_72h', v_deep_72h,
      'last_reading_at', v_deep_last,
      'image_observations_72h_by_producer', v_placed_by_producer),
    'queue', jsonb_build_object(
      'pending_user_photos', v_pending,
      'pending_count_capped_at', c_pending_cap,
      'claimable_now', v_claimable,
      'oldest_claimable_at', v_oldest_claimable,
      'terminal_retry_rows', v_terminal),
    'provider', jsonb_build_object(
      'breaker', v_provider,
      'last_success_at', v_last_provider_ok,
      'calls_24h', v_calls_24h,
      'successes_24h', v_ok_24h),
    'readers', v_readers);

  IF p_raise AND cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'photo reading stalled: %', array_to_string(v_reasons, '; ');
  END IF;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.assay_photo_reading_flow(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_photo_reading_flow(boolean) TO service_role;
COMMENT ON FUNCTION public.assay_photo_reading_flow(boolean) IS
  'Reading of whether user-owned photos are being read: classifier-contract coverage against all user-owned image rows, readings landed in 6/24/72 h by producer, deep verdict count, the pending queue as the claim sees it, the paid provider''s last success and the subscription readers'' heartbeats. Raises (p_raise) when claimable photos wait 6 h with nothing read, or 500+ photos lack a current reading and nothing was read in 72 h. Cron photo-reading-flow-watch. Service role only. Migration 20261113100000.';

-- The yield refresh, as live on 2026-11-10 except for the user loop's source and the dropped function-level timeout.
CREATE OR REPLACE FUNCTION public.photo_analysis_yield_daily_refresh(p_hours integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare u record; n int := 0;
begin
  for u in
    select distinct vi.user_id
      from public.photo_land_progress p
      join public.vehicle_images vi on vi.id = p.image_id
     where p.landed_at >= now() - make_interval(hours => p_hours)
       and vi.user_id is not null
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
  'Hourly yield refresh (cron photo-analysis-yield-hourly): for each user with a photo landed in the last p_hours (photo_land_progress), re-snapshots that window and upserts three days of photo_analysis_yield_daily. Users come from photo_land_progress, never from a scan of vehicle_images. Migration 20261113100000.';

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
