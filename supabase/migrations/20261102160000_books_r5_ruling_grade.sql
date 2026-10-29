-- R5 accepts owner rulings as a visible proof grade (owner, 2026-10-26).
--   1. project_financial_accounting_records keeps two new optional keys on an accounting record: ruling_id (text) and
--      proof_links ([{kind: owner_ruling|register|artifact|photo|gmail|file, ref}]). It rejected every unknown key before.
--   2. accounting_decision_proof gains has_ruling (ruling_id set and proof_links non-empty).
--   3. books_year_gate R5 fails only a decision with no statement, no receipt and no ruling. Ruling-only decisions
--      are counted apart as grade R (grades.R, ruling_only) so they stay visible. R6 and the other rules are unchanged.
-- accounting_closeout's own checklist (expense_no_proof) is unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.project_financial_accounting_records(p_owner_id uuid, p_document_id uuid, p_run_id uuid, p_records jsonb, p_prior uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE x jsonb; n integer; d financial_documents%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service admission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM financial_documents WHERE id=p_document_id AND owner_id=p_owner_id FOR UPDATE;
 IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE document_id=d.id AND owner_id=p_owner_id AND extraction_run_id=p_run_id) THEN RAISE EXCEPTION 'current extraction basis required'; END IF;
 IF p_records IS NULL THEN
  IF EXISTS(SELECT 1 FROM financial_document_lines WHERE document_id=d.id AND attributes->>'extraction_run_id'=p_prior::text AND attributes ? 'accounting_record') THEN RAISE EXCEPTION 'correction must explicitly carry accounting records'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)>100 THEN RAISE EXCEPTION 'invalid accounting record population'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_records))<>(SELECT count(DISTINCT v->>'source_key') FROM jsonb_array_elements(p_records) v) THEN RAISE EXCEPTION 'duplicate accounting source key'; END IF;
 SELECT coalesce(max(line_number),0) INTO n FROM financial_document_lines WHERE document_id=d.id;
 FOR x IN SELECT value FROM jsonb_array_elements(p_records) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('record_kind','source_key','source_sha256','source_row','local_id','year','date','account','currency','currency_basis','amount','section','category','description','decision','status','source_reference','bank_links','recognition_status','payment_status','vehicle_status','reimbursement_status','entity_status','ruling_id','proof_links'))
   OR coalesce(x->>'record_kind','') NOT IN ('retained_ledger_decision','retained_bank_movement')
   OR coalesce(x->>'source_key','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'source_sha256','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x->>'source_row','') !~ '^[0-9]{1,8}$'
   OR (x->>'source_row')::integer<1
   OR coalesce(length(x->>'local_id'),0) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'year','') !~ '^[0-9]{4}$'
   OR (x->>'date' IS NOT NULL AND x->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
   OR coalesce(x->>'currency','') !~ '^[A-Z]{3}$'
   OR coalesce(length(x->>'currency_basis'),0) NOT BETWEEN 1 AND 500
   OR (x->>'amount' IS NOT NULL AND (jsonb_typeof(x->'amount')<>'string' OR x->>'amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'))
   OR jsonb_typeof(x->'bank_links') IS DISTINCT FROM 'array'
   OR coalesce(x->>'recognition_status','') NOT IN ('retained_decision','not_applicable')
   OR x->>'payment_status' IS DISTINCT FROM 'unresolved'
   OR x->>'vehicle_status' IS DISTINCT FROM 'unresolved'
   OR x->>'reimbursement_status' IS DISTINCT FROM 'unresolved'
   OR x->>'entity_status' IS DISTINCT FROM 'retained_scope_unallocated'
   -- ruling_id: short text; proof_links: up to 20 {kind, ref} objects from the closed list
   OR (x ? 'ruling_id' AND (jsonb_typeof(x->'ruling_id')<>'string' OR length(x->>'ruling_id') NOT BETWEEN 1 AND 200))
   OR (x ? 'proof_links' AND (jsonb_typeof(x->'proof_links')<>'array' OR jsonb_array_length(x->'proof_links')>20
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'proof_links') l
          WHERE jsonb_typeof(l)<>'object'
            OR EXISTS(SELECT 1 FROM jsonb_object_keys(l) lk WHERE lk NOT IN ('kind','ref'))
            OR coalesce(l->>'kind','') NOT IN ('owner_ruling','register','artifact','photo','gmail','file')
            OR coalesce(length(l->>'ref'),0) NOT BETWEEN 1 AND 300)))
   OR octet_length(x::text)>12000
  THEN RAISE EXCEPTION 'invalid retained accounting record'; END IF;
  IF x->>'record_kind'='retained_bank_movement' AND x->>'recognition_status'<>'not_applicable' THEN RAISE EXCEPTION 'movement cannot recognize expense'; END IF;
  n:=n+1;
  INSERT INTO financial_document_lines(owner_id,document_id,line_number,description,attributes,privacy_tier)
  VALUES(p_owner_id,d.id,n,x->>'description',jsonb_build_object('intake_mode','financial_evidence_v1','extraction_run_id',p_run_id,'accounting_record',x,'tax_treatment','not_assessed'),'private');
 END LOOP;
END $function$;

