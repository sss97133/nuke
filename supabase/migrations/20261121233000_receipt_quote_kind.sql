-- receipt_doc_kind 'quote': an estimate, quote or agreement is quoted money, never spent money.
--
-- Why. land_document_pages accepts document type 'estimate', but nothing downstream told an estimate from a purchase:
-- receipt_doc_kind had no quote value, and receipts_set_document_kind passed only the top-level document_type to the
-- classifier, while the lander writes it at raw_extraction.data.document_type and raw_json.data_v2.document_type. So a
-- landed estimate classified 'parts_service' (part words in its lines) or 'unknown', neither excluded; the fold linked it
-- (cited_document); receipt_work_lines and vehicle_build_reconstruction read every linked receipt's priced lines; and a
-- quote with three alternative options would have shown on the garage card as "On N receipts $X" and as part lines.
-- Every other reader that sums receipt money for a car or a person had the same hole.
--
-- What changes.
--   1. receipt_doc_kind gains 'quote'. receipt_doc_kind_quoted(k) names it. It is NOT added to receipt_doc_kind_excluded:
--      that predicate retires the vehicle link (receipt_vehicle_links_enforce, receipts_document_kind_links), and a quote
--      stays linked to its car so the car can show what was quoted.
--   2. Rule quote_doctype (priority 0, field doctype): a document typed estimate, quote, quotation, agreement or proposal
--      is a quote. It reads the type only, never the words: paid invoices print "Org. Estimate" or "Quotation No." and a
--      priced work order with a card payment is spend. receipts_set_document_kind now passes the nested document types too.
--      Dry run over all 2,510 receipts, 2026-11-21 (read-only): 0 would become quote; 80 gain a visible nested type and no
--      existing doctype rule newly matches any of them, so no row changes kind.
--   3. land_document_pages accepts doc_type 'quote' and 'agreement' beside 'estimate'.
--   4. Every reader that sums receipt money or receipt lines leaves quote documents out (one predicate, ANDed in):
--      receipt_work_lines (and so vehicle_build_reconstruction's totals, systems and lines), get_vehicle_total_invested,
--      vehicle_machine_shop_lines, compute_vehicle_investment_proof, get_vehicle_investment_timeline,
--      classify_vehicle_build_class, nuke_build_class, compute_vehicle_value, calculate_ai_vehicle_valuation,
--      compute_ai_driven_vehicle_value, update_vehicle_stats, get_daily_work_receipt (parts count and total),
--      get_vehicle_work_dates, generate_spending_analytics, and the views vehicle_receipts, vehicle_receipts_rollup_v,
--      v_vehicle_monthly_basis, v_garage_asset_summary and user_receipt_summary. Not changed: receipts_public_summary and
--      get_vehicle_day_documents list documents one by one (with no sum of money) and keep showing a quote as a document.
--   5. vehicle_build_reconstruction gains a top-level 'quoted' object, its own lens beside 'totals': the count of quote
--      documents, their first and last day, and each document's lines and options. Options are read from the line
--      category: "option <label>" (the lander's line category), "accepted" in it marks the option taken. A quote's amount
--      is its printed total (or its line sum) when it has no options, the accepted option's lines when one is marked, the
--      only option when there is one, and null when several options stand and none is marked: options are never added.
--      Lines outside the options in a quote with options are reported on their own. Quote documents are never added to one
--      another: the top-level amount is given only when there is one. Amounts only for a tied viewer, as 'totals' does.
--
-- Guard. Each replaced body is fingerprinted (md5 of pg_get_functiondef / pg_get_viewdef read 2026-11-21) and each
-- replacement asserts its anchor occurs the expected number of times; a definition that already carries every replacement
-- of this migration is left as it is, so a rerun changes nothing. Anything else refuses before any change is made
-- (the enum value included). Contract: supabase/sql/test_receipt_quote_kind.sql.
-- Views keep their reloptions (security_invoker / security_barrier), owner and grants (CREATE OR REPLACE).
--
-- Measured before this migration (read-only, 2026-11-21): no receipt has document type estimate/quote/agreement; no linked
-- receipt is a quote by its paper (words matched only paid invoices); one unlinked estimate (held, no identifier, kind
-- unknown, no document type) stays as it is. No rows are written here except the one classifier rule.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 0. What is replaced, where, and the definition it was read from --------------------------------------------------------
CREATE TEMP TABLE quote_kind_patch (ord int PRIMARY KEY, obj text NOT NULL, is_view boolean NOT NULL, read_md5 text NOT NULL,
  anchor text NOT NULL, replacement text NOT NULL, n int NOT NULL) ON COMMIT PRESERVE ROWS;

INSERT INTO quote_kind_patch VALUES
 (10, 'public.receipts_set_document_kind()', false, 'e71a5f5af91532330072febfc3f44447', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type')$a$,
  $a$concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type',
                   new.raw_extraction #>> '{data,document_type}', new.raw_json #>> '{data_v2,document_type}')$a$, 1),
 (20, 'public.land_document_pages(uuid,uuid,text,jsonb)', false, 'e6e785dc9309544936454c3c9fcfec44', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$'alignment_report','estimate','statement','other'$a$,
  $a$'alignment_report','estimate','quote','agreement','statement','other'$a$, 1),
 (30, 'public.receipt_work_lines(uuid,integer,integer)', false, 'd3f9a149f207dbc9d464426245c519e3', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL$a$,
  $a$AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
       AND NOT public.receipt_doc_kind_quoted(r.document_kind)  -- a quote is not a purchase: its lines are quoted, not bought$a$, 1),
 (40, 'public.get_vehicle_total_invested(uuid)', false, 'e34635a3ebf6a83678f82c326bf31fe2', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$and not public.receipt_doc_kind_excluded(r.document_kind)$a$,
  $a$and not public.receipt_doc_kind_excluded(r.document_kind) and not public.receipt_doc_kind_quoted(r.document_kind)$a$, 1),
 (50, 'public.vehicle_machine_shop_lines(uuid)', false, 'c55790fffd7eb084310a9d5cbd4fdd6c', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL$a$,
  $a$JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
                            AND NOT public.receipt_doc_kind_quoted(r.document_kind)$a$, 1),
 (60, 'public.compute_vehicle_investment_proof(uuid)', false, '114e430ff4f935e79af12c7dcf58a3fc', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;$a$,
  $a$FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(document_kind);$a$, 1),
 (61, 'public.compute_vehicle_investment_proof(uuid)', false, '114e430ff4f935e79af12c7dcf58a3fc', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$FROM receipts WHERE vehicle_id=p_vehicle_id AND superseded_at IS NULL),$a$,
  $a$FROM receipts WHERE vehicle_id=p_vehicle_id AND superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(document_kind)),$a$, 1),
 (70, 'public.get_vehicle_investment_timeline(uuid)', false, 'b7b97fe81e6d5f5034df3967e88274c9', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE vehicle_id = p_vehicle AND superseded_at IS NULL$a$,
  $a$WHERE vehicle_id = p_vehicle AND superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(document_kind)$a$, 2),
 (71, 'public.get_vehicle_investment_timeline(uuid)', false, 'b7b97fe81e6d5f5034df3967e88274c9', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE r.vehicle_id = p_vehicle AND r.superseded_at IS NULL$a$,
  $a$WHERE r.vehicle_id = p_vehicle AND r.superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(r.document_kind)$a$, 1),
 (80, 'public.classify_vehicle_build_class(uuid[])', false, 'ade65f625fb0fcb99adaabf63e955522', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE rc.superseded_at IS NULL GROUP BY rc.vehicle_id$a$,
  $a$WHERE rc.superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(rc.document_kind) GROUP BY rc.vehicle_id$a$, 1),
 (90, 'public.nuke_build_class(uuid)', false, '9a7242506ea230b4540b2631e5bcd63d', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;$a$,
  $a$FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL AND NOT public.receipt_doc_kind_quoted(document_kind);$a$, 1),
 (100, 'public.compute_vehicle_value(uuid)', false, '4adf7fa1cbfb451849334d389bf59ad0', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$where scope_type = 'vehicle' and duplicate_of is null and amount_check in ('verified','plausible')$a$,
  $a$where scope_type = 'vehicle' and duplicate_of is null and amount_check in ('verified','plausible')
      and not public.receipt_doc_kind_quoted(document_kind)$a$, 1),
 (110, 'public.calculate_ai_vehicle_valuation(uuid)', false, '8501123d999e2569ee9ed7358ea82227', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$AND is_active = true;$a$,
  $a$AND is_active = true AND NOT public.receipt_doc_kind_quoted(document_kind);$a$, 1),
 (120, 'public.compute_ai_driven_vehicle_value(uuid)', false, 'ed3a67af71394b015625158d28468d48', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$FROM receipts WHERE scope_type = 'vehicle' AND duplicate_of IS NULL$a$,
  $a$FROM receipts WHERE scope_type = 'vehicle' AND duplicate_of IS NULL AND NOT public.receipt_doc_kind_quoted(document_kind)$a$, 1),
 (130, 'public.update_vehicle_stats(uuid)', false, '6521a9f47bce7eace483a57361cb4c98', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE r.scope_type='vehicle' AND r.is_active = true AND r.scope_id::uuid = p_vehicle_id;$a$,
  $a$WHERE r.scope_type='vehicle' AND r.is_active = true AND r.scope_id::uuid = p_vehicle_id AND NOT public.receipt_doc_kind_quoted(r.document_kind);$a$, 1),
 (140, 'public.get_daily_work_receipt(uuid,date)', false, 'b0ead8fc99ecc32dc27ec7b8ddb62b50', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date$a$,
  $a$WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date AND NOT public.receipt_doc_kind_quoted(r.document_kind)$a$, 2),
 (150, 'public.get_vehicle_work_dates(uuid,date,date)', false, '0c46778470210a319288fafa703b9a8a', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$AND receipt_date BETWEEN p_start_date AND p_end_date$a$,
  $a$AND receipt_date BETWEEN p_start_date AND p_end_date AND NOT public.receipt_doc_kind_quoted(document_kind)$a$, 1),
 (160, 'public.generate_spending_analytics(uuid,uuid,timestamp with time zone,timestamp with time zone)', false, '0b639865399cc6477daecc20d9cebdfc', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$WHERE r.user_id = target_user_id AND r.duplicate_of IS NULL$a$,
  $a$WHERE r.user_id = target_user_id AND r.duplicate_of IS NULL AND NOT public.receipt_doc_kind_quoted(r.document_kind)$a$, 1),
 (200, 'public.vehicle_receipts', true, 'ea6d806798d73dbf2d08d6707a925f5f', -- gitleaks:allow (view-definition fingerprint read 2026-11-21, not a secret)
  $a$(NOT receipt_doc_kind_excluded(r.document_kind))$a$,
  $a$(NOT receipt_doc_kind_excluded(r.document_kind)) AND (NOT receipt_doc_kind_quoted(r.document_kind))$a$, 1),
 (210, 'public.vehicle_receipts_rollup_v', true, '5a92cac18f62b45716668f02650be57a', -- gitleaks:allow (view-definition fingerprint read 2026-11-21, not a secret)
  $a$(NOT receipt_doc_kind_excluded(r.document_kind))$a$,
  $a$(NOT receipt_doc_kind_excluded(r.document_kind)) AND (NOT receipt_doc_kind_quoted(r.document_kind))$a$, 1),
 (220, 'public.v_vehicle_monthly_basis', true, '06b3efd0f2aace947cb1a58c8fd8052a', -- gitleaks:allow (view-definition fingerprint read 2026-11-21, not a secret)
  $a$(NOT receipt_doc_kind_excluded(r.document_kind))$a$,
  $a$(NOT receipt_doc_kind_excluded(r.document_kind)) AND (NOT receipt_doc_kind_quoted(r.document_kind))$a$, 2),
 (230, 'public.v_garage_asset_summary', true, '1a2483ae2dd65105769d3db98f1dc8af', -- gitleaks:allow (view-definition fingerprint read 2026-11-21, not a secret)
  $a$(COALESCE(r.is_superseded, false) = false)$a$,
  $a$(COALESCE(r.is_superseded, false) = false) AND (NOT receipt_doc_kind_quoted(r.document_kind))$a$, 1),
 (240, 'public.user_receipt_summary', true, 'd645290a07a09bd41eba5fef460ecc72', -- gitleaks:allow (view-definition fingerprint read 2026-11-21, not a secret)
  $a$(r.duplicate_of IS NULL) AND$a$,
  $a$(r.duplicate_of IS NULL) AND (NOT receipt_doc_kind_quoted(r.document_kind)) AND$a$, 2),
 -- vehicle_build_reconstruction: the quoted lens, its own CTEs and its own top-level key (receipt_work_lines already leaves
 -- quote documents out of every line, total and system above)
 (300, 'public.vehicle_build_reconstruction(uuid)', false, 'a41252a78e33dcd6c49bdcc7da792597', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  E'  dn AS (\n',
  $a$  qd AS (
    -- Quote documents (receipt_doc_kind quote: an estimate, quote or agreement) the fold linked to this car. Quoted money is
    -- its own lens: receipt_work_lines leaves these documents out, so no quoted line is in totals, a system or an amount above.
    SELECT DISTINCT ON (r.id) r.id AS receipt_id,
           coalesce(CASE WHEN r.receipt_date <= current_date + 1 THEN r.receipt_date END,
                    CASE WHEN lk.page_date <= current_date + 1 THEN lk.page_date END) AS day,
           nullif(left(btrim(public.text_redact_contact(r.vendor_name)), 300), '') AS source,
           coalesce(r.total_amount, r.total) AS printed_total
      FROM v JOIN public.receipt_vehicle_links lk ON lk.vehicle_id = v.id AND lk.status = 'linked' AND lk.retired_at IS NULL
      JOIN public.receipts r ON r.id = lk.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
     WHERE public.receipt_doc_kind_quoted(r.document_kind)
     ORDER BY r.id, lk.id),
  qi AS (
    SELECT i.receipt_id, public.receipt_line_quote_option(i.category) AS option_label,
           coalesce(i.category ~* '\maccepted\M', false) AS accepted, i.total_price
      FROM public.receipt_items i WHERE i.receipt_id IN (SELECT receipt_id FROM qd)),
  qo AS (
    -- a quote's alternative options, each on its own; never added together
    SELECT qi.receipt_id, qi.option_label, bool_or(qi.accepted) AS accepted, count(*) AS lines, sum(qi.total_price) AS amount
      FROM qi WHERE qi.option_label IS NOT NULL GROUP BY qi.receipt_id, qi.option_label),
  qa AS (
    SELECT d.receipt_id, d.day, d.source, d.printed_total,
           (SELECT count(*) FROM qi WHERE qi.receipt_id = d.receipt_id) AS lines,
           (SELECT count(*) FROM qo WHERE qo.receipt_id = d.receipt_id) AS options,
           (SELECT count(*) FROM qo WHERE qo.receipt_id = d.receipt_id AND qo.accepted) AS accepted_options,
           (SELECT sum(qi.total_price) FROM qi WHERE qi.receipt_id = d.receipt_id) AS line_sum,
           (SELECT count(*) FROM qi WHERE qi.receipt_id = d.receipt_id AND qi.option_label IS NULL) AS outside_lines,
           (SELECT sum(qi.total_price) FROM qi WHERE qi.receipt_id = d.receipt_id AND qi.option_label IS NULL) AS outside_amount
      FROM qd d),
  qr AS (
    SELECT a.*,
           CASE WHEN a.options = 0 THEN coalesce(a.printed_total, a.line_sum)
                WHEN a.accepted_options = 1 THEN (SELECT o.amount FROM qo o WHERE o.receipt_id = a.receipt_id AND o.accepted)
                WHEN a.options = 1 THEN (SELECT o.amount FROM qo o WHERE o.receipt_id = a.receipt_id) END AS amount,
           CASE WHEN a.options = 0 AND a.printed_total IS NOT NULL THEN 'printed_total'
                WHEN a.options = 0 AND a.line_sum IS NOT NULL THEN 'line_sum'
                WHEN a.options = 0 THEN 'unpriced'
                WHEN a.accepted_options = 1 THEN 'accepted_option'
                WHEN a.options = 1 THEN 'only_option'
                ELSE 'options_not_added' END AS amount_basis
      FROM qa a),
  qj AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'rule', 'Estimates, quotes and agreements (receipt_doc_kind quote) the fold linked to this car. Quoted money is never spent money: these documents are in no total, system, line or recorded amount of this reader. A quote with alternative options (line category "option <label>") states each option; its amount is the option marked accepted, or the only option, and none when several options stand and none is marked accepted. Options are never added together, and quote documents are never added to one another: the amount here is stated only when there is one quote document.',
      'documents', count(*),
      'first_day', min(qr.day), 'last_day', max(qr.day),
      'amount', CASE WHEN (SELECT tied FROM v) AND count(*) = 1 THEN max(qr.amount) END,
      'amount_basis', CASE WHEN count(*) = 1 THEN max(qr.amount_basis) ELSE 'documents_not_added' END,
      'quotes', jsonb_agg(jsonb_build_object(
          'receipt_id', qr.receipt_id, 'day', qr.day, 'source', qr.source, 'lines', qr.lines,
          'amount', CASE WHEN (SELECT tied FROM v) THEN qr.amount END, 'amount_basis', qr.amount_basis,
          'options', (SELECT coalesce(jsonb_agg(jsonb_build_object('label', public.text_redact_contact(o.option_label), 'lines', o.lines, 'accepted', o.accepted,
                        'amount', CASE WHEN (SELECT tied FROM v) THEN o.amount END) ORDER BY o.option_label), '[]'::jsonb)
                        FROM qo o WHERE o.receipt_id = qr.receipt_id),
          'lines_outside_options', CASE WHEN qr.options > 0 THEN jsonb_build_object('lines', qr.outside_lines,
                        'amount', CASE WHEN (SELECT tied FROM v) THEN qr.outside_amount END) END)
        ORDER BY qr.day NULLS LAST, qr.receipt_id)) END AS j
      FROM qr),
  dn AS (
$a$, 1),
 (301, 'public.vehicle_build_reconstruction(uuid)', false, 'a41252a78e33dcd6c49bdcc7da792597', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
  $a$'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN (SELECT sum(total_price) FROM l) END)),$a$,
  $a$'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN (SELECT sum(total_price) FROM l) END)),
    'quoted', (SELECT j FROM qj),$a$, 1);

