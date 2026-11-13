-- The existing observation log gains a typed registered component position.
-- No physical-unit identity, work order, inspection, stock or completion model
-- is created. The property requires curator ratification. The exact column
-- proposal is filed; its DDL requires the separately authorized checked release.
-- add_column has no automatic curator quorum owner (the live sentinel is9999).
SET statement_timeout='30s';
SET lock_timeout='1s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_proposals WHERE id='4484d8cd-b6fd-41b0-bd00-4415cd58d7c9'
  AND proposal_type='add_property' AND status='approved' AND payload='{"property_key":"component_visible_present","label":"Component presence in a qualified view","data_type":"boolean","unit":null,"namespace_request":"core","category":"component","applies_to_kinds":["condition"],"cardinality":"multi","discriminator_key":"component_subject_id","expected_source_categories":["internal"],"verification_scope":"instance","description":"Dated attributed image reading about one registered component position and an explicit view. True means visible present in that view. False requires explicit absence wording plus a scoped, qualified view; not visible and cannot tell are unanswered inspection outcomes, never false. The original reading, photo witness, selector, hash and analysis clock remain attached. Neither value establishes installation date, acquired-unit identity, originality, function, inspection or present-day state; multiple copies or derivations of one source are not independent agreement."}'::jsonb)
 OR NOT EXISTS(SELECT 1 FROM public.schema_proposals WHERE id='7e5032ee-d35f-4176-bc5e-45cc61fcf501'
  AND proposal_type='add_column' AND status NOT IN('rejected','withdrawn','superseded')
  AND payload='{"table":"vehicle_observations","columns":[{"column":"component_subject_id","type":"uuid","nullable":true,"references":"subject_taxonomy(subject_id)","keys_text_column":"structured_data.component_ref.key"}],"why":"Existing vehicle subject and property/condition registries lack a typed part-position reference. Reuse subject_taxonomy and source_observation_id; do not mint a unit, a new photo store or a parallel BOM.","rule":"Only the protected retained_component_reading_v1 path derives this FK from an active exact subject_key and binds the original retained analysis selector/hash and current canonical image witness. Same component position does not prove same physical unit across replacement.","writers":["ingest-observation","validate_retained_listing_property_source"],"readers":["vehicle_build_log_public"],"migration":"20261111161505_component_evidence_intake_and_fold.sql"}'::jsonb)
 OR NOT EXISTS(SELECT 1 FROM public.observation_properties WHERE property_key='component_visible_present'
  AND namespace='core' AND data_type='boolean' AND cardinality='multi' AND discriminator_key='component_subject_id'
  AND ratified_at IS NOT NULL AND deprecated_at IS NULL AND 'condition'=ANY(applies_to_kinds)
  AND proposed_by_proposal_id='4484d8cd-b6fd-41b0-bd00-4415cd58d7c9') THEN
  RAISE EXCEPTION 'Component property ratification or exact filed column proposal unavailable'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.validate_retained_listing_property_source()'::regprocedure))
  IS DISTINCT FROM '59f03ff78321fe0af041b3953255ac36'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.vehicle_build_log_public(uuid,boolean)'::regprocedure))
  IS DISTINCT FROM 'a928ab83ea7217d212441b610647181e' THEN RAISE EXCEPTION 'Component integration owner drift'; END IF;
END $guard$;
ALTER TABLE public.vehicle_observations ADD COLUMN component_subject_id uuid;
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_component_subject_fkey
 FOREIGN KEY(component_subject_id) REFERENCES public.subject_taxonomy(subject_id) NOT VALID;
COMMENT ON COLUMN public.vehicle_observations.component_subject_id IS
 'Registered component position of a protected attributed reading; not physical-unit identity. Existing vehicle subject and source observation remain separate.';

