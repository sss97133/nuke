-- Keep an unresolved owner statement visible without guessing a physical vehicle.
-- Existing private testimony writer, source attribution and supersession remain
-- authoritative. Raw unresolved statements assert no core relationship property.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.record_garage_owner_correction(
  p_user_id uuid, p_vehicle_id uuid, p_request_id uuid, p_correction jsonb,
  p_source_excerpt text, p_authorization_ref text DEFAULT NULL, p_supersedes uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  actor uuid := auth.uid();
  service boolean := coalesce(auth.role()='service_role',false);
  v_source_id uuid; v_property_id uuid; result uuid; payload jsonb;
  previous public.vehicle_observations%ROWTYPE;
  old public.vehicle_observations%ROWTYPE;
  claim jsonb; role_name text; key_name text; image_key uuid; domain text;
  subject_key text; unresolved_label text; resolving_source boolean:=false;
BEGIN
  IF p_user_id IS NULL OR p_request_id IS NULL
     OR (NOT service AND actor IS DISTINCT FROM p_user_id)
     OR (service AND NULLIF(btrim(p_authorization_ref),'') IS NULL) THEN
    RAISE EXCEPTION 'account authentication or explicit owner authorization required' USING ERRCODE='42501';
  END IF;
  IF NULLIF(btrim(p_source_excerpt),'') IS NULL OR length(p_source_excerpt)>4000 THEN
    RAISE EXCEPTION 'bounded exact source excerpt required' USING ERRCODE='23514';
  END IF;
  IF p_vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.merged_into_vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'identified terminal vehicle required' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_correction) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_correction))<>1 THEN
    RAISE EXCEPTION 'one relationship or cover correction required' USING ERRCODE='23514';
  END IF;
  IF p_correction ? 'unresolved_vehicle' THEN
    domain:='unresolved_vehicle'; claim:=p_correction->domain;
    unresolved_label:=claim->>'label';
    IF p_vehicle_id IS NOT NULL OR jsonb_typeof(claim) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(claim))<>2
      OR NOT claim ?& ARRAY['label','stated_roles']
      OR jsonb_typeof(claim->'label') IS DISTINCT FROM 'string'
      OR NULLIF(btrim(unresolved_label),'') IS NULL OR length(unresolved_label)>160
      OR jsonb_typeof(claim->'stated_roles') IS DISTINCT FROM 'array'
      OR jsonb_array_length(claim->'stated_roles')>8 THEN
      RAISE EXCEPTION 'bounded unresolved subject label and stated roles required' USING ERRCODE='23514';
    END IF;
    FOR role_name IN SELECT jsonb_array_elements_text(claim->'stated_roles') LOOP
      IF coalesce(role_name,'') NOT IN ('owner_current','owner_past','shared_interest','claimed_interest',
        'consignment','business_handling','sales_representative','transfer_pending') THEN
        RAISE EXCEPTION 'unknown stated role' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF jsonb_array_length(claim->'stated_roles')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(claim->'stated_roles')) THEN
      RAISE EXCEPTION 'duplicate stated role' USING ERRCODE='23514';
    END IF;
    -- This is raw source testimony. No core relationship property or physical
    -- vehicle is asserted until an explicitly identified successor is admitted.
  ELSIF p_correction ? 'relationship' THEN
    IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'identified vehicle required for a relationship property' USING ERRCODE='23514'; END IF;
    domain := 'relationship'; claim := p_correction->domain;
    SELECT p.id INTO v_property_id FROM public.observation_properties p
      WHERE p.property_key='garage_relationship' AND p.namespace='core' AND p.deprecated_at IS NULL;
    IF v_property_id IS NULL THEN RAISE EXCEPTION 'garage relationship property is not ratified' USING ERRCODE='23514'; END IF;
    IF jsonb_typeof(claim) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(claim))<>6
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(claim) k
         WHERE NOT k=ANY(ARRAY['roles','ownership_denied','title_status','disputed','start_date','end_date']))
       OR jsonb_typeof(claim->'roles') IS DISTINCT FROM 'array'
       OR jsonb_typeof(claim->'ownership_denied') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(claim->'disputed') IS DISTINCT FROM 'boolean'
       OR coalesce(claim->>'title_status','') NOT IN ('unknown','not_in_name','reported_in_name','transfer_pending') THEN
      RAISE EXCEPTION 'invalid relationship shape' USING ERRCODE='23514';
    END IF;
    FOR role_name IN SELECT jsonb_array_elements_text(claim->'roles') LOOP
      IF coalesce(role_name,'') NOT IN ('owner_current','owner_past','shared_interest','claimed_interest',
          'consignment','business_handling','sales_representative','transfer_pending') THEN
        RAISE EXCEPTION 'unknown relationship role' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF jsonb_array_length(claim->'roles')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(claim->'roles'))
       OR (claim->'roles' ? 'owner_current' AND claim->'roles' ? 'owner_past')
       OR ((claim->>'ownership_denied')::boolean AND claim->'roles' ?| ARRAY['owner_current','owner_past'])
       OR (claim->'roles' ? 'owner_current' AND (claim->>'title_status'='transfer_pending' OR (claim->>'disputed')::boolean)) THEN
      RAISE EXCEPTION 'conflicting relationship assertions' USING ERRCODE='23514';
    END IF;
    FOREACH key_name IN ARRAY ARRAY['start_date','end_date'] LOOP
      IF claim->key_name<>'null'::jsonb AND (jsonb_typeof(claim->key_name)<>'string'
          OR claim->>key_name !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT isfinite((claim->>key_name)::date)) THEN
        RAISE EXCEPTION 'tenure date must be an exact date or NULL' USING ERRCODE='23514';
      END IF;
    END LOOP;
    IF claim->>'start_date' IS NOT NULL AND claim->>'end_date' IS NOT NULL
       AND (claim->>'start_date')::date>(claim->>'end_date')::date THEN
      RAISE EXCEPTION 'tenure ends before it starts' USING ERRCODE='23514';
    END IF;
  ELSIF p_correction ? 'cover_image_id' THEN
    IF p_vehicle_id IS NULL THEN RAISE EXCEPTION 'identified vehicle required for a cover' USING ERRCODE='23514'; END IF;
    domain := 'cover_image_id'; image_key := (p_correction->>domain)::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id=image_key
        AND i.vehicle_id=p_vehicle_id AND i.user_id=p_user_id
        AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE AND i.is_document IS NOT TRUE
        AND coalesce(i.image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
        AND coalesce(i.vision_gate_status,'approved')='approved') THEN
      RAISE EXCEPTION 'cover must be this account same-vehicle eligible image' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION 'unknown correction domain' USING ERRCODE='23514';
  END IF;
  SELECT s.id INTO v_source_id FROM public.observation_sources s WHERE s.slug='owner-input';
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'owner input source unavailable'; END IF;
  payload := jsonb_build_object('claim_contract','garage_owner_correction_v1',
    'speaker_user_id',p_user_id,'correction',p_correction,'is_public',false,
    'intake_actor',CASE WHEN service THEN 'authorized_agent' ELSE 'account' END,
    'authorization_ref',p_authorization_ref,'supersedes',p_supersedes,
    'observed_at_basis','statement_receipt');
  IF unresolved_label IS NOT NULL THEN payload:=payload||jsonb_build_object('physical_identity','unresolved','property_admission','raw_source_only'); END IF;
  -- The existing image witness trigger creates the typed image FK.
  IF image_key IS NOT NULL THEN payload := payload||jsonb_build_object('image_id',image_key); END IF;
  IF v_property_id IS NOT NULL THEN payload := payload||jsonb_build_object('garage_relationship',claim); END IF;
  subject_key:=coalesce(p_vehicle_id::text,'unresolved:'||md5(unresolved_label));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||subject_key||':'||domain,0));
  SELECT * INTO old FROM public.vehicle_observations o
    WHERE o.content_hash=md5('garage-correction:'||p_user_id::text||':'||p_request_id::text)
      AND o.source_id=v_source_id LIMIT 1;
  IF FOUND THEN
    IF old.vehicle_id IS DISTINCT FROM p_vehicle_id OR old.structured_data IS DISTINCT FROM payload
       OR old.content_text IS DISTINCT FROM p_source_excerpt THEN
      RAISE EXCEPTION 'request key reused with different content' USING ERRCODE='23514';
    END IF;
    RETURN old.id;
  END IF;
  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO previous FROM public.vehicle_observations WHERE id=p_supersedes FOR UPDATE;
    resolving_source:=p_vehicle_id IS NOT NULL AND domain='relationship' AND previous.vehicle_id IS NULL
      AND coalesce(previous.structured_data->'correction' ? 'unresolved_vehicle',false);
    IF NOT FOUND OR (previous.vehicle_id IS DISTINCT FROM p_vehicle_id AND NOT resolving_source)
       OR previous.submitted_by_user_id IS DISTINCT FROM p_user_id
       OR previous.extraction_method<>'garage_owner_correction_v1' OR previous.is_superseded IS TRUE
       OR NOT (previous.structured_data->'correction' ? domain OR resolving_source) THEN
      RAISE EXCEPTION 'preceding correction missing, changed or belongs to another account/domain' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE
      (o.vehicle_id=p_vehicle_id OR (p_vehicle_id IS NULL AND o.vehicle_id IS NULL
        AND o.structured_data->'correction'->'unresolved_vehicle'->>'label'=unresolved_label))
      AND o.submitted_by_user_id=p_user_id AND o.extraction_method='garage_owner_correction_v1'
      AND o.is_superseded IS NOT TRUE AND o.structured_data->'correction' ? domain) THEN
    RAISE EXCEPTION 'name the preceding correction' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.vehicle_observations (
    vehicle_id,subject_type,subject_id,property_id,source_id,source_identifier,observed_at,
    content_text,content_hash,structured_data,submitted_by_user_id,observer_raw,extraction_method,kind,confidence,confidence_score
  ) VALUES (
    p_vehicle_id,'user',p_user_id,v_property_id,v_source_id,p_request_id::text,now(),p_source_excerpt,
    md5('garage-correction:'||p_user_id::text||':'||p_request_id::text),payload,p_user_id,
    jsonb_build_object('user_id',p_user_id,'intake_actor',payload->>'intake_actor'),
    'garage_owner_correction_v1',CASE WHEN image_key IS NULL THEN 'provenance'::public.observation_kind
      ELSE 'media'::public.observation_kind END,'high',0.95
  ) RETURNING id INTO result;
  IF p_supersedes IS NOT NULL THEN
    UPDATE public.vehicle_observations SET is_superseded=true,superseded_by=result,superseded_at=now(),
      lineage_chain=array_append(coalesce(lineage_chain,ARRAY[]::uuid[]),result) WHERE id=p_supersedes;
  END IF;
  RETURN result;
