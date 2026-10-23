BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Current accounting records of a book, one row per retained record, with the record's own fields as columns so
-- PostgREST can filter, search, sort and page them for the Accounting screen. "Current" means the line belongs to the
-- extraction run that is not superseded, exactly as read_financial_tax_workpapers selects its records. The view runs as
-- the caller (security_invoker), so the owner and delegate-read policies of financial_document_lines,
-- financial_documents and financial_document_extractions decide what each reader sees. It writes nothing: the record
-- jsonb is the retained testimony and is returned unchanged in `record`.
CREATE OR REPLACE VIEW public.v_financial_accounting_records WITH (security_invoker = true) AS
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
WHERE l.attributes ? 'accounting_record'
  AND l.attributes->>'intake_mode' = 'financial_evidence_v1'
  AND EXISTS (SELECT 1 FROM public.financial_document_extractions e
               WHERE e.owner_id = l.owner_id AND e.document_id = l.document_id
                 AND e.extraction_run_id::text = l.attributes->>'extraction_run_id' AND NOT e.is_superseded);

COMMENT ON VIEW public.v_financial_accounting_records IS
  'Current accounting records per book (one row per retained record of the non-superseded run), columns for filtering; runs as the caller under the financial_* row policies.';

REVOKE ALL ON public.v_financial_accounting_records FROM PUBLIC, anon;
GRANT SELECT ON public.v_financial_accounting_records TO authenticated, service_role;

COMMIT;
