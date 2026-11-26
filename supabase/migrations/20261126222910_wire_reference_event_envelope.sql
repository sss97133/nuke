-- Extend existing documentary class-reference binding; no testimony rewrite.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.guard_wire_resistance_reference()'::regprocedure) NOT IN('31ec17cee1db25e2de18928188447ce7','5ebdb488ea083dfca3d01923b2e21a9b') THEN RAISE EXCEPTION 'Reviewed guard_wire_resistance_reference drifted'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.wire_resistance_observation_binding(public.vehicle_observations)'::regprocedure) NOT IN('fb405826dade0c245b79e055c7eadad9','d176864655a2f788b1c2b795b32cf424') THEN RAISE EXCEPTION 'Reviewed wire_resistance_observation_binding drifted'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_wire_resistance_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE q jsonb; old_reading boolean:=false; new_reading boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_reading:=OLD.extraction_method='supplied_wire_resistance_v1' OR EXISTS(
   SELECT FROM public.observation_properties p WHERE p.id=OLD.property_id AND p.property_key='wire_dc_resistance_per_length');
 END IF;
 new_reading:=NEW.extraction_method='supplied_wire_resistance_v1' OR EXISTS(
  SELECT FROM public.observation_properties p WHERE p.id=NEW.property_id AND p.property_key='wire_dc_resistance_per_length');
 IF NOT coalesce(old_reading,false) AND NOT coalesce(new_reading,false) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT FROM unnest(ARRAY['vehicle_id','subject_id','subject_type','subject_organization_id','source_observation_id',
    'component_subject_id','source_id','kind','observed_at','observed_at_basis','source_event_time_precision','source_event_at','source_event_date','source_vehicle_event_id','auction_event_id','source_url','source_identifier','content_hash','content_text',
    'structured_data','observer_raw','extraction_method','raw_source_ref','confidence','confidence_score','analysis_deferred','rank','property_id','descriptor_id',
    'citation_document_id','citation_secure_document_id','citation_page_number','citation_excerpt','agent_model']) k
   WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k) THEN
   RAISE EXCEPTION 'Wire reference testimony is immutable; admit a successor reading' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 q:=public.wire_resistance_observation_binding(NEW);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Wire resistance source binding refused: % (%)',q->>'reason',q->>'field' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.wire_resistance_observation_binding(p_observation public.vehicle_observations)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
 SET statement_timeout TO '10s'
AS $function$
DECLARE q jsonb; item record;
BEGIN
 -- Documentary class references have an analysis clock, never a physical event.
 IF p_observation.source_event_date IS NOT NULL OR p_observation.source_vehicle_event_id IS NOT NULL
  OR p_observation.auction_event_id IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'reason','class_reference_physical_event_unqualified');
 END IF;
 q:=public.qualify_wire_resistance_reference(p_observation.structured_data->'wire_reference_input');
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RETURN q; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(q->'recipe') LOOP
  IF to_jsonb(p_observation)->item.key IS DISTINCT FROM item.value THEN
   RETURN jsonb_build_object('ok',false,'reason','observation_field_mismatch','field',item.key);
  END IF;
 END LOOP;
 RETURN q;
END $function$;
-- CREATE OR REPLACE preserves the existing owner, ACL and trigger bindings.
COMMIT;
