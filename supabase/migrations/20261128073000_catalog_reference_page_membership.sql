-- Extend the existing catalog/document edge to represent separately published
-- page sources. Page membership is an attributed CLIENT comparison, not a
-- server-verified edition, listing, part, fitment or installed-state claim.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

ALTER TABLE public.document_pages
 ADD CONSTRAINT document_pages_id_document_id_key UNIQUE (id,document_id);
ALTER TABLE public.catalog_reference_documents
 ADD COLUMN catalog_page_number integer,
 ADD COLUMN document_page_id uuid,
 ADD COLUMN page_mapping_receipt jsonb,
 ADD COLUMN page_mapping_receipt_sha256 text,
 ADD CONSTRAINT catalog_reference_page_document_fkey
  FOREIGN KEY (document_page_id,reference_document_id)
  REFERENCES public.document_pages(id,document_id),
 ADD CONSTRAINT catalog_reference_page_mapping_shape CHECK ((
  (catalog_page_number IS NULL AND document_page_id IS NULL AND page_mapping_receipt IS NULL AND page_mapping_receipt_sha256 IS NULL)
  OR (catalog_page_number BETWEEN 1 AND 5000 AND document_page_id IS NOT NULL
   AND jsonb_typeof(page_mapping_receipt)='object' AND page_mapping_receipt_sha256 ~ '^[a-f0-9]{64}$')
 ) IS TRUE);
CREATE INDEX catalog_reference_documents_catalog_page_idx
 ON public.catalog_reference_documents(catalog_id,catalog_page_number) WHERE catalog_page_number IS NOT NULL;
COMMENT ON COLUMN public.catalog_reference_documents.catalog_page_number IS
 'Ordinal in a catalog, asserted by the recorded client comparison; NULL for a whole-document link. Not a printed label or fitment.';
COMMENT ON COLUMN public.catalog_reference_documents.document_page_id IS
 'Actual retained source page; the composite foreign key also requires its document to match reference_document_id.';
COMMENT ON COLUMN public.catalog_reference_documents.page_mapping_receipt IS
 'Client-attested comparison of the catalog page and the separately retained source. Server rechecks retained-source custody, not the client-rendered PDF bytes or boxes.';
COMMENT ON COLUMN public.catalog_reference_documents.page_mapping_receipt_sha256 IS
 'SHA-256 of the exact stored page_mapping_receipt JSONB text; detects receipt mutation.';

