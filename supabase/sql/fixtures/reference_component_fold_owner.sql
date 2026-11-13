CREATE FUNCTION public.component_evidence_fold(p_vehicle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE tied boolean; c record; candidate jsonb; candidates jsonb; image jsonb; reading jsonb; components jsonb:='{}';
 row jsonb; key text; dimension text; total_seen integer:=0; qualified integer:=0; result jsonb; previous jsonb; readings jsonb; merged boolean;
BEGIN
 SELECT coalesce(auth.role()='service_role' OR (auth.uid() IS NOT NULL AND (v.user_id=auth.uid() OR v.owner_id=auth.uid()
  OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()))),false) INTO tied
 FROM public.vehicles v WHERE v.id=p_vehicle AND v.deleted_at IS NULL
  AND (v.is_public IS TRUE OR auth.role()='service_role' OR (auth.uid() IS NOT NULL AND (v.user_id=auth.uid() OR v.owner_id=auth.uid()
   OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()))));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
 FOR c IN SELECT o.*,s.subject_key,s.display_name,p.structured_data AS retained_data,i.id AS image_key,i.image_url,i.taken_at,i.exif_data,
  public.component_reading_matches(p,o,i) AS current_reading
 FROM public.vehicle_observations o JOIN public.subject_taxonomy s ON s.subject_id=o.component_subject_id
 JOIN public.vehicle_observations p ON p.id=o.source_observation_id
 JOIN public.vehicle_images i ON i.id=(o.structured_data->>'image_id')::uuid
 WHERE o.vehicle_id=p_vehicle AND o.extraction_method='retained_component_reading_v1'
 ORDER BY o.observed_at DESC,o.id DESC LIMIT 401 LOOP
  total_seen:=total_seen+1; IF total_seen>400 THEN EXIT; END IF;
  IF c.current_reading IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.observation_witnesses w
   WHERE w.observation_id=c.id AND w.image_id=c.image_key) THEN CONTINUE; END IF;
  qualified:=qualified+1; key:=c.component_subject_id::text;
  row:=coalesce(components->key,jsonb_build_object('subject_id',c.component_subject_id,'component_key',c.subject_key,'label',c.display_name,
   'identity_basis','position_only','presence',jsonb_build_object('status','unknown','readings','[]'::jsonb),
   'condition',jsonb_build_object('status','unknown','readings','[]'::jsonb),'purchase_candidates','[]'::jsonb,
   'reported_work','[]'::jsonb,'inspection','[]'::jsonb,'unresolved',jsonb_build_array('physical_unit_identity_unestablished',
    'installation_time_unestablished','functional_inspection_unestablished')));
  image:=jsonb_build_object('image_id',c.image_key,'source_observation_id',c.source_observation_id,'image_url',c.image_url,
   'caption',public.text_redact_contact(c.content_text),'role','source','taken_at',c.taken_at,
   'capture_time_basis',c.exif_data->>'capture_time_basis','bbox',c.structured_data#>'{component_reading,bbox}');
  reading:=jsonb_build_object('observation_id',c.id,'observation_ids',jsonb_build_array(c.id),'source_observation_ids',jsonb_build_array(c.source_observation_id),'images',jsonb_build_array(image),
   'evidence_time',c.observed_at,'recorded_at',c.ingested_at,'clock_basis','source_analysis_time','source_role','attributed_retained_image_reading',
   'quote',public.text_redact_contact(c.content_text),'selector',c.structured_data#>'{component_reading,path}',
   'value_sha256',c.structured_data#>>'{component_reading,value_sha256}','agreement_status','not_established',
   'physical_unit_identity','unestablished');
  IF c.property_id IS NOT NULL THEN dimension:='presence'; reading:=reading||jsonb_build_object('value',
   CASE WHEN c.structured_data->'component_visible_present'='true'::jsonb THEN 'present' ELSE 'absent' END,
   'absence_scope',c.structured_data#>'{component_reading,absence}');
  ELSE dimension:='condition'; reading:=reading||jsonb_build_object('descriptor_id',c.descriptor_id); END IF;
  -- Repeated keying of the same retained scalar is one reading, with every
  -- derived testimony ID retained. It is never additional agreement.
  readings:='[]';merged:=false;
  FOR previous IN SELECT value FROM jsonb_array_elements(row#>ARRAY[dimension,'readings']) LOOP
   IF previous->'source_observation_ids'=reading->'source_observation_ids' AND previous->'selector'=reading->'selector'
    AND previous->'value_sha256'=reading->'value_sha256' AND previous->'value' IS NOT DISTINCT FROM reading->'value'
    AND previous->'descriptor_id' IS NOT DISTINCT FROM reading->'descriptor_id' THEN
    previous:=jsonb_set(previous,'{observation_ids}',(previous->'observation_ids')||jsonb_build_array(c.id));merged:=true;
   END IF;
   readings:=readings||jsonb_build_array(previous);
  END LOOP;
  IF NOT merged THEN readings:=readings||jsonb_build_array(reading); END IF;
  row:=jsonb_set(row,ARRAY[dimension],jsonb_build_object('status','attributed_reading','readings',readings));
  candidates:=row->'purchase_candidates';
  FOR candidate IN SELECT value FROM jsonb_array_elements(c.structured_data->'component_receipt_candidates') LOOP
   candidate:=public.component_receipt_candidate(p_vehicle,candidate,tied);
   IF candidate IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidates)x WHERE x->>'receipt_item_id'=candidate->>'receipt_item_id') THEN
    candidates:=candidates||jsonb_build_array(candidate); END IF;
  END LOOP;
  row:=jsonb_set(row,'{purchase_candidates}',candidates); components:=jsonb_set(components,ARRAY[key],row);
 END LOOP;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'component_key'),'[]') INTO result FROM jsonb_each(components);
 RETURN jsonb_build_object('component_evidence',jsonb_build_object('version',1,'as_of',statement_timestamp(),
  'expected_population',jsonb_build_object('status','unknown','reason','no_applicable_registered_template'),
  'coverage',jsonb_build_object('examined_readings',least(total_seen,400),'qualified_readings',qualified,'truncated',total_seen>400,
   'selection','latest_400_retained_component_readings'),
  'components',result));
END $function$;
