--40-record retained batches take22--25s while eligible source work remains.
-- Reuse the existing queue, two-record canonical loop and40/55/60s budgets.
-- Stage120 attempts/minute until both existing owning Edge functions deploy.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $stage$
DECLARE j bigint;cmd text;old boolean;f text;h text;n integer;
BEGIN
 SELECT jobid,command INTO j,cmd FROM cron.job WHERE jobname='qualify-bat-archived-sales'
  AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64') IN
   ('C+rU5RmwHhyj8yqdJqMgDrj7EohcbKHP3aM4um8dlpA=','AWFMWVBSwPlq8ZF2/FpDJNe4z/bmRc5IHjyW5qha2XY=');
 IF j IS NULL THEN RAISE EXCEPTION 'Active protected-v1 sale command changed; preserve owner pause';END IF;
 old:=encode(sha256(convert_to(cmd,'UTF8')),'base64')='C+rU5RmwHhyj8yqdJqMgDrj7EohcbKHP3aM4um8dlpA=';
 f:=pg_get_functiondef('public.claim_bat_sale_snapshots(text,integer)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h IS DISTINCT FROM (CASE WHEN old THEN 'GA2BidAHRpM+bbXoaSgEninREgjbRoE39lsfs7VHEu4='
  ELSE 'xXb1hN6EnQDCcuDEtG+SZJ0nwwYuI6Tfu4u3ocNdsPE=' END) THEN
  RAISE EXCEPTION 'Protected sale claim owner changed';
 END IF;
 UPDATE public.observation_extractors e SET rate_limit_per_hour=7200
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='bat'
  AND e.slug='bat-archived-sale-v1' AND e.is_active AND e.extractor_type='edge_function'
  AND e.edge_function_name='ingest-observation' AND e.schedule_type='cron'
  AND e.min_interval_seconds=60 AND e.rate_limit_per_hour=CASE WHEN old THEN 2400 ELSE 7200 END
  AND e.extractor_config='{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","model_calls":0}'::jsonb
  AND e.produces_kinds=ARRAY['sale_result']::public.observation_kind[];
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Registered protected-v1 sale contract changed';END IF;
 IF old THEN
  IF cardinality(string_to_array(f,'p_limit NOT BETWEEN 1 AND 40'))<>2 THEN RAISE EXCEPTION 'Sale claim anchor changed';END IF;
  EXECUTE replace(f,'p_limit NOT BETWEEN 1 AND 40','p_limit NOT BETWEEN 1 AND 120');
 END IF;
 PERFORM cron.alter_job(job_id:=j,command:=replace(cmd,'"batch_size":40}','"batch_size":120}'),active:=false);
END $stage$;
COMMENT ON TABLE public.bat_sale_replay_state IS 'Existing source replay and derivation_queue owner, drained by ingest-observation protected-v1 canonical intake.120attempts/minute with exactly2in-process records, staged until both existing Edge owners deploy;7200/hour is attempt capacity, not measured admission. Default20 RPC and sequential legacy outer ceiling20,20expired leases/deferral retries,500source keys/pending gate,10minlease,15minretry/unstarted defer,24hrefusal,3attemptpause and40/55/60s budgets remain. Failed completion stops new admissions and both in-flight records settle; remaining leases use existing recovery. Protected source/parent/result checks, original clocks, typed FKs, testimony and paid/native/episode holds unchanged. read_bat_sale_intake/assay_bat_sale_intake remain consumers.';
COMMENT ON FUNCTION public.claim_bat_sale_snapshots(text,integer) IS 'Existing service-only source-sale owner:1..120(default20), unchanged load/lock governor,20lease recovery,20capture-deferral retries,500-key source/backpressure bounds. Two-record canonical loop avoids nested Edge calls; legacy outer path stays sequential20. finish_bat_sale_snapshot independently verifies persisted protected-v1 source custody; no new testimony/API grants.';
NOTIFY pgrst,'reload schema';
COMMIT;
