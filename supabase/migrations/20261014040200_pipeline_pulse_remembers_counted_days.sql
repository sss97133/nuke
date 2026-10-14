-- get_pipeline_pulse remembers the days it has counted, so a poll reads a handful of rows instead of 30,000.
--
-- Measured 2026-10-14. SystemStatus polls get_pipeline_pulse(3) every 60 s while open (14 on the history toggle).
-- pg_stat_statements since 2026-09-29 09:20Z: 775 authenticated calls, mean 4,593 ms, max 8,253 ms, 3,560 s of database
-- time, the most of any signed-in path. EXPLAIN ANALYZE of get_pipeline_pulse(3) as authenticated: 6,260 ms, 16,298
-- blocks read from disk.
-- Cause: every organ-day is counted again on every call, up to the 10,001 sentinel, and a capped day reads 10,001
-- index entries plus 10,001 heap rows (the index-only scans cannot skip the heap: Heap Fetches 10,001 of 10,001, the
-- pages are not all-visible). Cold, with 1 GB of shared buffers: vehicle_observations 320 ms and auction_comments 1,119 ms
-- per capped day (13 ms and 11 ms when the pages happen to be cached), the three backlog counts 156 + 390 + 634 ms.
-- 3 days x 2 capped organs x about 0.7 s, plus the backlogs, is the 6 s. The history toggle repeats it for 14 days
-- (measured warm it finished inside its budget with no day skipped; cold it would need about 20 s).
-- The count of a day that has ended does not change, and "at least 10,001" never stops being true, so neither needs
-- reading twice.
--
-- After: public.pipeline_pulse_day_counts keeps two kinds of fact, written by the reader itself as it counts:
--   * a capped day (n = 10001): true for the rest of time, whatever day it is, today included;
--   * the exact count of a day that ended at least an hour before the count was taken (the hour lets a transaction
--     that began before midnight commit its rows).
-- The reader looks both up first and counts live only what it does not hold: today while it is below the cap, a day
-- that ended less than an hour ago, and a day nobody has read yet. Output is unchanged value for value (exact, capped,
-- unavailable, reasons, backlogs, signature, grants, owner, settings); coverage gains a memo block naming how many
-- days were served from memory and how many were stored.
--
-- The reader now writes, so it is VOLATILE (it was STABLE, "same statement snapshot"). Each count takes its own snapshot;
-- every count is bounded by the same as_of cutoff, so the only difference is a row committed during the call with a
-- timestamp before as_of. The write is best effort: any failure to read or store the memory falls back to counting
-- live, as before. It stores only values the function computed itself; a caller supplies p_days alone.
-- No schedule is added. A daily call shortly after 00:00 UTC would pre-count the day just ended and take that one slow
-- read off the first viewer (proposed in the PR, not done here).
--
-- Images stay unavailable by design: no full B-tree leads with vehicle_images.created_at (idx_vehicle_images_created_at
-- is (vehicle_id, created_at DESC), the 2026-06-10 migration's IF NOT EXISTS skipped the bare index), and an exact
-- count of a 49 GB table's day is not a read to make through a gate that refuses unindexed scans.
--
-- The function is replaced only from its 2026-10-14 source (md5 of pg_get_functiondef); any other source stops the
-- migration. Contract: supabase/sql/test_pipeline_pulse_memo.sql (CI job pipeline-pulse-memo-contract).
-- definer-grants: default reviewed get_pipeline_pulse
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.get_pipeline_pulse(integer)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.get_pipeline_pulse(integer) does not exist';
  END IF;
  IF md5(v_def) IS DISTINCT FROM '767821a759e394071cbf35ab56a0fff9'
     AND v_def NOT LIKE '%pipeline_pulse_day_counts%' THEN
    RAISE EXCEPTION 'get_pipeline_pulse is not the 2026-10-14 source this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.pipeline_pulse_day_counts (
  organ      text        NOT NULL CHECK (organ IN ('vehicles', 'images', 'observations', 'auction_comments')),
  day        date        NOT NULL,
  n          integer     NOT NULL CHECK (n BETWEEN 0 AND 10001),
  counted_at timestamptz NOT NULL,
  PRIMARY KEY (organ, day)
);
ALTER TABLE public.pipeline_pulse_day_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pipeline_pulse_day_counts FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.pipeline_pulse_day_counts IS
  'Memory of get_pipeline_pulse: one row per organ and UTC day it has counted, holding only what cannot change. Grain: organ x UTC day, never overwritten except to replace an untrusted row. Written only by get_pipeline_pulse as it counts (SECURITY DEFINER); no policy admits anon or authenticated, so they read and write nothing here directly. A row is trusted when n = 10001 (the cap: at least 10,001 arrivals, true for good) or when it is the exact count of a day that ended at least one hour before counted_at. Anything else is ignored and recounted. Arrival counts only: rows whose creation clock fell in that UTC day, taken when counted_at; it is not a count of rows now, and a later backfill that sets an old timestamp does not change a stored day. To recount a day, delete its row and the next reading counts it again. Created 2026-10-14; the reader was counting every day on every call (6.3 s for three days).';
COMMENT ON COLUMN public.pipeline_pulse_day_counts.organ IS
  'Which stream was counted: vehicles (vehicles.created_at), images (vehicle_images.created_at; stays unavailable without a full leading-time index), observations (vehicle_observations.ingested_at) or auction_comments (auction_comments.created_at). Same four names as the organs in get_pipeline_pulse.';
COMMENT ON COLUMN public.pipeline_pulse_day_counts.day IS
  'The UTC calendar day counted: rows whose arrival clock is at or after 00:00 UTC of this date and before 00:00 UTC of the next.';
COMMENT ON COLUMN public.pipeline_pulse_day_counts.n IS
  'Arrivals in that day, bounded: 0..10000 is the exact count, 10001 is the sentinel for "at least 10,001" (a lower bound, not a count). The reader never reads more than 10,001 rows of a day.';
COMMENT ON COLUMN public.pipeline_pulse_day_counts.counted_at IS
  'Statement timestamp of the reading that stored the row. An exact n is trusted only when this is at least one hour after the end of day, so a transaction that began before midnight has committed.';

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

COMMENT ON FUNCTION public.get_pipeline_pulse(integer) IS
  'Existing public SystemStatus pulse. pipeline_pulse_capped_v1: 1..31 explicit UTC calendar days before as_of, <=10000 matched rows per day/backlog plus 10001 sentinel. Exact zero, capped lower bound and unavailable are distinct. Daily ranges require an existing valid ready full B-tree with leading timestamp column; unsupported inputs are not scanned. Backlogs reuse supported existing status indexes. Query cancellation degrades per reading, six-second between-query admission budget skips subsequent reads; it is not a hard elapsed-runtime guarantee. Since 2026-10-14 it remembers in pipeline_pulse_day_counts the days it has counted that cannot change (the cap, or the exact count of a day that ended an hour before it was counted) and counts live only the rest; VOLATILE for that reason, each count takes its own snapshot under the same as_of cutoff. Physical scans and database fact quality are not certified. Signature/default/owner/grants preserved, no new jobs/indexes or intake.';

COMMIT;

-- Live verification (after apply), through PostgREST as authenticated, twice (the first call counts and stores):
--   POST /rest/v1/rpc/get_pipeline_pulse {"p_days":3}   -- coverage.memo.days_stored_this_reading > 0 the first time
--   POST /rest/v1/rpc/get_pipeline_pulse {"p_days":3}   -- days_served_from_memory = 8 or more; wall time well under a second
