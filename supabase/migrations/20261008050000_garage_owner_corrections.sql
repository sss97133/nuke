-- Account-scoped garage corrections. Existing observation log and typed vehicle,
-- account and image keys; no garage table and no legacy testimony overwritten.
-- The relationship writer remains closed until the proposal is human-ratified.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.schema_proposals (
  proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope,
  backward_compatibility, status
) VALUES (
  'codex-garage-corrections', 'add_property',
  jsonb_build_object(
    'property_key','garage_relationship','label','Account-stated vehicle relationship',
    'data_type','jsonb','category','provenance','namespace_request','core',
    'cardinality','multi','discriminator_key','speaker_user_id',
    'applies_to_kinds',jsonb_build_array('provenance'),
    'expected_source_categories',jsonb_build_array('owner'),
    'description','Private account-stated roles and title qualifications for an identified vehicle. '
      'Never title verification, access authority, performed work inferred from photographs, or an organization ownership claim.',
    'contract','garage_owner_correction_v1'),
  jsonb_build_array(jsonb_build_object('motivation',
    'The owner requested corrections distinguishing personal ownership, consignment, business handling, sales representation, '
    'disputed interest, pending transfer and an explicit denial of ownership. Existing scalar owner properties cannot represent those distinctions.')),
  jsonb_build_object('legacy_testimony_rows_changed',0,'target','private account garage'),
  jsonb_build_object('existing_data_behavior','preserved_unchanged',
    'rollback_plan','Close the admission gate and revert the account reader within seven days; appended testimony remains.',
    'read_api_impact','Account-scoped projection. Excluded from public canonical properties; no title or access grants.'),
  'open'
);

