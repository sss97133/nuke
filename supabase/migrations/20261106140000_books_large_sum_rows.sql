-- books_large_sum_rows(owner): the large sums rule R12 flags, as rows the owner can act on; books_gate_context(owner, year): the denominators a stored gate run keeps;
-- v_books_record_attachments: the papers the owner added for a row, with the one test that says a paper counts.
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
-- holds it), what the owner says the file is (doc_kind) and the exact citation text (ref) that would clear the flag. v_books_record_attachments is the
-- one place that says when such a cell counts (current, and keyed by the record it names: a cell filed under one record's key that names another is
-- evidence for neither); the reader reports those documents beside the row (attached) and scripts/books/pending_attachments.py reads the same view.
-- The row stays flagged until the books writer cites the document in the decision's proof_links (pending_attachments.py prepares that correction for
-- scripts/books/schedule_c_rulings.py correct), because the decision's source document is too large for the browser's writer: the page says
-- "waiting to be linked", never "done". DECISION FOR THE BOOKS LANE (not made here): v_books_large_sums and accounting_record_evidence read documents
-- from the decision's side (proof_links, vehicle documents, use groups; the expense_items_* and bank_corroboration cells). Adding this view as one more
-- document source of v_books_large_sums, and as via 'attached' in accounting_record_evidence.artifacts, would clear a row the moment its paper is
-- added, and show the file in the evidence dialog, with no citation step. That changes rule R12, so it is the books lane's to rule.
--
-- books_gate_context is what scripts/books/books_year_gate_check.py --record stores beside a run: the denominators the gate states only as text
-- (the year's deduction dollars, the deductions with no bank line, those with no payment proof and no owner ruling = rule R10 part b, and the head
-- rule R12 tests). It is read in the same repeatable-read transaction as the gate, so the numbers are the book the gate saw. The deduction, no-bank
-- and part-b dollars are NET of credits, the same basis as v_books_audit_tier_years (deduction_usd, no_pay_no_ruling_usd), so the page can set a
-- stored figure beside the live one; the head and the year's dollars are ABSOLUTE amounts, the basis rule R12 reads.
--
-- SECURITY INVOKER over v_books_large_sums, v_financial_accounting_records and the document tables: the book's row policies bound every read. The
-- reader refuses anyone but the owner (42501), so a signed-in stranger or the accounting reviewer is told no instead of being handed an empty list.
-- EXECUTE to authenticated and service_role (the reader) and service_role only (the context). Cost on prod (read-only, 2026-10-29, as the owner role):
-- the view 2.6 to 3.1 s, the keyed record read 0.5 s, the attachment read 0.02 s; the authenticated cap is 15 s. Per year the reader also states the
-- head rows that miss a document by the kind of document and how many of them cite no document at all (the shape rule R12 stores), so the page's
-- totals are the live ones and agree with the rows listed below them.
-- CONTRACT. supabase/sql/test_books_large_sum_rows.sql (synthetic data; stranger, reviewer and anon negative controls).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- The papers the owner added for a row. One row per current cell that names the record it sits under.
CREATE OR REPLACE VIEW public.v_books_record_attachments WITH (security_invoker = true) AS
SELECT e.owner_id,
       e.value_normalized->'value'->>'source_key' AS source_key,
       e.document_id,
       d.source_filename AS filename,
       e.value_normalized->'value'->>'doc_kind' AS doc_kind,
       e.value_normalized->'value'->>'ref' AS ref,
       e.created_at AS attached_at
FROM public.financial_document_extractions e
JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = e.owner_id
WHERE NOT e.is_superseded AND e.field_key LIKE 'supports\_record\_%'
  -- keyed by the record it names: a cell filed under one record's key that names another is not evidence for either
  AND e.field_key = 'supports_record_' || left(e.value_normalized->'value'->>'source_key', 24);

COMMENT ON VIEW public.v_books_record_attachments IS
  'The papers the owner added for a row of the books through the Add documents flow: one row per current supports_record_<24> cell that names the record (source_key) it sits under, with the document that holds it, its file name, what the owner said it is (doc_kind) and the citation text that would clear the flag (ref). The one place that says when such a cell counts; read by books_large_sum_rows and scripts/books/pending_attachments.py. A paper received is not a paper cited: the decision still has to cite it in its proof_links before v_books_large_sums stops flagging the row. security_invoker.';
