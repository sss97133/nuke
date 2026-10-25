BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- The existing service-only workpaper contract retains its owner checks, exact
-- payload and controls. Deduplicate current extraction runs once per requested
-- owner rather than re-reading every field of a batch for each retained line.
-- Text equality deliberately excludes malformed/noncanonical run identifiers.
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.read_financial_tax_workpapers(uuid,uuid,integer)'::regprocedure))
    NOT IN ('a1b8cff2d1722b93fed5bceaba9c682c', 'a515798b1349f928ec224cb757228e40') THEN -- gitleaks:allow (function definition checksums, not credentials)
  RAISE EXCEPTION 'Workpaper reader differs from reviewed preimage';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.read_financial_tax_workpapers(p_owner_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid page size'; END IF;
 WITH current_runs AS MATERIALIZED (
  SELECT DISTINCT e.document_id, e.extraction_run_id::text AS run_id
  FROM public.financial_document_extractions e
  WHERE e.owner_id=p_owner_id AND NOT e.is_superseded
 ), current_records AS (
  SELECT l.id,l.document_id,l.attributes->>'extraction_run_id' AS extraction_run_id,d.content_sha256 AS admitted_source_sha256,l.attributes->'accounting_record' AS record
  FROM financial_document_lines l JOIN financial_documents d ON d.id=l.document_id AND d.owner_id=p_owner_id
  JOIN current_runs r ON r.document_id=l.document_id AND r.run_id=l.attributes->>'extraction_run_id'
  WHERE l.owner_id=p_owner_id AND l.attributes ? 'accounting_record'
   AND l.attributes->>'intake_mode'='financial_evidence_v1' AND d.attributes->>'intake_mode'='financial_evidence_v1'
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

COMMIT;
