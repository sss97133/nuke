-- Close-out readers for the private accounting office (/accounting).
--
-- Four readers, all SECURITY INVOKER: the book's row policies (owner, plus delegates through
-- accounting_readable_owners()) bound every read. EXECUTE goes to authenticated and service_role only.
--
--   accounting_current_records(owner)            current records of the book with their revision clock
--   accounting_closeout(owner)                   per tax year: the latest return draft, the books clock, and the
--                                                close-out checklist with counts, amounts and denominators
--   accounting_closeout_records(owner, year, item, limit, offset)
--                                                the records behind one checklist item, largest first
--   accounting_record_evidence(owner, document, source_key)
--                                                one record's evidence, strongest first: statement lines, receipts
--                                                and documents, vehicle and job, messages, attestation, then notes
--   accounting_activity_runs(owner, limit)       revisions grouped into passes (actor, run-key family, 30-min gap)
--
-- Evidence weight: an artifact (receipt, invoice, return PDF) > a keyed source (statement line, message id, job,
-- vehicle) > an attestation > narrative. The evidence reader returns that order as typed keys, so the web drawer and
-- agents read a few hundred bytes per record instead of the source document's whole cell history.
-- Nothing here writes. No new table, column, policy or grant on existing objects.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Current records: lines of the current (non-superseded) run of each document, with that run's clock.
CREATE OR REPLACE FUNCTION public.accounting_current_records(p_owner_id uuid)
RETURNS TABLE(id uuid, document_id uuid, run_id uuid, revised_at timestamptz, record jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH runs AS MATERIALIZED (
    SELECT e.document_id, e.extraction_run_id, min(e.created_at) AS revised_at
    FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded
    GROUP BY 1, 2
  )
  SELECT l.id, l.document_id, r.extraction_run_id, r.revised_at, l.attributes->'accounting_record'
  FROM public.financial_document_lines l
  JOIN public.financial_documents d ON d.id = l.document_id AND d.owner_id = p_owner_id
   AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
  JOIN runs r ON r.document_id = l.document_id AND r.extraction_run_id::text = l.attributes->>'extraction_run_id'
  WHERE l.owner_id = p_owner_id AND l.attributes ? 'accounting_record'
    AND l.attributes->>'intake_mode' = 'financial_evidence_v1'
$$;

-- Per-decision proof flags, shared by the checklist and its drill so both count the same population.
--   statement: a retained bank movement links to the decision (bank movement bank_links name its local_id)
--   receipt:   an artifact document (image or PDF) is tied to it: an expense_items cell naming the artifact, a use
--              cell kept on the artifact itself, or a receipt whose bank_corroboration names a linked statement line
--   vehicle:   the current use cell names a vehicle
CREATE OR REPLACE FUNCTION public.accounting_decision_proof(p_owner_id uuid)
RETURNS TABLE(id uuid, document_id uuid, revised_at timestamptz, record jsonb, year text, section text, amount numeric,
  has_statement boolean, has_receipt boolean, vehicle_id uuid, car_cost boolean)
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
    coalesce(r.record->>'category', '') ~* '^(car restoration — (parts|labor|painting|machining|transport)|vehicle)'
  FROM recs r
  LEFT JOIN (SELECT DISTINCT local_id FROM statement_links) s ON s.local_id = r.record->>'local_id'
  LEFT JOIN (SELECT DISTINCT source_key FROM receipt_keys) k ON k.source_key = r.record->>'source_key'
  LEFT JOIN receipt_locals rl ON rl.local_id = r.record->>'local_id'
  LEFT JOIN uses u ON u.source_key = r.record->>'source_key'
  WHERE r.record->>'record_kind' = 'retained_ledger_decision'
$$;

-- The latest return draft per tax year: tax_return_summary cells written through ingest_financial_evidence.
CREATE OR REPLACE FUNCTION public.accounting_return_drafts(p_owner_id uuid)
RETURNS TABLE(tax_year text, document_id uuid, recorded_at timestamptz, summary jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (e.value_normalized->'value'->>'tax_year')
    e.value_normalized->'value'->>'tax_year', e.document_id, e.created_at, e.value_normalized->'value'
  FROM public.financial_document_extractions e
  WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'tax_return_summary'
    AND e.value_normalized->'value'->>'tax_year' ~ '^[0-9]{4}$'
  ORDER BY e.value_normalized->'value'->>'tax_year', e.value_normalized->'value'->>'built_at' DESC NULLS LAST, e.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.accounting_closeout(p_owner_id uuid, p_revenue_gate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_years jsonb;
  v_year jsonb;
  v_out jsonb := '[]';
  v_gate jsonb;
  v_gate_fn boolean := to_regprocedure('public.financial_revenue_evidence_gate(uuid,date,date,integer)') IS NOT NULL;
  v_questions jsonb;
  v_books_at timestamptz;
BEGIN
  IF p_owner_id IS NULL THEN RAISE EXCEPTION 'owner required'; END IF;

  WITH p AS MATERIALIZED (
    SELECT * FROM public.accounting_decision_proof(p_owner_id)
  ), bank AS MATERIALIZED (
    SELECT r.record->>'year' AS year, r.record->>'account' AS account,
      CASE WHEN r.record->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (r.record->>'date')::date END AS day,
      r.revised_at
    FROM public.accounting_current_records(p_owner_id) r
    WHERE r.record->>'record_kind' = 'retained_bank_movement'
  ), span AS (
    SELECT account, min(day) AS first_day, max(day) AS last_day FROM bank WHERE day IS NOT NULL GROUP BY 1
  ), months AS (
    -- Months inside an account's observed span with no retained statement line: the honest form of "missing statement".
    SELECT y.year, s.account, m::date AS month, EXISTS (
      SELECT 1 FROM bank b WHERE b.account IS NOT DISTINCT FROM s.account AND b.day >= m::date AND b.day < (m + interval '1 month')::date) AS present
    FROM (SELECT DISTINCT year FROM bank WHERE year ~ '^[0-9]{4}$') y
    JOIN span s ON true,
    generate_series(greatest(make_date(y.year::int, 1, 1), date_trunc('month', s.first_day)::date),
                    least(make_date(y.year::int, 12, 1), date_trunc('month', s.last_day)::date), interval '1 month') m
  ), gaps AS (
    SELECT year, jsonb_agg(jsonb_build_object('account', account, 'months_without_lines', missing, 'months_in_span', total)
             ORDER BY cardinality(missing) DESC, account) FILTER (WHERE cardinality(missing) > 0) AS accounts,
           coalesce(sum(cardinality(missing)), 0) AS n, coalesce(sum(total), 0) AS of
    FROM (SELECT year, account, array_agg(to_char(month, 'YYYY-MM') ORDER BY month) FILTER (WHERE NOT present) AS missing,
                 count(*) AS total
          FROM months GROUP BY 1, 2) a
    GROUP BY 1
  ), books AS (
    SELECT year,
      count(*) FILTER (WHERE section = 'Revenue') AS revenue_n, sum(amount) FILTER (WHERE section = 'Revenue') AS revenue,
      count(*) FILTER (WHERE section = 'Expense') AS expense_n, sum(amount) FILTER (WHERE section = 'Expense') AS expense,
      count(*) AS decisions, max(revised_at) AS revised_at,
      count(*) FILTER (WHERE section = 'Expense' AND NOT has_statement AND NOT has_receipt) AS no_proof_n,
      sum(amount) FILTER (WHERE section = 'Expense' AND NOT has_statement AND NOT has_receipt) AS no_proof,
      count(*) FILTER (WHERE section = 'Expense' AND has_statement AND NOT has_receipt) AS no_receipt_n,
      sum(amount) FILTER (WHERE section = 'Expense' AND has_statement AND NOT has_receipt) AS no_receipt,
      count(*) FILTER (WHERE section = 'Expense' AND car_cost) AS car_n,
      count(*) FILTER (WHERE section = 'Expense' AND car_cost AND vehicle_id IS NULL) AS no_car_n,
      sum(amount) FILTER (WHERE section = 'Expense' AND car_cost AND vehicle_id IS NULL) AS no_car
    FROM p WHERE year ~ '^[0-9]{4}$' GROUP BY 1
  ), drafts AS (
    SELECT * FROM public.accounting_return_drafts(p_owner_id)
  ), years AS (
    SELECT year FROM books UNION SELECT tax_year FROM drafts UNION SELECT year FROM gaps
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'year', y.year,
      'return', CASE WHEN d.tax_year IS NULL THEN NULL ELSE d.summary || jsonb_build_object('document_id', d.document_id, 'recorded_at', d.recorded_at) END,
      'books', CASE WHEN b.year IS NULL THEN NULL ELSE jsonb_build_object(
        'decisions', b.decisions, 'revenue_records', b.revenue_n, 'revenue', b.revenue, 'expense_records', b.expense_n,
        'expense', b.expense, 'revised_at', b.revised_at) END,
      'draft_stale', CASE WHEN d.summary->>'books_as_of' IS NULL OR b.revised_at IS NULL THEN NULL
                          ELSE b.revised_at > (d.summary->>'books_as_of')::timestamptz END,
      'items', jsonb_build_array(
        jsonb_build_object('key', 'expense_no_proof', 'n', coalesce(b.no_proof_n, 0), 'of', coalesce(b.expense_n, 0), 'amount', coalesce(b.no_proof, 0),
          'assessed', b.year IS NOT NULL),
        jsonb_build_object('key', 'expense_no_receipt', 'n', coalesce(b.no_receipt_n, 0), 'of', coalesce(b.expense_n, 0), 'amount', coalesce(b.no_receipt, 0),
          'assessed', b.year IS NOT NULL),
        jsonb_build_object('key', 'car_cost_no_car', 'n', coalesce(b.no_car_n, 0), 'of', coalesce(b.car_n, 0), 'amount', coalesce(b.no_car, 0),
          'assessed', b.year IS NOT NULL),
        jsonb_build_object('key', 'statement_gaps', 'n', coalesce(g.n, 0), 'of', coalesce(g.of, 0), 'accounts', coalesce(g.accounts, '[]'),
          'assessed', g.year IS NOT NULL OR b.year IS NOT NULL))
    ) ORDER BY y.year DESC), '[]'),
    max(b.revised_at)
  INTO v_years, v_books_at
  FROM years y
  LEFT JOIN books b ON b.year = y.year
  LEFT JOIN drafts d ON d.tax_year = y.year
  LEFT JOIN gaps g ON g.year = y.year;

  -- Revenue evidence gate (readiness test 7), owned by the books-evidence lane; consumed only when deployed and asked
  -- for (about 2-3 s a year). The web page reads it per year through accounting_closeout_records instead.
  FOR v_year IN SELECT x FROM jsonb_array_elements(v_years) x LOOP
    v_gate := NULL;
    IF p_revenue_gate AND v_gate_fn AND v_year->'books' IS NOT NULL AND (v_year->'books'->>'revenue_records')::int > 0 THEN
      BEGIN
        EXECUTE 'SELECT public.financial_revenue_evidence_gate($1, $2, $3, 1000)'
          INTO v_gate USING p_owner_id, make_date((v_year->>'year')::int, 1, 1), make_date((v_year->>'year')::int, 12, 31);
      EXCEPTION WHEN OTHERS THEN v_gate := NULL;
      END;
    END IF;
    v_year := jsonb_set(v_year, '{items}', (v_year->'items') || jsonb_build_array(jsonb_build_object(
      'key', 'revenue_no_payer',
      'assessed', v_gate IS NOT NULL, 'deferred', NOT p_revenue_gate AND v_gate_fn,
      'n', CASE WHEN v_gate IS NOT NULL THEN coalesce(v_gate->'failing_pnl', v_gate->'failing') END,
      'of', CASE WHEN v_gate IS NOT NULL THEN coalesce(v_gate->'population_pnl', v_gate->'population') END,
      'amount', CASE WHEN v_gate IS NOT NULL THEN coalesce(v_gate->'failing_pnl_amount', v_gate->'failing_amount') END)));
    v_out := v_out || jsonb_build_array(v_year);
  END LOOP;

  -- Questions on the current reading only: a concern raised on a superseded run is history, not an open question.
  SELECT jsonb_build_object('pending_current', count(*), 'by_resolver', coalesce(jsonb_object_agg(resolver, n), '{}'))
  INTO v_questions
  FROM (
    SELECT coalesce(q.resolver, 'unassigned') AS resolver, count(*) AS n
    FROM public.financial_review_queue q
    WHERE q.owner_id = p_owner_id AND q.status = 'pending'
      AND (q.confidence_factors->>'extraction_run_id' IS NULL OR EXISTS (
        SELECT 1 FROM public.financial_document_extractions e
        WHERE e.owner_id = p_owner_id AND e.document_id = q.document_id AND NOT e.is_superseded
          AND e.extraction_run_id::text = q.confidence_factors->>'extraction_run_id'))
    GROUP BY 1
  ) s;
  v_questions := v_questions || jsonb_build_object('pending_current', coalesce((
    SELECT sum(value::bigint) FROM jsonb_each_text(v_questions->'by_resolver')), 0));

  RETURN jsonb_build_object('reader', 'accounting_closeout', 'owner_id', p_owner_id, 'read_at', now(),
    'books_revised_at', v_books_at, 'questions', v_questions, 'years', v_out);
END $$;

-- The records behind one checklist item, largest amount first, in the shape the records table already renders.
CREATE OR REPLACE FUNCTION public.accounting_closeout_records(p_owner_id uuid, p_year text, p_item text,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total integer; v_amount numeric; v_gate jsonb; v_keys text[];
BEGIN
  IF p_owner_id IS NULL OR coalesce(p_year, '') !~ '^[0-9]{4}$' OR coalesce(p_limit, 0) NOT BETWEEN 1 AND 250
    OR coalesce(p_offset, -1) NOT BETWEEN 0 AND 100000
    OR p_item NOT IN ('expense_no_proof', 'expense_no_receipt', 'car_cost_no_car', 'revenue_no_payer')
  THEN RAISE EXCEPTION 'bounded close-out drill: year YYYY, a known item, limit 1 to 250'; END IF;
  IF p_item = 'revenue_no_payer' THEN
    IF to_regprocedure('public.financial_revenue_evidence_gate(uuid,date,date,integer)') IS NULL THEN
      RETURN jsonb_build_object('item', p_item, 'year', p_year, 'assessed', false, 'total', NULL, 'amount', NULL, 'rows', '[]'::jsonb);
    END IF;
    EXECUTE 'SELECT public.financial_revenue_evidence_gate($1, $2, $3, 1000)' INTO v_gate
      USING p_owner_id, make_date(p_year::int, 1, 1), make_date(p_year::int, 12, 31);
    SELECT array_agg(x->>'local_id') INTO v_keys FROM jsonb_array_elements(coalesce(v_gate->'rows', '[]')) x
    WHERE coalesce((x->>'pnl_effect')::boolean, true);
  END IF;
  WITH p AS MATERIALIZED (
    SELECT * FROM public.accounting_decision_proof(p_owner_id) WHERE year = p_year
  ), f AS (
    SELECT * FROM p WHERE CASE p_item
      WHEN 'expense_no_proof' THEN section = 'Expense' AND NOT has_statement AND NOT has_receipt
      WHEN 'expense_no_receipt' THEN section = 'Expense' AND has_statement AND NOT has_receipt
      WHEN 'car_cost_no_car' THEN section = 'Expense' AND car_cost AND vehicle_id IS NULL
      WHEN 'revenue_no_payer' THEN section = 'Revenue' AND record->>'local_id' = ANY (coalesce(v_keys, '{}'))
    END
  ), page AS (
    SELECT * FROM f ORDER BY abs(amount) DESC NULLS LAST, record->>'date', id LIMIT p_limit OFFSET p_offset
  )
  SELECT (SELECT count(*) FROM f), (SELECT sum(amount) FROM f),
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'document_id', document_id, 'record', record)
      ORDER BY abs(amount) DESC NULLS LAST, record->>'date', id) FROM page), '[]')
  INTO v_total, v_amount, v_rows;
  RETURN jsonb_build_object('item', p_item, 'year', p_year, 'assessed', true, 'total', v_total, 'amount', coalesce(v_amount, 0), 'rows', v_rows);
