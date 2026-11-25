-- Order the receipt line gap worklist by money, not line count: a $1,000 unkeyed part and a $0.35 clip are not the
-- same gap (owner rule: value per dollar, never per line; ta-skeptic's attack on #3763).
-- receipt_line_gaps gains total_price (the line's printed amount, as landed); receipt_line_gap_terms and
-- receipt_line_gap_counts gain amount (sum over distinct lines, so a line linked to two vehicles counts once) and
-- are ordered by it. Service role only, unchanged. Revert: re-run the view definitions of 20261124163100.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.receipt_line_gaps WITH (security_invoker = true) AS
  WITH lines AS (
    SELECT i.id AS item_id, i.receipt_id, i.description, i.part_number, i.total_price, r.vendor_name,
           l.vehicle_id, v.make, v.year
      FROM public.receipt_items i
      JOIN public.receipts r ON r.id = i.receipt_id
      JOIN public.receipt_vehicle_links l ON l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL
      JOIN public.vehicles v ON v.id = l.vehicle_id
     WHERE r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
       AND NOT public.receipt_doc_kind_quoted(r.document_kind)
       AND NOT public.receipt_doc_kind_excluded(r.document_kind)
       AND public.receipt_line_kind(i.description, i.part_number, i.total_price, i.hours, i.line_date,
                                    nullif(btrim(i.performer), '')) = 'part'
  ),
  keyed AS (
    SELECT ln.*, s.rule_id AS system_rule_id, s.output_key AS system_key,
           o.rule_id AS operation_rule_id, o.output_key AS operation_code
      FROM lines ln
      LEFT JOIN LATERAL public.receipt_line_rule_hit('system', ln.description, ln.part_number, ln.vendor_name, ln.make, ln.year) s ON true
      LEFT JOIN LATERAL public.receipt_line_rule_hit('labor_operation', ln.description, ln.part_number, ln.vendor_name, ln.make, ln.year) o ON true
  )
  SELECT k.item_id, k.receipt_id, k.vehicle_id, k.vendor_name, k.description, k.part_number,
         k.system_key, k.system_rule_id, k.operation_code, k.operation_rule_id, lo.base_hours,
         CASE
           WHEN k.operation_code IS NOT NULL AND lo.base_hours IS NULL THEN 'operation_no_hours'
           WHEN k.operation_code IS NOT NULL THEN NULL
           WHEN k.system_key IS NULL THEN 'no_system'
           WHEN sy.expects_operation IS FALSE THEN 'no_operation_expected'
           ELSE 'no_operation'
         END AS gap,
         k.total_price
    FROM keyed k
    LEFT JOIN public.receipt_line_systems sy ON sy.system_key = k.system_key
    LEFT JOIN public.labor_operations lo ON lo.code = k.operation_code;

CREATE OR REPLACE VIEW public.receipt_line_gap_terms WITH (security_invoker = true) AS
  WITH t AS MATERIALIZED (
    SELECT g.gap, coalesce(g.system_key, '(none)') AS system_key, w.term, g.item_id, g.vehicle_id, g.vendor_name,
           g.receipt_id, g.total_price
      FROM public.receipt_line_gaps g
      CROSS JOIN LATERAL (SELECT DISTINCT m[1] AS term
                            FROM regexp_matches(lower(coalesce(g.description, '')), '([a-z]{3,})', 'g') m) w
     WHERE g.gap IN ('no_system', 'no_operation', 'operation_no_hours')
  ),
  money AS (
    SELECT d.gap, d.system_key, d.term, sum(d.total_price) AS amount
      FROM (SELECT DISTINCT gap, system_key, term, item_id, total_price FROM t) d
     GROUP BY 1, 2, 3
  )
  SELECT t.gap, t.system_key, t.term,
         count(DISTINCT t.item_id) AS lines, count(DISTINCT t.vehicle_id) AS vehicles,
         count(DISTINCT lower(t.vendor_name)) AS vendors, count(DISTINCT t.receipt_id) AS receipts,
         array_agg(DISTINCT t.item_id) AS item_ids, m.amount
    FROM t JOIN money m USING (gap, system_key, term)
   GROUP BY t.gap, t.system_key, t.term, m.amount
   ORDER BY amount DESC NULLS LAST, vehicles DESC, lines DESC, term;

CREATE OR REPLACE VIEW public.receipt_line_gap_counts WITH (security_invoker = true) AS
  WITH g AS MATERIALIZED (
    SELECT coalesce(x.gap, 'classified') AS gap, coalesce(x.system_key, '(none)') AS system_key, x.item_id, x.vehicle_id,
           x.total_price
      FROM public.receipt_line_gaps x
  ),
  money AS (
    SELECT d.gap, d.system_key, sum(d.total_price) AS amount
      FROM (SELECT DISTINCT gap, system_key, item_id, total_price FROM g) d
     GROUP BY 1, 2
  )
  SELECT g.gap, g.system_key, count(DISTINCT g.item_id) AS lines, count(DISTINCT g.vehicle_id) AS vehicles, m.amount
    FROM g JOIN money m USING (gap, system_key)
   GROUP BY g.gap, g.system_key, m.amount
   ORDER BY m.amount DESC NULLS LAST, lines DESC, g.gap, g.system_key;

COMMENT ON VIEW public.receipt_line_gap_terms IS
  'The receipt_line_gaps worklist grouped by gap, system and word (3+ letters, one line under each of its words), biggest first by amount (distinct lines), then vehicles, then lines, with the item ids. What a rule proposer reads. Service role only.';
COMMENT ON VIEW public.receipt_line_gap_counts IS
  'receipt_line_gaps counted by gap and system with the amount of their distinct lines, biggest amount first.';
REVOKE ALL ON public.receipt_line_gaps, public.receipt_line_gap_terms, public.receipt_line_gap_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_line_gaps, public.receipt_line_gap_terms, public.receipt_line_gap_counts TO service_role;
