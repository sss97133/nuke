-- books_year_gate: the links of R2 and R4 are read by id, not tested across every pair; the first statement plans without nested loops.
--
-- Timing the live function block by block (2024, read-only on prod, 2026-10-29) put 39 of its 49 seconds in its first statement, and 31 of those
-- in one CTE: r2lk, the movements tied to a decision (R2). It joined every bank movement to every decision with "m.links ? d.id OR d.links ? m.id",
-- then joined every tied decision to every other decision with "d2.links ?| ARRAY(...)": millions of jsonb tests. R4 did the same pairwise test twice
-- (r4 and r4n). Here the link ids of each side are unnested once (mvd, dcm, r2dl) and joined on the id.
--
-- An equi-join alone does not help: the statement reads its rows from jsonb_to_recordset(v_recs), which the planner sizes at 100 rows whatever v_recs
-- holds (about 10,000), so it keeps choosing nested loops. The function turns enable_nestloop off for that one statement and puts it back right
-- after, so the joins on ids run as hash joins.
--
-- Same rule semantics. r2lk, r4 and r4n return the same rows as before (set-compared in both directions for 2022 to 2025, and over synthetic rows that
-- cover each branch) and books_year_gate returns the same JSON for 2022 to 2025. Every other line of the function is the one 20261105160000 left on
-- main. Timings and row counts are in the pull request.

