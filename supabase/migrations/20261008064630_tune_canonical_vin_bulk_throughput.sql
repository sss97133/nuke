--20natural canonical60batches persisted1183new records/17explicit refusals in8–13s,
--0retry/completion/provider/model failures. Preserve35/45/55/60s budgets and
--all source guards; stage the120/minute contract until BOTH owners deploy.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ DECLARE v_job bigint; v_command text; v_rate integer; v_rows integer; BEGIN
 SELECT jobid,command INTO v_job,v_command FROM cron.job WHERE jobname='qualify-retained-vin-references'
  AND active AND schedule='* * * * *' AND command LIKE '%/functions/v1/batch-vin-decode%'
  AND command LIKE '%"use_retained_reference_queue":true%' AND command LIKE '%"dry_run":false%'
  AND (command LIKE '%"batch_size":60}%' OR command LIKE '%"batch_size":120}%');
 IF v_job IS NULL THEN RAISE EXCEPTION 'Active fixed60-or120/minute reference contract unavailable; preserve owner pause'; END IF;
 v_rate:=CASE WHEN v_command LIKE '%"batch_size":60}%' THEN 3600 ELSE 7200 END;
 UPDATE public.observation_extractors e SET rate_limit_per_hour=7200
 FROM public.observation_sources s WHERE e.source_id=s.id AND s.slug='nhtsa'
  AND e.slug='retained-vin-reference-v1' AND e.is_active AND e.edge_function_name='batch-vin-decode'
  AND e.extractor_config->>'use_retained_reference_queue'='true' AND e.extractor_config->>'dry_run'='false'
  AND e.rate_limit_per_hour=v_rate AND e.min_interval_seconds=60;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Registered fixed reference capacity unavailable'; END IF;
 PERFORM cron.alter_job(job_id:=v_job,command:=replace((SELECT command FROM cron.job WHERE jobid=v_job),
  '"batch_size":60}','"batch_size":120}'),active:=false);
END $$;

CREATE OR REPLACE FUNCTION public.claim_vin_reference_intake(p_worker text,p_limit integer DEFAULT 20)
RETURNS TABLE(revision_id text,vehicle_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='10s' AS $$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Invalid bounded reference worker';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8 THEN RETURN; END IF;
 PERFORM set_config('app.writer','batch-vin-decode:retained-reference',true);
 PERFORM public.seed_vin_reference_revisions();
 WITH expired AS(SELECT q.revision_id FROM public.vin_reference_intake_queue q
  WHERE q.status='claimed' AND q.locked_at<now()-interval '10 minutes'
  ORDER BY q.locked_at LIMIT 120 FOR UPDATE SKIP LOCKED)
 UPDATE public.vin_reference_intake_queue q SET status=CASE WHEN q.attempts>=3 THEN 'failed' ELSE 'pending' END,
  locked_by=NULL,locked_at=NULL,next_attempt_at=now()+interval '15 minutes',last_error='lease_expired'
 FROM expired e WHERE q.revision_id=e.revision_id;
 RETURN QUERY WITH picked AS(SELECT q.revision_id FROM public.vin_reference_intake_queue q
  WHERE q.status IN('pending','skipped') AND q.next_attempt_at<=now() AND q.attempts<3
  ORDER BY q.next_attempt_at,q.revision_id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.vin_reference_intake_queue q SET status='claimed',locked_by=p_worker,locked_at=now(),attempts=q.attempts+1
 FROM picked p WHERE q.revision_id=p.revision_id RETURNING q.revision_id::text,q.vehicle_id;
END $$;

CREATE OR REPLACE FUNCTION public.activate_retained_vin_reference_intake() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='1s' SET statement_timeout='5s' AS $$
DECLARE v_job bigint;
BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='qualify-retained-vin-references'
  AND schedule='* * * * *' AND command LIKE '%/functions/v1/batch-vin-decode%'
  AND command LIKE '%"use_retained_reference_queue":true%' AND command LIKE '%"dry_run":false%'
  AND command LIKE '%"batch_size":120}%';
 IF v_job IS NULL THEN RAISE EXCEPTION 'Installed retained reference120record job contract unavailable'; END IF;
 PERFORM cron.alter_job(job_id:=v_job,active:=true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.activate_retained_vin_reference_intake() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_vin_reference_intake(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_vin_reference_intake(text,integer) TO service_role;
COMMENT ON TABLE public.vin_reference_intake_queue IS 'Operational accepted taxonomy revision queue with same-parent FK. Existing batch-vin-decode claims at most120/minute under unchanged load/lock governor and55s transport budget; default API claim remains20. Canonical intake independently qualifies each source; no model/provider calls or physical scalar overwrite. Leased function writes; serviceSELECTonly; source replay500PKpages gated below500pending, refusal24h/retry15min/pause3.7200/hour is attempt capacity, not measured yield. Cached taxonomy consumer and actual progress assay remain authoritative.';
COMMENT ON FUNCTION public.claim_vin_reference_intake(text,integer) IS 'Service-only bounded factory-reference claims,1–120(default20),SKIPLOCKED/load governor,120expired leases maximum per invocation; canonical finish verifies persisted source result.';
COMMENT ON FUNCTION public.activate_retained_vin_reference_intake() IS 'Deployment-owner-only fixed120/minute job activation after both batch-vin-decode and ingest-observation owners deploy; API execution denied.';
NOTIFY pgrst,'reload schema';
COMMIT;
