-- books_year_state(owner, year): the settled state of one tax year, in one read.
--
-- Books and tax work starts here instead of local files. Returns jsonb (one value, so the PostgREST 1,000-row cap
-- never cuts it):
--   schedule_c   per schedule, totals by Schedule C line from the current ledger records: ruling records carry their
--                line in the category ("Schedule C line 20b: ..."), legacy categories map through the
--                schedule_c_line_map cell of the return facts register (the map db-books/drift_check.py uses).
--                Line arithmetic matches scripts/books/schedule_c_rulings.py lines_by_schedule (24b at 50%).
--   rulings      every <year>-RULING-* record (local id, line, amount, decision text with its evidence, date)
--   facts        return-level facts of the year from the return facts register (scripts/books/return_facts.py):
--                filing status, residency, credits, CFC/GILTI, Form 5471, owner rulings, penalties
--   result       the newest return result: a tax_return_summary draft cell or a result fact, whichever was built later
--   open_items   facts with status open, each with what closes it
--   unmapped     ledger categories with no Schedule C line (should be empty; drift_check.py fails on them)
-- Writes nothing. SECURITY INVOKER like the other accounting readers: the book's row policies (owner and delegates
-- through accounting_readable_owners()) bound every read. EXECUTE to authenticated and service_role only.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.books_year_state(p_owner_id uuid, p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_year text := p_year::text;
  v_map jsonb;
  v_facts jsonb;
  v_rulings jsonb;
  v_raw jsonb;
  v_recs jsonb;
  v_unmapped jsonb;
  v_sched jsonb := '{}';
  v_draft jsonb;
  v_fact_result jsonb;
  v_result jsonb;
  r record;
  b jsonb;
  l1 numeric; l2 numeric; l4 numeric; l6 numeric; l7 numeric; l28 numeric; l30 numeric; meals numeric;
  v_lines jsonb;
  v_exp text[] := ARRAY['8','9','10','11','12','13','14','15','16a','16b','17','18','19','20a','20b','21','22','23','24a','25','26','27a'];
  k text;
BEGIN
  IF p_owner_id IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'owner and year required'; END IF;

  -- Current cells of the return facts register (one original per owner, superseded run by run).
  WITH cells AS MATERIALIZED (
    SELECT e.field_key, e.value_normalized->'value' AS v, e.value_normalized->'evidence' AS ev, e.created_at, e.document_id
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id
     AND d.source_filename = 'return-facts-register.txt'
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded
      AND (e.field_key = 'schedule_c_line_map' OR e.field_key LIKE 'fact:' || v_year || ':%')
  )
  SELECT (SELECT c.v FROM cells c WHERE c.field_key = 'schedule_c_line_map' ORDER BY c.created_at DESC LIMIT 1),
         coalesce((SELECT jsonb_agg(c.v || jsonb_build_object('source', c.ev->>'source', 'recorded_at', c.created_at, 'document_id', c.document_id)
                                    ORDER BY c.v->>'topic', c.v->>'key')
                   FROM cells c WHERE c.field_key LIKE 'fact:%' AND NOT coalesce((c.v->>'retired')::boolean, false)), '[]')
    INTO v_map, v_facts;
  v_map := coalesce(v_map, '{}');

  -- Current ledger decisions of the year.
  SELECT coalesce(jsonb_agg(jsonb_build_object('local_id', c.record->>'local_id', 'account', coalesce(c.record->>'account', ''),
           'section', c.record->>'section', 'category', c.record->>'category',
           'amount', CASE WHEN c.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (c.record->>'amount')::numeric END,
           'decision', c.record->>'decision', 'rdate', c.record->>'date', 'document_id', c.document_id)), '[]')
    INTO v_recs
  FROM public.accounting_current_records(p_owner_id) c
  WHERE c.record->>'year' = v_year AND c.record->>'record_kind' = 'retained_ledger_decision'
    AND c.record->>'section' IN ('Revenue', 'Expense');

  SELECT coalesce(jsonb_agg(jsonb_build_object('local_id', x.local_id, 'schedule', x.account,
           'line', split_part(substr(x.category, 17), ':', 1), 'label', x.category, 'amount', x.amount,
           'decision', x.decision, 'date', x.rdate, 'document_id', x.document_id) ORDER BY x.local_id), '[]')
    INTO v_rulings FROM jsonb_to_recordset(v_recs) AS x(local_id text, account text, section text, category text, amount numeric, decision text, rdate text, document_id uuid) WHERE x.local_id LIKE v_year || '-RULING-%';

  -- Line totals per schedule (ruling rows: their account names the schedule when it starts 'Schedule C').
  WITH tagged AS (
    SELECT CASE WHEN x.category LIKE 'Schedule C line %' AND x.account LIKE 'Schedule C%' THEN x.account ELSE 'Schedule C' END AS sched,
           CASE WHEN x.category LIKE 'Schedule C line %' THEN trim(split_part(substr(x.category, 17), ':', 1))
                ELSE v_map->>(x.section || '|' || x.category) END AS line,
           x.section, x.category, x.amount
    FROM jsonb_to_recordset(v_recs) AS x(local_id text, account text, section text, category text, amount numeric, decision text, rdate text, document_id uuid)
  )
  SELECT coalesce(jsonb_object_agg(s.sched, s.lines), '{}'),
         (SELECT coalesce(jsonb_agg(DISTINCT t.section || '|' || t.category), '[]') FROM tagged t WHERE t.line IS NULL)
    INTO v_raw, v_unmapped
  FROM (SELECT t.sched, jsonb_object_agg(t.line, t.total) AS lines
        FROM (SELECT sched, line, sum(amount) AS total FROM tagged WHERE line IS NOT NULL GROUP BY 1, 2) t GROUP BY 1) s;

  FOR r IN SELECT key AS sched, value AS lines FROM jsonb_each(v_raw) LOOP
    b := r.lines;
    l1 := coalesce((b->>'1')::numeric, 0); l2 := coalesce((b->>'2')::numeric, 0);
    l4 := coalesce((b->>'4')::numeric, 0); l6 := coalesce((b->>'6')::numeric, 0);
    l7 := l1 - l2 - l4 + l6;
    -- 50% of meals, rounded half-to-even to the cent like Python's Decimal.quantize in schedule_c_rulings.py
    meals := coalesce((b->>'24b')::numeric, 0) * 50;
    meals := round((CASE WHEN meals - floor(meals) = 0.5 AND mod(floor(meals), 2) = 0 THEN floor(meals) ELSE round(meals) END) / 100, 2);
    l28 := meals;
    v_lines := jsonb_build_object('1', l1, '2', l2, '3', l1 - l2, '4', l4, '5', l1 - l2 - l4, '6', l6, '7', l7);
    FOREACH k IN ARRAY v_exp LOOP
      IF coalesce((b->>k)::numeric, 0) <> 0 THEN
        v_lines := v_lines || jsonb_build_object(k, (b->>k)::numeric);
        l28 := l28 + (b->>k)::numeric;
      END IF;
    END LOOP;
    l30 := coalesce((b->>'30')::numeric, 0);
    v_lines := v_lines || jsonb_build_object('24b', meals, '24b_book', coalesce((b->>'24b')::numeric, 0), '28', l28,
      '29', l7 - l28, '30', l30, '31', l7 - l28 - l30);
    v_sched := v_sched || jsonb_build_object(r.sched, v_lines);
  END LOOP;

  -- Newest return result: the draft cell or a result fact, by build time.
  SELECT d.summary || jsonb_build_object('document_id', d.document_id, 'recorded_at', d.recorded_at, 'from', 'tax_return_summary')
    INTO v_draft FROM public.accounting_return_drafts(p_owner_id) d WHERE d.tax_year = v_year;
  SELECT f->'result' || jsonb_build_object('tax_year', v_year, 'local_id', f->>'local_id', 'source', f->>'source', 'from', 'return_fact')
    INTO v_fact_result FROM jsonb_array_elements(v_facts) f
   WHERE f->>'topic' = 'result' AND f->>'status' = 'settled' AND f ? 'result'
   ORDER BY f->'result'->>'built_at' DESC LIMIT 1;
  v_result := CASE
    WHEN v_fact_result IS NULL THEN v_draft
    WHEN v_draft IS NULL THEN v_fact_result
    WHEN (v_fact_result->>'built_at')::timestamptz > coalesce((v_draft->>'built_at')::timestamptz, '-infinity') THEN v_fact_result
    ELSE v_draft END;

  RETURN jsonb_build_object(
    'owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'result', v_result,
    'schedule_c', v_sched,
    'rulings', v_rulings,
    'facts', (SELECT coalesce(jsonb_agg(f), '[]') FROM jsonb_array_elements(v_facts) f WHERE f->>'status' <> 'open'),
    'open_items', (SELECT coalesce(jsonb_agg(f), '[]') FROM jsonb_array_elements(v_facts) f WHERE f->>'status' = 'open'),
    'unmapped', v_unmapped,
    'sources', jsonb_build_object(
      'schedule_c', 'accounting_current_records: retained_ledger_decision rows of the year, Revenue and Expense',
      'facts', 'return-facts-register.txt cells written by scripts/books/return_facts.py through ingest_financial_evidence',
      'result', 'newest of tax_return_summary (accounting_return_drafts) and the result fact, by built_at'));
END $$;

REVOKE ALL ON FUNCTION public.books_year_state(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_year_state(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.books_year_state(uuid, integer) IS
  'Settled state of one tax year as jsonb: Schedule C lines per schedule, rulings, return facts, newest return result, open items with what closes each. Books/tax work starts here. SECURITY INVOKER.';
