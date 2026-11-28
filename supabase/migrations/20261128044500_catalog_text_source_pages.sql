-- Retain the page boundaries of an already-stored catalog transcript.
-- These are unreviewed source pages, not listings, fitment, or assembly claims.
-- The PDF hash is a service caller's client-side attestation; Postgres checks
-- the exact object identity/version and transcript, but does not rehash bytes.
SET statement_timeout = '30s';
SET lock_timeout = '2s';

-- A catalog can have multiple retained revisions. Keep the relationship typed
-- and keyed to the existing catalog and reference-document owners.
CREATE TABLE public.catalog_reference_documents (
 catalog_id uuid NOT NULL REFERENCES public.catalog_sources(id),
 reference_document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (catalog_id,reference_document_id),
 UNIQUE (reference_document_id),
 UNIQUE (catalog_id,source_revision)
);
ALTER TABLE public.catalog_reference_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_reference_documents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalog_reference_documents TO service_role;
COMMENT ON TABLE public.catalog_reference_documents IS
 'Typed links between supplier catalogs and retained reference-document revisions. A link does not assert catalog listing, part fitment or vehicle installation.';

CREATE OR REPLACE FUNCTION public.record_catalog_text_source(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE c public.catalog_sources%ROWTYPE; obj storage.objects%ROWTYPE;
 d public.reference_documents%ROWTYPE; origin text; encoded_path text;
 transcript text; pages text[]; n int; text_n int; distinct_n int; min_i int; max_i int;
 revision text; expected_text_hash text; expected_pdf_hash text; page_count int;
 recorded_count int; recorded_text text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_source) IS DISTINCT FROM 'object'
 OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_source) key WHERE key NOT IN (
   'catalog_id','object_id','object_version','object_name','pdf_sha256','text_sha256','page_count','chunk_count',
   'project_origin','reader_actor','reader_method','reader_run_id'))
 OR coalesce(p_source->>'catalog_id','') !~* '^[0-9a-f-]{36}$'
 OR coalesce(p_source->>'object_id','') !~* '^[0-9a-f-]{36}$'
 OR length(coalesce(p_source->>'object_version','')) NOT BETWEEN 1 AND 200
 OR length(coalesce(p_source->>'object_name','')) NOT BETWEEN 1 AND 1000
 OR coalesce(p_source->>'pdf_sha256','') !~ '^[a-f0-9]{64}$'
 OR coalesce(p_source->>'text_sha256','') !~ '^[a-f0-9]{64}$'
 OR coalesce(p_source->>'page_count','') !~ '^[0-9]{1,4}$'
 OR (p_source->>'page_count')::int NOT BETWEEN 1 AND 5000
 OR coalesce(p_source->>'chunk_count','') !~ '^[0-9]{1,5}$'
 OR (p_source->>'chunk_count')::int NOT BETWEEN 1 AND 10000
 OR coalesce(p_source->>'project_origin','') !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$'
 OR length(coalesce(p_source->>'reader_actor','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_source->>'reader_method','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_source->>'reader_run_id','')) NOT BETWEEN 1 AND 150
 THEN RAISE EXCEPTION 'Invalid catalog source contract'; END IF;
 origin:=p_source->>'project_origin'; expected_pdf_hash:=p_source->>'pdf_sha256';
 expected_text_hash:=p_source->>'text_sha256'; page_count:=(p_source->>'page_count')::int;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-text-source:'||(p_source->>'catalog_id'),0));
 SELECT * INTO c FROM public.catalog_sources WHERE id=(p_source->>'catalog_id')::uuid FOR SHARE;
 SELECT o.* INTO obj FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id
 WHERE o.id=(p_source->>'object_id')::uuid AND o.bucket_id='reference-docs'
 AND o.name=p_source->>'object_name' AND o.version=p_source->>'object_version'
 AND b.public IS TRUE FOR SHARE OF o,b;
 IF c.id IS NULL OR obj.id IS NULL OR obj.version IS NULL
 OR obj.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
 OR coalesce(obj.metadata->>'size','') !~ '^[0-9]+$'
 OR (obj.metadata->>'size')::bigint < 8 THEN RAISE EXCEPTION 'Retained catalog source unavailable'; END IF;
 -- Encode UTF-8 object path without treating a slash as a path separator in a
 -- percent-encoded segment. The origin comes from the service configuration.
 SELECT string_agg(CASE WHEN b BETWEEN 48 AND 57 OR b BETWEEN 65 AND 90 OR b BETWEEN 97 AND 122
   OR b IN (45,46,47,95,126) THEN chr(b) ELSE '%'||upper(lpad(to_hex(b),2,'0')) END,'' ORDER BY i)
 INTO encoded_path FROM (SELECT i,get_byte(convert_to(obj.name,'UTF8'),i) b
   FROM generate_series(0,octet_length(convert_to(obj.name,'UTF8'))-1) i) bytes;
 IF c.base_url IS DISTINCT FROM origin||'/storage/v1/object/public/reference-docs/'||encoded_path
 THEN RAISE EXCEPTION 'Catalog URL and retained object differ'; END IF;
 SELECT count(*),count(text_content),count(DISTINCT chunk_index),min(chunk_index),max(chunk_index),
   string_agg(text_content,'' ORDER BY chunk_index)
 INTO n,text_n,distinct_n,min_i,max_i,transcript
 FROM public.catalog_text_chunks WHERE catalog_id=c.id;
 IF n<>(p_source->>'chunk_count')::int OR text_n<>n OR distinct_n<>n OR min_i<>0 OR max_i<>n-1
 OR transcript IS NULL OR length(transcript)>50000000
 OR encode(extensions.digest(convert_to(transcript,'UTF8'),'sha256'),'hex') IS DISTINCT FROM expected_text_hash
 OR length(transcript)-length(replace(transcript,chr(12),''))<>page_count
 OR right(transcript,1) IS DISTINCT FROM chr(12)
 THEN RAISE EXCEPTION 'Catalog transcript snapshot differs'; END IF;
 pages:=string_to_array(transcript,chr(12));
 IF cardinality(pages)<>page_count+1 OR pages[page_count+1] IS DISTINCT FROM ''
 THEN RAISE EXCEPTION 'Catalog page boundaries differ'; END IF;
 revision:=encode(extensions.digest(jsonb_build_object('catalog_id',c.id,'catalog_name',c.name,'catalog_provider',c.provider,'source_url',c.base_url,
  'object_id',obj.id,'object_version',obj.version,'object_name',obj.name,
  'object_size',obj.metadata->>'size','pdf_sha256_attested',expected_pdf_hash,
  'text_sha256',expected_text_hash,'page_count',page_count,'reader_method',p_source->>'reader_method')::text,'sha256'),'hex');
 SELECT * INTO d FROM public.reference_documents WHERE slug='catalog-text-source-'||revision FOR SHARE;
 IF FOUND THEN
  SELECT count(*),string_agg(extracted_text||chr(12),'' ORDER BY page_number)
  INTO recorded_count,recorded_text FROM public.document_pages
  WHERE document_id=d.id AND extraction_method='catalog_text_replay_v1';
  IF d.superseded_by IS NOT NULL OR d.source_capture->>'revision' IS DISTINCT FROM revision
   OR d.title IS DISTINCT FROM c.name OR d.source_url IS DISTINCT FROM c.base_url
   OR d.file_path IS DISTINCT FROM 'reference-docs/'||obj.name OR d.file_hash IS DISTINCT FROM expected_pdf_hash
   OR d.page_count IS DISTINCT FROM page_count OR d.extraction_method IS DISTINCT FROM 'catalog_text_replay_v1'
   OR public.catalog_text_source_evidence(d.id) IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.catalog_reference_documents link WHERE link.catalog_id=c.id
      AND link.reference_document_id=d.id AND link.source_revision=revision)
   OR recorded_count<>page_count OR recorded_text IS DISTINCT FROM transcript
   OR (SELECT count(*) FROM public.document_pages WHERE document_id=d.id)<>page_count
   THEN RAISE EXCEPTION 'Recorded catalog source changed'; END IF;
  RETURN jsonb_build_object('success',true,'document_id',d.id,'revision',revision,
   'page_count',page_count,'duplicate',true,'pdf_hash_status','client_attested_not_server_rehashed');
 END IF;
 INSERT INTO public.reference_documents(slug,title,category,file_path,file_hash,file_size_bytes,page_count,
  base_trust_score,extraction_method,extraction_quality,extracted_at,source_url,source_capture)
 VALUES('catalog-text-source-'||revision,c.name,'parts_catalog','reference-docs/'||obj.name,expected_pdf_hash,
  (obj.metadata->>'size')::bigint,page_count,0,'catalog_text_replay_v1','unreviewed_source_text',clock_timestamp(),c.base_url,
  jsonb_build_object('schema','catalog_text_source_v1','revision',revision,'catalog_id',c.id,
   'source_role','supplier_catalog','catalog_provider',c.provider,
   'storage_object_id',obj.id,'storage_version',obj.version,'storage_name',obj.name,
   'text_sha256',expected_text_hash,'pdf_sha256_attestation',expected_pdf_hash,
   'pdf_hash_status','client_attested_not_server_rehashed','reader_actor',p_source->>'reader_actor',
   'reader_method',p_source->>'reader_method','reader_run_id',p_source->>'reader_run_id',
   'reader_receipt_sha256',encode(extensions.digest(jsonb_build_object('actor',p_source->>'reader_actor',
    'method',p_source->>'reader_method','run_id',p_source->>'reader_run_id','pdf_sha256',expected_pdf_hash,
    'text_sha256',expected_text_hash,'object_id',obj.id,'object_version',obj.version)::text,'sha256'),'hex'),
   'recorded_at',clock_timestamp())) RETURNING * INTO d;
 INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision)
 VALUES(c.id,d.id,revision);
 INSERT INTO public.document_pages(document_id,page_number,extracted_text,has_diagrams,extraction_method)
 SELECT d.id,i,pages[i],NULL,'catalog_text_replay_v1' FROM generate_series(1,page_count) i;
 RETURN jsonb_build_object('success',true,'document_id',d.id,'revision',revision,
  'page_count',page_count,'duplicate',false,'pdf_hash_status','client_attested_not_server_rehashed');
