-- Structural rows get a cited rule instead of tier C (owner, 2026-10-28: a deduction is justified by its bank line plus a cited
-- allocation basis; receipts per line only where section 274 requires them). Refines v_books_audit_tiers, v_books_audit_tier_years and
-- books_year_gate R10; adds v_books_asset_register. Reads only; every rule row carries its citation in structural_cites.
--   Depreciation and section 179 lines   tier B, basis "asset register" (books-register-inputs asset cell, MACRS computed vs booked),
--                                        only where the register reproduces the year (the gate's R6 test, v_books_asset_register.year_r6_pass)
--   Snap-on supplier-history items,      inherit the payment proof of the RA payment movements the year's Snap-on RA ruling links
--   contract interest                    (payment_cites lists their local_ids); tiered by the usual rule from that proof
--   Owner-ruling aggregate rows          tier B when the ruling record is its own aggregate (local_id = ruling_id) and cites its evidence
--   Rows with no payment of their own    leave the deduction denominator (is_deduction false, tier X, exclusion_reason): zero reclass
--                                        pairs, inventory-change shares, cash-pool allocations, sales tax collected, refunds and
--                                        credits, fees netted from a deposit
--   Statement and feed documents         a decision whose document is a bank or card statement or the Intuit feed extract is payment proof
--                                        (payment_cites = the document id); documents are typed by source_filename, doc_type is
--                                        'unclassified' for all of them. A "statement_missing" caveat stays as the note that the PDF is not on file.
-- Totals do not move: total_usd stays the sum of every row; the denominator of the A/B/C percentages is deduction_usd = total_usd - excluded_usd.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.v_books_asset_register WITH (security_invoker = true) AS
-- One row per decision claimed by an asset in the books register inputs, per year, with the register's MACRS computation for that
-- asset-year and whether the year as a whole reproduces (the same test as books_year_gate R6: every line 13 decision is claimed, every
-- asset-year computed equals what its decisions carry within 0.51).
WITH lm AS (
  SELECT DISTINCT ON (e.owner_id) e.owner_id, e.value_normalized->'value' AS m
  FROM public.financial_document_extractions e
  JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = e.owner_id AND d.source_filename = 'return-facts-register.txt'
  WHERE NOT e.is_superseded AND e.field_key = 'schedule_c_line_map' AND jsonb_typeof(e.value_normalized->'value') = 'object'
  ORDER BY e.owner_id, e.created_at DESC
), dec AS (
  SELECT v.owner_id, v.year::text AS year, v.local_id, v.amount_value AS amount,
         CASE WHEN v.category LIKE 'Schedule C line %' THEN trim(split_part(substr(v.category, 17), ':', 1))
              ELSE lm.m->>(v.section || '|' || v.category) END AS line
  FROM public.v_financial_accounting_records v
  LEFT JOIN lm ON lm.owner_id = v.owner_id
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.amount_value IS NOT NULL AND v.amount_value <> 0
    AND v.year ~ '^[0-9]{4}$'
), l13 AS MATERIALIZED (
  SELECT * FROM dec WHERE line = '13'
), yrs AS (
  SELECT DISTINCT v.owner_id, v.year::text AS year
  FROM public.v_financial_accounting_records v
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.year ~ '^[0-9]{4}$'
), cells AS (
  SELECT e.owner_id, e.id AS extraction_id, e.value_normalized->'value' AS v
  FROM public.financial_document_extractions e
  JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = e.owner_id AND d.source_filename = 'books-register-inputs.txt'
  WHERE NOT e.is_superseded AND e.field_key ~ '^asset:'
    AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
), ay AS (
  SELECT c.owner_id, c.extraction_id, c.v, y.year,
         coalesce(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.v->'claims'->y.year) = 'array' THEN c.v->'claims'->y.year ELSE '[]'::jsonb END)), '{}') AS cids,
         round((c.v->>'cost')::numeric * coalesce((c.v->>'business_pct')::numeric, 1)
               * public.books_macrs_pct(c.v->>'cls', y.year::int - (c.v->>'placed_in_service')::int + 1) / 100, 2) AS computed
  FROM cells c JOIN yrs y ON y.owner_id = c.owner_id
), ayb AS (
  SELECT ay.*, (SELECT coalesce(sum(l.amount), 0) FROM l13 l WHERE l.owner_id = ay.owner_id AND l.year = ay.year AND l.local_id = ANY(ay.cids)) AS booked
  FROM ay
), ayo AS (
  SELECT ayb.*, NOT ((ayb.computed <> 0 OR cardinality(ayb.cids) > 0) AND abs(ayb.booked - ayb.computed) > 0.51) AS asset_ok FROM ayb
), yr AS (
  SELECT y.owner_id, y.year,
    (NOT EXISTS (SELECT 1 FROM l13 l WHERE l.owner_id = y.owner_id AND l.year = y.year
                   AND NOT EXISTS (SELECT 1 FROM ayo a WHERE a.owner_id = l.owner_id AND a.year = l.year AND l.local_id = ANY(a.cids)))
     AND NOT EXISTS (SELECT 1 FROM ayo a WHERE a.owner_id = y.owner_id AND a.year = y.year AND NOT a.asset_ok)) AS r6_pass
  FROM yrs y
)
SELECT a.owner_id, a.year, cid.local_id, a.v->>'id' AS asset_id, a.v->>'name' AS asset_name, a.v->>'cls' AS asset_class,
       a.computed, a.booked, a.asset_ok, yr.r6_pass AS year_r6_pass, a.extraction_id, a.v->'cites' AS cites
