-- v_books_audit_tiers: pay_proof (pay_final) is false, not NULL, for a row with no bank line and no structural rule.
--
-- In 20261104180000 pay_final is "pay_own OR structural_rule IN ('snapon_ra_payments', 'netted_fee_deposit')". With no bank line (pay_own false)
-- and no structural rule (NULL) that is false OR NULL = NULL, so pay_proof comes out NULL. Every reader that tests NOT pay_proof then gets NULL
-- for exactly those rows and drops them: books_year_gate R10 part (b) (a deduction with no payment proof and no owner ruling) can never fire,
-- v_books_audit_tier_years.no_pay_no_ruling_usd cannot count them, and tier_reason names the wrong cause for them ("bank line and a cited
-- allocation basis"). The tier column was already C for these rows (a NULL pay_final falls through to ELSE 'C'); what changes is the flag.
--
-- This file re-applies the view with that one expression wrapped in coalesce(..., false); every other line is the one 20261104180000 left on main.
-- Effect, read-only on prod on 2026-10-29 (reader v_books_audit_tiers for the books' owner, old view against this text on all 3,469 rows; counts of
-- rows, the dollars stay in the database):
--   212 rows differ (5 in 2022, 12 in 2023, 92 in 2024, 103 in 2025), in three columns only: pay_proof NULL becomes false, payment_cites NULL
--   becomes [], tier_reason names the right cause. tier is unchanged on every row.
--   rows R10 (b) counts (no payment proof, no owner ruling, no structural rule): 0 in 2022 and 2023, 79 in 2024, 100 in 2025 (0 in every year before)
-- so books_year_gate R10 turns to fail for 2024 and 2025. Those are deductions with no bank link of their own (receipts, Apple Cash messages, card
-- statement gaps, cash); no return figure changes. SET timeouts as in the other books view migrations.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.v_books_audit_tiers WITH (security_invoker = true) AS
WITH rc AS MATERIALIZED (
  SELECT r.owner_id, r.category, jsonb_agg(jsonb_build_object('basis', r.basis, 'citation', r.citation)) AS cites
  FROM public.v_books_category_rules r WHERE r.section = 'Expense' GROUP BY r.owner_id, r.category
), reg AS MATERIALIZED (
  SELECT DISTINCT ON (r.owner_id, r.year, r.local_id) r.owner_id, r.year, r.local_id, r.asset_id, r.asset_name, r.computed, r.booked, r.year_r6_pass, r.extraction_id
  FROM public.v_books_asset_register r
  WHERE r.kind = 'claim'
  ORDER BY r.owner_id, r.year, r.local_id, r.asset_id
), ra AS MATERIALIZED (
  -- The year's Snap-on RA ruling and the bank movements it links that are dated in that year; out_usd is their outflow.
  SELECT x.owner_id, x.year, x.ra_id, jsonb_agg(m.local_id ORDER BY m.local_id) AS links, sum(-m.amount_value) FILTER (WHERE m.amount_value < 0) AS out_usd
  FROM (
    SELECT DISTINCT ON (v.owner_id, v.year) v.owner_id, v.year::text AS year, v.local_id AS ra_id, v.record->'bank_links' AS links
    FROM public.v_financial_accounting_records v
    WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.local_id ~ '-RULING-snapon-ra-payments$'
      AND jsonb_typeof(v.record->'bank_links') = 'array' AND jsonb_array_length(v.record->'bank_links') > 0
    ORDER BY v.owner_id, v.year, v.local_id
  ) x
  CROSS JOIN LATERAL jsonb_array_elements_text(x.links) AS l(id)
  JOIN public.v_financial_accounting_records m ON m.owner_id = x.owner_id AND m.local_id = l.id AND m.record_kind = 'retained_bank_movement' AND m.year::text = x.year
  GROUP BY x.owner_id, x.year, x.ra_id
), d AS (
  SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.amount_value AS amount, v.category, v.description, v.status, v.record,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '')) AS t,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.status, '') || ' ' || coalesce(v.decision, '')) AS tt,
         CASE WHEN jsonb_typeof(v.record->'bank_links') = 'array' THEN v.record->'bank_links' ELSE '[]'::jsonb END AS bl,
         CASE WHEN jsonb_typeof(v.record->'proof_links') = 'array' THEN v.record->'proof_links' ELSE '[]'::jsonb END AS pl,
         coalesce(v.record->>'account', '') AS acct, coalesce(v.decision, '') AS decision_text
  FROM public.v_financial_accounting_records v
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.amount_value IS NOT NULL
    AND coalesce(v.status, '') NOT LIKE 'Closed%' AND coalesce(v.status, '') NOT LIKE 'Open allocation%'
), f AS (
  SELECT d.*,
    (jsonb_array_length(d.bl) > 0 OR d.local_id LIKE '%-BANK-%') AS pay_own,
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
  SELECT g.*, (g.has_owner_ruling OR g.vehicle_link OR g.doc_proof OR jsonb_array_length(g.rule_cites) > 0) AS purpose_proof,
    -- Counterpart row a structural exclusion points at (a parent order row, a pool parent, the paired zero row).
    CASE WHEN g.local_id ~ '-(INVENTORY|POOL)$' THEN regexp_replace(g.local_id, '-(INVENTORY|POOL)$', '')
         WHEN g.amount = 0 AND g.local_id ~* 'reclass.*-IN$' THEN regexp_replace(g.local_id, '-IN$', '-OUT')
         WHEN g.amount = 0 AND g.local_id ~* 'reclass.*-OUT$' THEN regexp_replace(g.local_id, '-OUT$', '-IN') END AS cp_id,
    -- Fee netted from a deposit: "$billed billed, $deposited deposited" in the description.
    CASE WHEN g.acct ~* '\(netted\)' THEN regexp_match(g.description, '\$([0-9,]+\.[0-9]{2}) billed, \$([0-9,]+\.[0-9]{2}) deposited') END AS nd_m
  FROM g
), s AS (
  SELECT h.*,
    (h.acct ~* '^snap-on (supplier history|credit contract)' OR h.local_id ~ '^(SNAP-ITEM-|SNAP-CART-|SNAPON-INTEREST-)') AS is_snapon,
    (h.local_id ~* 'inferred') AS is_inferred,
    ra.ra_id, ra.links AS ra_links, ra.out_usd AS ra_out_usd,
    reg.asset_id, reg.asset_name, reg.computed AS reg_computed, reg.booked AS reg_booked, reg.extraction_id AS reg_extraction, coalesce(reg.year_r6_pass, false) AS reg_r6_pass,
    (reg.local_id IS NOT NULL) AS in_register,
    (h.has_ruling_id AND h.local_id = h.record->>'ruling_id' AND h.decision_text ~ 'Evidence:' AND h.decision_text !~* 'estimate pending|\mfloor\M') AS ruling_aggregate,
    (h.cp_id IS NOT NULL AND EXISTS (SELECT 1 FROM d p WHERE p.owner_id = h.owner_id AND p.year = h.year AND p.local_id = h.cp_id
                                       AND (h.amount <> 0 OR p.amount = 0))) AS cp_found,
    nd.mv_id AS nd_mv
  FROM h
  LEFT JOIN ra ON ra.owner_id = h.owner_id AND ra.year = h.year::text
  LEFT JOIN reg ON reg.owner_id = h.owner_id AND reg.year = h.year::text AND reg.local_id = h.local_id
  LEFT JOIN LATERAL (
    SELECT m.local_id AS mv_id
    FROM public.v_financial_accounting_records m
    WHERE h.nd_m IS NOT NULL AND NOT h.pay_own AND m.owner_id = h.owner_id AND m.record_kind = 'retained_bank_movement' AND m.year::text = h.year::text
      AND abs((replace(h.nd_m[1], ',', '')::numeric - replace(h.nd_m[2], ',', '')::numeric) - h.amount) < 0.005
      AND m.amount_value = replace(h.nd_m[2], ',', '')::numeric
    ORDER BY m.local_id LIMIT 1
  ) nd ON true
), r AS (
  SELECT s.*,
    CASE WHEN s.pay_own THEN NULL
         WHEN s.local_id ~ '-INVENTORY$' AND s.cp_found THEN 'inventory_share'
         WHEN s.local_id ~ '-POOL$' AND s.cp_found AND s.amount <= 0 THEN 'cash_pool_allocation'
         WHEN s.local_id ~ '-(CREDIT|REFUND)$' AND s.amount < 0 THEN 'credit_reduction'
         WHEN s.amount = 0 AND s.local_id ~* 'reclass' AND s.cp_found THEN 'zero_reclass_pair'
         WHEN s.nd_mv IS NOT NULL THEN 'netted_fee_deposit'
         WHEN s.is_snapon AND NOT s.is_inferred AND s.ra_id IS NOT NULL THEN 'snapon_ra_payments'
         WHEN s.in_register AND s.reg_r6_pass THEN 'asset_register'
         WHEN s.ruling_aggregate THEN 'owner_ruling_aggregate'
    END AS rule0
  FROM s
), r2 AS (
  -- The year's Snap-on inheriting rows must net to no more than the movements' outflow; otherwise none of them inherits.
  SELECT r.*,
    coalesce(sum(r.amount) FILTER (WHERE r.rule0 = 'snapon_ra_payments') OVER (PARTITION BY r.owner_id, r.year), 0) AS sn_rows_usd
  FROM r
), u AS (
  SELECT r2.*,
    CASE WHEN r2.rule0 = 'snapon_ra_payments' AND r2.sn_rows_usd > coalesce(r2.ra_out_usd, 0) + 0.005 THEN NULL ELSE r2.rule0 END AS structural_rule
  FROM r2
), w AS (
  SELECT u.*,
    (u.structural_rule IS NULL OR u.structural_rule NOT IN ('inventory_share', 'cash_pool_allocation', 'credit_reduction', 'zero_reclass_pair')) AS is_deduction,
    coalesce(u.pay_own OR u.structural_rule IN ('snapon_ra_payments', 'netted_fee_deposit'), false) AS pay_final
  FROM u
), z AS (
  SELECT w.*,
    CASE WHEN NOT w.is_deduction THEN 'X'
         WHEN w.pay_final AND w.purpose_proof THEN CASE WHEN w.doc_proof THEN 'A' ELSE 'B' END
         WHEN w.structural_rule IN ('asset_register', 'owner_ruling_aggregate') THEN 'B'
         ELSE 'C' END AS tier_final
  FROM w
)
SELECT t.id, t.owner_id, t.document_id, t.year, t.local_id, t.amount, t.category, t.description,
  t.tier_final AS tier,
  CASE WHEN NOT t.is_deduction THEN 'outside the deduction denominator: ' || sr.citation || ' (counterpart row ' || coalesce(t.cp_id, 'none needed') || ')'
       WHEN t.is_summary_row THEN 'summary row with no line detail, no bank line'
       WHEN t.tier_final = 'B' AND t.structural_rule = 'asset_register' THEN 'asset register: ' || t.asset_name || ' (MACRS ' || t.reg_computed || ' vs booked ' || t.reg_booked || ', gate R6 passes for ' || t.year || '); no bank line'
       WHEN t.tier_final = 'B' AND t.structural_rule = 'owner_ruling_aggregate' THEN 'owner ruling aggregate that cites its evidence (' || t.local_id || '); no bank line is linked to the aggregate'
       WHEN NOT t.pay_final THEN 'no bank line'
       WHEN NOT t.purpose_proof THEN 'bank line but no cited allocation basis'
       WHEN t.structural_rule = 'snapon_ra_payments' THEN 'payment proof inherited from the ' || jsonb_array_length(t.ra_links) || ' Snap-on RA payment movements of ' || t.ra_id || '; ' ||
            CASE WHEN t.doc_proof THEN 'allocation basis and a document' ELSE 'cited allocation basis' END
       WHEN t.structural_rule = 'netted_fee_deposit' THEN 'payment proof is the deposit movement ' || t.nd_mv || ' (fee netted from the deposit); ' ||
            CASE WHEN t.doc_proof THEN 'allocation basis and a document' ELSE 'cited allocation basis' END
       WHEN t.doc_proof THEN 'bank line, allocation basis and a document'
       ELSE 'bank line and a cited allocation basis (' || CASE WHEN t.has_owner_ruling THEN 'owner ruling' WHEN t.vehicle_link THEN 'Nuke vehicle' ELSE 'category rule' END || ')' END AS tier_reason,
  t.pay_final AS pay_proof, t.doc_proof, t.purpose_proof, t.has_owner_ruling,
  t.is_cash, t.is_contractor, t.is_274, t.is_caveat, t.is_summary_row,
  (t.is_274 AND (t.is_lodging OR abs(t.amount) >= 75)) AS needs_receipt,
  CASE WHEN t.pay_own OR NOT t.pay_final THEN t.bl
       WHEN t.structural_rule = 'netted_fee_deposit' THEN jsonb_build_array(t.nd_mv)
       ELSE t.ra_links END AS payment_cites,
  t.doc_cites AS document_cites, t.rule_cites AS rule_cites,
  (coalesce(t.record->>'ruling_id', '')) AS ruling_id, t.ruling_cites AS ruling_cites,
  t.is_deduction,
  CASE WHEN NOT t.is_deduction THEN sr.citation || CASE WHEN t.cp_id IS NOT NULL THEN ' (counterpart row ' || t.cp_id || ')' ELSE '' END END AS exclusion_reason,
  t.structural_rule,
  CASE WHEN t.structural_rule IS NOT NULL THEN jsonb_build_array(jsonb_build_object('rule', sr.rule, 'basis', sr.basis, 'citation', sr.citation, 'verified_by', sr.verified_by,
    'detail', CASE t.structural_rule
      WHEN 'asset_register' THEN 'books-register-inputs asset ' || t.asset_id || ' (extraction ' || t.reg_extraction || '): ' || t.year || ' MACRS computed ' || t.reg_computed || ', decisions carry ' || t.reg_booked || '; books_year_gate R6 passes for ' || t.year
      WHEN 'snapon_ra_payments' THEN jsonb_array_length(t.ra_links) || ' movements linked by ' || t.ra_id || ' dated ' || t.year || ' (listed in payment_cites), outflow ' || round(t.ra_out_usd, 2) || ' covers the year''s inheriting rows ' || round(t.sn_rows_usd, 2)
      WHEN 'netted_fee_deposit' THEN 'fee ' || t.amount || ' = billed ' || replace(t.nd_m[1], ',', '') || ' less deposited ' || replace(t.nd_m[2], ',', '') || '; deposit movement ' || t.nd_mv
      WHEN 'owner_ruling_aggregate' THEN 'ruling ' || t.local_id || ' cites its evidence in its text'
      ELSE 'counterpart row ' || coalesce(t.cp_id, 'none needed') END)) END AS structural_cites,
  CASE WHEN t.tier_final IN ('A', 'B') THEN
    CASE WHEN t.pay_own THEN 'bank_line' WHEN t.structural_rule = 'snapon_ra_payments' THEN 'snapon_ra_movements' WHEN t.structural_rule = 'netted_fee_deposit' THEN 'deposit_movement'
         WHEN t.structural_rule = 'asset_register' THEN 'asset_register' WHEN t.structural_rule = 'owner_ruling_aggregate' THEN 'owner_ruling' END
  END AS proof_basis
FROM z t
LEFT JOIN public.v_books_structural_rules sr ON sr.rule = t.structural_rule;
