-- receipt_line_gaps_edges_v1: the unmatched fold reads the stored edges (receipt_line_edges, 20261124234000) instead of
-- running receipt_line_rule_hit() twice per line on every read.
--
-- WHY. receipt_line_gaps called receipt_line_rule_hit('system', ...) and ('labor_operation', ...) per line per read;
-- 34 operation patterns exceed the 32-entry regex cache, so each read recompiled every pattern for every line. The
-- answer now lives in receipt_line_edges with its rule as basis; this view joins it. Columns, order and meaning are
-- unchanged (receipt_line_gap_terms and receipt_line_gap_counts read this view and are not touched).
-- Scope: the view applied vendor / make / year scoped rules; the edges apply unscoped rules only until the vendor
-- scope migration (keyed by receipts.vendor_organization_id). Measured 2026-11-24: 0 active scoped rules, so the output
-- is identical. The proof below compares every row before and after and raises on any difference, so this migration
-- refuses to deploy while a scoped rule is active.
--
-- REVERT. Re-run the view body from 20261124163400_receipt_line_gaps_by_amount.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP TABLE IF EXISTS pg_temp._gaps_before;
CREATE TEMP TABLE _gaps_before AS SELECT * FROM public.receipt_line_gaps;

CREATE OR REPLACE VIEW public.receipt_line_gaps WITH (security_invoker = true) AS
WITH lines AS (
  SELECT i.id AS item_id, i.receipt_id, i.description, i.part_number, i.total_price, r.vendor_name, l.vehicle_id, v.make, v.year
    FROM public.receipt_items i
    JOIN public.receipts r ON r.id = i.receipt_id
    JOIN public.receipt_vehicle_links l ON l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL
    JOIN public.vehicles v ON v.id = l.vehicle_id
   WHERE r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
     AND NOT public.receipt_doc_kind_quoted(r.document_kind) AND NOT public.receipt_doc_kind_excluded(r.document_kind)
     AND public.receipt_line_kind(i.description, i.part_number, i.total_price, i.hours, i.line_date, nullif(btrim(i.performer), '')) = 'part'
), keyed AS (
  SELECT ln.item_id, ln.receipt_id, ln.description, ln.part_number, ln.total_price, ln.vendor_name, ln.vehicle_id, ln.make, ln.year,
         s.rule_id AS system_rule_id, s.system_key, o.rule_id AS operation_rule_id, o.operation_code
    FROM lines ln
    LEFT JOIN public.receipt_line_edges s ON s.receipt_item_id = ln.item_id AND s.classifier = 'system'
    LEFT JOIN public.receipt_line_edges o ON o.receipt_item_id = ln.item_id AND o.classifier = 'labor_operation'
)
SELECT k.item_id, k.receipt_id, k.vehicle_id, k.vendor_name, k.description, k.part_number, k.system_key, k.system_rule_id,
       k.operation_code, k.operation_rule_id, lo.base_hours,
       CASE WHEN k.operation_code IS NOT NULL AND lo.base_hours IS NULL THEN 'operation_no_hours'
            WHEN k.operation_code IS NOT NULL THEN NULL
            WHEN k.system_key IS NULL THEN 'no_system'
            WHEN sy.expects_operation IS FALSE THEN 'no_operation_expected'
            ELSE 'no_operation' END AS gap,
       k.total_price
  FROM keyed k
  LEFT JOIN public.receipt_line_systems sy ON sy.system_key = k.system_key
  LEFT JOIN public.labor_operations lo ON lo.code = k.operation_code;

DO $proof$
DECLARE a int; b int;
BEGIN
  SELECT count(*) INTO a FROM (SELECT * FROM _gaps_before EXCEPT ALL SELECT * FROM public.receipt_line_gaps) x;
  SELECT count(*) INTO b FROM (SELECT * FROM public.receipt_line_gaps EXCEPT ALL SELECT * FROM _gaps_before) x;
  IF a + b > 0 THEN
    RAISE EXCEPTION 'receipt_line_gaps changed: % rows only before, % only after', a, b;
  END IF;
  RAISE NOTICE 'receipt_line_gaps reads receipt_line_edges: % rows, identical', (SELECT count(*) FROM _gaps_before);
END
$proof$;
DROP TABLE pg_temp._gaps_before;
