BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Owner table grants must not bypass verified original custody or revision history.
CREATE OR REPLACE FUNCTION public.guard_financial_evidence_document()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE old_reserved boolean := false; new_reserved boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_reserved := OLD.attributes ?| ARRAY['intake_mode','runs'];
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_reserved := NEW.attributes ?| ARRAY['intake_mode','runs'];
  END IF;
  IF NOT (old_reserved OR new_reserved) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'verified financial document custody requires service admission' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'financial evidence originals cannot be deleted' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.owner_id,NEW.content_sha256,NEW.logical_index,NEW.storage_path,
           NEW.source_filename,NEW.source_kind,NEW.byte_size,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.owner_id,OLD.content_sha256,OLD.logical_index,OLD.storage_path,
           OLD.source_filename,OLD.source_kind,OLD.byte_size,OLD.created_at)
       OR NEW.attributes->'intake_mode' IS DISTINCT FROM OLD.attributes->'intake_mode'
       OR NEW.privacy_tier IS DISTINCT FROM OLD.privacy_tier THEN
      RAISE EXCEPTION 'financial evidence original custody is immutable' USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(NEW.attributes->'runs') IS DISTINCT FROM 'array'
       OR jsonb_typeof(OLD.attributes->'runs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'financial evidence revision history must be retained' USING ERRCODE='42501';
    END IF;
    IF jsonb_array_length(NEW.attributes->'runs') < jsonb_array_length(OLD.attributes->'runs')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.attributes->'runs') WITH ORDINALITY r(value,n)
          WHERE NEW.attributes->'runs'->(r.n::integer-1) IS DISTINCT FROM r.value) THEN
      RAISE EXCEPTION 'financial evidence revision history is append-only' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_evidence_document() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER financial_evidence_document_custody
BEFORE INSERT OR UPDATE OR DELETE ON public.financial_documents
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_evidence_document();

-- Existing financial document/cell/review model; no bookkeeping entries are created.
-- Only ingest-observation calls this after authenticating the account and hashing held bytes.
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
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_revision) k WHERE k NOT IN ('idempotency_key','method','version','fields','concerns','supersedes_run_id'))
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
      OR lower(v_cell->>'field_key') IN ('ocr_text','raw_text','full_ocr','full_text')
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

CREATE OR REPLACE FUNCTION public.read_financial_evidence(p_owner_id uuid,p_document_id uuid DEFAULT NULL,p_sha256 text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d financial_documents%ROWTYPE; result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 IF (p_document_id IS NULL)=(p_sha256 IS NULL) THEN RAISE EXCEPTION 'exactly one source selector required'; END IF;
 SELECT * INTO d FROM financial_documents WHERE owner_id=p_owner_id AND attributes->>'intake_mode'='financial_evidence_v1'
 AND ((p_document_id IS NOT NULL AND id=p_document_id) OR (p_sha256 IS NOT NULL AND content_sha256=p_sha256)) ORDER BY created_at,id LIMIT 1;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('document',jsonb_build_object('id',d.id,'content_sha256',d.content_sha256,
   'source_filename',d.source_filename,'review_status',d.review_status,'attributes',d.attributes),
  'fields',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM (SELECT id,field_key,value_raw,value_normalized,value_type,
    extraction_run_id,is_superseded FROM financial_document_extractions WHERE document_id=d.id AND owner_id=p_owner_id
    AND NOT is_superseded ORDER BY field_key LIMIT 100) f),'[]'::jsonb),
  'concerns',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT id,concern_type,status,priority,detail,resolver,
    resolution,resolution_notes,confidence_factors,
    EXISTS(SELECT 1 FROM financial_document_extractions e WHERE e.document_id=d.id AND e.owner_id=p_owner_id
      AND e.extraction_run_id::text=r.confidence_factors->>'extraction_run_id' AND NOT e.is_superseded) AS is_current_revision
    FROM financial_review_queue r WHERE r.document_id=d.id AND r.owner_id=p_owner_id ORDER BY created_at DESC,id LIMIT 100) q),'[]'::jsonb),
  'concerns_limit',100,'concerns_total',(SELECT count(*) FROM financial_review_queue WHERE document_id=d.id AND owner_id=p_owner_id),
  'concerns_truncated',(SELECT count(*)>100 FROM financial_review_queue WHERE document_id=d.id AND owner_id=p_owner_id),'expense_posted',false) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_financial_evidence(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_financial_evidence(uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
