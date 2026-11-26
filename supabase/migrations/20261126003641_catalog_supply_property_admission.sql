-- Supplied catalog source bytes and property claims; no verified supplier/stock assertion.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

INSERT INTO public.observation_sources(id,slug,display_name,category,base_trust_score,supported_observations,notes)
SELECT '0cc5d613-503e-4d63-ad2d-e1856aa15e9c'::uuid,'supplied-catalog-document','Supplied catalog document (origin unverified)',category,.5,
 ARRAY['specification']::public.observation_kind[],
 'A supplied retained document, not an authenticated supplier fetch. No purchasing or possession conclusion.'
FROM public.observation_sources WHERE slug='manual_upload'
ON CONFLICT(slug) DO NOTHING;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.observation_sources WHERE slug='supplied-catalog-document' AND id='0cc5d613-503e-4d63-ad2d-e1856aa15e9c')
 THEN RAISE EXCEPTION 'Manual-upload source owner unavailable'; END IF; END $$;

CREATE FUNCTION public.record_supplied_catalog_document(p_document jsonb,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE obj storage.objects%ROWTYPE; d public.reference_documents%ROWTYPE; h text; rev text; claimed timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_document) IS DISTINCT FROM 'object'
 OR (p_document-ARRAY['title','source_url','file_sha256','claimed_captured_at','media_type'])<>'{}'::jsonb
 OR p_document->>'media_type' IS DISTINCT FROM 'text/markdown'
 OR length(coalesce(p_document->>'title','')) NOT BETWEEN 1 AND 500
 OR coalesce(p_document->>'source_url','') !~ '^https://[^/@?#[:space:]]+/[^?#[:space:]]*$'
 OR octet_length(p_body) NOT BETWEEN 1 AND 262144 OR p_body IS NULL
 OR coalesce(p_document->>'file_sha256','') !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'Invalid supplied Markdown'; END IF;
 h:=encode(sha256(convert_to(p_body,'UTF8')),'hex');
 IF h IS DISTINCT FROM p_document->>'file_sha256' THEN RAISE EXCEPTION 'Retained byte hash mismatch'; END IF;
 claimed:=(p_document->>'claimed_captured_at')::timestamptz;
 IF claimed IS NOT NULL AND (NOT isfinite(claimed) OR claimed>statement_timestamp()+interval '5 minutes') THEN
 RAISE EXCEPTION 'Invalid claimed capture clock'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplied-catalog:'||h,0));
 SELECT o.* INTO obj FROM storage.objects o JOIN storage.buckets b ON b.id=o.bucket_id
 WHERE o.bucket_id='reference-docs' AND o.name='supplied/'||h||'.md' AND b.public IS TRUE FOR SHARE OF o,b;
 IF NOT FOUND OR obj.version IS NULL OR obj.user_metadata->>'sha256' IS DISTINCT FROM h
 OR obj.user_metadata->>'source_role' IS DISTINCT FROM 'supplied_catalog_unverified'
 OR obj.metadata->>'mimetype' IS DISTINCT FROM 'text/markdown'
 OR (obj.metadata->>'size')::bigint IS DISTINCT FROM octet_length(p_body)
 THEN RAISE EXCEPTION 'Exact retained Markdown unavailable'; END IF;
 rev:=encode(sha256(convert_to(jsonb_build_object('document',p_document,'object_id',obj.id,'version',obj.version)::text,'UTF8')),'hex');
 SELECT * INTO d FROM public.reference_documents WHERE slug='supplied-catalog-'||rev FOR SHARE;
 IF FOUND THEN
  IF d.superseded_by IS NOT NULL OR d.file_hash IS DISTINCT FROM h
   OR d.source_capture->>'revision' IS DISTINCT FROM rev THEN RAISE EXCEPTION 'Supplied source withdrawn'; END IF;
  RETURN jsonb_build_object('success',true,'document_id',d.id,'file_hash',h,'reference_revision',rev,'duplicate',true);
 END IF;
 INSERT INTO public.reference_documents(slug,title,category,file_path,file_hash,file_size_bytes,page_count,base_trust_score,
 extraction_method,extraction_quality,extracted_at,source_url,source_capture)
 VALUES('supplied-catalog-'||rev,p_document->>'title','parts_catalog','reference-docs/'||obj.name,h,octet_length(p_body),1,.5,
 'supplied_catalog_markdown_v1','original_supplied_utf8',statement_timestamp(),p_document->>'source_url',
 jsonb_build_object('schema','supplied_catalog_markdown_v1','authority','supplied_document_unverified',
 'visibility','public_reference','revision',rev,'document',p_document,'storage_object_id',obj.id,'storage_version',obj.version,
 'claimed_captured_at',claimed,'imported_at',statement_timestamp(),'media_type','text/markdown','body_sha256',h))
 RETURNING * INTO d;
 INSERT INTO public.document_pages(document_id,page_number,extracted_text,has_diagrams,extraction_method,extraction_notes,extracted_at)
 VALUES(d.id,1,p_body,false,'supplied_catalog_markdown_v1','Original supplied UTF-8 Markdown; line numbers are selectors, not printed pages.',statement_timestamp());
 RETURN jsonb_build_object('success',true,'document_id',d.id,'file_hash',h,'reference_revision',rev,'duplicate',false);