SET lock_timeout = '90s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.books_year_gate(p_owner_id uuid, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_cr jsonb;
  v_eic jsonb;
  v_okc text[] := '{}';
  v_failc text[] := '{}';
  v_nac text[] := '{}';
  v_diff numeric := 0;
  v_x numeric;
  v_y numeric;
  v_r10 jsonb;
  v_nl text;
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
      'account', coalesce(c.record->>'account', ''), 'cur', coalesce(nullif(upper(c.record->>'currency'), ''), 'USD'), 'section', coalesce(c.record->>'section', ''), 'category', coalesce(c.record->>'category', ''),
      'amount', CASE WHEN c.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (c.record->>'amount')::numeric END,
      'payee', lower(regexp_replace(coalesce(c.record->>'description', ''), '[^A-Za-z0-9]', '', 'g')),
      'srckey', coalesce(c.record->>'source_key', ''),
      'links', CASE WHEN jsonb_typeof(c.record->'bank_links') = 'array' THEN c.record->'bank_links' ELSE '[]' END,
      'doc', c.id)), '[]')
    INTO v_recs
  FROM public.accounting_current_records(p_owner_id) c
  WHERE c.record->>'year' BETWEEN (p_year - 1)::text AND (p_year + 1)::text
    AND c.record->>'record_kind' IN ('retained_bank_movement', 'retained_ledger_decision');

  -- One typed row set for every rule.
  -- The rows come from jsonb_to_recordset(v_recs), which the planner sizes at 100 rows whatever v_recs holds (about 10,000), so it picks nested loops for joins that are
  -- thousands by thousands. Nested loops are off for this one statement (put back right after it); the joins in it are on ids, which hash joins serve.
  v_nl := current_setting('enable_nestloop');
  PERFORM set_config('enable_nestloop', 'off', true);
  WITH x AS (
    SELECT t.*, CASE WHEN t.category LIKE 'Schedule C line %' THEN trim(split_part(substr(t.category, 17), ':', 1))
                     ELSE v_map->>(t.section || '|' || t.category) END AS line
    FROM jsonb_to_recordset(v_recs) AS t(id text, kind text, year text, date date, account text, section text, category text, cur text,
                                         amount numeric, payee text, srckey text, links jsonb, doc uuid)
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
  -- R2 / R2i. Tied decisions: a decision linked to the movement in either direction, plus decisions that share a
  -- bank link or source key with it (a superseding decision keeps the superseded one's links).
  -- The link ids of both sides, unnested once. A movement and a decision are tied when either names the other; the rules below join on the id (a hash join)
  -- where they used to test "links ? id" across every movement and decision pair, which took most of the gate's time.
  mvd AS MATERIALIZED (
    SELECT m.id AS mid, m.year AS myear, e.v #>> '{}' AS did
    FROM mv m CROSS JOIN LATERAL jsonb_array_elements(m.links) AS e(v) WHERE jsonb_typeof(e.v) = 'string'
  ),
  dcm AS MATERIALIZED (
    SELECT d.id AS did, e.v #>> '{}' AS mid
    FROM dc d CROSS JOIN LATERAL jsonb_array_elements(d.links) AS e(v) WHERE jsonb_typeof(e.v) = 'string'
  ),
  r2tp AS MATERIALIZED (
    -- Tied pairs, with the columns of the decision that the second and third parts of r2lk need.
    SELECT k.mid, d.id AS did, d.section AS dsec, d.amount AS damt, d.year AS dyear, d.srckey AS dsrc, d.links AS dlinks
    FROM mvd k JOIN dc d ON d.id = k.did
    UNION
    SELECT m.id, d.id, d.section, d.amount, d.year, d.srckey, d.links
    FROM dcm k JOIN dc d ON d.id = k.did JOIN mv m ON m.id = k.mid
  ),
  r2dl AS MATERIALIZED (
    -- Each decision's own bank link ids, one row per id (strings only, as the ?| operator reads them).
    SELECT d.id AS did, d.year AS dyear, d.section AS dsec, d.amount AS damt, e.v #>> '{}' AS link
    FROM dc d CROSS JOIN LATERAL jsonb_array_elements(d.links) AS e(v) WHERE jsonb_typeof(e.v) = 'string'
  ),
  r2lk AS (
    SELECT p.mid, p.did, p.dsec, p.damt FROM r2tp p
    UNION
    -- decisions of the same year that share the source key of a tied decision
    SELECT p.mid, d2.id, d2.section, d2.amount
    FROM r2tp p JOIN dc d2 ON d2.id <> p.did AND d2.year = p.dyear AND p.dsrc <> '' AND d2.srckey = p.dsrc
    UNION
    -- decisions of the same year that carry one of the bank links of a tied decision
    SELECT p.mid, l.did, l.dsec, l.damt
    FROM r2tp p CROSS JOIN LATERAL jsonb_array_elements_text(p.dlinks) AS pl(link)
    JOIN r2dl l ON l.link = pl.link AND l.did <> p.did AND l.dyear = p.dyear
  ),
  r2c AS (
    SELECT m.*, (m.payee LIKE '%dividendearned%') AS is_div,
           (m.payee LIKE '%reversalofgeneralaccounthold%' OR m.payee LIKE '%holdrelease%') AS is_hold
    FROM mv m WHERE m.year = v_year AND m.amount > 0 AND m.section <> 'Revenue'
  ),
  r2i AS (
    SELECT m.id, m.amount, m.cur FROM r2c m
    WHERE m.is_div AND NOT EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id)
  ),
  r2 AS (
    SELECT m.id, m.amount, m.cur FROM r2c m
    WHERE NOT m.is_div
      -- 1. same account, same currency, exact opposite row within 7 days (hold/release, funding leg, reversal);
      --    a hold reversal may trail its hold by weeks and drift by FX or rounding: 30 days, 3% plus a cent
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account = m.account AND o.cur = m.cur
                        AND o.amount = -m.amount AND o.date BETWEEN m.date - 7 AND m.date + 7)
      AND NOT (m.is_hold AND EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account = m.account AND o.cur = m.cur
                        AND o.amount < 0 AND abs(o.amount + m.amount) <= 0.03 * m.amount + 0.01
                        AND o.date BETWEEN m.date - 30 AND m.date + 30))
      -- 2. other account, same currency, within 7 days, tolerance max($1, 3%) for fees
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.account <> m.account AND o.cur = m.cur
                        AND o.amount < 0 AND abs(o.amount + m.amount) <= greatest(1, 0.03 * m.amount)
                        AND o.date BETWEEN m.date - 7 AND m.date + 7)
      -- 4. currency conversion: opposite sign, other currency, within 2 days, within 10% of the amount at an
      --    approximate EUR/USD reference rate of 1.08 (2024-2025 traded between 1.03 and 1.15)
      AND NOT EXISTS (SELECT 1 FROM mv o WHERE o.id <> m.id AND o.cur <> m.cur AND o.amount < 0
                        AND abs(o.amount) BETWEEN 0.9 * m.amount * (CASE WHEN m.cur = 'EUR' AND o.cur = 'USD' THEN 1.08
                                                                       WHEN m.cur = 'USD' AND o.cur = 'EUR' THEN 1 / 1.08 ELSE 1 END)
                                              AND 1.1 * m.amount * (CASE WHEN m.cur = 'EUR' AND o.cur = 'USD' THEN 1.08
                                                                       WHEN m.cur = 'USD' AND o.cur = 'EUR' THEN 1 / 1.08 ELSE 1 END)
                        AND o.date BETWEEN m.date - 2 AND m.date + 2)
      -- 3. booked revenue (directly or through a superseding decision), or a negative Expense decision (refund)
      AND NOT EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id AND (k.dsec = 'Revenue' OR (k.dsec = 'Expense' AND k.damt < 0)))
      -- 6. Financing, Owner, Clearing and Transfer movements tied to a decision (the decision carries the ruling)
      AND NOT (m.section IN ('Financing', 'Owner', 'Clearing', 'Transfer')
               AND (jsonb_array_length(m.links) > 0 OR EXISTS (SELECT 1 FROM r2lk k WHERE k.mid = m.id)))
      -- 5. credit-line draws in Transfer or Financing (credit-union line of credit; PayPal Credit draw)
      AND NOT (m.section IN ('Transfer', 'Financing')
               AND (m.payee LIKE '%fromlineofcredit%' OR m.payee LIKE '%bmlcredittransferfrombml%'))
  ),
  -- R3
  dcx AS (
    SELECT d.*,
           coalesce((SELECT array_agg(m.id) FROM mv m WHERE m.links ? d.id), '{}') AS mvs,
           coalesce((SELECT array_agg(l) FROM jsonb_array_elements_text(d.links) l), '{}') AS bls
    FROM dc d WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND d.amount <> 0 AND d.payee <> ''
  ),
  r3c AS (
    SELECT a.id AS aid, b.id AS bid, a.amount,
           EXISTS (SELECT 1 FROM mv m WHERE m.links ? a.id AND m.links ? b.id AND abs(a.amount) + abs(b.amount) > abs(m.amount) + 0.005) AS over_mv,
           (a.mvs && b.mvs) AS share_mv,
           (a.bls && b.bls) AS share_bl,
           (a.srckey <> '' AND a.srckey = b.srckey) AS same_key,
           (cardinality(a.mvs) > 0 AND cardinality(b.mvs) > 0 AND NOT (a.mvs && b.mvs)) AS diff_mv,
           (cardinality(a.bls) > 0 AND cardinality(b.bls) > 0 AND NOT (a.bls && b.bls)) AS diff_bl
    FROM dcx a JOIN dcx b ON a.id < b.id AND a.amount = b.amount AND a.payee = b.payee
     AND abs(a.date - b.date) <= 2 AND a.section = b.section
  ),
  r3 AS (
    SELECT aid || ' = ' || bid AS id, amount FROM r3c
    WHERE over_mv OR share_bl OR same_key OR NOT (share_mv OR diff_mv OR diff_bl)
  ),
  -- R4
  r4 AS (
    SELECT DISTINCT d.id, d.amount FROM dc d JOIN mvd k ON k.did = d.id
    WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND k.myear <> d.year
  ),
  r4n AS (SELECT count(DISTINCT d.id) AS n FROM dc d JOIN mvd k ON k.did = d.id WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense')),
  -- Register inputs: current use cells of the books register inputs original (use:<year>:<key>) for R7.
  rcells AS MATERIALIZED (
    SELECT e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'books-register-inputs.txt'
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key ~ '^use:'
      AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
  ),
  -- R6: each line 13 decision traces to register assets; each asset-year's MACRS computation equals what the decisions carry.
  -- One implementation: v_books_asset_register, which v_books_audit_tiers also reads.
  r6src AS MATERIALIZED (
    SELECT a.kind, a.local_id, a.amount FROM public.v_books_asset_register a WHERE a.owner_id = p_owner_id AND a.year = v_year
  ),
  r6 AS (
    SELECT s6.local_id AS id, s6.amount FROM r6src s6 WHERE s6.kind <> 'claim'
  ),
  -- R7: each line 20b or line 30 (home use) decision belongs to a stored use group whose base times percentage equals it.
  l20 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line IN ('20b', '30') AND d.amount <> 0),
  ru AS (
    SELECT u.v->>'key' AS k, (u.v->>'base')::numeric AS base, (u.v->>'pct')::numeric AS pct,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(u.v->'decisions')), '{}') AS dids
    FROM rcells u WHERE u.field_key LIKE 'use:' || v_year || ':%'
  ),
  ruc AS (
    SELECT ru.*, round(ru.base * ru.pct, 2) AS expected,
           (SELECT coalesce(sum(d.amount), 0) FROM dc d WHERE d.year = v_year AND d.id = ANY(ru.dids)) AS booked
    FROM ru
  ),
  r7 AS (
    SELECT l.id, l.amount FROM l20 l WHERE NOT EXISTS (SELECT 1 FROM ru WHERE l.id = ANY(ru.dids))
    UNION ALL
    SELECT c.k || ': decisions carry ' || c.booked || ', stored percentage x base is ' || c.expected, abs(c.booked - c.expected)
    FROM ruc c WHERE abs(c.booked - c.expected) > 0.005
  ),
  pop AS (
    SELECT count(*) FILTER (WHERE kind = 'retained_bank_movement') AS movements,
           count(*) FILTER (WHERE kind = 'retained_bank_movement' AND amount > 0 AND section <> 'Revenue' AND payee NOT LIKE '%dividendearned%') AS credits,
           count(*) FILTER (WHERE kind = 'retained_bank_movement' AND amount > 0 AND section <> 'Revenue' AND payee LIKE '%dividendearned%') AS dividends,
           count(*) FILTER (WHERE kind = 'retained_ledger_decision' AND section IN ('Revenue', 'Expense')) AS sc
    FROM x WHERE year = v_year
  )
  SELECT jsonb_build_array(
    (SELECT jsonb_build_object('rule', 'R1', 'title', 'every money movement has one treatment from the closed list',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT movements FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r1 ORDER BY abs(amount) DESC NULLS LAST LIMIT 100) q)) FROM r1),
    (SELECT jsonb_build_object('rule', 'R2', 'title', 'every credit is proven not income: counterpart, booked revenue, refund, conversion, credit-line draw or ruling',
       'n', count(*), 'amount', round(coalesce(sum(amount) FILTER (WHERE cur = 'USD'), 0), 2), 'of', (SELECT credits FROM pop),
       'by_currency', (SELECT coalesce(jsonb_object_agg(q.cur, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                         (SELECT cur, count(*) AS n, round(sum(amount), 2) AS a FROM r2 GROUP BY cur) q),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r2 ORDER BY amount DESC LIMIT 100) q)) FROM r2),
    (SELECT jsonb_build_object('rule', 'R2i', 'title', 'credit-union share dividends are interest income (Schedule B): a decision is tied to each',
       'n', count(*), 'amount', round(coalesce(sum(amount) FILTER (WHERE cur = 'USD'), 0), 2), 'of', (SELECT dividends FROM pop),
       'detail', 'taxable interest, not Schedule C revenue and not a transfer; fails until a decision records each dividend',
       'by_currency', (SELECT coalesce(jsonb_object_agg(q.cur, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                         (SELECT cur, count(*) AS n, round(sum(amount), 2) AS a FROM r2i GROUP BY cur) q),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r2i ORDER BY amount DESC LIMIT 100) q)) FROM r2i),
    (SELECT jsonb_build_object('rule', 'R3', 'title', 'no amount counted twice (same amount and full description within 2 days, not separate bank movements)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT sc FROM pop),
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r3 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r3),
    (SELECT jsonb_build_object('rule', 'R4', 'title', 'cash method: paid in the year it is booked',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT n FROM r4n),
       'detail', 'assessed only where a bank movement links to the decision; ' || ((SELECT sc FROM pop) - (SELECT n FROM r4n)) || ' Schedule C decisions have no linked payment and are not assessed',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r4 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r4),
    (SELECT jsonb_build_object('rule', 'R6', 'title', 'depreciation only from an asset register (cost, in-service date, class, MACRS table)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(DISTINCT local_id) FROM r6src WHERE kind IN ('claim', 'unclaimed')),
       'detail', (SELECT count(DISTINCT local_id) FROM r6src WHERE kind IN ('claim', 'unclaimed')) || ' line 13 decisions; each must trace to a register asset whose MACRS computation equals what the decisions carry (v_books_asset_register)',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r6 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r6),
    (SELECT jsonb_build_object('rule', 'R7', 'title', 'mixed use carries a stored business percentage with its source (decisions equal percentage x base)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(*) FROM l20),
       'detail', (SELECT count(*) FROM l20) || ' line 20b / line 30 decisions, ' || (SELECT count(*) FROM ru) || ' stored use groups; each decision must sit in a group whose stored percentage x base equals the decisions',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r7 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r7)
  ) INTO v_bad;
  PERFORM set_config('enable_nestloop', v_nl, true);
  FOR r IN SELECT value AS v FROM jsonb_array_elements(v_bad) LOOP
    v_rules := v_rules || jsonb_build_array((r.v - 'ids' - 'idlist') || jsonb_build_object(
      'status', CASE WHEN (r.v->>'n')::int = 0 THEN 'pass' ELSE 'fail' END, 'ids', r.v->'idlist'));
  END LOOP;

  -- R5: evidence grade of each Expense decision of $75 or more (accounting_decision_proof, the close-out's own flags).
  -- Grades: A statement and receipt, B statement only, C receipt only, R owner ruling with structured proof links and
  -- neither statement nor receipt (visible, not failing), D nothing (fails).
  SELECT jsonb_build_object('rule', 'R5', 'title', 'every expense of $75 or more has evidence; grade D (no statement, no receipt, no ruling) fails; grade R (ruling only) is counted apart',
      'n', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling),
      'amount', round(coalesce(sum(p.amount) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling), 0), 2), 'of', count(*),
      'ruling_only', jsonb_build_object('n', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling),
         'amount', round(coalesce(sum(p.amount) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling), 0), 2)),
      'grades', jsonb_build_object(
         'A', count(*) FILTER (WHERE p.has_statement AND p.has_receipt), 'B', count(*) FILTER (WHERE p.has_statement AND NOT p.has_receipt),
         'C', count(*) FILTER (WHERE p.has_receipt AND NOT p.has_statement),
         'R', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND p.has_ruling),
         'D', count(*) FILTER (WHERE NOT p.has_statement AND NOT p.has_receipt AND NOT p.has_ruling)),
      'ids', coalesce((SELECT jsonb_agg(q.lid) FROM (SELECT p2.record->>'local_id' AS lid FROM public.accounting_decision_proof(p_owner_id) p2
          WHERE p2.year = v_year AND p2.section = 'Expense' AND p2.amount >= 75 AND NOT p2.has_statement AND NOT p2.has_receipt AND NOT p2.has_ruling
          ORDER BY p2.amount DESC LIMIT 100) q), '[]'))
    INTO v_bad
  FROM public.accounting_decision_proof(p_owner_id) p
  WHERE p.year = v_year AND p.section = 'Expense' AND p.amount >= 75;
  v_rules := v_rules || jsonb_build_array(v_bad || jsonb_build_object('status', CASE WHEN (v_bad->>'n')::int = 0 THEN 'pass' ELSE 'fail' END));

  -- R8: SE tax recomputed from line 31 (92.35%, 12.4% + 2.9%, rounded per line as the forms do); credits and GILTI
  -- are recomputed in R8b from the stored credit inputs.
  SELECT sum((v->>'31')::numeric) INTO v_net FROM jsonb_each(v_state->'schedule_c') AS e(k, v);
  v_ne := round(coalesce(v_net, 0) * 0.9235);
  v_se := CASE WHEN v_ne >= 400 THEN round(v_ne * 0.124) + round(v_ne * 0.029) ELSE 0 END;
  v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8a', 'title', 'SE tax computed from Schedule C line 31',
    'status', CASE WHEN v_res->>'se_tax' IS NULL THEN 'not_assessed' WHEN abs((v_res->>'se_tax')::numeric - v_se) <= (CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN 1 ELSE 0 END) THEN 'pass' ELSE 'fail' END,
    'n', CASE WHEN v_res->>'se_tax' IS NOT NULL AND abs((v_res->>'se_tax')::numeric - v_se) > (CASE WHEN coalesce((v_res->>'whole_dollars')::boolean, false) THEN 1 ELSE 0 END) THEN 1 ELSE 0 END,
    'amount', CASE WHEN v_res->>'se_tax' IS NOT NULL THEN (v_res->>'se_tax')::numeric - v_se END,
    'detail', format('line 31 %s, net earnings %s, computed SE tax %s; return SE tax %s%s', v_net, v_ne, v_se, coalesce(v_res->>'se_tax', 'not stored'),
      CASE WHEN v_res ? 'se_base_used' THEN format(' (return used a base of %s)', v_res->>'se_base_used') ELSE '' END),
    'ids', '[]'::jsonb));
  -- R8b: credits and GILTI recomputed from the stored credit inputs where the inputs exist; what cannot be recomputed
  -- (an EIC input that is not stored, GILTI without CFC figures) is not_assessed, and a recomputation that differs is a finding.
  SELECT e.value_normalized->'value' INTO v_cr
  FROM public.financial_document_extractions e
  JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'books-register-inputs.txt'
  WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'credit:' || v_year
    AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
  ORDER BY e.created_at DESC LIMIT 1;
  IF v_cr IS NULL THEN
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8b', 'title', 'EIC, CTC/ACTC and GILTI recomputed from stored inputs',
      'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no credit inputs stored for this year', 'ids', '[]'::jsonb));
  ELSE
    -- EIC: eligibility gates first, then the amount from the IRS table (books_eic_recompute); the cell's own EIC is the claim.
    v_eic := public.books_eic_recompute(v_cr, p_year);
    IF v_eic->>'status' = 'pass' THEN
      v_okc := v_okc || format('EIC %s recomputed (%s)', v_eic->>'claimed', v_eic->>'reason');
    ELSIF v_eic->>'status' = 'differs' THEN
      v_failc := v_failc || format('EIC claimed %s, recomputed %s (%s)', v_eic->>'claimed', v_eic->>'computed', v_eic->>'reason');
      v_diff := v_diff + abs((v_eic->>'claimed')::numeric - (v_eic->>'computed')::numeric);
    ELSE
      v_nac := v_nac || format('EIC (%s)', v_eic->>'reason');
    END IF;
    -- ACTC: least(per-child cap x children, 15% of earned income over 2,500, child credit less the nonrefundable part).
    IF v_cr ?& ARRAY['earned_income', 'children', 'ctc_per_child', 'actc_cap_per_child', 'ctc_nonref', 'actc'] THEN
      v_x := least((v_cr->>'children')::numeric * (v_cr->>'actc_cap_per_child')::numeric,
                   round(0.15 * greatest((v_cr->>'earned_income')::numeric - 2500, 0)),
                   (v_cr->>'children')::numeric * (v_cr->>'ctc_per_child')::numeric - (v_cr->>'ctc_nonref')::numeric);
      IF abs(v_x - (v_cr->>'actc')::numeric) <= 1 THEN v_okc := v_okc || format('ACTC %s recomputed', v_cr->>'actc');
      ELSE v_failc := v_failc || format('ACTC stored %s, recomputed %s', v_cr->>'actc', v_x); v_diff := v_diff + abs(v_x - (v_cr->>'actc')::numeric); END IF;
    ELSE
      v_nac := v_nac || 'ACTC (earned income not stored)'::text;
    END IF;
    -- Result: payments + refundable credits - total tax equals the stored result (refund positive, owe negative).
    IF v_cr ?& ARRAY['payments_other', 'total_tax', 'eic', 'actc'] AND v_res ? 'amount' AND v_res ? 'result' THEN
      v_x := (v_cr->>'payments_other')::numeric + (v_cr->>'eic')::numeric + (v_cr->>'actc')::numeric - (v_cr->>'total_tax')::numeric;
      v_y := CASE WHEN v_res->>'result' = 'owe' THEN -(v_res->>'amount')::numeric ELSE (v_res->>'amount')::numeric END;
      IF abs(v_x - v_y) <= 1 THEN v_okc := v_okc || format('result %s recomputed', v_y);
      ELSE v_failc := v_failc || format('stored result %s, recomputed from stored credits %s', v_y, v_x); v_diff := v_diff + abs(v_x - v_y); END IF;
    ELSE
      v_nac := v_nac || 'result (payments or total tax not stored)'::text;
    END IF;
    -- GILTI: tested income less net deemed tangible income return, when the CFC figures are stored.
    IF v_cr ? 'gilti_claimed' THEN
      IF v_cr ?& ARRAY['gilti_tested_income', 'gilti_net_dtir'] THEN
        v_x := (v_cr->>'gilti_tested_income')::numeric - (v_cr->>'gilti_net_dtir')::numeric;
        IF abs(v_x - (v_cr->>'gilti_claimed')::numeric) <= 1 THEN v_okc := v_okc || format('GILTI %s recomputed', v_cr->>'gilti_claimed');
        ELSE v_failc := v_failc || format('GILTI stored %s, recomputed %s', v_cr->>'gilti_claimed', v_x); v_diff := v_diff + abs(v_x - (v_cr->>'gilti_claimed')::numeric); END IF;
      ELSE
        v_nac := v_nac || format('GILTI %s (no CFC figures stored)', v_cr->>'gilti_claimed');
      END IF;
    END IF;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', 'R8b', 'title', 'EIC, CTC/ACTC and GILTI recomputed from stored inputs',
      'status', CASE WHEN cardinality(v_failc) > 0 THEN 'fail' WHEN cardinality(v_nac) > 0 THEN 'not_assessed' ELSE 'pass' END,
      'n', cardinality(v_failc), 'amount', CASE WHEN cardinality(v_failc) > 0 THEN round(v_diff, 2) END,
      'of', cardinality(v_okc) + cardinality(v_failc) + cardinality(v_nac),
      'detail', 'recomputed ok: ' || coalesce(nullif(array_to_string(v_okc, '; '), ''), 'none') || ' | differs: ' || coalesce(nullif(array_to_string(v_failc, '; '), ''), 'none')
                || ' | not assessed: ' || coalesce(nullif(array_to_string(v_nac, '; '), ''), 'none'),
      'ids', to_jsonb(v_failc)));
  END IF;

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

  -- R10: audit-proof tiers of the year's deductions (v_books_audit_tiers, read once). Fails on (a) a section 274 item that needs a receipt
  -- (lodging, or $75 or more) and has no document and is not recorded as a caveat, or (b) a deduction with no payment proof and
  -- no owner ruling. The tier rollup is always reported; tier B is split into B with a bank line and B with no bank line (asset
  -- register, owner ruling), and the rows outside the deduction denominator are reported by rule. A year with no deduction decisions is not assessed.
  WITH ta AS MATERIALIZED (SELECT * FROM public.v_books_audit_tiers WHERE owner_id = p_owner_id AND year = v_year),
  t AS MATERIALIZED (SELECT * FROM ta WHERE is_deduction),
  bad AS (
    SELECT t.local_id, t.amount, (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) AS no_receipt,
           (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL) AS no_pay_no_ruling
    FROM t WHERE (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) OR (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL)
  ),
  agg AS (
    SELECT count(*) AS n, round(coalesce(sum(amount), 0), 2) AS usd,
           round(coalesce(sum(amount) FILTER (WHERE tier = 'A'), 0), 2) AS a_usd, round(coalesce(sum(amount) FILTER (WHERE tier = 'B'), 0), 2) AS b_usd,
           round(coalesce(sum(amount) FILTER (WHERE tier = 'C'), 0), 2) AS c_usd,
           count(*) FILTER (WHERE tier = 'B' AND NOT pay_proof) AS bn_n, round(coalesce(sum(amount) FILTER (WHERE tier = 'B' AND NOT pay_proof), 0), 2) AS bn_usd
    FROM t
  ),
  xc AS (SELECT count(*) AS n, round(coalesce(sum(amount), 0), 2) AS usd FROM ta WHERE NOT is_deduction)
  SELECT CASE WHEN (SELECT n FROM agg) = 0 THEN
      jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), bank line plus cited allocation basis (B), or a cited asset register or owner ruling with no bank line (B, reported apart)',
        'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no Expense decisions for this year', 'ids', '[]'::jsonb)
    ELSE jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), bank line plus cited allocation basis (B), or a cited asset register or owner ruling with no bank line (B, reported apart)',
      'status', CASE WHEN (SELECT count(*) FROM bad) = 0 THEN 'pass' ELSE 'fail' END,
      'n', (SELECT count(*) FROM bad), 'amount', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM bad), 'of', (SELECT n FROM agg),
      'detail', format('of %s deduction decisions totalling %s: A %s (%s%%), B %s (%s%%; %s on %s rows have no bank line: asset register or owner ruling), C %s (%s%%); %s section 274 items need a receipt and have none and no caveat, %s deductions have no payment proof and no owner ruling; %s further rows (%s) are outside the deduction denominator',
        (SELECT n FROM agg), (SELECT usd FROM agg),
        (SELECT a_usd FROM agg), (SELECT round(100 * a_usd / nullif(usd, 0), 1) FROM agg),
        (SELECT b_usd FROM agg), (SELECT round(100 * b_usd / nullif(usd, 0), 1) FROM agg), (SELECT bn_usd FROM agg), (SELECT bn_n FROM agg),
        (SELECT c_usd FROM agg), (SELECT round(100 * c_usd / nullif(usd, 0), 1) FROM agg),
        (SELECT count(*) FROM bad WHERE no_receipt), (SELECT count(*) FROM bad WHERE no_pay_no_ruling), (SELECT n FROM xc), (SELECT usd FROM xc)),
      'tiers', (SELECT jsonb_object_agg(k.tier, jsonb_build_object('n', k.n, 'amount', k.a)) FROM
                  (SELECT tier, count(*) AS n, round(sum(amount), 2) AS a FROM t GROUP BY tier) k),
      'b_no_bank', jsonb_build_object('n', (SELECT bn_n FROM agg), 'amount', (SELECT bn_usd FROM agg),
                  'by_rule', (SELECT coalesce(jsonb_object_agg(q.r, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                                (SELECT structural_rule AS r, count(*) AS n, round(sum(amount), 2) AS a FROM t WHERE tier = 'B' AND NOT pay_proof GROUP BY structural_rule) q)),
      'excluded', jsonb_build_object('n', (SELECT n FROM xc), 'amount', (SELECT usd FROM xc),
                  'by_rule', (SELECT coalesce(jsonb_object_agg(q.r, jsonb_build_object('n', q.n, 'amount', q.a)), '{}') FROM
                                (SELECT structural_rule AS r, count(*) AS n, round(sum(amount), 2) AS a FROM ta WHERE NOT is_deduction GROUP BY structural_rule) q)),
      'ids', (SELECT coalesce(jsonb_agg(q.local_id), '[]') FROM (SELECT local_id FROM bad ORDER BY abs(amount) DESC LIMIT 100) q))
    END
  INTO v_r10;
  v_rules := v_rules || jsonb_build_array(v_r10);

  -- R11: direction of every linked decision (v_books_direction_links; v_books_direction_checks is its wrong_way rows). A decision is tested when a
  -- movement of any register is tied to it, by the decision's own bank_links or by the movement's link back to the decision. It fails when no tied
  -- movement goes the right way (an Expense decision is money out, a Revenue decision money in); a card-funding, hold or refund leg beside a
  -- right-way link is not an error, and negative decisions are not tested. The decisions whose bank_links name a bank line that no register holds
  -- are counted apart as not assessed, with their dollars.
  WITH dl AS MATERIALIZED (
    SELECT l.* FROM public.v_books_direction_links l WHERE l.owner_id = p_owner_id AND l.year = v_year
  ),
  w AS (SELECT * FROM dl WHERE status = 'wrong_way'),
  un AS (SELECT * FROM dl WHERE status = 'unresolved'),
  s AS (
    SELECT (SELECT count(DISTINCT decision_id) FROM dl WHERE status <> 'unresolved') AS tested,
           (SELECT count(*) FROM dl WHERE status <> 'unresolved') AS pairs,
           (SELECT count(*) FROM dl WHERE via = 'decision_link') AS p_dec, (SELECT count(*) FROM dl WHERE via = 'movement_link') AS p_mov,
           (SELECT count(*) FROM dl WHERE via = 'both') AS p_both,
           (SELECT count(*) FROM un) AS un_n, (SELECT round(coalesce(sum(decision_usd), 0), 2) FROM un) AS un_usd,
           (SELECT count(DISTINCT x.id) FROM un CROSS JOIN LATERAL jsonb_array_elements_text(un.link_ids) AS x(id)) AS un_links,
           (SELECT count(DISTINCT decision_id) FROM w) AS n,
           (SELECT round(coalesce(sum(q.usd), 0), 2) FROM (SELECT DISTINCT ON (decision_id) decision_usd AS usd FROM w ORDER BY decision_id) q) AS usd,
           (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT decision_id || ' -> ' || movement_id AS id FROM w ORDER BY decision_usd DESC, decision_id, movement_id LIMIT 100) q) AS ids,
           (SELECT coalesce(jsonb_object_agg(q.acct, jsonb_build_object('n', q.n, 'amount', q.a)), '{}')
              FROM (SELECT coalesce(decision_account, '-') AS acct, count(*) AS n, round(sum(decision_usd), 2) AS a FROM un GROUP BY 1) q) AS un_by_account,
           (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT decision_id AS id FROM un ORDER BY decision_usd DESC, decision_id LIMIT 100) q) AS un_ids,
           (SELECT string_agg(q.acct || ' ' || q.n || ' ' || q.a, ', ' ORDER BY q.a DESC, q.acct)
              FROM (SELECT coalesce(decision_account, '-') AS acct, count(*) AS n, round(sum(decision_usd), 2) AS a FROM un GROUP BY 1 ORDER BY sum(decision_usd) DESC LIMIT 3) q) AS un_top
  )
  SELECT jsonb_build_object('rule', 'R11', 'title', 'direction: every linked deduction is an outflow and every linked revenue an inflow',
      'status', CASE WHEN s.n > 0 THEN 'fail' WHEN s.tested = 0 THEN 'not_assessed' ELSE 'pass' END,
      'n', s.n, 'amount', s.usd, 'of', s.tested,
      'detail', format('%s linked decisions of the year: %s tested through %s decision-movement pairs (%s by the decision''s own link, %s by the bank line''s link back, %s by both), %s not assessed because no register holds the bank line they name (%s link ids, %s dollars%s); %s fail because no tied movement goes the right way; negative decisions are not tested',
        s.tested + s.un_n, s.tested, s.pairs, s.p_dec, s.p_mov, s.p_both, s.un_n, s.un_links, s.un_usd,
        CASE WHEN s.un_top IS NULL THEN '' ELSE '; largest accounts: ' || s.un_top END, s.n),
      'unresolved', jsonb_build_object('n', s.un_n, 'links', s.un_links, 'amount', s.un_usd, 'by_account', s.un_by_account, 'ids', s.un_ids),
      'ids', s.ids)
    INTO v_bad
  FROM s;
  v_rules := v_rules || jsonb_build_array(v_bad);

  -- R12: large sums carry proof (v_books_large_sums, kind deduction). The head is the smallest set of the year's largest deduction decisions
  -- whose dollars reach 80% of the year's deduction dollars (sum of absolute amounts). A head row is flagged when it has no bank line (or the
  -- register / ruling aggregate the audit tiers accept in its place), or no cited basis, or its only basis is the filed return and the
  -- QuickBooks category (proof_flag), or it misses the document its kind requires (missing_doc: a purchase agreement, bill of sale or title
  -- for a vehicle deal; an invoice or agreement; a receipt or order; the register asset; the lease or the ruling).
  WITH ls AS MATERIALIZED (
    SELECT t.* FROM public.v_books_large_sums t WHERE t.owner_id = p_owner_id AND t.year = v_year AND t.kind = 'deduction'
  ),
  hd AS (SELECT * FROM ls WHERE in_head),
  fl AS (SELECT hd.*, coalesce(hd.proof_flag, 'missing_doc') AS flag FROM hd WHERE hd.proof_flag IS NOT NULL OR hd.missing_doc),
  md AS (SELECT * FROM hd WHERE missing_doc),
  a AS (
    SELECT (SELECT count(*) FROM ls) AS total_n, (SELECT max(year_usd) FROM ls) AS year_usd,
           (SELECT count(*) FROM hd) AS head_n, (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM hd) AS head_usd,
           (SELECT count(*) FROM fl) AS n, (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM fl) AS usd,
           (SELECT round(coalesce(sum(abs(q.amount)), 0), 2) FROM (SELECT amount FROM fl ORDER BY abs(amount) DESC, local_id LIMIT 3) q) AS top3_usd,
           (SELECT string_agg(q.local_id || ' ' || q.amount || ' ' || q.flag, ', ' ORDER BY abs(q.amount) DESC, q.local_id)
              FROM (SELECT local_id, amount, flag FROM fl ORDER BY abs(amount) DESC, local_id LIMIT 3) q) AS top3,
           (SELECT string_agg(q.n || ' ' || q.f, ', ' ORDER BY q.f) FROM (SELECT flag AS f, count(*) AS n FROM fl GROUP BY flag) q) AS flags,
           (SELECT count(*) FROM md) AS miss_n, (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM md) AS miss_usd,
           (SELECT count(*) FROM md WHERE doc_cited_n = 0) AS miss_nodoc,
           (SELECT string_agg(q.local_id || ' ' || q.amount || ' ' || q.required_doc_kind, ', ' ORDER BY abs(q.amount) DESC, q.local_id)
              FROM (SELECT local_id, amount, required_doc_kind FROM md ORDER BY abs(amount) DESC, local_id LIMIT 3) q) AS miss_top3,
           (SELECT string_agg(q.n || ' ' || q.k || ' ' || q.a, ', ' ORDER BY q.a DESC, q.k)
              FROM (SELECT required_doc_kind AS k, count(*) AS n, round(sum(abs(amount)), 2) AS a FROM md GROUP BY required_doc_kind) q) AS miss_kinds
  )
  SELECT CASE WHEN a.total_n = 0 THEN
      jsonb_build_object('rule', 'R12', 'title', 'large sums carry proof: every decision in the head that covers 80% of the year''s deduction dollars has a bank line, a documented or ruled basis and the document its kind requires; a row whose only basis is the filed return and a QuickBooks category is flagged',
        'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no Expense decisions for this year', 'ids', '[]'::jsonb)
    ELSE jsonb_build_object('rule', 'R12', 'title', 'large sums carry proof: every decision in the head that covers 80% of the year''s deduction dollars has a bank line, a documented or ruled basis and the document its kind requires; a row whose only basis is the filed return and a QuickBooks category is flagged',
      'status', CASE WHEN a.n = 0 THEN 'pass' ELSE 'fail' END,
      'n', a.n, 'amount', a.usd, 'of', a.head_n,
      'detail', CASE WHEN a.n = 0 THEN
          format('head of %s of %s deduction decisions holds %s of %s deduction dollars (sum of absolute amounts); every head decision has a bank line (or the register or ruling the audit tiers accept in its place), a documented or ruled basis and the document its kind requires',
            a.head_n, a.total_n, a.head_usd, a.year_usd)
        ELSE
          format('head of %s of %s deduction decisions holds %s of %s deduction dollars (sum of absolute amounts); %s head decisions flagged holding %s (%s%% of the year): %s; largest flagged: %s, which hold %s%% of the year''s deduction dollars and %s%% of the flagged dollars; %s head decisions miss the document their kind requires (%s cite no document at all), %s%s',
            a.head_n, a.total_n, a.head_usd, a.year_usd, a.n, a.usd, round(100 * a.usd / nullif(a.year_usd, 0), 1), a.flags,
            a.top3, round(100 * a.top3_usd / nullif(a.year_usd, 0), 1), round(100 * a.top3_usd / nullif(a.usd, 0), 1),
            a.miss_n, a.miss_nodoc, a.miss_usd, CASE WHEN a.miss_n > 0 THEN ' (' || a.miss_kinds || '); largest missing: ' || a.miss_top3 ELSE '' END)
        END,
      'by_flag', (SELECT coalesce(jsonb_object_agg(q.f, jsonb_build_object('n', q.n, 'amount', q.a)), '{}')
                    FROM (SELECT flag AS f, count(*) AS n, round(sum(abs(amount)), 2) AS a FROM fl GROUP BY flag) q),
      'missing_doc', jsonb_build_object('n', a.miss_n, 'amount', a.miss_usd, 'cite_no_document', a.miss_nodoc,
                    'by_kind', (SELECT coalesce(jsonb_object_agg(q.k, jsonb_build_object('n', q.n, 'amount', q.a)), '{}')
                                  FROM (SELECT required_doc_kind AS k, count(*) AS n, round(sum(abs(amount)), 2) AS a FROM md GROUP BY required_doc_kind) q),
                    'ids', (SELECT coalesce(jsonb_agg(q.local_id), '[]') FROM (SELECT local_id FROM md ORDER BY abs(amount) DESC, local_id LIMIT 100) q)),
      'ids', (SELECT coalesce(jsonb_agg(q.local_id), '[]') FROM (SELECT local_id FROM fl ORDER BY abs(amount) DESC, local_id LIMIT 100) q))
    END
    INTO v_bad
  FROM a;
  v_rules := v_rules || jsonb_build_array(v_bad);

  RETURN jsonb_build_object('owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) x WHERE x->>'status' <> 'pass'),
    'failing', (SELECT coalesce(jsonb_agg(x->>'rule'), '[]') FROM jsonb_array_elements(v_rules) x WHERE x->>'status' = 'fail'),
    'rules', v_rules);
END $function$;
