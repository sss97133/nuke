BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$ BEGIN
  IF md5(pg_get_viewdef('public.v_financial_accounting_records'::regclass,true))
     NOT IN ('e7d690f1e46e7f9a1f7919d1c8c13000', '4eea6f155b288006171abcc83c9abb2a') THEN -- gitleaks:allow (SQL view definition checksums, not credentials)
    RAISE EXCEPTION 'Accounting records view differs from the reviewed preimage';
  END IF;
END $guard$;

-- Preserve the existing read-only invoker view, columns, grants and testimony.
-- A retained batch may have thousands of records and extraction fields. The
-- former correlated EXISTS repeatedly read those fields for each matching line.
CREATE OR REPLACE VIEW public.v_financial_accounting_records WITH (security_invoker = true) AS
WITH current_runs AS MATERIALIZED (
  -- Extraction has one row per field, not per run. Deduplicate the visible
  -- current runs once so a batch's lines do not rescan all of its fields.
  -- Keep text equality: malformed/noncanonical retained run strings must not
  -- begin matching merely because a UUID cast would normalize them.
  SELECT DISTINCT e.owner_id, e.document_id, e.extraction_run_id::text AS run_id
  FROM public.financial_document_extractions e
  WHERE NOT e.is_superseded
)
SELECT l.id,
       l.owner_id,
       l.document_id,
       (l.attributes->>'extraction_run_id')::uuid AS extraction_run_id,
       l.attributes->'accounting_record' AS record,
       l.attributes->'accounting_record'->>'record_kind' AS record_kind,
       l.attributes->'accounting_record'->>'local_id' AS local_id,
       l.attributes->'accounting_record'->>'year' AS year,
       l.attributes->'accounting_record'->>'date' AS record_date,
       l.attributes->'accounting_record'->>'account' AS account,
       l.attributes->'accounting_record'->>'section' AS section,
       l.attributes->'accounting_record'->>'category' AS category,
       l.attributes->'accounting_record'->>'amount' AS amount,
       CASE WHEN l.attributes->'accounting_record'->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$'
            THEN (l.attributes->'accounting_record'->>'amount')::numeric END AS amount_value,
       l.attributes->'accounting_record'->>'currency' AS currency,
       l.attributes->'accounting_record'->>'description' AS description,
       l.attributes->'accounting_record'->>'decision' AS decision,
       l.attributes->'accounting_record'->>'status' AS status,
       l.attributes->'accounting_record'->>'source_key' AS source_key
FROM public.financial_document_lines l
JOIN public.financial_documents d
  ON d.id = l.document_id AND d.owner_id = l.owner_id AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
JOIN current_runs r
  ON r.owner_id = l.owner_id AND r.document_id = l.document_id
 AND r.run_id = l.attributes->>'extraction_run_id'
WHERE l.attributes ? 'accounting_record'
  AND l.attributes->>'intake_mode' = 'financial_evidence_v1';

COMMIT;
