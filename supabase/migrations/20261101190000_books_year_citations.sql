-- books_year_citations(owner, year): every Schedule C decision's citations on two axes, and the uncited work queue.
--
-- Owner rule (2026-10-26): no default stands as a judgment. A decision is 'cited' only with a payment proof and a
-- purpose proof; otherwise it is 'searching', and books_year_gate R10 fails on any searching row.
--   payment_proof  bank_card_line | cash_withdrawal | cash_receipt | none
--   purpose_proof  third_party_document | message | photo | vehicle_record | owner_testimony | inverse_search | none
--                  (strongest first; inverse_search is a recorded search proving absence)
-- Explicit citations win: cells 'citation:<local_id>' of the citations register (scripts/books/citations.py, written
-- through ingest_financial_evidence) carry {payment_proof, purpose_proof, citations: [{type positive|inverse, ref,
-- searched_sources, date}]}. Without one, the axes are derived from what the books already hold: the paying bank
-- movement (an ATM/cash withdrawal line counts as cash_withdrawal), the close-out's receipt flag and use cell vehicle,
-- and keyed references in the decision text (Gmail ids, Apple message ids, Photos asset ids, dated owner rulings).
-- Returns per year: positive / inverse-only / uncited (count and dollars), the payment x purpose dollar table, cash
-- expenses lacking either side, and the first 200 searching ids. Reads only. SECURITY INVOKER.
-- books_year_gate is redefined below with rule R10 on these citations.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.books_year_citations(p_owner_id uuid, p_year integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH explicit AS MATERIALIZED (
    SELECT substr(e.field_key, 10) AS local_id, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'citations-register.txt'
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key LIKE 'citation:%'
      AND NOT coalesce((e.value_normalized->'value'->>'retired')::boolean, false)
  ), mv AS MATERIALIZED (
    SELECT c.record->>'local_id' AS id, coalesce(c.record->>'description', '') AS descr,
           CASE WHEN jsonb_typeof(c.record->'bank_links') = 'array' THEN c.record->'bank_links' ELSE '[]' END AS links
    FROM public.accounting_current_records(p_owner_id) c
    WHERE c.record->>'record_kind' = 'retained_bank_movement'
      AND c.record->>'year' BETWEEN (p_year - 1)::text AND (p_year + 1)::text
  ), dec AS MATERIALIZED (
    SELECT p.record->>'local_id' AS id, p.section, p.amount, p.has_statement, p.has_receipt, p.vehicle_id,
           coalesce(p.record->>'account', '') AS account,
           coalesce(p.record->>'decision', '') || ' ' || coalesce(p.record->>'description', '') || ' ' || coalesce(p.record->>'source_reference', '') AS txt
    FROM public.accounting_decision_proof(p_owner_id) p
    WHERE p.year = p_year::text AND p.section IN ('Revenue', 'Expense')
  ), paid AS MATERIALIZED (
    SELECT l.did AS id, bool_or(m.descr ~* '\m(ATM|cash withdrawal|withdrawal.*branch|branch withdrawal)\M') AS cash_line
    FROM mv m, jsonb_array_elements_text(m.links) AS l(did) GROUP BY 1
  ), derived AS (
    SELECT d.*, p.cash_line, p.id IS NOT NULL AS any_line FROM dec d LEFT JOIN paid p ON p.id = d.id
  ), classed AS (
    SELECT d.id, d.section, d.amount, x.v AS explicit,
      coalesce(x.v->>'payment_proof', CASE
        WHEN d.cash_line THEN 'cash_withdrawal'
        WHEN d.has_statement OR d.any_line OR d.txt ~* '(applecard:|bank:|paypal|card line|statement line)' THEN 'bank_card_line'
        WHEN d.txt ~* 'cash (from|receipt|sale)|paid from (the )?cash (sale|receipt)' THEN 'cash_receipt'
        ELSE 'none' END) AS payment_proof,
      coalesce(x.v->>'purpose_proof', CASE
        WHEN d.has_receipt OR d.txt ~* '\m(receipt|invoice|bill of sale|title|statement from|landlord)\M.*\.(pdf|jpe?g|png|heic)' THEN 'third_party_document'
        WHEN d.txt ~* '(gmail[ :]*[0-9a-f]{12,}|\m[0-9a-f]{16}\M|APPLE-MSG|imessage|marketplace message)' THEN 'message'
        WHEN d.txt ~* '([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}|photos? asset)' THEN 'photo'
        WHEN d.vehicle_id IS NOT NULL THEN 'vehicle_record'
        WHEN d.txt ~* '(owner (ruling|testimony|attest|said|confirmed)|per owner|owner [0-9]{1,2} [A-Z][a-z]{2}|owner, ?20[0-9]{2}-)' THEN 'owner_testimony'
        WHEN d.txt ~* '(searched|no (matching|hits|record found))' THEN 'inverse_search'
        ELSE 'none' END) AS purpose_proof,
      (d.account ~* 'cash' OR d.txt ~* '\mcash\M') AS cash_spend
    FROM derived d LEFT JOIN explicit x ON x.local_id = d.id
  ), graded AS (
    SELECT c.*,
      CASE WHEN c.purpose_proof IN ('third_party_document', 'message', 'photo', 'vehicle_record', 'owner_testimony') THEN 'positive'
           WHEN c.purpose_proof = 'inverse_search' THEN 'inverse_only' ELSE 'uncited' END AS citation,
      CASE WHEN c.purpose_proof = 'none' OR c.payment_proof = 'none' THEN 'searching' ELSE 'cited' END AS status
    FROM classed c
  )
  SELECT jsonb_build_object(
    'owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'population', jsonb_build_object('n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2)),
    'explicit', count(*) FILTER (WHERE explicit IS NOT NULL),
    'by_citation', (SELECT jsonb_object_agg(k.citation, jsonb_build_object('n', k.n, 'amount', k.amount)) FROM (
        SELECT citation, count(*) n, round(coalesce(sum(abs(amount)), 0), 2) amount FROM graded GROUP BY 1) k),
    'searching', jsonb_build_object('n', count(*) FILTER (WHERE status = 'searching'),
        'amount', round(coalesce(sum(abs(amount)) FILTER (WHERE status = 'searching'), 0), 2),
        'ids', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM graded WHERE status = 'searching' ORDER BY abs(amount) DESC NULLS LAST LIMIT 200) q)),
    'table', (SELECT coalesce(jsonb_agg(jsonb_build_object('payment_proof', t.payment_proof, 'purpose_proof', t.purpose_proof, 'n', t.n, 'amount', t.amount)
                                        ORDER BY t.amount DESC), '[]') FROM (
        SELECT payment_proof, purpose_proof, count(*) n, round(coalesce(sum(abs(amount)), 0), 2) amount FROM graded GROUP BY 1, 2) t),
    'cash_gaps', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount, 'payment_proof', g.payment_proof, 'purpose_proof', g.purpose_proof,
                                        'lacking', array_remove(ARRAY[CASE WHEN g.payment_proof NOT IN ('cash_withdrawal', 'cash_receipt') THEN 'cash source' END,
                                                                      CASE WHEN g.purpose_proof = 'none' THEN 'purpose' END], NULL)) ORDER BY abs(g.amount) DESC), '[]')
        FROM graded g WHERE g.section = 'Expense' AND g.cash_spend AND (g.payment_proof NOT IN ('cash_withdrawal', 'cash_receipt') OR g.purpose_proof = 'none')),
    'method', 'explicit citation cells first; otherwise derived from the paying movement, receipt flag, use-cell vehicle and keyed references in the decision text')
  FROM graded
