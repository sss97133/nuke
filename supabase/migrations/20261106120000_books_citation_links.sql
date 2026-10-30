-- v_books_citation_links: how each Expense decision ties to a retained bank movement, per owner and year.
--
-- WHY. Two readers count a "bank line" in opposite directions and disagree on the page the owner already uses. The close-out
-- (accounting_decision_proof.has_statement) counts only a bank movement that LISTS the decision in its bank_links; the audit tiers
-- (v_books_audit_tiers.pay_proof) count only a decision that lists a bank link of its own, and never check the linked id exists.
-- Measured read-only on prod, 2026-10-29: the early years (2022, 2023) link almost only decision-to-movement, so the close-out finds almost no
-- expense with a statement line; the later years (2024, 2025) link almost only movement-to-decision, so the tiers count decisions as bank-backed
-- whose cited ids exist in no movement. The counts are in the view and move as the books change; they are not copied into this public file.
-- This view places every decision in exactly one class so neither number is hidden, and carries the line-level truth (links written, links
-- that resolve) and whether the linked movements add up to the decision's amount to the cent. It decides nothing about which definition is
-- right; that is the owner's ruling.
--
-- THE FIVE CLASSES (exclusive; they sum to decisions):
--   both            cites at least one movement that is in the books, and a movement lists the decision
--   cites_only      cites at least one movement that is in the books; no movement lists the decision
--   cited_by_only   cites no movement that is in the books; a movement lists the decision
--   cites_missing   cites ids, none of which is a movement in the books, and no movement lists the decision
--   none            cites nothing and no movement lists the decision
-- Population: the Expense decisions of the current books that v_books_audit_tiers tiers (same filter), so the two views agree on N.
-- Movements: retained_bank_movement records. A link resolves when a movement of the same owner has that local_id.
-- Amounts: linked_usd is the sum of the absolute amounts of the distinct movements linked in either direction; amount_equal_n counts
-- the tied decisions where that equals the decision's absolute amount to the cent (a movement shared by several decisions is larger
-- than any one of them and does not count).
--
-- Reads the same RLS-bound base (v_financial_accounting_records) as the tier views, so a stranger sees nothing and the view is
-- security_invoker. Measured read-only on prod, 2026-10-29, as the owner role: 0.7 s, 4 rows (one per year; the class counts are in the view).
-- Every stage is MATERIALIZED on purpose: left inlined, the planner joined the stages with nested loops (14.9 s).
-- CONTRACT. supabase/sql/test_books_citation_links.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.v_books_citation_links WITH (security_invoker = true) AS
WITH r AS MATERIALIZED (
  SELECT v.id, v.owner_id, v.year, v.local_id, v.record_kind, v.amount_value,
         CASE WHEN jsonb_typeof(v.record->'bank_links') = 'array' THEN v.record->'bank_links' ELSE '[]'::jsonb END AS bl
  FROM public.v_financial_accounting_records v
  WHERE v.record_kind = 'retained_bank_movement'
     OR (v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.amount_value IS NOT NULL
         AND coalesce(v.status, '') NOT LIKE 'Closed%' AND coalesce(v.status, '') NOT LIKE 'Open allocation%')
), d AS MATERIALIZED (
  SELECT r.id, r.owner_id, r.year, r.local_id, r.amount_value AS amount, r.bl FROM r WHERE r.record_kind = 'retained_ledger_decision'
), m AS MATERIALIZED (
  SELECT r.owner_id, r.local_id, max(r.amount_value) AS amount FROM r WHERE r.record_kind = 'retained_bank_movement' GROUP BY r.owner_id, r.local_id
), mm AS MATERIALIZED (
  -- movement -> the decision id it lists
  SELECT r.owner_id, r.local_id AS mv_id, l.id AS decision_id, max(r.amount_value) AS amount
  FROM r CROSS JOIN LATERAL jsonb_array_elements_text(r.bl) AS l(id)
  WHERE r.record_kind = 'retained_bank_movement'
  GROUP BY r.owner_id, r.local_id, l.id
), cited AS MATERIALIZED (
  -- decision -> the movement id it cites, and the movement when that id is in the books
  SELECT x.id, x.mv_id, m.local_id IS NOT NULL AS resolved, m.amount
  FROM (SELECT DISTINCT d.id, d.owner_id, y.mv_id FROM d CROSS JOIN LATERAL jsonb_array_elements_text(d.bl) AS y(mv_id)) x
  LEFT JOIN m ON m.owner_id = x.owner_id AND m.local_id = x.mv_id
), listed AS MATERIALIZED (
  SELECT d.id, mm.mv_id, mm.amount FROM d JOIN mm ON mm.owner_id = d.owner_id AND mm.decision_id = d.local_id
), per AS MATERIALIZED (
  SELECT u.id, sum(u.cited_n) AS cited_n, sum(u.cited_resolved_n) AS cited_resolved_n, sum(u.listed_n) AS listed_n, sum(u.linked_usd) AS linked_usd
  FROM (
    SELECT c.id, count(*) AS cited_n, count(*) FILTER (WHERE c.resolved) AS cited_resolved_n, 0::bigint AS listed_n, 0::numeric AS linked_usd
    FROM cited c GROUP BY c.id
    UNION ALL
    SELECT l.id, 0, 0, count(*), 0 FROM listed l GROUP BY l.id
    UNION ALL
    SELECT k.id, 0, 0, 0, sum(abs(k.amount)) FROM (
      SELECT c.id, c.mv_id, c.amount FROM cited c WHERE c.resolved
      UNION
      SELECT l.id, l.mv_id, l.amount FROM listed l) k
    GROUP BY k.id
  ) u GROUP BY u.id
), cls AS (
  SELECT d.owner_id, d.year, d.id, d.amount,
         coalesce(p.cited_n, 0) AS cited_n, coalesce(p.cited_resolved_n, 0) AS cited_resolved_n, p.linked_usd,
         CASE WHEN coalesce(p.cited_resolved_n, 0) > 0 AND coalesce(p.listed_n, 0) > 0 THEN 'both'
              WHEN coalesce(p.cited_resolved_n, 0) > 0 THEN 'cites_only'
              WHEN coalesce(p.listed_n, 0) > 0 THEN 'cited_by_only'
              WHEN coalesce(p.cited_n, 0) > 0 THEN 'cites_missing'
              ELSE 'none' END AS tie
  FROM d LEFT JOIN per p ON p.id = d.id
)
SELECT c.owner_id, c.year,
  count(*) AS decisions,
  count(*) FILTER (WHERE c.tie = 'both') AS both_n,
  count(*) FILTER (WHERE c.tie = 'cites_only') AS cites_only_n,
  count(*) FILTER (WHERE c.tie = 'cited_by_only') AS cited_by_only_n,
  count(*) FILTER (WHERE c.tie = 'cites_missing') AS cites_missing_n,
  count(*) FILTER (WHERE c.tie = 'none') AS none_n,
  sum(c.cited_n)::bigint AS links,
  sum(c.cited_resolved_n)::bigint AS links_resolved,
  count(*) FILTER (WHERE c.tie IN ('both', 'cites_only', 'cited_by_only')) AS tied_n,
  count(*) FILTER (WHERE c.tie IN ('both', 'cites_only', 'cited_by_only') AND round(c.linked_usd, 2) = round(abs(c.amount), 2)) AS amount_equal_n
