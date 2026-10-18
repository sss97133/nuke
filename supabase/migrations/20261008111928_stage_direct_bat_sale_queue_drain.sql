-- Existing20-record batches finished in11.3–15.8s; pending source age reached24min.
-- Reuse the SAME queue and protected-v1 canonical handler in process, avoiding
-- nested Edge requests. Stage40/minute until both existing owners deploy.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $stage$
DECLARE j bigint;cmd text;old boolean;f text;h text;n integer;
BEGIN
 SELECT jobid,command INTO j,cmd FROM cron.job WHERE jobname='qualify-bat-archived-sales'
  AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64') IN
   ('/Sjsy8GQsEZmVbgIgMzyApmYRMG4lBcgyu/hoQyLRwY=','C+rU5RmwHhyj8yqdJqMgDrj7EohcbKHP3aM4um8dlpA=');
 IF j IS NULL THEN RAISE EXCEPTION 'Active protected-v1 sale command changed; preserve owner pause';END IF;
 old:=encode(sha256(convert_to(cmd,'UTF8')),'base64')='/Sjsy8GQsEZmVbgIgMzyApmYRMG4lBcgyu/hoQyLRwY=';
 UPDATE public.observation_extractors e SET edge_function_name='ingest-observation',rate_limit_per_hour=2400
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='bat'
  AND e.slug='bat-archived-sale-v1' AND e.is_active AND e.extractor_type='edge_function'
  AND e.edge_function_name=CASE WHEN old THEN 'batch-extract-snapshots' ELSE 'ingest-observation' END
  AND e.schedule_type='cron' AND e.min_interval_seconds=60
  AND e.rate_limit_per_hour=CASE WHEN old THEN 1200 ELSE 2400 END
  AND e.extractor_config='{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","model_calls":0}'::jsonb
  AND e.produces_kinds=ARRAY['sale_result']::public.observation_kind[];
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Registered protected-v1 sale contract changed';END IF;
 f:=pg_get_functiondef('public.claim_bat_sale_snapshots(text,integer)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='7CxuLcsWf/RWKTEwNsWI6D1HL0W9+5PDn/nzbOiIELg=' THEN
  IF cardinality(string_to_array(f,'p_limit NOT BETWEEN 1 AND 20'))<>2 THEN RAISE EXCEPTION 'Sale claim anchor changed';END IF;
  EXECUTE replace(f,'p_limit NOT BETWEEN 1 AND 20','p_limit NOT BETWEEN 1 AND 40');
 ELSIF h IS DISTINCT FROM 'GA2BidAHRpM+bbXoaSgEninREgjbRoE39lsfs7VHEu4=' THEN RAISE EXCEPTION 'Protected sale claim owner changed';END IF;
 PERFORM cron.alter_job(job_id:=j,command:=replace(replace(cmd,
  '/functions/v1/batch-extract-snapshots','/functions/v1/ingest-observation'),'"batch_size":20}','"batch_size":40}'),active:=false);
END $stage$;
COMMENT ON TABLE public.bat_sale_replay_state IS 'Existing batch-extract-snapshots operational source replay/queue owner reused by canonical ingest-observation source_sale_qualification in-process drain. Fixed40/minute staged until both owners deploy;2400/hour attempt capacity is not measured admission. Default20 RPC and legacy outer Edge ceiling20,20expired leases/deferral events,500source-key seed/500pending gate,10minlease,15minretry/budget deferral,24hrefusal,3attemptpause and40/55/60s budgets remain. Protected-v1 source/parent/result checks, original clocks, typed FKs, testimony, native/episode holds and zero-model path unchanged. Consumer read_bat_sale_intake; assay_bat_sale_intake.';
COMMENT ON FUNCTION public.claim_bat_sale_snapshots(text,integer) IS 'Existing service-only source-sale owner:1..40(default20) with unchanged load/lock governor,20lease recovery,20capture-deferral retries and500-key source/backpressure limits. Canonical direct drain avoids nested Edge calls; finish_bat_sale_snapshot still independently verifies persisted protected-v1 custody.';
NOTIFY pgrst,'reload schema';
COMMIT;
