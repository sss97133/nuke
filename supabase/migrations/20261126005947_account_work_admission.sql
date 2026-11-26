-- Receipt: docs/wiring/receipts/2026-11-26_account-work-admission.md
-- Created with the installed migration CLI; ordered before its stock/build consumers.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

CREATE FUNCTION public.account_work_profile_writer(p_profile text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_profile
  WHEN 'parts_arrival_sign_v1' THEN 'public.record_parts_arrival(uuid,jsonb)'
  WHEN 'parts_inspection_sign_v1' THEN 'public.record_parts_inspection(uuid,uuid,numeric,numeric,timestamp with time zone,uuid)'
  WHEN 'parts_stock_sign_v1' THEN 'public.record_parts_stock_event(uuid,uuid,text,numeric,timestamp with time zone)'
  WHEN 'harness_build_operation_v1' THEN 'public.record_harness_build_operation(uuid,uuid,uuid,text,text,numeric,text,timestamp with time zone,text,text,uuid)'
  WHEN 'harness_build_operation_v2' THEN 'public.record_harness_build_operation(uuid,uuid,jsonb)'
 END
$$;

CREATE FUNCTION public.account_work_entry_check(p_profile text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE signature text:=public.account_work_profile_writer(p_profile); target oid; owner_name name;
 frame text; frames text[]; ctx text; allowed_name text; last_named text; frame_name text; frame_signature text; saw_core boolean=false;
BEGIN
 IF signature IS NULL OR auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
 OR auth.jwt()->>'is_anonymous' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'A declared physical-work profile and nonanonymous account are required' USING ERRCODE='42501'; END IF;
 target:=to_regprocedure(signature);
 SELECT pg_get_userbyid(p.proowner) INTO owner_name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid=target AND n.nspname='public' AND p.prosecdef;
 IF owner_name IS NULL OR current_user IS DISTINCT FROM owner_name THEN
  RAISE EXCEPTION 'Physical work must enter through its declared domain writer' USING ERRCODE='42501'; END IF;
 allowed_name:=split_part(split_part(signature,'.',2),'(',1);
 GET DIAGNOSTICS ctx=PG_CONTEXT;
 frames:=regexp_split_to_array(ctx,E'\n');
 FOREACH frame IN ARRAY frames LOOP
  IF frame ~ '^SQL function ' THEN
   RAISE EXCEPTION 'Physical work cannot be signed through an undeclared SQL wrapper' USING ERRCODE='42501'; END IF;
  frame_name:=substring(frame from '^PL/pgSQL function (?:public\.)?([a-z_][a-z_0-9]*)\(');
  IF frame_name IS NOT NULL THEN
   frame_signature:=substring(frame from '^PL/pgSQL function ([^(]+\([^)]*\))');
   IF frame_name=allowed_name AND to_regprocedure(frame_signature)::oid IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'Physical work requires the exact declared writer signature' USING ERRCODE='42501'; END IF;
   IF frame_name='record_account_work' THEN saw_core:=true; END IF;
   IF frame_name NOT IN('account_work_entry_check','account_work_source_guard','record_account_work','parts_stock_sign',allowed_name)
   THEN RAISE EXCEPTION 'Physical work cannot be signed through an undeclared wrapper' USING ERRCODE='42501'; END IF;
   last_named:=frame_name;
  ELSIF frame ~ '^PL/pgSQL function inline_code_block' THEN
   -- Anonymous SQL blocks are possible only for the database session owner in
   -- disposable contracts/admin SQL; API wrappers still have named frames.
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN
    RAISE EXCEPTION 'Physical work requires its domain API entry point' USING ERRCODE='42501'; END IF;
  END IF;
 END LOOP;
 IF NOT saw_core OR last_named IS DISTINCT FROM allowed_name THEN
  RAISE EXCEPTION 'Physical work requires the declared caller and active source admission' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION public.account_work_claim_shape(p_profile text,p_subject uuid,p_vehicle uuid,p_request uuid,
 p_at timestamptz,p_basis text,p_claim jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF jsonb_typeof(p_claim) IS DISTINCT FROM 'object' OR p_subject IS NULL OR p_request IS NULL
 OR p_at IS NULL OR NOT isfinite(p_at) OR p_basis IS NULL OR p_basis NOT IN('reported_time','recorded_now') THEN RETURN false; END IF;
 IF p_profile='parts_arrival_sign_v1' THEN
  RETURN p_vehicle IS NULL AND p_basis='reported_time' AND p_claim->>'profile'=p_profile AND p_claim->>'lot_id'=p_subject::text
   AND (p_claim->>'received_at')::timestamptz=p_at AND p_claim->'receipt_line_is_this_arrival'='true'::jsonb
   AND p_claim->>'quantity_basis'='direct_count_or_measurement' AND p_claim->>'inspection'='not_implied'
   AND p_claim-ARRAY['profile','lot_id','reception_id','reception_link_state','receipt_item_id','catalog_part_id','quantity','unit','received_at',
    'receipt_line_fingerprint','catalog_identity_fingerprint','package_property_observation_id','quantity_basis','inspection','receipt_line_is_this_arrival']='{}'::jsonb;
 ELSIF p_profile IN('parts_inspection_sign_v1','parts_stock_sign_v1') THEN
  RETURN p_vehicle IS NULL AND p_basis='reported_time' AND p_claim->>'profile'=p_profile AND p_claim->>'lot_id'=p_subject::text
   AND (p_claim->>'performed_at')::timestamptz=p_at
   AND ((p_profile='parts_inspection_sign_v1' AND p_claim->>'event_kind'='inspection')
    OR (p_profile='parts_stock_sign_v1' AND p_claim->>'event_kind' IN('pull','release')))
   AND p_claim-ARRAY['profile','lot_id','allocation_id','event_kind','previous_inspection_id','accepted_quantity','basis_inspection_id','rejected_quantity','quantity','performed_at']='{}'::jsonb;
 ELSIF p_profile='harness_build_operation_v1' THEN
  RETURN p_vehicle=p_subject AND p_claim->>'contract'=p_profile AND p_claim->>'domain'='wiring'
   AND p_claim->>'request_id'=p_request::text AND p_claim->>'performed_at_basis'=p_basis
   AND p_claim->>'event_kind' IN('prototype_cut','route_measurement')
   AND p_claim-ARRAY['domain','contract','request_id','event_kind','segment_id','reported_length_ft','measurement_method','performed_at_basis','reported_input_fingerprint','reported_stock_pull_observation_id']='{}'::jsonb;
 ELSIF p_profile='harness_build_operation_v2' THEN
  RETURN p_vehicle=p_subject AND p_claim->>'contract'=p_profile AND p_claim->>'domain'='wiring'
   AND p_claim->>'request_id'=p_request::text AND jsonb_typeof(p_claim->'operation')='object'
   AND jsonb_typeof(p_claim->'projection')='object'
   AND p_claim-ARRAY['domain','contract','request_id','operation','projection']='{}'::jsonb;
 END IF;
 RETURN false;
END $$;

CREATE FUNCTION public.record_account_work(p_observation_id uuid,p_profile text,p_request_id uuid,p_subject_id uuid,
 p_vehicle_id uuid,p_performed_at timestamptz,p_time_basis text,p_statement text,p_claim jsonb,p_request_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); source_id uuid; previous_capability text; stock boolean:=p_profile LIKE 'parts_%';
BEGIN
 PERFORM public.account_work_entry_check(p_profile);
 IF p_observation_id IS NULL OR p_performed_at>statement_timestamp()
 OR (p_time_basis='recorded_now' AND p_performed_at IS DISTINCT FROM statement_timestamp())
 OR nullif(btrim(p_statement),'') IS NULL OR length(p_statement)>20000
 OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
 OR public.account_work_claim_shape(p_profile,p_subject_id,p_vehicle_id,p_request_id,p_performed_at,p_time_basis,p_claim) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Physical-work source shape or event clock is invalid' USING ERRCODE='23514'; END IF;
 SELECT id INTO source_id FROM public.observation_sources WHERE slug='owner-input';
 IF source_id IS NULL THEN RAISE EXCEPTION 'Owner-input source unavailable'; END IF;
 previous_capability:=current_setting('nuke.account_work_admission',true);
 PERFORM set_config('nuke.account_work_admission',p_observation_id::text,true);
 INSERT INTO public.vehicle_observations(id,source_id,source_identifier,vehicle_id,subject_type,subject_id,kind,
  observed_at,ingested_at,observed_at_basis,source_event_at,source_event_time_precision,content_text,content_hash,
  structured_data,submitted_by_user_id,observer_raw,extraction_method,confidence_score,analysis_deferred)
 VALUES(p_observation_id,source_id,CASE WHEN stock THEN p_profile||':'||actor::text||':'||p_request_id::text
  ELSE 'harness-build-operation:'||actor::text||':'||p_request_id::text END,p_vehicle_id,CASE WHEN stock THEN 'asset' ELSE 'vehicle' END,p_subject_id,'work_record',
  p_performed_at,statement_timestamp(),CASE WHEN p_time_basis='recorded_now' THEN 'source_capture_time' ELSE 'event_time' END,
  CASE WHEN p_time_basis='reported_time' THEN p_performed_at END,CASE WHEN p_time_basis='reported_time' THEN 'exact' ELSE 'unknown' END,
  p_statement,p_request_hash,p_claim,actor,jsonb_build_object('user_id',actor,'intake_actor','account'),p_profile,NULL,true);
 PERFORM set_config('nuke.account_work_admission',coalesce(previous_capability,''),true);
 RETURN p_observation_id;
END $$;

CREATE FUNCTION public.account_work_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE profile text:=NEW.extraction_method; request_id uuid; basis text; stock boolean;
BEGIN
 PERFORM public.account_work_entry_check(profile);
 stock:=profile LIKE 'parts_%';
 request_id:=CASE WHEN stock THEN split_part(NEW.source_identifier,':',3)::uuid ELSE (NEW.structured_data->>'request_id')::uuid END;
 basis:=CASE WHEN stock THEN 'reported_time' WHEN profile='harness_build_operation_v1' THEN NEW.structured_data->>'performed_at_basis'
  ELSE NEW.structured_data#>>'{projection,performed_at_basis}' END;
 IF nullif(current_setting('nuke.account_work_admission',true),'') IS DISTINCT FROM NEW.id::text
 OR NEW.submitted_by_user_id IS DISTINCT FROM auth.uid() OR NEW.kind::text IS DISTINCT FROM 'work_record'
 OR NEW.subject_type IS DISTINCT FROM (CASE WHEN stock THEN 'asset' ELSE 'vehicle' END)
 OR NEW.ingested_at IS DISTINCT FROM statement_timestamp() OR NEW.observed_at>NEW.ingested_at
 OR NEW.confidence_score IS NOT NULL OR NEW.analysis_deferred IS DISTINCT FROM true
 OR NEW.observer_raw IS DISTINCT FROM jsonb_build_object('user_id',auth.uid(),'intake_actor','account')
 OR NEW.is_superseded IS DISTINCT FROM false OR NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL
 OR NEW.source_identifier IS DISTINCT FROM (CASE WHEN stock THEN profile||':'||auth.uid()::text||':'||request_id::text
  ELSE 'harness-build-operation:'||auth.uid()::text||':'||request_id::text END)
 OR NEW.observed_at_basis IS DISTINCT FROM (CASE WHEN basis='recorded_now' THEN 'source_capture_time' ELSE 'event_time' END)
 OR NEW.source_event_at IS DISTINCT FROM (CASE WHEN basis='reported_time' THEN NEW.observed_at END)
 OR NEW.source_event_time_precision IS DISTINCT FROM (CASE WHEN basis='reported_time' THEN 'exact' ELSE 'unknown' END)
 OR NOT EXISTS(SELECT 1 FROM public.observation_sources s WHERE s.id=NEW.source_id AND s.slug='owner-input')
 OR public.account_work_claim_shape(profile,NEW.subject_id,NEW.vehicle_id,request_id,NEW.observed_at,basis,NEW.structured_data) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Physical-work source requires canonical account admission' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_work_source_admission BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
 WHEN(NEW.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1','harness_build_operation_v1','harness_build_operation_v2')
 OR NEW.structured_data->>'profile' IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR NEW.structured_data->>'contract' IN('harness_build_operation_v1','harness_build_operation_v2'))
 EXECUTE FUNCTION public.account_work_source_guard();

CREATE FUNCTION public.guard_account_work_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account-work sources are retained; corrections supersede' USING ERRCODE='23514'; END IF;
 IF public.account_work_profile_writer(OLD.extraction_method) IS NULL
 OR (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
 OR NEW.is_superseded IS NULL OR (OLD.is_superseded IS TRUE AND NEW.is_superseded IS NOT TRUE)
 OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)
 OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
 OR (NEW.is_superseded IS FALSE AND (NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL))
 OR (NEW.is_superseded IS TRUE AND (NEW.superseded_at IS NULL OR NOT isfinite(NEW.superseded_at)))
 THEN RAISE EXCEPTION 'Account-work source and attribution are immutable; retire coherently' USING ERRCODE='23514'; END IF;
 IF NEW.superseded_by IS NOT NULL AND (NEW.superseded_by=OLD.id OR NOT EXISTS(
  SELECT 1 FROM public.vehicle_observations nxt WHERE nxt.id=NEW.superseded_by
  AND nxt.submitted_by_user_id=OLD.submitted_by_user_id AND nxt.subject_type=OLD.subject_type
  AND nxt.subject_id=OLD.subject_id AND nxt.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
  AND nxt.extraction_method=OLD.extraction_method)) THEN
  RAISE EXCEPTION 'Account-work successor must retain its attributed subject and profile' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_work_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
 WHEN(OLD.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1','harness_build_operation_v1','harness_build_operation_v2')
 OR NEW.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1','harness_build_operation_v1','harness_build_operation_v2')
 OR OLD.structured_data->>'profile' IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR NEW.structured_data->>'profile' IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR OLD.structured_data->>'contract' IN('harness_build_operation_v1','harness_build_operation_v2')
 OR NEW.structured_data->>'contract' IN('harness_build_operation_v1','harness_build_operation_v2'))
 EXECUTE FUNCTION public.guard_account_work_history();
CREATE TRIGGER account_work_source_delete BEFORE DELETE ON public.vehicle_observations FOR EACH ROW
 WHEN(OLD.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1','harness_build_operation_v1','harness_build_operation_v2')
 OR OLD.structured_data->>'profile' IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR OLD.structured_data->>'contract' IN('harness_build_operation_v1','harness_build_operation_v2'))
 EXECUTE FUNCTION public.guard_account_work_history();
REVOKE ALL ON FUNCTION public.account_work_profile_writer(text),public.account_work_entry_check(text),
 public.account_work_claim_shape(text,uuid,uuid,uuid,timestamptz,text,jsonb),
 public.record_account_work(uuid,text,uuid,uuid,uuid,timestamptz,text,text,jsonb,text),public.account_work_source_guard(),public.guard_account_work_history()
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.record_account_work(uuid,text,uuid,uuid,uuid,timestamptz,text,text,jsonb,text) IS 'Declared private canonical account-work source admission. Five closed stock/build profiles and exact domain-writer signatures only; authenticated nonanonymous actor, fixed source identity, event/receipt clocks, NULL confidence, one-row transaction capability. Caller commits its paired immutable projection atomically. No generic ingestion, owner-decision or unsigned-statement promotion.';
COMMIT;