CREATE FUNCTION public.record_garage_owner_correction(
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
BEGIN
  IF p_user_id IS NULL OR p_vehicle_id IS NULL OR p_request_id IS NULL
     OR (NOT service AND actor IS DISTINCT FROM p_user_id)
     OR (service AND NULLIF(btrim(p_authorization_ref),'') IS NULL) THEN
    RAISE EXCEPTION 'account authentication or explicit owner authorization required' USING ERRCODE='42501';
  END IF;
  IF NULLIF(btrim(p_source_excerpt),'') IS NULL OR length(p_source_excerpt)>4000 THEN
    RAISE EXCEPTION 'bounded exact source excerpt required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.merged_into_vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'identified terminal vehicle required' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_correction) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_correction))<>1 THEN
    RAISE EXCEPTION 'one relationship or cover correction required' USING ERRCODE='23514';
  END IF;
  IF p_correction ? 'relationship' THEN
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
  -- The existing image witness trigger creates the typed image FK.
  IF image_key IS NOT NULL THEN payload := payload||jsonb_build_object('image_id',image_key); END IF;
  IF v_property_id IS NOT NULL THEN payload := payload||jsonb_build_object('garage_relationship',claim); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_vehicle_id::text||':'||domain,0));
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
    IF NOT FOUND OR previous.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR previous.submitted_by_user_id IS DISTINCT FROM p_user_id
       OR previous.extraction_method<>'garage_owner_correction_v1' OR previous.is_superseded IS TRUE
       OR NOT previous.structured_data->'correction' ? domain THEN
      RAISE EXCEPTION 'preceding correction missing, changed or belongs to another account/domain' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.vehicle_id=p_vehicle_id
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
REVOKE ALL ON FUNCTION public.record_garage_owner_correction(uuid,uuid,uuid,jsonb,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_garage_owner_correction(uuid,uuid,uuid,jsonb,text,text,uuid) TO authenticated, service_role;

CREATE FUNCTION public.get_my_garage_owner_corrections(p_user_id uuid DEFAULT auth.uid())
RETURNS TABLE(id uuid,vehicle_id uuid,correction jsonb,observed_at timestamptz,cover_image_url text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT o.id,o.vehicle_id,o.structured_data->'correction',o.observed_at,i.image_url
  FROM public.vehicle_observations o
  LEFT JOIN public.vehicle_images i ON i.id=(o.structured_data->>'image_id')::uuid AND i.vehicle_id=o.vehicle_id
    AND i.user_id=p_user_id AND coalesce(i.vision_gate_status,'approved')='approved'
    AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE AND i.is_document IS NOT TRUE
    AND coalesce(i.image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
  WHERE (auth.uid()=p_user_id OR auth.role()='service_role') AND o.submitted_by_user_id=p_user_id
    AND o.subject_type='user' AND o.subject_id=p_user_id
    AND o.extraction_method='garage_owner_correction_v1' AND o.is_superseded IS NOT TRUE;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_garage_owner_corrections(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_garage_owner_corrections(uuid) TO authenticated, service_role;

CREATE POLICY garage_correction_private_read ON public.vehicle_observations AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  extraction_method IS DISTINCT FROM 'garage_owner_correction_v1' OR submitted_by_user_id=auth.uid());
CREATE POLICY garage_correction_speaker_read ON public.vehicle_observations
FOR SELECT TO authenticated USING (extraction_method='garage_owner_correction_v1'
  AND subject_type='user' AND subject_id=auth.uid() AND submitted_by_user_id=auth.uid());

CREATE FUNCTION public.guard_garage_owner_correction_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF OLD.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'
     OR (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain','is_processed','processing_metadata'])
       IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain','is_processed','processing_metadata']) THEN
    RAISE EXCEPTION 'garage correction is immutable; append a successor' USING ERRCODE='23514';
  END IF;
  IF OLD.is_superseded IS TRUE AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'garage correction already superseded' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_guard_garage_owner_correction_update BEFORE UPDATE ON public.vehicle_observations
FOR EACH ROW WHEN (OLD.extraction_method='garage_owner_correction_v1' OR NEW.extraction_method='garage_owner_correction_v1')
EXECUTE FUNCTION public.guard_garage_owner_correction_update();

-- Generic ingest computes its own source hash and cannot masquerade as this
-- typed writer. Do not admit the contract merely because JSON names it.
CREATE FUNCTION public.admit_garage_owner_correction()
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
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_admit_garage_owner_correction BEFORE INSERT ON public.vehicle_observations
FOR EACH ROW WHEN (NEW.extraction_method='garage_owner_correction_v1'
  OR NEW.structured_data->>'claim_contract'='garage_owner_correction_v1')
EXECUTE FUNCTION public.admit_garage_owner_correction();

COMMENT ON FUNCTION public.record_garage_owner_correction(uuid,uuid,uuid,jsonb,text,text,uuid) IS
  'Account-scoped sourced relationship/cover correction. Actual authenticated account or service intake with explicit owner authorization; stable source key and named supersession. No legal-title/access grant or global cover rewrite.';
COMMENT ON FUNCTION public.get_my_garage_owner_corrections(uuid) IS
  'Private account correction projection, using the existing submitted-by index and image FK witness. Returns all live claims so conflicts cannot be erased by latest-ingest ordering.';
-- Private account corrections must not escape through a definer view or notifications.
CREATE OR REPLACE VIEW public.vehicle_canonical AS  WITH ranked AS (
         SELECT o.vehicle_id,
            o.property_id,
            o.id AS observation_id,
            o.structured_data,
            o.content_text,
            o.confidence_score,
            o.observed_at,
            o.source_id,
            o.rank,
            o.kind,
            o.changeset_id,
            op.discriminator_key,
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END AS discriminator_value,
            row_number() OVER (PARTITION BY o.vehicle_id, o.property_id, (
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END) ORDER BY (
                CASE o.rank::text
                    WHEN 'preferred'::text THEN 0
                    WHEN 'normal'::text THEN 1
                    WHEN 'deprecated'::text THEN 2
                    ELSE 3
                END), (COALESCE(o.confidence_score, 0::numeric)) DESC, o.observed_at DESC) AS rn
           FROM vehicle_observations o
             JOIN observation_properties op ON op.id = o.property_id
          WHERE o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1' AND o.is_superseded = false AND (o.source_observation_id IS NULL OR (EXISTS ( SELECT 1
                   FROM vehicle_observations rp
                     JOIN observation_sources rs ON rs.id = rp.source_id AND rs.slug = 'bat'::text
                     JOIN vehicles rv ON rv.id = rp.vehicle_id AND rv.is_public IS TRUE AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_properties rk ON rk.id = o.property_id AND (rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])) AND rk.namespace = 'core'::text AND rk.deprecated_at IS NULL
                  WHERE rp.id = o.source_observation_id AND rp.id <> o.id AND rp.vehicle_id = o.vehicle_id AND rp.source_id = o.source_id AND rp.source_url = o.source_url AND rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE AND rp.property_id IS NULL AND rp.subject_type = 'vehicle'::text AND rp.subject_id IS NULL AND rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text AND rp.confidence_score >= 0.6 AND rp.confidence_score <= 1::numeric AND isfinite(rp.ingested_at) AND o.kind::text = 'specification'::text AND o.extraction_method = 'retained_listing_property_projection_v1'::text AND (o.structured_data ->> 'source_observation_id'::text) = rp.id::text AND (o.structured_data -> rk.property_key) = (rp.structured_data ->
                        CASE rk.property_key
                            WHEN 'exterior_color'::text THEN 'color'::text
                            ELSE 'interior_color'::text
                        END) AND (o.structured_data ->> 'claim_role'::text) = 'listing_claim'::text AND (o.structured_data ->> 'observed_at_basis'::text) = 'source_testimony_recorded_at'::text AND o.observed_at = rp.ingested_at AND o.confidence_score >= 0::numeric AND o.confidence_score <= 0.6))) AND o.property_id IS NOT NULL AND o.rank::text <> 'deprecated'::text
        )
 SELECT vehicle_id,
    property_id,
    observation_id,
    structured_data,
    content_text,
    confidence_score,
    observed_at,
    source_id,
    kind,
    rank,
    changeset_id,
    discriminator_value
   FROM ranked
  WHERE rn = 1;
