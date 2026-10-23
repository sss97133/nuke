BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Delegated "original" downloads always failed. financialDelegation.ts (the `original` action behind the evidence
-- dialog's "Download private original" and the MCP accounting_books tool) requires the reader's document to carry
-- owner_id and storage_path, and its unit test mocks the reader that way, but the reader built the document object
-- without them, so every request was refused as "Active accounting access required" (verified 2026-10-23 on a CSV
-- batch and on the Apple Card statements). The reader now includes both. Reviewers can already read storage_path through
-- the delegate SELECT policy on financial_documents, so nothing new is exposed; the bytes stay behind the edge function's
-- grant re-check and hash verification. Everything else is the live definition unchanged.
CREATE OR REPLACE FUNCTION public.read_financial_evidence(p_owner_id uuid, p_document_id uuid DEFAULT NULL::uuid, p_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d financial_documents%ROWTYPE; result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 IF (p_document_id IS NULL)=(p_sha256 IS NULL) THEN RAISE EXCEPTION 'exactly one source selector required'; END IF;
 SELECT * INTO d FROM financial_documents WHERE owner_id=p_owner_id AND attributes->>'intake_mode'='financial_evidence_v1'
 AND ((p_document_id IS NOT NULL AND id=p_document_id) OR (p_sha256 IS NOT NULL AND content_sha256=p_sha256)) ORDER BY created_at,id LIMIT 1;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('document',jsonb_build_object('id',d.id,'owner_id',d.owner_id,'content_sha256',d.content_sha256,
   'storage_path',d.storage_path,'source_filename',d.source_filename,'review_status',d.review_status,'attributes',d.attributes),
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
END $function$;

REVOKE ALL ON FUNCTION public.read_financial_evidence(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_financial_evidence(uuid,uuid,text) TO service_role;

COMMIT;