CREATE OR REPLACE FUNCTION public.record_catalog_page_membership(p_catalog jsonb,p_pages jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE c public.catalog_sources%ROWTYPE; d public.reference_documents%ROWTYPE;
 page_record public.document_pages%ROWTYPE; obj_id uuid; candidate_object_id uuid; item jsonb; receipt jsonb; receipt_sha text;
 existing public.catalog_reference_documents%ROWTYPE; candidate_count integer; page_no integer;
 inserted_count integer:=0; replayed_count integer:=0; revision text; expected_count integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'object' OR jsonb_typeof(p_pages) IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_catalog) k WHERE k NOT IN
   ('name','provider','base_url','full_pdf_sha256','expected_page_count','reader_actor','reader_run_id','reader_verified_at'))
  OR length(coalesce(p_catalog->>'name','')) NOT BETWEEN 1 AND 500
  OR length(coalesce(p_catalog->>'provider','')) NOT BETWEEN 1 AND 100
  OR coalesce(p_catalog->>'base_url','') !~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
  OR coalesce(p_catalog->>'full_pdf_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_catalog->>'expected_page_count','') !~ '^[0-9]{1,4}$'
  OR (p_catalog->>'expected_page_count')::integer NOT BETWEEN 1 AND 5000
  OR length(coalesce(p_catalog->>'reader_actor','')) NOT BETWEEN 1 AND 100
  OR length(coalesce(p_catalog->>'reader_run_id','')) NOT BETWEEN 1 AND 150
  OR coalesce(p_catalog->>'reader_verified_at','') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-][0-9]{2}:[0-9]{2})$'
  OR isfinite((p_catalog->>'reader_verified_at')::timestamptz) IS DISTINCT FROM true
  OR (p_catalog->>'reader_verified_at')::timestamptz>clock_timestamp()+interval '5 minutes'
  OR jsonb_array_length(p_pages) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Invalid catalog page membership contract'; END IF;
 expected_count:=(p_catalog->>'expected_page_count')::integer;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_pages) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('catalog_page_number','document_id','document_page_id',
   'pdf_sha256','full_geometry_sha256','individual_geometry_sha256','full_render_sha256','individual_render_sha256'))
  OR jsonb_typeof(x->'catalog_page_number') IS DISTINCT FROM 'number'
  OR coalesce(x->>'catalog_page_number','') !~ '^[0-9]{1,4}$'
  OR (x->>'catalog_page_number')::integer NOT BETWEEN 1 AND expected_count
  OR coalesce(x->>'document_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(x->>'document_page_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(x->>'pdf_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(x->>'full_geometry_sha256','') !~ '^[a-f0-9]{64}$'
  OR x->>'full_geometry_sha256' IS DISTINCT FROM x->>'individual_geometry_sha256'
  OR coalesce(x->>'full_render_sha256','') !~ '^[a-f0-9]{64}$'
  OR x->>'full_render_sha256' IS DISTINCT FROM x->>'individual_render_sha256')
 OR (SELECT count(DISTINCT (x->>'catalog_page_number')::integer) FROM jsonb_array_elements(p_pages) x)<>jsonb_array_length(p_pages)
 OR (SELECT count(DISTINCT x->>'document_id') FROM jsonb_array_elements(p_pages) x)<>jsonb_array_length(p_pages)
 THEN RAISE EXCEPTION 'Invalid or repeated catalog source page'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('catalog-page-membership:'||(p_catalog->>'provider')||':'||(p_catalog->>'base_url'),0));
 SELECT count(*) INTO candidate_count FROM public.catalog_sources
  WHERE provider=p_catalog->>'provider' AND base_url=p_catalog->>'base_url';
 IF candidate_count>1 THEN RAISE EXCEPTION 'Multiple catalog source identities'; END IF;
 IF candidate_count=0 THEN
  INSERT INTO public.catalog_sources(name,provider,base_url) VALUES(p_catalog->>'name',p_catalog->>'provider',p_catalog->>'base_url') RETURNING * INTO c;
 ELSE
  SELECT * INTO c FROM public.catalog_sources WHERE provider=p_catalog->>'provider' AND base_url=p_catalog->>'base_url' FOR UPDATE;
  IF c.name IS DISTINCT FROM p_catalog->>'name' THEN RAISE EXCEPTION 'Existing catalog source identity differs'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.catalog_reference_documents l WHERE l.catalog_id=c.id
  AND l.page_mapping_receipt->>'full_pdf_sha256'=p_catalog->>'full_pdf_sha256'
  AND l.page_mapping_receipt->>'expected_page_count' IS DISTINCT FROM expected_count::text)
  THEN RAISE EXCEPTION 'Catalog edition page count conflicts'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_pages) ORDER BY (value->>'catalog_page_number')::integer LOOP
  page_no:=(item->>'catalog_page_number')::integer;
  -- Object first matches the retained-source writer. NOWAIT refuses a
  -- concurrent change instead of waiting in the middle of a 220-page batch.
  SELECT (source_capture->>'storage_object_id')::uuid INTO candidate_object_id
   FROM public.reference_documents WHERE id=(item->>'document_id')::uuid;
  SELECT o.id INTO obj_id FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id
   WHERE o.id=candidate_object_id FOR SHARE OF o,b NOWAIT;
  SELECT * INTO d FROM public.reference_documents WHERE id=(item->>'document_id')::uuid FOR SHARE NOWAIT;
  SELECT * INTO page_record FROM public.document_pages WHERE id=(item->>'document_page_id')::uuid AND document_id=d.id FOR SHARE NOWAIT;
  IF d.id IS NULL OR page_record.id IS NULL OR obj_id IS NULL OR d.category IS DISTINCT FROM 'parts_catalog'
   OR (d.source_capture->>'storage_object_id')::uuid IS DISTINCT FROM obj_id
   OR d.page_count IS DISTINCT FROM 1 OR page_record.page_number IS DISTINCT FROM 1
   OR d.file_hash IS DISTINCT FROM item->>'pdf_sha256' OR d.superseded_by IS NOT NULL THEN RAISE EXCEPTION 'Source page unavailable'; END IF;
  IF d.source_capture->>'schema'='attested_pdf_text_v1' THEN
   IF public.attested_pdf_text_evidence(d.id) IS NULL THEN RAISE EXCEPTION 'Attested page source not current'; END IF;
  ELSIF d.source_capture->>'schema'='supplied_reference_v1' THEN
   IF public.reference_document_evidence(d.id) IS NULL THEN RAISE EXCEPTION 'Supplied page source not current'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported retained page source'; END IF;
  revision:=d.source_capture->>'revision';
  IF coalesce(revision,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Source revision unavailable'; END IF;
  receipt:=jsonb_build_object('schema','catalog_page_mapping_client_attested_v1',
   'catalog_name',c.name,'provider',c.provider,'base_url',c.base_url,'full_pdf_sha256',p_catalog->>'full_pdf_sha256',
   'expected_page_count',expected_count,'catalog_page_number',page_no,'document_id',d.id,
   'document_page_id',page_record.id,'source_revision',revision,'source_pdf_sha256',d.file_hash,'source_url',d.source_url,
   'word_geometry_sha256',item->>'full_geometry_sha256','render_72dpi_sha256',item->>'full_render_sha256',
   'reader_actor',p_catalog->>'reader_actor','reader_run_id',p_catalog->>'reader_run_id',
   'reader_verified_at',p_catalog->>'reader_verified_at',
   'comparison_status','client_attested_not_server_reextracted');
  receipt_sha:=encode(extensions.digest(convert_to(receipt::text,'UTF8'),'sha256'),'hex');
  IF EXISTS(SELECT 1 FROM public.catalog_reference_documents l WHERE l.catalog_id=c.id AND l.catalog_page_number=page_no
   AND l.page_mapping_receipt->>'full_pdf_sha256'=p_catalog->>'full_pdf_sha256' AND l.reference_document_id<>d.id)
   THEN RAISE EXCEPTION 'Catalog page has competing source'; END IF;
  SELECT * INTO existing FROM public.catalog_reference_documents WHERE catalog_id=c.id AND reference_document_id=d.id FOR SHARE;
  IF FOUND THEN
   IF existing.source_revision IS DISTINCT FROM revision OR existing.document_page_id IS DISTINCT FROM page_record.id
    OR existing.catalog_page_number IS DISTINCT FROM page_no OR existing.page_mapping_receipt IS DISTINCT FROM receipt
    OR existing.page_mapping_receipt_sha256 IS DISTINCT FROM receipt_sha THEN RAISE EXCEPTION 'Existing catalog page membership differs'; END IF;
   replayed_count:=replayed_count+1;
  ELSE
   INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision,catalog_page_number,document_page_id,page_mapping_receipt,page_mapping_receipt_sha256)
   VALUES(c.id,d.id,revision,page_no,page_record.id,receipt,receipt_sha);
   inserted_count:=inserted_count+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('success',true,'catalog_id',c.id,'pages_submitted',jsonb_array_length(p_pages),
  'inserted',inserted_count,'replayed',replayed_count,'mapping_status','client_attested_not_server_reextracted');