CREATE OR REPLACE FUNCTION public.notify_subscribers_on_observation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_vehicle RECORD;
  v_source_name TEXT;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF NEW.extraction_method='garage_owner_correction_v1' THEN RETURN NEW; END IF;
  -- Get vehicle info
  SELECT year, make, model INTO v_vehicle
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;

  -- Skip if vehicle not found
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Get source name if source_id is set
  IF NEW.source_id IS NOT NULL THEN
    SELECT display_name INTO v_source_name
    FROM public.observation_sources
    WHERE id = NEW.source_id;
  END IF;

  -- Build notification content
  v_title := 'New data on ' ||
    COALESCE(v_vehicle.year::text, '') || ' ' ||
    COALESCE(v_vehicle.make, '') || ' ' ||
    COALESCE(v_vehicle.model, '');

  v_message := 'New ' || COALESCE(NEW.kind::text, 'observation') ||
    ' recorded' ||
    CASE WHEN v_source_name IS NOT NULL THEN ' from ' || v_source_name ELSE '' END;

  -- Insert notification for each active subscriber of this vehicle
  -- Throttle: skip if subscriber already got a notification for this vehicle in the last hour
  INSERT INTO public.user_notifications (
    id, user_id, type, notification_type, title, message, vehicle_id, action_url, is_read, metadata, created_at
  )
  SELECT
    gen_random_uuid(),
    us.user_id,
    'vehicle_update',
    'vehicle_update',
    v_title,
    v_message,
    NEW.vehicle_id,
    '/vehicle/' || NEW.vehicle_id,
    false,
    jsonb_build_object(
      'vehicle_id', NEW.vehicle_id,
      'event', 'new_observation',
      'observation_kind', NEW.kind::text,
      'source_name', COALESCE(v_source_name, 'unknown'),
      'observation_id', NEW.id
    ),
    NOW()
  FROM public.user_subscriptions us
  WHERE us.target_id = NEW.vehicle_id
    AND us.is_active = true
    AND us.subscription_type = 'vehicle_status_change'
    -- Throttle: no duplicate notification for same user+vehicle in last hour
    AND NOT EXISTS (
      SELECT 1 FROM public.user_notifications un
      WHERE un.user_id = us.user_id
        AND un.vehicle_id = NEW.vehicle_id
        AND un.type = 'vehicle_update'
        AND un.created_at > NOW() - INTERVAL '1 hour'
    );

  RETURN NEW;
END;
$function$;


COMMIT;
