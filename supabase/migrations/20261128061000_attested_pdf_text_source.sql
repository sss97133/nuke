-- Retain all text pages of a public PDF whose object bytes were verified by a
-- service client. This is source custody only; text and diagrams are unreviewed.
-- Both the PDF hash and the text-to-PDF relationship are client attestations;
-- Postgres does not measure or extract the PDF bytes.
SET statement_timeout = '30s';
SET lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.attested_pdf_text_evidence(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE d public.reference_documents%ROWTYPE; o storage.objects%ROWTYPE;
 n int; good int; first_page int; last_page int; transcript text; revision text;
BEGIN
 SELECT * INTO d FROM public.reference_documents WHERE id=p_document_id
  AND superseded_by IS NULL AND category='parts_catalog' AND base_trust_score=0
  AND extraction_method='attested_pdf_text_v1' AND extraction_quality='unreviewed_source_text'
  AND source_capture->>'schema'='attested_pdf_text_v1'
  AND source_capture->>'pdf_hash_status'='client_attested_not_server_rehashed'
  AND source_capture->>'text_provenance_status'='client_attested_extraction_not_server_verified';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT obj.* INTO o FROM storage.objects obj JOIN storage.buckets b ON b.id=obj.bucket_id
  WHERE obj.id=(d.source_capture->>'storage_object_id')::uuid AND obj.bucket_id='reference-docs'
    AND obj.name=d.source_capture->>'storage_name' AND obj.version=d.source_capture->>'storage_version'
    AND b.public IS TRUE AND obj.metadata->>'mimetype'='application/pdf';
 IF o.id IS NULL OR d.file_path IS DISTINCT FROM 'reference-docs/'||o.name
  OR o.name IS DISTINCT FROM 'catalog-public/'||d.file_hash||'.pdf'
  OR d.file_hash IS DISTINCT FROM d.source_capture->>'pdf_sha256_attestation'
  OR d.file_size_bytes::text IS DISTINCT FROM o.metadata->>'size'
  OR d.title IS DISTINCT FROM d.source_capture->>'title'
  OR d.source_url IS DISTINCT FROM d.source_capture->>'source_url'
  OR d.page_count NOT BETWEEN 1 AND 5000 THEN RETURN NULL; END IF;
 IF length(coalesce(d.source_capture->>'reader_actor','')) NOT BETWEEN 1 AND 100
  OR length(coalesce(d.source_capture->>'reader_run_id','')) NOT BETWEEN 1 AND 150
  OR d.source_capture->>'reader_method' IS DISTINCT FROM 'client_sha256_pdftotext_v1'
  OR isfinite((d.source_capture->>'reader_verified_at')::timestamptz) IS DISTINCT FROM true
  OR (d.source_capture->>'reader_verified_at')::timestamptz > (d.source_capture->>'recorded_at')::timestamptz + interval '5 minutes'
  OR d.source_capture->>'reader_receipt_sha256' IS DISTINCT FROM
   encode(extensions.digest(jsonb_build_object('actor',d.source_capture->>'reader_actor',
    'method',d.source_capture->>'reader_method','run_id',d.source_capture->>'reader_run_id',
    'verified_at',d.source_capture->>'reader_verified_at','pdf_sha256',d.file_hash,
    'text_sha256',d.source_capture->>'text_sha256','object_id',o.id,'object_version',o.version)::text,'sha256'),'hex')
  THEN RETURN NULL; END IF;
 SELECT count(*),count(*) FILTER (WHERE extracted_text IS NOT NULL AND has_diagrams IS NULL
   AND extraction_method='attested_pdf_text_v1'),min(page_number),max(page_number),
   string_agg(extracted_text||chr(12),'' ORDER BY page_number)
 INTO n,good,first_page,last_page,transcript FROM public.document_pages WHERE document_id=d.id;
 IF n<>d.page_count OR good<>n OR first_page<>1 OR last_page<>d.page_count
  OR encode(extensions.digest(convert_to(transcript,'UTF8'),'sha256'),'hex') IS DISTINCT FROM d.source_capture->>'text_sha256'
 THEN RETURN NULL; END IF;
 revision:=encode(extensions.digest(jsonb_build_object('title',d.title,'source_url',d.source_url,
  'object_id',o.id,'object_version',o.version,'object_name',o.name,'object_size',o.metadata->>'size',
  'pdf_sha256_attested',d.file_hash,'text_sha256',d.source_capture->>'text_sha256',
  'page_count',d.page_count,'reader_method',d.source_capture->>'reader_method')::text,'sha256'),'hex');
 IF revision IS DISTINCT FROM d.source_capture->>'revision' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('document_id',d.id,'revision',revision,'page_count',d.page_count,
  'source_url',d.source_url,'pdf_sha256_attestation',d.file_hash,
  'pdf_hash_status','client_attested_not_server_rehashed','text_sha256',d.source_capture->>'text_sha256',
  'text_provenance_status','client_attested_extraction_not_server_verified',
  'page_status','unreviewed_source_text','reader_actor',d.source_capture->>'reader_actor',
  'reader_method',d.source_capture->>'reader_method','reader_run_id',d.source_capture->>'reader_run_id',
  'reader_verified_at',d.source_capture->>'reader_verified_at');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
 OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.attested_pdf_text_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attested_pdf_text_evidence(uuid) TO service_role;
COMMENT ON FUNCTION public.attested_pdf_text_evidence(uuid) IS
 'Rechecks object version and complete unreviewed page text; the PDF bytes and text-to-PDF relationship are client-attested. No listing, applicability or assembly is implied.';

CREATE OR REPLACE FUNCTION public.record_attested_pdf_text(p_source jsonb,p_pages jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE o storage.objects%ROWTYPE; d public.reference_documents%ROWTYPE;
 transcript text; page_count int; revision text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR jsonb_typeof(p_pages) IS DISTINCT FROM 'array'
  OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_source) k WHERE k NOT IN
   ('title','source_url','object_id','object_version','object_name','pdf_sha256','pdf_size','text_sha256',
    'page_count','reader_actor','reader_method','reader_run_id','reader_verified_at'))
  OR length(coalesce(p_source->>'title','')) NOT BETWEEN 1 AND 500
  OR coalesce(p_source->>'source_url','') !~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
  OR coalesce(p_source->>'object_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR length(coalesce(p_source->>'object_version','')) NOT BETWEEN 1 AND 200
  OR coalesce(p_source->>'pdf_sha256','') !~ '^[a-f0-9]{64}$'
  OR p_source->>'object_name' IS DISTINCT FROM 'catalog-public/'||(p_source->>'pdf_sha256')||'.pdf'
  OR coalesce(p_source->>'pdf_size','') !~ '^[0-9]{1,12}$'
  OR (p_source->>'pdf_size')::bigint NOT BETWEEN 8 AND 314572800
  OR coalesce(p_source->>'text_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_source->>'page_count','') !~ '^[0-9]{1,4}$'
  OR (p_source->>'page_count')::int NOT BETWEEN 1 AND 5000
  OR jsonb_array_length(p_pages) IS DISTINCT FROM (p_source->>'page_count')::int
  OR length(coalesce(p_source->>'reader_actor','')) NOT BETWEEN 1 AND 100
  OR p_source->>'reader_method' IS DISTINCT FROM 'client_sha256_pdftotext_v1'
  OR length(coalesce(p_source->>'reader_run_id','')) NOT BETWEEN 1 AND 150
  OR coalesce(p_source->>'reader_verified_at','') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-][0-9]{2}:[0-9]{2})$'
  OR isfinite((p_source->>'reader_verified_at')::timestamptz) IS DISTINCT FROM true
  OR (p_source->>'reader_verified_at')::timestamptz > clock_timestamp()+interval '5 minutes'
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_pages) p WHERE jsonb_typeof(p.value) IS DISTINCT FROM 'string'
    OR length(p.value#>>'{}')>100000 OR position(chr(12) IN (p.value#>>'{}'))>0)
 THEN RAISE EXCEPTION 'Invalid attested PDF source contract'; END IF;
 page_count:=(p_source->>'page_count')::int;
 SELECT string_agg(value||chr(12),'' ORDER BY ord) INTO transcript
 FROM jsonb_array_elements_text(p_pages) WITH ORDINALITY AS t(value,ord);
 IF transcript IS NULL OR length(transcript)>10000000
  OR encode(extensions.digest(convert_to(transcript,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_source->>'text_sha256'
 THEN RAISE EXCEPTION 'PDF text snapshot differs'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('attested-pdf-text:'||(p_source->>'pdf_sha256'),0));
 SELECT obj.* INTO o FROM storage.objects obj JOIN storage.buckets b ON b.id=obj.bucket_id
  WHERE obj.id=(p_source->>'object_id')::uuid AND obj.bucket_id='reference-docs'
   AND obj.name=p_source->>'object_name' AND obj.version=p_source->>'object_version'
   AND b.public IS TRUE FOR SHARE OF obj,b;
 IF o.id IS NULL OR o.version IS NULL OR o.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
  OR o.metadata->>'size' IS DISTINCT FROM p_source->>'pdf_size' THEN RAISE EXCEPTION 'Retained PDF unavailable'; END IF;
 revision:=encode(extensions.digest(jsonb_build_object('title',p_source->>'title','source_url',p_source->>'source_url',
  'object_id',o.id,'object_version',o.version,'object_name',o.name,'object_size',o.metadata->>'size',
  'pdf_sha256_attested',p_source->>'pdf_sha256','text_sha256',p_source->>'text_sha256',
  'page_count',page_count,'reader_method',p_source->>'reader_method')::text,'sha256'),'hex');
 SELECT * INTO d FROM public.reference_documents WHERE slug='attested-pdf-text-'||revision FOR SHARE;
 IF FOUND THEN
  IF public.attested_pdf_text_evidence(d.id) IS NULL OR d.source_capture->>'revision' IS DISTINCT FROM revision
   THEN RAISE EXCEPTION 'Recorded PDF source changed'; END IF;
  RETURN jsonb_build_object('success',true,'document_id',d.id,'revision',revision,
   'page_count',page_count,'duplicate',true,'pdf_hash_status','client_attested_not_server_rehashed',
   'text_provenance_status','client_attested_extraction_not_server_verified');
 END IF;
 INSERT INTO public.reference_documents(slug,title,category,file_path,file_hash,file_size_bytes,page_count,
  base_trust_score,extraction_method,extraction_quality,extracted_at,source_url,source_capture)
 VALUES('attested-pdf-text-'||revision,p_source->>'title','parts_catalog','reference-docs/'||o.name,
  p_source->>'pdf_sha256',(p_source->>'pdf_size')::bigint,page_count,0,
  'attested_pdf_text_v1','unreviewed_source_text',clock_timestamp(),p_source->>'source_url',
  jsonb_build_object('schema','attested_pdf_text_v1','revision',revision,'title',p_source->>'title',
   'source_url',p_source->>'source_url','storage_object_id',o.id,'storage_version',o.version,'storage_name',o.name,
   'text_sha256',p_source->>'text_sha256','pdf_sha256_attestation',p_source->>'pdf_sha256',
   'pdf_hash_status','client_attested_not_server_rehashed',
   'text_provenance_status','client_attested_extraction_not_server_verified','reader_actor',p_source->>'reader_actor',
   'reader_method',p_source->>'reader_method','reader_run_id',p_source->>'reader_run_id',
   'reader_verified_at',p_source->>'reader_verified_at',
   'reader_receipt_sha256',encode(extensions.digest(jsonb_build_object('actor',p_source->>'reader_actor',
    'method',p_source->>'reader_method','run_id',p_source->>'reader_run_id','verified_at',p_source->>'reader_verified_at',
    'pdf_sha256',p_source->>'pdf_sha256','text_sha256',p_source->>'text_sha256',
    'object_id',o.id,'object_version',o.version)::text,'sha256'),'hex'),'recorded_at',clock_timestamp())) RETURNING * INTO d;
 INSERT INTO public.document_pages(document_id,page_number,extracted_text,has_diagrams,extraction_method)
 SELECT d.id,ord::integer,value,NULL,'attested_pdf_text_v1'
 FROM jsonb_array_elements_text(p_pages) WITH ORDINALITY AS t(value,ord);
 RETURN jsonb_build_object('success',true,'document_id',d.id,'revision',revision,
  'page_count',page_count,'duplicate',false,'pdf_hash_status','client_attested_not_server_rehashed',
  'text_provenance_status','client_attested_extraction_not_server_verified');
END $fn$;
REVOKE ALL ON FUNCTION public.record_attested_pdf_text(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_attested_pdf_text(jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.record_attested_pdf_text(jsonb,jsonb) IS
 'Service-only source-page admission from an already-stored public PDF. Client attests both PDF bytes and text extraction; text, listings and diagrams are not reviewed.';
