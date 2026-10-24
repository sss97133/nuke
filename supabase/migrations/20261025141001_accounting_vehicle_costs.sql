BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Costs the accounting book assigns to a vehicle, for that vehicle's Build ledger (the car file).
-- A booked expense (record_kind retained_ledger_decision, section Expense) names its vehicle in its expense-use cell
-- expense_use_<first 24 characters of the record's source_key> (use_type 'vehicle', vehicle_id). This reader returns the
-- current cells for one vehicle, each with its expense record.
--
-- Two gates, both required. The caller can read the book: its owner, or an active accounting grant
-- (accounting_readable_owners()). And the caller has the vehicle access get_vehicle_build_ledger requires. A book grant
-- adds no vehicle permission and vehicle access adds no book permission (docs/accounting-shared-access.md); owner rule:
-- "the build record is public, its costs are owner-only".
--
-- A cell is left out when it is stale: its record is no longer the current Expense, or the record's amount or currency
-- changed after the assignment. A cell whose allocated amount is not set yet (an order still to be split between this
-- vehicle and other items) is returned with allocated_amount NULL, so the car file can list it without summing it.
-- assigned_by is the actor of the earliest revision that holds the same value and evidence,
-- because a correction re-writes every carried cell under its own actor. Rows are keyed by the cell id, never a
-- vehicle_observations id, so the work-record confirmation path cannot act on them. Read-only.
CREATE OR REPLACE FUNCTION public.accounting_vehicle_costs(p_vehicle_id uuid)
RETURNS TABLE(use_id uuid, book_owner_id uuid, document_id uuid, ledger_id text, record_year text, record_date date,
  description text, account text, category text, allocated_amount numeric, book_amount numeric, currency text,
  basis text, assigned_by uuid, assigned_method text, assigned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH caller AS (
    SELECT auth.uid() AS id WHERE auth.role() = 'authenticated' AND auth.uid() IS NOT NULL
  ), vehicle AS (
    SELECT v.id FROM vehicles v CROSS JOIN caller c
    WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND (v.owner_id = c.id OR v.user_id = c.id OR v.uploaded_by = c.id
        OR EXISTS (SELECT 1 FROM vehicle_ownerships o WHERE o.vehicle_id = v.id AND o.owner_profile_id = c.id AND o.is_current = true)
        OR EXISTS (SELECT 1 FROM ownership_verifications ov WHERE ov.vehicle_id = v.id AND ov.user_id = c.id AND ov.status = 'approved')
        OR EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = v.id AND vc.user_id = c.id))
  ), books AS (
    SELECT c.id AS owner_id FROM caller c
    UNION SELECT g FROM public.accounting_readable_owners() g
  ), uses AS MATERIALIZED (
    SELECT e.id, e.owner_id, e.document_id, e.extraction_run_id, e.field_key,
           e.value_normalized->'value' AS val, e.value_normalized->'evidence' AS ev
    FROM books b JOIN financial_document_extractions e ON e.owner_id = b.owner_id
    WHERE EXISTS (SELECT 1 FROM vehicle) AND NOT e.is_superseded AND e.field_key LIKE 'expense\_use\_%'
      AND e.value_normalized->'value'->>'use_type' = 'vehicle'
      AND e.value_normalized->'value'->>'vehicle_id' = p_vehicle_id::text
  ), joined AS (
    SELECT u.*, d.attributes->'runs' AS runs, r.rec,
      CASE WHEN u.val->>'allocated_amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN (u.val->>'allocated_amount')::numeric END AS allocated,
      CASE WHEN u.val->>'book_amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN (u.val->>'book_amount')::numeric END AS use_book,
      CASE WHEN r.rec->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN (r.rec->>'amount')::numeric END AS record_amount
    FROM uses u
    JOIN financial_documents d ON d.id = u.document_id AND d.owner_id = u.owner_id
     AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
    JOIN LATERAL (
      SELECT l.attributes->'accounting_record' AS rec FROM financial_document_lines l
      WHERE l.document_id = u.document_id AND l.owner_id = u.owner_id
        AND l.attributes->>'intake_mode' = 'financial_evidence_v1'
        AND l.attributes->>'extraction_run_id' = u.extraction_run_id::text
        AND l.attributes->'accounting_record'->>'source_key' = u.val->>'source_key'
      LIMIT 1) r ON true
    WHERE u.field_key = 'expense_use_' || left(r.rec->>'source_key', 24)
      AND r.rec->>'record_kind' = 'retained_ledger_decision' AND r.rec->>'section' = 'Expense'
  )
  SELECT j.id, j.owner_id, j.document_id, j.rec->>'local_id', j.rec->>'year',
    CASE WHEN j.rec->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (j.rec->>'date')::date END,
    j.rec->>'description', j.rec->>'account', j.rec->>'category',
    j.allocated, j.record_amount, j.rec->>'currency', j.val->>'basis',
    a.actor, a.method, a.created_at
  FROM joined j
  LEFT JOIN LATERAL (
    SELECT CASE WHEN x.value_normalized->>'actor_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (x.value_normalized->>'actor_user_id')::uuid END AS actor,
           x.value_normalized->>'method' AS method, x.created_at
    FROM financial_document_extractions x
    JOIN jsonb_array_elements(coalesce(j.runs, '[]'::jsonb)) WITH ORDINALITY run(item, n)
      ON run.item->>'run_id' = x.extraction_run_id::text
    WHERE x.document_id = j.document_id AND x.owner_id = j.owner_id AND x.field_key = j.field_key
      AND x.value_normalized->'value' = j.val AND x.value_normalized->'evidence' = j.ev
    ORDER BY run.n LIMIT 1) a ON true
  WHERE j.record_amount IS NOT NULL AND j.use_book = j.record_amount
    AND j.val->>'currency' IS NOT DISTINCT FROM j.rec->>'currency'
  ORDER BY 6 NULLS LAST, 1
$$;

REVOKE ALL ON FUNCTION public.accounting_vehicle_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_vehicle_costs(uuid) TO authenticated;
COMMENT ON FUNCTION public.accounting_vehicle_costs(uuid) IS
  'Current vehicle expense uses from books the caller can read, for a vehicle the caller can access; read-only.';

COMMIT;