-- Private utility inside the existing build-log owner. It returns only a current,
-- exact receipt candidate; no private source URL and no inference of installation.
CREATE FUNCTION public.component_receipt_candidate(p_vehicle uuid,p_ref jsonb,p_tied boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE receipt_row record; source_url text;
BEGIN
 SELECT i.id,i.receipt_id,i.part_number,i.description,i.quantity,i.total_price,r.currency,
  r.source_document_table,r.source_document_id,l.page_date INTO receipt_row
 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
 JOIN public.receipt_vehicle_links l ON l.id=(p_ref->>'link_id')::uuid AND l.receipt_id=r.id
 WHERE i.id=(p_ref->>'receipt_item_id')::uuid AND r.id=(p_ref->>'receipt_id')::uuid
  AND l.vehicle_id=p_vehicle AND l.status='linked' AND l.retired_at IS NULL
  AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
  AND r.source_document_table=p_ref->>'source_table' AND r.source_document_id=(p_ref->>'source_id')::uuid
  AND i.description IS NOT DISTINCT FROM p_ref->>'description' AND i.part_number IS NOT DISTINCT FROM p_ref->>'part_number'
  AND public.receipt_product_eligible(i.part_number,i.description) AND i.quantity>0;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF receipt_row.source_document_table='vehicle_documents' THEN
  SELECT d.file_url INTO source_url FROM public.vehicle_documents d WHERE d.id=receipt_row.source_document_id AND d.vehicle_id=p_vehicle;
 ELSIF receipt_row.source_document_table='vehicle_images' THEN
  SELECT i.image_url INTO source_url FROM public.vehicle_images i WHERE i.id=receipt_row.source_document_id AND i.vehicle_id=p_vehicle
   AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.vision_gate_status='approved';
 END IF;
 IF source_url IS NULL OR encode(sha256(convert_to(source_url,'UTF8')),'hex') IS DISTINCT FROM p_ref->>'source_url_sha256'
  OR coalesce(p_ref->>'association_basis','') NOT IN('same_printed_part_number','same_component_role') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('receipt_item_id',receipt_row.id,'receipt_id',receipt_row.receipt_id,'source_table',receipt_row.source_document_table,
  'source_id',receipt_row.source_document_id,'source_url_sha256',p_ref->>'source_url_sha256',
  'description',public.text_redact_contact(receipt_row.description),'printed_part_number',receipt_row.part_number,'printed_quantity',receipt_row.quantity,
  'page_date',receipt_row.page_date,'association_basis',p_ref->>'association_basis','installation_status','unestablished',
  'physical_unit_identity','unestablished','product',public.receipt_item_product_card(receipt_row.id),
  'documented_amount',CASE WHEN p_tied THEN receipt_row.total_price END,'currency',receipt_row.currency,'amounts_visible',p_tied);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.component_receipt_candidate(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.component_receipt_candidate(uuid,jsonb,boolean) TO service_role;

-- Source-currentness/typed-value contract shared by atomic admission and fold.
-- It validates the retained mapping, not semantic agreement or functional state.
CREATE FUNCTION public.component_reading_matches(p public.vehicle_observations,c public.vehicle_observations,i public.vehicle_images)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $function$
DECLARE s public.subject_taxonomy%ROWTYPE; q jsonb:=c.structured_data->'component_reading'; path text[];
 value text; region jsonb; absence jsonb; candidate jsonb; ordinal integer; pn text; descriptor text;
BEGIN
 SELECT * INTO s FROM public.subject_taxonomy WHERE subject_id=c.component_subject_id AND is_active IS TRUE;
 IF NOT FOUND OR c.extraction_method IS DISTINCT FROM 'retained_component_reading_v1' OR c.kind::text IS DISTINCT FROM 'condition'
  OR c.subject_type IS DISTINCT FROM 'vehicle' OR c.subject_id IS NOT NULL OR c.is_superseded IS DISTINCT FROM false
  OR c.source_observation_id IS DISTINCT FROM p.id OR c.vehicle_id IS DISTINCT FROM p.vehicle_id
  OR c.vehicle_id IS DISTINCT FROM i.vehicle_id OR c.source_url IS DISTINCT FROM i.image_url
  OR p.source_url IS DISTINCT FROM i.image_url OR p.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1'
  OR p.is_superseded IS DISTINCT FROM false OR p.kind::text IS DISTINCT FROM 'condition'
  OR p.structured_data->>'image_id' IS DISTINCT FROM i.id::text
  OR c.observed_at IS DISTINCT FROM p.observed_at OR p.observed_at IS NULL OR NOT isfinite(p.observed_at)
  OR c.observed_at_basis IS DISTINCT FROM 'source_analysis_time' OR c.source_event_at IS NOT NULL
  OR c.source_event_time_precision IS DISTINCT FROM 'unknown' OR c.analysis_deferred IS DISTINCT FROM true
  OR c.confidence_score IS NULL OR c.confidence_score NOT BETWEEN 0 AND .6
  OR c.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
  OR c.structured_data->>'image_id' IS DISTINCT FROM i.id::text
  OR c.structured_data#>>'{component_ref,subject_id}' IS DISTINCT FROM s.subject_id::text
  OR c.structured_data#>>'{component_ref,key}' IS DISTINCT FROM s.subject_key
  OR c.structured_data#>>'{component_ref,identity_basis}' IS DISTINCT FROM 'position_only'
  OR q->>'source_observation_id' IS DISTINCT FROM p.id::text OR q->>'image_id' IS DISTINCT FROM i.id::text
  OR q->>'source_url' IS DISTINCT FROM i.image_url OR q->>'source_role' IS DISTINCT FROM 'attributed_retained_image_reading'
  OR q->>'clock_basis' IS DISTINCT FROM 'source_analysis_time' OR q->>'physical_unit_identity' IS DISTINCT FROM 'unestablished'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(c.structured_data) k WHERE k NOT IN('image_id','component_ref','component_reading','property_key','component_visible_present','component_receipt_candidates'))
  OR public.vehicle_image_gallery_eligible(i) IS DISTINCT FROM true OR i.is_document IS TRUE OR i.is_sensitive IS TRUE
  OR coalesce(i.redaction_level,'none')<>'none'
  OR NOT EXISTS(SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=p.id AND w.image_id=i.id)
  OR NOT EXISTS(SELECT 1 FROM public.observation_sources os WHERE os.id=c.source_id AND os.slug='photo_pipeline')
  OR NOT EXISTS(SELECT 1 FROM public.observation_sources os WHERE os.id=p.source_id AND os.slug='photo_pipeline')
  OR jsonb_typeof(q->'path') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'path') NOT IN(1,3)
  OR coalesce(q->>'value_sha256','') !~ '^[0-9a-f]{64}$' OR nullif(btrim(q->>'quote'),'') IS NULL THEN RETURN false; END IF;
 SELECT array_agg(x ORDER BY n) INTO path FROM jsonb_array_elements_text(q->'path') WITH ORDINALITY t(x,n);
 IF NOT(path=ARRAY['agent_notes'] OR (array_length(path,1)=3 AND path[1] IN('components_seen','damage_localized')
  AND path[2] ~ '^(0|[1-9][0-9]{0,2})$' AND path[3]='label')) THEN RETURN false; END IF;
 IF jsonb_typeof(p.structured_data#>path) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 value:=p.structured_data#>>path;
 IF encode(sha256(convert_to(value,'UTF8')),'hex') IS DISTINCT FROM q->>'value_sha256'
  OR position(q->>'quote' IN value)=0 OR c.content_text IS DISTINCT FROM q->>'quote' THEN RETURN false; END IF;
 IF c.property_id IS NOT NULL THEN
  IF c.descriptor_id IS NOT NULL OR c.structured_data->>'property_key' IS DISTINCT FROM 'component_visible_present'
   OR jsonb_typeof(c.structured_data->'component_visible_present') IS DISTINCT FROM 'boolean'
   OR NOT EXISTS(SELECT 1 FROM public.observation_properties r WHERE r.id=c.property_id AND r.property_key='component_visible_present'
    AND r.namespace='core' AND r.data_type='boolean' AND r.cardinality='multi' AND r.discriminator_key='component_subject_id'
    AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'condition'=ANY(r.applies_to_kinds)) THEN RETURN false; END IF;
  IF c.structured_data->'component_visible_present'='true'::jsonb THEN
   IF path[1]<>'components_seen' OR q ? 'absence' THEN RETURN false; END IF;
  ELSE
   absence:=q->'absence';
   IF path<>ARRAY['agent_notes'] OR jsonb_typeof(absence) IS DISTINCT FROM 'object'
    OR nullif(btrim(absence->>'scope'),'') IS NULL OR nullif(btrim(absence->>'view_coverage_quote'),'') IS NULL
    OR nullif(btrim(absence->>'absence_quote'),'') IS NULL
    OR absence->>'scope' IS DISTINCT FROM s.subject_key
    OR lower(left(btrim(absence->>'absence_quote'),length(s.display_name))) IS DISTINCT FROM lower(s.display_name)
    OR lower(left(btrim(absence->>'view_coverage_quote'),length(s.display_name))) IS DISTINCT FROM lower(s.display_name)
    OR position(absence->>'view_coverage_quote' IN value)=0 OR position(absence->>'absence_quote' IN value)=0
    OR btrim(substring(btrim(absence->>'absence_quote') FROM length(s.display_name)+1)) !~* '^(is (absent|missing|not present)|has been removed)[.]?$'
    OR btrim(substring(btrim(absence->>'view_coverage_quote') FROM length(s.display_name)+1)) !~* '^((position|mounting location|tray|location|area) )?(is|are) (fully|entirely|completely) (visible|exposed|in view)( from (above|below|front|rear|left|right))?[.]?$'
    OR NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value,E'(?<=[.!?])\\s+|\\r?\\n') sentence WHERE btrim(sentence)=btrim(absence->>'absence_quote'))
    OR NOT EXISTS(SELECT 1 FROM regexp_split_to_table(value,E'(?<=[.!?])\\s+|\\r?\\n') sentence WHERE btrim(sentence)=btrim(absence->>'view_coverage_quote'))
    THEN RETURN false; END IF;
  END IF;
  descriptor:='component_visible_present';
 ELSE
  SELECT canonical_key INTO descriptor FROM public.condition_taxonomy WHERE descriptor_id=c.descriptor_id AND deprecated_at IS NULL
   AND canonical_key LIKE s.domain||'.'||s.category||'.%';
  IF NOT FOUND OR path[1]<>'damage_localized' OR q ? 'absence' OR c.structured_data->>'property_key' IS NOT NULL
   OR c.structured_data ? 'component_visible_present' THEN RETURN false; END IF;
 END IF;
 IF c.source_identifier IS DISTINCT FROM 'retained_component_reading_v1:'||p.id::text||':'||s.subject_id::text||':'||descriptor THEN RETURN false; END IF;
 region:=CASE WHEN array_length(path,1)=3 THEN p.structured_data#>ARRAY[path[1],path[2],'bbox'] ELSE absence->'bbox' END;
 IF region IS NULL OR jsonb_typeof(region) IS DISTINCT FROM 'array' OR jsonb_array_length(region)<>4
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(region)x WHERE jsonb_typeof(x)<>'number' OR (x#>>'{}')::numeric NOT BETWEEN 0 AND 999)
  OR (region->>0)::numeric>=(region->>2)::numeric OR (region->>1)::numeric>=(region->>3)::numeric
  OR q->'bbox' IS DISTINCT FROM region THEN RETURN false; END IF;
 IF jsonb_typeof(c.structured_data->'component_receipt_candidates') IS DISTINCT FROM 'array'
  OR jsonb_array_length(c.structured_data->'component_receipt_candidates')>10 THEN RETURN false; END IF;
 -- Receipt withdrawal removes the candidate, not the independent photographed
 -- presence. Admission checks current candidates separately below.
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $function$;
REVOKE ALL ON FUNCTION public.component_reading_matches(public.vehicle_observations,public.vehicle_observations,public.vehicle_images)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.component_reading_matches(public.vehicle_observations,public.vehicle_observations,public.vehicle_images) TO service_role;

-- The old source custody owner remains the only BEFORE admission guard. Its
-- remaining definition and unrelated source behavior are byte-identical.
DO $patch$
DECLARE definition text:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
 branch text:=$branch$
  IF NEW.component_subject_id IS NOT NULL OR NEW.extraction_method='retained_component_reading_v1'
   OR EXISTS(SELECT 1 FROM public.observation_properties WHERE id=NEW.property_id AND property_key='component_visible_present')
   OR NEW.structured_data ? 'component_ref' OR NEW.structured_data ? 'component_reading'
   OR (TG_OP='UPDATE' AND OLD.component_subject_id IS NOT NULL) THEN
   IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain']) THEN
     RAISE EXCEPTION 'Component reading is immutable; supersede instead' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END IF;
   IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Component reading requires service role' USING ERRCODE='42501'; END IF;
   DECLARE image_row public.vehicle_images%ROWTYPE; source_row public.vehicle_observations%ROWTYPE; candidate jsonb; source_pn text; BEGIN
    -- Image first: source withdrawal already uses this order. NOWAIT fails
    -- closed on a concurrent mutation rather than extending a lock graph.
    SELECT * INTO image_row FROM public.vehicle_images WHERE id=(NEW.structured_data->>'image_id')::uuid FOR SHARE NOWAIT;
    SELECT * INTO source_row FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.vehicles WHERE id=NEW.vehicle_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.observation_witnesses WHERE observation_id=source_row.id AND image_id=image_row.id FOR SHARE NOWAIT;
    IF public.component_reading_matches(source_row,NEW,image_row) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'Component reading source or scope unavailable' USING ERRCODE='23514'; END IF;
    FOR candidate IN SELECT value FROM jsonb_array_elements(NEW.structured_data->'component_receipt_candidates') LOOP
     PERFORM 1 FROM public.receipt_items WHERE id=(candidate->>'receipt_item_id')::uuid FOR SHARE NOWAIT;
     PERFORM 1 FROM public.receipts WHERE id=(candidate->>'receipt_id')::uuid FOR SHARE NOWAIT;
     PERFORM 1 FROM public.receipt_vehicle_links WHERE id=(candidate->>'link_id')::uuid FOR SHARE NOWAIT;
     IF candidate->>'source_table'='vehicle_documents' THEN
      PERFORM 1 FROM public.vehicle_documents WHERE id=(candidate->>'source_id')::uuid FOR SHARE NOWAIT;
     ELSE PERFORM 1 FROM public.vehicle_images WHERE id=(candidate->>'source_id')::uuid FOR SHARE NOWAIT; END IF;
     IF public.component_receipt_candidate(NEW.vehicle_id,candidate,false) IS NULL THEN
      RAISE EXCEPTION 'Component receipt candidate unavailable' USING ERRCODE='23514'; END IF;
     IF candidate->>'association_basis'='same_printed_part_number' THEN
      source_pn:=source_row.structured_data#>>ARRAY['components_seen',NEW.structured_data#>>'{component_reading,path,1}','part_number_guess'];
      IF nullif(public.receipt_product_number(source_pn),'') IS NULL OR public.receipt_product_number(source_pn)
       IS DISTINCT FROM public.receipt_product_number(candidate->>'part_number') THEN
       RAISE EXCEPTION 'Component part-number candidate does not match retained reading' USING ERRCODE='23514'; END IF;
     END IF;
    END LOOP;
   END;
   RETURN NEW;
  END IF;
$branch$;
BEGIN
 definition:=overlay(definition placing branch from position(E'BEGIN\n' IN definition)+6 for 0);
 -- Replace only the first top-level BEGIN, not nested block starts.
 IF length(definition)-length(replace(definition,branch,''))<>length(branch) THEN RAISE EXCEPTION 'Source guard splice ambiguous'; END IF;
 EXECUTE definition;
END $patch$;

-- Service-only admission receipt check. Replays and post-insert responses must
-- qualify the current source and both witnesses, not just find a content hash.
CREATE FUNCTION public.component_reading_current(p_observation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
 JOIN public.vehicle_images i ON i.id=(c.structured_data->>'image_id')::uuid
 WHERE c.id=p_observation AND public.component_reading_matches(p,c,i)
 AND EXISTS(SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=c.id AND w.image_id=i.id));
$function$;
REVOKE ALL ON FUNCTION public.component_reading_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.component_reading_current(uuid) TO service_role;

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
REVOKE ALL ON FUNCTION public.component_evidence_fold(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $reader$
DECLARE definition text:=pg_get_functiondef('public.vehicle_build_log_public(uuid,boolean)'::regprocedure);
 needle text:='|| public.visual_work_build_log(p_vehicle_id);';
BEGIN
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Build-log splice unavailable'; END IF;
 EXECUTE replace(definition,needle,'|| public.visual_work_build_log(p_vehicle_id) || public.component_evidence_fold(p_vehicle_id);');
END $reader$;
RESET lock_timeout;
RESET statement_timeout;
