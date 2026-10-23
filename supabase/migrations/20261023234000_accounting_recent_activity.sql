BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Who changed a book, when, how and how much: the latest attributed revisions of its source documents, newest first,
-- so reviewers working in the same book at the same time see each other's work. Every admitted revision is retained on
-- financial_documents.attributes.runs with its actor; its time and method are those of the extraction cells it wrote;
-- records_changed counts the accounting records whose retained content differs from every record of the revision it
-- superseded (all of them for a first reading). SECURITY INVOKER: the caller's owner or delegate row policies decide
-- what is visible, so a reader without access gets no rows. It writes nothing.
CREATE OR REPLACE FUNCTION public.accounting_recent_activity(p_owner_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(document_id uuid, source_filename text, run_id uuid, actor_user_id uuid, method text, recorded_at timestamptz, records_changed integer, first_reading boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH runs AS (
    SELECT d.id AS document_id, d.source_filename,
           (r.value->>'run_id')::uuid AS run_id,
           (r.value->>'supersedes_run_id')::uuid AS prior_run_id,
           (r.value->>'actor_user_id')::uuid AS actor_user_id
    FROM financial_documents d
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.attributes->'runs', '[]'::jsonb)) r
    WHERE d.owner_id = p_owner_id AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
  ), recent AS (
    SELECT runs.*, cells.recorded_at, cells.method
    FROM runs
    CROSS JOIN LATERAL (
      SELECT min(x.created_at) AS recorded_at, min(x.extractor) AS method
      FROM financial_document_extractions x
      WHERE x.owner_id = p_owner_id AND x.document_id = runs.document_id AND x.extraction_run_id = runs.run_id
    ) cells
    WHERE cells.recorded_at IS NOT NULL
    ORDER BY cells.recorded_at DESC, runs.run_id
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  SELECT r.document_id, r.source_filename, r.run_id, r.actor_user_id, r.method, r.recorded_at,
    (SELECT count(*)::integer FROM financial_document_lines n
      WHERE n.owner_id = p_owner_id AND n.document_id = r.document_id
        AND n.attributes->>'extraction_run_id' = r.run_id::text AND n.attributes ? 'accounting_record'
        AND NOT EXISTS (SELECT 1 FROM financial_document_lines o
                         WHERE r.prior_run_id IS NOT NULL AND o.owner_id = p_owner_id AND o.document_id = r.document_id
                           AND o.attributes->>'extraction_run_id' = r.prior_run_id::text
                           AND o.attributes->'accounting_record' = n.attributes->'accounting_record')) AS records_changed,
    r.prior_run_id IS NULL AS first_reading
  FROM recent r
  ORDER BY r.recorded_at DESC, r.run_id;
$$;

COMMENT ON FUNCTION public.accounting_recent_activity(uuid, integer) IS
  'Latest attributed revisions of a book (actor, time, method, accounting records changed against the superseded revision); security invoker under the financial_* row policies.';

REVOKE ALL ON FUNCTION public.accounting_recent_activity(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_recent_activity(uuid, integer) TO authenticated, service_role;

COMMIT;
