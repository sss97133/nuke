-- Resume only newly revisioned, non-deferred retained calculations through the
-- existing analysis owner. No sweep, source acquisition or paid widget starts.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='5s';
ALTER TABLE public.analysis_widgets ADD COLUMN retained_dispatch_method text;
ALTER TABLE public.analysis_queue ADD COLUMN retained_last_attempt_at timestamptz,
 ADD COLUMN claimed_retained_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.analysis_widgets.retained_dispatch_method IS
 'Reviewed zero-cost retained-state method for automatic analysis; NULL leaves work pending for its existing compute authority.';
COMMENT ON COLUMN public.analysis_queue.retained_last_attempt_at IS
 'Last retained worker attempt, for fair rotation of revisioned work at equal priority.';
COMMENT ON COLUMN public.analysis_queue.claimed_retained_only IS
 'Lease scope: only registered retained-state methods and unscored diagnostics may publish.';
UPDATE public.analysis_widgets SET retained_dispatch_method=CASE slug
 WHEN 'data-quality' THEN 'registered_source_state_v1' ELSE 'filed_photo_state_v1' END,
 trigger_on_observation_kinds=ARRAY(SELECT DISTINCT k FROM unnest(
  coalesce(trigger_on_observation_kinds,'{}')||ARRAY['*'])k ORDER BY k)
 WHERE slug IN ('data-quality','photo-coverage') AND compute_mode='inline_sql';
CREATE INDEX analysis_queue_retained_rotation_idx ON public.analysis_queue
 (priority DESC,retained_last_attempt_at NULLS FIRST,created_at,id)
 WHERE request_revision>completed_revision AND NOT analysis_deferred AND status='pending';
CREATE INDEX analysis_queue_revision_health_idx ON public.analysis_queue(created_at,id)
 WHERE request_revision>completed_revision;

CREATE FUNCTION public.claim_analysis_queue_batch(p_batch_size integer,p_worker_id text,p_vehicle_id uuid,p_retained_only boolean)
RETURNS SETOF public.analysis_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF length(coalesce(p_worker_id,'')) NOT BETWEEN 1 AND 150 OR p_retained_only IS NULL THEN
  RAISE EXCEPTION 'Analysis worker and scope required' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH candidates AS (
  SELECT q.id FROM public.analysis_queue q WHERE q.request_revision>q.completed_revision AND NOT q.analysis_deferred
   AND (p_vehicle_id IS NULL OR q.vehicle_id=p_vehicle_id)
   AND ((q.status='pending' AND coalesce(q.next_attempt_at,'-infinity')<=clock_timestamp())
    OR (q.status='processing' AND q.lease_expires_at<=clock_timestamp()))
   AND (NOT p_retained_only OR (EXISTS(SELECT FROM public.vehicles v WHERE v.id=q.vehicle_id AND v.is_public=true
    AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
    AND EXISTS(SELECT FROM public.analysis_widgets w WHERE w.is_enabled AND w.slug=ANY(q.widget_slugs)
     AND w.compute_mode='inline_sql' AND w.retained_dispatch_method IN ('registered_source_state_v1','filed_photo_state_v1'))))
  ORDER BY q.priority DESC,CASE WHEN p_retained_only THEN q.retained_last_attempt_at END NULLS FIRST,q.created_at,q.id
  LIMIT greatest(0,least(coalesce(p_batch_size,1),20)) FOR UPDATE SKIP LOCKED
 ) UPDATE public.analysis_queue q SET status='processing',worker_id=p_worker_id,claimed_at=clock_timestamp(),
  lease_expires_at=clock_timestamp()+interval '3 minutes',lease_token=gen_random_uuid(),claimed_revision=q.request_revision,
  claimed_retained_only=p_retained_only,retained_last_attempt_at=CASE WHEN p_retained_only THEN clock_timestamp() ELSE retained_last_attempt_at END,
  claimed_widget_slugs=CASE WHEN p_retained_only THEN ARRAY(SELECT w.slug FROM public.analysis_widgets w
   WHERE w.is_enabled AND w.slug=ANY(q.widget_slugs) AND w.compute_mode='inline_sql'
    AND w.retained_dispatch_method IN ('registered_source_state_v1','filed_photo_state_v1') ORDER BY w.slug) ELSE q.widget_slugs END,
  attempts=q.attempts+1 FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;
CREATE OR REPLACE FUNCTION public.claim_analysis_queue_batch(p_batch_size integer,p_worker_id text,p_vehicle_id uuid)
RETURNS SETOF public.analysis_queue LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT * FROM public.claim_analysis_queue_batch(p_batch_size,p_worker_id,p_vehicle_id,false)
$$;

CREATE FUNCTION public.compute_retained_analysis_widget(p_vehicle_id uuid,p_widget_slug text,p_method text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='8s' AS $$
DECLARE profile jsonb; details jsonb; sources jsonb; photos jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM public.analysis_widgets w WHERE w.slug=p_widget_slug AND w.is_enabled
  AND w.compute_mode='inline_sql' AND w.retained_dispatch_method=p_method)
  OR p_method NOT IN ('registered_source_state_v1','filed_photo_state_v1') THEN
  RAISE EXCEPTION 'Unregistered retained analysis method' USING ERRCODE='22023'; END IF;
 -- Recheck visibility at calculation time; claiming is not a privacy decision.
 IF NOT EXISTS(SELECT FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.is_public=true AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') THEN
  RAISE EXCEPTION 'Public retained subject unavailable' USING ERRCODE='42501'; END IF;
 IF p_method='registered_source_state_v1' THEN
  SELECT r INTO profile FROM public.get_vehicle_specs(ARRAY[p_vehicle_id],true,'{}'::jsonb)r;
  IF profile IS NULL OR profile->>'typed_claims_status'<>'current_registered_scope_read' THEN
   RAISE EXCEPTION 'Registered profile source reader unavailable'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('observation_id',c->'observation_id','property_key',c->'property_key',
   'source_id',c->'source_id','evidence_state',c->'evidence_state')),'[]') INTO sources
   FROM jsonb_array_elements(profile->'typed_claims')c;
  details:=jsonb_build_object('measure','current_registered_source_page','claims_in_page',jsonb_array_length(sources),
   'claim_page',profile->'claim_page','unresolved_properties',profile->'unresolved_properties',
   'complete_vehicle_model',false,'reader','get_vehicle_specs:source_claims_v1');
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('image_id',i.id) ORDER BY i.id),'[]') INTO photos FROM(
   SELECT i.id FROM public.vehicle_images i WHERE i.vehicle_id=p_vehicle_id AND i.is_sensitive IS NOT TRUE
    AND i.is_document IS NOT TRUE AND i.doc_flag IS NOT TRUE AND public.vehicle_image_gallery_eligible(i)
    ORDER BY i.id LIMIT 201)i;
  sources:=coalesce((SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(photos) WITH ORDINALITY x(v,n) WHERE n<=200),'[]');
  details:=jsonb_build_object('measure','filed_visible_image_rows','images_in_page',jsonb_array_length(sources),
   'has_more',jsonb_array_length(photos)>200,'complete_vehicle_model',false,
   'filing_correctness','not_assessed','capture_coverage','unknown','condition','not_assessed');
 END IF;
 RETURN jsonb_build_object('method_revision',p_method,'assessment_status','not_assessed','details',details,
  'evidence',jsonb_build_object('record_ids',sources,'resolution','read_current_source_before_asserting'),
  'score',NULL,'severity','info','reasons',jsonb_build_array('Retained source state; counts do not establish correctness, condition or readiness.'));