END $fn$;

CREATE FUNCTION public.catalog_document_evidence(p_document uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE d public.reference_documents%ROWTYPE; b text; obj storage.objects%ROWTYPE; rev text;
BEGIN
 SELECT * INTO d FROM public.reference_documents WHERE id=p_document AND superseded_by IS NULL
 AND extraction_method='supplied_catalog_markdown_v1' AND source_capture->>'schema'='supplied_catalog_markdown_v1'
 AND source_capture->>'authority'='supplied_document_unverified';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.* INTO obj FROM storage.objects o JOIN storage.buckets k ON k.id=o.bucket_id AND k.public IS TRUE
 WHERE o.bucket_id='reference-docs' AND 'reference-docs/'||o.name=d.file_path
 AND o.name='supplied/'||d.file_hash||'.md' AND o.id::text=d.source_capture->>'storage_object_id'
 AND o.version=d.source_capture->>'storage_version' AND o.user_metadata->>'sha256'=d.file_hash
 AND o.user_metadata->>'source_role'='supplied_catalog_unverified'
 AND o.metadata->>'mimetype'='text/markdown' AND (o.metadata->>'size')::bigint=d.file_size_bytes;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT extracted_text INTO b FROM public.document_pages WHERE document_id=d.id AND page_number=1
 AND extraction_method='supplied_catalog_markdown_v1';
 IF b IS NULL OR encode(sha256(convert_to(b,'UTF8')),'hex') IS DISTINCT FROM d.file_hash
 OR d.source_capture#>>'{document,source_url}' IS DISTINCT FROM d.source_url
 OR d.source_capture#>>'{document,file_sha256}' IS DISTINCT FROM d.file_hash
 OR d.source_capture#>>'{document,title}' IS DISTINCT FROM d.title
 OR d.source_capture#>>'{document,media_type}' IS DISTINCT FROM 'text/markdown'
 THEN RETURN NULL; END IF;
 rev:=encode(sha256(convert_to(jsonb_build_object('document',d.source_capture->'document','object_id',obj.id,'version',obj.version)::text,'UTF8')),'hex');
 IF rev IS DISTINCT FROM d.source_capture->>'revision' OR d.slug IS DISTINCT FROM 'supplied-catalog-'||rev THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('document_id',d.id,'body',b,'file_hash',d.file_hash,'revision',rev,'source_url',d.source_url,
 'imported_at',d.added_at,'claimed_captured_at',d.source_capture#>'{document,claimed_captured_at}',
 'authority','supplied_document_unverified','purchasing_eligible',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $fn$;

-- One bounded grammar over original lines. It never searches related-product cards.
CREATE FUNCTION public.catalog_supply_witness(p_body text,p_number text,p_line integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE lines text[]; l text; primary_end int; overview int; line_text text; clean text; m text[];
 quantity numeric; unit text; role text; label text; sku_line int; sale_line int; component_heading int; i int;
BEGIN
 IF octet_length(p_body) NOT BETWEEN 1 AND 262144 OR p_line IS NULL OR p_line<1
 OR length(coalesce(p_number,'')) NOT BETWEEN 1 AND 100 THEN RETURN NULL; END IF;
 lines:=string_to_array(p_body,E'\n'); primary_end:=cardinality(lines)+1;
 FOR i IN 1..cardinality(lines) LOOP
  l:=btrim(lines[i],E'\r ');
  IF overview IS NOT NULL AND l ~ '^## ' THEN primary_end:=least(primary_end,i); END IF;
  IF l='## Overview' AND overview IS NULL THEN overview:=i; END IF;
 END LOOP;
 IF overview IS NULL OR p_line<=overview OR p_line>=primary_end THEN RETURN NULL; END IF;
 FOR i IN 1..overview-1 LOOP
  l:=btrim(lines[i],E'\r ');
  IF l ~ '^Item No[.]' THEN
   IF sku_line IS NOT NULL OR l IS DISTINCT FROM 'Item No. '||p_number THEN RETURN NULL; END IF; sku_line:=i;
  END IF;
  IF l ~ '^\$[0-9]+([.][0-9]+)? / Each$' THEN
   IF sale_line IS NOT NULL THEN RETURN NULL; END IF; sale_line:=i;
  END IF;
 END LOOP;
 IF sku_line IS NULL OR sale_line IS NULL THEN RETURN NULL; END IF;
 line_text:=lines[p_line]; clean:=btrim(replace(replace(line_text,'**',''),chr(160),' '),E'\r ');
 m:=regexp_match(clean,'^Pack Quantity: ([0-9]+) (Each|EA)$');
 IF m IS NOT NULL THEN quantity:=m[1]::numeric; unit:='ea'; role:='sale_unit_contents';
 ELSE
  m:=regexp_match(clean,'^Stock Length: ([0-9]+([.][0-9]+)?) (FT|ft|feet|foot)$');
  IF m IS NOT NULL THEN quantity:=m[1]::numeric; unit:='ft'; role:='sale_unit_contents';
  ELSE
   FOR i IN overview+1..p_line-1 LOOP
    l:=btrim(replace(replace(lines[i],'**',''),chr(160),' '),E'\r ');
    IF l IN('Kit Includes:','Connector Kit Details:') THEN component_heading:=i; END IF;
   END LOOP;
   IF component_heading IS NULL THEN RETURN NULL; END IF;
   m:=regexp_match(clean,'^- (Qty )?([0-9]+):? (.+)$');
   IF m IS NULL OR m[3] ~* '^(way|awg|ga|volt|amp|mm|inch|ft|feet|year|years|month|months|day|days)\M' THEN RETURN NULL; END IF;
   quantity:=m[2]::numeric; label:=m[3]; unit:='ea'; role:='kit_component_quantity';
  END IF;
 END IF;
 IF quantity<=0 OR quantity>1000000 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('qualification_version','catalog_supply_literal_v1','normalization_version','catalog_supply_units_v1','property_kind',role,
 'quantity',quantity,'quantity_unit',unit,'per_sale_quantity',1,'sale_unit','each',
 'component_label',label,'component_catalog_part_id',NULL,'contents_completeness','not_established',
 'source_line',p_line,'source_value',line_text,'product_line',sku_line,'product_value',lines[sku_line],
 'sale_basis_line',sale_line,'sale_basis_value',lines[sale_line],
 'source_field','document_pages.extracted_text','selector_encoding','one_based_utf8_text_line');
END $fn$;

CREATE FUNCTION public.qualify_catalog_document(p_document uuid,p_result uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE e jsonb; r jsonb; sid uuid; ok boolean;
BEGIN
 e:=public.catalog_document_evidence(p_document); IF e IS NULL THEN RETURN NULL; END IF;
 SELECT id INTO sid FROM public.observation_sources WHERE slug='supplied-catalog-document';
 IF sid IS NULL THEN RETURN NULL; END IF;
 r:=jsonb_build_object('source_id',sid,'kind','specification','vehicle_id',NULL,'subject_type','asset','subject_id',NULL,
 'source_observation_id',NULL,'source_url',e->>'source_url','source_identifier','supplied-catalog-source:'||(e->>'revision'),
 'observed_at',e->'imported_at','extraction_method','supplied_catalog_source_v1','raw_source_ref','reference_documents:'||p_document,
 'content_text',e->>'body','confidence_score',.5,'analysis_deferred',true,'is_superseded',false,'superseded_by',NULL,'superseded_at',NULL,
 'citation_document_id',p_document,'citation_page_number',1,'citation_excerpt',NULL,
 'structured_data',e-'body'||jsonb_build_object('profile','supplied_catalog_source_v1','observed_at_basis','document_import_time'));
 r:=r||jsonb_build_object('content_hash',encode(sha256(convert_to(r::text,'UTF8')),'hex'));
 IF p_result IS NOT NULL THEN SELECT to_jsonb(o) @> r AND o.structured_data=r->'structured_data' INTO ok FROM public.vehicle_observations o WHERE id=p_result;
  IF ok IS DISTINCT FROM true THEN RETURN NULL; END IF; END IF;
 RETURN jsonb_build_object('input',r,'result_verified',p_result IS NOT NULL,'authority','supplied_document_unverified','purchasing_eligible',false);
END $fn$;

CREATE FUNCTION public.qualify_catalog_supply_property(p_source uuid,p_part uuid,p_line integer,p_result uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE s public.vehicle_observations%ROWTYPE; p public.catalog_parts%ROWTYPE; e jsonb; w jsonb; r jsonb; ok boolean; identity jsonb;
BEGIN
 SELECT * INTO s FROM public.vehicle_observations WHERE id=p_source;
 IF NOT FOUND OR public.qualify_catalog_document(s.citation_document_id,s.id) IS NULL THEN RETURN NULL; END IF;
 e:=public.catalog_document_evidence(s.citation_document_id);
 SELECT cp.* INTO p FROM public.catalog_parts cp JOIN public.catalog_sources cs ON cs.id=cp.catalog_id
 WHERE cp.id=p_part AND cp.supplier_url=e->>'source_url'
 AND lower(substring(cs.base_url from '^https://([^/:?#]+)'))=lower(substring(e->>'source_url' from '^https://([^/:?#]+)'));
 IF NOT FOUND THEN RETURN NULL; END IF;
 w:=public.catalog_supply_witness(e->>'body',p.part_number,p_line); IF w IS NULL THEN RETURN NULL; END IF;
 identity:=jsonb_build_object('id',p.id,'catalog_id',p.catalog_id,'part_number',p.part_number,'supplier_url',p.supplier_url);
 w:=w||jsonb_build_object('catalog_identity_sha256',encode(sha256(convert_to(identity::text,'UTF8')),'hex'),
 'catalog_part_id',p.id,'source_observation_id',s.id,'document_id',s.citation_document_id,'document_revision',e->>'revision',
 'body_sha256',e->>'file_hash','authority','supplied_document_unverified','purchasing_eligible',false,
 'profile','catalog_supply_property_v1');
 r:=jsonb_build_object('source_id',s.source_id,'kind','specification','vehicle_id',NULL,'subject_type','asset','subject_id',p.id,
 'source_observation_id',s.id,'source_url',s.source_url,
 'source_identifier','catalog-supply:'||encode(sha256(convert_to(w::text,'UTF8')),'hex'),
 'observed_at',s.observed_at,'extraction_method','catalog_supply_property_v1','raw_source_ref','vehicle_observations:'||s.id,
 'content_text',w->>'source_value','confidence_score',.5,'analysis_deferred',true,'is_superseded',false,'superseded_by',NULL,'superseded_at',NULL,
 'citation_document_id',s.citation_document_id,'citation_page_number',1,'citation_excerpt',w->>'source_value','structured_data',w);
 r:=r||jsonb_build_object('content_hash',encode(sha256(convert_to(r::text,'UTF8')),'hex'));
 IF p_result IS NOT NULL THEN SELECT to_jsonb(o) @> r AND o.structured_data=r->'structured_data' INTO ok FROM public.vehicle_observations o WHERE id=p_result;
  IF ok IS DISTINCT FROM true THEN RETURN NULL; END IF; END IF;
 RETURN jsonb_build_object('input',r,'property',w,'result_verified',p_result IS NOT NULL,'purchasing_eligible',false);
END $fn$;

CREATE TABLE public.catalog_supply_properties(
 observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
 source_observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id),
 catalog_part_id uuid NOT NULL REFERENCES public.catalog_parts(id),
 document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 source_line integer NOT NULL CHECK(source_line>0),
 property_kind text NOT NULL CHECK(property_kind IN('sale_unit_contents','kit_component_quantity')),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity<=1000000),
 quantity_unit text NOT NULL CHECK(quantity_unit IN('ea','ft')),
 qualification_version text NOT NULL,
 normalization_version text NOT NULL,
 property_sha256 text NOT NULL,
 UNIQUE(source_observation_id,catalog_part_id,source_line,qualification_version,normalization_version),
 CHECK(quantity_unit<>'ea' OR quantity=trunc(quantity))
);
ALTER TABLE public.catalog_supply_properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_supply_properties FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalog_supply_properties TO service_role;
COMMENT ON TABLE public.catalog_supply_properties IS 'Immutable source-qualified literal property index over supplied catalog observations. A supplied URL does not verify supplier authority; all v1 rows remain withheld from purchasing. Writer: guarded ingest-observation only.';


COMMENT ON COLUMN public.catalog_supply_properties.observation_id IS 'Canonical immutable property observation; the typed row is its index, not another source claim.';
COMMENT ON COLUMN public.catalog_supply_properties.source_observation_id IS 'Exact supplied-document observation qualified when this property was admitted.';
COMMENT ON COLUMN public.catalog_supply_properties.catalog_part_id IS 'Exact supplier catalog product whose identity is witnessed in the same retained document.';
COMMENT ON COLUMN public.catalog_supply_properties.document_id IS 'Retained reference-document revision containing the original UTF-8 property witness.';
COMMENT ON COLUMN public.catalog_supply_properties.source_line IS 'One-based original text line selector; never a printed page number.';
COMMENT ON COLUMN public.catalog_supply_properties.property_kind IS 'Literal sale-unit contents or one named kit-component quantity; completeness is not inferred.';
COMMENT ON COLUMN public.catalog_supply_properties.quantity IS 'Positive literal physical quantity stated in one source claim; not summable received stock.';
COMMENT ON COLUMN public.catalog_supply_properties.quantity_unit IS 'Normalized physical unit: individual count ea or length ft. The original witness remains in the observation.';
COMMENT ON COLUMN public.catalog_supply_properties.qualification_version IS 'Version of the exact-source qualification grammar; part of immutable interpretation identity.';
COMMENT ON COLUMN public.catalog_supply_properties.normalization_version IS 'Version of unit normalization; part of immutable interpretation identity.';
COMMENT ON COLUMN public.catalog_supply_properties.property_sha256 IS 'SHA-256 of the complete admitted structured claim; not a signature or supplier-authority proof.';

CREATE FUNCTION public.guard_catalog_supply_observation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE q jsonb; d uuid; source_id uuid; prop boolean; target public.vehicle_observations%ROWTYPE;
BEGIN
 SELECT id INTO source_id FROM public.observation_sources WHERE slug='supplied-catalog-document';
 IF NEW.source_id IS DISTINCT FROM source_id AND coalesce(NEW.extraction_method,'') NOT IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 AND coalesce(NEW.structured_data->>'profile','') NOT IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 AND (TG_OP='INSERT' OR OLD.source_id IS DISTINCT FROM source_id) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
  OR (OLD.is_superseded IS TRUE AND NEW.is_superseded IS NOT TRUE)
  OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)
  OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
  OR ((NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL) AND NEW.is_superseded IS NOT TRUE)
  THEN RAISE EXCEPTION 'Catalog testimony is immutable; supersede it coherently'; END IF;
  RETURN NEW;
 END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' OR NEW.source_id IS DISTINCT FROM source_id THEN
 RAISE EXCEPTION 'Catalog source admission refused' USING ERRCODE='42501'; END IF;
 prop:=NEW.extraction_method='catalog_supply_property_v1';
 d:=NEW.citation_document_id;
 -- Same lock order as supplied reference: bucket/object, document/pages, source, product.
 PERFORM 1 FROM storage.buckets WHERE id='reference-docs' FOR SHARE;
 PERFORM 1 FROM storage.objects WHERE bucket_id='reference-docs' AND
 'reference-docs/'||name=(SELECT file_path FROM public.reference_documents WHERE id=d) FOR SHARE;
 PERFORM 1 FROM public.reference_documents WHERE id=d FOR SHARE;
 PERFORM 1 FROM public.document_pages WHERE document_id=d FOR SHARE;
 IF prop THEN
  SELECT * INTO target FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
  IF target.citation_document_id IS DISTINCT FROM d THEN RAISE EXCEPTION 'Source document mismatch'; END IF;
  PERFORM 1 FROM public.catalog_parts WHERE id=NEW.subject_id FOR SHARE;
  PERFORM 1 FROM public.catalog_sources WHERE id=(SELECT catalog_id FROM public.catalog_parts WHERE id=NEW.subject_id) FOR SHARE;
  q:=public.qualify_catalog_supply_property(NEW.source_observation_id,NEW.subject_id,(NEW.structured_data->>'source_line')::int);
 ELSE
  IF NEW.extraction_method IS DISTINCT FROM 'supplied_catalog_source_v1' THEN RAISE EXCEPTION 'Catalog method refused'; END IF;
  q:=public.qualify_catalog_document(d);
 END IF;
 IF q IS NULL OR NOT(to_jsonb(NEW) @> (q->'input'))
 OR NEW.structured_data IS DISTINCT FROM q#>'{input,structured_data}'
 THEN RAISE EXCEPTION 'Catalog observation disagrees with exact retained source'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER guard_catalog_supply_observation_insert BEFORE INSERT ON public.vehicle_observations
 FOR EACH ROW WHEN (NEW.source_id='0cc5d613-503e-4d63-ad2d-e1856aa15e9c'
 OR NEW.extraction_method IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 OR NEW.structured_data->>'profile' IN('supplied_catalog_source_v1','catalog_supply_property_v1'))
 EXECUTE FUNCTION public.guard_catalog_supply_observation();
CREATE TRIGGER guard_catalog_supply_observation_update BEFORE UPDATE ON public.vehicle_observations
 FOR EACH ROW WHEN (NEW.source_id='0cc5d613-503e-4d63-ad2d-e1856aa15e9c' OR OLD.source_id='0cc5d613-503e-4d63-ad2d-e1856aa15e9c'
 OR NEW.extraction_method IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 OR OLD.extraction_method IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 OR NEW.structured_data->>'profile' IN('supplied_catalog_source_v1','catalog_supply_property_v1')
 OR OLD.structured_data->>'profile' IN('supplied_catalog_source_v1','catalog_supply_property_v1'))
 EXECUTE FUNCTION public.guard_catalog_supply_observation();

CREATE FUNCTION public.project_catalog_supply_observation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE w jsonb;
BEGIN
 IF NEW.extraction_method IS DISTINCT FROM 'catalog_supply_property_v1' THEN RETURN NULL; END IF;
 w:=NEW.structured_data;
 INSERT INTO public.catalog_supply_properties(observation_id,source_observation_id,catalog_part_id,document_id,source_line,property_kind,quantity,quantity_unit,qualification_version,normalization_version,property_sha256)
 VALUES(NEW.id,NEW.source_observation_id,NEW.subject_id,NEW.citation_document_id,(w->>'source_line')::int,w->>'property_kind',
 (w->>'quantity')::numeric,w->>'quantity_unit',w->>'qualification_version',w->>'normalization_version',encode(sha256(convert_to(w::text,'UTF8')),'hex'));
 RETURN NULL;
END $fn$;
CREATE TRIGGER project_catalog_supply_observation AFTER INSERT ON public.vehicle_observations
 FOR EACH ROW WHEN (NEW.extraction_method='catalog_supply_property_v1') EXECUTE FUNCTION public.project_catalog_supply_observation();
CREATE FUNCTION public.catalog_supply_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'Catalog property index is immutable'; END $fn$;
CREATE TRIGGER catalog_supply_immutable BEFORE UPDATE OR DELETE ON public.catalog_supply_properties
 FOR EACH ROW EXECUTE FUNCTION public.catalog_supply_immutable();

CREATE FUNCTION public.current_catalog_supply_properties(p_part uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(jsonb_agg(jsonb_build_object('observation_id',x.observation_id,'source_observation_id',x.source_observation_id,
 'catalog_part_id',x.catalog_part_id,'document_id',x.document_id,'current',q IS NOT NULL,
 'property',q->'property','purchasing_eligible',false,'quantity_role','individual_source_claim_not_summable_supply',
 'hold_reason',CASE WHEN q IS NULL THEN 'source_changed_or_withdrawn' ELSE 'supplied_document_authority_unverified' END)
 ORDER BY x.observation_id),'[]'::jsonb)
 FROM public.catalog_supply_properties x
 LEFT JOIN LATERAL public.qualify_catalog_supply_property(x.source_observation_id,x.catalog_part_id,x.source_line,x.observation_id) q ON true
 WHERE x.catalog_part_id=p_part
$fn$;

REVOKE ALL ON FUNCTION public.record_supplied_catalog_document(jsonb,text),public.catalog_document_evidence(uuid),
 public.catalog_supply_witness(text,text,integer),public.qualify_catalog_document(uuid,uuid),
 public.qualify_catalog_supply_property(uuid,uuid,integer,uuid),public.guard_catalog_supply_observation(),
 public.project_catalog_supply_observation(),public.catalog_supply_immutable(),public.current_catalog_supply_properties(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplied_catalog_document(jsonb,text),public.catalog_document_evidence(uuid),
 public.catalog_supply_witness(text,text,integer),public.qualify_catalog_document(uuid,uuid),
 public.qualify_catalog_supply_property(uuid,uuid,integer,uuid),public.current_catalog_supply_properties(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
