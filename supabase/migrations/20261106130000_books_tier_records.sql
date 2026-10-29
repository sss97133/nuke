-- books_tier_records(owner, year, class, limit, offset): the decisions behind one number of the audit-tier rollup.
--
-- WHY. v_books_audit_tier_years states how the year's deductions are supported (A bank line + cited allocation basis + document, B bank line
-- + cited allocation basis, C the rest; section 274 receipts counted apart) but no page could show which decisions stand behind a number.
-- This reader returns them in the envelope accounting_closeout_records already returns (assessed, total, amount, rows with the record in
-- the shape the records table renders), so the office's one row list shows them and each row opens the same evidence dialog. Each row
-- also carries its proof: the tier, the reason, the proof basis and the citations the view used. It is read-only, adds no definition
-- of a tier (it filters v_books_audit_tiers) and the page computes nothing.
--
-- CLASSES (one per number of the rollup; the same predicates v_books_audit_tier_years counts with):
--   tier_a, tier_b, tier_c     tier = A | B | C
--   excluded                   not a deduction of its own (tier X: a credit, a share of another order, a pool allocation, a zero pair)
--   b_no_bank                  tier B with no bank line (asset register, owner ruling)
--   s274_needs_receipt         section 274 items that need a receipt and have no document
--   no_pay_no_ruling           deductions with no payment proof, no owner ruling and no structural rule
-- total and amount are over the whole class; rows are largest amount first, paged. A contract test keeps every class total equal to
-- the rollup's own count.
-- SECURITY INVOKER over v_books_audit_tiers and v_financial_accounting_records: the book's row policies bound every read, a stranger
-- gets total 0. EXECUTE to authenticated and service_role only. Cost: the tier view (3 to 6 s on prod, read-only, 2026-10-29) plus a
-- keyed read of the records view for at most 250 rows (0.2 s); the authenticated cap is 15 s.
-- CONTRACT. supabase/sql/test_books_tier_records.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.books_tier_records(p_owner_id uuid, p_year text, p_class text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_total bigint;
  v_amount numeric;
  v_page jsonb;
  v_ids uuid[];
  v_records jsonb;
BEGIN
  IF p_owner_id IS NULL OR coalesce(p_year, '') !~ '^[0-9]{4}$' OR coalesce(p_limit, 0) NOT BETWEEN 1 AND 250
     OR coalesce(p_offset, -1) NOT BETWEEN 0 AND 100000
     OR p_class IS NULL OR p_class NOT IN ('tier_a', 'tier_b', 'tier_c', 'excluded', 'b_no_bank', 's274_needs_receipt', 'no_pay_no_ruling')
  THEN RAISE EXCEPTION 'bounded tier drill: year YYYY, a known class, limit 1 to 250' USING ERRCODE = 'invalid_parameter_value'; END IF;

  -- Phase 1: the class, once (the tier view is the cost: 3 to 6 s on prod). Totals over the whole class, then one page with its proof.
  WITH t AS MATERIALIZED (
    SELECT x.* FROM public.v_books_audit_tiers x
    WHERE x.owner_id = p_owner_id AND x.year = p_year
      AND CASE p_class
        WHEN 'tier_a' THEN x.tier = 'A'
        WHEN 'tier_b' THEN x.tier = 'B'
        WHEN 'tier_c' THEN x.tier = 'C'
        WHEN 'excluded' THEN NOT x.is_deduction
        WHEN 'b_no_bank' THEN x.tier = 'B' AND NOT x.pay_proof
        WHEN 's274_needs_receipt' THEN x.needs_receipt AND NOT x.doc_proof
        WHEN 'no_pay_no_ruling' THEN x.is_deduction AND NOT x.pay_proof AND NOT x.has_owner_ruling AND x.structural_rule IS NULL
      END
  ), pg AS MATERIALIZED (
    SELECT t.id, row_number() OVER (ORDER BY abs(t.amount) DESC, t.id) AS rn,
           jsonb_build_object('id', t.id, 'document_id', t.document_id,
             'proof', jsonb_build_object(
               'tier', t.tier, 'tier_reason', t.tier_reason, 'proof_basis', t.proof_basis,
               'pay_proof', t.pay_proof, 'doc_proof', t.doc_proof, 'purpose_proof', t.purpose_proof, 'has_owner_ruling', t.has_owner_ruling,
               'is_274', t.is_274, 'needs_receipt', t.needs_receipt, 'is_caveat', t.is_caveat, 'structural_rule', t.structural_rule,
               'payment_cites', t.payment_cites, 'document_cites', t.document_cites, 'ruling_cites', t.ruling_cites,
               'rule_cites', t.rule_cites, 'structural_cites', t.structural_cites)) AS item
    FROM t ORDER BY abs(t.amount) DESC, t.id LIMIT p_limit OFFSET p_offset
  )
  SELECT (SELECT count(*) FROM t), (SELECT coalesce(sum(t.amount), 0) FROM t),
         coalesce((SELECT jsonb_agg(pg.item ORDER BY pg.rn) FROM pg), '[]'::jsonb),
         coalesce((SELECT array_agg(pg.id ORDER BY pg.rn) FROM pg), '{}'::uuid[])
  INTO v_total, v_amount, v_page, v_ids;

  -- Phase 2: the records of that page, a keyed read of the records view. Joined to the tier view in one statement the planner
  -- re-reads the view per row (20 s on prod, read-only, 2026-10-29); by key it is 0.2 s.
  SELECT coalesce(jsonb_object_agg(r.id::text, r.record), '{}'::jsonb) INTO v_records
  FROM public.v_financial_accounting_records r WHERE r.owner_id = p_owner_id AND r.id = ANY(v_ids);

  RETURN jsonb_build_object(
    'reader', 'books_tier_records', 'owner_id', p_owner_id, 'year', p_year, 'class', p_class, 'read_at', now(), 'assessed', true,
    'total', v_total, 'amount', v_amount,
    'rows', coalesce((SELECT jsonb_agg(p.value || jsonb_build_object('record', v_records -> (p.value ->> 'id')) ORDER BY p.ord)
                      FROM jsonb_array_elements(v_page) WITH ORDINALITY AS p(value, ord) WHERE v_records ? (p.value ->> 'id')), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.books_tier_records(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_tier_records(uuid, text, text, integer, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.books_tier_records(uuid, text, text, integer, integer) IS
  'The decisions behind one number of v_books_audit_tier_years (class tier_a, tier_b, tier_c, excluded, b_no_bank, s274_needs_receipt, no_pay_no_ruling) for one year, largest first, in the envelope accounting_closeout_records returns (assessed, total, amount, rows with the record) plus each row''s proof: tier, reason, proof basis and the citations the view used. total and amount cover the whole class. SECURITY INVOKER; the book''s row policies apply. Read-only.';