DROP FUNCTION IF EXISTS public.accounting_decision_proof(uuid);
CREATE FUNCTION public.accounting_decision_proof(p_owner_id uuid)
RETURNS TABLE(id uuid, document_id uuid, revised_at timestamptz, record jsonb, year text, section text, amount numeric,
  has_statement boolean, has_receipt boolean, vehicle_id uuid, car_cost boolean, has_ruling boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH recs AS MATERIALIZED (
    SELECT * FROM public.accounting_current_records(p_owner_id)
  ), artifacts AS MATERIALIZED (
    SELECT d.id FROM public.financial_documents d
    WHERE d.owner_id = p_owner_id AND d.source_filename ~* '\.(jpe?g|png|webp|heic|pdf)$'
  ), cells AS MATERIALIZED (
    SELECT e.document_id, e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded
      AND (e.field_key LIKE 'expense\_items\_%' OR e.field_key LIKE 'expense\_use\_%' OR e.field_key = 'bank_corroboration')
  ), statement_links AS MATERIALIZED (
    SELECT DISTINCT x AS local_id, r.record->>'source_key' AS bank_key
    FROM recs r, jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.record->'bank_links') = 'array' THEN r.record->'bank_links' ELSE '[]' END) x
    WHERE r.record->>'record_kind' = 'retained_bank_movement'
  ), corroborated AS MATERIALIZED (
    SELECT DISTINCT c.v->>'bank_source_key' AS bank_key FROM cells c
    WHERE c.field_key = 'bank_corroboration' AND c.document_id IN (SELECT a.id FROM artifacts a)
  ), receipt_keys AS MATERIALIZED (
    SELECT coalesce(c.v->>'expense_source_key', c.v->>'source_key') AS source_key
    FROM cells c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.v->'items') = 'array' THEN c.v->'items' ELSE '[]' END) it
    WHERE c.field_key LIKE 'expense\_items\_%' AND (it->>'document_id') IN (SELECT a.id::text FROM artifacts a)
    UNION
    SELECT c.v->>'source_key' FROM cells c
    WHERE c.field_key LIKE 'expense\_use\_%' AND c.document_id IN (SELECT a.id FROM artifacts a)
  ), receipt_locals AS MATERIALIZED (
    SELECT DISTINCT s.local_id FROM statement_links s JOIN corroborated k ON k.bank_key = s.bank_key
  ), uses AS MATERIALIZED (
    SELECT DISTINCT ON (c.v->>'source_key') c.v->>'source_key' AS source_key,
      CASE WHEN c.v->>'vehicle_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN (c.v->>'vehicle_id')::uuid END AS vehicle_id
    FROM cells c WHERE c.field_key LIKE 'expense\_use\_%' AND c.v ? 'source_key'
    ORDER BY c.v->>'source_key', (c.v->>'vehicle_id') IS NULL
  )
  SELECT r.id, r.document_id, r.revised_at, r.record, r.record->>'year', r.record->>'section',
    CASE WHEN r.record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (r.record->>'amount')::numeric END,
    s.local_id IS NOT NULL,
    (k.source_key IS NOT NULL OR rl.local_id IS NOT NULL),
    u.vehicle_id,
    -- Costs that belong to one car (parts, labor, paint, machining, hauling, car purchase/sale costs, the business
    -- vehicle). Shop tools, supplies and design are shop costs and are not expected to name a car.
    coalesce(r.record->>'category', '') ~* '^(car restoration — (parts|labor|painting|machining|transport)|vehicle)',
    -- An owner ruling with its structured proof: ruling_id set and at least one proof link (a ruling is not a receipt).
    (coalesce(r.record->>'ruling_id', '') <> ''
      AND jsonb_typeof(r.record->'proof_links') = 'array' AND jsonb_array_length(r.record->'proof_links') > 0)
  FROM recs r
  LEFT JOIN (SELECT DISTINCT local_id FROM statement_links) s ON s.local_id = r.record->>'local_id'
  LEFT JOIN (SELECT DISTINCT source_key FROM receipt_keys) k ON k.source_key = r.record->>'source_key'
  LEFT JOIN receipt_locals rl ON rl.local_id = r.record->>'local_id'
  LEFT JOIN uses u ON u.source_key = r.record->>'source_key'
  WHERE r.record->>'record_kind' = 'retained_ledger_decision'
$$;

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
  r2lk AS (
    SELECT DISTINCT m.id AS mid, d.id AS did, d.section AS dsec, d.amount AS damt
    FROM mv m JOIN dc d ON (m.links ? d.id OR d.links ? m.id)
    UNION
    SELECT DISTINCT m.id, d2.id, d2.section, d2.amount
    FROM mv m JOIN dc d ON (m.links ? d.id OR d.links ? m.id)
         JOIN dc d2 ON d2.id <> d.id AND d.year = d2.year
          AND ((d.srckey <> '' AND d2.srckey = d.srckey)
               OR (jsonb_array_length(d.links) > 0 AND d2.links ?| ARRAY(SELECT jsonb_array_elements_text(d.links))))
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
    SELECT DISTINCT d.id, d.amount FROM dc d JOIN mv m ON m.links ? d.id
    WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense') AND m.year <> d.year
  ),
  r4n AS (SELECT count(DISTINCT d.id) AS n FROM dc d JOIN mv m ON m.links ? d.id WHERE d.year = v_year AND d.section IN ('Revenue', 'Expense')),
  r6 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line = '13' AND d.amount <> 0),
  r7 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line = '20b' AND d.amount <> 0),
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

  RETURN jsonb_build_object('owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) x WHERE x->>'status' <> 'pass'),
    'failing', (SELECT coalesce(jsonb_agg(x->>'rule'), '[]') FROM jsonb_array_elements(v_rules) x WHERE x->>'status' = 'fail'),
    'rules', v_rules);
END $$;

REVOKE ALL ON FUNCTION public.books_year_gate(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_year_gate(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.books_year_gate(uuid, integer) IS
  'Hard rules on one tax year of the books (R1-R9, R2i): pass/fail per rule with counts, dollars and the first 100 failing ids. Reads only. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.project_financial_accounting_records(uuid,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_accounting_records(uuid,uuid,uuid,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.accounting_decision_proof(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_decision_proof(uuid) TO authenticated, service_role;