END $fn$;

-- Existing calls keep identified-only rows; updated readers explicitly opt in.
DROP FUNCTION public.get_my_garage_owner_corrections(uuid);
CREATE FUNCTION public.get_my_garage_owner_corrections(p_user_id uuid DEFAULT auth.uid(), p_include_unresolved boolean DEFAULT false)
RETURNS TABLE(id uuid,vehicle_id uuid,correction jsonb,observed_at timestamptz,cover_image_url text,source_excerpt text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT o.id,o.vehicle_id,o.structured_data->'correction',o.observed_at,i.image_url,CASE WHEN p_include_unresolved THEN o.content_text END
  FROM public.vehicle_observations o
  LEFT JOIN public.vehicle_images i ON i.id=(o.structured_data->>'image_id')::uuid AND i.vehicle_id=o.vehicle_id
    AND i.user_id=p_user_id AND coalesce(i.vision_gate_status,'approved')='approved'
    AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE AND i.is_document IS NOT TRUE
    AND coalesce(i.image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
  WHERE (auth.uid()=p_user_id OR auth.role()='service_role') AND o.submitted_by_user_id=p_user_id
    AND o.subject_type='user' AND o.subject_id=p_user_id
    AND o.extraction_method='garage_owner_correction_v1' AND o.is_superseded IS NOT TRUE
    AND (p_include_unresolved OR o.vehicle_id IS NOT NULL);
$fn$;
REVOKE ALL ON FUNCTION public.get_my_garage_owner_corrections(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_garage_owner_corrections(uuid,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admit_garage_owner_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'
     OR NEW.structured_data->>'claim_contract' IS DISTINCT FROM 'garage_owner_correction_v1'
     OR NEW.subject_type IS DISTINCT FROM 'user'
     OR NEW.subject_id IS DISTINCT FROM NEW.submitted_by_user_id
     OR NEW.structured_data->>'speaker_user_id' IS DISTINCT FROM NEW.submitted_by_user_id::text
     OR NEW.source_identifier IS NULL OR NEW.submitted_by_user_id IS NULL
     OR NEW.content_hash IS DISTINCT FROM md5('garage-correction:'||NEW.submitted_by_user_id::text||':'||NEW.source_identifier)
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id=NEW.source_id AND s.slug='owner-input') THEN
    RAISE EXCEPTION 'garage correction must use its typed owner-scoped writer' USING ERRCODE='23514';
  END IF;
  IF NEW.structured_data->'correction' ? 'unresolved_vehicle' AND
    (NEW.vehicle_id IS NOT NULL OR NEW.property_id IS NOT NULL OR NEW.kind::text IS DISTINCT FROM 'provenance'
      OR NEW.structured_data->>'physical_identity' IS DISTINCT FROM 'unresolved'
      OR NEW.structured_data->>'property_admission' IS DISTINCT FROM 'raw_source_only') THEN
    RAISE EXCEPTION 'unresolved garage statement must remain raw private source testimony' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.record_garage_owner_correction(uuid,uuid,uuid,jsonb,text,text,uuid) IS
 'Private sourced owner intake: identified relationship/cover corrections or raw unresolved subject testimony. Actual account or explicitly authorized service actor. Unresolved source asserts no physical vehicle, core property, title or asset value; named identified successor can supersede it.';
COMMENT ON FUNCTION public.get_my_garage_owner_corrections(uuid,boolean) IS
 'Private account projection. Identified-only by default for existing clients; explicit unresolved opt-in returns raw labelled statements and source excerpts, outside vehicle and asset totals.';
NOTIFY pgrst,'reload schema';
COMMIT;
