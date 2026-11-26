-- One custody qualification owner for reference pages and assembly consumers.
-- No source rows, vocabulary, grants on tables or model evaluations are changed.
SET statement_timeout = '10s';
SET lock_timeout = '2s';
DO $guard$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reference_assembly_evidence(uuid)'::regprocedure)
    IS DISTINCT FROM '44178330638c8ab3be1527357ebcd8b6' THEN
  RAISE EXCEPTION 'Reference assembly owner drift: inspect before factoring custody';
 END IF;
END $guard$;

CREATE FUNCTION public.reference_document_evidence(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $fn$
DECLARE d public.reference_documents%ROWTYPE; obj storage.objects%ROWTYPE;
 pages jsonb; revision text;
BEGIN
 SELECT r.* INTO d FROM public.reference_documents r
 JOIN storage.objects o ON o.bucket_id='reference-docs' AND 'reference-docs/'||o.name=r.file_path
 JOIN storage.buckets b ON b.id=o.bucket_id AND b.public IS TRUE
 WHERE r.id=p_document_id AND r.superseded_by IS NULL
 AND r.extraction_method='supplied_visual_reference_v1'
 AND r.source_capture->>'schema'='supplied_reference_v1'
 AND r.source_capture->>'visibility'='public_reference'
 AND r.file_hash ~ '^[a-f0-9]{64}$'
 AND r.source_capture->>'revision' ~ '^[a-f0-9]{64}$'
 AND r.source_url ~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
 AND r.file_size_bytes BETWEEN 8 AND 6291456 AND r.page_count BETWEEN 1 AND 5000
 AND o.name='supplied/'||r.file_hash||'.pdf'
 AND o.id::text=r.source_capture->>'storage_object_id'
 AND o.version=r.source_capture->>'storage_version'
 AND o.user_metadata->>'sha256'=r.file_hash
 AND o.user_metadata->>'source_role'='public_reference'
 AND o.metadata->>'mimetype'='application/pdf'
 AND (o.metadata->>'size')::bigint=r.file_size_bytes;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO obj FROM storage.objects WHERE id=(d.source_capture->>'storage_object_id')::uuid;
 SELECT jsonb_agg(jsonb_build_object('page_number',p.page_number,'printed_label',p.extraction_notes,
  'extracted_text',p.extracted_text,'has_diagrams',p.has_diagrams) ORDER BY p.page_number) INTO pages
 FROM public.document_pages p WHERE p.document_id=d.id AND p.extraction_method='supplied_visual_reference_v1';
 IF pages IS NULL OR jsonb_array_length(pages) NOT BETWEEN 1 AND 30
 OR encode(extensions.digest(pages::text,'sha256'),'hex') IS DISTINCT FROM d.source_capture->>'pages_sha256'
 THEN RETURN NULL; END IF;
 -- Rebuild the admission fingerprint, including source URL, title/category/page
 -- count. A changed metadata row cannot continue under an old source revision.
 revision:=encode(extensions.digest(jsonb_build_object('document',jsonb_build_object(
  'title',d.title,'category',d.category,'source_url',d.source_url,'pdf_sha256',d.file_hash,'page_count',d.page_count),
  'pages',pages,'object_id',obj.id,'object_version',obj.version)::text,'sha256'),'hex');
 IF revision IS DISTINCT FROM d.source_capture->>'revision' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('document_id',d.id,'source_url',d.source_url,'retained_file',d.file_path,
  'file_sha256',d.file_hash,'title',d.title,'reference_revision',revision,
  'reviewed_at',d.source_capture->'reviewed_at','reader',d.source_capture->'reader',
  'retrieved_day',d.source_capture->'retrieved_day','retrieved_at',d.source_capture->'retrieved_at',
  'retained_page_count',jsonb_array_length(pages),'pages_sha256',d.source_capture->>'pages_sha256');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.reference_document_evidence(uuid) IS
 'Current public-reference custody only: exact retained object/version/hash, reviewed page fingerprint and source metadata revision; NULL on withdrawal or mismatch. Does not qualify any electrical or installed-state claim. Shared by reference_assembly_evidence; service role only.';
REVOKE ALL ON FUNCTION public.reference_document_evidence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reference_document_evidence(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reference_assembly_evidence(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $$
DECLARE o public.vehicle_observations%ROWTYPE; d public.reference_documents%ROWTYPE; a jsonb; app jsonb; pos jsonb; ref jsonb;
 seen text[]:='{}'; total int:=0; page public.document_pages%ROWTYPE; pn text; pn_found boolean;
BEGIN
 SELECT v.* INTO o FROM public.vehicle_observations v JOIN public.observation_sources s ON s.id=v.source_id
 WHERE v.id=p_observation_id AND s.slug='component-maker-documentation' AND v.kind='specification'
 AND v.vehicle_id IS NULL AND v.subject_id IS NULL AND v.is_superseded IS FALSE
 AND v.extraction_method='supplied_reference_assembly_v1' AND v.analysis_deferred IS TRUE
 AND v.confidence_score<=0.6 AND v.structured_data->>'definition_role'='manufacturer_expected_scope'
 AND v.structured_data->>'taxonomy_binding'='unresolved';
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- The shared custody owner rechecks retained bytes, pages and metadata revision.
 SELECT r.* INTO d FROM public.reference_documents r
 WHERE r.id=o.citation_document_id AND public.reference_document_evidence(r.id) IS NOT NULL
 AND r.source_url=o.source_url AND r.file_hash=o.structured_data->>'reference_file_hash'
 AND o.raw_source_ref='sha256:'||r.file_hash
 AND r.source_capture->>'revision'=o.structured_data->>'reference_revision';
 IF NOT FOUND THEN RETURN NULL; END IF;
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
  -- Validate each part number appears in at least one source_ref excerpt
  FOR pn IN SELECT trim(x::text, '"') FROM jsonb_array_elements(pos->'part_numbers') x LOOP
   pn_found := false;
   FOR ref IN SELECT value FROM jsonb_array_elements(pos->'source_refs') LOOP
    IF ref->>'excerpt' LIKE '%' || pn || '%' THEN pn_found := true; EXIT; END IF;
   END LOOP;
   IF NOT pn_found THEN RETURN NULL; END IF;
  END LOOP;
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
END $$;

COMMENT ON FUNCTION public.reference_assembly_evidence(uuid) IS
 'Validate source-bound assembly evidence and exact cited part numbers, reusing reference_document_evidence for current retained source custody.';
NOTIFY pgrst, 'reload schema';