-- 1. Refuse before any change when a definition moved since it was read ---------------------------------------------------
-- A definition is either the one read (md5 equal: replace it), or already this migration's (every replacement text in it:
-- leave it), or anything else (refuse).
DO $guard$
DECLARE o record; d text;
BEGIN
  FOR o IN SELECT obj, bool_or(is_view) AS is_view, min(read_md5) AS read_md5, array_agg(replacement) AS reps
             FROM quote_kind_patch GROUP BY obj LOOP
    d := CASE WHEN o.is_view THEN pg_get_viewdef(o.obj::regclass) ELSE pg_get_functiondef(o.obj::regprocedure) END;
    IF md5(d) <> o.read_md5 AND EXISTS (SELECT 1 FROM unnest(o.reps) r WHERE position(r in d) = 0) THEN
      RAISE EXCEPTION '% changed since 2026-11-21 (md5 %); review before replacement', o.obj, md5(d);
    END IF;
  END LOOP;
END
$guard$;

-- 2. The kind. A new enum value cannot be used in the transaction that adds it, so it is added (and committed) first.
ALTER TYPE public.receipt_doc_kind ADD VALUE IF NOT EXISTS 'quote';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.receipt_doc_kind_quoted(k public.receipt_doc_kind)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- an estimate, quote or agreement: quoted money, never spent money (it stays linked to its car; it is not excluded)
  select coalesce(k::text = 'quote', false)
