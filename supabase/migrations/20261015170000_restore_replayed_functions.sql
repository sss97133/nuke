-- Restore four SQL functions that the 2026-10-15 06:37Z blank-dispatch replay put back to their June bodies.
--
-- Each CREATE OR REPLACE FUNCTION below is copied verbatim from the newest migration that defined it (named above it);
-- re-running those whole files fails their own guards. ACLs are untouched: CREATE OR REPLACE keeps them, and none of the four
-- source files grants anything on these functions. Job 557 (photo-pipeline-reset-stuck) returns to hourly at minute 17; jobs
-- 556 (photo-pipeline-drain) and 559 (bat-import-queue-worker) stay paused. The block at the end fails the deploy unless
-- the first 16 hex characters of md5(prosrc) of every function are the expected value, taken from the source files and equal to the values the incident
-- check reported (fc1f3a43, eb086ea4, ad1be580, 000db1a7).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- get_pipeline_pulse: from supabase/migrations/20261014040200_pipeline_pulse_remembers_counted_days.sql
CREATE OR REPLACE FUNCTION public.get_pipeline_pulse(p_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
 SET lock_timeout TO '500ms'
AS $function$
DECLARE
  v_as_of timestamptz := statement_timestamp();
  v_deadline timestamptz := clock_timestamp() + interval '6 seconds';
  v_today date := (v_as_of AT TIME ZONE 'UTC')::date;
  v_since timestamptz;
  v_day date;
  v_count bigint;
  v_relation oid;
  v_supported boolean;
  v_reason text;
  v_point_status text;
  v_organ_status text;
  v_series jsonb;
  v_organs jsonb := '{}';
  v_organ_coverage jsonb := '{}';
  v_backlogs jsonb := '{"cap":10001}';
  v_backlog_coverage jsonb := '{}';
  v_degraded jsonb := '[]';
  v_memo jsonb := '{}';
  v_hit jsonb;
  v_served integer := 0;
  v_stored integer := 0;
  v_rows integer;
  r record;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'p_days must be between 1 and 31' USING ERRCODE='22023';
  END IF;
  v_since := (v_today - (p_days - 1))::timestamp AT TIME ZONE 'UTC';

  -- What earlier readings stored and can still be trusted: the cap (true for good), or the exact count of a day that
  -- ended at least an hour before it was counted. Failing to read the memory only means counting live.
  BEGIN
    SELECT coalesce(jsonb_object_agg(m.organ || ':' || m.day::text, m.n), '{}') INTO v_memo
    FROM public.pipeline_pulse_day_counts m
    WHERE m.day >= (v_since AT TIME ZONE 'UTC')::date
      AND m.day <= v_today
      AND (m.n = 10001
           OR (m.day < v_today
               AND m.counted_at >= ((m.day + 1)::timestamp AT TIME ZONE 'UTC') + interval '1 hour'));
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    v_memo := '{}';
  END;

  -- Identifiers come only from this fixed owner map; caller values are bound.
  FOR r IN SELECT * FROM (VALUES
    ('vehicles','vehicles','created_at'),
    ('images','vehicle_images','created_at'),
    ('observations','vehicle_observations','ingested_at'),
    ('auction_comments','auction_comments','created_at')
  ) inputs(organ,table_name,time_column) LOOP
    v_relation := to_regclass(format('public.%I',r.table_name));
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid=ix.relam
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attname=r.time_column
      WHERE i.indrelid=v_relation AND i.indisvalid AND i.indisready
        AND i.indpred IS NULL AND am.amname='btree' AND i.indkey[0]=a.attnum
    ) INTO v_supported;
    v_series := '[]';
    v_organ_status := 'exact';
    -- Admit the most recent days first; prepend points to retain ascending output.
    FOR day_offset IN REVERSE p_days-1..0 LOOP
      v_day := (v_since AT TIME ZONE 'UTC')::date + day_offset;
      v_count := NULL;
      v_reason := NULL;
      v_hit := NULL;
      IF NOT v_supported THEN v_reason := 'missing_supported_time_index';
      ELSE
        v_hit := v_memo -> (r.organ || ':' || v_day::text);
        IF v_hit IS NOT NULL THEN
          v_count := (v_hit #>> '{}')::bigint;
          v_served := v_served + 1;
        ELSIF clock_timestamp() >= v_deadline THEN v_reason := 'reading_budget_exhausted';
        ELSE
          BEGIN
            EXECUTE format(
              'SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE %I >= $1 AND %I < $2 ORDER BY %I LIMIT 10001) bounded',
              r.table_name,r.time_column,r.time_column,r.time_column)
            INTO v_count USING v_day::timestamp AT TIME ZONE 'UTC',
              least((v_day+1)::timestamp AT TIME ZONE 'UTC',v_as_of);
          EXCEPTION WHEN query_canceled OR OTHERS THEN
            v_count := NULL;
            v_reason := 'query_unavailable_' || SQLSTATE;
          END;
          -- Keep what cannot change: the cap, or a day that ended at least an hour ago.
          IF v_count IS NOT NULL
             AND (v_count > 10000
                  OR (v_day < v_today AND v_as_of >= ((v_day+1)::timestamp AT TIME ZONE 'UTC') + interval '1 hour')) THEN
            BEGIN
              INSERT INTO public.pipeline_pulse_day_counts AS m (organ, day, n, counted_at)
              VALUES (r.organ, v_day, v_count, v_as_of)
              ON CONFLICT (organ, day) DO UPDATE SET n = EXCLUDED.n, counted_at = EXCLUDED.counted_at
              WHERE m.n <> 10001
                AND NOT (m.day < v_today AND m.counted_at >= ((m.day + 1)::timestamp AT TIME ZONE 'UTC') + interval '1 hour');
              GET DIAGNOSTICS v_rows = ROW_COUNT;
              v_stored := v_stored + v_rows;
            EXCEPTION WHEN query_canceled OR OTHERS THEN
              NULL;
            END;
          END IF;
        END IF;
      END IF;
      v_point_status := CASE WHEN v_count IS NULL THEN 'unavailable'
                             WHEN v_count>10000 THEN 'capped' ELSE 'exact' END;
      v_series := jsonb_build_array(jsonb_build_object(
        'd',v_day,'n',CASE WHEN v_count<=10000 THEN v_count END,
        'status',v_point_status,'lower_bound',CASE WHEN v_count>10000 THEN v_count END,
        'reason',v_reason)) || v_series;
      IF v_point_status='unavailable' THEN v_organ_status := 'unavailable';
      ELSIF v_point_status='capped' AND v_organ_status='exact' THEN v_organ_status := 'capped';
      END IF;
    END LOOP;
    v_organs := v_organs || jsonb_build_object(r.organ,v_series);
    v_organ_coverage := v_organ_coverage || jsonb_build_object(r.organ,
      jsonb_build_object('status',v_organ_status,'clock',r.time_column,
        'supported_time_index',v_supported,'scope','UTC calendar days, exclusive as_of cutoff'));
    IF v_organ_status<>'exact' THEN
      v_degraded := v_degraded || jsonb_build_array(r.organ || ': ' || v_organ_status);
    END IF;
  END LOOP;

  -- Existing status-leading indexes, including the two measured partial index
  -- predicates, support the legacy backlog reading. Unknown index shapes refuse.
  FOR r IN SELECT * FROM (VALUES
    ('import_queue_pending','import_queue','status','pending',NULL::text),
    ('images_analysis_pending_capped','vehicle_images','ai_processing_status','pending',
      '(ai_processing_status = ''pending''::text)'),
    ('images_analysis_failed_capped','vehicle_images','ai_processing_status','failed',
      '(ai_processing_status = ANY (ARRAY[''processing''::text, ''failed''::text]))')
  ) inputs(metric,table_name,status_column,status_value,allowed_predicate) LOOP
    v_relation := to_regclass(format('public.%I',r.table_name));
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid=ix.relam
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attname=r.status_column
      WHERE i.indrelid=v_relation AND i.indisvalid AND i.indisready
        AND am.amname='btree' AND i.indkey[0]=a.attnum
        AND (i.indpred IS NULL OR pg_get_expr(i.indpred,i.indrelid)=r.allowed_predicate)
    ) INTO v_supported;
    v_count := NULL;
    v_reason := NULL;
    IF NOT v_supported THEN v_reason := 'missing_supported_status_index';
    ELSIF clock_timestamp() >= v_deadline THEN v_reason := 'reading_budget_exhausted';
    ELSE
      BEGIN
        EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE %I = $1 LIMIT 10001) bounded',
          r.table_name,r.status_column) INTO v_count USING r.status_value;
      EXCEPTION WHEN query_canceled OR OTHERS THEN
        v_count := NULL;
        v_reason := 'query_unavailable_' || SQLSTATE;
      END;
    END IF;
    v_point_status := CASE WHEN v_count IS NULL THEN 'unavailable'
                           WHEN v_count>10000 THEN 'capped' ELSE 'exact' END;
    -- Keep existing explicitly *_capped sentinel fields compatible. The old
    -- uncapped import key becomes NULL at its cap rather than an invented exact.
    v_backlogs := v_backlogs || jsonb_build_object(r.metric,
      CASE WHEN r.metric<>'import_queue_pending' OR v_count<=10000 THEN v_count END);
    v_backlog_coverage := v_backlog_coverage || jsonb_build_object(r.metric,
      jsonb_build_object('status',v_point_status,'n',CASE WHEN v_count<=10000 THEN v_count END,
        'lower_bound',CASE WHEN v_count>10000 THEN v_count END,'reason',v_reason));
    IF v_point_status<>'exact' THEN
      v_degraded := v_degraded || jsonb_build_array(r.metric || ': ' || v_point_status);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('since',v_since,'days',p_days,'organs',v_organs,'backlogs',v_backlogs,
    'degraded',CASE WHEN v_degraded='[]'::jsonb THEN NULL ELSE v_degraded END,
    'generated_at',v_as_of,'as_of',v_as_of,'coverage',jsonb_build_object(
      'contract','pipeline_pulse_capped_v1','timezone','UTC','rowLimitPerDay',10000,
      'rowLimitPerBacklog',10000,'sentinelRows',10001,'betweenQueryAdmissionBudgetSeconds',6,
      'organs',v_organ_coverage,'backlogs',v_backlog_coverage,
      'memo',jsonb_build_object('table','pipeline_pulse_day_counts','days_served_from_memory',v_served,
        'days_stored_this_reading',v_stored,
        'scope','Days read from memory are the stored cap or the exact count of a day that had ended an hour before it was counted; the current day is counted live until it reaches the cap. Backlogs are always counted live.'),
      'scope','Database arrival/status row counts; no source completeness, successful processing or semantic quality claim.',
      'scanRowsBounded',false));