END $fn$;

REVOKE ALL ON FUNCTION public.record_catalog_text_source(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_catalog_text_source(jsonb) TO service_role;
COMMENT ON FUNCTION public.record_catalog_text_source(jsonb) IS
 'Service-only source custody for an existing catalog transcript: transactionally retains unreviewed page text in reference_documents/document_pages. Caller attests the PDF hash; database binds object version and transcript. No part, applicability, fitment or installed-state assertion.';

CREATE OR REPLACE FUNCTION public.catalog_text_source_evidence(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE d public.reference_documents%ROWTYPE; c public.catalog_sources%ROWTYPE; obj storage.objects%ROWTYPE;
 n int; valid_n int; min_page int; max_page int; transcript text; revision text;
BEGIN
 SELECT * INTO d FROM public.reference_documents WHERE id=p_document_id AND superseded_by IS NULL
  AND category='parts_catalog' AND extraction_method='catalog_text_replay_v1'
  AND extraction_quality='unreviewed_source_text' AND base_trust_score=0
  AND source_capture->>'schema'='catalog_text_source_v1'
  AND source_capture->>'source_role'='supplier_catalog'
  AND source_capture->>'pdf_hash_status'='client_attested_not_server_rehashed';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.catalog_sources WHERE id=(d.source_capture->>'catalog_id')::uuid;
 SELECT o.* INTO obj FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id
 WHERE o.id=(d.source_capture->>'storage_object_id')::uuid AND o.bucket_id='reference-docs'
  AND o.name=d.source_capture->>'storage_name' AND o.version=d.source_capture->>'storage_version'
  AND b.public IS TRUE AND o.metadata->>'mimetype'='application/pdf';
 IF c.id IS NULL OR obj.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.catalog_reference_documents link
    WHERE link.catalog_id=c.id AND link.reference_document_id=d.id AND link.source_revision=d.source_capture->>'revision')
  OR c.name IS DISTINCT FROM d.title
  OR c.provider IS DISTINCT FROM d.source_capture->>'catalog_provider'
  OR c.base_url IS DISTINCT FROM d.source_url OR d.file_path IS DISTINCT FROM 'reference-docs/'||obj.name
  OR d.file_hash IS DISTINCT FROM d.source_capture->>'pdf_sha256_attestation'
  OR d.file_size_bytes::text IS DISTINCT FROM obj.metadata->>'size'
  OR d.page_count NOT BETWEEN 1 AND 5000 THEN RETURN NULL; END IF;
 IF length(coalesce(d.source_capture->>'reader_actor','')) NOT BETWEEN 1 AND 100
  OR length(coalesce(d.source_capture->>'reader_run_id','')) NOT BETWEEN 1 AND 150
  OR d.source_capture->>'reader_receipt_sha256' IS DISTINCT FROM
   encode(extensions.digest(jsonb_build_object('actor',d.source_capture->>'reader_actor',
    'method',d.source_capture->>'reader_method','run_id',d.source_capture->>'reader_run_id',
    'pdf_sha256',d.file_hash,'text_sha256',d.source_capture->>'text_sha256',
    'object_id',obj.id,'object_version',obj.version)::text,'sha256'),'hex')
  THEN RETURN NULL; END IF;
 SELECT count(*),count(*) FILTER (WHERE extraction_method='catalog_text_replay_v1'
   AND extracted_text IS NOT NULL AND has_diagrams IS NULL),min(page_number),max(page_number),
   string_agg(extracted_text||chr(12),'' ORDER BY page_number)
 INTO n,valid_n,min_page,max_page,transcript FROM public.document_pages WHERE document_id=d.id;
 IF n<>d.page_count OR valid_n<>n OR min_page<>1 OR max_page<>d.page_count
  OR encode(extensions.digest(convert_to(transcript,'UTF8'),'sha256'),'hex') IS DISTINCT FROM d.source_capture->>'text_sha256'
  THEN RETURN NULL; END IF;
 revision:=encode(extensions.digest(jsonb_build_object('catalog_id',c.id,'catalog_name',c.name,'catalog_provider',c.provider,'source_url',c.base_url,
  'object_id',obj.id,'object_version',obj.version,'object_name',obj.name,
  'object_size',obj.metadata->>'size','pdf_sha256_attested',d.file_hash,
  'text_sha256',d.source_capture->>'text_sha256','page_count',d.page_count,
  'reader_method',d.source_capture->>'reader_method')::text,'sha256'),'hex');
 IF revision IS DISTINCT FROM d.source_capture->>'revision' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('document_id',d.id,'catalog_id',c.id,'revision',revision,'page_count',d.page_count,
  'source_url',d.source_url,'pdf_sha256_attestation',d.file_hash,'text_sha256',d.source_capture->>'text_sha256',
  'pdf_hash_status','client_attested_not_server_rehashed','page_status','unreviewed_source_text');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.catalog_text_source_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_text_source_evidence(uuid) TO service_role;
COMMENT ON FUNCTION public.catalog_text_source_evidence(uuid) IS
 'Rechecks the stored object version, source metadata and unreviewed page-text fingerprint. The PDF hash remains client-attested, and this does not qualify a listing, component, application or installed-state claim.';
