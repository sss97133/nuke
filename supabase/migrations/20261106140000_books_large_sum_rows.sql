-- books_large_sum_rows(owner): the large sums rule R12 flags, as rows the owner can act on; books_gate_context(owner, year): the denominators a stored gate run keeps.
--
-- WHY. v_books_large_sums (migration 20261105140000, tuned in 20261105160000) ranks every deduction decision by dollars and says, for the head that
-- covers 80% of the year's deduction dollars, which rows lack a bank line, a cited basis or the document their kind requires (an invoice, a purchase
-- agreement or bill of sale, a receipt, a lease). Nothing shows those rows, so the owner cannot see which paper to supply. This reader returns them,
-- per year, largest dollars first, in one call (the view costs about 3 s on prod, so one call, not one per year), with the date and the record the
-- office's evidence dialog opens, and any document the owner has already attached to a row. It adds no definition: the head, the flags and the
-- missing document are the view's columns, and the totals it states per year (head rows, flagged rows and dollars, rows and dollars missing a
-- document) are the same counts books_year_gate R12 reports, over the same rows.
--
-- ATTACHED DOCUMENTS. The office's Add documents flow can carry a row as its link target: the file lands as a financial document with one cell,
-- supports_record_<first 24 characters of the record's source key>, whose value names the year, the record (local_id, source_key, the document that
-- holds it), what the owner says the file is (doc_kind) and the exact citation text (ref) that would clear the flag. The reader reports those cells
-- beside the row (attached). The row stays flagged until the books writer cites the document in the decision's proof_links
-- (scripts/books/pending_attachments.py prepares that correction for scripts/books/schedule_c_rulings.py correct), because the decision's source
-- document is too large for the browser's writer: the page says "waiting to be linked", never "done".
--
-- books_gate_context is what scripts/books/books_year_gate_check.py --record stores beside a run: the denominators the gate states only as text
-- (the year's deduction dollars, the deductions with no bank line, those with no payment proof and no owner ruling = rule R10 part b, and the head
-- rule R12 tests). It is read in the same repeatable-read transaction as the gate, so the numbers are the book the gate saw.
--
-- SECURITY INVOKER over v_books_large_sums, v_financial_accounting_records and the document tables: the book's row policies bound every read. The
-- reader refuses anyone but the owner (42501), so a signed-in stranger or the accounting reviewer is told no instead of being handed an empty list.
-- EXECUTE to authenticated and service_role (the reader) and service_role only (the context). Cost on prod (read-only, 2026-10-29, as the owner role):
-- the view 2.6 to 3.1 s, the keyed record read 0.5 s, the attachment read 0.02 s; the authenticated cap is 15 s.
-- CONTRACT. supabase/sql/test_books_large_sum_rows.sql (synthetic data; stranger, reviewer and anon negative controls).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.books_large_sum_rows(p_owner_id uuid, p_per_year integer DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_summary jsonb;
  v_rows jsonb;
  v_records jsonb;
  v_attached jsonb;
BEGIN
  IF p_owner_id IS NULL OR coalesce(p_per_year, 0) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'an owner and 1 to 300 rows per year are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF auth.uid() IS DISTINCT FROM p_owner_id AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'the large sums are the owner''s alone' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Phase 1: the view, once. Per year the totals; then the flagged head rows (the rows rule R12 tests), largest first, at most p_per_year a year.
  WITH ls AS MATERIALIZED (
    SELECT x.* FROM public.v_books_large_sums x WHERE x.owner_id = p_owner_id AND x.kind = 'deduction'
  ), flagged AS MATERIALIZED (
    SELECT l.* FROM ls l WHERE l.in_head AND (l.proof_flag IS NOT NULL OR l.missing_doc)
  ), yr AS (
    SELECT l.year,
           max(l.year_usd) AS year_usd, count(*) AS deductions_n,
           count(*) FILTER (WHERE l.in_head) AS head_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE l.in_head), 0), 2) AS head_usd,
           count(*) FILTER (WHERE l.in_head AND (l.proof_flag IS NOT NULL OR l.missing_doc)) AS flagged_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE l.in_head AND (l.proof_flag IS NOT NULL OR l.missing_doc)), 0), 2) AS flagged_usd,
           count(*) FILTER (WHERE l.in_head AND l.missing_doc) AS missing_doc_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE l.in_head AND l.missing_doc), 0), 2) AS missing_doc_usd,
           count(*) FILTER (WHERE l.in_head AND l.proof_flag = 'no_payment_proof') AS no_payment_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE l.in_head AND l.proof_flag = 'no_payment_proof'), 0), 2) AS no_payment_usd,
           count(*) FILTER (WHERE l.in_head AND l.proof_flag = 'filed_return_only') AS filed_return_only_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE l.in_head AND l.proof_flag = 'filed_return_only'), 0), 2) AS filed_return_only_usd,
           -- below the 80% line: not tested by R12, counted so the owner can see what lies beyond
           count(*) FILTER (WHERE NOT l.in_head AND l.missing_doc) AS beyond_head_missing_doc_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE NOT l.in_head AND l.missing_doc), 0), 2) AS beyond_head_missing_doc_usd
    FROM ls l GROUP BY l.year
  ), pick AS MATERIALIZED (
    SELECT q.* FROM (
      SELECT f.*, row_number() OVER (PARTITION BY f.year ORDER BY abs(f.amount) DESC, f.local_id, f.id) AS rn FROM flagged f
    ) q WHERE q.rn <= p_per_year
  )
  SELECT
    coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.year DESC) FROM yr y), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'year', p.year, 'id', p.id, 'document_id', p.document_id, 'local_id', p.local_id, 'dollar_rank', p.dollar_rank,
        'amount', p.amount, 'share', p.share, 'cum_share', p.cum_share, 'category', p.category, 'tier', p.tier,
        'pay_proof', p.pay_proof, 'doc_proof', p.doc_proof, 'basis_strength', p.basis_strength, 'proof_flag', p.proof_flag,
        'required_doc_kind', p.required_doc_kind, 'required_doc_rule', p.required_doc_rule, 'missing_doc', p.missing_doc,
        'doc_found_n', p.doc_found_n, 'doc_cited_n', p.doc_cited_n,
        -- what the row already cites as a document, as written (at most five, each bounded)
        'cites', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', c.value->>'kind', 'ref', left(coalesce(c.value->>'ref', ''), 160)))
                           FROM (SELECT value FROM jsonb_array_elements(p.document_cites) LIMIT 5) c), '[]'::jsonb))
      ORDER BY p.year DESC, p.rn) FROM pick p), '[]'::jsonb)
  INTO v_summary, v_rows;

  -- Phase 2: the records of those rows, a keyed read of the records view (joined to the large-sums view in one statement the planner would
  -- read the view again per row). The trimmed record is the shape the office's evidence dialog and records table take.
  SELECT coalesce(jsonb_object_agg(r.id::text, jsonb_build_object(
      'record_kind', r.record_kind, 'local_id', r.local_id, 'year', r.year, 'date', r.record_date, 'account', r.account, 'section', r.section,
      'category', r.category, 'amount', r.amount, 'currency', r.currency, 'description', left(r.description, 600), 'status', left(r.status, 200),
      'source_key', r.source_key)), '{}'::jsonb)
  INTO v_records
  FROM public.v_financial_accounting_records r
  WHERE r.owner_id = p_owner_id AND r.id = ANY (ARRAY(SELECT (x.value->>'id')::uuid FROM jsonb_array_elements(v_rows) x));

  -- Phase 3: the documents the owner attached to those rows. A cell counts only when it names the record it sits under.
  SELECT coalesce(jsonb_object_agg(a.source_key, a.items), '{}'::jsonb)
  INTO v_attached
  FROM (
    SELECT e.value_normalized->'value'->>'source_key' AS source_key,
           jsonb_agg(jsonb_build_object('document_id', e.document_id, 'filename', d.source_filename,
                                        'doc_kind', e.value_normalized->'value'->>'doc_kind', 'ref', e.value_normalized->'value'->>'ref',
                                        'attached_at', e.created_at) ORDER BY e.created_at, e.id) AS items
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = e.owner_id
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key LIKE 'supports\_record\_%'
      -- keyed by the record it names: a cell filed under one record's key that names another is not evidence for either
      AND e.field_key = 'supports_record_' || left(e.value_normalized->'value'->>'source_key', 24)
      AND e.value_normalized->'value'->>'source_key' = ANY (ARRAY(SELECT rec.value->>'source_key' FROM jsonb_each(v_records) rec))
    GROUP BY 1
  ) a;

  RETURN jsonb_build_object(
    'reader', 'books_large_sum_rows', 'owner_id', p_owner_id, 'read_at', now(),
    'years', coalesce((
      SELECT jsonb_agg(s.value || jsonb_build_object('rows_shown', coalesce(rs.n, 0), 'rows', coalesce(rs.items, '[]'::jsonb)) ORDER BY s.value->>'year' DESC)
      FROM jsonb_array_elements(v_summary) s
      LEFT JOIN LATERAL (
        SELECT count(*) AS n,
               jsonb_agg(r.value || jsonb_build_object(
                 'record', v_records -> (r.value->>'id'),
                 'attached', coalesce(v_attached -> (v_records -> (r.value->>'id') ->> 'source_key'), '[]'::jsonb)) ORDER BY r.ord) AS items
        FROM jsonb_array_elements(v_rows) WITH ORDINALITY r(value, ord)
        WHERE r.value->>'year' = s.value->>'year' AND v_records ? (r.value->>'id')
      ) rs ON true), '[]'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION public.books_large_sum_rows(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_large_sum_rows(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.books_large_sum_rows(uuid, integer) IS
  'The large sums rule R12 flags, for the owner only (42501 for anyone else, the accounting reviewer included): per tax year the totals (year_usd, head_n and head_usd, flagged_n and flagged_usd, missing_doc_n and missing_doc_usd, rows with no payment proof, rows resting only on the filed return, and the missing documents below the 80% line that R12 does not test) and the flagged head rows of v_books_large_sums, largest dollars first, at most p_per_year a year: the flags and the document the row''s kind requires as the view states them, what the row already cites, the record the office''s evidence dialog opens, and any document the owner attached to the row (supports_record cells). Reads the view once (about 3 s on prod), so call it once. SECURITY INVOKER; the book''s row policies apply. Migration 20261106140000.';

CREATE OR REPLACE FUNCTION public.books_gate_context(p_owner_id uuid, p_year integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH t AS MATERIALIZED (
    SELECT x.amount, x.pay_proof, x.has_owner_ruling, x.structural_rule
    FROM public.v_books_audit_tiers x WHERE x.owner_id = p_owner_id AND x.year = p_year::text AND x.is_deduction
  ), l AS MATERIALIZED (
    SELECT x.amount, x.in_head, x.year_usd FROM public.v_books_large_sums x WHERE x.owner_id = p_owner_id AND x.year = p_year::text AND x.kind = 'deduction'
  )
  SELECT jsonb_build_object(
    -- the denominator of the tiers and of rule R10: the year's deduction decisions and their dollars
    'deductions', jsonb_build_object('n', (SELECT count(*) FROM t), 'usd', (SELECT round(coalesce(sum(amount), 0), 2) FROM t)),
    -- deductions with no linked bank line, whatever else supports them
    'no_bank', jsonb_build_object('n', (SELECT count(*) FROM t WHERE NOT pay_proof), 'usd', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM t WHERE NOT pay_proof)),
    -- rule R10 part b: no payment proof, no owner ruling and no structural rule
    'no_pay_no_ruling', jsonb_build_object(
      'n', (SELECT count(*) FROM t WHERE NOT pay_proof AND NOT has_owner_ruling AND structural_rule IS NULL),
      'usd', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM t WHERE NOT pay_proof AND NOT has_owner_ruling AND structural_rule IS NULL)),
    -- the head rule R12 tests: the smallest set of the year's largest deductions that reaches 80% of the year's deduction dollars
    'head', jsonb_build_object('n', (SELECT count(*) FROM l WHERE in_head), 'usd', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM l WHERE in_head),
                               'year_usd', (SELECT max(year_usd) FROM l)))
$$;
REVOKE ALL ON FUNCTION public.books_gate_context(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.books_gate_context(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.books_gate_context(uuid, integer) IS
  'The denominators a stored books_year_gate run keeps (books_gate_runs.context): the year''s deduction decisions and dollars, the deductions with no linked bank line, those with no payment proof, no owner ruling and no structural rule (rule R10 part b), and the head of the year''s largest deductions that rule R12 tests (rows, dollars, the year''s dollars). Read by scripts/books/books_year_gate_check.py --record in the same repeatable-read transaction as the gate. SECURITY INVOKER, EXECUTE for service_role only. Migration 20261106140000.';