END
$function$;

-- get_user_contribution_days: from supabase/migrations/20260614050000_fix_contribution_days_order_desc.sql
CREATE OR REPLACE FUNCTION get_user_contribution_days(p_user_id uuid)
RETURNS TABLE(day date, kind text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Photos: day = capture time when EXIF has it, upload time otherwise.
  SELECT
    COALESCE(vi.taken_at, vi.created_at)::date AS day,
    'photo'::text AS kind,
    count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.user_id = p_user_id
    AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Timeline events
  SELECT
    vte.event_date AS day,
    'event'::text AS kind,
    count(*)::int AS n
  FROM vehicle_timeline_events vte
  WHERE vte.user_id = p_user_id
    AND vte.event_date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Work sessions
  SELECT
    ws.session_date AS day,
    'work'::text AS kind,
    count(*)::int AS n
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id
    AND ws.session_date >= DATE '2000-01-01'
  GROUP BY 1

  -- DESC so the newest days survive PostgREST's 1000-row cap (was ORDER BY 1,2
  -- which kept the oldest 1000 and hid everything after 2020-03-20).
  ORDER BY day DESC, kind;
$$;

-- get_user_day_receipt: from supabase/migrations/20260615210000_add_photo_comment_and_owner_note.sql
CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_facets jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at,
           'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''),
           'components', s.components,
           'part_numbers', s.part_numbers,
           'intent', COALESCE(s.confirmed_intent, s.model_intent),
           'intent_confidence', s.intent_confidence,
           'intent_confirmed', s.intent_confirmed,
           'owner_note', s.owner_note,
           'analyzed_by', s.analyzed_by,
           'analyzed_at', s.analyzed_at
         ) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.structured_data->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'components_seen','[]'::jsonb)) c
              WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(t->>'text')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'text_regions','[]'::jsonb)) t
              WHERE t->>'text' IS NOT NULL) AS part_numbers,
           a.structured_data->>'intent' AS model_intent,
           a.structured_data->>'intent_confirmed_value' AS confirmed_intent,
           NULLIF(a.structured_data->>'intent_confidence','')::numeric AS intent_confidence,
           NULLIF(a.structured_data->>'intent_owner_confirmed','')::boolean AS intent_confirmed,
           -- Owner's own words about this frame (latest), surfaced as primary voice.
           -- Prune by vehicle_id FIRST (idx_observations_vehicle_comment_bid) so this
           -- never seq-scans the 7.5M-row observations table — it lands on the handful
           -- of comments for this vehicle, then filters to this image.
           (SELECT oc.content_text
              FROM vehicle_observations oc
              WHERE oc.vehicle_id = vi.vehicle_id
                AND oc.kind = 'comment'
                AND oc.structured_data->>'analysis_kind' = 'owner_comment'
                AND oc.structured_data->>'image_id' = vi.id::text
              ORDER BY oc.observed_at DESC
              LIMIT 1) AS owner_note,
           a.agent_model AS analyzed_by,
           a.ingested_at AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
      SELECT o.structured_data, o.agent_model, o.ingested_at
      FROM vehicle_observations o
      WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
        AND o.structured_data->>'image_id' = vi.id::text
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'facets', v_facets
  );