FROM ayo a
JOIN yr ON yr.owner_id = a.owner_id AND yr.year = a.year
CROSS JOIN LATERAL unnest(a.cids) AS cid(local_id);

COMMENT ON VIEW public.v_books_asset_register IS
  'Decisions claimed by an asset in the books register inputs, per year: the asset, its MACRS computation and booked amount for that year, and year_r6_pass (the books_year_gate R6 test for the year). Reads the register; derived, never typed.';
REVOKE ALL ON public.v_books_asset_register FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_books_asset_register FROM authenticated, service_role;
GRANT SELECT ON public.v_books_asset_register TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_books_audit_tiers WITH (security_invoker = true) AS
WITH rc AS MATERIALIZED (
  SELECT r.owner_id, r.category, jsonb_agg(jsonb_build_object('basis', r.basis, 'citation', r.citation)) AS cites
  FROM public.v_books_category_rules r WHERE r.section = 'Expense' GROUP BY r.owner_id, r.category
), reg AS MATERIALIZED (
  SELECT DISTINCT ON (r.owner_id, r.year, r.local_id) r.owner_id, r.year, r.local_id, r.asset_id, r.asset_name, r.computed, r.booked, r.year_r6_pass, r.extraction_id
  FROM public.v_books_asset_register r
  ORDER BY r.owner_id, r.year, r.local_id, r.asset_id
), ra AS MATERIALIZED (
  SELECT DISTINCT ON (v.owner_id, v.year) v.owner_id, v.year::text AS year, v.local_id AS ra_id, v.record->'bank_links' AS links
  FROM public.v_financial_accounting_records v
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.local_id ~ '-RULING-snapon-ra-payments$'
    AND jsonb_typeof(v.record->'bank_links') = 'array' AND jsonb_array_length(v.record->'bank_links') > 0
  ORDER BY v.owner_id, v.year, v.local_id
), d AS (
  SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.amount_value AS amount, v.category, v.description, v.status, v.record,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '')) AS t,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.status, '') || ' ' || coalesce(v.decision, '')) AS tt,
         CASE WHEN jsonb_typeof(v.record->'bank_links') = 'array' THEN v.record->'bank_links' ELSE '[]'::jsonb END AS bl,
         CASE WHEN jsonb_typeof(v.record->'proof_links') = 'array' THEN v.record->'proof_links' ELSE '[]'::jsonb END AS pl,
         coalesce(v.record->>'account', '') AS acct, coalesce(v.decision, '') AS decision_text, fd.source_filename AS doc_filename
  FROM public.v_financial_accounting_records v
  LEFT JOIN public.financial_documents fd ON fd.id = v.document_id AND fd.owner_id = v.owner_id
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.amount_value IS NOT NULL
    AND coalesce(v.status, '') NOT LIKE 'Closed%' AND coalesce(v.status, '') NOT LIKE 'Open allocation%'
), f AS (
  SELECT d.*,
    (jsonb_array_length(d.bl) > 0 OR d.local_id LIKE '%-BANK-%') AS pay_proof,
    (SELECT coalesce(jsonb_agg(p), '[]') FROM jsonb_array_elements(d.pl) p
       WHERE p->>'kind' IN ('gmail', 'file', 'photo', 'artifact', 'receipt') OR coalesce(p->>'ref', '') ILIKE '%nuke vehicle%') AS doc_cites,
    (SELECT coalesce(jsonb_agg(p), '[]') FROM jsonb_array_elements(d.pl) p WHERE p->>'kind' = 'owner_ruling') AS ruling_cites,
    (coalesce(d.record->>'ruling_id', '') <> '') AS has_ruling_id,
    coalesce((SELECT rc.cites FROM rc WHERE rc.owner_id = d.owner_id AND rc.category = d.category), '[]'::jsonb) AS rule_cites,
    EXISTS (SELECT 1 FROM jsonb_array_elements(d.pl) p WHERE coalesce(p->>'ref', '') ILIKE '%nuke vehicle%') AS vehicle_link,
    (d.tt ~ '\mcash\M') AS is_cash,
    (d.t ~ '\m(contractors?|contract labor|helper|painter|labor|1099|sandblast\w*)\M') AS is_contractor,
    (d.t ~ '\m(lodging|hotel|airbnb|motel)\M') AS is_lodging,
    (d.t ~ '\m(travel|trip|flights?|airfare|lodging|hotel|airbnb|motel|meals?|restaurants?|dining|barths?|gifts?|phones?|telephone|cellular|car and truck|mileage|fuel|gasoline)\M'
       OR d.t ~ '\mline (9|24a|24b)\M'
       OR (lower(coalesce(d.category, '')) ~ '^(vehicle|auto)'
           AND lower(coalesce(d.category, '')) !~ '(acquisition|transport|brokerage|reconditioning|delivery|cost of goods|shipping cars)')) AS is_274,
    (d.tt ~ 'caveat|qualification') AS is_caveat,
    (d.local_id ~ 'RULING-(filed|Schedule C|car-basis)' AND jsonb_array_length(d.bl) = 0 AND jsonb_array_length(d.pl) = 0) AS is_summary_row
  FROM d
), g AS (
  SELECT f.*, (jsonb_array_length(f.doc_cites) > 0) AS doc_proof,
         (f.has_ruling_id OR jsonb_array_length(f.ruling_cites) > 0) AS has_owner_ruling
  FROM f
), h AS (
  SELECT g.*, (g.has_owner_ruling OR g.vehicle_link OR g.doc_proof OR jsonb_array_length(g.rule_cites) > 0) AS purpose_proof FROM g
), s AS (
  -- Structural signals. A row with a payment of its own is tiered by the usual rule; these apply to rows that have none.
  SELECT h.*,
    (h.doc_filename IS NOT NULL AND (h.doc_filename ~* 'statement.*\.pdf$' OR h.doc_filename ~* '^intuit-gl-')) AS stmt_doc,
    (h.acct ~* '^snap-on (supplier history|credit contract)' OR h.local_id ~ '^(SNAP-ITEM-|SNAP-CART-|SNAPON-INTEREST-)') AS is_snapon,
    ra.ra_id, ra.links AS ra_links,
    reg.asset_id, reg.asset_name, reg.computed AS reg_computed, reg.booked AS reg_booked, reg.extraction_id AS reg_extraction, coalesce(reg.year_r6_pass, false) AS reg_r6_pass,
    (reg.local_id IS NOT NULL) AS in_register,
    (h.has_ruling_id AND h.local_id = h.record->>'ruling_id' AND (h.decision_text ~ 'Evidence:' OR jsonb_array_length(h.ruling_cites) > 0)) AS ruling_aggregate,
    CASE WHEN h.pay_proof THEN NULL
         WHEN h.amount = 0 AND h.local_id ~* 'reclass' THEN 'zero reclass pair: nets to 0.00 with its counterpart row'
         WHEN h.local_id ~ '-POOL$' THEN 'cash-pool allocation: allocates cash already counted, not a new payment'
         WHEN h.local_id ~ '-INVENTORY$' THEN 'inventory-change row: cost of goods held for sale, its payment proof is the parent order row'
         WHEN h.t ~ 'sales tax collected|collected sales tax' THEN 'sales tax collected: held for the state, not a deduction'
         WHEN h.local_id ~ '-(CREDIT|REFUND)$' THEN 'refund or credit: nets against the original purchase row'
         WHEN h.acct ~* '\(netted\)' THEN 'fee netted from a deposit: justified by the invoice and deposit record, not a bank debit'
    END AS exclusion_reason
  FROM h
  LEFT JOIN ra ON ra.owner_id = h.owner_id AND ra.year = h.year::text
  LEFT JOIN reg ON reg.owner_id = h.owner_id AND reg.year = h.year::text AND reg.local_id = h.local_id
), r AS (
  SELECT s.*,
    (s.exclusion_reason IS NULL) AS is_deduction,
    (s.pay_proof OR (s.exclusion_reason IS NULL AND (s.stmt_doc OR (s.is_snapon AND s.ra_id IS NOT NULL)))) AS pay_final,
    CASE WHEN s.pay_proof THEN NULL
         WHEN s.exclusion_reason IS NOT NULL THEN 'excluded'
         WHEN s.stmt_doc THEN 'bank_statement_document'
         WHEN s.is_snapon AND s.ra_id IS NOT NULL THEN 'snapon_ra_payments'
         WHEN s.in_register AND s.reg_r6_pass THEN 'asset_register'
         WHEN s.ruling_aggregate THEN 'owner_ruling_aggregate'
    END AS structural_rule
  FROM s
), u AS (
  SELECT r.*,
    CASE WHEN NOT r.is_deduction THEN 'X'
         WHEN r.pay_final AND r.purpose_proof THEN CASE WHEN r.doc_proof THEN 'A' ELSE 'B' END
         WHEN r.structural_rule IN ('asset_register', 'owner_ruling_aggregate') THEN 'B'
         ELSE 'C' END AS tier_final
  FROM r
)
SELECT t.id, t.owner_id, t.document_id, t.year, t.local_id, t.amount, t.category, t.description,
  t.tier_final AS tier,
  CASE WHEN NOT t.is_deduction THEN 'outside the deduction denominator: ' || t.exclusion_reason
       WHEN t.is_summary_row THEN 'summary row with no line detail, no bank line'
       WHEN t.tier_final = 'B' AND t.structural_rule = 'asset_register' THEN 'asset register: ' || t.asset_name || ' (MACRS ' || t.reg_computed || ' vs booked ' || t.reg_booked || ', gate R6 passes for ' || t.year || ')'
       WHEN t.tier_final = 'B' AND t.structural_rule = 'owner_ruling_aggregate' THEN 'owner ruling aggregate that cites its evidence (' || t.local_id || ')'
       WHEN NOT t.pay_final THEN 'no bank line'
       WHEN NOT t.purpose_proof THEN 'bank line but no cited allocation basis'
       WHEN t.structural_rule = 'snapon_ra_payments' THEN 'payment proof inherited from the ' || jsonb_array_length(t.ra_links) || ' Snap-on RA payment movements of ' || t.ra_id || '; ' ||
            CASE WHEN t.doc_proof THEN 'allocation basis and a document' ELSE 'cited allocation basis' END
       WHEN t.structural_rule = 'bank_statement_document' THEN 'payment proof is the statement or feed document ' || t.document_id || '; ' ||
            CASE WHEN t.doc_proof THEN 'allocation basis and a document' ELSE 'cited allocation basis' END
       WHEN t.doc_proof THEN 'bank line, allocation basis and a document'
       ELSE 'bank line and a cited allocation basis (' || CASE WHEN t.has_owner_ruling THEN 'owner ruling' WHEN t.vehicle_link THEN 'Nuke vehicle' ELSE 'category rule' END || ')' END AS tier_reason,
  t.pay_final AS pay_proof, t.doc_proof, t.purpose_proof, t.has_owner_ruling,
  t.is_cash, t.is_contractor, t.is_274, t.is_caveat, t.is_summary_row,
  (t.is_274 AND (t.is_lodging OR abs(t.amount) >= 75)) AS needs_receipt,
  CASE WHEN t.pay_proof OR NOT t.pay_final THEN t.bl
       WHEN t.structural_rule = 'bank_statement_document' THEN jsonb_build_array(t.document_id::text)
       ELSE t.ra_links END AS payment_cites,
  t.doc_cites AS document_cites, t.rule_cites AS rule_cites,
  (coalesce(t.record->>'ruling_id', '')) AS ruling_id, t.ruling_cites AS ruling_cites,
  t.is_deduction, t.exclusion_reason, t.structural_rule,
  CASE t.structural_rule
    WHEN 'asset_register' THEN jsonb_build_array(jsonb_build_object('basis', 'asset register',
      'citation', 'books-register-inputs asset ' || t.asset_id || ' (extraction ' || t.reg_extraction || '): ' || t.year || ' MACRS computed ' || t.reg_computed || ', decisions carry ' || t.reg_booked || '; books_year_gate R6 passes for ' || t.year,
      'asset_id', t.asset_id))
    WHEN 'snapon_ra_payments' THEN jsonb_build_array(jsonb_build_object('basis', 'Snap-on RA payment movements',
      'citation', 'payment proof inherited from the ' || jsonb_array_length(t.ra_links) || ' payment movements linked by ' || t.ra_id || ' (listed in payment_cites)'))
    WHEN 'bank_statement_document' THEN jsonb_build_array(jsonb_build_object('basis', 'bank or card statement, or Intuit feed document',
      'citation', 'decision extracted from document ' || t.document_id || ' (' || (CASE WHEN t.doc_filename ~* '^intuit-gl-' THEN 'Intuit feed extract' ELSE 'statement' END) || '); the feed is the bank''s record'))
    WHEN 'owner_ruling_aggregate' THEN jsonb_build_array(jsonb_build_object('basis', 'owner ruling aggregate',
      'citation', 'ruling ' || t.local_id || ' cites its evidence; the superseded rows it replaces carry their own proof'))
    WHEN 'excluded' THEN jsonb_build_array(jsonb_build_object('basis', 'outside the deduction denominator', 'citation', t.exclusion_reason))
  END AS structural_cites
