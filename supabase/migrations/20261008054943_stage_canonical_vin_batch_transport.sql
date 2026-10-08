-- Stage the installed60-record intake while its canonical batch transport
-- deploys. The per-record source qualification and database CAS stay intact.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ DECLARE v_job bigint; BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='qualify-retained-vin-references'
  AND active AND schedule='* * * * *' AND command LIKE '%/functions/v1/batch-vin-decode%'
  AND command LIKE '%"use_retained_reference_queue":true%' AND command LIKE '%"dry_run":false%'
  AND command LIKE '%"batch_size":60}%';
 IF v_job IS NULL THEN RAISE EXCEPTION 'Active fixed60/minute reference contract unavailable; preserve owner pause'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.observation_extractors e JOIN public.observation_sources s ON s.id=e.source_id
   WHERE s.slug='nhtsa' AND e.slug='retained-vin-reference-v1' AND e.is_active
    AND e.edge_function_name='batch-vin-decode' AND e.rate_limit_per_hour=3600 AND e.min_interval_seconds=60
    AND e.extractor_config->>'use_retained_reference_queue'='true' AND e.extractor_config->>'dry_run'='false') THEN
  RAISE EXCEPTION 'Registered fixed60/minute reference capacity unavailable';
 END IF;
 PERFORM cron.alter_job(job_id:=v_job,active:=false);
END $$;
COMMIT;
