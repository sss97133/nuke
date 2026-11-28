-- Extend the existing page-word evidence to a retained whole catalog PDF.
-- A page of one document is not converted into another reference document.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

ALTER TABLE public.document_page_word_extractions
 ADD COLUMN source_basis text NOT NULL DEFAULT 'catalog_page_membership_v1',
 ADD COLUMN geometry_attestation jsonb,
 ADD COLUMN geometry_attestation_sha256 text,
 ADD CONSTRAINT document_page_word_geometry_basis_shape CHECK ((
  (source_basis='catalog_page_membership_v1' AND geometry_attestation IS NULL AND geometry_attestation_sha256 IS NULL)
  OR (source_basis='catalog_document_v1' AND jsonb_typeof(geometry_attestation)='object'
   AND geometry_attestation_sha256 ~ '^[a-f0-9]{64}$')
 ) IS TRUE);

CREATE OR REPLACE FUNCTION public.catalog_page_word_geometry_evidence(p_extraction uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE r public.document_page_word_extractions%ROWTYPE; l public.catalog_reference_documents%ROWTYPE;
 g jsonb; source_evidence jsonb; att jsonb;
BEGIN
 SELECT * INTO r FROM public.document_page_word_extractions WHERE id=p_extraction;
 IF r.id IS NULL THEN RETURN NULL; END IF;
 IF r.source_basis='catalog_page_membership_v1' THEN
  IF public.catalog_page_member_evidence(r.catalog_id,r.catalog_page_number,r.catalog_edition_sha256) IS NULL
   THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.catalog_reference_documents WHERE catalog_id=r.catalog_id
   AND catalog_page_number=r.catalog_page_number AND document_page_id=r.page_id
   AND reference_document_id=r.document_id AND page_mapping_receipt->>'full_pdf_sha256'=r.catalog_edition_sha256;
  IF l.catalog_id IS NULL OR l.source_revision IS DISTINCT FROM r.source_revision
   OR l.page_mapping_receipt->>'source_pdf_sha256' IS DISTINCT FROM r.pdf_sha256
   OR l.page_mapping_receipt->>'word_geometry_sha256' IS DISTINCT FROM r.geometry_sha256
   OR l.page_mapping_receipt->>'reader_actor' IS DISTINCT FROM r.reader_actor
   OR l.page_mapping_receipt->>'reader_run_id' IS DISTINCT FROM r.reader_run_id
   OR (l.page_mapping_receipt->>'reader_verified_at')::timestamptz IS DISTINCT FROM r.reader_verified_at
   THEN RETURN NULL; END IF;
 ELSIF r.source_basis='catalog_document_v1' THEN
  source_evidence:=public.catalog_text_source_evidence(r.document_id); att:=r.geometry_attestation;
  IF source_evidence IS NULL OR source_evidence->>'catalog_id' IS DISTINCT FROM r.catalog_id::text
   OR source_evidence->>'revision' IS DISTINCT FROM r.source_revision
   OR source_evidence->>'pdf_sha256_attestation' IS DISTINCT FROM r.pdf_sha256
   OR r.catalog_edition_sha256 IS DISTINCT FROM r.pdf_sha256
   OR NOT EXISTS(SELECT 1 FROM public.document_pages p WHERE p.id=r.page_id AND p.document_id=r.document_id
      AND p.page_number=r.catalog_page_number)
   OR NOT EXISTS(SELECT 1 FROM public.catalog_reference_documents x WHERE x.catalog_id=r.catalog_id
      AND x.reference_document_id=r.document_id AND x.source_revision=r.source_revision
      AND x.catalog_page_number IS NULL AND x.document_page_id IS NULL)
   OR jsonb_typeof(att) IS DISTINCT FROM 'object'
   OR r.geometry_attestation_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(att::text,'UTF8'),'sha256'),'hex')
   OR att->>'schema' IS DISTINCT FROM 'catalog_document_word_geometry_client_attested_v1'
   OR att->>'catalog_id' IS DISTINCT FROM r.catalog_id::text OR att->>'document_id' IS DISTINCT FROM r.document_id::text
   OR att->>'page_id' IS DISTINCT FROM r.page_id::text OR (att->>'page_number')::integer IS DISTINCT FROM r.catalog_page_number
   OR att->>'source_revision' IS DISTINCT FROM r.source_revision OR att->>'pdf_sha256' IS DISTINCT FROM r.pdf_sha256
   OR att->>'geometry_sha256' IS DISTINCT FROM r.geometry_sha256 OR att->>'extractor_method' IS DISTINCT FROM r.extractor_method
   OR att->>'extractor_version' IS DISTINCT FROM r.extractor_version OR att->>'reader_actor' IS DISTINCT FROM r.reader_actor
   OR att->>'reader_run_id' IS DISTINCT FROM r.reader_run_id
   OR (att->>'reader_verified_at')::timestamptz IS DISTINCT FROM r.reader_verified_at
   OR att->>'geometry_status' IS DISTINCT FROM 'client_attested_not_server_reextracted'
   THEN RETURN NULL; END IF;
 ELSE RETURN NULL;
 END IF;
 IF encode(extensions.digest(convert_to(r.geometry_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r.geometry_sha256
  OR encode(extensions.digest(convert_to(r.extractor_version,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r.extractor_version_sha256
  THEN RETURN NULL; END IF;
 g:=r.geometry_text::jsonb;
 IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR jsonb_typeof(g->'words') IS DISTINCT FROM 'array'
  OR (g->>'width')::numeric IS DISTINCT FROM r.page_width OR (g->>'height')::numeric IS DISTINCT FROM r.page_height
  OR jsonb_array_length(g->'words') IS DISTINCT FROM r.word_count
  OR (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=r.id)<>r.word_count
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(g->'words') WITH ORDINALITY AS t(v,n)
   LEFT JOIN public.document_page_word_regions w ON w.extraction_id=r.id AND w.word_ordinal=t.n
   WHERE w.extraction_id IS NULL OR w.word_text IS DISTINCT FROM t.v->>4
    OR w.x_min IS DISTINCT FROM (t.v->>0)::numeric OR w.y_min IS DISTINCT FROM (t.v->>1)::numeric
    OR w.x_max IS DISTINCT FROM (t.v->>2)::numeric OR w.y_max IS DISTINCT FROM (t.v->>3)::numeric)
  THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('extraction_id',r.id,'document_id',r.document_id,'page_id',r.page_id,
  'catalog_id',r.catalog_id,'catalog_page_number',r.catalog_page_number,'word_count',r.word_count,
  'geometry_sha256',r.geometry_sha256,'source_revision',r.source_revision,'extractor_method',r.extractor_method,
  'extractor_version',r.extractor_version,'source_basis',r.source_basis,
  'geometry_status','client_attested_not_server_reextracted');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value
 OR invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END $fn$;

CREATE FUNCTION public.record_catalog_document_page_word_geometry(p_catalog uuid,p_document uuid,p_page integer,
 p_pdf_sha256 text,p_geometry text,p_extractor_version text,p_actor text,p_run_id text,p_verified_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE c public.catalog_sources%ROWTYPE; d public.reference_documents%ROWTYPE; p public.document_pages%ROWTYPE;
 l public.catalog_reference_documents%ROWTYPE; r public.document_page_word_extractions%ROWTYPE;
 source_evidence jsonb; att jsonb; g jsonb; geom_sha text; obj_id uuid;
 width_value numeric; height_value numeric; wcount integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_catalog IS NULL OR p_document IS NULL OR p_page NOT BETWEEN 1 AND 5000
  OR coalesce(p_pdf_sha256,'') !~ '^[a-f0-9]{64}$' OR p_geometry IS NULL OR octet_length(p_geometry)>1048576
  OR length(coalesce(p_extractor_version,'')) NOT BETWEEN 1 AND 200 OR p_extractor_version<>btrim(p_extractor_version)
  OR p_extractor_version !~ '^[[:print:]]+$' OR length(coalesce(p_actor,'')) NOT BETWEEN 1 AND 100
  OR p_actor<>btrim(p_actor) OR p_actor !~ '^[[:print:]]+$' OR length(coalesce(p_run_id,'')) NOT BETWEEN 1 AND 150
  OR p_run_id<>btrim(p_run_id) OR p_run_id !~ '^[[:print:]]+$' OR p_verified_at IS NULL
  OR NOT isfinite(p_verified_at) OR p_verified_at>clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid document page word geometry contract'; END IF;
 SELECT * INTO c FROM public.catalog_sources WHERE id=p_catalog FOR SHARE NOWAIT;
 SELECT (source_capture->>'storage_object_id')::uuid INTO obj_id FROM public.reference_documents WHERE id=p_document;
 PERFORM o.id FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id WHERE o.id=obj_id FOR SHARE OF o,b NOWAIT;
 IF c.id IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Retained catalog source unavailable'; END IF;
 SELECT * INTO d FROM public.reference_documents WHERE id=p_document FOR SHARE NOWAIT;
 -- Qualification hashes the entire retained transcript. Lock all pages before
 -- checking it so another page cannot change between qualification and commit.
 PERFORM id FROM public.document_pages WHERE document_id=p_document ORDER BY page_number FOR SHARE NOWAIT;
 SELECT * INTO p FROM public.document_pages WHERE document_id=p_document AND page_number=p_page;
 SELECT * INTO l FROM public.catalog_reference_documents WHERE catalog_id=p_catalog AND reference_document_id=p_document
  AND catalog_page_number IS NULL AND document_page_id IS NULL FOR SHARE NOWAIT;
 source_evidence:=public.catalog_text_source_evidence(p_document);
 IF p.id IS NULL OR l.catalog_id IS NULL OR source_evidence IS NULL
  OR source_evidence->>'catalog_id' IS DISTINCT FROM c.id::text OR source_evidence->>'revision' IS DISTINCT FROM l.source_revision
  OR source_evidence->>'pdf_sha256_attestation' IS DISTINCT FROM p_pdf_sha256 OR d.file_hash IS DISTINCT FROM p_pdf_sha256
  THEN RAISE EXCEPTION 'Qualified whole catalog page unavailable'; END IF;
 g:=p_geometry::jsonb;
 IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(g))<>3
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(g) k WHERE k NOT IN ('width','height','words'))
  OR jsonb_typeof(g->'width') IS DISTINCT FROM 'string' OR jsonb_typeof(g->'height') IS DISTINCT FROM 'string'
  OR coalesce(g->>'width','') !~ '^[0-9]{1,6}([.][0-9]{1,8})?$'
  OR coalesce(g->>'height','') !~ '^[0-9]{1,6}([.][0-9]{1,8})?$'
  OR jsonb_typeof(g->'words') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid word geometry shape'; END IF;
 width_value:=(g->>'width')::numeric; height_value:=(g->>'height')::numeric; wcount:=jsonb_array_length(g->'words');
 IF width_value NOT BETWEEN 0.000001 AND 100000 OR height_value NOT BETWEEN 0.000001 AND 100000 OR wcount>5000
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(g->'words') w
   WHERE jsonb_typeof(w) IS DISTINCT FROM 'array' OR jsonb_array_length(w)<>5
    OR jsonb_typeof(w->0) IS DISTINCT FROM 'string' OR jsonb_typeof(w->1) IS DISTINCT FROM 'string'
    OR jsonb_typeof(w->2) IS DISTINCT FROM 'string' OR jsonb_typeof(w->3) IS DISTINCT FROM 'string'
    OR jsonb_typeof(w->4) IS DISTINCT FROM 'string' OR length(w->>4) NOT BETWEEN 1 AND 4000
    OR coalesce(w->>0,'') !~ '^-?[0-9]{1,6}([.][0-9]{1,8})?$'
    OR coalesce(w->>1,'') !~ '^-?[0-9]{1,6}([.][0-9]{1,8})?$'
    OR coalesce(w->>2,'') !~ '^-?[0-9]{1,6}([.][0-9]{1,8})?$'
    OR coalesce(w->>3,'') !~ '^-?[0-9]{1,6}([.][0-9]{1,8})?$'
    OR (w->>0)::numeric NOT BETWEEN -100000 AND 100000 OR (w->>1)::numeric NOT BETWEEN -100000 AND 100000
    OR (w->>2)::numeric NOT BETWEEN -100000 AND 100000 OR (w->>3)::numeric NOT BETWEEN -100000 AND 100000)
  THEN RAISE EXCEPTION 'Invalid word geometry values'; END IF;
 geom_sha:=encode(extensions.digest(convert_to(p_geometry,'UTF8'),'sha256'),'hex');
 att:=jsonb_build_object('schema','catalog_document_word_geometry_client_attested_v1','catalog_id',c.id,
  'document_id',d.id,'page_id',p.id,'page_number',p_page,'source_revision',l.source_revision,'pdf_sha256',p_pdf_sha256,
  'geometry_sha256',geom_sha,'extractor_method','poppler_pdftotext_bbox_layout','extractor_version',p_extractor_version,
  'reader_actor',p_actor,'reader_run_id',p_run_id,'reader_verified_at',p_verified_at,
  'geometry_status','client_attested_not_server_reextracted');
 PERFORM pg_advisory_xact_lock(hashtextextended('document-page-word-geometry:'||p.id::text||':'||geom_sha,0));
 SELECT * INTO r FROM public.document_page_word_extractions WHERE page_id=p.id AND source_revision=l.source_revision
  AND geometry_sha256=geom_sha AND catalog_id=c.id AND catalog_edition_sha256=p_pdf_sha256
  AND extractor_version=p_extractor_version FOR SHARE;
 IF FOUND THEN
  IF r.source_basis IS DISTINCT FROM 'catalog_document_v1' OR r.geometry_text IS DISTINCT FROM p_geometry
   OR r.geometry_attestation IS DISTINCT FROM att OR public.catalog_page_word_geometry_evidence(r.id) IS NULL
   THEN RAISE EXCEPTION 'Existing word geometry differs or is held'; END IF;
  RETURN jsonb_build_object('success',true,'extraction_id',r.id,'page_id',r.page_id,'word_count',r.word_count,
   'extractor_version',r.extractor_version,'duplicate',true,'geometry_status','client_attested_not_server_reextracted');
 END IF;
 INSERT INTO public.document_page_word_extractions(document_id,page_id,catalog_id,catalog_page_number,catalog_edition_sha256,
  source_revision,pdf_sha256,geometry_sha256,extractor_method,extractor_version,extractor_version_sha256,geometry_text,
  page_width,page_height,word_count,reader_actor,reader_run_id,reader_verified_at,source_basis,geometry_attestation,geometry_attestation_sha256)
 VALUES(d.id,p.id,c.id,p_page,p_pdf_sha256,l.source_revision,p_pdf_sha256,geom_sha,'poppler_pdftotext_bbox_layout',p_extractor_version,
  encode(extensions.digest(convert_to(p_extractor_version,'UTF8'),'sha256'),'hex'),p_geometry,width_value,height_value,wcount,
  p_actor,p_run_id,p_verified_at,'catalog_document_v1',att,encode(extensions.digest(convert_to(att::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO r;
 INSERT INTO public.document_page_word_regions(extraction_id,word_ordinal,word_text,x_min,y_min,x_max,y_max)
 SELECT r.id,t.n::integer,t.v->>4,(t.v->>0)::numeric,(t.v->>1)::numeric,(t.v->>2)::numeric,(t.v->>3)::numeric
 FROM jsonb_array_elements(g->'words') WITH ORDINALITY AS t(v,n) ORDER BY t.n;
 IF public.catalog_page_word_geometry_evidence(r.id) IS NULL THEN RAISE EXCEPTION 'Word geometry receipt incomplete'; END IF;
 RETURN jsonb_build_object('success',true,'extraction_id',r.id,'page_id',r.page_id,'word_count',r.word_count,
  'extractor_version',r.extractor_version,'duplicate',false,'geometry_status','client_attested_not_server_reextracted');
END $fn$;
REVOKE ALL ON FUNCTION public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz)
 TO service_role;
COMMENT ON FUNCTION public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz) IS
 'Service-only client-attested word geometry for a page of an existing retained whole catalog; no listing, fitment or vehicle claim.';
COMMIT;
