-- Queue rows can be reused for years. Their creation time is not the age of a
-- new revision. Retain the actual pending-work clock without backdating legacy
-- work whose first request time was never recorded.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='5s';
ALTER TABLE public.analysis_queue ADD COLUMN oldest_pending_at timestamptz,
 ADD COLUMN last_requested_at timestamptz;
COMMENT ON COLUMN public.analysis_queue.oldest_pending_at IS
 'Server time of the first request still owed in this pending episode. NULL on pre-clock unfinished work means unknown; never inferred from reusable row created_at.';
COMMENT ON COLUMN public.analysis_queue.last_requested_at IS
 'Server time of the latest enqueue revision. Does not reset the first unfinished request clock.';
DO $enqueue_clock$
DECLARE d text; cols text:='(vehicle_id,trigger_source,trigger_reasons,widget_slugs,status,priority,request_revision,analysis_deferred)';
 vals text:='1,coalesce(p_defer_analysis,false))'; tail text:='    completed_at = NULL';
BEGIN
 d:=pg_get_functiondef('public.enqueue_analysis_work(uuid,text,text[],text[],integer,boolean)'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64')<>'4WetSvQnXgWYHwAGwb5H1FKg5XpcwG0rq0ZnUI8p6xM='
  OR (length(d)-length(replace(d,cols,'')))/length(cols)<>1
  OR (length(d)-length(replace(d,vals,'')))/length(vals)<>1
  OR (length(d)-length(replace(d,tail,'')))/length(tail)<>1 THEN RAISE EXCEPTION 'Analysis enqueue owner drifted'; END IF;
 d:=replace(d,cols,'(vehicle_id,trigger_source,trigger_reasons,widget_slugs,status,priority,request_revision,analysis_deferred,oldest_pending_at,last_requested_at)');
 d:=replace(d,vals,'1,coalesce(p_defer_analysis,false),clock_timestamp(),clock_timestamp())');
 d:=replace(d,tail,tail||',
    oldest_pending_at=CASE WHEN q.request_revision>q.completed_revision THEN q.oldest_pending_at ELSE clock_timestamp() END,
    last_requested_at=clock_timestamp()');
 EXECUTE d;
END $enqueue_clock$;
CREATE INDEX analysis_queue_pending_health_idx ON public.analysis_queue(oldest_pending_at NULLS FIRST,id)
 WHERE request_revision>completed_revision;
DROP INDEX public.analysis_queue_revision_health_idx;
DO $health_guard$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.analysis_queue_health(uuid,integer)'::regprocedure),'UTF8')),'base64')
  <>'qU+pX/uz0+kM5KotOFKKdm6PFH8kFoCm415vPEN2bcg=' THEN RAISE EXCEPTION 'Queue health owner drifted'; END IF;
END $health_guard$;
CREATE OR REPLACE FUNCTION public.analysis_queue_health(p_vehicle_id uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='8s' AS $$
DECLARE answer jsonb; cap integer:=greatest(1,least(coalesce(p_limit,1000),2000));
BEGIN
 WITH selected AS MATERIALIZED(
  SELECT q.*,EXISTS(SELECT FROM public.vehicles v WHERE v.id=q.vehicle_id AND v.is_public=true AND v.deleted_at IS NULL
   AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') AS public_subject,
   EXISTS(SELECT FROM public.analysis_widgets w WHERE w.slug=ANY(q.widget_slugs) AND w.is_enabled AND w.compute_mode='inline_sql'
    AND w.retained_dispatch_method IN ('registered_source_state_v1','filed_photo_state_v1')) AS retained_method
  FROM public.analysis_queue q WHERE q.request_revision>q.completed_revision AND (p_vehicle_id IS NULL OR q.vehicle_id=p_vehicle_id)
  ORDER BY q.oldest_pending_at NULLS FIRST,q.id LIMIT cap+1
 ), sample AS(SELECT * FROM selected ORDER BY oldest_pending_at NULLS FIRST,id LIMIT cap)
 SELECT jsonb_build_object('scope','unfinished_revisioned_work','selected',count(*),'limit',cap,
  'has_more',(SELECT count(*)>cap FROM selected),'selection','oldest_pending_first_unknown_first','legacy_unenrolled','not_scanned',
  'age_basis','first_unfinished_revision_request','unknown_pending_clock',count(*) FILTER(WHERE oldest_pending_at IS NULL),
  'deferred',count(*) FILTER(WHERE analysis_deferred),'nonpublic_subjects',count(*) FILTER(WHERE NOT public_subject),
  'due_retained',count(*) FILTER(WHERE retained_method AND public_subject AND NOT analysis_deferred AND status='pending'
   AND coalesce(next_attempt_at,'-infinity')<=statement_timestamp()),
  'needs_other_compute_authority',count(*) FILTER(WHERE NOT retained_method AND NOT analysis_deferred),
  'failed',count(*) FILTER(WHERE status='failed'),'with_error',count(*) FILTER(WHERE last_error IS NOT NULL),
  'expired_leases',count(*) FILTER(WHERE status='processing' AND lease_expires_at<=statement_timestamp()),
  'oldest_selected_age_seconds',max(greatest(0,extract(epoch FROM statement_timestamp()-oldest_pending_at))) FILTER(WHERE oldest_pending_at IS NOT NULL),
  'p95_selected_age_seconds',percentile_cont(0.95) WITHIN GROUP(ORDER BY greatest(0,extract(epoch FROM statement_timestamp()-oldest_pending_at))) FILTER(WHERE oldest_pending_at IS NOT NULL),
  'observed_at',statement_timestamp()) INTO answer FROM sample;
 RETURN answer;
END $$;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES('analysis_queue','oldest_pending_at','analysis-engine-coordinator','First unfinished request clock; legacy unknown stays NULL.',true,'enqueue_analysis_work'),
 ('analysis_queue','last_requested_at','analysis-engine-coordinator','Latest server enqueue clock.',true,'enqueue_analysis_work')
ON CONFLICT(table_name,column_name) DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
