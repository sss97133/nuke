-- Tier A means the document the row's kind requires (v_books_audit_tiers and v_books_large_sums agree).
--
-- doc_proof in v_books_audit_tiers was "the row cites a document of any kind", so landing any proof link made a row tier A even when books_year_gate R12 (through
-- v_books_large_sums) still flagged it as missing the document its kind requires: a row could read tier A and flagged at once. The document layer is one
-- implementation now, and it lives here:
--   * required_doc_kind / required_doc_rule / doc_found / doc_found_n / doc_found_kind / doc_message_only / missing_doc / vehicle_ids move in from
--     v_books_large_sums unchanged (the rule that matches the category, the cites and the Nuke documents that meet it, a cited message thread, a rent
--     documented by a lease, an owner ruling or a use group, a register asset). v_books_large_sums now reads them from this view.
--   * doc_proof = doc_cited AND NOT missing_doc, and tier A needs doc_proof. doc_cited keeps the old meaning, a document is cited, and purpose_proof still uses it:
--     a row that cites a document that does not meet its kind keeps its purpose basis, so it falls from A to B, never to C.
--   * Nothing is promoted: a row with nothing cited stays B (or C) even where Nuke, a ruling or a use group holds the document R12 asks for.
--   * tier_reason says why a row fell: the cited document does not meet the <kind> requirement.
-- v_books_vehicle_links (new, below) is the one implementation of "the Nuke vehicles the books tie to a decision" both views read.
-- Cost: the layer used to run inside v_books_large_sums, which read this view. It runs here once and v_books_large_sums reads it, so reading this view costs a little
-- more and v_books_large_sums about a third less. The lookup of documents is skipped for the rows that cannot have one (no cite, no Nuke vehicle, and not a lease
-- or register-asset row); the rule that matches a category is one CASE, not a table of patterns joined to every row; the vehicle links are read once, not run again
-- for every row. Counts, timings and the effect per year are in the pull request. SET timeouts as in the other books view migrations (the lock wait is longer: the
-- gate holds these views for about ten seconds).

SET lock_timeout = '30s';
SET statement_timeout = '120s';