END $fn$;
REVOKE ALL ON FUNCTION public.record_catalog_page_membership(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_catalog_page_membership(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.catalog_page_member_evidence(p_catalog uuid,p_page integer,p_full_pdf_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE l public.catalog_reference_documents%ROWTYPE; c public.catalog_sources%ROWTYPE; d public.reference_documents%ROWTYPE;
 n integer; r jsonb;
BEGIN
 SELECT count(*) INTO n FROM public.catalog_reference_documents WHERE catalog_id=p_catalog AND catalog_page_number=p_page
  AND page_mapping_receipt->>'full_pdf_sha256'=p_full_pdf_sha256;
 IF n<>1 THEN RETURN NULL; END IF;
 SELECT * INTO l FROM public.catalog_reference_documents WHERE catalog_id=p_catalog AND catalog_page_number=p_page
  AND page_mapping_receipt->>'full_pdf_sha256'=p_full_pdf_sha256;
 SELECT * INTO c FROM public.catalog_sources WHERE id=l.catalog_id;
 SELECT * INTO d FROM public.reference_documents WHERE id=l.reference_document_id AND superseded_by IS NULL;
 r:=l.page_mapping_receipt;
 IF c.id IS NULL OR d.id IS NULL OR l.document_page_id IS NULL OR r->>'schema' IS DISTINCT FROM 'catalog_page_mapping_client_attested_v1'
  OR (SELECT count(*) FROM public.catalog_sources x WHERE x.provider=c.provider AND x.base_url=c.base_url)<>1
  OR r->>'catalog_name' IS DISTINCT FROM c.name OR r->>'provider' IS DISTINCT FROM c.provider OR r->>'base_url' IS DISTINCT FROM c.base_url
  OR r->>'catalog_page_number' IS DISTINCT FROM l.catalog_page_number::text
  OR r->>'document_id' IS DISTINCT FROM d.id::text OR r->>'document_page_id' IS DISTINCT FROM l.document_page_id::text
  OR r->>'source_revision' IS DISTINCT FROM l.source_revision
  OR coalesce(r->>'expected_page_count','') !~ '^[0-9]{1,4}$'
  OR l.catalog_page_number>(r->>'expected_page_count')::integer
  OR EXISTS(SELECT 1 FROM public.catalog_reference_documents x WHERE x.catalog_id=c.id
   AND x.page_mapping_receipt->>'full_pdf_sha256'=p_full_pdf_sha256
   AND x.page_mapping_receipt->>'expected_page_count' IS DISTINCT FROM r->>'expected_page_count')
  OR r->>'source_pdf_sha256' IS DISTINCT FROM d.file_hash OR r->>'source_url' IS DISTINCT FROM d.source_url
  OR r->>'comparison_status' IS DISTINCT FROM 'client_attested_not_server_reextracted'
  OR l.source_revision IS DISTINCT FROM d.source_capture->>'revision'
  OR l.page_mapping_receipt_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(r::text,'UTF8'),'sha256'),'hex')
  OR NOT EXISTS(SELECT 1 FROM public.document_pages p WHERE p.id=l.document_page_id AND p.document_id=d.id AND p.page_number=1)
  THEN RETURN NULL; END IF;
 IF d.source_capture->>'schema'='attested_pdf_text_v1' THEN
  IF public.attested_pdf_text_evidence(d.id) IS NULL THEN RETURN NULL; END IF;
 ELSIF d.source_capture->>'schema'='supplied_reference_v1' THEN
  IF public.reference_document_evidence(d.id) IS NULL THEN RETURN NULL; END IF;
 ELSE RETURN NULL; END IF;
 RETURN jsonb_build_object('catalog_id',c.id,'catalog_page_number',l.catalog_page_number,
  'document_id',d.id,'document_page_id',l.document_page_id,'source_revision',l.source_revision,
  'full_pdf_sha256_attestation',r->>'full_pdf_sha256','mapping_status','client_attested_not_server_reextracted');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.catalog_page_member_evidence(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_page_member_evidence(uuid,integer,text) TO service_role;
COMMENT ON FUNCTION public.catalog_page_member_evidence(uuid,integer,text) IS
 'Rechecks the retained page source and typed catalog link. Mapping to the unretained complete PDF is explicitly client-attested, not a listing or vehicle assertion.';
COMMIT;