FROM cls c
GROUP BY c.owner_id, c.year;

COMMENT ON VIEW public.v_books_citation_links IS
  'Per owner and year, every Expense decision of the current books (the population of v_books_audit_tiers) placed in exactly one class by how it ties to a retained bank movement: both (cites a movement that is in the books and a movement lists it), cites_only, cited_by_only, cites_missing (cites ids that are in no movement), none. links and links_resolved are the citations written and the ones that resolve; tied_n are the decisions tied in either direction and amount_equal_n those whose linked movements add up to the decision''s amount to the cent. Decides nothing about which direction is the right definition of a bank line. security_invoker; about 0.7 s.';
COMMENT ON COLUMN public.v_books_citation_links.owner_id IS 'The book. Unit: none (key). Source: v_financial_accounting_records. Grain: one row per owner and year. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.year IS 'Tax year of the decisions, as written on the record (text). Unit: year. Source: v_financial_accounting_records. Grain: one row per owner and year. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.decisions IS 'Expense decisions in the year; both_n + cites_only_n + cited_by_only_n + cites_missing_n + none_n. Equals v_books_audit_tier_years.decisions. Unit: count. Source: v_financial_accounting_records. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.both_n IS 'Decisions that cite a movement that is in the books AND are listed by a movement (linked both ways). Unit: count. Source: bank_links on decisions and on movements. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.cites_only_n IS 'Decisions that cite a movement that is in the books; no movement lists them. Unit: count. Source: bank_links on decisions. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.cited_by_only_n IS 'Decisions that cite no movement that is in the books, but a movement lists them. Unit: count. Source: bank_links on movements. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.cites_missing_n IS 'Decisions that cite ids, none of which is a movement in the books, and that no movement lists. Unit: count. Source: bank_links on decisions. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.none_n IS 'Decisions that cite nothing and that no movement lists. Unit: count. Source: bank_links. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.links IS 'Distinct movement ids the year''s decisions cite. Unit: count of citations. Source: bank_links on decisions. Grain: one (decision, cited id). Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.links_resolved IS 'Of links, the ones whose id is a retained bank movement of the same owner. Unit: count of citations. Source: bank_links on decisions; retained_bank_movement records. Grain: one (decision, cited id). Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.tied_n IS 'Decisions tied to a movement in either direction: both_n + cites_only_n + cited_by_only_n. Unit: count. Source: this view. Grain: one decision. Clock: current books.';
COMMENT ON COLUMN public.v_books_citation_links.amount_equal_n IS 'Of tied_n, the decisions whose distinct linked movements add up (absolute values) to the decision''s absolute amount to the cent. A movement shared by several decisions is larger than each and does not count. Unit: count. Source: movement and decision amounts. Grain: one decision. Clock: current books.';

-- Supabase's default privileges give anon and authenticated write bits on a new public object: take everything away first.
REVOKE ALL ON public.v_books_citation_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_books_citation_links TO authenticated, service_role;
