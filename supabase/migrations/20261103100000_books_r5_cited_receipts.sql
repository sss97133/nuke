-- R5 counts a cited receipt (owner, 2026-10-27): a decision whose proof_links carry a gmail, file, photo or artifact
-- reference to the receipt or order is has_receipt, the same as an extracted receipt image. An owner_ruling or
-- register link alone stays a ruling (has_ruling), not a receipt. Signature and every other rule are unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.accounting_decision_proof(uuid);
CREATE OR REPLACE FUNCTION public.accounting_decision_proof(p_owner_id uuid)
RETURNS TABLE(id uuid, document_id uuid, revised_at timestamptz, record jsonb, year text, section text, amount numeric,
  has_statement boolean, has_receipt boolean, vehicle_id uuid, car_cost boolean, has_ruling boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH recs AS MATERIALIZED (
    SELECT * FROM public.accounting_current_records(p_owner_id)
  ), artifacts AS MATERIALIZED (
    SELECT d.id FROM public.financial_documents d
    WHERE d.owner_id = p_owner_id AND d.source_filename ~* '\.(jpe?g|png|webp|heic|pdf)$'
  ), cells AS MATERIALIZED (
    SELECT e.document_id, e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded
      AND (e.field_key LIKE 'expense\_items\_%' OR e.field_key LIKE 'expense\_use\_%' OR e.field_key = 'bank_corroboration')
  ), statement_links AS MATERIALIZED (
    SELECT DISTINCT x AS local_id, r.record->>'source_key' AS bank_key
    FROM recs r, jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.record->'bank_links') = 'array' THEN r.record->'bank_links' ELSE '[]' END) x
    WHERE r.record->>'record_kind' = 'retained_bank_movement'
  ), corroborated AS MATERIALIZED (
    SELECT DISTINCT c.v->>'bank_source_key' AS bank_key FROM cells c
    WHERE c.field_key = 'bank_corroboration' AND c.document_id IN (SELECT a.id FROM artifacts a)
  ), receipt_keys AS MATERIALIZED (
    SELECT coalesce(c.v->>'expense_source_key', c.v->>'source_key') AS source_key
    FROM cells c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.v->'items') = 'array' THEN c.v->'items' ELSE '[]' END) it
    WHERE c.field_key LIKE 'expense\_items\_%' AND (it->>'document_id') IN (SELECT a.id::text FROM artifacts a)
    UNION
    SELECT c.v->>'source_key' FROM cells c
    WHERE c.field_key LIKE 'expense\_use\_%' AND c.document_id IN (SELECT a.id FROM artifacts a)
  ), receipt_locals AS MATERIALIZED (
    SELECT DISTINCT s.local_id FROM statement_links s JOIN corroborated k ON k.bank_key = s.bank_key
  ), uses AS MATERIALIZED (
    SELECT DISTINCT ON (c.v->>'source_key') c.v->>'source_key' AS source_key,
      CASE WHEN c.v->>'vehicle_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN (c.v->>'vehicle_id')::uuid END AS vehicle_id
    FROM cells c WHERE c.field_key LIKE 'expense\_use\_%' AND c.v ? 'source_key'
    ORDER BY c.v->>'source_key', (c.v->>'vehicle_id') IS NULL
  )
  SELECT r.id, r.document_id, r.revised_at, r.record, r.record->>'year', r.record->>'section',
    CASE WHEN r.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (r.record->>'amount')::numeric END,
    s.local_id IS NOT NULL,
    (k.source_key IS NOT NULL OR rl.local_id IS NOT NULL
      -- A cited receipt: a proof link to the receipt or order itself (Gmail message, file line, photo, artifact).
      OR (jsonb_typeof(r.record->'proof_links') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(r.record->'proof_links') pl
        WHERE pl->>'kind' IN ('gmail', 'file', 'photo', 'artifact') AND coalesce(pl->>'ref', '') <> ''))),
    u.vehicle_id,
    -- Costs that belong to one car (parts, labor, paint, machining, hauling, car purchase/sale costs, the business
    -- vehicle). Shop tools, supplies and design are shop costs and are not expected to name a car.
    coalesce(r.record->>'category', '') ~* '^(car restoration — (parts|labor|painting|machining|transport)|vehicle)',
    -- An owner ruling with its structured proof: ruling_id set and at least one proof link (a ruling is not a receipt).
    (coalesce(r.record->>'ruling_id', '') <> ''
      AND jsonb_typeof(r.record->'proof_links') = 'array' AND jsonb_array_length(r.record->'proof_links') > 0)
  FROM recs r
  LEFT JOIN (SELECT DISTINCT local_id FROM statement_links) s ON s.local_id = r.record->>'local_id'
  LEFT JOIN (SELECT DISTINCT source_key FROM receipt_keys) k ON k.source_key = r.record->>'source_key'
  LEFT JOIN receipt_locals rl ON rl.local_id = r.record->>'local_id'
  LEFT JOIN uses u ON u.source_key = r.record->>'source_key'
  WHERE r.record->>'record_kind' = 'retained_ledger_decision'
$$;
