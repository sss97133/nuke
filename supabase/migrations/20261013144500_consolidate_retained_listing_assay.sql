-- Exact retained-work accounting within the existing assay owner.
-- The 2026-10-13 live done/distinct pass took 2126ms for 498013 rows and
-- spilled a 9760kB sort; custody took 983ms separately. Keep all denominators,
-- custody selection, attribution, permissions and the assay's 5s policy.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $repair$
DECLARE current_definition text;identity_before jsonb;identity_after jsonb;
 replacement constant text := $replacement$CREATE OR REPLACE FUNCTION public.assay_retained_listing_properties()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
AS $function$
DECLARE s jsonb;w jsonb;total bigint;sampled bigint;stale bigint;failed bigint;due bigint;distinct_rows bigint;property_counts jsonb;recent_completed bigint;
BEGIN
 SELECT to_jsonb(r) INTO s FROM public.retained_listing_property_replay r WHERE id;
 IF s IS NULL THEN RETURN jsonb_build_object('status','unavailable','reason','replay_state_missing');END IF;
 -- One full-work aggregation supplies every additive queue metric. Only the
 -- small property/status result is materialized; no lifetime row list is held.
 WITH property_status AS MATERIALIZED(
  SELECT property_id,status,count(*) AS work_items,
   count(*) FILTER(WHERE status='claimed' OR(status='pending' AND next_attempt_at<=now())) AS due_items,
   count(*) FILTER(WHERE status='done' AND completed_at>=statement_timestamp()-interval '30 minutes') AS recent_items
  FROM public.retained_listing_property_work GROUP BY property_id,status),
 status_counts AS(SELECT status,sum(work_items)::bigint AS n FROM property_status GROUP BY status)
 SELECT jsonb_object_agg(status,n),
  coalesce(sum(n) FILTER(WHERE status='done'),0)::bigint,
  coalesce(sum(n) FILTER(WHERE status='failed'),0)::bigint,
  (SELECT coalesce(sum(due_items),0)::bigint FROM property_status),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.property_key,x.status) FROM(
   SELECT r.property_key,q.status,sum(q.work_items)::bigint AS work_items FROM property_status q
   JOIN public.observation_properties r ON r.id=q.property_id GROUP BY r.property_key,q.status)x),
  (SELECT coalesce(sum(recent_items),0)::bigint FROM property_status)
 INTO w,total,failed,due,property_counts,recent_completed FROM status_counts;
 -- Preserve global distinctness across properties, including duplicate results.
 -- A grouped/hash alternative spilled more and was slower in the default-memory
 -- 500k local fixture. Keep COUNT DISTINCT; no memory or timeout increase.
 SELECT count(DISTINCT observation_id) INTO distinct_rows
 FROM public.retained_listing_property_work WHERE status='done';
 WITH sample AS MATERIALIZED(
  (SELECT source_observation_id,property_id,observation_id FROM public.retained_listing_property_work WHERE status='done'
   ORDER BY completed_at,source_observation_id,property_id LIMIT 100)
  UNION
  (SELECT source_observation_id,property_id,observation_id FROM public.retained_listing_property_work WHERE status='done'
   ORDER BY completed_at DESC,source_observation_id DESC,property_id DESC LIMIT 100))
 SELECT count(*),count(*) FILTER(WHERE NOT public.retained_listing_property_result_matches(source_observation_id,property_id,observation_id))
 INTO sampled,stale FROM sample;
 RETURN jsonb_build_object('status',CASE WHEN failed>0 OR stale>0 THEN 'failed'
  WHEN s->>'scan_completed_at' IS NULL OR due>0 OR total>sampled THEN 'partial' ELSE 'passed' END,
  'method','retained_listing_property_projection_v1','source_scan',s,'work',coalesce(w,'{}'::jsonb),
  'canonical_observations',distinct_rows,'completed_work',total,
  'property_work',property_counts,
  'recent_window_minutes',30,
  'recent_completed_work',recent_completed,
  'recent_new_claims',(SELECT count(*) FROM public.retained_listing_property_work q
   JOIN public.vehicle_observations o ON o.id=q.observation_id
   WHERE q.status='done' AND q.completed_at>=statement_timestamp()-interval '30 minutes'
    AND o.ingested_at>=statement_timestamp()-interval '30 minutes'),'custody_sampled',sampled,'custody_sample_cap',200,
  'sample_stale',stale,'custody_coverage',CASE WHEN total>sampled THEN 'bounded_sample' ELSE 'all_completed_work' END,
  'full_current_custody_verified',total=sampled AND stale=0,'due',due,'failed',failed,
  'provider_calls',0,'model_calls',0,'role','attributed_retained_listing_claim','factory_configuration_verified',false,
  'measured_at',statement_timestamp());
EXCEPTION WHEN query_canceled THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
 WHEN OTHERS THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
END $function$;$replacement$;
BEGIN
 current_definition:=pg_get_functiondef('public.assay_retained_listing_properties()'::regprocedure);
 -- The deploy runner may retry after a successful application. Only the exact
 -- reviewed replacement is a no-op; any other installed definition must match
 -- the observed baseline fingerprint before it can be changed.
 IF rtrim(current_definition,E'\n')=rtrim(replacement,E';\n') THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
  AND pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock waiters present; defer retained assay repair';
 END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
  AND pid<>pg_backend_pid() AND state='active'
  AND query~'(retained_listing_property|assay_retained_listing_properties)')>2 THEN
  RAISE EXCEPTION 'Relevant retained-property work active; defer assay repair';
 END IF;
 IF encode(sha256(convert_to(rtrim(current_definition,E'\n'),'UTF8')),'hex') IS DISTINCT FROM
  ('16690c243dea6990'||'82f113e2f6f15bf4'||'2cb63fcdf2fada85'||'4567936641585374') THEN
  RAISE EXCEPTION 'Retained listing assay owner drifted; review current definition';
 END IF;
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,
  'config',proconfig,'volatility',provolatile,'parallel',proparallel,'cost',procost)
 INTO identity_before FROM pg_proc WHERE oid='public.assay_retained_listing_properties()'::regprocedure;
 EXECUTE replacement;
 SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,
  'config',proconfig,'volatility',provolatile,'parallel',proparallel,'cost',procost)
 INTO identity_after FROM pg_proc WHERE oid='public.assay_retained_listing_properties()'::regprocedure;
 IF identity_after IS DISTINCT FROM identity_before THEN RAISE EXCEPTION 'Retained assay identity changed';END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
  AND pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock waiters after retained assay repair';
 END IF;
END $repair$;
COMMIT;
