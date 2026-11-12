-- Records live state from 2026-11-12 hand-apply. Migration guard no-ops if already applied.
SET statement_timeout='30s';
SET lock_timeout='5s';

-- Guard: skip if the live function md5s match what was hand-applied
DO $guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.component_receipt_candidate(uuid,jsonb,boolean)'::regprocedure)) = 'edc7d8db524dfa6a02e2bac51cc7b420'
 AND md5((SELECT prosrc FROM pg_proc WHERE oid='public.component_reading_current(uuid)'::regprocedure)) = '82fa09e14bb4b6ab4e9a53d4b5414a5b'
 AND md5((SELECT prosrc FROM pg_proc WHERE oid='public.component_evidence_fold(uuid)'::regprocedure)) = '33d3434d4048ff0094d52b4cda4c7839'
 AND md5((SELECT prosrc FROM pg_proc WHERE oid='public.vehicle_build_log_public(uuid,boolean,boolean)'::regprocedure)) = '78f4a36b5ca84ae371b3368b804d39b9'
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicle_observations' AND column_name='component_subject_id')
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reference_documents' AND column_name='source_capture')
 THEN
  RAISE NOTICE 'Component evidence hand-apply already recorded; skipping';
  RETURN;
 END IF;
END $guard$;

-- Column additions (IF NOT EXISTS for idempotence)
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS component_subject_id uuid REFERENCES public.subject_taxonomy(subject_id);
ALTER TABLE public.reference_documents ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.reference_documents ADD COLUMN IF NOT EXISTS source_capture jsonb;
ALTER TABLE public.component_assembly_map ADD COLUMN IF NOT EXISTS source_observation_id uuid REFERENCES public.vehicle_observations(id);
ALTER TABLE public.component_assembly_map ADD COLUMN IF NOT EXISTS reference_document_id uuid REFERENCES public.reference_documents(id);
ALTER TABLE public.component_assembly_map ADD COLUMN IF NOT EXISTS source_payload_sha256 text;
CREATE UNIQUE INDEX IF NOT EXISTS component_assembly_map_source_observation_unique
 ON public.component_assembly_map(source_observation_id) WHERE source_observation_id IS NOT NULL;