END $$;

-- One record's evidence, strongest first. Ids embedded in the decision text are resolved here, once, for every reader.
CREATE OR REPLACE FUNCTION public.accounting_record_evidence(p_owner_id uuid, p_document_id uuid, p_source_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  rec jsonb; v_run uuid; v_revised timestamptz; v_local text; v_decision text; v_use jsonb; v_use_at timestamptz;
  v_statements jsonb; v_artifacts jsonb; v_vehicles jsonb; v_jobs jsonb; v_messages jsonb; v_attest jsonb;
  v_questions jsonb; v_cells integer; v_uuids uuid[]; v_linked jsonb; v_bank_keys text[];
BEGIN
  IF p_owner_id IS NULL OR p_document_id IS NULL OR coalesce(p_source_key, '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'owner, document and a record source key are required';
  END IF;
  -- The record on its document's current run (one document: indexed, no book-wide scan).
  SELECT l.attributes->'accounting_record', r.extraction_run_id, r.revised_at INTO rec, v_run, v_revised
  FROM public.financial_document_lines l
  JOIN (SELECT e.extraction_run_id, min(e.created_at) AS revised_at FROM public.financial_document_extractions e
        WHERE e.owner_id = p_owner_id AND e.document_id = p_document_id AND NOT e.is_superseded GROUP BY 1) r
    ON r.extraction_run_id::text = l.attributes->>'extraction_run_id'
  WHERE l.owner_id = p_owner_id AND l.document_id = p_document_id AND l.attributes ? 'accounting_record'
    AND l.attributes->'accounting_record'->>'source_key' = p_source_key
  LIMIT 1;
  IF rec IS NULL THEN RETURN NULL; END IF;
  v_local := rec->>'local_id';
  v_decision := coalesce(rec->>'decision', '');

  -- Keyed: the statement lines that name this decision (or, for a bank movement, the decisions it names).
  WITH cur AS MATERIALIZED (SELECT * FROM public.accounting_current_records(p_owner_id))
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', c.document_id, 'source_key', c.record->>'source_key',
        'local_id', c.record->>'local_id', 'date', c.record->>'date', 'amount', c.record->>'amount', 'currency', c.record->>'currency',
        'account', c.record->>'account', 'description', left(c.record->>'description', 160)) ORDER BY c.record->>'date'), '[]')
     FROM (SELECT * FROM cur c WHERE c.record->>'record_kind' = 'retained_bank_movement'
             AND rec->>'record_kind' = 'retained_ledger_decision'
             AND c.record->'bank_links' ? v_local LIMIT 10) c),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', c.document_id, 'source_key', c.record->>'source_key',
        'local_id', c.record->>'local_id', 'date', c.record->>'date', 'amount', c.record->>'amount', 'section', c.record->>'section',
        'category', c.record->>'category') ORDER BY c.record->>'date'), '[]')
     FROM (SELECT * FROM cur c WHERE rec->>'record_kind' = 'retained_bank_movement'
             AND c.record->>'record_kind' = 'retained_ledger_decision'
             AND rec->'bank_links' ? (c.record->>'local_id') LIMIT 10) c)
  INTO v_statements, v_linked;
  SELECT array_agg(x->>'source_key') INTO v_bank_keys
  FROM jsonb_array_elements(CASE WHEN rec->>'record_kind' = 'retained_bank_movement'
    THEN jsonb_build_array(jsonb_build_object('source_key', p_source_key)) ELSE v_statements END) x;

  -- Use: the current use cell for this record (vehicle, shop or business), wherever it is kept.
  SELECT e.value_normalized->'value', e.created_at INTO v_use, v_use_at
  FROM public.financial_document_extractions e
  WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'expense_use_' || left(p_source_key, 24)
    AND e.value_normalized->'value'->>'source_key' = p_source_key
  ORDER BY (e.value_normalized->'value'->>'vehicle_id') IS NULL, e.created_at DESC LIMIT 1;

  -- UUIDs written into the decision text, resolved against the entities they could name.
  SELECT array_agg(DISTINCT m[1]::uuid) INTO v_uuids
  FROM regexp_matches(v_decision || ' ' || coalesce(rec->>'source_reference', ''),
    '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'gi') m;

  -- Artifacts: receipts and documents tied to this record, strongest link first.
  WITH links AS (
    SELECT (it->>'document_id')::uuid AS id, 'receipt_items' AS via
    FROM public.financial_document_extractions e,
      jsonb_array_elements(CASE WHEN jsonb_typeof(e.value_normalized->'value'->'items') = 'array' THEN e.value_normalized->'value'->'items' ELSE '[]' END) it
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key LIKE 'expense\_items\_' || left(p_source_key, 24) || '%'
      AND it->>'document_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    UNION ALL
    SELECT e.document_id, 'kept_on_receipt' FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'expense_use_' || left(p_source_key, 24)
      AND e.value_normalized->'value'->>'source_key' = p_source_key AND e.document_id <> p_document_id
    UNION ALL
    SELECT e.document_id, 'matches_statement_line' FROM public.financial_document_extractions e
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key = 'bank_corroboration'
      AND e.value_normalized->'value'->>'bank_source_key' = ANY (coalesce(v_bank_keys, '{}'))
    UNION ALL
    SELECT u, 'named_in_notes' FROM unnest(coalesce(v_uuids, '{}')) u
  ), docs AS (
    SELECT DISTINCT ON (d.id) d.id, d.source_filename, d.document_date, d.issuer_name_raw, d.amount_ttc, d.currency, l.via,
      CASE l.via WHEN 'receipt_items' THEN 1 WHEN 'kept_on_receipt' THEN 2 WHEN 'matches_statement_line' THEN 3 ELSE 4 END AS rank
    FROM links l JOIN public.financial_documents d ON d.id = l.id AND d.owner_id = p_owner_id
    WHERE d.id <> p_document_id
    ORDER BY d.id, CASE l.via WHEN 'receipt_items' THEN 1 WHEN 'kept_on_receipt' THEN 2 WHEN 'matches_statement_line' THEN 3 ELSE 4 END
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', id, 'filename', source_filename,
      'kind', CASE WHEN source_filename ~* '\.(jpe?g|png|webp|heic)$' THEN 'image' WHEN source_filename ~* '\.pdf$' THEN 'pdf' ELSE 'file' END,
      'via', via, 'issuer', issuer_name_raw, 'date', document_date, 'amount', amount_ttc, 'currency', currency) ORDER BY rank, document_date), '[]')
  INTO v_artifacts FROM (SELECT * FROM docs ORDER BY rank LIMIT 10) x;

  -- Vehicles: the use cell's vehicle, then any vehicle named in the notes. Only what the reader may see resolves.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'label', concat_ws(' ', v.year, v.make, v.model),
      'via', CASE WHEN v.id::text = v_use->>'vehicle_id' THEN 'use' ELSE 'named_in_notes' END)), '[]')
  INTO v_vehicles
  FROM public.vehicles v
  WHERE v.id = ANY (coalesce(v_uuids, '{}') || CASE WHEN v_use->>'vehicle_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                                                     THEN ARRAY[(v_use->>'vehicle_id')::uuid] ELSE '{}' END);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', left(w.title, 120))), '[]') INTO v_jobs
  FROM public.work_orders w
  WHERE w.id = ANY (coalesce(v_uuids, '{}') || CASE WHEN v_use->>'work_order_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                                                     THEN ARRAY[(v_use->>'work_order_id')::uuid] ELSE '{}' END);

  -- Messages: Gmail message ids in the notes. The id encodes its own send time (milliseconds since 1970, shifted
  -- 20 bits), so the date is read from the key, not guessed. The quote is the sentence that cites it.
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'gmail', 'id', g.id,
      'sent_at', to_timestamp((('x' || g.id)::bit(64)::bigint >> 20) / 1000.0),
      'quote', left(btrim((SELECT s FROM regexp_split_to_table(v_decision, '(?<=[.;])\s+') s WHERE position(g.id IN s) > 0 LIMIT 1)), 200))
      ORDER BY g.id), '[]')
  INTO v_messages
  FROM (SELECT DISTINCT m[1] AS id FROM regexp_matches(v_decision, '\m(1[0-9a-f]{15})\M', 'g') m) g
  WHERE to_timestamp((('x' || g.id)::bit(64)::bigint >> 20) / 1000.0) BETWEEN '2004-04-01' AND now() + interval '1 day';

  -- Attestation: an owner-confirmed use, or the sentence in the notes where the owner states the fact.
  SELECT coalesce(jsonb_agg(a ORDER BY a->>'at'), '[]') INTO v_attest FROM (
    SELECT jsonb_build_object('by', 'owner', 'at', v_use_at, 'text', left(v_use->>'basis', 200), 'via', 'use') a
    WHERE v_use->>'status' = 'owner_confirmed'
    UNION ALL
    SELECT jsonb_build_object('by', 'owner', 'at', NULL, 'text', left(btrim(s), 200), 'via', 'notes')
    FROM (SELECT s FROM regexp_split_to_table(v_decision, '(?<=[.;])\s+') s
          WHERE s ~* '\m(owner)(''s)?\s+(attest|attestation|confirm|confirmed|confirms|said|says|statement|answer|answered|ruled|ruling)' LIMIT 2) t
  ) x;

  -- Open questions on this record's current reading that name it (a slice holds many records).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'type', q.concern_type, 'resolver', q.resolver,
      'detail', left(q.detail, 300)) ORDER BY q.created_at), '[]') INTO v_questions
  FROM (SELECT * FROM public.financial_review_queue q
        WHERE q.owner_id = p_owner_id AND q.document_id = p_document_id AND q.status = 'pending'
          AND q.confidence_factors->>'extraction_run_id' = v_run::text AND position(v_local IN coalesce(q.detail, '')) > 0
        LIMIT 5) q;

  SELECT count(*) INTO v_cells FROM public.financial_document_extractions e
  WHERE e.owner_id = p_owner_id AND e.document_id = p_document_id AND NOT e.is_superseded;

  RETURN jsonb_build_object(
    'reader', 'accounting_record_evidence', 'document_id', p_document_id, 'source_key', p_source_key, 'revised_at', v_revised,
    'record', jsonb_build_object('local_id', v_local, 'kind', rec->>'record_kind', 'date', rec->>'date', 'year', rec->>'year',
      'amount', rec->>'amount', 'currency', rec->>'currency', 'account', rec->>'account', 'section', rec->>'section',
      'category', rec->>'category', 'description', left(rec->>'description', 200), 'status', left(rec->>'status', 200)),
    'strength', CASE WHEN jsonb_array_length(v_artifacts) > 0 THEN 'artifact'
                     WHEN jsonb_array_length(v_statements) + jsonb_array_length(v_linked) + jsonb_array_length(v_messages)
                          + jsonb_array_length(v_jobs) > 0 THEN 'keyed_source'
                     WHEN jsonb_array_length(v_attest) > 0 THEN 'attestation'
                     WHEN v_decision <> '' THEN 'narrative' ELSE 'none' END,
    'statement_lines', v_statements, 'linked_decisions', v_linked, 'artifacts', v_artifacts,
    'use', CASE WHEN v_use IS NULL THEN NULL ELSE jsonb_build_object('label', v_use->>'destination_label', 'use_type', v_use->>'use_type',
      'vehicle_id', v_use->>'vehicle_id', 'allocated', v_use->>'allocated_amount', 'unallocated', v_use->>'unallocated_amount',
      'status', v_use->>'status', 'basis', left(v_use->>'basis', 200)) END,
    'vehicles', v_vehicles, 'jobs', v_jobs, 'messages', v_messages, 'attestations', v_attest, 'questions', v_questions,
    'notes', nullif(v_decision, ''), 'source_cells', v_cells);
