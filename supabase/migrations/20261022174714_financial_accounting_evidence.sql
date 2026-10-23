BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Preserve sourced projections, including if legacy direct table grants exist.
CREATE OR REPLACE FUNCTION public.guard_financial_evidence_lines() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.attributes ?| ARRAY['intake_mode','extraction_run_id','accounting_record','staging'] AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'sanctioned admission required'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.attributes ?| ARRAY['intake_mode','extraction_run_id','accounting_record','staging'] OR (TG_OP='UPDATE' AND NEW.attributes ?| ARRAY['intake_mode','extraction_run_id','accounting_record','staging']) THEN RAISE EXCEPTION 'financial evidence lines are append-only'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_evidence_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON financial_document_lines FOR EACH ROW EXECUTE FUNCTION public.guard_financial_evidence_lines();

-- Typed indexes of retained extraction, not purchases or approved accounting.
-- Existing line_number is a document-unique storage sequence. The observed number
-- remains in staging because corrections append rather than overwrite testimony.
CREATE OR REPLACE FUNCTION public.project_financial_document_lines(
 p_owner_id uuid,p_document_id uuid,p_run_id uuid,p_lines jsonb,p_prior uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d financial_documents%ROWTYPE; x jsonb; n integer; k text;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM financial_documents WHERE id=p_document_id AND owner_id=p_owner_id FOR UPDATE;
 IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE document_id=d.id AND owner_id=p_owner_id AND extraction_run_id=p_run_id) THEN RAISE EXCEPTION 'current extraction basis required'; END IF;
 IF p_lines IS NULL THEN
  IF EXISTS(SELECT 1 FROM financial_document_lines WHERE document_id=d.id AND attributes->>'extraction_run_id'=p_prior::text AND attributes ? 'staging') THEN RAISE EXCEPTION 'correction must explicitly carry lines'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)>500 THEN RAISE EXCEPTION 'invalid line population'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_lines))<>(SELECT count(DISTINCT v->>'source_line_key') FROM jsonb_array_elements(p_lines) v) THEN RAISE EXCEPTION 'duplicate source line'; END IF;
 SELECT coalesce(max(line_number),0) INTO n FROM financial_document_lines WHERE document_id=d.id;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) key WHERE key NOT IN ('source_line_key','source_row','source_file_sha256','source_document_sha256','line_number','description_raw','sku_raw','quantity','unit_price','amount','currency','raw_line_sha256','evidence_stage','geometry','issues'))
   OR coalesce(x->>'source_line_key','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'source_file_sha256','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'raw_line_sha256','') !~ '^[a-f0-9]{64}$'
   OR x->>'source_document_sha256' IS DISTINCT FROM d.content_sha256
   OR coalesce(x->>'source_row','') !~ '^[0-9]{1,8}$'
   OR (x->>'source_row')::integer<2
   OR (x->>'line_number' IS NOT NULL AND x->>'line_number' !~ '^[0-9]{1,8}$')
   OR coalesce(length(x->>'description_raw'),0)>500 OR coalesce(length(x->>'sku_raw'),0)>100
   OR x->>'evidence_stage' IS DISTINCT FROM 'attributed_retained_parse'
   OR coalesce(x->'geometry','null'::jsonb)<>'null'::jsonb
   OR (x->>'currency' IS NOT NULL AND x->>'currency' !~ '^[A-Z]{3}$')
   OR jsonb_typeof(x->'issues') IS DISTINCT FROM 'array' OR octet_length(x::text)>4000
  THEN RAISE EXCEPTION 'invalid attributed line'; END IF;
  FOREACH k IN ARRAY ARRAY['quantity','unit_price','amount'] LOOP
   IF x->>k IS NOT NULL AND (jsonb_typeof(x->k)<>'string' OR x->>k !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$') THEN RAISE EXCEPTION 'invalid line decimal'; END IF;
  END LOOP;
  n:=n+1;
  INSERT INTO financial_document_lines(owner_id,document_id,line_number,reference_code,description,quantity,attributes,privacy_tier)
  VALUES(p_owner_id,d.id,n,x->>'sku_raw',x->>'description_raw',(x->>'quantity')::numeric,
   jsonb_build_object('intake_mode','financial_evidence_v1','extraction_run_id',p_run_id,'staging',x,'tax_basis','unknown','recognition_status','not_assessed','payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved'),'private');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.project_financial_document_lines(uuid,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_document_lines(uuid,uuid,uuid,jsonb,uuid) TO service_role;

-- Bank movements and prior ledger decisions retain independent stages. In particular,
-- an Expense label does not approve a deduction, payment match or vehicle allocation.
CREATE OR REPLACE FUNCTION public.project_financial_accounting_records(
 p_owner_id uuid,p_document_id uuid,p_run_id uuid,p_records jsonb,p_prior uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x jsonb; n integer; d financial_documents%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM financial_documents WHERE id=p_document_id AND owner_id=p_owner_id FOR UPDATE;
 IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE document_id=d.id AND owner_id=p_owner_id AND extraction_run_id=p_run_id) THEN RAISE EXCEPTION 'current extraction basis required'; END IF;
 IF p_records IS NULL THEN
  IF EXISTS(SELECT 1 FROM financial_document_lines WHERE document_id=d.id AND attributes->>'extraction_run_id'=p_prior::text AND attributes ? 'accounting_record') THEN RAISE EXCEPTION 'correction must explicitly carry accounting records'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)>100 THEN RAISE EXCEPTION 'invalid accounting record population'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_records))<>(SELECT count(DISTINCT v->>'source_key') FROM jsonb_array_elements(p_records) v) THEN RAISE EXCEPTION 'duplicate accounting source key'; END IF;
 SELECT coalesce(max(line_number),0) INTO n FROM financial_document_lines WHERE document_id=d.id;
 FOR x IN SELECT value FROM jsonb_array_elements(p_records) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('record_kind','source_key','source_sha256','source_row','local_id','year','date','account','currency','currency_basis','amount','section','category','description','decision','status','source_reference','bank_links','recognition_status','payment_status','vehicle_status','reimbursement_status','entity_status'))
   OR coalesce(x->>'record_kind','') NOT IN ('retained_ledger_decision','retained_bank_movement')
   OR coalesce(x->>'source_key','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'source_sha256','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'source_row','') !~ '^[0-9]{1,8}$'
   OR (x->>'source_row')::integer<1
   OR coalesce(length(x->>'local_id'),0) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'year','') !~ '^[0-9]{4}$'
   OR (x->>'date' IS NOT NULL AND x->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
   OR coalesce(x->>'currency','') !~ '^[A-Z]{3}$'
   OR coalesce(length(x->>'currency_basis'),0) NOT BETWEEN 1 AND 500
   OR (x->>'amount' IS NOT NULL AND (jsonb_typeof(x->'amount')<>'string' OR x->>'amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'))
   OR jsonb_typeof(x->'bank_links') IS DISTINCT FROM 'array'
   OR coalesce(x->>'recognition_status','') NOT IN ('retained_decision','not_applicable')
   OR x->>'payment_status' IS DISTINCT FROM 'unresolved'
   OR x->>'vehicle_status' IS DISTINCT FROM 'unresolved'
   OR x->>'reimbursement_status' IS DISTINCT FROM 'unresolved'
   OR x->>'entity_status' IS DISTINCT FROM 'retained_scope_unallocated'
   OR octet_length(x::text)>12000
  THEN RAISE EXCEPTION 'invalid retained accounting record'; END IF;
  IF x->>'record_kind'='retained_bank_movement' AND x->>'recognition_status'<>'not_applicable' THEN RAISE EXCEPTION 'movement cannot recognize expense'; END IF;
  n:=n+1;
  INSERT INTO financial_document_lines(owner_id,document_id,line_number,description,attributes,privacy_tier)
  VALUES(p_owner_id,d.id,n,x->>'description',jsonb_build_object('intake_mode','financial_evidence_v1','extraction_run_id',p_run_id,'accounting_record',x,'tax_treatment','not_assessed'),'private');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.project_financial_accounting_records(uuid,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_accounting_records(uuid,uuid,uuid,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_financial_evidence(
  p_owner_id uuid, p_original jsonb, p_revision jsonb, p_actor_context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  doc public.financial_documents%ROWTYPE;
  v_run uuid := gen_random_uuid();
  v_prior uuid;
  v_key text := p_revision->>'idempotency_key';
  v_digest text := encode(extensions.digest(p_original::text || p_revision::text,'sha256'),'hex');
  v_runs jsonb;
  v_old jsonb;
  v_cell jsonb;
  v_concern jsonb;
  v_id uuid;
  v_cells jsonb := '[]';
  v_reviews jsonb := '[]';
  v_receipt jsonb;
  v_part jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())
  ) THEN RAISE EXCEPTION 'authenticated account required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object'
    OR octet_length(p_actor_context::text)>500
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind','agent_id'))
    OR (p_actor_context->>'kind' IS NOT NULL AND p_actor_context->>'kind' NOT IN ('user','api_key'))
    OR (p_actor_context->>'agent_id' IS NOT NULL AND p_actor_context->>'agent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'invalid verified actor context'; END IF;
  IF p_original IS NULL OR p_revision IS NULL OR jsonb_typeof(p_original)<>'object' OR jsonb_typeof(p_revision)<>'object'
    OR octet_length(p_original::text || p_revision::text)>250000
    OR coalesce(p_original->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_original->>'storage_path','') NOT LIKE p_owner_id::text || '/%'
    OR position('..' in p_original->>'storage_path')>0
    OR length(p_original->>'storage_path')>600 OR length(p_original->>'source_filename')>255
    OR coalesce(p_original->>'byte_size','') !~ '^[0-9]+$'
    OR (p_original->>'byte_size')::bigint NOT BETWEEN 1 AND 10485760
    OR coalesce(length(v_key),0) NOT BETWEEN 1 AND 200
    OR coalesce(length(p_revision->>'method'),0) NOT BETWEEN 1 AND 120
    OR coalesce(length(p_revision->>'version'),0) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_revision->'fields') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_revision->'fields') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(coalesce(p_revision->'concerns','[]')) IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(p_revision->'concerns','[]')) > 30
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_original) k WHERE k NOT IN ('sha256','storage_path','source_filename','source_kind','byte_size'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_revision) k WHERE k NOT IN ('idempotency_key','method','version','fields','concerns','supersedes_run_id','lines','accounting_records'))
  THEN RAISE EXCEPTION 'invalid financial evidence envelope'; END IF;
  FOR v_part IN SELECT jsonb_path_query(p_revision, '$.**') LOOP
    IF (jsonb_typeof(v_part)='string' AND (length(v_part #>> '{}')>2000
          OR (v_part #>> '{}') ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}'))
      OR (jsonb_typeof(v_part)='object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(v_part) k
        WHERE lower(k) IN ('ocr_text','raw_text','full_ocr','full_text','iban','bank_iban','full_iban')))
    THEN RAISE EXCEPTION 'full OCR and financial identifiers must remain local'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || (p_original->>'sha256'),0));
  SELECT * INTO doc FROM financial_documents WHERE owner_id=p_owner_id AND content_sha256=p_original->>'sha256'
    AND logical_index=1 ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF doc.id IS NOT NULL AND doc.attributes->>'intake_mode' IS DISTINCT FROM 'financial_evidence_v1' THEN
    RAISE EXCEPTION 'existing original requires explicit migration review';
  END IF;
  IF doc.id IS NULL THEN
    INSERT INTO financial_documents(owner_id,content_sha256,storage_path,source_filename,source_kind,byte_size,
      doc_type,extraction_status,review_status,privacy_tier,attributes)
    VALUES(p_owner_id,p_original->>'sha256',p_original->>'storage_path',p_original->>'source_filename',
      coalesce(p_original->>'source_kind','upload'),(p_original->>'byte_size')::bigint,
      'unclassified','extracted','needs_review','private',jsonb_build_object('intake_mode','financial_evidence_v1','expense_posted',false,'runs','[]'::jsonb))
    RETURNING * INTO doc;
  END IF;
  v_runs := doc.attributes->'runs';
  SELECT x INTO v_old FROM jsonb_array_elements(v_runs) x WHERE x->>'key'=v_key;
  IF v_old IS NOT NULL THEN
    IF v_old->>'digest'<>v_digest THEN RAISE EXCEPTION 'idempotency key payload conflict'; END IF;
    RETURN (v_old->'receipt') || jsonb_build_object('duplicate',true);
  END IF;
  IF jsonb_array_length(v_runs)>=100 THEN RAISE EXCEPTION 'revision limit requires review'; END IF;
  IF p_revision->>'supersedes_run_id' IS NOT NULL THEN
    v_prior := (p_revision->>'supersedes_run_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'run_id'=v_prior::text)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'supersedes_run_id'=v_prior::text)
    THEN RAISE EXCEPTION 'correction must name a current revision of this original'; END IF;
  ELSIF jsonb_array_length(v_runs)>0 THEN
    RAISE EXCEPTION 'existing original requires explicit revision supersession';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_revision->'fields')) <>
     (SELECT count(DISTINCT x->>'field_key') FROM jsonb_array_elements(p_revision->'fields') x)
  THEN RAISE EXCEPTION 'duplicate field keys'; END IF;
  IF v_prior IS NOT NULL AND (
    EXISTS (SELECT field_key FROM financial_document_extractions WHERE extraction_run_id=v_prior AND document_id=doc.id
      EXCEPT SELECT x->>'field_key' FROM jsonb_array_elements(p_revision->'fields') x)
  ) THEN RAISE EXCEPTION 'correction requires the complete prior field set'; END IF;
  FOR v_cell IN SELECT x FROM jsonb_array_elements(p_revision->'fields') x LOOP
    IF jsonb_typeof(v_cell)<>'object' OR coalesce(length(v_cell->>'field_key'),0) NOT BETWEEN 1 AND 160
      OR coalesce(length(v_cell->>'value_raw'),0) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(v_cell->'evidence') IS DISTINCT FROM 'object' OR v_cell->'evidence'='{}'::jsonb
      OR octet_length(coalesce(v_cell->'value_normalized','null')::text)>4000
      OR octet_length(coalesce(v_cell->'evidence','null')::text)>4000
      OR lower(v_cell->>'field_key') IN ('ocr_text','raw_text','full_ocr','full_text','redacted_source')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_cell) k WHERE k NOT IN ('field_key','value_raw','value_normalized','value_type','page_number','evidence'))
    THEN RAISE EXCEPTION 'only bounded attributed cells allowed'; END IF;
    INSERT INTO financial_document_extractions(owner_id,document_id,field_key,value_raw,value_normalized,value_type,
      page_number,extractor,extractor_model,extraction_run_id,privacy_tier)
    VALUES(p_owner_id,doc.id,v_cell->>'field_key',v_cell->>'value_raw',
      jsonb_build_object('value',v_cell->'value_normalized','evidence',v_cell->'evidence','method',p_revision->>'method',
        'version',p_revision->>'version','actor_user_id',p_owner_id,'auth_context',p_actor_context,'original_sha256',p_original->>'sha256'),
      coalesce(v_cell->>'value_type','text'),(v_cell->>'page_number')::integer,
      p_revision->>'method',p_revision->>'version',v_run,'private') RETURNING id INTO v_id;
    v_cells := v_cells || to_jsonb(v_id);
  END LOOP;
  FOR v_concern IN SELECT x FROM jsonb_array_elements(coalesce(p_revision->'concerns','[]')) x LOOP
    IF coalesce(length(v_concern->>'resolver'),0) NOT BETWEEN 1 AND 120
      OR coalesce(length(v_concern->>'detail'),0)>2000
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_concern) k WHERE k NOT IN ('concern_type','priority','detail','resolver'))
    THEN RAISE EXCEPTION 'invalid review concern'; END IF;
    INSERT INTO financial_review_queue(owner_id,document_id,concern_type,priority,detail,resolver,confidence_factors)
    VALUES(p_owner_id,doc.id,v_concern->>'concern_type',coalesce(v_concern->>'priority','medium'),
      v_concern->>'detail',v_concern->>'resolver',jsonb_build_object('extraction_run_id',v_run,'method',p_revision->>'method',
        'version',p_revision->>'version','original_sha256',p_original->>'sha256','actor_user_id',p_owner_id,'auth_context',p_actor_context))
    RETURNING id INTO v_id;
    v_reviews := v_reviews || to_jsonb(v_id);
  END LOOP;
  PERFORM public.project_financial_document_lines(p_owner_id,doc.id,v_run,p_revision->'lines',v_prior);
  PERFORM public.project_financial_accounting_records(p_owner_id,doc.id,v_run,p_revision->'accounting_records',v_prior);
  -- Only the existing supersession stamps change; original cells remain intact.
  IF v_prior IS NOT NULL THEN
    UPDATE financial_document_extractions old SET is_superseded=true,superseded_at=now(),superseded_by=new.id
      FROM financial_document_extractions new
      WHERE old.owner_id=p_owner_id AND old.document_id=doc.id AND old.extraction_run_id=v_prior AND NOT old.is_superseded
        AND new.document_id=doc.id AND new.extraction_run_id=v_run AND new.field_key=old.field_key;
  END IF;
  v_receipt := jsonb_build_object('document_id',doc.id,'extraction_run_id',v_run,'extraction_ids',v_cells,
    'review_ids',v_reviews,'duplicate',false,'expense_posted',false);
  UPDATE financial_documents SET attributes=attributes || jsonb_build_object('runs',v_runs || jsonb_build_array(
    jsonb_build_object('run_id',v_run,'key',v_key,'digest',v_digest,'supersedes_run_id',v_prior,'receipt',v_receipt,'actor_user_id',p_owner_id,'auth_context',p_actor_context))),
    review_status='needs_review' WHERE id=doc.id AND owner_id=p_owner_id;
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) IS 'ingest-observation financial_evidence_v1 service admission after account authentication and original SHA verification; evidence only, never posts expenses';


