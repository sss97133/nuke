-- The installed assay times out around3000current receipts because each calls
-- two expensive source/custody readers. Bound those checks without changing
-- canonical admission/CAS, exact work counters, refusal or stall semantics.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.assay_vin_reference_intake()'::regprocedure))
  NOT IN('46552a973b83b262e0f54a318f76afd6','6e074614e978e7a1fa7c50ca57bbb889') THEN -- gitleaks:allow (definition fingerprints)
  RAISE EXCEPTION 'Retained reference assay body drifted; review installed owner';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.assay_vin_reference_intake() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $assay$
DECLARE reading jsonb;
BEGIN
 WITH work AS(SELECT count(*) FILTER(WHERE status='pending') pending,count(*) FILTER(WHERE status='claimed') claimed,
  count(*) FILTER(WHERE status='done') completed_work,count(DISTINCT observation_id) canonical_observations,
  count(*) FILTER(WHERE status='skipped') refused,count(*) FILTER(WHERE status='failed') failed,
  count(*) FILTER(WHERE status='skipped' AND next_attempt_at<=now()) refusal_rechecks_due,
  max(CASE WHEN status='done' THEN completed_at WHEN status='skipped' THEN next_attempt_at-interval '1 day'
   WHEN status IN('pending','failed') AND attempts>0 THEN next_attempt_at-interval '15 minutes' END) last_finished_at
  FROM public.vin_reference_intake_queue),
 current_receipts AS MATERIALIZED (SELECT q.revision_id,q.observation_id
  FROM public.vehicle_taxonomy_recompute_queue t JOIN public.vin_reference_intake_queue q
   ON q.revision_id=t.last_receipt_id AND q.status='done'),
 newest AS MATERIALIZED (SELECT * FROM current_receipts ORDER BY revision_id DESC LIMIT 100),
 oldest AS MATERIALIZED (SELECT * FROM current_receipts ORDER BY revision_id LIMIT 100),
 sampled AS MATERIALIZED (SELECT * FROM newest UNION SELECT * FROM oldest),
 current_failures AS (SELECT count(*) FILTER(WHERE
   NOT public.vin_reference_result_matches(revision_id,observation_id)
    OR NOT public.vin_reference_is_current(revision_id)) stale_current,
  count(*) current_receipts_sampled,(SELECT count(*) FROM current_receipts) current_receipts_total,
  (SELECT count(*) FROM current_receipts)>count(*) current_receipts_capped FROM sampled),
 s AS(SELECT vin_reference_keys_seen keys_seen,vin_reference_started_at started_at,
  vin_reference_last_seed_at last_seed_at,vin_reference_scan_completed_at scan_completed_at
  FROM public.vehicle_taxonomy_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN work.failed>0 THEN 'failed'
  WHEN (s.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+current_failures.stale_current>0)
   AND greatest(s.last_seed_at,work.last_finished_at,s.started_at)<statement_timestamp()-interval '30 minutes' THEN 'failed'
  WHEN s.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+current_failures.stale_current>0 OR current_failures.current_receipts_capped THEN 'partial' ELSE 'passed' END,
  'scope','accepted_retained_nhtsa_taxonomy_revisions_factory_reference_not_physical_configuration',
  'custody_scope','bounded_oldest_and_newest_current_reference_sample','current_sample_limit',200,
  'full_current_custody_verified',NOT current_failures.current_receipts_capped AND current_failures.stale_current=0,
  'as_of_at',statement_timestamp(),'state',to_jsonb(s),'counts',to_jsonb(work)-'last_finished_at'||to_jsonb(current_failures),
  'last_finished_at',work.last_finished_at,'model_calls',0,'provider_calls',0,'physical_configuration_verified',false,
  'refusal_policy','explicit_source_or_parent_unknowns_rechecked_daily') INTO reading FROM s,work,current_failures;
 IF reading IS NULL THEN RAISE EXCEPTION 'Reference operational singleton unavailable'; END IF;
 RETURN reading;
EXCEPTION WHEN query_canceled THEN
 RETURN jsonb_build_object('status','unavailable','reason','vin_reference_assay_read_failed','sqlstate',SQLSTATE,
  'as_of_at',statement_timestamp(),'current_sample_limit',200,'full_current_custody_verified',false);
WHEN OTHERS THEN
 RETURN jsonb_build_object('status','unavailable','reason','vin_reference_assay_read_failed','sqlstate',SQLSTATE,
  'as_of_at',statement_timestamp(),'current_sample_limit',200,'full_current_custody_verified',false);
END;
$assay$;
REVOKE ALL ON FUNCTION public.assay_vin_reference_intake() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assay_vin_reference_intake() TO service_role;
COMMENT ON FUNCTION public.assay_vin_reference_intake() IS 'Service-only operational health of retained factory reference intake: exact work/distinct canonical counters, original scan/progress clocks and unchanged failed/stall policy. Custody checks at most200deduplicated oldest/newest current receipts, independently reusing protected result/source validators. Count/sample/cap and full-current verification limits explicit; capped coverage is partial, never fleet passed. Read/cancel errors unavailable with SQLSTATE only. Same registered v_job_health consumer; no intake, replay, scheduling or data changes.';
NOTIFY pgrst,'reload schema';
COMMIT;
