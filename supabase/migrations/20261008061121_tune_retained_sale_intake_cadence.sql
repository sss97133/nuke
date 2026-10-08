-- Recent fixed20 source-only batches finish in12–19s with no retry or model
-- calls. Increase the existing schedule, retaining the same worker and guards.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

DO $cadence$
DECLARE v_job bigint; v_rows integer;
 v_command text := $cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-extract-snapshots',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","dry_run":false,"batch_size":20}'::jsonb,
  timeout_milliseconds:=60000);
 $cmd$;
BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='qualify-bat-archived-sales'
  AND active AND schedule IN('*/5 * * * *','* * * * *')
  AND btrim(regexp_replace(command,'\s+',' ','g'))=btrim(regexp_replace(v_command,'\s+',' ','g'));
 IF v_job IS NULL THEN RAISE EXCEPTION 'Active fixed20 archived sale contract unavailable; preserve owner pause or changed job'; END IF;

 UPDATE public.observation_extractors e SET rate_limit_per_hour=1200,min_interval_seconds=60
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='bat'
  AND e.slug='bat-archived-sale-v1' AND e.is_active AND e.extractor_type='edge_function'
  AND e.edge_function_name='batch-extract-snapshots' AND e.schedule_type='cron'
  AND e.extractor_config='{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","model_calls":0}'::jsonb
  AND e.produces_kinds=ARRAY['sale_result']::public.observation_kind[]
  AND (e.rate_limit_per_hour,e.min_interval_seconds) IN((240,300),(1200,60));
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Registered protected-v1 archived sale capacity unavailable'; END IF;
 PERFORM cron.alter_job(job_id:=v_job,schedule:='* * * * *');
END $cadence$;

COMMENT ON TABLE public.bat_sale_replay_state IS 'Operational retained BaT cache replay cursor/counters for existing batch-extract-snapshots protected-v1 intake. Fixed20/minute attempts, unchanged lock/load governor,500-key seed under500pending,10minlease,40s stop-new-record/55s finish/60s HTTP budgets.1200/hour is attempt capacity, not admitted yield or corpus completion. No native result promotion, model/provider calls, source writes or manual replay. Cached consumer read_bat_sale_intake; assay_bat_sale_intake.';
NOTIFY pgrst,'reload schema';
COMMIT;
