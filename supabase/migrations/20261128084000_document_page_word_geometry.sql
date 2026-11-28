-- Extend retained document pages with a keyed, client-attested PDF word read.
-- Geometry is source evidence, not a listing, part, fitment or installed state.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

CREATE TABLE public.document_page_word_extractions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 page_id uuid NOT NULL,
 catalog_id uuid NOT NULL REFERENCES public.catalog_sources(id),
 catalog_page_number integer NOT NULL CHECK (catalog_page_number BETWEEN 1 AND 5000),
 catalog_edition_sha256 text NOT NULL CHECK (catalog_edition_sha256 ~ '^[a-f0-9]{64}$'),
 source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
 pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
 geometry_sha256 text NOT NULL CHECK (geometry_sha256 ~ '^[a-f0-9]{64}$'),
 extractor_method text NOT NULL CHECK (extractor_method='poppler_pdftotext_bbox_layout'),
 extractor_version text NOT NULL CHECK (length(extractor_version) BETWEEN 1 AND 200),
 extractor_version_sha256 text NOT NULL CHECK (extractor_version_sha256 ~ '^[a-f0-9]{64}$'),
 geometry_text text NOT NULL CHECK (octet_length(geometry_text) <= 1048576),
 page_width numeric NOT NULL CHECK (page_width > 0 AND page_width <= 100000),
 page_height numeric NOT NULL CHECK (page_height > 0 AND page_height <= 100000),
 word_count integer NOT NULL CHECK (word_count BETWEEN 0 AND 5000),
 reader_actor text NOT NULL,
 reader_run_id text NOT NULL,
 reader_verified_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (page_id,document_id) REFERENCES public.document_pages(id,document_id),
 UNIQUE (page_id,source_revision,geometry_sha256,catalog_id,catalog_edition_sha256,extractor_version)
);

CREATE TABLE public.document_page_word_regions (
 extraction_id uuid NOT NULL REFERENCES public.document_page_word_extractions(id),
 word_ordinal integer NOT NULL CHECK (word_ordinal BETWEEN 1 AND 5000),
 word_text text NOT NULL CHECK (length(word_text) BETWEEN 1 AND 4000),
 x_min numeric NOT NULL CHECK (x_min BETWEEN -100000 AND 100000),
 y_min numeric NOT NULL CHECK (y_min BETWEEN -100000 AND 100000),
 x_max numeric NOT NULL CHECK (x_max BETWEEN -100000 AND 100000),
 y_max numeric NOT NULL CHECK (y_max BETWEEN -100000 AND 100000),
 PRIMARY KEY (extraction_id,word_ordinal)
);
CREATE INDEX document_page_word_extractions_page_idx
 ON public.document_page_word_extractions(page_id,source_revision);
ALTER TABLE public.document_page_word_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_page_word_regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_page_word_extractions,public.document_page_word_regions
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_page_word_extractions,public.document_page_word_regions TO service_role;
COMMENT ON TABLE public.document_page_word_extractions IS
 'Client-attested PDF word extraction on an existing retained document page; the catalog source and raw geometry are requalified. Does not assert a part, fitment or physical state.';
COMMENT ON TABLE public.document_page_word_regions IS
 'One ordered word and its raw top-left-origin Poppler PDF-point rectangle in an attributed page extraction. Coordinates outside page bounds are retained as source evidence, not clipped.';
COMMENT ON COLUMN public.document_page_word_regions.word_ordinal IS
 'One-based extractor order within this exact geometry revision, not a catalog callout or text offset.';