-- Current reader excludes all older line projections without deleting them.
CREATE OR REPLACE FUNCTION public.read_financial_accounting(p_owner_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE evidence jsonb; lines jsonb;
BEGIN
 evidence:=public.read_financial_evidence(p_owner_id,p_document_id,NULL);
 IF evidence IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.line_number),'[]'::jsonb) INTO lines
 FROM financial_document_lines l WHERE l.owner_id=p_owner_id AND l.document_id=p_document_id
 AND l.attributes->>'intake_mode'='financial_evidence_v1'
 AND EXISTS(SELECT 1 FROM financial_document_extractions e WHERE e.owner_id=p_owner_id AND e.document_id=p_document_id
  AND e.extraction_run_id::text=l.attributes->>'extraction_run_id' AND NOT e.is_superseded);
 RETURN evidence || jsonb_build_object('lines',lines,'accounting_status','retained_evidence_not_posted',
 'tax_ready',false,'purchase_deduplication','not_assessed','payment_reconciliation','not_assessed');
END $$;
REVOKE ALL ON FUNCTION public.read_financial_accounting(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_financial_accounting(uuid,uuid) TO service_role;

-- Account-bound pagination preserves every retained record and refuses tax readiness.
-- No bank movement enters recognized costs. Control totals partition source currency.
CREATE OR REPLACE FUNCTION public.read_financial_tax_workpapers(p_owner_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid page size'; END IF;
 WITH current_records AS (
  SELECT l.id,l.document_id,l.attributes->>'extraction_run_id' AS extraction_run_id,d.content_sha256 AS admitted_source_sha256,l.attributes->'accounting_record' AS record
  FROM financial_document_lines l JOIN financial_documents d ON d.id=l.document_id AND d.owner_id=p_owner_id
  WHERE l.owner_id=p_owner_id AND l.attributes ? 'accounting_record'
   AND l.attributes->>'intake_mode'='financial_evidence_v1' AND d.attributes->>'intake_mode'='financial_evidence_v1'
   AND EXISTS(SELECT 1 FROM financial_document_extractions e WHERE e.owner_id=p_owner_id AND e.document_id=l.document_id AND e.extraction_run_id::text=l.attributes->>'extraction_run_id' AND NOT e.is_superseded)
 ), page AS (SELECT * FROM current_records WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit),
 grouped AS (
  SELECT record->>'record_kind' AS record_kind,record->>'year' AS year,record->>'account' AS account,record->>'currency' AS currency,record->>'section' AS section,
   count(*) AS rows,count(*) FILTER(WHERE record->>'amount' IS NULL) AS missing_amounts,sum((record->>'amount')::numeric) AS retained_amount
  FROM current_records GROUP BY 1,2,3,4,5
 )
 SELECT jsonb_build_object('records',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY id) FROM page),'[]'::jsonb),
  'next_after',(SELECT id FROM page ORDER BY id DESC LIMIT 1),'total_rows',(SELECT count(*) FROM current_records),
  'duplicate_source_keys',(SELECT count(*) FROM (SELECT record->>'source_key' FROM current_records GROUP BY 1 HAVING count(*)>1) duplicates),
  'duplicate_record_ids',(SELECT count(*) FROM (SELECT record->>'record_kind',record->>'local_id' FROM current_records GROUP BY 1,2 HAVING count(*)>1) duplicates),
  'controls_valid',NOT EXISTS(SELECT 1 FROM current_records GROUP BY record->>'record_kind',record->>'local_id' HAVING count(*)>1) AND NOT EXISTS(SELECT 1 FROM current_records GROUP BY record->>'source_key' HAVING count(*)>1),
  'controls',coalesce((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped),'[]'::jsonb),
  'tax_ready',false,'tax_treatment','not_assessed','income_completeness','not_established','accounting_status','retained_decisions_not_posted') INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_financial_tax_workpapers(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_financial_tax_workpapers(uuid,uuid,integer) TO service_role;

-- A display review is its own append-only interpretation; it never replaces the
-- accounting extraction snapshot or changes recognition/payment decisions.
CREATE OR REPLACE FUNCTION public.record_financial_source_review(p_owner_id uuid,p_document_id uuid,p_source jsonb,p_actor_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d financial_documents%ROWTYPE; v_id uuid; v_run uuid:=gen_random_uuid(); old financial_document_extractions%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'authenticated admission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM financial_documents WHERE id=p_document_id AND owner_id=p_owner_id FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'owned document required'; END IF;
 IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR octet_length(p_source::text)>4000
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_source) k WHERE k NOT IN ('contract','source_sha256','derivative_sha256','bucket','storage_path','mime_type','width','height','policy_version','verification','geometry_status'))
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind','agent_id'))
  OR p_source->>'contract' IS DISTINCT FROM 'financial_redacted_source_v1'
  OR p_source->>'source_sha256' IS DISTINCT FROM d.content_sha256
  OR coalesce(p_source->>'derivative_sha256','') !~ '^[a-f0-9]{64}$'
  OR p_source->>'bucket' IS DISTINCT FROM 'user-documents'
  OR p_source->>'mime_type' IS DISTINCT FROM 'image/png'
  OR p_source->>'storage_path' IS DISTINCT FROM p_owner_id::text||'/redacted/'||d.content_sha256||'/'||(p_source->>'derivative_sha256')||'.png'
  OR p_source->'verification'->>'pixel_masks' IS DISTINCT FROM 'true'
  OR p_source->'verification'->>'metadata_removed' IS DISTINCT FROM 'true'
  OR p_source->'verification'->>'embedded_text_removed' IS DISTINCT FROM 'true'
  OR p_source->'verification'->>'visual_reviewed' IS DISTINCT FROM 'true'
  OR p_source->'verification'->>'reviewer' IS DISTINCT FROM p_owner_id::text
  OR jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object' OR octet_length(p_actor_context::text)>500
 THEN RAISE EXCEPTION 'invalid verified private derivative'; END IF;
 SELECT * INTO old FROM financial_document_extractions WHERE owner_id=p_owner_id AND document_id=d.id AND field_key='redacted_source' AND NOT is_superseded ORDER BY created_at DESC,id LIMIT 1;
 IF old.value_normalized->'value'=p_source THEN RETURN jsonb_build_object('extraction_id',old.id,'duplicate',true); END IF;
 INSERT INTO financial_document_extractions(owner_id,document_id,field_key,value_raw,value_normalized,value_type,extractor,extractor_model,extraction_run_id,privacy_tier)
 VALUES(p_owner_id,d.id,'redacted_source','Reviewed private source derivative',jsonb_build_object('value',p_source,'evidence',jsonb_build_object('source_sha256',d.content_sha256,'review_kind','attributed_display_review'),'actor_user_id',p_owner_id,'auth_context',p_actor_context),'event','authenticated_display_review','1',v_run,'private') RETURNING id INTO v_id;
 UPDATE financial_document_extractions SET is_superseded=true,superseded_at=now(),superseded_by=v_id WHERE owner_id=p_owner_id AND document_id=d.id AND field_key='redacted_source' AND id<>v_id AND NOT is_superseded;
 RETURN jsonb_build_object('extraction_id',v_id,'extraction_run_id',v_run,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.record_financial_source_review(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_source_review(uuid,uuid,jsonb,jsonb) TO service_role;

-- Legacy books count has no QB owner/realm column. Refuse that global aggregate
-- until a source-backed owner bridge exists; keep unrelated reconciliation sections.
DO $$ DECLARE f text; old text := 'FROM qb_transactions t WHERE EXISTS (SELECT 1 FROM qb)'; BEGIN
 IF to_regprocedure('public.get_user_reconciliation(uuid,text)') IS NOT NULL THEN
  f:=pg_get_functiondef('public.get_user_reconciliation(uuid,text)'::regprocedure);
  IF position(old in f)=0 THEN RAISE EXCEPTION 'legacy reconciliation body changed; re-review required'; END IF;
  EXECUTE replace(f,old,'FROM qb_transactions t WHERE false /* no owner bridge: global aggregate withheld */');
 END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
