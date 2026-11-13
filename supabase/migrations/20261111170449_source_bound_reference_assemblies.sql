-- Public manufacturer reference expectations, not vehicle installation facts.
SET lock_timeout = '5s';
SET statement_timeout = '10s';

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_all_assemblies_for_vehicle(integer,text)'::regprocedure)) <> '0db99a9e6259a3c65f4a1b18845cdce4'
 OR md5(pg_get_functiondef('public.get_assembly_context_for_ai(text,integer)'::regprocedure)) <> 'a0db0e213c30b11455eecb485e0f239e' THEN
  RAISE EXCEPTION 'Assembly owner drift: inspect before replacing';
 END IF;
END $guard$;

ALTER TABLE public.reference_documents ADD COLUMN source_url text, ADD COLUMN source_capture jsonb;
ALTER TABLE public.component_assembly_map
 ADD COLUMN source_observation_id uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN reference_document_id uuid REFERENCES public.reference_documents(id),
 ADD COLUMN source_payload_sha256 text;
CREATE UNIQUE INDEX component_assembly_map_source_observation_unique
 ON public.component_assembly_map(source_observation_id) WHERE source_observation_id IS NOT NULL;

CREATE FUNCTION public.record_supplied_reference_document(p_document jsonb,p_pages jsonb,p_reader jsonb,p_reviewed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $function$
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
 -- Current object identity is part of the revision. Recovered bytes never revive a withdrawn old record.
 revision:=encode(public.digest(jsonb_build_object('document',p_document-'retrieved_at'-'retrieved_day','pages',p_pages,
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
  'pages_sha256',encode(public.digest(p_pages::text,'sha256'),'hex'));
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

-- This qualifier returns only a current public-reference expectation, never raw private testimony.
CREATE FUNCTION public.reference_assembly_evidence(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $function$
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
 IF encode(public.digest(pages::text,'sha256'),'hex') IS DISTINCT FROM d.source_capture->>'pages_sha256' THEN RETURN NULL; END IF;
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

CREATE FUNCTION public.project_reference_assembly(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $function$
DECLARE o public.vehicle_observations%ROWTYPE; d public.reference_documents%ROWTYPE; e jsonb; a jsonb; h text; row_id uuid; actual_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id;
 SELECT * INTO d FROM public.reference_documents WHERE id=o.citation_document_id;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Reference observation unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('reference-assembly:'||p_observation_id::text,0));
 -- Same order as intake: bucket/object, document, observation. Recheck after all locks.
 PERFORM 1 FROM storage.buckets WHERE id='reference-docs' FOR SHARE;
 PERFORM 1 FROM storage.objects WHERE bucket_id='reference-docs' AND 'reference-docs/'||name=d.file_path FOR SHARE;
 PERFORM 1 FROM public.reference_documents WHERE id=d.id FOR SHARE;
 PERFORM 1 FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
 e:=public.reference_assembly_evidence(p_observation_id);
 IF e IS NULL OR e#>>'{source,document_id}' IS DISTINCT FROM d.id::text THEN RAISE EXCEPTION 'Reference source changed or unqualified'; END IF;
 a:=e->'assembly'; h:=encode(public.digest(a::text,'sha256'),'hex');
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
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $function$
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
  AND m.source_payload_sha256=encode(public.digest((e.value->'assembly')::text,'sha256'),'hex')
  AND m.assembly_name=e.value#>>'{assembly,name}' AND m.assembly_category=e.value#>>'{assembly,category}'
  AND m.assembly_description=e.value#>>'{assembly,description}'
  AND m.sub_components=(SELECT jsonb_agg(p->>'key') FROM jsonb_array_elements(e.value#>'{assembly,positions}') p)
  AND m.catalog_part_map=(SELECT jsonb_object_agg(p->>'key',p) FROM jsonb_array_elements(e.value#>'{assembly,positions}') p)
  AND m.application_years=(e.value#>>'{assembly,application,year_start}')||'-'||(e.value#>>'{assembly,application,year_end}')
  AND m.application_models=ARRAY[e.value#>>'{assembly,application,model}'])));
END $function$;

CREATE OR REPLACE FUNCTION public.get_assembly_context_for_ai(p_assembly_name text,p_vehicle_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $function$
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

-- Extend the existing visibility-gated component fold; no new public table access.
DO $fold$
DECLARE original text; changed text;
 needle text:=' RETURN jsonb_build_object(''component_evidence'',jsonb_build_object(''version'',1,''as_of'',statement_timestamp(),';
 expected_query text:=$query$
 SELECT coalesce(jsonb_agg(entry||jsonb_build_object('applicability',jsonb_build_object(
  'status',CASE WHEN nullif(btrim(v.body_style),'') IS NULL THEN 'body_style_unverified' ELSE 'matched_year_make_model_body_style' END,
  'actual_body_style',v.body_style)) ORDER BY entry->>'assembly_name',entry->>'assembly_id'),'[]'::jsonb) INTO expected
 FROM public.vehicles v CROSS JOIN LATERAL jsonb_array_elements(public.get_all_assemblies_for_vehicle(v.year,v.model)) entry
 WHERE v.id=p_vehicle AND entry->>'source_status'='current_public_reference'
 AND lower(entry#>>'{application,make}')=lower(v.make)
 AND (nullif(btrim(v.body_style),'') IS NULL OR regexp_replace(lower(v.body_style),'[^a-z0-9]','','g')=
  regexp_replace(lower(entry#>>'{application,body_style}'),'[^a-z0-9]','','g'));
$query$;
BEGIN
 IF to_regprocedure('public.component_evidence_fold(uuid)') IS NULL
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.component_evidence_fold(uuid)'::regprocedure) <> '8be767482a198c18749ead9a844fa13b'
 THEN RAISE EXCEPTION 'Component fold prerequisite missing or changed'; END IF;
 original:=pg_get_functiondef('public.component_evidence_fold(uuid)'::regprocedure);
 IF position(needle IN original)=0 OR position('qualified integer:=0; result jsonb;' IN original)=0 THEN
  RAISE EXCEPTION 'Component fold splice unavailable'; END IF;
 changed:=replace(original,'qualified integer:=0; result jsonb;','qualified integer:=0; result jsonb; expected jsonb;');
 changed:=replace(changed,needle,expected_query||needle);
 changed:=replace(changed,'''expected_population'',jsonb_build_object(''status'',''unknown'',''reason'',''no_applicable_registered_template''),',
  '''expected_assemblies'',expected,''expected_population'',jsonb_build_object(''status'',''unknown'',''reason'',CASE WHEN jsonb_array_length(expected)>0 THEN ''partial_reference_scope_only'' ELSE ''no_applicable_registered_template'' END),');
 IF changed=original OR position('''expected_assemblies'',expected' IN changed)=0 THEN RAISE EXCEPTION 'Component fold splice failed'; END IF;
 EXECUTE changed;
END $fold$;

COMMENT ON FUNCTION public.record_supplied_reference_document(jsonb,jsonb,jsonb,timestamptz) IS
 'Service-only supplied public reference intake. Retains reviewed excerpts in existing document owners, bound to an existing immutable content-addressed PDF object. No model calls, vehicle filing, installation or trust promotion.';
COMMENT ON FUNCTION public.project_reference_assembly(uuid) IS
 'Projects one current attributed manufacturer expectation into component_assembly_map. Keeps unresolved taxonomy positions explicit; source/currentness is rechecked by existing assembly resolvers. No whole-vehicle denominator or installed-state inference.';
COMMENT ON COLUMN public.component_assembly_map.source_observation_id IS 'Current attributed reference reading; NULL denotes an existing legacy assembly with no established source.';