END $$;

-- Revisions grouped into passes: one line per agent run or person session.
-- A pass = same actor, same run-key family (the idempotency key up to its yyyymmdd date, else without ids and trailing numbers) and method, with no gap
-- longer than 30 minutes. Bounded to the newest 300 revisions; the oldest pass is marked partial when cut.
-- The CTE row estimates are far too low (a pass spans hundreds of revisions); nested loops over them rescan line
-- history per revision (measured: > 30 s). Hash joins read each set once.
CREATE OR REPLACE FUNCTION public.accounting_activity_runs(p_owner_id uuid, p_limit integer DEFAULT 12)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp SET enable_nestloop = off AS $$
  WITH runs AS MATERIALIZED (
    SELECT d.id AS document_id, (r.value->>'run_id')::uuid AS run_id, (r.value->>'supersedes_run_id')::uuid AS prior_run_id,
      (r.value->>'actor_user_id')::uuid AS actor_user_id, r.value->>'key' AS run_key
    FROM public.financial_documents d
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.attributes->'runs', '[]')) r
    WHERE d.owner_id = p_owner_id AND d.attributes->>'intake_mode' = 'financial_evidence_v1'
  ), cells AS MATERIALIZED (
    SELECT x.document_id, x.extraction_run_id, min(x.created_at) AS recorded_at, min(x.extractor) AS method
    FROM public.financial_document_extractions x
    WHERE x.owner_id = p_owner_id GROUP BY 1, 2
  ), recent AS MATERIALIZED (
    SELECT r.*, c.recorded_at, c.method,
      coalesce(substring(r.run_key from '^(.*?[-_:.]20[0-9]{6})(?:[-_:.]|$)'),
        regexp_replace(regexp_replace(coalesce(r.run_key, ''), '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}', '', 'gi'),
          '([-_:.]+(v?[0-9a-f]+)?)+$', '', 'i')) AS family
    FROM runs r JOIN cells c ON c.document_id = r.document_id AND c.extraction_run_id = r.run_id
    ORDER BY c.recorded_at DESC LIMIT 300
  ), marked AS (
    SELECT *, CASE WHEN lag(recorded_at) OVER w IS NULL OR lag(recorded_at) OVER w < recorded_at - interval '30 minutes'
                   THEN 1 ELSE 0 END AS starts
    FROM recent WINDOW w AS (PARTITION BY actor_user_id, family, method ORDER BY recorded_at)
  ), sessions AS (
    SELECT *, sum(starts) OVER (PARTITION BY actor_user_id, family, method ORDER BY recorded_at) AS seq FROM marked
  ), passes AS (
    SELECT actor_user_id, family, method, seq, min(recorded_at) AS started_at, max(recorded_at) AS ended_at,
      count(*) AS revisions, count(DISTINCT document_id) AS documents, array_agg(run_id) AS run_ids,
      (array_agg(document_id ORDER BY recorded_at DESC))[1] AS latest_document_id,
      bool_or(prior_run_id IS NULL) AS has_first_reading,
      min(recorded_at) <= (SELECT min(recorded_at) FROM recent) AS partial
    FROM sessions GROUP BY 1, 2, 3, 4
    ORDER BY max(recorded_at) DESC LIMIT least(greatest(coalesce(p_limit, 12), 1), 50)
  ), picked AS MATERIALIZED (
    SELECT s.document_id, s.run_id, s.prior_run_id, s.actor_user_id, s.family, s.method, s.seq
    FROM sessions s JOIN passes p USING (actor_user_id, family, method, seq)
  ), wanted AS MATERIALIZED (
    SELECT document_id, run_id::text AS run_id FROM picked
    UNION SELECT document_id, prior_run_id::text FROM picked WHERE prior_run_id IS NOT NULL
  ), versions AS MATERIALIZED (
    SELECT l.document_id, l.attributes->>'extraction_run_id' AS run_id, l.attributes->'accounting_record' AS record,
      md5((l.attributes->'accounting_record')::text) AS fingerprint
    FROM (SELECT DISTINCT document_id FROM wanted) wd
    JOIN public.financial_document_lines l ON l.document_id = wd.document_id
    WHERE l.owner_id = p_owner_id AND l.attributes ? 'accounting_record'
      AND (l.document_id, l.attributes->>'extraction_run_id') IN (SELECT w.document_id, w.run_id FROM wanted w)
  ), changed AS (
    -- A record changed when its new version is not among the prior run's versions (by value).
    SELECT k.actor_user_id, k.family, k.method, k.seq, n.record
    FROM picked k
    JOIN versions n ON n.document_id = k.document_id AND n.run_id = k.run_id::text
    LEFT JOIN versions o ON o.document_id = k.document_id AND o.run_id = k.prior_run_id::text AND o.fingerprint = n.fingerprint
    WHERE o.document_id IS NULL
  ), by_year AS (
    SELECT actor_user_id, family, method, seq, jsonb_object_agg(year, jsonb_build_object('records', n, 'amount', amount)) AS years,
      sum(n) AS records_changed
    FROM (SELECT actor_user_id, family, method, seq, coalesce(record->>'year', 'unknown') AS year, count(*) AS n,
            sum(abs(CASE WHEN record->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' THEN (record->>'amount')::numeric END))
              FILTER (WHERE record->>'record_kind' = 'retained_ledger_decision') AS amount
          FROM changed GROUP BY 1, 2, 3, 4, 5) y
    GROUP BY 1, 2, 3, 4
  ), questions AS (
    SELECT k.actor_user_id, k.family, k.method, k.seq, count(q.id) AS opened
    FROM picked k JOIN public.financial_review_queue q
      ON q.owner_id = p_owner_id AND q.document_id = k.document_id AND q.confidence_factors->>'extraction_run_id' = k.run_id::text
    GROUP BY 1, 2, 3, 4
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'actor_user_id', p.actor_user_id, 'run_family', nullif(p.family, ''), 'method', p.method,
      'started_at', p.started_at, 'ended_at', p.ended_at, 'revisions', p.revisions, 'documents', p.documents,
      'records_changed', coalesce(b.records_changed, 0), 'years', coalesce(b.years, '{}'),
      'questions_opened', coalesce(q.opened, 0), 'first_reading', p.has_first_reading,
      'latest_document_id', p.latest_document_id, 'partial', p.partial) ORDER BY p.ended_at DESC), '[]')
  FROM passes p
  LEFT JOIN by_year b USING (actor_user_id, family, method, seq)
  LEFT JOIN questions q USING (actor_user_id, family, method, seq)
$$;

REVOKE ALL ON FUNCTION public.accounting_current_records(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_decision_proof(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_return_drafts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_closeout(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_closeout_records(uuid, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_record_evidence(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_activity_runs(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_current_records(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_decision_proof(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_return_drafts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_closeout(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_closeout_records(uuid, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_record_evidence(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_activity_runs(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.accounting_closeout(uuid, boolean) IS
  'Per tax year: latest return draft (tax_return_summary cells), books revision clock, stale flag, and the close-out checklist (expenses without proof of payment or receipt, car costs with no car, months without statement lines, revenue evidence gate when deployed and p_revenue_gate) with n of N and amounts. SECURITY INVOKER.';
COMMENT ON FUNCTION public.accounting_record_evidence(uuid, uuid, text) IS
  'One record''s evidence, strongest first: statement lines, artifacts, use/vehicle/job, Gmail ids with decoded send time, attestation, open questions, then the notes. SECURITY INVOKER.';
COMMENT ON FUNCTION public.accounting_activity_runs(uuid, integer) IS
  'Book revisions grouped into passes (actor, run-key family, method, 30-minute gap): records changed and amounts per year, questions opened. SECURITY INVOKER.';
