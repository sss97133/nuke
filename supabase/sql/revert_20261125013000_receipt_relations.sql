-- Revert 20261125013000_receipt_relations: vehicle_spend_lines_due as 20261124224500 defined it; the fold, job and tables go.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'receipt-relations-fold'; END IF;
END $$;
CREATE OR REPLACE VIEW public.vehicle_spend_lines_due WITH (security_invoker = true) AS
WITH cand AS (
  SELECT l.vehicle_id, l.receipt_id
    FROM public.receipt_vehicle_links l
   WHERE l.status = 'linked' AND l.retired_at IS NULL
  UNION
  SELECT v.id, r.id
    FROM public.receipts r
   CROSS JOIN LATERAL unnest(ARRAY[r.vehicle_id,
           CASE WHEN r.scope_type = 'vehicle' AND r.scope_id ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                THEN r.scope_id::uuid END]) AS x(vehicle_id)
    JOIN public.vehicles v ON v.id = x.vehicle_id
   WHERE NOT EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.retired_at IS NULL)
),
counted AS (
  SELECT c.vehicle_id, r.id AS receipt_id, round(coalesce(r.total_amount, r.total), 2) AS amt,
         (r.amount_check = 'verified' AND r.amount_check_reasons ->> 'basis' = 'items_plus_tax') AS reconciled
    FROM cand c
    JOIN public.receipts r ON r.id = c.receipt_id
   WHERE r.duplicate_of IS NULL
     AND coalesce(r.is_superseded, false) = false
     AND r.amount_check IN ('verified', 'plausible')
     AND NOT public.receipt_doc_kind_excluded(r.document_kind)
     AND NOT public.receipt_doc_kind_quoted(r.document_kind)
     AND round(coalesce(r.total_amount, r.total), 2) <> 0
),
lines AS (
  SELECT c.vehicle_id, c.receipt_id, i.id AS receipt_item_id, round(i.total_price, 2) AS amount
    FROM counted c
    JOIN public.receipt_items i ON i.receipt_id = c.receipt_id
   WHERE c.reconciled AND round(i.total_price, 2) <> 0
),
lined AS (SELECT vehicle_id, receipt_id, sum(amount) AS s FROM lines GROUP BY 1, 2)
SELECT vehicle_id, receipt_id, receipt_item_id, 'receipt_line'::text AS basis, amount FROM lines
UNION ALL
SELECT c.vehicle_id, c.receipt_id, NULL::uuid, 'receipt_remainder', c.amt - l.s
  FROM counted c JOIN lined l ON l.vehicle_id = c.vehicle_id AND l.receipt_id = c.receipt_id
 WHERE c.amt - l.s <> 0
UNION ALL
SELECT c.vehicle_id, c.receipt_id, NULL::uuid, 'receipt_total', c.amt
  FROM counted c
 WHERE NOT EXISTS (SELECT 1 FROM lined l WHERE l.vehicle_id = c.vehicle_id AND l.receipt_id = c.receipt_id);
REVOKE ALL ON public.vehicle_spend_lines_due FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_spend_lines_due TO service_role;
DROP FUNCTION IF EXISTS public.receipt_relations_fold(text);
DROP FUNCTION IF EXISTS public.receipt_relations_due();
DROP TABLE IF EXISTS public.receipt_relations;
DROP TABLE IF EXISTS public.receipt_relation_rules;
COMMIT;
