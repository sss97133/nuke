-- Live definition of get_pipeline_pulse(integer) on 2026-10-14 (pg_get_functiondef),
-- md5(pg_get_functiondef) 767821a759e394071cbf35ab56a0fff9, the migration guard's expected source. Test fixture only.
CREATE OR REPLACE FUNCTION public.get_pipeline_pulse(p_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  r record;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'p_days must be between 1 and 31' USING ERRCODE='22023';
  END IF;
  v_since := (v_today - (p_days - 1))::timestamp AT TIME ZONE 'UTC';

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
      IF NOT v_supported THEN v_reason := 'missing_supported_time_index';
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
      'scope','Database arrival/status row counts; no source completeness, successful processing or semantic quality claim.',
      'scanRowsBounded',false));
END
$function$;