CREATE FUNCTION public.catalog_page_word_geometry_evidence(p_extraction uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE r public.document_page_word_extractions%ROWTYPE; l public.catalog_reference_documents%ROWTYPE;
 g jsonb;
BEGIN
 SELECT * INTO r FROM public.document_page_word_extractions WHERE id=p_extraction;
 IF r.id IS NULL OR public.catalog_page_member_evidence(r.catalog_id,r.catalog_page_number,r.catalog_edition_sha256) IS NULL
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
  OR encode(extensions.digest(convert_to(r.geometry_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r.geometry_sha256
  OR encode(extensions.digest(convert_to(r.extractor_version,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r.extractor_version_sha256
  THEN RETURN NULL; END IF;
 g:=r.geometry_text::jsonb;
 IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR jsonb_typeof(g->'words') IS DISTINCT FROM 'array'
  OR (g->>'width')::numeric IS DISTINCT FROM r.page_width
  OR (g->>'height')::numeric IS DISTINCT FROM r.page_height
  OR jsonb_array_length(g->'words') IS DISTINCT FROM r.word_count
  OR (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=r.id)<>r.word_count
  OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(g->'words') WITH ORDINALITY AS t(v,n)
   LEFT JOIN public.document_page_word_regions w ON w.extraction_id=r.id AND w.word_ordinal=t.n
   WHERE w.extraction_id IS NULL OR w.word_text IS DISTINCT FROM t.v->>4
    OR w.x_min IS DISTINCT FROM (t.v->>0)::numeric OR w.y_min IS DISTINCT FROM (t.v->>1)::numeric
    OR w.x_max IS DISTINCT FROM (t.v->>2)::numeric OR w.y_max IS DISTINCT FROM (t.v->>3)::numeric
  ) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('extraction_id',r.id,'document_id',r.document_id,'page_id',r.page_id,
  'catalog_id',r.catalog_id,'catalog_page_number',r.catalog_page_number,'word_count',r.word_count,
  'geometry_sha256',r.geometry_sha256,'source_revision',r.source_revision,'extractor_method',r.extractor_method,
  'extractor_version',r.extractor_version,
  'geometry_status','client_attested_not_server_reextracted');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value
 OR invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.catalog_page_word_geometry_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_page_word_geometry_evidence(uuid) TO service_role;

CREATE FUNCTION public.record_catalog_page_word_geometry(p_catalog uuid,p_page integer,p_edition_sha256 text,p_geometry text,p_extractor_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE c public.catalog_sources%ROWTYPE; l public.catalog_reference_documents%ROWTYPE;
 d public.reference_documents%ROWTYPE; p public.document_pages%ROWTYPE; r public.document_page_word_extractions%ROWTYPE;
 obj_id uuid; g jsonb; geom_sha text; wcount integer; width_value numeric; height_value numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_catalog IS NULL OR p_page NOT BETWEEN 1 AND 5000 OR p_edition_sha256 !~ '^[a-f0-9]{64}$'
  OR p_geometry IS NULL OR octet_length(p_geometry)>1048576 OR length(coalesce(p_extractor_version,'')) NOT BETWEEN 1 AND 200
  OR p_extractor_version<>btrim(p_extractor_version) OR p_extractor_version !~ '^[[:print:]]+$'
  THEN RAISE EXCEPTION 'Invalid word geometry contract'; END IF;
 SELECT * INTO c FROM public.catalog_sources WHERE id=p_catalog FOR SHARE NOWAIT;
 SELECT * INTO l FROM public.catalog_reference_documents WHERE catalog_id=p_catalog AND catalog_page_number=p_page
  AND page_mapping_receipt->>'full_pdf_sha256'=p_edition_sha256;
 IF c.id IS NULL OR l.catalog_id IS NULL OR public.catalog_page_member_evidence(p_catalog,p_page,p_edition_sha256) IS NULL
  THEN RAISE EXCEPTION 'Catalog page membership unavailable'; END IF;
 -- Match source-writer lock order: catalog, storage object/bucket, document, page, link.
 SELECT (source_capture->>'storage_object_id')::uuid INTO obj_id FROM public.reference_documents WHERE id=l.reference_document_id;
 PERFORM o.id FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id WHERE o.id=obj_id FOR SHARE OF o,b NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retained source object unavailable'; END IF;
 SELECT * INTO d FROM public.reference_documents WHERE id=l.reference_document_id FOR SHARE NOWAIT;
 SELECT * INTO p FROM public.document_pages WHERE id=l.document_page_id AND document_id=d.id FOR SHARE NOWAIT;
 SELECT * INTO l FROM public.catalog_reference_documents WHERE catalog_id=p_catalog AND catalog_page_number=p_page
  AND document_page_id=p.id AND reference_document_id=d.id AND page_mapping_receipt->>'full_pdf_sha256'=p_edition_sha256 FOR SHARE NOWAIT;
 IF p.id IS NULL OR l.catalog_id IS NULL OR public.catalog_page_member_evidence(p_catalog,p_page,p_edition_sha256) IS NULL
  THEN RAISE EXCEPTION 'Catalog page source changed'; END IF;
 geom_sha:=encode(extensions.digest(convert_to(p_geometry,'UTF8'),'sha256'),'hex');
 IF geom_sha IS DISTINCT FROM l.page_mapping_receipt->>'word_geometry_sha256'
  THEN RAISE EXCEPTION 'Word geometry differs from attributed comparison'; END IF;
 g:=p_geometry::jsonb;
 IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(g))<>3
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(g) k WHERE k NOT IN ('width','height','words'))
  OR jsonb_typeof(g->'width') IS DISTINCT FROM 'string' OR jsonb_typeof(g->'height') IS DISTINCT FROM 'string'
  OR coalesce(g->>'width','') !~ '^[0-9]{1,6}(\.[0-9]{1,8})?$'
  OR coalesce(g->>'height','') !~ '^[0-9]{1,6}(\.[0-9]{1,8})?$'
  OR jsonb_typeof(g->'words') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid word geometry shape'; END IF;
 width_value:=(g->>'width')::numeric; height_value:=(g->>'height')::numeric; wcount:=jsonb_array_length(g->'words');
 IF width_value NOT BETWEEN 0.000001 AND 100000 OR height_value NOT BETWEEN 0.000001 AND 100000 OR wcount>5000
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(g->'words') w
   WHERE jsonb_typeof(w) IS DISTINCT FROM 'array' OR jsonb_array_length(w)<>5
    OR jsonb_typeof(w->0) IS DISTINCT FROM 'string' OR jsonb_typeof(w->1) IS DISTINCT FROM 'string'
    OR jsonb_typeof(w->2) IS DISTINCT FROM 'string' OR jsonb_typeof(w->3) IS DISTINCT FROM 'string'
    OR jsonb_typeof(w->4) IS DISTINCT FROM 'string' OR length(w->>4) NOT BETWEEN 1 AND 4000
    OR coalesce(w->>0,'') !~ '^-?[0-9]{1,6}(\.[0-9]{1,8})?$'
    OR coalesce(w->>1,'') !~ '^-?[0-9]{1,6}(\.[0-9]{1,8})?$'
    OR coalesce(w->>2,'') !~ '^-?[0-9]{1,6}(\.[0-9]{1,8})?$'
    OR coalesce(w->>3,'') !~ '^-?[0-9]{1,6}(\.[0-9]{1,8})?$'
    OR (w->>0)::numeric NOT BETWEEN -100000 AND 100000 OR (w->>1)::numeric NOT BETWEEN -100000 AND 100000
    OR (w->>2)::numeric NOT BETWEEN -100000 AND 100000 OR (w->>3)::numeric NOT BETWEEN -100000 AND 100000)
  THEN RAISE EXCEPTION 'Invalid word geometry values'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('document-page-word-geometry:'||p.id::text||':'||geom_sha,0));
 SELECT * INTO r FROM public.document_page_word_extractions WHERE page_id=p.id AND source_revision=l.source_revision
  AND geometry_sha256=geom_sha AND catalog_id=c.id AND catalog_edition_sha256=p_edition_sha256
  AND extractor_version=p_extractor_version FOR SHARE;
 IF FOUND THEN
  IF r.geometry_text IS DISTINCT FROM p_geometry OR public.catalog_page_word_geometry_evidence(r.id) IS NULL
   THEN RAISE EXCEPTION 'Existing word geometry differs or is held'; END IF;
  RETURN jsonb_build_object('success',true,'extraction_id',r.id,'page_id',r.page_id,'word_count',r.word_count,
   'extractor_version',r.extractor_version,'duplicate',true,'geometry_status','client_attested_not_server_reextracted');
 END IF;
 INSERT INTO public.document_page_word_extractions(document_id,page_id,catalog_id,catalog_page_number,catalog_edition_sha256,
  source_revision,pdf_sha256,geometry_sha256,extractor_method,extractor_version,extractor_version_sha256,geometry_text,page_width,page_height,word_count,reader_actor,reader_run_id,reader_verified_at)
 VALUES(d.id,p.id,c.id,p_page,p_edition_sha256,l.source_revision,d.file_hash,geom_sha,'poppler_pdftotext_bbox_layout',p_extractor_version,
  encode(extensions.digest(convert_to(p_extractor_version,'UTF8'),'sha256'),'hex'),p_geometry,width_value,height_value,wcount,
  l.page_mapping_receipt->>'reader_actor',l.page_mapping_receipt->>'reader_run_id',
  (l.page_mapping_receipt->>'reader_verified_at')::timestamptz) RETURNING * INTO r;
 INSERT INTO public.document_page_word_regions(extraction_id,word_ordinal,word_text,x_min,y_min,x_max,y_max)
 SELECT r.id,t.n::integer,t.v->>4,(t.v->>0)::numeric,(t.v->>1)::numeric,(t.v->>2)::numeric,(t.v->>3)::numeric
 FROM jsonb_array_elements(g->'words') WITH ORDINALITY AS t(v,n) ORDER BY t.n;
 IF public.catalog_page_word_geometry_evidence(r.id) IS NULL THEN RAISE EXCEPTION 'Word geometry receipt incomplete'; END IF;
 RETURN jsonb_build_object('success',true,'extraction_id',r.id,'page_id',r.page_id,'word_count',r.word_count,
  'extractor_version',r.extractor_version,'duplicate',false,'geometry_status','client_attested_not_server_reextracted');
END $fn$;
REVOKE ALL ON FUNCTION public.record_catalog_page_word_geometry(uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_catalog_page_word_geometry(uuid,integer,text,text,text) TO service_role;
COMMENT ON FUNCTION public.catalog_page_word_geometry_evidence(uuid) IS
 'Requalifies the existing catalog page/source and checks every keyed word against the client-attested geometry; not server PDF extraction or an assembly claim.';
COMMIT;