COMMENT ON COLUMN public.v_books_record_attachments.owner_id IS 'The book. Unit: none (key). Source: financial_document_extractions. Grain: one cell. Clock: current books.';
COMMENT ON COLUMN public.v_books_record_attachments.source_key IS 'The source key of the record the paper is for (the 64-hex key of the decision). Unit: none (key). Source: the cell''s value. Grain: one cell. Clock: current books.';
COMMENT ON COLUMN public.v_books_record_attachments.document_id IS 'The financial document that holds the paper. Unit: none (key). Source: financial_document_extractions. Grain: one cell. Clock: current books.';
COMMENT ON COLUMN public.v_books_record_attachments.filename IS 'The paper''s file name as uploaded. Unit: none (text). Source: financial_documents.source_filename. Grain: one cell. Clock: upload.';
COMMENT ON COLUMN public.v_books_record_attachments.doc_kind IS 'What the owner said the paper is, in the words the large-sum rules read (Invoice, Purchase agreement, Receipt ...). Unit: none (text). Source: the cell''s value. Grain: one cell. Clock: when added.';
COMMENT ON COLUMN public.v_books_record_attachments.ref IS 'The exact citation text (kind, file name, start of the hash) that would clear the flag if the decision cited it. Unit: none (text). Source: the cell''s value. Grain: one cell. Clock: when added.';
COMMENT ON COLUMN public.v_books_record_attachments.attached_at IS 'When the cell was written. Unit: timestamptz. Source: financial_document_extractions.created_at. Grain: one cell. Clock: when added.';
REVOKE ALL ON public.v_books_record_attachments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_books_record_attachments TO authenticated, service_role;

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
           -- the head rows that miss a document and cite no document at all (the shape rule R12 stores as cite_no_document)
           count(*) FILTER (WHERE l.in_head AND l.missing_doc AND l.doc_cited_n = 0) AS missing_doc_cite_no_document,
           -- below the 80% line: not tested by R12, counted so the owner can see what lies beyond
           count(*) FILTER (WHERE NOT l.in_head AND l.missing_doc) AS beyond_head_missing_doc_n,
           round(coalesce(sum(abs(l.amount)) FILTER (WHERE NOT l.in_head AND l.missing_doc), 0), 2) AS beyond_head_missing_doc_usd
    FROM ls l GROUP BY l.year
  ), bk AS (
    -- the head rows that miss a document, by the kind of document their rule requires: {kind: {n, amount}}, the shape rule R12 stores as by_kind
    SELECT l.year, jsonb_object_agg(l.required_doc_kind, jsonb_build_object('n', l.n, 'amount', l.usd)) AS by_kind
    FROM (SELECT x.year, x.required_doc_kind, count(*) AS n, round(sum(abs(x.amount)), 2) AS usd
          FROM ls x WHERE x.in_head AND x.missing_doc GROUP BY x.year, x.required_doc_kind) l
    GROUP BY l.year
  ), pick AS MATERIALIZED (
    SELECT q.* FROM (
      SELECT f.*, row_number() OVER (PARTITION BY f.year ORDER BY abs(f.amount) DESC, f.local_id, f.id) AS rn FROM flagged f
    ) q WHERE q.rn <= p_per_year
  )
  SELECT
    coalesce((SELECT jsonb_agg(to_jsonb(y) || jsonb_build_object('missing_doc_by_kind', coalesce(b.by_kind, '{}'::jsonb)) ORDER BY y.year DESC)
              FROM yr y LEFT JOIN bk b ON b.year = y.year), '[]'::jsonb),
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

  -- Phase 3: the documents the owner attached to those rows, from the one view that says when a cell counts.
  SELECT coalesce(jsonb_object_agg(a.source_key, a.items), '{}'::jsonb)
  INTO v_attached
  FROM (
    SELECT x.source_key,
           jsonb_agg(jsonb_build_object('document_id', x.document_id, 'filename', x.filename, 'doc_kind', x.doc_kind, 'ref', x.ref,
                                        'attached_at', x.attached_at) ORDER BY x.attached_at, x.document_id) AS items
    FROM public.v_books_record_attachments x
    WHERE x.owner_id = p_owner_id AND x.source_key = ANY (ARRAY(SELECT rec.value->>'source_key' FROM jsonb_each(v_records) rec))
    GROUP BY x.source_key
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
  'The large sums rule R12 flags, for the owner only (42501 for anyone else, the accounting reviewer included): per tax year the totals (year_usd, head_n and head_usd, flagged_n and flagged_usd, missing_doc_n and missing_doc_usd, rows with no payment proof, rows resting only on the filed return, the missing documents by kind of document and how many of them cite none, and the missing documents below the 80% line that R12 does not test) and the flagged head rows of v_books_large_sums, largest dollars first, at most p_per_year a year: the flags and the document the row''s kind requires as the view states them, what the row already cites, the record the office''s evidence dialog opens, and any document the owner attached to the row (v_books_record_attachments). Reads the view once (about 3 s on prod), so call it once. SECURITY INVOKER; the book''s row policies apply. Migration 20261106140000.';

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
    -- deductions with no linked bank line, whatever else supports them (net of credits, like deduction_usd)
    'no_bank', jsonb_build_object('n', (SELECT count(*) FROM t WHERE NOT pay_proof), 'usd', (SELECT round(coalesce(sum(amount), 0), 2) FROM t WHERE NOT pay_proof)),
    -- rule R10 part b: no payment proof, no owner ruling and no structural rule (net of credits: equals v_books_audit_tier_years.no_pay_no_ruling_usd)
    'no_pay_no_ruling', jsonb_build_object(
      'n', (SELECT count(*) FROM t WHERE NOT pay_proof AND NOT has_owner_ruling AND structural_rule IS NULL),
      'usd', (SELECT round(coalesce(sum(amount), 0), 2) FROM t WHERE NOT pay_proof AND NOT has_owner_ruling AND structural_rule IS NULL)),
    -- the head rule R12 tests: the smallest set of the year's largest deductions that reaches 80% of the year's deduction dollars (absolute amounts, as R12 reads them)
    'head', jsonb_build_object('n', (SELECT count(*) FROM l WHERE in_head), 'usd', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM l WHERE in_head),
                               'year_usd', (SELECT max(year_usd) FROM l)))
$$;
REVOKE ALL ON FUNCTION public.books_gate_context(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.books_gate_context(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.books_gate_context(uuid, integer) IS
  'The denominators a stored books_year_gate run keeps (books_gate_runs.context): the year''s deduction decisions and dollars, the deductions with no linked bank line, those with no payment proof, no owner ruling and no structural rule (rule R10 part b), all in dollars net of credits like v_books_audit_tier_years, and the head of the year''s largest deductions that rule R12 tests (rows, dollars, the year''s dollars; absolute amounts, as R12 reads them). Read by scripts/books/books_year_gate_check.py --record in the same repeatable-read transaction as the gate. SECURITY INVOKER, EXECUTE for service_role only. Migration 20261106140000.';