$function$;
COMMENT ON FUNCTION public.receipt_doc_kind_quoted(public.receipt_doc_kind) IS
  'True for a quote document (estimate, quote, agreement). Every reader that sums receipt money leaves these out; vehicle_build_reconstruction states them as quoted.';

CREATE OR REPLACE FUNCTION public.receipt_line_quote_option(p_category text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- "option A", "Option: 2", "option B (accepted)" -> A, 2, B; anything else -> null (the line is not an option)
  select nullif(btrim(regexp_replace((regexp_match(coalesce(p_category, ''), '^\s*option\M\s*[:#-]?\s*(.*)$', 'i'))[1],
                                     '[\s,;:()-]*\maccepted\M[\s,;:()-]*', ' ', 'gi'), E' \t,;:()-'), '')
$function$;
COMMENT ON FUNCTION public.receipt_line_quote_option(text) IS
  'The option a quote line belongs to, read from its category ("option <label>", "accepted" marks the option taken); null when the line is not an option.';

INSERT INTO public.receipt_document_kind_rules (rule_id, priority, kind, field, pattern, note)
VALUES ('quote_doctype', 0, 'quote', 'doctype', '\m(estimate|quote|quotation|agreement|proposal)\M',
        'A document typed as an estimate, quote or agreement is quoted money, not spend (20261121233000). Type only, never words: paid invoices print "estimate" and "quotation".')
ON CONFLICT (rule_id) DO NOTHING;

-- 3. Replace each body: refuse on a moved definition or an anchor that is not where it was read ---------------------------
DO $apply$
DECLARE o record; p record; d text; k int; opts text;
BEGIN
  FOR o IN SELECT obj, bool_or(is_view) AS is_view, min(read_md5) AS read_md5, array_agg(replacement) AS reps
             FROM quote_kind_patch GROUP BY obj ORDER BY min(ord) LOOP
    d := CASE WHEN o.is_view THEN pg_get_viewdef(o.obj::regclass) ELSE pg_get_functiondef(o.obj::regprocedure) END;
    IF md5(d) <> o.read_md5 AND NOT EXISTS (SELECT 1 FROM unnest(o.reps) r WHERE position(r in d) = 0) THEN
      RAISE NOTICE '% already carries this migration; unchanged', o.obj;
      CONTINUE;
    END IF;
    IF md5(d) <> o.read_md5 THEN
      RAISE EXCEPTION '% changed since 2026-11-21 (md5 %); review before replacement', o.obj, md5(d);
    END IF;
    FOR p IN SELECT * FROM quote_kind_patch WHERE obj = o.obj ORDER BY ord LOOP
      k := (length(d) - length(replace(d, p.anchor, ''))) / length(p.anchor);
      IF k <> p.n THEN
        RAISE EXCEPTION '%: anchor % found % times, expected %', o.obj, p.ord, k, p.n;
      END IF;
      d := replace(d, p.anchor, p.replacement);
    END LOOP;
    IF o.is_view THEN
      SELECT string_agg(x, ', ') INTO opts FROM pg_class c, unnest(c.reloptions) x WHERE c.oid = o.obj::regclass;
      EXECUTE format('CREATE OR REPLACE VIEW %s%s AS %s', o.obj,
                     CASE WHEN opts IS NOT NULL THEN ' WITH (' || opts || ')' ELSE '' END, rtrim(d, E'; \n'));
    ELSE
      EXECUTE d;
    END IF;
  END LOOP;
END
$apply$;

COMMIT;

DROP TABLE quote_kind_patch;
RESET lock_timeout;
RESET statement_timeout;