FROM u t;

COMMENT ON VIEW public.v_books_audit_tiers IS
  'Structural rows carry a cited rule (structural_rule, structural_cites) and rows with no payment of their own leave the deduction denominator (is_deduction false, tier X). One row per Expense decision of the current books with its audit tier (A bank line+allocation basis+document, B bank line+cited allocation basis, C no bank line or no basis), section 274 / cash / contractor / caveat flags, the reason and the cites used. Runs as the caller.';

CREATE OR REPLACE VIEW public.v_books_audit_tier_years WITH (security_invoker = true) AS
SELECT t.owner_id, t.year,
  count(*) AS decisions,
  round(sum(t.amount), 2) AS total_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'A'), 0), 2) AS a_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'B'), 0), 2) AS b_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'C'), 0), 2) AS c_usd,
  round(100 * coalesce(sum(t.amount) FILTER (WHERE t.tier = 'A'), 0) / nullif(sum(t.amount) FILTER (WHERE t.is_deduction), 0), 1) AS a_pct,
  round(100 * coalesce(sum(t.amount) FILTER (WHERE t.tier = 'B'), 0) / nullif(sum(t.amount) FILTER (WHERE t.is_deduction), 0), 1) AS b_pct,
  round(100 * coalesce(sum(t.amount) FILTER (WHERE t.tier = 'C'), 0) / nullif(sum(t.amount) FILTER (WHERE t.is_deduction), 0), 1) AS c_pct,
  count(*) FILTER (WHERE t.tier = 'A') AS a_n, count(*) FILTER (WHERE t.tier = 'B') AS b_n, count(*) FILTER (WHERE t.tier = 'C') AS c_n,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_274), 0), 2) AS s274_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.needs_receipt AND NOT t.doc_proof), 0), 2) AS s274_needs_receipt_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat), 0), 2) AS s274_uncaveated_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_cash), 0), 2) AS cash_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_contractor), 0), 2) AS contractor_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_summary_row), 0), 2) AS summary_row_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_deduction AND NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL), 0), 2) AS no_pay_no_ruling_usd,
  count(*) FILTER (WHERE t.is_deduction) AS deductions,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_deduction), 0), 2) AS deduction_usd,
  count(*) FILTER (WHERE NOT t.is_deduction) AS excluded_n,
  round(coalesce(sum(t.amount) FILTER (WHERE NOT t.is_deduction), 0), 2) AS excluded_usd
