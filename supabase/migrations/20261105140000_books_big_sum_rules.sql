-- Two agent-free books checks held in the database, and the gate rules that read them (owner, 2026-10-29: "a large sum with no
-- validated proof is a quick cheap flag ... that would in theory require no agentic layer"; "value things on a per dollar basis
-- not a per line"; "this expense is missing a purchase agreement, it's missing a receipt ... if a large expense is missing documentation then we
-- need to know").
--   v_books_large_sums        one row per deduction decision and per revenue decision, per owner and year, ranked by dollars, with the
--                             cumulative dollar share, the audit-tier flags, basis_strength (what the allocation rests on) and, for
--                             deductions, the document the row's kind requires and whether one was found (required_doc_kind, doc_found, missing_doc).
--   v_books_direction_checks  every positive Expense decision linked (bank_links) to a bank movement that is money in, and every positive
--                             Revenue decision linked to a movement that is money out. Empty when the books are right.
--   books_year_gate R11       fails when the year has rows in v_books_direction_checks.
--   books_year_gate R12       fails when a decision in the head (the largest decisions that together reach 80% of the year's deduction dollars)
--                             has no bank line, has no basis, rests only on the filed return, or misses the document its kind requires.
-- Dollars, not lines: the share of a row is its absolute amount over the sum of the absolute amounts of its kind and year (credits and
-- corrections count by size, not by sign), ranked largest first. The head is the smallest set of top rows whose running share reaches 80%:
-- a row is in the head while the dollars ranked above it are under 80% of the year.
-- basis_strength, what the allocation of the row rests on (every value is derived from cites that sit on the row):
--   documented         a document or a Nuke vehicle link (proof_links of kind gmail, file, photo, artifact or receipt, or a Nuke vehicle ref)
--   bank_and_rule      tier A or B without a document: a bank line (or the asset register / owner ruling aggregate that the audit tiers
--                      accept in its place, see proof_basis) plus a category rule or an owner ruling that is not a filed-return summary ruling
--   filed_return_only  no document, and the only basis is a ruling whose id or ref names the filed return (ids with RULING-filed, RULING-Schedule C
--                      or RULING-car-basis, refs reading "owner ruling on the filed <year> Schedule C ...") plus the QuickBooks category rule that
--                      the same ruling creates, or the summary row of the filed return itself
--   none               tier C and not one of the above: no bank line, or no cited allocation basis
-- proof_flag (null when the row needs nothing): filed_return_only; no_payment_proof (tier C, no bank line); no_basis (tier C with a bank line
-- but no cited allocation basis).
-- Documents (deductions with a positive amount; the policy is the owner's, the keyword rules that apply it are this view's judgment and are
-- listed in the view, first match on the category wins). required_doc_kind, strictest first:
--   purchase_agreement    a vehicle bought, acquired, consigned or paid a commission on: a purchase agreement, bill of sale or title
--   invoice_or_agreement  freight, transport, contractors, labor, professional fees, cost of goods: an invoice or an agreement (or the above)
--   receipt_or_order      parts, materials, supplies, tools, equipment: a receipt or an order (or the above)
--   register_asset        depreciation and section 179: the entry of the asset register (v_books_asset_register) that claims the row
--   lease_or_ruling       rent: a lease among the cited documents, or an owner ruling that is not a filed-return summary ruling
--   null                  the bank line and the cited basis are enough (utilities, travel, fees, subscriptions ...); credits are not assessed
-- A document counts when it is cited on the row (proof_links of kind gmail, file, photo, artifact or receipt, typed by the words of the cite) or
-- when Nuke holds it for a vehicle the books tie to the row: the books_decision documents that link_books_to_vehicles writes (the only structured
-- link from a decision to a vehicle; the books carry no vehicle key of their own) point to a vehicle, and that vehicle's documents are read from
-- vehicle_documents, deal_documents, receipts (receipt_vehicle_links), ownership_verifications (the title), secure_documents (a vehicle_title whose
-- upload_metadata names the vehicle), vehicle_images (documents) and vehicle_listing_documents, typed by their own document_type. A vehicle's document meets a purchase_agreement requirement when it is a purchase
-- agreement, bill of sale or title (a vehicle has one); it meets an invoice or receipt requirement only when it states the same amount as the
-- decision (a vehicle can hold many receipts). doc_found lists up to five of them (source, id, type, vehicle_id, level);
-- doc_found_n counts them all; missing_doc is true when the kind requires a document and none was found; doc_cited_n counts the documents the row
-- cites whatever they are, so a missing row with doc_cited_n 0 cites nothing and one with more cites paper whose words do not name the required kind
-- (a payment export, an untitled email). Missing means not cited as that kind and not found in these places, not that the paper does not exist.
-- Two facts the views handle that the audit tiers leave open (reported with this change):
--   pay_proof is NULL, not false, in v_books_audit_tiers for a row with no bank line and no structural rule; it is coalesced here.
--   decision bank_links name bank lines; the books register holds only some of them as retained_bank_movement rows. v_books_direction_checks tests
--   the links that resolve; R11 counts the ones that do not and reports them as not assessed.
-- Both views run as the caller (security_invoker), so the financial_* row policies decide what each reader sees (and the policies of the Nuke document
-- tables decide which documents a reader finds). Same grants as v_books_audit_tiers.
-- books_year_gate: the body is the one 20261104200000 (EIC) left on main with R11 and R12 added after R10; every other line is unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.v_books_large_sums WITH (security_invoker = true) AS
WITH bv AS MATERIALIZED (
  -- One read of the books' decision records, used for the Revenue rows and for the vehicle link below.
  SELECT x.id, x.owner_id, x.document_id, x.year, x.local_id, x.section, x.category, x.description, x.status, x.amount_value, x.source_key, x.record
  FROM public.v_financial_accounting_records x
  WHERE x.record_kind = 'retained_ledger_decision'
), u AS (
  -- Deductions: the audit tiers' own rows (one implementation of pay_proof, doc_proof, purpose_proof and proof_basis).
  -- pay_proof is coalesced: the tier view leaves it NULL for a row with no bank line and no structural rule.
  SELECT 'deduction'::text AS kind, t.owner_id, t.year, t.id, t.document_id, t.local_id, t.amount, t.category, t.description, t.tier,
         coalesce(t.pay_proof, false) AS pay_proof, t.doc_proof, t.purpose_proof, t.proof_basis, t.has_owner_ruling, t.ruling_id,
         t.payment_cites, t.document_cites, t.ruling_cites, t.is_summary_row
  FROM public.v_books_audit_tiers t
  WHERE t.is_deduction
  UNION ALL
  -- Revenue: the same flags from the same record fields and definitions as the tier view (which covers Expense only).
  SELECT 'revenue'::text, v.owner_id, v.year, v.id, v.document_id, v.local_id, v.amount_value, v.category, v.description,
         CASE WHEN f.pay AND f.purpose THEN CASE WHEN f.doc THEN 'A' ELSE 'B' END ELSE 'C' END,
         f.pay, f.doc, f.purpose, CASE WHEN f.pay AND f.purpose THEN 'bank_line' END, f.has_ruling, g.rid,
         v.bl, g.doc_cites, g.ruling_cites, g.summary
  FROM (
    SELECT x.*, CASE WHEN jsonb_typeof(x.record->'bank_links') = 'array' THEN x.record->'bank_links' ELSE '[]'::jsonb END AS bl,
                CASE WHEN jsonb_typeof(x.record->'proof_links') = 'array' THEN x.record->'proof_links' ELSE '[]'::jsonb END AS pl
    FROM bv x
    WHERE x.section = 'Revenue' AND x.amount_value IS NOT NULL
      AND coalesce(x.status, '') NOT LIKE 'Closed%' AND coalesce(x.status, '') NOT LIKE 'Open allocation%'
  ) v
  LEFT JOIN (SELECT DISTINCT r.owner_id, r.category FROM public.v_books_category_rules r WHERE r.section = 'Revenue') rr
         ON rr.owner_id = v.owner_id AND rr.category = v.category
  CROSS JOIN LATERAL (
    SELECT (jsonb_array_length(v.bl) > 0 OR v.local_id LIKE '%-BANK-%') AS pay,
           (SELECT coalesce(jsonb_agg(p), '[]') FROM jsonb_array_elements(v.pl) p
              WHERE p->>'kind' IN ('gmail', 'file', 'photo', 'artifact', 'receipt') OR coalesce(p->>'ref', '') ILIKE '%nuke vehicle%') AS doc_cites,
           (SELECT coalesce(jsonb_agg(p), '[]') FROM jsonb_array_elements(v.pl) p WHERE p->>'kind' = 'owner_ruling') AS ruling_cites,
           coalesce(v.record->>'ruling_id', '') AS rid,
           (v.local_id ~ 'RULING-(filed|Schedule C|car-basis)' AND jsonb_array_length(v.bl) = 0 AND jsonb_array_length(v.pl) = 0) AS summary
  ) g
  CROSS JOIN LATERAL (
    SELECT g.pay, (jsonb_array_length(g.doc_cites) > 0) AS doc,
           (g.rid <> '' OR jsonb_array_length(g.ruling_cites) > 0) AS has_ruling,
           (g.rid <> '' OR jsonb_array_length(g.ruling_cites) > 0 OR jsonb_array_length(g.doc_cites) > 0 OR rr.category IS NOT NULL) AS purpose
  ) f
), k AS (
  -- rulings_filed: the row cites at least one ruling and every ruling it cites is a summary ruling of the filed return.
  SELECT u.*,
    (u.has_owner_ruling AND (u.ruling_id = '' OR u.ruling_id ~ 'RULING-(filed|Schedule C|car-basis)')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(u.ruling_cites) c
                        WHERE NOT (split_part(coalesce(c->>'ref', ''), ':', 1) ~ 'RULING-(filed|Schedule C|car-basis)'
                                   OR coalesce(c->>'ref', '') ~* 'owner ruling on the filed [0-9]{4} schedule c'))) AS rulings_filed
  FROM u
), cl AS (
  SELECT k.*,
    CASE WHEN k.doc_proof THEN 'documented'
         WHEN k.is_summary_row OR k.rulings_filed THEN 'filed_return_only'
         WHEN k.tier IN ('A', 'B') THEN 'bank_and_rule'
         ELSE 'none' END AS basis_strength
  FROM k
), lv AS (
  -- The kind of paper a cite's words or a Nuke document_type name, as a level: 3 purchase agreement, bill of sale or title; 2 invoice or
  -- agreement; 1 receipt or order. A cited document of a higher level also satisfies a lower requirement; a vehicle's own documents are
  -- matched as df says. Underscores read as spaces (bill_of_sale), so the same words type a cite and a document_type. Keyword judgment.
  SELECT * FROM (VALUES
    (3, 'purchase agreement|purchase contract|bill of sale|buyer.?s order|\mtitle\M|consignment|sales? (agreement|contract)|\mmco\M|deal jacket'),
    (2, 'invoice|agreement|contract|work order|repair order|estimate|quote|statement of work|\mtime ?sheets?\M'),
    (1, 'receipt|\morder\M|packing slip|confirmation|\mhistory\M')
  ) l(lvl, pat)
), rq AS (
  -- The document the row's kind requires: the first rule whose pattern matches the category of a deduction with a positive amount.
  SELECT cl.*, r.rule AS required_doc_rule, r.kind AS required_doc_kind, r.lvl AS req_level
  FROM cl
  LEFT JOIN LATERAL (
    SELECT rl.rule, rl.kind, rl.lvl
    FROM (VALUES
      (1, 'depreciation',   'schedule c line 13\M|\mdepreciation\M|section 179', 'register_asset', NULL::int),
      (2, 'rent',           'schedule c line 20[ab]\M|\mrent\M', 'lease_or_ruling', NULL),
      (3, 'transport',      '\m(transport|freight|hauling|delivery)\M', 'invoice_or_agreement', 2),
      (4, 'vehicle_deal',   'acquisition|\mbought\M|\mcommissions?\M|consign|\mpurchase\M', 'purchase_agreement', 3),
      (5, 'parts_supplies', 'schedule c line 22\M|\m(parts?|materials?|supplies|tools?|equipment)\M', 'receipt_or_order', 1),
      (6, 'contractor',     'schedule c line (11|17)\M|contract labor|\mcontractors?\M|\mlabor\M|retouch|artists|professional fees|legal and professional|painting|bodywork|plating', 'invoice_or_agreement', 2),
      (7, 'cost_of_goods',  'schedule c line 4\M|cost of goods', 'invoice_or_agreement', 2)
    ) rl(ord, rule, pat, kind, lvl)
    WHERE cl.kind = 'deduction' AND cl.amount > 0 AND lower(coalesce(cl.category, '')) ~ rl.pat
    ORDER BY rl.ord LIMIT 1
  ) r ON true
), ar AS (
  -- The register asset that claims a decision (the books_year_gate R6 test reads the same view).
  SELECT r.owner_id, r.year, r.local_id, (array_agg(r.asset_id ORDER BY r.asset_id))[1] AS asset_id
  FROM public.v_books_asset_register r WHERE r.kind = 'claim'
  GROUP BY r.owner_id, r.year, r.local_id
), vd AS MATERIALIZED (
  -- The books_decision documents link_books_to_vehicles writes (file_url nuke-books://<owner>/<source_key>), parsed once.
  SELECT d.vehicle_id, (regexp_match(d.file_url, '^nuke-books://([0-9a-f-]{36})/(.+)$'))[1] AS owner_text,
         (regexp_match(d.file_url, '^nuke-books://([0-9a-f-]{36})/(.+)$'))[2] AS source_key
  FROM public.vehicle_documents d WHERE d.document_type = 'books_decision'
), vl AS (
  -- The Nuke vehicles the books tie to a decision.
  SELECT x.id AS line_id, array_agg(DISTINCT vd.vehicle_id) AS vehicle_ids
  FROM bv x
  JOIN vd ON vd.source_key = x.source_key AND vd.owner_text = x.owner_id::text
  GROUP BY x.id
), vv AS (
  SELECT DISTINCT unnest(vl.vehicle_ids) AS vehicle_id FROM vl
), nd AS (
  -- What Nuke holds for those vehicles, typed by its own document_type (existing tables, read as they are); amt is the amount the document
  -- states where the table has one (a receipt's total, a vehicle document's or listing document's amount).
  SELECT s.vehicle_id, s.source, s.doc_id, s.doc_type, s.amt,
         (SELECT max(lv.lvl) FROM lv WHERE lower(replace(s.doc_type, '_', ' ')) ~ lv.pat) AS lvl
  FROM (
    SELECT d.vehicle_id, 'vehicle_documents'::text AS source, d.id::text AS doc_id, d.document_type AS doc_type, d.amount AS amt
      FROM public.vehicle_documents d WHERE d.vehicle_id IN (SELECT vehicle_id FROM vv) AND d.document_type NOT IN ('books_decision', 'provenance_citation')
    UNION ALL
    SELECT d.vehicle_id, 'deal_documents', d.id::text, d.document_type, NULL::numeric
      FROM public.deal_documents d WHERE d.vehicle_id IN (SELECT vehicle_id FROM vv)
    UNION ALL
    SELECT l.vehicle_id, 'receipts', l.receipt_id::text, 'receipt', coalesce(r.total, r.total_amount)
      FROM public.receipt_vehicle_links l LEFT JOIN public.receipts r ON r.id = l.receipt_id
      WHERE l.vehicle_id IN (SELECT vehicle_id FROM vv) AND l.status = 'linked' AND l.retired_at IS NULL
    UNION ALL
    SELECT o.vehicle_id, 'ownership_verifications', o.id::text, 'title', NULL::numeric
      FROM public.ownership_verifications o WHERE o.vehicle_id IN (SELECT vehicle_id FROM vv) AND o.status = 'approved' AND o.title_document_url IS NOT NULL
    UNION ALL
    SELECT i.vehicle_id, 'vehicle_images', i.id::text, coalesce(i.document_classification, i.document_category, ''), NULL::numeric
      FROM public.vehicle_images i WHERE i.vehicle_id IN (SELECT vehicle_id FROM vv) AND i.is_document IS TRUE
    UNION ALL
    SELECT CASE WHEN c.vid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN c.vid::uuid END, 'secure_documents', c.id::text, c.document_type, NULL::numeric
      FROM (SELECT sd.id, sd.document_type, sd.upload_metadata->>'vehicle_id' AS vid FROM public.secure_documents sd WHERE sd.document_type = 'vehicle_title') c
      WHERE CASE WHEN c.vid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN c.vid::uuid END IN (SELECT vehicle_id FROM vv)
    UNION ALL
    SELECT d.vehicle_id, 'vehicle_listing_documents', d.id::text, coalesce(d.doc_type, ''), d.amount
      FROM public.vehicle_listing_documents d WHERE d.vehicle_id IN (SELECT vehicle_id FROM vv) AND d.revoked_at IS NULL
  ) s
), df AS (
  SELECT rq.*, vl.vehicle_ids, f.found, f.found_n
  FROM rq
  LEFT JOIN vl ON vl.line_id = rq.id
  LEFT JOIN ar ON ar.owner_id = rq.owner_id AND ar.year = rq.year AND ar.local_id = rq.local_id
  LEFT JOIN LATERAL (
    -- doc_found: up to five documents of the level the kind requires, best first; found_n counts them all.
    SELECT coalesce(jsonb_agg(z.item ORDER BY z.rn) FILTER (WHERE z.rn <= 5), '[]'::jsonb) AS found, count(*) AS found_n
    FROM (
      SELECT q.item, row_number() OVER (ORDER BY q.lvl DESC NULLS LAST, q.src, q.ident) AS rn
      FROM (
        SELECT 'proof_links'::text AS src, coalesce(p->>'ref', '') AS ident, c.lvl,
               jsonb_build_object('source', 'proof_links', 'kind', p->>'kind', 'ref', left(coalesce(p->>'ref', ''), 160), 'level', c.lvl) AS item
        FROM jsonb_array_elements(rq.document_cites) p
        CROSS JOIN LATERAL (SELECT max(lv.lvl) AS lvl FROM lv WHERE lower(replace(coalesce(p->>'ref', ''), '_', ' ')) ~ lv.pat) c
        WHERE rq.req_level IS NOT NULL AND c.lvl >= rq.req_level
        UNION ALL
        SELECT nd.source, nd.doc_id, nd.lvl,
               jsonb_build_object('source', nd.source, 'id', nd.doc_id, 'type', nd.doc_type, 'vehicle_id', nd.vehicle_id, 'level', nd.lvl)
        FROM nd
        WHERE rq.req_level IS NOT NULL AND vl.vehicle_ids IS NOT NULL AND nd.vehicle_id = ANY (vl.vehicle_ids)
          AND ((rq.req_level = 3 AND nd.lvl = 3)
               OR (rq.req_level < 3 AND nd.lvl BETWEEN rq.req_level AND 2 AND nd.amt IS NOT NULL AND abs(nd.amt) = abs(rq.amount)))
        UNION ALL
        SELECT 'proof_links', coalesce(p->>'ref', ''), NULL::int,
               jsonb_build_object('source', 'proof_links', 'kind', p->>'kind', 'ref', left(coalesce(p->>'ref', ''), 160), 'type', 'lease')
        FROM jsonb_array_elements(rq.document_cites) p
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND lower(coalesce(p->>'ref', '')) ~ 'lease|rental agreement|tenan'
        UNION ALL
        SELECT 'owner_ruling', rq.ruling_id, NULL::int, jsonb_build_object('source', 'owner_ruling', 'id', rq.ruling_id)
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND rq.has_owner_ruling AND NOT rq.rulings_filed
        UNION ALL
        SELECT 'asset_register', ar.asset_id, NULL::int, jsonb_build_object('source', 'asset_register', 'id', ar.asset_id)
        WHERE rq.required_doc_kind = 'register_asset' AND ar.asset_id IS NOT NULL
      ) q
    ) z
  ) f ON true
)
SELECT c.kind, c.owner_id, c.year,
       row_number() OVER w AS dollar_rank,
       c.local_id, c.id, c.document_id, c.amount, c.category, c.description, c.ruling_id,
       c.tier, c.pay_proof, c.doc_proof, c.purpose_proof, c.proof_basis, c.basis_strength,
       CASE WHEN c.basis_strength = 'filed_return_only' THEN 'filed_return_only'
            WHEN c.tier = 'C' AND NOT c.pay_proof THEN 'no_payment_proof'
            WHEN c.tier = 'C' THEN 'no_basis' END AS proof_flag,
       c.required_doc_kind, c.required_doc_rule, c.found AS doc_found, c.found_n AS doc_found_n,
       (c.required_doc_kind IS NOT NULL AND c.found_n = 0) AS missing_doc, jsonb_array_length(c.document_cites) AS doc_cited_n,
       c.vehicle_ids,
       round(sum(abs(c.amount)) OVER p, 2) AS year_usd,
       round(abs(c.amount) / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS share,
       round(sum(abs(c.amount)) OVER w, 2) AS cum_usd,
       round(sum(abs(c.amount)) OVER w / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS cum_share,
       (abs(c.amount) > 0 AND (sum(abs(c.amount)) OVER w - abs(c.amount)) < 0.8 * sum(abs(c.amount)) OVER p) AS in_head,
       c.payment_cites, c.document_cites, c.ruling_cites
FROM df c
WINDOW p AS (PARTITION BY c.owner_id, c.year, c.kind),
       w AS (p ORDER BY abs(c.amount) DESC, c.local_id, c.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

COMMENT ON VIEW public.v_books_large_sums IS
  'One row per deduction decision (kind deduction: the rows of v_books_audit_tiers inside the deduction denominator) and per revenue decision (kind revenue), per owner and year, ranked by dollars (dollar_rank, largest first by absolute amount). share and cum_share are over the sum of absolute amounts of that kind and year (year_usd); in_head is true while the dollars ranked above the row are under 80% of year_usd. Carries the audit-tier flags (tier, pay_proof, doc_proof, purpose_proof, proof_basis) and basis_strength: documented (a document or Nuke vehicle link), bank_and_rule (tier A or B without a document, resting on a category rule or an owner ruling that is not a filed-return summary ruling), filed_return_only (no document; the only basis is a ruling that names the filed return plus the QuickBooks category it created, or the filed return summary row itself), none (tier C and neither of the above). proof_flag is filed_return_only, no_payment_proof (tier C, no bank line), no_basis (tier C, bank line, no cited basis) or null. Documents, for deductions with a positive amount: required_doc_kind (purchase_agreement, invoice_or_agreement, receipt_or_order, register_asset, lease_or_ruling or null) and required_doc_rule name the rule that matched the category; doc_found lists up to five documents of that level cited on the row or held by Nuke for the vehicles the books tie to it (vehicle_ids, from the books_decision documents), doc_found_n counts them, doc_cited_n counts the documents the row cites of any kind, and missing_doc is true when a document is required and none was found (not cited as that kind and not found in these places; it does not mean the paper does not exist). payment_cites, document_cites and ruling_cites are the cites the flags rest on. Read by books_year_gate R12. Runs as the caller, so the financial_* row policies decide what each reader sees.';

CREATE OR REPLACE VIEW public.v_books_direction_checks WITH (security_invoker = true) AS
WITH b AS MATERIALIZED (
  -- One read of the books' records: the decisions and the bank movements, with their bank_links.
  SELECT x.owner_id, x.record_kind, x.local_id, x.year, x.section, x.status, x.category, x.record_date, x.account, x.amount_value,
         CASE WHEN jsonb_typeof(x.record->'bank_links') = 'array' THEN x.record->'bank_links' ELSE '[]'::jsonb END AS bl
  FROM public.v_financial_accounting_records x
  WHERE x.record_kind IN ('retained_ledger_decision', 'retained_bank_movement') AND x.amount_value IS NOT NULL AND x.amount_value <> 0
)
SELECT d.owner_id, d.year,
       CASE d.section WHEN 'Expense' THEN 'deduction' ELSE 'revenue' END AS kind,
       d.local_id AS decision_id, m.local_id AS movement_id,
       d.amount_value AS decision_usd, m.amount_value AS movement_usd,
       CASE d.section WHEN 'Expense' THEN 'outflow' ELSE 'inflow' END AS expected,
       CASE WHEN m.amount_value > 0 THEN 'inflow' ELSE 'outflow' END AS found,
       m.record_date AS movement_date, m.year AS movement_year, m.account AS movement_account, d.category
FROM b d
CROSS JOIN LATERAL jsonb_array_elements_text(d.bl) AS l(movement_id)
JOIN b m ON m.owner_id = d.owner_id AND m.record_kind = 'retained_bank_movement' AND m.local_id = l.movement_id
WHERE d.record_kind = 'retained_ledger_decision' AND d.section IN ('Expense', 'Revenue') AND d.amount_value > 0
  AND coalesce(d.status, '') NOT LIKE 'Closed%' AND coalesce(d.status, '') NOT LIKE 'Open allocation%'
  AND ((d.section = 'Expense' AND m.amount_value > 0) OR (d.section = 'Revenue' AND m.amount_value < 0));

COMMENT ON VIEW public.v_books_direction_checks IS
  'Direction errors in the books: a positive Expense decision linked (bank_links) to a retained bank movement that is money in, or a positive Revenue decision linked to a movement that is money out. One row per decision and movement, with both ids and both dollar amounts. Expected to be empty when the books are right. Credits, refunds and corrections (negative decisions) can legitimately link either way and are not tested; a link that names a bank line that is not a retained movement of the register cannot be tested and does not appear. Read by books_year_gate R11. Runs as the caller.';

REVOKE ALL ON public.v_books_large_sums, public.v_books_direction_checks FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_books_large_sums, public.v_books_direction_checks FROM authenticated, service_role;
GRANT SELECT ON public.v_books_large_sums, public.v_books_direction_checks TO authenticated, service_role;

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

  -- R11: direction of every linked decision (v_books_direction_checks). A positive Expense decision is an outflow and a positive Revenue
  -- decision an inflow; one linked to a bank movement the other way round fails. Negative decisions (credits, refunds, corrections) can link
  -- either way and are not tested. Assessed where the link names a retained bank movement; the links that name any other bank line are counted
  -- apart as not assessed (movements of the year and its neighbours, as in v_recs).
  WITH rs AS MATERIALIZED (
    SELECT t.id, t.kind, t.year, t.section, t.amount, t.links
    FROM jsonb_to_recordset(v_recs) AS t(id text, kind text, year text, section text, amount numeric, links jsonb)
  ),
  lk AS (
    SELECT d.id AS did, l.mid, m.amount AS mamt
    FROM rs d
    CROSS JOIN LATERAL jsonb_array_elements_text(d.links) AS l(mid)
    LEFT JOIN rs m ON m.kind = 'retained_bank_movement' AND m.id = l.mid
    WHERE d.kind = 'retained_ledger_decision' AND d.year = v_year AND d.section IN ('Expense', 'Revenue') AND d.amount > 0
  ),
  dir AS (
    SELECT c.decision_id, c.movement_id, c.decision_usd FROM public.v_books_direction_checks c WHERE c.owner_id = p_owner_id AND c.year = v_year
  ),
  s AS (
    SELECT (SELECT count(*) FROM lk) AS links, (SELECT count(DISTINCT did) FROM lk) AS decisions,
           (SELECT count(*) FROM lk WHERE mamt IS NOT NULL AND mamt <> 0) AS checked,
           (SELECT count(*) FROM lk WHERE mamt IS NULL) AS unresolved,
           (SELECT count(*) FROM dir) AS n,
           (SELECT round(coalesce(sum(q.usd), 0), 2) FROM (SELECT DISTINCT ON (decision_id) decision_usd AS usd FROM dir ORDER BY decision_id) q) AS usd,
           (SELECT coalesce(jsonb_agg(q.id), '[]') FROM (SELECT decision_id || ' -> ' || movement_id AS id FROM dir ORDER BY decision_usd DESC, decision_id LIMIT 100) q) AS ids
  )
  SELECT jsonb_build_object('rule', 'R11', 'title', 'direction: every linked deduction is an outflow and every linked revenue an inflow',
      'status', CASE WHEN s.n > 0 THEN 'fail' WHEN s.checked = 0 THEN 'not_assessed' ELSE 'pass' END,
      'n', s.n, 'amount', s.usd, 'of', greatest(s.checked, s.n),
      'detail', format('%s links on %s positive Expense and Revenue decisions of the year: %s name a retained bank movement and are tested, %s name a bank line that is not a retained movement of this register and are not assessed; %s go the wrong way (v_books_direction_checks); negative decisions can link either way and are not tested',
        s.links, s.decisions, s.checked, s.unresolved, s.n),
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
