-- Measured retained-reference arrival exceeds the initial80/hour ceiling.
-- Preserve20claims, finite HTTP/lease budgets, source qualification and governor;
-- increase only the existing deterministic schedule and its registered capacity.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

DO $$ DECLARE v_job bigint; v_rows integer; BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='qualify-retained-vin-references'
  AND active AND schedule IN('*/15 * * * *','* * * * *')
  AND command LIKE '%/functions/v1/batch-vin-decode%'
  AND command LIKE '%"use_retained_reference_queue":true%' AND command LIKE '%"dry_run":false%'
  AND command LIKE '%"batch_size":20%';
 IF v_job IS NULL THEN RAISE EXCEPTION 'Active bounded retained reference contract unavailable; do not revive a paused or changed job'; END IF;
 UPDATE public.observation_extractors e SET rate_limit_per_hour=1200,min_interval_seconds=60
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='nhtsa'
  AND e.slug='retained-vin-reference-v1' AND e.is_active AND e.edge_function_name='batch-vin-decode'
  AND e.extractor_config->>'use_retained_reference_queue'='true'
  AND e.extractor_config->>'dry_run'='false'
  AND (e.rate_limit_per_hour,e.min_interval_seconds) IN((80,900),(1200,60));
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Registered retained reference capacity contract unavailable'; END IF;
 PERFORM cron.alter_job(job_id:=v_job,schedule:='* * * * *');
END $$;

CREATE OR REPLACE FUNCTION public.activate_retained_vin_reference_intake() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='1s' SET statement_timeout='5s' AS $$
DECLARE v_job bigint;
BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='qualify-retained-vin-references'
  AND schedule='* * * * *' AND command LIKE '%/functions/v1/batch-vin-decode%'
  AND command LIKE '%"use_retained_reference_queue":true%' AND command LIKE '%"dry_run":false%'
  AND command LIKE '%"batch_size":20%';
 IF v_job IS NULL THEN RAISE EXCEPTION 'Installed retained reference job contract unavailable'; END IF;
 PERFORM cron.alter_job(job_id:=v_job,active:=true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.activate_retained_vin_reference_intake() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.vin_reference_intake_queue IS 'Operational queue, grain one accepted immutable vehicle_taxonomy_revisions PK, with same-parent FK. Existing batch-vin-decode claims at most20 each minute through its load/lock governor and finite transport budget, invoking canonical ingest-observation. Canonical result in vehicle_observations is factory reference only; no physical scalar overwrite or provider/model calls. Service SELECT only, leased function writes, refusal24h/retry15min/pause3. Cached consumer read_vehicle_taxonomy_fold; assay_vin_reference_intake.1200/hour is attempt capacity, not observed yield or fleet completion.';
COMMENT ON FUNCTION public.activate_retained_vin_reference_intake() IS 'Deployment-owner-only activation of the fixed20/minute retained-reference cron contract after both existing edge owners are installed; no API execution.';
NOTIFY pgrst,'reload schema';
COMMIT;