FROM public.v_books_audit_tiers t
GROUP BY t.owner_id, t.year;

COMMENT ON VIEW public.v_books_audit_tier_years IS
  'Per owner and year rollup of v_books_audit_tiers. total_usd and decisions cover every row; excluded_usd and excluded_n are the rows outside the deduction denominator (is_deduction false, tier X); deduction_usd = total_usd - excluded_usd is the denominator of the A/B/C percentages. Section 274, cash and contractor dollars are over every row.';

REVOKE ALL ON public.v_books_audit_tiers, public.v_books_audit_tier_years FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_books_audit_tiers, public.v_books_audit_tier_years FROM authenticated, service_role;
GRANT SELECT ON public.v_books_audit_tiers, public.v_books_audit_tier_years TO authenticated, service_role;

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
  v_okc text[] := '{}';
  v_failc text[] := '{}';
  v_nac text[] := '{}';
  v_diff numeric := 0;
  v_x numeric;
  v_y numeric;
  v_r10 jsonb;
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
  -- Register inputs: current cells of the books register inputs original (asset:<id>, use:<year>:<key>, credit:<year>).
  rcells AS MATERIALIZED (
    SELECT e.field_key, e.value_normalized->'value' AS v
    FROM public.financial_document_extractions e
    JOIN public.financial_documents d ON d.id = e.document_id AND d.owner_id = p_owner_id AND d.source_filename = 'books-register-inputs.txt'
    WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key ~ '^(asset|use|credit):'
      AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
  ),
  -- R6: each line 13 decision traces to register assets; each asset-year's MACRS computation equals what the decisions carry.
  l13 AS (SELECT d.id, d.amount FROM dc d WHERE d.year = v_year AND d.section = 'Expense' AND d.line = '13' AND d.amount <> 0),
  ra AS (
    SELECT a.v->>'id' AS aid, (a.v->>'cost')::numeric AS cost, coalesce((a.v->>'business_pct')::numeric, 1) AS bp,
           public.books_macrs_pct(a.v->>'cls', p_year - (a.v->>'placed_in_service')::int + 1) AS pct,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(a.v->'claims'->v_year)), '{}') AS cids
    FROM rcells a WHERE a.field_key LIKE 'asset:%'
  ),
  rac AS (
    SELECT ra.aid, ra.cids, round(ra.cost * ra.bp * ra.pct / 100, 2) AS computed,
           (SELECT coalesce(sum(l.amount), 0) FROM l13 l WHERE l.id = ANY(ra.cids)) AS booked
    FROM ra
  ),
  r6 AS (
    SELECT l.id, l.amount FROM l13 l WHERE NOT EXISTS (SELECT 1 FROM ra WHERE l.id = ANY(ra.cids))
    UNION ALL
    SELECT c.aid || ': register computes ' || c.computed || ', decisions carry ' || c.booked, abs(c.booked - c.computed)
    FROM rac c WHERE (c.computed <> 0 OR cardinality(c.cids) > 0) AND abs(c.booked - c.computed) > 0.51
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
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(*) FROM l13),
       'detail', (SELECT count(*) FROM l13) || ' line 13 decisions, ' || (SELECT count(*) FROM ra) || ' register assets; each decision must trace to an asset whose MACRS computation equals what the decisions carry',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r6 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r6),
    (SELECT jsonb_build_object('rule', 'R7', 'title', 'mixed use carries a stored business percentage with its source (decisions equal percentage x base)',
       'n', count(*), 'amount', round(coalesce(sum(abs(amount)), 0), 2), 'of', (SELECT count(*) FROM l20),
       'detail', (SELECT count(*) FROM l20) || ' line 20b / line 30 decisions, ' || (SELECT count(*) FROM ru) || ' stored use groups; each decision must sit in a group whose stored percentage x base equals the decisions',
       'idlist', (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT id FROM r7 ORDER BY abs(amount) DESC LIMIT 100) q)) FROM r7)
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
  -- (EIC tables, GILTI without CFC figures) is not_assessed, and a recomputation that differs is a finding.
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
    -- EIC: with the owner in the US 183 days or fewer the children cannot have lived with him in the US over half the year.
    IF coalesce((v_cr->>'owner_us_days')::int, 999) <= 183 THEN
      IF coalesce((v_cr->>'eic')::numeric, 0) = 0 THEN v_okc := v_okc || format('EIC 0 (owner in the US %s days)', v_cr->>'owner_us_days');
      ELSE v_failc := v_failc || format('EIC %s claimed with the owner in the US %s days', v_cr->>'eic', v_cr->>'owner_us_days'); v_diff := v_diff + (v_cr->>'eic')::numeric; END IF;
    ELSE
      v_nac := v_nac || 'EIC amount (IRS table, AGI and child residency not stored)'::text;
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

  -- R10: audit-proof tiers of the year's deductions (v_books_audit_tiers). Fails on (a) a section 274 item that needs a receipt
  -- (lodging, or $75 or more) and has no document and is not recorded as a caveat, or (b) a deduction with no payment proof and
  -- no owner ruling. The tier rollup is always reported. A year with no deduction decisions is not assessed.
  WITH ta AS MATERIALIZED (SELECT * FROM public.v_books_audit_tiers WHERE owner_id = p_owner_id AND year = v_year),
  t AS MATERIALIZED (SELECT * FROM ta WHERE is_deduction),
  xc AS (SELECT count(*) AS n, round(coalesce(sum(amount), 0), 2) AS usd FROM ta WHERE NOT is_deduction),
  bad AS (
    SELECT t.local_id, t.amount, t.tier,
           (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) AS no_receipt, (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL) AS no_pay_no_ruling
    FROM t WHERE (t.needs_receipt AND NOT t.doc_proof AND NOT t.is_caveat) OR (NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL)
  )
  SELECT CASE WHEN (SELECT count(*) FROM t) = 0 THEN
      jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), or bank line plus cited allocation basis (B)',
        'status', 'not_assessed', 'n', 0, 'amount', NULL, 'detail', 'no Expense decisions for this year', 'ids', '[]'::jsonb)
    ELSE jsonb_build_object('rule', 'R10', 'title', 'deductions are audit-proof: bank line plus allocation basis plus document (A), or bank line plus cited allocation basis (B)',
      'status', CASE WHEN (SELECT count(*) FROM bad) = 0 THEN 'pass' ELSE 'fail' END,
      'n', (SELECT count(*) FROM bad), 'amount', (SELECT round(coalesce(sum(abs(amount)), 0), 2) FROM bad), 'of', (SELECT count(*) FROM t),
      'detail', format('of %s deduction decisions totalling %s: A %s (%s%%), B %s (%s%%), C %s (%s%%); %s section 274 items need a receipt and have none and no caveat, %s deductions have no payment proof and no owner ruling; %s further rows (%s) are outside the deduction denominator',
        (SELECT count(*) FROM t), (SELECT round(sum(amount), 2) FROM t),
        (SELECT round(coalesce(sum(amount) FILTER (WHERE tier = 'A'), 0), 2) FROM t), (SELECT round(100 * coalesce(sum(amount) FILTER (WHERE tier = 'A'), 0) / nullif(sum(amount), 0), 1) FROM t),
        (SELECT round(coalesce(sum(amount) FILTER (WHERE tier = 'B'), 0), 2) FROM t), (SELECT round(100 * coalesce(sum(amount) FILTER (WHERE tier = 'B'), 0) / nullif(sum(amount), 0), 1) FROM t),
        (SELECT round(coalesce(sum(amount) FILTER (WHERE tier = 'C'), 0), 2) FROM t), (SELECT round(100 * coalesce(sum(amount) FILTER (WHERE tier = 'C'), 0) / nullif(sum(amount), 0), 1) FROM t),
        (SELECT count(*) FROM bad WHERE no_receipt), (SELECT count(*) FROM bad WHERE no_pay_no_ruling), (SELECT n FROM xc), (SELECT usd FROM xc)),
      'tiers', (SELECT jsonb_object_agg(k.tier, jsonb_build_object('n', k.n, 'amount', k.a)) FROM
                  (SELECT tier, count(*) AS n, round(sum(amount), 2) AS a FROM t GROUP BY tier) k),
      'ids', (SELECT coalesce(jsonb_agg(q.local_id), '[]') FROM (SELECT local_id FROM bad ORDER BY abs(amount) DESC LIMIT 100) q))
    END
  INTO v_r10;
  v_rules := v_rules || jsonb_build_array(v_r10);

  RETURN jsonb_build_object('owner_id', p_owner_id, 'year', p_year, 'read_at', now(),
    'pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) x WHERE x->>'status' <> 'pass'),
    'failing', (SELECT coalesce(jsonb_agg(x->>'rule'), '[]') FROM jsonb_array_elements(v_rules) x WHERE x->>'status' = 'fail'),
    'rules', v_rules);
END $function$;
