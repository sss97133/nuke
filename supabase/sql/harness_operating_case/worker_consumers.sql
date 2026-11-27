-- Candidate implementation for schema proposal f8215459-ec38-4e2e-a855-509257740313.
-- Not an automatically deployed migration. Disposable PG17 contracts only.

BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text; a text; z text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_queue_gauge()'::regprocedure)<>'9d91e6fedde95ebea7d00d65a43f9e05'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_revert_v1(uuid)'::regprocedure)<>'9cf4d876c950d452db3b6bfefc42dd99'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.model_fold_revert_since(timestamptz)'::regprocedure)<>'4d8bc1ae987c64af20f106626f98af22' THEN
  RAISE EXCEPTION 'Retained worker consumer definitions changed; review current owners before applying'; END IF;
 b:=pg_get_functiondef('public.model_fold_queue_gauge()'::regprocedure);
 a:=$a$    'counted_at', now())$a$;
 z:=$z$    'private_dc_phases_24h',(SELECT jsonb_build_object('scope','conditional_private_interpretation_not_build_readiness',
      'runs',count(*),'solved',count(*) FILTER(WHERE dc_status='solved'),
      'held',count(*) FILTER(WHERE dc_status='held'),'reused',count(*) FILTER(WHERE dc_status='reused'),
      'changed',count(*) FILTER(WHERE dc_status='changed'),'waiting',count(*) FILTER(WHERE dc_status='dependency_pending'),
      'failed',count(*) FILTER(WHERE dc_status='failed'),'abandoned',count(*) FILTER(WHERE dc_status='abandoned'),
      'backoff',count(*) FILTER(WHERE dc_status IN('backoff','budget_exhausted')),
      'outputs_retained',count(*) FILTER(WHERE dc_output_retained),'ms_avg',round(avg(ms)),'newest_at',max(at))
      FROM public.model_fold_tick_runs WHERE fold_phase='dc' AND at>now()-interval '24 hours'),
    'counted_at', now())$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'DC gauge owner anchor drift'; END IF;
 EXECUTE replace(b,a,z);

 b:=pg_get_functiondef('public.model_fold_revert_v1(uuid)'::regprocedure);
 FOR a,z IN SELECT * FROM(VALUES
 ($a$n_harness_retained int := 0;$a$,$z$n_harness_retained int := 0; n_dc_retained int := 0;$z$),
 ($a$  select count(*) into n_harness_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='harness';$a$,
  $z$  select count(*) into n_harness_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='harness';
  select count(*) into n_dc_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='dc';$z$),
 ($a$n_runs>0 OR n_harness_retained=0$a$,$z$n_harness_retained=0 AND n_dc_retained=0$z$),
 ($a$'harness_receipts_retained',n_harness_retained$a$,
  $z$'harness_receipts_retained',n_harness_retained,'private_dc_phases_retained',n_dc_retained,
          'revert_complete',n_harness_retained=0 AND n_dc_retained=0$z$)
 ) p(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>(CASE WHEN a IN('n_runs>0 OR n_harness_retained=0',
   '''harness_receipts_retained'',n_harness_retained') THEN 2 ELSE 1 END) THEN
   RAISE EXCEPTION 'DC revert owner anchor drift: %',left(a,80); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;

 b:=pg_get_functiondef('public.model_fold_revert_since(timestamptz)'::regprocedure);
 a:=$a$  return jsonb_build_object('ticks', jsonb_array_length(out), 'detail', out);$a$;
 z:=$z$  return jsonb_build_object('ticks',jsonb_array_length(out),'detail',out,
    'ticks_fully_reverted',(SELECT count(*) FROM jsonb_array_elements(out) x WHERE x->>'revert_complete'='true'),
    'ticks_with_retained_domain_outputs',(SELECT count(*) FROM jsonb_array_elements(out) x WHERE x->>'revert_complete'='false'));$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'DC bulk revert summary anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
COMMIT;
