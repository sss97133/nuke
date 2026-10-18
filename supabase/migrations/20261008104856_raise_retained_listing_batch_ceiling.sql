-- Pending source-property work reached470; the oldest pending key was9min old.
-- Three natural60 batches wrote60 each in12.5/13.4/16.2s without retries.
-- Stage120 until the matching canonical owner deploys. Keep35/40/55/60s
-- budgets, source500-key replay/backpressure, default20 and60-lease recovery.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $bulk$
DECLARE j bigint;cmd text;h text;f text;n integer;old boolean;
BEGIN
 SELECT jobid,command INTO j,cmd FROM cron.job WHERE jobname='project-retained-listing-properties'
  AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64') IN
   ('ybRKxK2Ppko4zRiYYzl0xrdqiACcl4gs/ioXuicWpN4=','w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=');
 IF j IS NULL THEN RAISE EXCEPTION 'Active listing batch contract changed; preserve owner pause';END IF;
 old:=encode(sha256(convert_to(cmd,'UTF8')),'base64')='ybRKxK2Ppko4zRiYYzl0xrdqiACcl4gs/ioXuicWpN4=';
 UPDATE public.observation_extractors e
 SET rate_limit_per_hour=7200,extractor_config=jsonb_set(e.extractor_config,'{batch_size}','120'::jsonb)
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='bat'
  AND e.slug='retained-listing-properties-v1' AND e.is_active AND e.extractor_type='edge_function'
  AND e.edge_function_name='ingest-observation' AND e.schedule_type='cron' AND e.min_interval_seconds=60
  AND e.rate_limit_per_hour=CASE WHEN old THEN 3600 ELSE 7200 END
  AND e.extractor_config=jsonb_build_object('mode','retained_listing_property_drain_v1',
   'batch_size',CASE WHEN old THEN 60 ELSE 120 END,'model_calls',0,'assay_rpc','assay_retained_listing_properties')
  AND e.produces_kinds=ARRAY['specification']::public.observation_kind[];
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Registered listing capacity contract changed';END IF;

 f:=pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='Z0fy0pdztdlUCRUGgZ0AglygJb9aXbUNT2gHsi4RvIE=' THEN
  IF cardinality(string_to_array(f,'p_limit NOT BETWEEN 1 AND 60'))<>2 THEN RAISE EXCEPTION 'Listing claim bound anchor changed';END IF;
  EXECUTE replace(f,'p_limit NOT BETWEEN 1 AND 60','p_limit NOT BETWEEN 1 AND 120');
 ELSIF h IS DISTINCT FROM 'RRwgUSHdvW84Ql2Uxzq0XUObiFNiE0nUboikj7g6h/c=' THEN RAISE EXCEPTION 'Listing claim owner changed';END IF;
 f:=pg_get_functiondef('public.activate_retained_listing_property_intake()'::regprocedure);
 h:=encode(sha256(convert_to(f,'UTF8')),'base64');
 IF h='jNWjgZrlAi05Z8ZOo9C4Ps7/1XYVyZ7KrxwMUkhktLI=' THEN
  IF cardinality(string_to_array(f,'"batch_size":60}'))<>2 THEN RAISE EXCEPTION 'Listing activation bound anchor changed';END IF;
  EXECUTE replace(f,'"batch_size":60}','"batch_size":120}');
 ELSIF h IS DISTINCT FROM 'VtXZ5PGGdqU31ri3bR5I5IFq7TxwEiR/m2FGsk3ljqE=' THEN RAISE EXCEPTION 'Listing activation owner changed';END IF;
 PERFORM cron.alter_job(job_id:=j,command:=replace(cmd,'"batch_size":60}','"batch_size":120}'),active:=false);
END $bulk$;
COMMENT ON TABLE public.retained_listing_property_work IS 'Existing typed source-property operational work owned by ingest-observation. Fixed120/minute staged until matching canonical owner deploys; default20 RPC,60-expired-lease cap,10min lease,15min retry/budget deferral,24h refusal,3-attempt pause, load/lock governor and500pending+claimed replay gate preserved. Existing exact interior/exterior selectors admit attributed claims with unknown factory/current physical configuration, no provider/model calls.7200/hour is attempt capacity, not measured yield.';
COMMENT ON FUNCTION public.claim_retained_listing_properties(text,integer) IS 'Existing service-only leased source-property owner: bounded1..120(default20), unchanged SKIPLOCKED/load governor,60expired leases per invocation and protected persisted-result completion. Source qualification and replay unchanged.';
COMMENT ON FUNCTION public.activate_retained_listing_property_intake() IS 'Existing private deployment-owner activation after the exact fixed120/minute command and matching ingest-observation owner deploy. PUBLIC/anon/authenticated/service execution remains denied; pauses before migration are never revived.';
NOTIFY pgrst,'reload schema';
COMMIT;