$$;

REVOKE ALL ON FUNCTION public.books_year_citations(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_year_citations(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.books_year_citations(uuid, integer) IS
  'Per Schedule C decision: payment_proof x purpose_proof, positive / inverse-only / uncited totals, cash expenses lacking a side, searching ids. Reads only. SECURITY INVOKER.';

-- books_year_gate gains R10 (searching rows fail the year). Same body as 20261101180000 otherwise.
CREATE OR REPLACE FUNCTION public.books_year_gate(p_owner_id uuid, p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_year text := p_year::text;
  v_state jsonb;
  v_map jsonb;
  v_res jsonb;
  v_recs jsonb;
  v_rules jsonb := '[]';
  v_net numeric;
  v_ne numeric;
  v_se numeric;
  v_bad jsonb;
  r record;
BEGIN
  IF p_owner_id IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'owner and year required'; END IF;
  v_state := public.books_year_state(p_owner_id, p_year);
  SELECT e.value_normalized->'value' INTO v_map FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'return-facts-register.txt'
   WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'schedule_c_line_map' ORDER BY e.created_at DESC LIMIT 1;
  v_map := coalesce(v_map, '{}');
  SELECT f->'result' INTO v_res FROM jsonb_array_elements(v_state->'facts') f
   WHERE f->>'topic' = 'result' ORDER BY f->'result'->>'built_at' DESC LIMIT 1;

  -- Records of the year and its neighbours (a payment can sit in the year next to its decision).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.record->>'local_id', 'kind', c.record->>'record_kind', 'year', c.record->>'year',
      'date', CASE WHEN c.record->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN c.record->>'date' END,
      'account', coalesce(c.record->>'account', ''), 'section', coalesce(c.record->>'section', ''), 'category', coalesce(c.record->>'category', ''),
      'amount', CASE WHEN c.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (c.record->>'amount')::numeric END,
      'payee', left(lower(regexp_replace(coalesce(c.record->>'description', ''), '[^A-Za-z]', '', 'g')), 14),
      'links', CASE WHEN jsonb_typeof(c.record->'bank_links') = 'array' THEN c.record->'bank_links' ELSE '[]' END,
      'doc', c.id)), '[]')
    INTO v_recs
  FROM public.accounting_current_records(p_owner_id) c
  WHERE c.record->>'year' BETWEEN (p_year - 1)::text AND (p_year + 1)::text
    AND c.record->>'record_kind' IN ('retained_bank_movement', 'retained_ledger_decision');

  -- One typed row set for every rule.
  WITH x AS (
    SELECT t.*, CASE WHEN t.category LIKE 'Schedule C line %' THEN trim(split_part(substr(t.category, 17), ':', 1))
                     ELSE v_map->>(t.section || '|' || t.category) END AS line
    FROM jsonb_to_recordset(v_recs) AS t(id text, kind text, year text, date date, account text, section text, category text,
                                         amount numeric, payee text, links jsonb, doc uuid)
  ),
  mv AS (SELECT * FROM x WHERE kind = 'retained_bank_movement'),
  dc AS (SELECT * FROM x WHERE kind = 'retained_ledger_decision'),
  -- R1
  r1 AS (
    SELECT m.id, m.amount FROM mv m
    WHERE m.year = v_year AND NOT (
      m.section IN ('Revenue', 'Transfer', 'Financing', 'Owner', 'Clearing')
      OR (m.section = 'Expense' AND (m.line IS NOT NULL OR EXISTS (
            SELECT 1 FROM dc d WHERE d.links ? m.id OR m.links ? d.id AND d.line IS NOT NULL))))
  ),
  -- R2
  r2 AS (
    SELECT m.id, m.amount FROM mv m
    WHERE m.year = v_year AND m.amount > 0 AND m.section <> 'Revenue'
      AND NOT (m.section IN ('Financing', 'Owner', 'Clearing', 'Transfer') AND jsonb_array_length(m.links) > 0)
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.amount = -m.amount AND o.account <> m.account
                        AND o.date BETWEEN m.date - 3 AND m.date + 3)
  ),
  -- R3
  r3 AS (
    SELECT a.id || ' = ' || b.id AS id, a.amount FROM dc a JOIN dc b
      ON a.id < b.id AND a.amount = b.amount AND a.payee = b.payee AND a.payee <> ''
     AND abs(a.date - b.date) <= 2 AND a.section = b.section
    WHERE a.year = v_year AND b.year = v_year AND a.section IN ('Revenue', 'Expense') AND a.amount <> 0
  ),
  -- R4
  r4 AS (
    SELECT DISTINCT d.id, d.amount FROM dc d JOIN mv m ON m.links ? d.id
    WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND m.year <> d.year
  ),
  r4n AS (SELECT count(DISTINCT d.id) AS n FROM dc d JOIN mv m ON m.links ? d.id WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense')),
  r6 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line = '13' AND d.amount <> 0),
  r7 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line = '20b' AND d.amount <> 0),
  pop AS (
    SELECT count(*) FILTER (WHERE kind = 'retained_bank_movement') AS movements,
           count(*) FILTER (WHERE kind = 'retained_bank_movement' AND amount > 0 AND section <> 'Revenue') AS credits,
           count(*) FILTER (WHERE kind = 'retained_ledger_decision' AND section IN ('Revenue', 'Expense')) AS sc
    FROM x WHERE year = v_year
  )
  SELECT jsonb_build_array(
    (SELECT jsonb_build_object('rule', 'R1', 'title', 'every money movement has one treatment from the closed list',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT movements FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r1 ORDER BY abs(amount) DESC NULLS LAST LIMIT 100) q)) FROM r1),
    (SELECT jsonb_build_object('rule', 'R2', 'title', 'every credit is revenue unless a counterpart or document proves otherwise',
       'n', count(*), 'amount', round(coalesce(sum(amount), 0), 2), 'of', (SELECT credits FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r2 ORDER BY amount DESC LIMIT 100) q)) FROM r2),
    (SELECT jsonb_build_object('rule', 'R3', 'title', 'no amount counted twice (same amount and payee within 2 days)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT sc FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r3 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r3),
    (SELECT jsonb_build_object('rule', 'R4', 'title', 'cash method: paid in the year it is booked',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT n FROM r4n),
       'detail', 'assessed only where a bank movement links to the decision; ' || ((SELECT sc FROM pop) - (SELECT n FROM r4n)) || ' Schedule C decisions have no linked payment and are not assessed',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r4 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r4),
    (SELECT jsonb_build_object('rule', 'R6', 'title', 'depreciation only from an asset register (cost, in-service date, class, MACRS table)',
       'n', count(*), 'amount', round(coalesce(sum(amount), 0), 2),
       'detail', 'the books hold no asset register; every line 13 amount is a hand number until one exists',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r6 LIMIT 100) q)) FROM r6),
    (SELECT jsonb_build_object('rule', 'R7', 'title', 'mixed use carries a stored business percentage per month with its source',
       'n', count(*), 'amount', round(coalesce(sum(amount), 0), 2),
       'detail', 'no monthly business-use percentages are stored; the rent percentage is a yearly return fact',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r7 LIMIT 100) q)) FROM r7)
  ) INTO v_bad;
  FOR r IN SELECT value AS v FROM jsonb_array_elements(v_bad) LOOP
    v_rules := v_rules || jsonb_build_array((r.v - 'ids' - 'idlist') || jsonb_build_object(
      'status', CASE WHEN (r.v->>'n')::int = 0 THEN 'pass' ELSE 'fail' END, 'ids', r.v->'idlist'));
  END LOOP;

  -- R5: evidence grade of each Expense decision of $75 or more (accounting_decision_proof, the close-out's own flags).
  SELECT jsonb_build_object('rule', 'R5', 'title', 'every expense of $75 or more has evidence; grade D (no statement, no receipt) fails',
      'n', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt),
      'amount', round(coalesce(sum(p.amount) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt), 0), 2), 'of', count(*),
      'grades', jsonb_build_object(
         'A', count(*) FILTER (WHERE p.has_statement AND p.has_receipt), 'B', count(*) FILTER (WHERE p.has_statement AND NOT p.has_receipt),
         'C', count(*) FILTER (WHERE p.has_receipt AND NOT p.has_statement), 'D', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt)),
      'ids', coalesce((SELECT jsonb_agg(q.lid) FROM (SELECT p2.record->>'local_id' AS lid FROM public.accounting_decision_proof(p_owner_id) p2
          WHERE p2.year = v_year AND p2.section = 'Expense' AND p2.amount >= 75 AND NOT p2.has_statement AND NOT p2.has_receipt
          ORDER BY p2.amount DESC LIMIT 100) q), '[]'))
    INTO v_bad
  FROM public.accounting_decision_proof(p_owner_id) p
  WHERE p.year = v_year AND p.section = 'Expense' AND p.amount >= 75;
  v_rules := v_rules || jsonb_build_array(v_bad || jsonb_build_object('status', CASE WHEN (v_bad->>'n')::int = 0 THEN 'pass' ELSE 'fail' END));

  -- R8: SE tax recomputed from line 31 (92.35%, 12.4% + 2.9%, rounded per line as the forms do); credits and GILTI
  -- have no stored typed inputs, so they cannot be computed here.
  SELECT sum((v->>'31')::numeric) INTO v_net FROM jsonb_each(v_state->'schedule_c') AS e(k, v);
  v_ne := round(coalesce(v_net, 0) * 0.9235);
  v_se := CASE WHEN v_ne >= 400 THEN round(v_ne * 0.124) + round(v_ne * 0.029) ELSE 0 END;
  v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8a', 'title', 'SE tax computed from Schedule C line 31',
    'status', CASE WHEN v_res->>'se_tax' IS NULL THEN 'not_assessed' WHEN (v_res->>'se_tax')::numeric = v_se THEN 'pass' ELSE 'fail' END,
    'n', CASE WHEN v_res->>'se_tax' IS NOT NULL AND (v_res->>'se_tax')::numeric <> v_se THEN 1 ELSE 0 END,
    'amount', CASE WHEN v_res->>'se_tax' IS NOT NULL THEN (v_res->>'se_tax')::numeric - v_se END,
    'detail', format('line 31 %s, net earnings %s, computed SE tax %s; return SE tax %s%s', v_net, v_ne, v_se, coalesce(v_res->>'se_tax', 'not stored'),
      CASE WHEN v_res ? 'se_base_used' THEN format(' (return used a base of %s)', v_res->>'se_base_used') ELSE '' END),
    'ids', '[]'::jsonb));
  v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8b', 'title', 'EIC, CTC/ACTC and GILTI computed from stored inputs',
    'status', 'fail', 'n', 3, 'amount', NULL,
    'detail', 'not computable in the books: AGI, the residency day table and the CFC calendar-year figures are not stored as typed inputs; the results come from local builders',
    'ids', '[]'::jsonb));

  -- R9: every Schedule C line on the stored return result equals the DB total.
  IF v_res IS NULL OR NOT v_res ? 'schedule_c' THEN
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R9', 'title', 'return lines equal the DB totals', 'status', 'not_assessed',
      'n', 0, 'amount', NULL, 'detail', 'no return lines stored with the result', 'ids', '[]'::jsonb));
  ELSE
    WITH cmp AS (
      SELECT s.key AS sched, l.key AS line, (l.value #>> '{}')::numeric AS ret,
             coalesce((v_state->'schedule_c'->s.key->>l.key)::numeric, 0) AS db
      FROM jsonb_each(v_res->'schedule_c') s, jsonb_each(s.value) l
    ), bad AS (
      SELECT * FROM cmp WHERE CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN abs(ret - round(db)) > 1 ELSE abs(ret - db) > 0.005 END
    )
    SELECT jsonb_build_object('rule', 'R9', 'title', 'return lines equal the DB totals', 'n', (SELECT count(*) FROM bad), 'of', (SELECT count(*) FROM cmp),
      'amount', (SELECT round(coalesce(sum(abs(ret - db)), 0), 2) FROM bad),
      'status', CASE WHEN (SELECT count(*) FROM bad) = 0 THEN 'pass' ELSE 'fail' END,
      'ids', (SELECT coalesce(jsonb_agg(format('%s line %s: return %s, DB %s', sched, line, ret, db)), '[]') FROM bad))
      INTO v_bad;
    v_rules := v_rules || jsonb_build_array(v_bad);
  END IF;

  -- R10: no default stands as a judgment (owner, 2026-10-26): a decision lacking a payment proof or a purpose proof is
  -- 'searching' (books_year_citations), and any searching row fails the year at filing time.
  v_bad := public.books_year_citations(p_owner_id, p_year);
  v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R10', 'title', 'every decision carries a payment proof and a purpose proof (no default stands)',
    'status', CASE WHEN (v_bad->'searching'->>'n')::int = 0 THEN 'pass' ELSE 'fail' END,
    'n', (v_bad->'searching'->>'n')::int, 'of', (v_bad->'population'->>'n')::int, 'amount', (v_bad->'searching'->>'amount')::numeric,
    'detail', format('positive %s, inverse-only %s, uncited %s', coalesce(v_bad->'by_citation'->'positive', '{}'), coalesce(v_bad->'by_citation'->'inverse_only', '{}'), coalesce(v_bad->'by_citation'->'uncited', '{}')),
    'ids', (SELECT coalesce(jsonb_agg(i), '[]') FROM (SELECT i FROM jsonb_array_elements(v_bad->'searching'->'ids') i LIMIT 100) q)));

  RETURN jsonb_build_object('owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) x WHERE x->>'status' <> 'pass'),
    'failing', (SELECT coalesce(jsonb_agg(x->>'rule'), '[]') FROM jsonb_array_elements(v_rules) x WHERE x->>'status' = 'fail'),
    'rules', v_rules);
END $$;

REVOKE ALL ON FUNCTION public.books_year_gate(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_year_gate(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.books_year_gate(uuid, integer) IS
  'Hard rules on one tax year of the books (R1-R10): pass/fail per rule with counts, dollars and the first 100 failing ids. Reads only. SECURITY INVOKER.';
