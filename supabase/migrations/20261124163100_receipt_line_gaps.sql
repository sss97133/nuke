-- The unmatched fold: every vehicle-linked receipt part line no receipt_line_rules row classifies, across all vehicles,
-- grouped so the biggest gaps show first. Ingestion lands a line; if no rule keys it, it appears here with no agent step.
--
-- What this adds (additive; revert: supabase/sql/revert_20261124163100_receipt_line_gaps.sql):
--   receipt_line_systems.expects_operation  false for systems whose lines are not a part a person fits (shop supplies,
--                                           loose hardware, machine-shop services whose hours come from the paper).
--                                           A line in such a system is 'no_operation_expected', not a gap.
--   receipt_line_gaps        one row per (live part line, linked vehicle): the system and labor operation keys with the
--                            rule that assigned each (scoped rules apply: vendor, make and year are passed), the book
--                            hours, and gap = no_system | no_operation | operation_no_hours | no_operation_expected |
--                            null (classified, with hours). Service role only: it carries line text.
--   receipt_line_gap_terms   the gaps grouped by gap, system and word: lines, vehicles, vendors, receipts, ordered by
--                            vehicles then lines. The word is a lower-case token of 3+ letters from the line text; one
--                            line counts under each of its words. This is the worklist a rule proposer reads.
--   receipt_line_gap_counts  keys and counts only, by gap and system (no text). All three: service role only.
-- Population: receipt_items on receipts that are not superseded, not duplicates, not quotes and not an excluded
-- document kind, with receipt_line_kind = 'part', linked to a vehicle (receipt_vehicle_links status linked, not retired).
-- Contract: supabase/sql/test_receipt_line_rules.sql (section "gaps").

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.receipt_line_systems ADD COLUMN expects_operation boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.receipt_line_systems.expects_operation IS
  'Whether a part line in this system is expected to map to a labor_operations fitting. false: the line is a consumable, loose hardware or a service whose hours are printed on the paper; such a line is not counted as a gap.';
UPDATE public.receipt_line_systems SET expects_operation = false,
       note = 'Consumables: no fitting operation.' WHERE system_key = 'supplies';
UPDATE public.receipt_line_systems SET expects_operation = false,
       note = 'Loose fasteners: fitted as part of another operation.' WHERE system_key = 'hardware';
UPDATE public.receipt_line_systems SET expects_operation = false,
       note = 'Machine-shop services: the hours are the shop paper''s, read by the engine segment, not a book fitting.'
 WHERE system_key = 'machining';

CREATE VIEW public.receipt_line_gaps WITH (security_invoker = true) AS
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
         END AS gap
    FROM keyed k
    LEFT JOIN public.receipt_line_systems sy ON sy.system_key = k.system_key
    LEFT JOIN public.labor_operations lo ON lo.code = k.operation_code;
COMMENT ON VIEW public.receipt_line_gaps IS
  'One row per vehicle-linked live receipt part line and vehicle: its system and labor operation keys with the receipt_line_rules row that assigned each, the book hours, and the gap (no_system | no_operation | operation_no_hours | no_operation_expected | null when classified with hours). Service role only.';

CREATE VIEW public.receipt_line_gap_terms WITH (security_invoker = true) AS
  SELECT g.gap, coalesce(g.system_key, '(none)') AS system_key, w.term,
         count(DISTINCT g.item_id) AS lines, count(DISTINCT g.vehicle_id) AS vehicles,
         count(DISTINCT lower(g.vendor_name)) AS vendors, count(DISTINCT g.receipt_id) AS receipts,
         array_agg(DISTINCT g.item_id) AS item_ids
    FROM public.receipt_line_gaps g
    CROSS JOIN LATERAL (SELECT DISTINCT m[1] AS term
                          FROM regexp_matches(lower(coalesce(g.description, '')), '([a-z]{3,})', 'g') m) w
   WHERE g.gap IN ('no_system', 'no_operation', 'operation_no_hours')
   GROUP BY 1, 2, 3
   ORDER BY vehicles DESC, lines DESC, term;
COMMENT ON VIEW public.receipt_line_gap_terms IS
  'The receipt_line_gaps worklist grouped by gap, system and word (3+ letters, one line under each of its words), biggest first by vehicles then lines, with the item ids. What a rule proposer reads. Service role only.';

CREATE VIEW public.receipt_line_gap_counts WITH (security_invoker = true) AS
  SELECT coalesce(g.gap, 'classified') AS gap, coalesce(g.system_key, '(none)') AS system_key,
         count(DISTINCT g.item_id) AS lines, count(DISTINCT g.vehicle_id) AS vehicles
    FROM public.receipt_line_gaps g
   GROUP BY 1, 2
   ORDER BY lines DESC, gap, system_key;
COMMENT ON VIEW public.receipt_line_gap_counts IS
  'receipt_line_gaps counted by gap and system: keys and counts only.';

REVOKE ALL ON public.receipt_line_gaps, public.receipt_line_gap_terms, public.receipt_line_gap_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_line_gaps, public.receipt_line_gap_terms, public.receipt_line_gap_counts TO service_role;