END;
$function$;

-- reset_stuck_photo_pipeline_images: from supabase/migrations/20260927010200_photo_pipeline_pace.sql
CREATE OR REPLACE FUNCTION public.reset_stuck_photo_pipeline_images()
RETURNS TABLE(requeued_processing integer, requeued_failed integer, dead_lettered integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_processing INT := 0;
  v_failed INT := 0;
  v_dead INT := 0;
  c_batch CONSTANT INT := 200;  -- per phase per run; hourly cron (was 2,000 every 15 min — 2026-09-27)
BEGIN
  -- Stuck in 'processing' >30 min (orchestrator died mid-run). Newest first so
  -- fresh user uploads unstick before the million-row scraped backlog.
  WITH stuck AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count < 3
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1
    FROM stuck WHERE v.id = stuck.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_processing FROM upd;

  -- Retryable failures (rate limits, transient fetch). Newest first, bounded.
  WITH retryable AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'failed'
      AND updated_at < now() - interval '10 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count < 3
      AND is_duplicate IS NOT TRUE
      AND image_url IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd2 AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1
    FROM retryable WHERE v.id = retryable.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_failed FROM upd2;

  -- Out of budget but still 'processing': settle as 'failed' (dead-letter).
  WITH dead AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count >= 3
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd3 AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'failed'
    FROM dead WHERE v.id = dead.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_dead FROM upd3;

  RETURN QUERY SELECT v_processing, v_failed, v_dead;
END;
$function$;

-- job 557: hourly at minute 17 again; the command is left as it is
DO $job$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'photo-pipeline-reset-stuck';
  IF v_id IS NULL THEN RAISE EXCEPTION 'cron job photo-pipeline-reset-stuck not found'; END IF;
  PERFORM cron.alter_job(job_id := v_id, schedule := '17 * * * *');
END
$job$;

-- verify
DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.get_pipeline_pulse(integer)'::regprocedure, 'fc1f3a43672d187b'),
      ('public.get_user_contribution_days(uuid)'::regprocedure, 'eb086ea4565f8998'),
      ('public.get_user_day_receipt(uuid,date)'::regprocedure, 'ad1be5807c3414e5'),
      ('public.reset_stuck_photo_pipeline_images()'::regprocedure, '000db1a7bf4af847')) AS t(fn, expected) LOOP
    IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = r.fn) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'restore failed: % has md5 prefix %, expected %', r.fn, (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = r.fn), r.expected;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photo-pipeline-reset-stuck' AND schedule = '17 * * * *') THEN
    RAISE EXCEPTION 'restore failed: photo-pipeline-reset-stuck is not at 17 * * * *';
  END IF;
END
$verify$;

COMMIT;
