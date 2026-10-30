-- Reuse the app's retained native reading; receipt and candidate strings are
-- not proof. This rule establishes only the printed vehicle identifier.
SET lock_timeout='3s';
SET statement_timeout='30s';


DO $guard$ DECLARE fingerprint text; BEGIN
 fingerprint:=encode(sha256(convert_to(pg_get_functiondef('public.contributor_retained_reading_for(uuid)'::regprocedure),'UTF8')),'base64');
 IF fingerprint NOT IN ('CdU1dqEV6Y6r3aAlk+hNZF6j2RRPcaz+3fi79lHXDIY=','6dxVshnACg9jyaijDy4NlXHHwKPBKBwgS7FfeusACJQ=') THEN RAISE EXCEPTION 'Contributor retained-reading owner drifted: contributor_retained_reading_for(uuid)'; END IF;
 fingerprint:=encode(sha256(convert_to(pg_get_functiondef('public.evaluate_contributor_evidence_item(uuid,uuid)'::regprocedure),'UTF8')),'base64');
 IF fingerprint NOT IN ('O1ndva+IVpL2O1sdtcOnZ8V2wwHOTBH/GLVrNJ0VMHc=','3AWdWGLml4yqGjefhOySaS4SWk6WpuKzaS9wF4Rzfu4=') THEN RAISE EXCEPTION 'Contributor retained-reading owner drifted: evaluate_contributor_evidence_item(uuid,uuid)'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.contributor_native_identifier_matches(p_observation jsonb,p_identifier text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 WITH strong AS (
  SELECT o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_observation->'on_device')='array'
    THEN p_observation->'on_device' ELSE '[]'::jsonb END) o
  WHERE jsonb_typeof(o->'confidence')='number'
   AND CASE WHEN pg_input_is_valid(o->>'confidence','numeric') THEN (o->>'confidence')::numeric BETWEEN 0.9 AND 1 ELSE false END
   AND (o->'repaired' IS NULL OR o->'repaired'='false'::jsonb)
   AND o#>>'{source,framework}'='Apple Vision' AND o#>>'{source,model}'='VNRecognizeTextRequest'
   AND o#>>'{source,method}' IN ('nuke-ondevice-v1','nuke-identity-perspective-v1') AND jsonb_typeof(o#>'{source,revision}')='number'
   AND CASE WHEN pg_input_is_valid(o#>>'{source,revision}','integer') THEN (o#>>'{source,revision}')::int>0 ELSE false END
 ), identifiers AS (
  SELECT o->>'value' identifier FROM strong WHERE o->>'kind' IN ('vin','classic_serial')
   AND o->>'value' ~ '^[A-Z0-9]{8,17}$'
  UNION
  SELECT m[1] FROM strong CROSS JOIN LATERAL regexp_matches(upper(o->>'value'),'\m([A-Z0-9]{17})\M','g') m
   WHERE o->>'kind'='ocr_text'
  UNION
  -- This function only compares against a persisted vehicle identifier. A
  -- bare classic plate may match it exactly; it cannot create a new identity.
  SELECT m[1] FROM strong CROSS JOIN LATERAL regexp_matches(upper(o->>'value'),'\m([A-Z0-9]{8,16})\M','g') m
   WHERE o->>'kind'='ocr_text' AND length(p_identifier) BETWEEN 8 AND 16
    AND m[1] ~ '[A-Z]' AND m[1] ~ '[0-9]'
  UNION
  SELECT m[1] FROM strong CROSS JOIN LATERAL regexp_matches(upper(o->>'value'),
   '\m(?:CHASSIS|SERIAL|VIN)\s*(?:NO\.?|NUMBER|#)?\s*[:#.-]?\s*([A-Z0-9]{8,16})\M','g') m
   WHERE o->>'kind'='ocr_text'
 ), candidates AS (
  SELECT DISTINCT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_observation->'vin_candidates')='array'
   THEN p_observation->'vin_candidates' ELSE '[]'::jsonb END) x
 )
 SELECT coalesce(p_identifier ~ '^[A-Z0-9]{8,17}$' AND p_identifier ~ '[A-Z]' AND p_identifier ~ '[0-9]'
  AND p_observation->'is_document'='false'::jsonb
  AND (SELECT count(*)=1 AND bool_and(x=p_identifier) FROM candidates)
  AND (SELECT count(*)=1 AND bool_and(identifier=p_identifier) FROM identifiers),false)
$$;
REVOKE ALL ON FUNCTION public.contributor_native_identifier_matches(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contributor_native_identifier_matches(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.contributor_retained_reading_for(p_image_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT r.id FROM public.image_observations r JOIN public.vehicle_images v ON v.id=r.image_id
 CROSS JOIN LATERAL (SELECT r.confidence_basis#>'{visual_subject_reading_v1,envelope}' AS e) envelope
 CROSS JOIN LATERAL (SELECT coalesce(e->'device_source_context',e->'raw_model_reading') AS d) reading
 WHERE v.id=p_image_id AND r.is_active AND r.superseded_by IS NULL
  AND r.observed_by='visual_subject_reading_v1' AND v.user_id IS NOT NULL
  AND v.is_sensitive IS NOT TRUE AND v.is_superseded IS NOT TRUE AND v.is_duplicate IS NOT TRUE
  AND v.is_document IS NOT TRUE AND v.doc_flag IS NOT TRUE
  AND coalesce(v.vision_gate_status::text,'') NOT IN ('rejected_personal','rejected_misattributed')
  AND e->>'user_id'=v.user_id::text AND v.file_hash ~ '^[a-f0-9]{64}$'
  AND d->>'kind' IN ('on_device_identity_context_v1','on_device_identity_read_v1')
  AND pg_input_is_valid(d->>'identity_run_id','uuid')
  AND (d->>'kind'<>'on_device_identity_read_v1' OR (e->>'provider'='Apple Vision (on-device)'
    AND e->>'model'=d->>'identity_method_version' AND e->>'run_key'=d->>'identity_run_id'))
  AND d->>'identity_method_version' ~ '^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$'
  AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e->'inputs')='array' THEN e->'inputs' ELSE '[]'::jsonb END) x
   WHERE x->>'image_id'=v.id::text AND x->>'source_sha256'=v.file_hash AND x->>'input_sha256'=v.file_hash
    AND x->'source_qualified'='true'::jsonb)
  AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'observations')='array' THEN d->'observations' ELSE '[]'::jsonb END) o
   WHERE o->>'image_id'=v.id::text AND o->'is_document'='false'::jsonb)
 ORDER BY EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'observations')='array' THEN d->'observations' ELSE '[]'::jsonb END) o
   JOIN public.vehicles subject ON subject.id=v.vehicle_id
   WHERE o->>'image_id'=v.id::text AND public.contributor_native_identifier_matches(o,upper(btrim(subject.vin)))) DESC,
  (d->>'kind'='on_device_identity_read_v1') DESC,r.observed_at DESC,r.id DESC LIMIT 1