-- Functions with extensions.digest (matches live state)
CREATE OR REPLACE FUNCTION public.component_receipt_candidate(p_vehicle uuid, p_ref jsonb, p_tied boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
REVOKE ALL ON FUNCTION public.component_receipt_candidate(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.component_receipt_candidate(uuid,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.component_reading_current(p_observation uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
 JOIN public.vehicle_images i ON i.id=(c.structured_data->>'image_id')::uuid
 WHERE c.id=p_observation AND public.component_reading_matches(p,c,i)
 AND EXISTS(SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=c.id AND w.image_id=i.id));
$function$;
REVOKE ALL ON FUNCTION public.component_reading_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.component_reading_current(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.component_evidence_fold(p_vehicle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE tied boolean; c record; candidate jsonb; candidates jsonb; image jsonb; reading jsonb; components jsonb:='{}';
 row jsonb; key text; dimension text; total_seen integer:=0; qualified integer:=0; result jsonb; previous jsonb; readings jsonb; merged boolean; expected jsonb;
BEGIN
 SELECT coalesce(auth.role()='service_role' OR (auth.uid() IS NOT NULL AND (v.user_id=auth.uid() OR v.owner_id=auth.uid()
  OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()))),false) INTO tied
 FROM public.vehicles v WHERE v.id=p_vehicle AND v.deleted_at IS NULL
  AND (v.is_public IS TRUE OR auth.role()='service_role' OR (auth.uid() IS NOT NULL AND (v.user_id=auth.uid() OR v.owner_id=auth.uid()
   OR v.uploaded_by=auth.uid() OR public.vehicle_user_has_access(v.id,auth.uid()))));
 IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

 SELECT coalesce(jsonb_agg(entry||jsonb_build_object('applicability',jsonb_build_object(
  'status',CASE WHEN nullif(btrim(v.body_style),'') IS NULL THEN 'body_style_unverified' ELSE 'matched_year_make_model_body_style' END,
  'actual_body_style',v.body_style)) ORDER BY entry->>'assembly_name',entry->>'assembly_id'),'[]'::jsonb) INTO expected
 FROM public.vehicles v CROSS JOIN LATERAL jsonb_array_elements(public.get_all_assemblies_for_vehicle(v.year,v.model)) entry
 WHERE v.id=p_vehicle AND entry->>'source_status'='current_public_reference'
 AND lower(entry#>>'{application,make}')=lower(v.make)
 AND (nullif(btrim(v.body_style),'') IS NULL OR regexp_replace(lower(v.body_style),'[^a-z0-9]','','g')=
  regexp_replace(lower(entry#>>'{application,body_style}'),'[^a-z0-9]','','g'));

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
  'expected_assemblies',expected,'expected_population',jsonb_build_object('status','unknown','reason',CASE WHEN jsonb_array_length(expected)>0 THEN 'partial_reference_scope_only' ELSE 'no_applicable_registered_template' END),
  'coverage',jsonb_build_object('examined_readings',least(total_seen,400),'qualified_readings',qualified,'truncated',total_seen>400,
   'selection','latest_400_retained_component_readings'),
  'components',result));
END $function$;
REVOKE ALL ON FUNCTION public.component_evidence_fold(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid, p_include_reported boolean, p_include_visual boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$;
 SELECT jsonb_build_object(
  'work_records',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.vehicle_build_log_public(p_vehicle_id) w),
  'reported_work',CASE WHEN p_include_reported IS TRUE THEN (
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'observation_id',c.id,'kind',c.kind,'report_status',c.structured_data->>'report_status',
    'occurrence_status',c.structured_data->>'occurrence_status','performer_id',c.structured_data->'performer_id','performer_status',c.structured_data->>'performer_status',
    'independent_source',c.structured_data->'independent_source','intent_status',c.structured_data->>'intent_status',
    'observed_at_basis',c.structured_data->>'observed_at_basis',
    'reported_date',c.structured_data->>'reported_date','reported_date_label',c.structured_data->>'reported_date_label','date_precision',c.structured_data->>'date_precision',
    'performed_clause',c.structured_data->>'performed_clause','source_value',c.structured_data->>'source_value',
    'source_observation_id',c.source_observation_id,'source_id',c.source_id,'source_url',c.source_url,
    'source_captured_at',c.structured_data->>'source_captured_at','source_recorded_at',c.parent_ingested_at,
    'source_capture_sha256',c.structured_data->>'source_capture_sha256','source_capture_basis',c.structured_data->>'source_capture_basis',
    'source_witness_version',c.structured_data->>'source_witness_version','observed_at',c.observed_at,'ingested_at',c.ingested_at,
    'confidence_score',c.confidence_score) ORDER BY c.structured_data->>'reported_date' DESC,c.id),'[]'::jsonb)
   FROM (SELECT DISTINCT ON (c.source_id,c.source_url,c.structured_data->>'source_value') c.*,p.ingested_at AS parent_ingested_at
    FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
    WHERE c.vehicle_id=p_vehicle_id AND c.kind='activity' AND c.extraction_method='retained_listing_reported_work_v1'
     AND c.is_superseded IS FALSE AND public.retained_reported_work_matches(p,c)
     AND public.public_text(c.structured_data->>'source_value')=c.structured_data->>'source_value'
     AND public.public_text(c.structured_data->>'performed_clause')=c.structured_data->>'performed_clause'
    ORDER BY c.source_id,c.source_url,c.structured_data->>'source_value',c.ingested_at,c.id) c
  ) ELSE '[]'::jsonb END)
  || CASE WHEN p_include_visual IS FALSE THEN '{}'::jsonb ELSE public.visual_work_build_log(p_vehicle_id) END
  || public.component_evidence_fold(p_vehicle_id);
$function$;

CREATE OR REPLACE FUNCTION public.record_supplied_reference_document(p_document jsonb,p_pages jsonb,p_reader jsonb,p_reviewed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,extensions AS $function$
DECLARE obj storage.objects%ROWTYPE; doc public.reference_documents%ROWTYPE; page jsonb; revision text; capture jsonb; seen int[]:='{}';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR jsonb_typeof(p_pages) IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_reader) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid reference contract'; END IF;
 IF p_document->>'pdf_sha256' IS NULL OR p_document->>'pdf_sha256' !~ '^[a-f0-9]{64}$'
 OR p_document->>'source_url' IS NULL OR p_document->>'source_url' !~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
 OR length(coalesce(p_document->>'title','')) NOT BETWEEN 1 AND 500
 OR coalesce(p_document->>'category','') NOT IN ('parts_catalog','service_manual','component_drawing','component_datasheet')
 OR coalesce(p_document->>'page_count','') !~ '^[0-9]{1,4}$' OR (p_document->>'page_count')::int NOT BETWEEN 1 AND 5000
 OR coalesce(p_document->>'retrieved_day','') !~ '^\d{4}-\d\d-\d\d$'
 OR isfinite((p_document->>'retrieved_day')::date) IS DISTINCT FROM true
 OR (p_document->>'retrieved_at' IS NOT NULL AND isfinite((p_document->>'retrieved_at')::timestamptz) IS DISTINCT FROM true)
 OR isfinite(p_reviewed_at) IS DISTINCT FROM true OR p_reviewed_at>clock_timestamp()+interval '5 minutes'
 OR p_reviewed_at<(p_document->>'retrieved_at')::timestamptz
 OR length(coalesce(p_reader->>'method','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reader->>'model','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reader->>'run_id','')) NOT BETWEEN 1 AND 150
 OR jsonb_array_length(p_pages) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid reference source'; END IF;
 FOR page IN SELECT value FROM jsonb_array_elements(p_pages) LOOP
  IF jsonb_typeof(page) IS DISTINCT FROM 'object' OR coalesce(page->>'page_number','') !~ '^[0-9]{1,4}$'
  OR (page->>'page_number')::int NOT BETWEEN 1 AND (p_document->>'page_count')::int
  OR (page->>'page_number')::int=ANY(seen)
  OR length(coalesce(page->>'printed_label','')) NOT BETWEEN 1 AND 250
  OR length(coalesce(page->>'extracted_text','')) NOT BETWEEN 1 AND 20000
  OR jsonb_typeof(page->'has_diagrams') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'Invalid or repeated reference page'; END IF;
  seen:=array_append(seen,(page->>'page_number')::int);
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplied-reference:'||(p_document->>'pdf_sha256'),0));
 SELECT o.* INTO obj FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id
 WHERE o.bucket_id='reference-docs' AND o.name='supplied/'||(p_document->>'pdf_sha256')||'.pdf'
 AND b.public IS TRUE FOR SHARE OF o,b;
 IF NOT FOUND OR obj.version IS NULL OR obj.user_metadata->>'sha256' IS DISTINCT FROM p_document->>'pdf_sha256'
 OR obj.user_metadata->>'source_role' IS DISTINCT FROM 'public_reference'
 OR obj.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
 OR coalesce(obj.metadata->>'size','') !~ '^[0-9]+$'
 OR (obj.metadata->>'size')::bigint NOT BETWEEN 8 AND 6291456 THEN RAISE EXCEPTION 'Retained reference bytes unavailable'; END IF;
 revision:=encode(extensions.digest(jsonb_build_object('document',p_document-'retrieved_at'-'retrieved_day','pages',p_pages,
   'object_id',obj.id,'object_version',obj.version)::text,'sha256'),'hex');
 SELECT * INTO doc FROM public.reference_documents WHERE slug='supplied-reference-'||revision FOR SHARE;
 IF FOUND THEN
  IF doc.superseded_by IS NOT NULL OR doc.file_hash IS DISTINCT FROM p_document->>'pdf_sha256'
   OR doc.source_capture->>'revision' IS DISTINCT FROM revision THEN RAISE EXCEPTION 'Reference revision withdrawn'; END IF;
  RETURN jsonb_build_object('success',true,'document_id',doc.id,'file_hash',doc.file_hash,'reference_revision',revision,'duplicate',true);
 END IF;
 capture:=jsonb_build_object('schema','supplied_reference_v1','visibility','public_reference','revision',revision,
  'storage_object_id',obj.id,'storage_version',obj.version,'retrieved_day',p_document->>'retrieved_day',
  'retrieved_at',p_document->'retrieved_at','reader',p_reader,'reviewed_at',p_reviewed_at,
  'pages_sha256',encode(extensions.digest(p_pages::text,'sha256'),'hex'));
 INSERT INTO public.reference_documents(slug,title,category,file_path,file_hash,file_size_bytes,page_count,
  base_trust_score,extraction_method,extraction_quality,extracted_at,source_url,source_capture)
 VALUES('supplied-reference-'||revision,p_document->>'title',p_document->>'category',
  'reference-docs/'||obj.name,p_document->>'pdf_sha256',(obj.metadata->>'size')::bigint,(p_document->>'page_count')::int,
  0.6,'supplied_visual_reference_v1','reviewed_excerpt',p_reviewed_at,p_document->>'source_url',capture) RETURNING * INTO doc;
 INSERT INTO public.document_pages(document_id,page_number,extracted_text,has_diagrams,extraction_method,extraction_notes,extracted_at)
 SELECT doc.id,(p->>'page_number')::int,p->>'extracted_text',(p->>'has_diagrams')::boolean,
  'supplied_visual_reference_v1',p->>'printed_label',p_reviewed_at FROM jsonb_array_elements(p_pages) p;
 RETURN jsonb_build_object('success',true,'document_id',doc.id,'file_hash',doc.file_hash,'reference_revision',revision,'duplicate',false);
END $function$;
REVOKE ALL ON FUNCTION public.record_supplied_reference_document(jsonb,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplied_reference_document(jsonb,jsonb,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.reference_assembly_evidence(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public,extensions AS $function$
DECLARE o public.vehicle_observations%ROWTYPE; d public.reference_documents%ROWTYPE; a jsonb; app jsonb; pos jsonb; ref jsonb;
 pages jsonb; seen text[]:='{}'; total int:=0; page public.document_pages%ROWTYPE;
BEGIN
 SELECT v.* INTO o FROM public.vehicle_observations v JOIN public.observation_sources s ON s.id=v.source_id
 WHERE v.id=p_observation_id AND s.slug='component-maker-documentation' AND v.kind='specification'
 AND v.vehicle_id IS NULL AND v.subject_id IS NULL AND v.is_superseded IS FALSE
 AND v.extraction_method='supplied_reference_assembly_v1' AND v.analysis_deferred IS TRUE
 AND v.confidence_score<=0.6 AND v.structured_data->>'definition_role'='manufacturer_expected_scope'
 AND v.structured_data->>'taxonomy_binding'='unresolved';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.* INTO d FROM public.reference_documents r JOIN storage.objects obj
 ON obj.bucket_id='reference-docs' AND 'reference-docs/'||obj.name=r.file_path
 JOIN storage.buckets b ON b.id=obj.bucket_id AND b.public IS TRUE
 WHERE r.id=o.citation_document_id AND r.superseded_by IS NULL
 AND r.extraction_method='supplied_visual_reference_v1' AND r.source_capture->>'visibility'='public_reference'
 AND r.source_capture->>'schema'='supplied_reference_v1' AND r.source_url=o.source_url
 AND r.file_hash=o.structured_data->>'reference_file_hash' AND o.raw_source_ref='sha256:'||r.file_hash
 AND r.source_capture->>'revision'=o.structured_data->>'reference_revision'
 AND obj.id::text=r.source_capture->>'storage_object_id' AND obj.version=r.source_capture->>'storage_version'
 AND obj.user_metadata->>'sha256'=r.file_hash AND obj.user_metadata->>'source_role'='public_reference'
 AND obj.metadata->>'mimetype'='application/pdf' AND (obj.metadata->>'size')::bigint=r.file_size_bytes;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('page_number',p.page_number,'printed_label',p.extraction_notes,
  'extracted_text',p.extracted_text,'has_diagrams',p.has_diagrams) ORDER BY p.page_number) INTO pages
 FROM public.document_pages p WHERE p.document_id=d.id AND p.extraction_method='supplied_visual_reference_v1';
 IF encode(extensions.digest(pages::text,'sha256'),'hex') IS DISTINCT FROM d.source_capture->>'pages_sha256' THEN RETURN NULL; END IF;
 a:=o.structured_data->'reference_assembly'; app:=a->'application';
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR jsonb_typeof(app) IS DISTINCT FROM 'object'
 OR coalesce(a->>'name','') !~ '^[a-z][a-z0-9_]{0,99}$'
 OR length(coalesce(a->>'category','')) NOT BETWEEN 1 AND 50
 OR length(coalesce(a->>'description','')) NOT BETWEEN 1 AND 1000 OR length(coalesce(a->>'scope','')) NOT BETWEEN 1 AND 1000
 OR coalesce(app->>'year_start','') !~ '^[0-9]{4}$' OR coalesce(app->>'year_end','') !~ '^[0-9]{4}$'
 OR (app->>'year_start')::int NOT BETWEEN 1880 AND 2100 OR (app->>'year_end')::int NOT BETWEEN (app->>'year_start')::int AND 2100
 OR length(coalesce(app->>'make','')) NOT BETWEEN 1 AND 80 OR length(coalesce(app->>'model','')) NOT BETWEEN 1 AND 80
 OR length(coalesce(app->>'body_style','')) NOT BETWEEN 1 AND 100
 OR jsonb_typeof(a->'positions') IS DISTINCT FROM 'array' OR jsonb_typeof(a->'exclusions') IS DISTINCT FROM 'array'
 OR jsonb_typeof(a->'limitations') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(a->'positions') NOT BETWEEN 1 AND 100 OR jsonb_array_length(a->'exclusions') NOT BETWEEN 1 AND 30
 OR jsonb_array_length(a->'limitations')>30 THEN RETURN NULL; END IF;
 FOR pos IN SELECT value FROM jsonb_array_elements(a->'positions') LOOP
  IF coalesce(pos->>'key','') !~ '^[a-z][a-z0-9_.]{0,149}$' OR pos->>'key'=ANY(seen)
  OR length(coalesce(pos->>'label','')) NOT BETWEEN 1 AND 250 OR pos->'subject_id' IS DISTINCT FROM 'null'::jsonb
  OR coalesce(pos->>'quantity','') !~ '^[0-9]{1,3}$' OR (pos->>'quantity')::int NOT BETWEEN 1 AND 100
  OR jsonb_typeof(pos->'source_refs') IS DISTINCT FROM 'array' OR jsonb_typeof(pos->'part_numbers') IS DISTINCT FROM 'array'
  OR coalesce(pos->>'part_number_binding','') NOT IN ('exact_position','unordered_pair') THEN RETURN NULL; END IF;
  IF jsonb_array_length(pos->'source_refs') NOT BETWEEN 1 AND 20
  OR jsonb_array_length(pos->'part_numbers') <> (CASE WHEN pos->>'part_number_binding'='exact_position' THEN 1 ELSE 2 END)
  THEN RETURN NULL; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(pos->'source_refs') LOOP
   IF coalesce(ref->>'page_number','') !~ '^[0-9]{1,4}$' OR length(coalesce(ref->>'excerpt','')) NOT BETWEEN 1 AND 2000
   OR length(coalesce(ref->>'figure','')) NOT BETWEEN 1 AND 150 OR length(coalesce(ref->>'callout','')) NOT BETWEEN 1 AND 40 THEN RETURN NULL; END IF;
   SELECT * INTO page FROM public.document_pages WHERE document_id=d.id AND page_number=(ref->>'page_number')::int;
   IF NOT FOUND OR strpos(page.extracted_text,ref->>'excerpt')=0 THEN RETURN NULL; END IF;
  END LOOP;
  seen:=array_append(seen,pos->>'key'); total:=total+(pos->>'quantity')::int;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.document_pages WHERE document_id=d.id AND page_number=o.citation_page_number
  AND length(o.citation_excerpt)>0 AND strpos(extracted_text,o.citation_excerpt)>0) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('assembly',a,'expected_piece_count',total,'taxonomy_binding','unresolved',
  'source',jsonb_build_object('observation_id',o.id,'document_id',d.id,'source_url',d.source_url,'retained_file',d.file_path,
   'file_sha256',d.file_hash,'title',d.title,'retrieved_day',d.source_capture->>'retrieved_day','retrieved_at',d.source_capture->'retrieved_at',
   'reviewed_at',o.observed_at,'reader',o.observer_raw->'reader','reference_revision',d.source_capture->>'revision'));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.reference_assembly_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reference_assembly_evidence(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.project_reference_assembly(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public,extensions AS $function$
DECLARE o public.vehicle_observations%ROWTYPE; d public.reference_documents%ROWTYPE; e jsonb; a jsonb; h text; row_id uuid; actual_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id;
 SELECT * INTO d FROM public.reference_documents WHERE id=o.citation_document_id;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Reference observation unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('reference-assembly:'||p_observation_id::text,0));
 PERFORM 1 FROM storage.buckets WHERE id='reference-docs' FOR SHARE;
 PERFORM 1 FROM storage.objects WHERE bucket_id='reference-docs' AND 'reference-docs/'||name=d.file_path FOR SHARE;
 PERFORM 1 FROM public.reference_documents WHERE id=d.id FOR SHARE;
 PERFORM 1 FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
 e:=public.reference_assembly_evidence(p_observation_id);
 IF e IS NULL OR e#>>'{source,document_id}' IS DISTINCT FROM d.id::text THEN RAISE EXCEPTION 'Reference source changed or unqualified'; END IF;
 a:=e->'assembly'; h:=encode(extensions.digest(a::text,'sha256'),'hex');
 SELECT id INTO row_id FROM public.component_assembly_map WHERE source_observation_id=p_observation_id
  AND reference_document_id=d.id AND source_payload_sha256=h;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_all_assemblies_for_vehicle((a#>>'{application,year_start}')::int,a#>>'{application,model}')) x
   WHERE x->>'assembly_id'=row_id::text) THEN RAISE EXCEPTION 'Projected assembly no longer agrees with its source'; END IF;
  RETURN jsonb_build_object('success',true,'assembly_id',row_id,'observation_id',p_observation_id,'document_id',d.id,'duplicate',true);
 END IF;
 INSERT INTO public.component_assembly_map(assembly_name,assembly_category,assembly_description,sub_components,catalog_part_map,
  application_years,application_models,source_observation_id,reference_document_id,source_payload_sha256)
 VALUES(a->>'name',a->>'category',a->>'description',(SELECT jsonb_agg(p->>'key') FROM jsonb_array_elements(a->'positions') p),
  (SELECT jsonb_object_agg(p->>'key',p) FROM jsonb_array_elements(a->'positions') p),
  (a#>>'{application,year_start}')||'-'||(a#>>'{application,year_end}'),ARRAY[a#>>'{application,model}'],p_observation_id,d.id,h)
 RETURNING id INTO row_id;
 RETURN jsonb_build_object('success',true,'assembly_id',row_id,'observation_id',p_observation_id,'document_id',d.id,'duplicate',false);
END $function$;
REVOKE ALL ON FUNCTION public.project_reference_assembly(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_reference_assembly(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_all_assemblies_for_vehicle(p_vehicle_year integer,p_vehicle_model text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public,extensions AS $function$
BEGIN
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('assembly_name',m.assembly_name,'category',m.assembly_category,
  'description',m.assembly_description,'sub_components',m.sub_components,'possible_states',m.possible_states,'state_indicators',m.state_indicators)
  || CASE WHEN m.source_observation_id IS NULL THEN jsonb_build_object('source_status','legacy_unattributed')
   ELSE jsonb_build_object('assembly_id',m.id,'source_status','current_public_reference','source',e.value->'source',
    'expected_scope',e.value#>'{assembly,scope}','application',e.value#>'{assembly,application}',
    'positions',e.value#>'{assembly,positions}','expected_piece_count',e.value->'expected_piece_count',
    'exclusions',e.value#>'{assembly,exclusions}','limitations',e.value#>'{assembly,limitations}',
    'taxonomy_binding','unresolved','whole_vehicle_expected_count',NULL) END ORDER BY m.assembly_name,m.id),'[]'::jsonb)
 FROM public.component_assembly_map m
 LEFT JOIN LATERAL (SELECT public.reference_assembly_evidence(m.source_observation_id) value) e ON m.source_observation_id IS NOT NULL
 WHERE (m.application_years IS NULL OR CASE WHEN m.application_years ~ '^[0-9]{4}-[0-9]{4}$'
  THEN p_vehicle_year BETWEEN split_part(m.application_years,'-',1)::int AND split_part(m.application_years,'-',2)::int ELSE false END)
 AND (CASE WHEN m.source_observation_id IS NULL THEN
  m.application_models IS NULL OR p_vehicle_model=ANY(m.application_models) OR p_vehicle_model ILIKE ANY(m.application_models)
  ELSE lower(p_vehicle_model)=lower(m.application_models[1]) END)
 AND (m.source_observation_id IS NULL OR (e.value IS NOT NULL
  AND m.reference_document_id::text=e.value#>>'{source,document_id}'
  AND m.source_payload_sha256=encode(extensions.digest((e.value->'assembly')::text,'sha256'),'hex')
  AND m.assembly_name=e.value#>>'{assembly,name}' AND m.assembly_category=e.value#>>'{assembly,category}'
  AND m.assembly_description=e.value#>>'{assembly,description}'
  AND m.sub_components=(SELECT jsonb_agg(p->>'key') FROM jsonb_array_elements(e.value#>'{assembly,positions}') p)
  AND m.catalog_part_map=(SELECT jsonb_object_agg(p->>'key',p) FROM jsonb_array_elements(e.value#>'{assembly,positions}') p)
  AND m.application_years=(e.value#>>'{assembly,application,year_start}')||'-'||(e.value#>>'{assembly,application,year_end}')
  AND m.application_models=ARRAY[e.value#>>'{assembly,application,model}'])));
END $function$;

CREATE OR REPLACE FUNCTION public.get_assembly_context_for_ai(p_assembly_name text,p_vehicle_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public,extensions AS $function$
DECLARE v_assembly public.component_assembly_map%ROWTYPE; v_related_parts jsonb; e jsonb;
BEGIN
 SELECT m.* INTO v_assembly FROM public.component_assembly_map m
 WHERE m.assembly_name=p_assembly_name
 AND (m.source_observation_id IS NULL OR public.reference_assembly_evidence(m.source_observation_id) IS NOT NULL)
 AND (p_vehicle_year IS NULL OR m.application_years IS NULL OR CASE WHEN m.application_years ~ '^[0-9]{4}-[0-9]{4}$'
  THEN p_vehicle_year BETWEEN split_part(m.application_years,'-',1)::int AND split_part(m.application_years,'-',2)::int ELSE false END)
 ORDER BY m.created_at DESC,m.id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_assembly.source_observation_id IS NOT NULL THEN
  SELECT x INTO e FROM jsonb_array_elements(public.get_all_assemblies_for_vehicle(
   coalesce(p_vehicle_year,split_part(v_assembly.application_years,'-',1)::int),v_assembly.application_models[1])) x
   WHERE x->>'assembly_id'=v_assembly.id::text;
  RETURN e||jsonb_build_object('related_catalog_parts','[]'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('part_number',part_number,'name',name,'price',price_current)),'[]'::jsonb)
 INTO v_related_parts FROM public.catalog_parts WHERE name ILIKE '%'||p_assembly_name||'%' LIMIT 50;
 RETURN jsonb_build_object('assembly_name',v_assembly.assembly_name,'category',v_assembly.assembly_category,
  'description',v_assembly.assembly_description,'sub_components',v_assembly.sub_components,'possible_states',v_assembly.possible_states,
  'state_indicators',v_assembly.state_indicators,'related_catalog_parts',v_related_parts,'source_status','legacy_unattributed',
  'application',jsonb_build_object('years',v_assembly.application_years,'models',v_assembly.application_models));
END $function$;

RESET lock_timeout;
RESET statement_timeout;

COMMENT ON COLUMN public.vehicle_observations.component_subject_id IS 'FK to registered component position; derived from retained_component_reading_v1 path only';
COMMENT ON COLUMN public.component_assembly_map.source_observation_id IS 'Current attributed reference reading; NULL denotes an existing legacy assembly with no established source';