-- The books_decision documents link_books_to_vehicles writes (file_url nuke-books://<owner>/<source_key>), one row per owner and source key with the vehicles tied to it.
CREATE OR REPLACE VIEW public.v_books_vehicle_links WITH (security_invoker = true) AS
SELECT p.owner_id, p.source_key, array_agg(DISTINCT p.vehicle_id) AS vehicle_ids
FROM (
  SELECT d.vehicle_id,
         CASE WHEN (regexp_match(d.file_url, '^nuke-books://([0-9a-f-]{36})/(.+)$'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (regexp_match(d.file_url, '^nuke-books://([0-9a-f-]{36})/(.+)$'))[1]::uuid END AS owner_id,
         (regexp_match(d.file_url, '^nuke-books://([0-9a-f-]{36})/(.+)$'))[2] AS source_key
  FROM public.vehicle_documents d WHERE d.document_type = 'books_decision'
) p
WHERE p.owner_id IS NOT NULL AND p.source_key IS NOT NULL
GROUP BY p.owner_id, p.source_key;

COMMENT ON VIEW public.v_books_vehicle_links IS
  'The Nuke vehicles the books tie to a decision: one row per owner and source_key (the books_decision documents link_books_to_vehicles writes, file_url nuke-books://<owner>/<source_key>), with the vehicle ids. A decision is tied through its own owner_id and source_key. Read by v_books_audit_tiers (the documents Nuke holds for those vehicles) and v_books_large_sums (vehicle_ids). Runs as the caller.';

REVOKE ALL ON public.v_books_vehicle_links FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_books_vehicle_links FROM authenticated, service_role;
GRANT SELECT ON public.v_books_vehicle_links TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_books_audit_tiers WITH (security_invoker = true) AS
WITH recs AS MATERIALIZED (
  -- The one read of the accounting records this view makes directly: every decision and bank movement of every current extraction. ra (twice), d and nd below read
  -- this set instead of each running the base view again (the base view costs about 0.3 s per read; the view used to run it four times itself).
  SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.record_kind, v.section, v.status, v.category, v.description, v.decision, v.amount_value, v.source_key, v.record
  FROM public.v_financial_accounting_records v
  WHERE v.record_kind IN ('retained_ledger_decision', 'retained_bank_movement')
), rc AS MATERIALIZED (
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
    FROM recs v
    WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND v.local_id ~ '-RULING-snapon-ra-payments$'
      AND jsonb_typeof(v.record->'bank_links') = 'array' AND jsonb_array_length(v.record->'bank_links') > 0
    ORDER BY v.owner_id, v.year, v.local_id
  ) x
  CROSS JOIN LATERAL jsonb_array_elements_text(x.links) AS l(id)
  JOIN recs m ON m.owner_id = x.owner_id AND m.local_id = l.id AND m.record_kind = 'retained_bank_movement' AND m.year::text = x.year
  GROUP BY x.owner_id, x.year, x.ra_id
), d AS (
  SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.amount_value AS amount, v.category, v.description, v.status, v.record, v.source_key,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '')) AS t,
         lower(coalesce(v.category, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.status, '') || ' ' || coalesce(v.decision, '')) AS tt,
         CASE WHEN jsonb_typeof(v.record->'bank_links') = 'array' THEN v.record->'bank_links' ELSE '[]'::jsonb END AS bl,
         CASE WHEN jsonb_typeof(v.record->'proof_links') = 'array' THEN v.record->'proof_links' ELSE '[]'::jsonb END AS pl,
         coalesce(v.record->>'account', '') AS acct, coalesce(v.decision, '') AS decision_text
  FROM recs v
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
  SELECT f.*, (jsonb_array_length(f.doc_cites) > 0) AS doc_cited,
         (f.has_ruling_id OR jsonb_array_length(f.ruling_cites) > 0) AS has_owner_ruling
  FROM f
), h AS (
  SELECT g.*, (g.has_owner_ruling OR g.vehicle_link OR g.doc_cited OR jsonb_array_length(g.rule_cites) > 0) AS purpose_proof,
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
    FROM recs m
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
), lv AS (
  -- The kind of paper a cite's words or a Nuke document_type name, as a level: 3 purchase agreement, bill of sale or title; 2 invoice or
  -- agreement; 1 receipt or order. A cited document of a higher level also satisfies a lower requirement; a vehicle's own documents are
  -- matched as df says. Underscores read as spaces (bill_of_sale), so the same words type a cite and a document_type. Keyword judgment.
  SELECT * FROM (VALUES
    (3, 'purchase agreement|purchase contract|bill of sale|buyer.?s order|\mtitle\M|consignment|sales? (agreement|contract)|\mmco\M|deal jacket'),
    (2, 'invoice|agreement|contract|work order|repair order|estimate|quote|statement of work|\mtime ?sheets?\M'),
    (1, 'receipt|\morder\M|packing slip|confirmation|\mhistory\M')
  ) l(lvl, pat)
), vlk AS MATERIALIZED (
  -- The Nuke vehicles the books tie to a decision (v_books_vehicle_links), read once: joined as a view it would run again for every row.
  SELECT v.owner_id, v.source_key, v.vehicle_ids FROM public.v_books_vehicle_links v
), vv AS (
  -- The vehicles the books tie to a decision (nd reads only those vehicles' documents).
  SELECT DISTINCT unnest(k.vehicle_ids) AS vehicle_id FROM vlk k
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
), ug AS MATERIALIZED (
  -- The stored R7 use groups (books-register-inputs cells use:<year>:<key>, the ones books_year_gate R7 reads): the decisions a group names are
  -- documented by its owner ruling and cites (a rent paid by bank line under a use group has the owner's ruling as its basis, the lease is behind it).
  SELECT e.owner_id, e.field_key, e.value_normalized->'value'->'cites'->>'pct' AS pct_cite, g.local_id
  FROM public.financial_document_extractions e
  JOIN public.financial_documents fd ON fd.id = e.document_id AND fd.owner_id = e.owner_id AND fd.source_filename = 'books-register-inputs.txt'
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value_normalized->'value'->'decisions') = 'array'
                                                    THEN e.value_normalized->'value'->'decisions' ELSE '[]'::jsonb END) AS g(local_id)
  WHERE NOT e.is_superseded AND e.field_key ~ '^use:' AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
), rq AS (
  -- The document the row's kind requires: the first rule whose pattern matches the category of a deduction with a positive amount. o.ord is the rule's number (the
  -- patterns below, in the order of the policy); the arrays read its name, the kind of paper and the level (3 purchase agreement, bill of sale or title; 2 invoice or
  -- agreement; 1 receipt or order). A CASE rather than a table of patterns joined for every row: the same first match, without a sort and a limit per row. OFFSET 0 keeps
  -- the number computed once per row (an inlined CASE would be worked out again at each use).
  SELECT w.*, (ARRAY['depreciation', 'rent', 'transport', 'vehicle_deal', 'parts_supplies', 'contractor', 'cost_of_goods'])[o.ord] AS required_doc_rule, (ARRAY['register_asset', 'lease_or_ruling', 'invoice_or_agreement', 'purchase_agreement', 'receipt_or_order', 'invoice_or_agreement', 'invoice_or_agreement'])[o.ord] AS required_doc_kind,
         (ARRAY[NULL, NULL, 2, 3, 1, 2, 2])[o.ord] AS req_level,
         CASE WHEN (w.owner_id, w.source_key) IN (SELECT k.owner_id, k.source_key FROM vlk k)
              THEN (SELECT k.vehicle_ids FROM vlk k WHERE k.owner_id = w.owner_id AND k.source_key = w.source_key) END AS vehicle_ids,
         coalesce(w.record->>'ruling_id', '') AS rid,
         -- rulings_filed: the row cites at least one ruling and every ruling it cites is a summary ruling of the filed return (the same test v_books_large_sums
         -- applies to its Revenue rows).
         (w.has_owner_ruling AND (coalesce(w.record->>'ruling_id', '') = '' OR w.record->>'ruling_id' ~ 'RULING-(filed|Schedule C|car-basis)')
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w.ruling_cites) c
                             WHERE NOT (split_part(coalesce(c->>'ref', ''), ':', 1) ~ 'RULING-(filed|Schedule C|car-basis)'
                                        OR coalesce(c->>'ref', '') ~* 'owner ruling on the filed [0-9]{4} schedule c'))) AS rulings_filed
  FROM w
  CROSS JOIN LATERAL (SELECT lower(coalesce(w.category, '')) AS cat) cg
  CROSS JOIN LATERAL (SELECT CASE WHEN w.is_deduction AND w.amount > 0 THEN CASE
           WHEN cg.cat ~ 'schedule c line 13\M|\mdepreciation\M|section 179' THEN 1   -- depreciation
           WHEN cg.cat ~ 'schedule c line 20[ab]\M|\mrent\M' THEN 2   -- rent
           WHEN cg.cat ~ '\m(transport|freight|hauling|delivery)\M' THEN 3   -- transport
           WHEN cg.cat ~ 'acquisition|\mbought\M|\mcommissions?\M|consign|\mpurchase\M' THEN 4   -- vehicle_deal
           WHEN cg.cat ~ 'schedule c line 22\M|\m(parts?|materials?|supplies|tools?|equipment)\M' THEN 5   -- parts_supplies
           WHEN cg.cat ~ 'schedule c line (11|17)\M|contract labor|\mcontractors?\M|\mlabor\M|retouch|artists|professional fees|legal and professional|painting|bodywork|plating' THEN 6   -- contractor
           WHEN cg.cat ~ 'schedule c line 4\M|cost of goods' THEN 7   -- cost_of_goods
         END END AS ord OFFSET 0) o
), df AS (
  SELECT rq.*, x.found, x.found_n
  FROM rq
  -- The documents found are worked out for the rows that require one and could have one: a cite, a Nuke vehicle, or a kind with its own source (lease, register asset).
  -- Every other row finds none, as before, without running the lookup. OFFSET 0 keeps the result computed once per row.
  CROSS JOIN LATERAL (SELECT coalesce(g.j->'found', '[]'::jsonb) AS found, coalesce((g.j->>'n')::bigint, 0) AS found_n FROM (SELECT CASE WHEN rq.required_doc_kind IS NOT NULL AND (jsonb_array_length(rq.doc_cites) > 0 OR rq.vehicle_ids IS NOT NULL OR rq.required_doc_kind IN ('lease_or_ruling', 'register_asset')) THEN (
    SELECT jsonb_build_object('found', f.found, 'n', f.found_n) FROM (
    -- doc_found: up to five documents of the level the kind requires, best first; found_n counts them all.
    -- A cited message thread counts as the invoice or agreement and as the purchase agreement (owner ruling 2026-10-29, facts <year>:evidence-standard-texts):
    -- the ref names the medium (Messages / chat.db, iMessage, SMS, text messages, WhatsApp, a Facebook Marketplace or Craigslist thread, a Gmail or email
    -- thread) and locates the exchange by a date or an id; a cite that records a search with no result does not count. It never counts as a receipt or
    -- order, a lease, a register asset or a title. It is listed (type 'message thread') only when no other document is found, so the rows that rest on a
    -- thread alone are the rows with doc_message_only.
    SELECT coalesce(jsonb_agg(z.item ORDER BY z.rn) FILTER (WHERE z.rn <= 5 AND (NOT z.is_msg OR z.real_n = 0)), '[]'::jsonb) AS found,
           count(*) FILTER (WHERE NOT z.is_msg OR z.real_n = 0) AS found_n
    FROM (
      SELECT q.item, q.is_msg, row_number() OVER (ORDER BY q.is_msg, q.lvl DESC NULLS LAST, q.src, q.ident) AS rn,
             count(*) FILTER (WHERE NOT q.is_msg) OVER () AS real_n
      FROM (
        SELECT 'proof_links'::text AS src, coalesce(cc.p->>'ref', '') AS ident,
               CASE WHEN cc.msg THEN rq.req_level ELSE cc.lvl END AS lvl,
               CASE WHEN cc.msg THEN jsonb_build_object('source', 'proof_links', 'kind', cc.p->>'kind', 'ref', left(coalesce(cc.p->>'ref', ''), 160), 'type', 'message thread', 'level', rq.req_level)
                    ELSE jsonb_build_object('source', 'proof_links', 'kind', cc.p->>'kind', 'ref', left(coalesce(cc.p->>'ref', ''), 160), 'level', cc.lvl) END AS item,
               cc.msg AS is_msg
        FROM (
          SELECT p, c.lvl,
                 (rq.required_doc_kind IN ('invoice_or_agreement', 'purchase_agreement')
                  AND (m.r ~ 'chat\.db|library/messages|\mmessages? handle|\mi-?messages?\M|\msms\M|\mtext messages?\M|\mtext (thread|exchange|conversation)\M|\mtexts (with|from|to|between)\M|\mtexted\M|whatsapp|\m(facebook|fb) (messenger|messages?|chat)\M|\mmessenger\M|\m(marketplace|craigslist)\M.{0,40}\m(thread|messages?|chat|conversation|repl(y|ies)|exchange)\M|\m(thread|messages?|chat|conversation|exchange)\M.{0,40}\m(marketplace|craigslist)\M|\m(gmail|e-?mail) (thread|exchange|chain)\M'
                       OR (p->>'kind' = 'gmail' AND m.r ~ '\mthread\M'))
                  AND m.r !~ 'searched,? no |earliest message|nothing found|none found|not found|found nothing|\mno (relevant |matching |such |cash-use |other )?(messages?|chat|texts?|evidence|threads?|hits?|results?|matches)\M'
                  AND m.r ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}|\m(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* [0-9]{1,2}\M|\m[0-9]{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\M|[0-9]{5,}|\m[0-9a-f]{12,}\M') AS msg
          FROM jsonb_array_elements(rq.doc_cites) p
          CROSS JOIN LATERAL (SELECT max(lv.lvl) AS lvl FROM lv WHERE lower(replace(coalesce(p->>'ref', ''), '_', ' ')) ~ lv.pat) c
          CROSS JOIN LATERAL (SELECT lower(coalesce(p->>'ref', '')) AS r) m
        ) cc
        WHERE rq.req_level IS NOT NULL AND (cc.msg OR cc.lvl >= rq.req_level)
        UNION ALL
        SELECT nd.source, nd.doc_id, nd.lvl,
               jsonb_build_object('source', nd.source, 'id', nd.doc_id, 'type', nd.doc_type, 'vehicle_id', nd.vehicle_id, 'level', nd.lvl), false
        FROM nd
        WHERE rq.req_level IS NOT NULL AND rq.vehicle_ids IS NOT NULL AND nd.vehicle_id = ANY (rq.vehicle_ids)
          AND ((rq.req_level = 3 AND nd.lvl = 3)
               OR (rq.req_level < 3 AND nd.lvl BETWEEN rq.req_level AND 2 AND nd.amt IS NOT NULL AND abs(nd.amt) = abs(rq.amount)))
        UNION ALL
        SELECT 'proof_links', coalesce(p->>'ref', ''), NULL::int,
               jsonb_build_object('source', 'proof_links', 'kind', p->>'kind', 'ref', left(coalesce(p->>'ref', ''), 160), 'type', 'lease'), false
        FROM jsonb_array_elements(rq.doc_cites) p
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND lower(coalesce(p->>'ref', '')) ~ 'lease|rental agreement|tenan'
        UNION ALL
        SELECT 'owner_ruling', rq.rid, NULL::int, jsonb_build_object('source', 'owner_ruling', 'id', rq.rid), false
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND rq.has_owner_ruling AND NOT rq.rulings_filed
        UNION ALL
        SELECT 'use_group', ug.field_key, NULL::int, jsonb_build_object('source', 'use_group', 'id', ug.field_key, 'ref', left(coalesce(ug.pct_cite, ''), 160)), false
        FROM ug WHERE rq.required_doc_kind = 'lease_or_ruling' AND ug.owner_id = rq.owner_id AND ug.local_id = rq.local_id
        UNION ALL
        SELECT 'asset_register', rq.asset_id, NULL::int, jsonb_build_object('source', 'asset_register', 'id', rq.asset_id), false
        WHERE rq.required_doc_kind = 'register_asset' AND rq.asset_id IS NOT NULL
      ) q
    ) z
    ) f) END AS j OFFSET 0) g) x
), wd AS (
  -- doc_proof: the row cites a document AND the documents found meet the kind the row requires (the tier A test). doc_cited is the plain "a document is cited"
  -- that purpose_proof keeps using.
  SELECT df.*, (df.required_doc_kind IS NOT NULL AND df.found_n = 0) AS missing_doc,
         (df.doc_cited AND NOT (df.required_doc_kind IS NOT NULL AND df.found_n = 0)) AS doc_proof
  FROM df
), z AS (
  SELECT w.*,
    CASE WHEN NOT w.is_deduction THEN 'X'
         WHEN w.pay_final AND w.purpose_proof THEN CASE WHEN w.doc_proof THEN 'A' ELSE 'B' END
         WHEN w.structural_rule IN ('asset_register', 'owner_ruling_aggregate') THEN 'B'
         ELSE 'C' END AS tier_final,
    -- was tier A before the kind test, and is B now: it cites a document that does not meet the kind the row requires
    (w.is_deduction AND w.pay_final AND w.purpose_proof AND w.doc_cited AND NOT w.doc_proof) AS demoted
  FROM wd w
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
       ELSE 'bank line and a cited allocation basis (' || CASE WHEN t.has_owner_ruling THEN 'owner ruling' WHEN t.vehicle_link THEN 'Nuke vehicle'
                                                               WHEN jsonb_array_length(t.rule_cites) > 0 THEN 'category rule' ELSE 'cited document' END || ')'
            || CASE WHEN t.demoted THEN '; the cited document does not meet the ' || t.required_doc_kind || ' requirement' ELSE '' END END AS tier_reason,
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
  END AS proof_basis,
  -- The document layer (moved here from v_books_large_sums, which now reads it from this view): the kind of paper the row's category requires, what was found for it,
  -- and whether it is missing. doc_proof above is doc_cited and not missing_doc.
  t.doc_cited, t.required_doc_kind, t.required_doc_rule, t.found AS doc_found, t.found_n AS doc_found_n,
  -- The kind of document that satisfied the row (the best one found): the level's name for a cited document, Nuke's own document type, 'message thread'
  -- when a cited message thread is all there is, or the source (lease, owner_ruling, use_group, asset_register).
  CASE WHEN t.found_n = 0 THEN NULL
       WHEN t.found->0->>'type' = 'message thread' THEN 'message thread'
       WHEN t.found->0->>'source' = 'proof_links' AND t.found->0->>'type' IS NULL THEN
            CASE t.found->0->>'level' WHEN '3' THEN 'purchase agreement, bill of sale or title' WHEN '2' THEN 'invoice or agreement' WHEN '1' THEN 'receipt or order' END
       ELSE coalesce(t.found->0->>'type', t.found->0->>'source') END AS doc_found_kind,
  (t.found_n > 0 AND coalesce(t.found->0->>'type', '') = 'message thread') AS doc_message_only,
  t.missing_doc, t.vehicle_ids
FROM z t
LEFT JOIN public.v_books_structural_rules sr ON sr.rule = t.structural_rule;

COMMENT ON VIEW public.v_books_audit_tiers IS
  'One row per Expense decision of the current books with its audit tier: A bank line + cited allocation basis + the document the row''s kind requires (doc_proof: a cited document and none missing, the same test books_year_gate R12 applies through v_books_large_sums); B bank line + cited allocation basis, or (proof_basis asset_register / owner_ruling, pay_proof false) a cited asset register or owner ruling with no bank line, which the rollup reports apart as b_nobank; C no bank line or no basis; X outside the deduction denominator (is_deduction false). A row that cites a document that does not meet its kind is B (doc_cited true, doc_proof false). Structural rows cite a rule of v_books_structural_rules (structural_rule, structural_cites). Section 274 / cash / contractor / caveat flags, the reason and the cites used. Documents, for deductions with a positive amount: required_doc_kind (purchase_agreement, invoice_or_agreement, receipt_or_order, register_asset, lease_or_ruling or null) and required_doc_rule name the rule that matched the category; doc_found lists up to five documents of that level (cited on the row, or held by Nuke for the vehicles the books tie to it, vehicle_ids), doc_found_n counts them, doc_found_kind names the kind that satisfied the row (message thread when a cited message thread is all there is, doc_message_only) and missing_doc is true when a document is required and none was found. Runs as the caller.';

CREATE OR REPLACE VIEW public.v_books_large_sums WITH (security_invoker = true) AS
WITH bv AS MATERIALIZED (
  -- One read of the books' decision records, used for the Revenue rows (the deduction rows come from the audit tiers).
  SELECT x.id, x.owner_id, x.document_id, x.year, x.local_id, x.section, x.category, x.description, x.status, x.amount_value, x.source_key, x.record
  FROM public.v_financial_accounting_records x
  WHERE x.record_kind = 'retained_ledger_decision'
), vlk AS MATERIALIZED (
  -- The Nuke vehicles the books tie to a decision (v_books_vehicle_links), read once for the Revenue rows (the deduction rows carry their own from the audit tiers).
  SELECT v.owner_id, v.source_key, v.vehicle_ids FROM public.v_books_vehicle_links v
), u AS (
  -- Deductions: the audit tiers' own rows (one implementation of pay_proof, doc_proof, purpose_proof, proof_basis and the document layer: required_doc_kind,
  -- doc_found, missing_doc, vehicle_ids). Tier A and this view agree because both read doc_proof from there.
  -- pay_proof is coalesced: the tier view leaves it NULL for a row with no bank line and no structural rule.
  SELECT 'deduction'::text AS kind, t.owner_id, t.year, t.id, t.document_id, t.local_id, t.amount, t.category, t.description, t.tier,
         coalesce(t.pay_proof, false) AS pay_proof, t.doc_proof, t.purpose_proof, t.proof_basis, t.has_owner_ruling, t.ruling_id,
         t.payment_cites, t.document_cites, t.ruling_cites, t.is_summary_row,
         t.required_doc_kind, t.required_doc_rule, t.doc_found AS found, t.doc_found_n AS found_n, t.doc_found_kind, t.doc_message_only, t.missing_doc, t.vehicle_ids
  FROM public.v_books_audit_tiers t
  WHERE t.is_deduction
  UNION ALL
  -- Revenue: the same flags from the same record fields and definitions as the tier view (which covers Expense only).
  SELECT 'revenue'::text, v.owner_id, v.year, v.id, v.document_id, v.local_id, v.amount_value, v.category, v.description,
         CASE WHEN f.pay AND f.purpose THEN CASE WHEN f.doc THEN 'A' ELSE 'B' END ELSE 'C' END,
         f.pay, f.doc, f.purpose, CASE WHEN f.pay AND f.purpose THEN 'bank_line' END, f.has_ruling, g.rid,
         v.bl, g.doc_cites, g.ruling_cites, g.summary,
         NULL::text, NULL::text, '[]'::jsonb, 0::bigint, NULL::text, false, false, vl.vehicle_ids
  FROM (
    SELECT x.*, CASE WHEN jsonb_typeof(x.record->'bank_links') = 'array' THEN x.record->'bank_links' ELSE '[]'::jsonb END AS bl,
                CASE WHEN jsonb_typeof(x.record->'proof_links') = 'array' THEN x.record->'proof_links' ELSE '[]'::jsonb END AS pl
    FROM bv x
    WHERE x.section = 'Revenue' AND x.amount_value IS NOT NULL
      AND coalesce(x.status, '') NOT LIKE 'Closed%' AND coalesce(x.status, '') NOT LIKE 'Open allocation%'
  ) v
  LEFT JOIN (SELECT DISTINCT r.owner_id, r.category FROM public.v_books_category_rules r WHERE r.section = 'Revenue') rr
         ON rr.owner_id = v.owner_id AND rr.category = v.category
  LEFT JOIN vlk vl ON vl.owner_id = v.owner_id AND vl.source_key = v.source_key
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
)
SELECT c.kind, c.owner_id, c.year,
       row_number() OVER w AS dollar_rank,
       c.local_id, c.id, c.document_id, c.amount, c.category, c.description, c.ruling_id,
       c.tier, c.pay_proof, c.doc_proof, c.purpose_proof, c.proof_basis, c.basis_strength,
       CASE WHEN c.basis_strength = 'filed_return_only' THEN 'filed_return_only'
            WHEN c.tier = 'C' AND NOT c.pay_proof THEN 'no_payment_proof'
            WHEN c.tier = 'C' THEN 'no_basis' END AS proof_flag,
       c.required_doc_kind, c.required_doc_rule, c.found AS doc_found, c.found_n AS doc_found_n,
       c.missing_doc, jsonb_array_length(c.document_cites) AS doc_cited_n,
       c.vehicle_ids,
       round(sum(abs(c.amount)) OVER p, 2) AS year_usd,
       round(abs(c.amount) / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS share,
       round(sum(abs(c.amount)) OVER w, 2) AS cum_usd,
       round(sum(abs(c.amount)) OVER w / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS cum_share,
       (abs(c.amount) > 0 AND (sum(abs(c.amount)) OVER w - abs(c.amount)) < 0.8 * sum(abs(c.amount)) OVER p) AS in_head,
       c.payment_cites, c.document_cites, c.ruling_cites,
       c.doc_found_kind, c.doc_message_only
FROM cl c
WINDOW p AS (PARTITION BY c.owner_id, c.year, c.kind),
       w AS (p ORDER BY abs(c.amount) DESC, c.local_id, c.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

COMMENT ON VIEW public.v_books_large_sums IS
  'One row per deduction decision (kind deduction: the rows of v_books_audit_tiers inside the deduction denominator) and per revenue decision (kind revenue), per owner and year, ranked by dollars (dollar_rank, largest first by absolute amount). share and cum_share are over the sum of absolute amounts of that kind and year (year_usd); in_head is true while the dollars ranked above the row are under 80% of year_usd. Carries the audit-tier flags (tier, pay_proof, doc_proof, purpose_proof, proof_basis) and basis_strength: documented (doc_proof: the row cites a document and the documents found meet the kind its category requires), bank_and_rule (tier A or B without a document, resting on a category rule or an owner ruling that is not a filed-return summary ruling), filed_return_only (no document; the only basis is a ruling that names the filed return plus the QuickBooks category it created, or the filed return summary row itself), none (tier C and neither of the above). proof_flag is filed_return_only, no_payment_proof (tier C, no bank line), no_basis (tier C, bank line, no cited basis) or null. Documents, for deductions with a positive amount: required_doc_kind (purchase_agreement, invoice_or_agreement, receipt_or_order, register_asset, lease_or_ruling or null) and required_doc_rule name the rule that matched the category; doc_found lists up to five documents of that level cited on the row or held by Nuke for the vehicles the books tie to it (vehicle_ids, from the books_decision documents), doc_found_n counts them, doc_cited_n counts the documents the row cites of any kind, and missing_doc is true when a document is required and none was found (not cited as that kind and not found in these places; it does not mean the paper does not exist). Rent (lease_or_ruling) is documented by a lease among the cited documents, by an owner ruling that is not a filed-return summary ruling, or by a stored R7 use group that names the decision (source use_group); vehicle and contractor rows stay strict. payment_cites, document_cites and ruling_cites are the cites the flags rest on. Read by books_year_gate R12. A cited message thread (the ref names Messages / chat.db, iMessage, SMS, text messages, WhatsApp, a Facebook Marketplace or Craigslist thread, or a Gmail thread, and a date or an id; a cite of a search with no result does not count) counts as the invoice or agreement and as the purchase agreement, never as a receipt or order, a lease, a register asset or a title, and is listed only when nothing else is found. doc_found_kind names the kind that satisfied the row (message thread when that is all there is) and doc_message_only is true for the rows that rest on a message thread alone. The document columns (required_doc_kind, doc_found, doc_found_n, doc_found_kind, doc_message_only, missing_doc, vehicle_ids) are read from v_books_audit_tiers, so tier A there and the flags here agree: a deduction cannot be tier A and missing_doc at once. Runs as the caller, so the financial_* row policies decide what each reader sees.';
