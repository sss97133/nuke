BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- The recent-activity API times out as an ordinary caller because the per-run cell
-- aggregate and per-line comparison repeatedly visit RLS-protected tables. Read
-- extraction cells in one owner-scoped pass, then compare only the selected
-- revisions in memory, grouped by document and run.
-- Keep the existing invoker permissions, payload, time basis and limit semantics.
CREATE OR REPLACE FUNCTION public.accounting_recent_activity(p_owner_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(document_id uuid, source_filename text, run_id uuid, actor_user_id uuid, method text, recorded_at timestamptz, records_changed integer, first_reading boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH documents AS MATERIALIZED (
    SELECT d.id, d.source_filename, d.attributes->'runs' AS runs
    FROM financial_documents d
    WHERE d.owner_id = p_owner_id AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
  ), runs AS MATERIALIZED (
    SELECT d.id AS document_id, d.source_filename,
           (r.value->>'run_id')::uuid AS run_id,
           (r.value->>'supersedes_run_id')::uuid AS prior_run_id,
           (r.value->>'actor_user_id')::uuid AS actor_user_id
    FROM documents d
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.runs, '[]'::jsonb)) r
  ), cells AS MATERIALIZED (
    SELECT x.document_id, x.extraction_run_id,
           min(x.created_at) AS recorded_at, min(x.extractor) AS method
    FROM financial_document_extractions x
    WHERE x.owner_id = p_owner_id
    GROUP BY x.document_id, x.extraction_run_id
  ), recent AS MATERIALIZED (
    SELECT r.*, c.recorded_at, c.method
    FROM runs r
    JOIN cells c ON c.document_id = r.document_id AND c.extraction_run_id = r.run_id
    WHERE c.recorded_at IS NOT NULL
    ORDER BY c.recorded_at DESC, r.run_id
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)
  ), line_versions AS MATERIALIZED (
    SELECT n.document_id, n.attributes->>'extraction_run_id' AS run_id,
           array_agg(n.attributes->'accounting_record') AS records
    FROM financial_document_lines n
    WHERE n.owner_id = p_owner_id AND n.attributes ? 'accounting_record'
      AND (n.document_id, n.attributes->>'extraction_run_id') IN (
        SELECT r.document_id, r.run_id::text FROM recent r
        UNION
        SELECT r.document_id, r.prior_run_id::text FROM recent r WHERE r.prior_run_id IS NOT NULL
      )
    GROUP BY n.document_id, n.attributes->>'extraction_run_id'
  )
  SELECT r.document_id, r.source_filename, r.run_id, r.actor_user_id, r.method, r.recorded_at,
         (SELECT count(*)::integer FROM unnest(n.records) record
          WHERE NOT coalesce(record = ANY(o.records), false)) AS records_changed,
         r.prior_run_id IS NULL AS first_reading
  FROM recent r
  LEFT JOIN line_versions n ON n.document_id = r.document_id AND n.run_id = r.run_id::text
  LEFT JOIN line_versions o ON o.document_id = r.document_id AND o.run_id = r.prior_run_id::text
  ORDER BY r.recorded_at DESC, r.run_id;
$$;

COMMIT;
