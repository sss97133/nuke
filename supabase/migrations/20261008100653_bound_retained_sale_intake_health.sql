-- The live all-completed custody join exceeded its5s read budget near3900
-- admitted captures. Separate exact operational counters from bounded custody;
-- no writer, lease, schedule, source or native-sale promotion changes.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.assay_bat_sale_intake()'::regprocedure),'UTF8')),'base64')
  NOT IN('wlrrOm/estP1hrNr8jSpPbT5D1K33tU4i2p5/cWrOsc=','9YaLVWNSDwhnH/w41ajqIxtQAiiaY+zitfx1fuEeDus=') THEN
  RAISE EXCEPTION 'Protected sale assay owner changed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.assay_bat_sale_intake() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $assay$
DECLARE reading jsonb;
BEGIN
 WITH lane AS MATERIALIZED (
  SELECT id,status,next_attempt_at,completed_at,source_snapshot_id,source_vehicle_id,source_sale_observation_id
  FROM public.derivation_queue WHERE evidence_type='listing_page_snapshot' AND extractor_slug='bat-archived-sale-v1'
 ), work AS (
  SELECT count(*) FILTER(WHERE status='pending') pending,count(*) FILTER(WHERE status='claimed') claimed,
   count(*) FILTER(WHERE status='done') qualified,count(*) FILTER(WHERE status='skipped') refused,
   count(*) FILTER(WHERE status='failed') failed,
   count(*) FILTER(WHERE status='skipped' AND next_attempt_at<=now()) refusal_rechecks_due,
   count(DISTINCT source_sale_observation_id) FILTER(WHERE status='done') canonical_observations FROM lane
 ), completed AS MATERIALIZED (
  SELECT id,completed_at,source_snapshot_id,source_vehicle_id,source_sale_observation_id FROM lane WHERE status='done'
 ), oldest AS MATERIALIZED (SELECT * FROM completed ORDER BY completed_at,id LIMIT 100),
 newest AS MATERIALIZED (SELECT * FROM completed ORDER BY completed_at DESC,id DESC LIMIT 100),
 sampled AS MATERIALIZED (SELECT * FROM oldest UNION SELECT * FROM newest),
 custody AS (
  SELECT count(*) qualified_receipts_sampled,(SELECT count(*) FROM completed) qualified_receipts_total,
   (SELECT count(*) FROM completed)>count(*) qualified_receipts_capped,
   count(*) FILTER(WHERE o.id IS NULL OR o.is_superseded IS DISTINCT FROM false
    OR v.is_public IS DISTINCT FROM true OR v.deleted_at IS NOT NULL OR v.listing_kind IS NOT DISTINCT FROM 'non_vehicle_item'
    OR v.status IS NOT DISTINCT FROM 'merged' OR s.platform IS DISTINCT FROM 'bat' OR s.success IS DISTINCT FROM true
    OR s.http_status IS DISTINCT FROM 200 OR s.metadata->>'vehicle_matched' IS DISTINCT FROM 'true'
    OR lower(s.metadata->>'vehicle_id') IS DISTINCT FROM q.source_vehicle_id::text
    OR lower(s.html_sha256) IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,source_sha256}'
    OR s.metadata->>'parsed_at' IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,original_parsed_at}') stale_qualified
  FROM sampled q LEFT JOIN public.listing_page_snapshots s ON s.id=q.source_snapshot_id
   LEFT JOIN public.vehicles v ON v.id=q.source_vehicle_id LEFT JOIN public.vehicle_observations o ON o.id=q.source_sale_observation_id
 ), deferred_work AS (SELECT count(*) deferred FROM public.bat_sale_capture_deferrals),
 state AS (SELECT * FROM public.bat_sale_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN work.failed+custody.stale_qualified>0 THEN 'failed'
  WHEN (state.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+d.deferred>0)
   AND greatest(state.last_seed_at,state.last_finished_at,state.started_at)<statement_timestamp()-interval '15 minutes' THEN 'failed'
  WHEN state.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+d.deferred>0
   OR custody.qualified_receipts_capped THEN 'partial' ELSE 'passed' END,
  'scope','currently_supported_protected_bat_v1_capture_admission_not_native_promotion',
  'custody_scope','bounded_oldest_and_newest_completed_capture_sample','qualified_sample_limit',200,
  'full_qualified_custody_verified',NOT custody.qualified_receipts_capped AND custody.stale_qualified=0,
  'as_of_at',statement_timestamp(),'state',to_jsonb(state)-'snapshot_cursor',
  'counts',to_jsonb(work)||to_jsonb(custody)||to_jsonb(d),'model_calls',0,
  'refusal_policy','explicit_unknowns_rechecked_daily_no_native_correction')
 INTO reading FROM state,work,custody,deferred_work d;
 IF reading IS NULL THEN RAISE EXCEPTION 'Sale intake singleton unavailable';END IF;
 RETURN reading;
EXCEPTION WHEN query_canceled THEN
 RETURN jsonb_build_object('status','unavailable','reason','bat_sale_assay_read_failed','sqlstate',SQLSTATE,
  'as_of_at',statement_timestamp(),'qualified_sample_limit',200,'full_qualified_custody_verified',false);
WHEN OTHERS THEN
 RETURN jsonb_build_object('status','unavailable','reason','bat_sale_assay_read_failed','sqlstate',SQLSTATE,
  'as_of_at',statement_timestamp(),'qualified_sample_limit',200,'full_qualified_custody_verified',false);
END;
$assay$;
COMMENT ON FUNCTION public.assay_bat_sale_intake() IS 'Existing service-only protected-v1 retained capture health owner. Exact work/distinct canonical counters and original replay/progress clocks; custody checks at most200deduplicated oldest/newest completed work receipts using unchanged source/parent/SHA/parse-clock predicates. stale_qualified now describes that explicit sample; capped coverage is partial, never full-corpus passed. Read errors unavailable with SQLSTATE only. Existing v_job_health consumer and ACL retained. No intake, native promotion, replay, schedule or testimony changes.';
NOTIFY pgrst,'reload schema';
COMMIT;