END $$;

-- A lease for retained diagnostics cannot be used to publish a paid/class/score
-- result. Existing revision and nonce fencing remains the publication owner.
DO $publication$
DECLARE d text; anchor text:='  s := jsonb_populate_record(NULL::public.analysis_signals,p_signal);';
BEGIN
 d:=pg_get_functiondef('public.record_analysis_queue_signal(uuid,text,bigint,uuid,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64')<>'kR2KZTIKGBKwjf/Ib4ICBjfAms27EIlQd82LVIEj6SA='
  OR (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Analysis publication owner drifted'; END IF;
 d:=replace(d,anchor,$guard$
 IF q.claimed_retained_only AND (p_signal->>'score' IS NOT NULL
  OR p_signal#>>'{value_json,assessment_status}' IS DISTINCT FROM 'not_assessed'
  OR NOT EXISTS(SELECT FROM public.analysis_widgets w WHERE w.slug=p_signal->>'widget_slug' AND w.is_enabled
    AND w.compute_mode='inline_sql' AND w.retained_dispatch_method=p_signal#>>'{value_json,method_revision}'
    AND w.retained_dispatch_method IN ('registered_source_state_v1','filed_photo_state_v1'))
  OR NOT EXISTS(SELECT FROM public.vehicles v WHERE v.id=q.vehicle_id AND v.is_public=true AND v.deleted_at IS NULL
   AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')) THEN
  RAISE EXCEPTION 'Result outside retained lease authority' USING ERRCODE='42501'; END IF;
$guard$||anchor);
 EXECUTE d;
END $publication$;

-- Receipt/state diagnostics and failed runs are not scored assessments. This
-- consumer must not award market readiness merely because a row was published.
DO $readiness$
DECLARE d text; anchor text:=$a$AND NOT (score IS NULL AND value_json ? 'error');$a$;
BEGIN
 d:=pg_get_functiondef('public.compute_auction_readiness(uuid)'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64')<>'wtVidNZOkYbYeuanBKTKH/Dwgu2mU8L80sZ5cs2Ef/Y='
  OR (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Readiness signal consumer drifted'; END IF;
 d:=replace(d,anchor,$a$AND score IS NOT NULL AND NOT(value_json ? 'error')
    AND coalesce(value_json->>'assessment_status','') NOT IN ('not_assessed','unresolved','widget_not_configured');$a$);
 EXECUTE d;
END $readiness$;

-- Withdrawals and fresh filing/privacy changes invalidate the same retained
-- calculation owners. No old observation/image is scanned or enrolled here.
CREATE FUNCTION public.invalidate_retained_analysis_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[]; v uuid;
BEGIN
 IF TG_TABLE_NAME='vehicle_observations' THEN ids:=ARRAY[NEW.vehicle_id];
 ELSE ids:=CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.vehicle_id]
  WHEN TG_OP='DELETE' THEN ARRAY[OLD.vehicle_id] ELSE ARRAY[OLD.vehicle_id,NEW.vehicle_id] END; END IF;
 FOR v IN SELECT DISTINCT x FROM unnest(ids)x WHERE x IS NOT NULL LOOP
  UPDATE public.analysis_signals SET stale_at=clock_timestamp() WHERE vehicle_id=v AND widget_slug IN ('data-quality','photo-coverage');
  PERFORM public.enqueue_analysis_work(v,'retained_source_change',ARRAY[TG_TABLE_NAME||':'||TG_OP],ARRAY['data-quality','photo-coverage'],60,false);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER observation_retained_analysis_withdrawal AFTER UPDATE OF is_superseded ON public.vehicle_observations
 FOR EACH ROW WHEN(OLD.is_superseded IS DISTINCT FROM NEW.is_superseded) EXECUTE FUNCTION public.invalidate_retained_analysis_sources();
CREATE TRIGGER image_retained_analysis_change AFTER INSERT OR DELETE OR UPDATE OF vehicle_id,is_sensitive,is_document,doc_flag,is_duplicate,is_superseded,image_vehicle_match_status,vision_gate_status,image_url,source,is_external,is_approved,approval_status,verification_status,redaction_level,user_id,exif_data ON public.vehicle_images
 FOR EACH ROW EXECUTE FUNCTION public.invalidate_retained_analysis_sources();
CREATE FUNCTION public.analysis_queue_health(p_vehicle_id uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='8s' AS $$
DECLARE answer jsonb; cap integer:=greatest(1,least(coalesce(p_limit,1000),2000));
BEGIN
 WITH selected AS MATERIALIZED(
  SELECT q.*,EXISTS(SELECT FROM public.vehicles v WHERE v.id=q.vehicle_id AND v.is_public=true AND v.deleted_at IS NULL
   AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') AS public_subject,
   EXISTS(SELECT FROM public.analysis_widgets w WHERE w.slug=ANY(q.widget_slugs) AND w.is_enabled AND w.compute_mode='inline_sql'
    AND w.retained_dispatch_method IN ('registered_source_state_v1','filed_photo_state_v1')) AS retained_method
  FROM public.analysis_queue q WHERE q.request_revision>q.completed_revision AND (p_vehicle_id IS NULL OR q.vehicle_id=p_vehicle_id)
  ORDER BY q.created_at,q.id LIMIT cap+1
 ), sample AS(SELECT * FROM selected ORDER BY created_at,id LIMIT cap)
 SELECT jsonb_build_object('scope','unfinished_revisioned_work','selected',count(*),'limit',cap,
  'has_more',(SELECT count(*)>cap FROM selected),'selection','oldest_created_first','legacy_unenrolled','not_scanned',
  'deferred',count(*) FILTER(WHERE analysis_deferred),'nonpublic_subjects',count(*) FILTER(WHERE NOT public_subject),
  'due_retained',count(*) FILTER(WHERE retained_method AND public_subject AND NOT analysis_deferred AND status='pending'
   AND coalesce(next_attempt_at,'-infinity')<=statement_timestamp()),
  'needs_other_compute_authority',count(*) FILTER(WHERE NOT retained_method AND NOT analysis_deferred),
  'failed',count(*) FILTER(WHERE status='failed'),'with_error',count(*) FILTER(WHERE last_error IS NOT NULL),
  'expired_leases',count(*) FILTER(WHERE status='processing' AND lease_expires_at<=statement_timestamp()),
  'oldest_selected_age_seconds',coalesce(max(greatest(0,extract(epoch FROM statement_timestamp()-created_at))),0),
  'p95_selected_age_seconds',percentile_cont(0.95) WITHIN GROUP(ORDER BY greatest(0,extract(epoch FROM statement_timestamp()-created_at))),
  'observed_at',statement_timestamp()) INTO answer FROM sample;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_queue_batch(integer,text,uuid,boolean),
 public.compute_retained_analysis_widget(uuid,text,text),public.invalidate_retained_analysis_sources(),
 public.analysis_queue_health(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_queue_batch(integer,text,uuid,boolean),
 public.compute_retained_analysis_widget(uuid,text,text),public.analysis_queue_health(uuid,integer) TO service_role;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES('analysis_widgets','retained_dispatch_method','analysis-engine-coordinator','Reviewed zero-cost retained calculation method; NULL leaves work pending.',true,'reviewed migration'),
 ('analysis_queue','retained_last_attempt_at','analysis-engine-coordinator','Retained attempt fairness clock.',true,'claim_analysis_queue_batch'),
 ('analysis_queue','claimed_retained_only','analysis-engine-coordinator','Fenced retained-only lease scope.',true,'claim_analysis_queue_batch')
ON CONFLICT(table_name,column_name) DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
