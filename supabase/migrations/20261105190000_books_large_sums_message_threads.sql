-- v_books_large_sums: a cited message thread counts as the invoice or agreement, and as the purchase agreement.
--
-- Owner ruling, 2026-10-29 (return facts 2024:evidence-standard-texts and 2025:evidence-standard-texts): a text-message exchange that states the work (or the
-- item) and the price is the contract for that payment. For contractor and service rows it is the "invoice or agreement" the books require; for a vehicle or
-- equipment purchase it is the purchase agreement where no bill of sale exists; the title remains the ownership document. Cited as proof_links of kind file
-- (the Messages handle, date and message ids) or kind gmail / artifact where the exchange lives elsewhere.
--
-- What changes in the view, and nothing else:
--   * a cite whose ref names a message thread (Messages / chat.db, iMessage, SMS, text messages, WhatsApp, a Facebook Marketplace or Craigslist thread, a Gmail
--     or email thread) and locates it (a date or an id) satisfies required_doc_kind invoice_or_agreement and purchase_agreement. A ref that records a search with
--     no result ("searched, no message", "earliest message ...") does not. A Gmail cite counts only when its ref says thread: a bare Gmail message id does not.
--   * receipt_or_order stays strict, as do lease_or_ruling and register_asset. A thread is never typed as a title or a bill of sale.
--   * the thread is listed in doc_found (type message thread) only when no other document is found, so a bill of sale, a title or an invoice still wins.
--   * two columns are appended: doc_found_kind (the kind that satisfied the row; message thread when that is all there is) and doc_message_only (the row rests
--     on a thread alone).
-- Column order and types of the existing columns are unchanged. books_year_gate is not touched: R12 reads missing_doc, which follows. SET timeouts as in the
-- other books view migrations. Counts and before/after per year are in the pull request.

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
), ug AS MATERIALIZED (
  -- The stored R7 use groups (books-register-inputs cells use:<year>:<key>, the ones books_year_gate R7 reads): the decisions a group names are
  -- documented by its owner ruling and cites (a rent paid by bank line under a use group has the owner's ruling as its basis, the lease is behind it).
  SELECT e.owner_id, e.field_key, e.value_normalized->'value'->'cites'->>'pct' AS pct_cite, g.local_id
  FROM public.financial_document_extractions e
  JOIN public.financial_documents fd ON fd.id = e.document_id AND fd.owner_id = e.owner_id AND fd.source_filename = 'books-register-inputs.txt'
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value_normalized->'value'->'decisions') = 'array'
                                                    THEN e.value_normalized->'value'->'decisions' ELSE '[]'::jsonb END) AS g(local_id)
  WHERE NOT e.is_superseded AND e.field_key ~ '^use:' AND jsonb_typeof(e.value_normalized->'value') = 'object' AND e.value_normalized->'value' ? 'cites'
), df AS (
  SELECT rq.*, vl.vehicle_ids, f.found, f.found_n
  FROM rq
  LEFT JOIN vl ON vl.line_id = rq.id
  LEFT JOIN ar ON ar.owner_id = rq.owner_id AND ar.year = rq.year AND ar.local_id = rq.local_id
  LEFT JOIN LATERAL (
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
          FROM jsonb_array_elements(rq.document_cites) p
          CROSS JOIN LATERAL (SELECT max(lv.lvl) AS lvl FROM lv WHERE lower(replace(coalesce(p->>'ref', ''), '_', ' ')) ~ lv.pat) c
          CROSS JOIN LATERAL (SELECT lower(coalesce(p->>'ref', '')) AS r) m
        ) cc
        WHERE rq.req_level IS NOT NULL AND (cc.msg OR cc.lvl >= rq.req_level)
        UNION ALL
        SELECT nd.source, nd.doc_id, nd.lvl,
               jsonb_build_object('source', nd.source, 'id', nd.doc_id, 'type', nd.doc_type, 'vehicle_id', nd.vehicle_id, 'level', nd.lvl), false
        FROM nd
        WHERE rq.req_level IS NOT NULL AND vl.vehicle_ids IS NOT NULL AND nd.vehicle_id = ANY (vl.vehicle_ids)
          AND ((rq.req_level = 3 AND nd.lvl = 3)
               OR (rq.req_level < 3 AND nd.lvl BETWEEN rq.req_level AND 2 AND nd.amt IS NOT NULL AND abs(nd.amt) = abs(rq.amount)))
        UNION ALL
        SELECT 'proof_links', coalesce(p->>'ref', ''), NULL::int,
               jsonb_build_object('source', 'proof_links', 'kind', p->>'kind', 'ref', left(coalesce(p->>'ref', ''), 160), 'type', 'lease'), false
        FROM jsonb_array_elements(rq.document_cites) p
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND lower(coalesce(p->>'ref', '')) ~ 'lease|rental agreement|tenan'
        UNION ALL
        SELECT 'owner_ruling', rq.ruling_id, NULL::int, jsonb_build_object('source', 'owner_ruling', 'id', rq.ruling_id), false
        WHERE rq.required_doc_kind = 'lease_or_ruling' AND rq.has_owner_ruling AND NOT rq.rulings_filed
        UNION ALL
        SELECT 'use_group', ug.field_key, NULL::int, jsonb_build_object('source', 'use_group', 'id', ug.field_key, 'ref', left(coalesce(ug.pct_cite, ''), 160)), false
        FROM ug WHERE rq.required_doc_kind = 'lease_or_ruling' AND ug.owner_id = rq.owner_id AND ug.local_id = rq.local_id
        UNION ALL
        SELECT 'asset_register', ar.asset_id, NULL::int, jsonb_build_object('source', 'asset_register', 'id', ar.asset_id), false
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
       c.payment_cites, c.document_cites, c.ruling_cites,
       -- The kind of document that satisfied the row (the best one found): the level's name for a cited document, Nuke's own document type, 'message thread'
       -- when a cited message thread is all there is, or the source (lease, owner_ruling, use_group, asset_register).
       CASE WHEN c.found_n = 0 THEN NULL
            WHEN c.found->0->>'type' = 'message thread' THEN 'message thread'
            WHEN c.found->0->>'source' = 'proof_links' AND c.found->0->>'type' IS NULL THEN
                 CASE c.found->0->>'level' WHEN '3' THEN 'purchase agreement, bill of sale or title' WHEN '2' THEN 'invoice or agreement' WHEN '1' THEN 'receipt or order' END
            ELSE coalesce(c.found->0->>'type', c.found->0->>'source') END AS doc_found_kind,
       (c.found_n > 0 AND coalesce(c.found->0->>'type', '') = 'message thread') AS doc_message_only
FROM df c
WINDOW p AS (PARTITION BY c.owner_id, c.year, c.kind),
       w AS (p ORDER BY abs(c.amount) DESC, c.local_id, c.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

COMMENT ON VIEW public.v_books_large_sums IS
  'One row per deduction decision (kind deduction: the rows of v_books_audit_tiers inside the deduction denominator) and per revenue decision (kind revenue), per owner and year, ranked by dollars (dollar_rank, largest first by absolute amount). share and cum_share are over the sum of absolute amounts of that kind and year (year_usd); in_head is true while the dollars ranked above the row are under 80% of year_usd. Carries the audit-tier flags (tier, pay_proof, doc_proof, purpose_proof, proof_basis) and basis_strength: documented (a document or Nuke vehicle link), bank_and_rule (tier A or B without a document, resting on a category rule or an owner ruling that is not a filed-return summary ruling), filed_return_only (no document; the only basis is a ruling that names the filed return plus the QuickBooks category it created, or the filed return summary row itself), none (tier C and neither of the above). proof_flag is filed_return_only, no_payment_proof (tier C, no bank line), no_basis (tier C, bank line, no cited basis) or null. Documents, for deductions with a positive amount: required_doc_kind (purchase_agreement, invoice_or_agreement, receipt_or_order, register_asset, lease_or_ruling or null) and required_doc_rule name the rule that matched the category; doc_found lists up to five documents of that level cited on the row or held by Nuke for the vehicles the books tie to it (vehicle_ids, from the books_decision documents), doc_found_n counts them, doc_cited_n counts the documents the row cites of any kind, and missing_doc is true when a document is required and none was found (not cited as that kind and not found in these places; it does not mean the paper does not exist). Rent (lease_or_ruling) is documented by a lease among the cited documents, by an owner ruling that is not a filed-return summary ruling, or by a stored R7 use group that names the decision (source use_group); vehicle and contractor rows stay strict. payment_cites, document_cites and ruling_cites are the cites the flags rest on. Read by books_year_gate R12. A cited message thread (the ref names Messages / chat.db, iMessage, SMS, text messages, WhatsApp, a Facebook Marketplace or Craigslist thread, or a Gmail thread, and a date or an id; a cite of a search with no result does not count) counts as the invoice or agreement and as the purchase agreement, never as a receipt or order, a lease, a register asset or a title, and is listed only when nothing else is found. doc_found_kind names the kind that satisfied the row (message thread when that is all there is) and doc_message_only is true for the rows that rest on a message thread alone. Runs as the caller, so the financial_* row policies decide what each reader sees.';