$function$;
CREATE OR REPLACE FUNCTION public.evaluate_contributor_evidence_item(p_item_id uuid, p_reading_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE i public.vehicle_evidence_items; r public.image_observations; v public.vehicle_images;
  e jsonb; d jsonb; o jsonb; x jsonb; identifier text;
BEGIN
  SELECT * INTO i FROM public.vehicle_evidence_items WHERE id=p_item_id;
  IF i.id IS NULL THEN RETURN jsonb_build_object('verdict','unresolved','reason','item_unavailable','qualified',false); END IF;
  IF p_reading_id IS NOT NULL THEN
    SELECT * INTO r FROM public.image_observations WHERE id=p_reading_id AND is_active AND superseded_by IS NULL
      AND observed_by='visual_subject_reading_v1';
  END IF;
  IF i.acceptance_rule->>'kind' IS DISTINCT FROM 'native_vehicle_identifier_v1'
     OR i.key<>'shot_vin_plate' OR i.kind<>'photo' THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','acceptance_rule_unconfigured','qualified',false,
      'source_read',NULL);
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('verdict','unresolved','reason','qualified_source_read_required','qualified',false,'source_read',false); END IF;
  SELECT * INTO v FROM public.vehicle_images WHERE id=r.image_id AND vehicle_id=i.vehicle_id
    AND is_superseded IS NOT TRUE AND is_duplicate IS NOT TRUE AND is_document IS NOT TRUE
    AND doc_flag IS NOT TRUE AND is_sensitive IS NOT TRUE AND nullif(btrim(image_url),'') IS NOT NULL
    AND file_hash ~ '^[a-f0-9]{64}$'
    AND coalesce(vision_gate_status::text,'') NOT IN ('rejected_personal','rejected_misattributed');
  IF v.id IS NULL OR NOT EXISTS(SELECT FROM public.vehicle_evidence_changes c
    WHERE c.vehicle_id=i.vehicle_id AND c.item_key=i.key AND c.source_ref=v.id AND c.source_kind='image'
      AND c.event_kind='input_received') THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','source_unavailable_or_outside_receipt','qualified',false,'source_read',true);
  END IF;
  e:=r.confidence_basis#>'{visual_subject_reading_v1,envelope}';
  d:=coalesce(e->'device_source_context',e->'raw_model_reading');
  IF coalesce(d->>'kind','') NOT IN ('on_device_identity_context_v1','on_device_identity_read_v1')
     OR coalesce(d->>'identity_method_version','') !~ '^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$'
     OR NOT coalesce(pg_input_is_valid(d->>'identity_run_id','uuid'),false)
     OR (d->>'kind'='on_device_identity_read_v1' AND (e->>'provider' IS DISTINCT FROM 'Apple Vision (on-device)'
       OR e->>'model' IS DISTINCT FROM d->>'identity_method_version' OR e->>'run_key' IS DISTINCT FROM d->>'identity_run_id'))
     OR e->>'user_id' IS DISTINCT FROM v.user_id::text THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','identity_method_or_owner_unqualified','qualified',false,'source_read',true);
  END IF;
  SELECT upper(btrim(vin)) INTO identifier FROM public.vehicles WHERE id=i.vehicle_id;
  SELECT value INTO x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e->'inputs')='array' THEN e->'inputs' ELSE '[]'::jsonb END)
    WHERE value->>'image_id'=v.id::text AND value->>'source_sha256'=v.file_hash
      AND value->>'input_sha256'=v.file_hash AND value->'source_qualified'='true'::jsonb LIMIT 1;
  SELECT value INTO o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'observations')='array' THEN d->'observations' ELSE '[]'::jsonb END)
    WHERE value->>'image_id'=v.id::text AND value->'is_document'='false'::jsonb
      AND public.contributor_native_identifier_matches(value,identifier) LIMIT 1;
  IF x IS NULL OR o IS NULL OR identifier IS NULL THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','identifier_or_source_does_not_match','qualified',false,'source_read',true);
  END IF;
  RETURN jsonb_build_object('verdict','supported','qualified',true,'rule','native_vehicle_identifier_v1',
    'qualification_revision','native_vehicle_identifier_v2','property','vehicle_identifier','value',identifier,'source_read',true,'reading_ref',r.id,
    'proof_kind','image','proof_ref',v.id,'source_sha256',v.file_hash,'method',d->>'identity_method_version',
    'read_at',r.observed_at,'observed_at',v.taken_at);
END $function$;
