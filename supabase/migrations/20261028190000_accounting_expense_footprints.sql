BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Expense footprints: retained traces of spending that no booked expense cites, for one book owner and one year.
-- A trace is a photographed receipt, a work episode on a vehicle (photos that show work), a timeline cost, or a
-- caller-supplied trace (a parts-order email or payment text collected on the owner's own machine; never stored).
-- Each trace is matched against the current book (v_financial_accounting_records) and the expense-use cells:
--   cited_expense      an Expense record of the same amount (within 0.01) dated 5 days before to 30 days after the
--                      trace, or an Expense record whose text names the trace's reference (receipt file stem, order no.)
--   near_match         (counted as booked) an Expense record naming the vendor within 1.00 or 5% (any amount when the
--                      trace has none), or two that add up to the amount (a split charge), same window
--   cited_vehicle      (work episodes) an Expense use cell on the same vehicle, dated 30 days before to 7 days after
--   booked_not_expense the same amount and window on a book record outside Expense (Owner, Transfer, Reference...):
--                      a reclassification candidate
--   uncited            nothing in the book: a gap
-- Amounts say where they came from (amount_basis): document (printed on the receipt/order), claim (a timeline cost),
-- own_history_p25 (work episodes: 25th percentile of the year's booked vehicle spend on cited work episodes, with the
-- median as estimate_mid; at least five cited episodes, otherwise unknown) or unknown. score = amount x confidence.
-- Confidence is the product of the factors listed in each row's reasons. Card digit groups come from the book's own
-- account labels at run time. Read-only, SECURITY INVOKER: the caller's row policies apply, and nothing is returned
-- unless the caller is the book owner (a delegate sees the book but not the owner's receipts and photos, and a partial
-- trace set would read as "no gaps"). The last row (trace_kind 'summary') holds the full counts and dollars.
-- Design: private receipt ~/nuke-logs/expense-footprints-20261025/DESIGN.md.
CREATE OR REPLACE FUNCTION public.accounting_expense_footprints(
  p_owner_id uuid, p_year integer, p_limit integer DEFAULT 200, p_external jsonb DEFAULT NULL)
RETURNS TABLE(trace_kind text, trace_key text, trace_keys text[], vehicle_id uuid, trace_date date, window_end date,
  vendor text, reference text, amount numeric, amount_basis text, estimate_mid numeric, status text, cited_by text[],
  confidence numeric, score numeric, reasons jsonb, look_for text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  y0 date; y1 date; lim integer := least(greatest(coalesce(p_limit, 200), 1), 500);
BEGIN
  IF p_owner_id IS NULL OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100
     OR auth.uid() IS DISTINCT FROM p_owner_id THEN
    RETURN;
  END IF;
  IF p_external IS NOT NULL AND (jsonb_typeof(p_external) <> 'array' OR jsonb_array_length(p_external) > 500) THEN
    RAISE EXCEPTION 'p_external must be a JSON array of at most 500 traces' USING ERRCODE = '22023';
  END IF;
  y0 := make_date(p_year, 1, 1); y1 := make_date(p_year, 12, 31);

  RETURN QUERY
  WITH book AS MATERIALIZED (
    SELECT b.document_id, b.extraction_run_id, b.source_key, b.local_id, b.record_kind, b.section, b.category, b.account,
           abs(b.amount_value) AS a, b.d,
           lower(concat_ws(' ', b.description, b.decision, b.record->>'source_reference', b.local_id)) AS txt,
           regexp_replace(lower(concat_ws(' ', b.description, b.decision)), '[^a-z]', '', 'g') AS ltxt
    FROM (SELECT r.*, CASE WHEN r.record_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN r.record_date::date END AS d
          FROM v_financial_accounting_records r
          WHERE r.owner_id = p_owner_id AND r.year IN ((p_year - 1)::text, p_year::text, (p_year + 1)::text)) b
    WHERE b.d BETWEEN y0 - 60 AND y1 + 60 AND b.amount_value IS NOT NULL
  ), cells AS MATERIALIZED (
    SELECT u.use_type, u.vid, b.local_id, b.category, b.d, coalesce(u.alloc, b.a) AS a
    FROM (SELECT e.document_id, e.extraction_run_id, e.field_key, e.value_normalized->'value'->>'use_type' AS use_type,
                 CASE WHEN e.value_normalized->'value'->>'vehicle_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                      THEN (e.value_normalized->'value'->>'vehicle_id')::uuid END AS vid,
                 CASE WHEN e.value_normalized->'value'->>'allocated_amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
                      THEN abs((e.value_normalized->'value'->>'allocated_amount')::numeric) END AS alloc
          FROM financial_document_extractions e
          WHERE e.owner_id = p_owner_id AND NOT e.is_superseded AND e.field_key LIKE 'expense\_use\_%') u
    JOIN book b ON b.document_id = u.document_id AND b.extraction_run_id = u.extraction_run_id
     AND u.field_key = 'expense_use_' || left(b.source_key, 24) AND b.record_kind = 'retained_ledger_decision' AND b.section = 'Expense'
  ), card_accounts AS MATERIALIZED (
    -- Four-digit groups in account labels ("... card 1234"), and the months each account has statement lines.
    SELECT DISTINCT m[1] AS digits, b.account FROM book b, regexp_matches(b.account, '(?<![0-9])([0-9]{4})(?![0-9])', 'g') m
  ), covered_months AS MATERIALIZED (
    SELECT DISTINCT b.account, date_trunc('month', b.d)::date AS mon FROM book b WHERE b.record_kind = 'retained_bank_movement'
  ),
  -- Receipts: business-cost kinds, live rows, outflows. Photos of one slip collapse into one trace.
  rc AS (
    SELECT r.id, r.vendor_name, coalesce(r.receipt_date, r.transaction_date, r.purchase_date) AS d,
           CASE WHEN coalesce(r.total, r.total_amount) > 0 THEN coalesce(r.total, r.total_amount) END AS amt,
           r.document_kind::text AS dk, r.amount_check::text AS ac, r.vehicle_id AS vid, lower(r.payment_method) AS pm,
           CASE WHEN r.card_last4 ~ '^[0-9]{4}$' THEN r.card_last4 END AS card,
           nullif(lower(regexp_replace(regexp_replace(coalesce(r.file_name, ''), '\.[A-Za-z0-9]{1,5}$', ''), '^[0-9]{10,}_', '')), '') AS stem,
           left(lower(regexp_replace(coalesce(r.vendor_name, ''), '[^A-Za-z]', '', 'g')), 6) AS v6
    FROM receipts r
    WHERE r.user_id = p_owner_id AND NOT coalesce(r.is_superseded, false) AND r.duplicate_of IS NULL
      AND coalesce(r.receipt_date, r.transaction_date, r.purchase_date) BETWEEN y0 AND y1
      AND r.document_kind::text IN ('parts_service', 'shipping', 'fuel', 'general_merchandise', 'government_fee')
      AND (r.document_kind::text <> 'government_fee' OR r.vehicle_id IS NOT NULL)
      AND coalesce(r.total, r.total_amount, 0) >= 0
  ), rc_g AS (
    SELECT x.*, sum(x.brk) OVER (PARTITION BY x.v6, x.gk ORDER BY x.d, x.id) AS grp
    FROM (SELECT rc.*, coalesce(rc.amt::text, 'stem:' || coalesce(rc.stem, rc.id::text)) AS gk,
                 CASE WHEN rc.d - lag(rc.d) OVER (PARTITION BY rc.v6, coalesce(rc.amt::text, 'stem:' || coalesce(rc.stem, rc.id::text)) ORDER BY rc.d, rc.id) <= 3
                      THEN 0 ELSE 1 END AS brk
          FROM rc) x
  ), rcpt AS (
    SELECT min(g.d) AS d, max(g.amt) AS amt, (array_agg(g.vendor_name ORDER BY g.d, g.id))[1] AS vendor,
           (array_agg(g.dk ORDER BY g.d, g.id))[1] AS dk,
           CASE WHEN bool_or(g.ac = 'verified') THEN 'verified' WHEN bool_or(g.ac = 'plausible') THEN 'plausible' ELSE coalesce(max(g.ac), 'unchecked') END AS ac,
           (array_agg(g.vid ORDER BY g.vid IS NULL, g.d) )[1] AS vid,
           (array_agg(g.pm ORDER BY g.pm IS NULL, g.d))[1] AS pm, (array_agg(g.card ORDER BY g.card IS NULL, g.d))[1] AS card,
           array_agg(DISTINCT g.stem) FILTER (WHERE g.stem ~ '^[a-z0-9_-]{6,}$') AS stems,
           array_agg('receipt:' || g.id ORDER BY g.d, g.id) AS keys
    FROM rc_g g GROUP BY g.v6, g.gk, g.grp
  ),
  -- Timeline costs on the owner's vehicles (receipt extractions are the receipts again and are left out).
  tl AS (
    SELECT te.id, te.vehicle_id AS vid, te.event_date AS d, te.cost_amount AS amt,
           coalesce(nullif(te.service_provider_name, ''), te.title) AS vendor, te.title,
           coalesce(te.metadata, '{}'::jsonb) ? 'billing_category' AS billing
    FROM timeline_events te JOIN vehicles v ON v.id = te.vehicle_id
    WHERE (v.owner_id = p_owner_id OR v.user_id = p_owner_id OR v.uploaded_by = p_owner_id)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND te.event_date BETWEEN y0 AND y1 AND te.cost_amount > 0 AND coalesce(te.source, '') <> 'receipt_extraction'
      AND te.event_type IN ('service', 'maintenance', 'repair', 'modification', 'work_completed', 'parts', 'parts_purchase')
      -- A charge made by one of the owner's own businesses is income, not a cost.
      AND NOT EXISTS (SELECT 1 FROM financial_operator_entities oe WHERE oe.owner_id = p_owner_id AND te.service_provider_name IS NOT NULL
                        AND (lower(te.service_provider_name) = lower(oe.entity_name) OR te.service_provider_name ILIKE ANY (coalesce(oe.name_patterns, '{}'))))
      AND NOT EXISTS (SELECT 1 FROM rcpt p WHERE p.vid = te.vehicle_id AND abs(p.amt - te.cost_amount) <= 0.01 AND abs(p.d - te.event_date) <= 3)
  ),
  -- Caller-supplied traces (orders, shipping notices, payment texts). Malformed items are ignored.
  ext AS (
    SELECT coalesce(nullif(left(x.item->>'ref', 120), ''), 'item-' || x.n) AS ref,
           lower(coalesce(nullif(x.item->>'kind', ''), 'other')) AS kind,
           (x.item->>'date')::date AS d,
           CASE WHEN x.item->>'amount' ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' AND (x.item->>'amount')::numeric > 0 THEN (x.item->>'amount')::numeric END AS amt,
           left(x.item->>'vendor', 120) AS vendor, left(x.item->>'what', 200) AS what, left(x.item->>'where', 200) AS whr,
           CASE WHEN x.item->>'vehicle_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN (x.item->>'vehicle_id')::uuid END AS vid
    FROM jsonb_array_elements(coalesce(p_external, '[]'::jsonb)) WITH ORDINALITY x(item, n)
    WHERE jsonb_typeof(x.item) = 'object' AND x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (x.item->>'date')::date BETWEEN y0 AND y1
  ),
  -- Work episodes: the owner's own photos on live vehicles, a new episode after 14 days without photos.
  img AS (
    SELECT i.vehicle_id AS vid, (i.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS d, i.fabrication_stage AS st
    FROM vehicle_images i JOIN vehicles v ON v.id = i.vehicle_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    WHERE i.user_id = p_owner_id AND i.taken_at >= (y0::timestamp AT TIME ZONE 'America/Los_Angeles')
      AND i.taken_at < ((y1 + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') AND i.vehicle_id IS NOT NULL
      AND NOT coalesce(i.is_external, false) AND NOT coalesce(i.is_superseded, false) AND NOT coalesce(i.is_duplicate, false)
      AND i.duplicate_of IS NULL AND NOT coalesce(i.is_document, false) AND coalesce(i.source, '') NOT LIKE 'daily\_receipt%'
  ), sess AS (
    SELECT DISTINCT ws.vehicle_id AS vid, ws.session_date AS d FROM work_sessions ws
    WHERE ws.user_id = p_owner_id AND ws.session_date BETWEEN y0 AND y1
      AND ws.work_type IN ('labor', 'mixed', 'parts_sourcing', 'teardown', 'paint_prep', 'wiring', 'restoration', 'insulation')
  ), days AS (
    SELECT i.vid, i.d, count(*) AS n, array_remove(array_agg(DISTINCT i.st), NULL) AS sts,
           EXISTS (SELECT 1 FROM sess s WHERE s.vid = i.vid AND s.d = i.d) AS worked
    FROM img i GROUP BY i.vid, i.d
  ), days_e AS (
    SELECT x.*, sum(x.brk) OVER (PARTITION BY x.vid ORDER BY x.d) AS ep
    FROM (SELECT dd.*, CASE WHEN dd.d - lag(dd.d) OVER (PARTITION BY dd.vid ORDER BY dd.d) <= 14 THEN 0 ELSE 1 END AS brk FROM days dd) x
  ), eps AS (
    SELECT e.vid, min(e.d) AS s, max(e.d) AS f, count(*) AS ndays, sum(e.n) AS nimg, bool_or(e.worked) AS worked,
           (SELECT coalesce(array_agg(DISTINCT st ORDER BY st), '{}') FROM days_e e2, unnest(e2.sts) st WHERE e2.vid = e.vid AND e2.ep = e.ep) AS sts
    FROM days_e e GROUP BY e.vid, e.ep
  ), work_eps AS (
    SELECT ep.*, ep.sts && ARRAY['primer','primed','basecoated','painted','bodywork','welded','fabricated','blocked','finishing'] AS paint,
           ep.sts && ARRAY['assembly','assembled','mechanical'] AS assembly,
           c.n_cells, c.cited_amt, c.cited_by, sh.n_shop
    FROM eps ep
    LEFT JOIN LATERAL (SELECT count(*) AS n_cells, sum(c.a) AS cited_amt, (array_agg(c.local_id ORDER BY c.d))[1:5] AS cited_by
                       FROM cells c WHERE c.use_type = 'vehicle' AND c.vid = ep.vid AND c.d BETWEEN ep.s - 30 AND ep.f + 7) c ON true
    LEFT JOIN LATERAL (SELECT count(*) AS n_shop FROM cells c WHERE c.use_type = 'shop' AND c.category ILIKE 'car restoration%'
                         AND c.d BETWEEN ep.s - 30 AND ep.f + 7) sh ON true
    WHERE ep.worked OR ep.sts && ARRAY['primer','primed','basecoated','painted','bodywork','welded','fabricated','blocked','finishing','assembly','assembled','mechanical']
  ), hist AS (
    SELECT count(*) AS n, percentile_cont(0.25) WITHIN GROUP (ORDER BY w.cited_amt) AS p25,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY w.cited_amt) AS p50
    FROM work_eps w WHERE w.n_cells > 0
  ),
  -- Amount-known traces share one matcher.
  known AS (
    SELECT 'receipt'::text AS kind, p.keys[1] AS key, p.keys, p.vid, p.d, p.amt, p.vendor, p.stems AS refs, p.dk AS sub,
           p.ac, p.pm, p.card, NULL::text AS what, NULL::text AS whr, p.stems[1] AS ref_label,
           left(regexp_replace(lower(coalesce(p.vendor, '')), '[^a-z]', '', 'g'), 6) AS vtok
    FROM rcpt p
    UNION ALL
    SELECT 'timeline_cost', 'timeline:' || t.id, ARRAY['timeline:' || t.id], t.vid, t.d, t.amt, t.vendor, NULL,
           CASE WHEN t.billing THEN 'billing_entry' ELSE 'claim' END,
           NULL, NULL, NULL, t.title, NULL, NULL, left(regexp_replace(lower(coalesce(t.vendor, '')), '[^a-z]', '', 'g'), 6)
    FROM tl t
    UNION ALL
    SELECT 'external', 'external:' || e.ref, ARRAY['external:' || e.ref], e.vid, e.d, e.amt, e.vendor,
           CASE WHEN lower(e.ref) ~ '^[a-z0-9_-]{6,}$' AND e.ref !~ '^item-' THEN ARRAY[lower(e.ref)] END, e.kind,
           NULL, NULL, NULL, e.what, e.whr, e.ref, left(regexp_replace(lower(coalesce(e.vendor, '')), '[^a-z]', '', 'g'), 6)
    FROM ext e
    WHERE NOT EXISTS (SELECT 1 FROM rcpt p WHERE e.amt IS NOT NULL AND abs(p.amt - e.amt) <= 0.01 AND abs(p.d - e.d) <= 3)
  ), matched AS MATERIALIZED (
    SELECT k.*,
      -- Near match: an Expense record naming the same vendor, amount within 1.00 or 5% (misread totals, a credit
      -- netted at charge time; any amount when the trace's total was not read), same window. It counts as cited and
      -- is reported in the summary.
      (SELECT array_agg(b.local_id ORDER BY b.d) FROM (SELECT b.local_id, b.d FROM book b
         WHERE b.section = 'Expense' AND length(k.vtok) >= 5 AND strpos(b.ltxt, k.vtok) > 0
           AND (k.amt IS NULL OR abs(b.a - k.amt) <= greatest(1.00, 0.05 * k.amt)) AND b.d BETWEEN k.d - 5 AND k.d + 30
         ORDER BY abs(b.a - coalesce(k.amt, b.a)), b.d LIMIT 3) b) AS near_hits,
      -- Split charge: two Expense records naming the vendor in the window that add up to the trace amount.
      (SELECT ARRAY[x.l1, x.l2] FROM (SELECT b1.local_id AS l1, b2.local_id AS l2
         FROM book b1 JOIN book b2 ON b2.local_id > b1.local_id AND b2.section = 'Expense' AND strpos(b2.ltxt, k.vtok) > 0
          AND b2.d BETWEEN k.d - 5 AND k.d + 30 AND abs(b1.a + b2.a - k.amt) <= 0.01
         WHERE b1.section = 'Expense' AND k.amt IS NOT NULL AND length(k.vtok) >= 5 AND strpos(b1.ltxt, k.vtok) > 0
           AND b1.d BETWEEN k.d - 5 AND k.d + 30 AND b1.record_kind = 'retained_ledger_decision' AND b2.record_kind = 'retained_ledger_decision'
         LIMIT 1) x) AS split_hits,
      (SELECT array_agg(b.local_id ORDER BY b.d) FROM (SELECT b.local_id, b.d FROM book b
         WHERE b.section = 'Expense' AND ((k.amt IS NOT NULL AND abs(b.a - k.amt) <= 0.01 AND b.d BETWEEN k.d - 5 AND k.d + 30)
           OR EXISTS (SELECT 1 FROM unnest(k.refs) rf WHERE strpos(b.txt, rf) > 0 AND b.txt ~ ('(^|[^a-z0-9])' || rf || '([^a-z0-9]|$)')))
         ORDER BY b.d LIMIT 5) b) AS exp_hits,
      (SELECT array_agg(b.local_id || ' (' || coalesce(b.section, 'no section') || ', ' || b.account || ')' ORDER BY b.d)
         FROM (SELECT b.local_id, b.section, b.account, b.d FROM book b
         WHERE coalesce(b.section, '') <> 'Expense' AND ((k.amt IS NOT NULL AND abs(b.a - k.amt) <= 0.01 AND b.d BETWEEN k.d - 5 AND k.d + 30)
           OR EXISTS (SELECT 1 FROM unnest(k.refs) rf WHERE strpos(b.txt, rf) > 0 AND b.txt ~ ('(^|[^a-z0-9])' || rf || '([^a-z0-9]|$)')))
         ORDER BY b.d LIMIT 5) b) AS other_hits,
      CASE
        WHEN k.kind <> 'receipt' THEN 'unknown'
        WHEN k.pm = 'cash' THEN 'cash'
        WHEN k.pm = 'financing' THEN 'financing'
        WHEN k.card IS NULL THEN 'not_printed'
        WHEN EXISTS (SELECT 1 FROM card_accounts ca JOIN covered_months cm ON cm.account = ca.account
                     WHERE ca.digits = k.card AND cm.mon = date_trunc('month', k.d)::date) THEN 'covered_card'
        WHEN EXISTS (SELECT 1 FROM card_accounts ca WHERE ca.digits = k.card) THEN 'uncovered_account'
        ELSE 'unknown_card' END AS channel
    FROM known k
  ), known_scored AS MATERIALIZED (
    SELECT m.*,
      CASE WHEN m.exp_hits IS NOT NULL THEN 'cited_expense' WHEN m.near_hits IS NOT NULL OR m.split_hits IS NOT NULL THEN 'near_match'
           WHEN m.other_hits IS NOT NULL THEN 'booked_not_expense' ELSE 'uncited' END AS st,
      CASE m.kind
        WHEN 'receipt' THEN least(0.95,
          (CASE m.ac WHEN 'verified' THEN 0.95 WHEN 'plausible' THEN 0.75 WHEN 'no_amount' THEN 0.4 ELSE 0.6 END)
          * (CASE m.sub WHEN 'parts_service' THEN 1.0 WHEN 'shipping' THEN 0.9 WHEN 'government_fee' THEN 0.8 WHEN 'general_merchandise' THEN 0.6 WHEN 'fuel' THEN 0.5 ELSE 0.5 END)
          * (CASE m.channel WHEN 'covered_card' THEN 0.5 WHEN 'financing' THEN 0.2 WHEN 'unknown_card' THEN 0.8 WHEN 'not_printed' THEN 0.9 ELSE 1.0 END)
          * (CASE WHEN m.vid IS NOT NULL THEN 1.1 ELSE 1.0 END))
        -- A vehicle cost claim does not say who paid; a billing entry is what the vehicle's owner was charged.
        WHEN 'timeline_cost' THEN CASE WHEN m.sub = 'billing_entry' THEN 0.25 ELSE 0.40 END
        ELSE CASE WHEN m.sub IN ('order', 'marketplace_order') AND m.amt IS NOT NULL THEN 0.9
                  WHEN m.sub IN ('payment', 'payment_text') AND m.amt IS NOT NULL THEN 0.7
                  WHEN m.sub = 'shipping' THEN 0.6 ELSE 0.6 END
      END AS conf
    FROM matched m
  ), known_final AS MATERIALIZED (
    -- One photo, one trace: when OCR read the same receipt photo (file stem) more than once with different totals, the
    -- best-matched reading stands for the photo and the others are rereads (counted in the summary, not listed).
    SELECT s.*, CASE WHEN s.kind = 'receipt' AND EXISTS (
        SELECT 1 FROM known_scored o WHERE o.kind = 'receipt' AND o.key <> s.key AND o.refs && s.refs
          AND (array_position(ARRAY['cited_expense','near_match','booked_not_expense','uncited'], o.st), -o.conf, o.key)
            < (array_position(ARRAY['cited_expense','near_match','booked_not_expense','uncited'], s.st), -s.conf, s.key))
      THEN 'reread' ELSE s.st END AS st2
    FROM known_scored s
  ), rows_known AS (
    SELECT s.kind, s.key, s.keys, s.vid, s.d, NULL::date AS wend, s.vendor, s.ref_label AS ref, s.amt,
      CASE WHEN s.amt IS NULL THEN 'unknown' WHEN s.kind = 'timeline_cost' THEN 'claim' ELSE 'document' END AS basis,
      NULL::numeric AS est_mid, s.st2 AS st,
      CASE s.st2 WHEN 'cited_expense' THEN s.exp_hits WHEN 'near_match' THEN coalesce(s.near_hits, s.split_hits) ELSE s.other_hits END AS cited,
      round(s.conf::numeric, 3) AS conf,
      CASE WHEN s.amt IS NOT NULL THEN round(s.amt * s.conf::numeric, 2) END AS sc,
      jsonb_strip_nulls(jsonb_build_object('source', s.kind, 'subtype', s.sub, 'amount_check', s.ac, 'payment_channel', s.channel,
        'vehicle_linked', s.vid IS NOT NULL, 'references', to_jsonb(s.refs), 'what', s.what)) AS rs,
      CASE s.st2
        WHEN 'booked_not_expense' THEN format('A book line of %s near %s is not booked as an expense (%s). The %s %s shows a business purchase: reclassify it if it was.',
          s.amt, s.d, array_to_string(s.other_hits, '; '), coalesce(s.vendor, 'vendor'), CASE s.kind WHEN 'receipt' THEN 'receipt' ELSE s.sub END)
        ELSE CASE s.kind
          WHEN 'receipt' THEN format('Book the %s receipt of %s for %s (photo %s, in Nuke). Paid %s.',
            coalesce(s.vendor, 'unnamed vendor'), s.d, coalesce(s.amt::text, 'an unread amount'), coalesce(s.ref_label, s.key),
            CASE s.channel WHEN 'cash' THEN 'in cash: the receipt is the only record'
              WHEN 'uncovered_account' THEN 'on card ' || s.card || ', an account with no statements in the book: find that month''s statement'
              WHEN 'covered_card' THEN 'on card ' || s.card || ', whose statement is in the book: check for a different total or an already-booked charge'
              WHEN 'unknown_card' THEN 'on card ' || s.card || ', which no book account names: find which account it is'
              WHEN 'financing' THEN 'on a financing contract: book its payments, interest or the asset, not the contract total'
              ELSE 'by an unprinted method: check cash, Apple Cash and cards without statements' END)
          WHEN 'timeline_cost' THEN CASE WHEN s.sub = 'billing_entry'
            THEN format('A billing entry on this vehicle charges %s on %s (%s, %s). If the business paid %s, book that payment (recovered from the client); if the client paid directly, it is not your cost.', s.amt, s.d, coalesce(s.what, ''), coalesce(s.vendor, 'provider'), coalesce(s.vendor, 'the provider'))
            ELSE format('The vehicle timeline records a cost of %s on %s (%s). Find its invoice or payment, and who paid it.', s.amt, s.d, coalesce(s.what, s.vendor)) END
          ELSE format('%s%s on %s%s. Find the charge or receipt%s.', coalesce(s.vendor || ' ', ''), coalesce(s.sub, 'trace'), s.d,
            coalesce(' for ' || s.amt, ''), coalesce(' (' || s.whr || ')', '')) END
      END AS lf
    FROM known_final s
  ), rows_eps AS (
    SELECT 'work_episode'::text AS kind, 'episode:' || w.vid || ':' || w.s AS key, ARRAY['episode:' || w.vid || ':' || w.s] AS keys,
      w.vid, w.s AS d, w.f AS wend, NULL::text AS vendor, NULL::text AS ref,
      CASE WHEN w.n_cells = 0 AND h.n >= 5 THEN round(h.p25::numeric, 2) END AS amt,
      CASE WHEN w.n_cells > 0 THEN 'booked' WHEN h.n >= 5 THEN 'own_history_p25' ELSE 'unknown' END AS basis,
      CASE WHEN w.n_cells = 0 AND h.n >= 5 THEN round(h.p50::numeric, 2) END AS est_mid,
      CASE WHEN w.n_cells > 0 THEN 'cited_vehicle' ELSE 'uncited' END AS st, w.cited_by AS cited,
      round(least(0.8, (0.35 + CASE WHEN w.paint THEN 0.25 ELSE 0 END + CASE WHEN w.assembly OR w.worked THEN 0.10 ELSE 0 END
        + CASE WHEN w.ndays >= 3 THEN 0.05 ELSE 0 END + CASE WHEN w.nimg >= 40 THEN 0.05 ELSE 0 END)
        * CASE WHEN w.n_shop > 0 THEN 0.7 ELSE 1.0 END)::numeric, 3) AS conf,
      NULL::numeric AS sc,
      jsonb_build_object('source', 'work_episode', 'work_days', w.ndays, 'photos', w.nimg, 'stages', to_jsonb(w.sts),
        'paint_or_materials_stage', w.paint, 'assembly_stage', w.assembly, 'work_session', w.worked,
        'shop_restoration_expenses_in_window', w.n_shop, 'own_history_episodes', h.n) AS rs,
      format('Work on this vehicle from %s to %s (%s photo days, %s photos%s) has no expense placed on it. Look for parts orders, paint or materials receipts and contractor payments from %s to %s%s.',
        w.s, w.f, w.ndays, w.nimg, CASE WHEN cardinality(w.sts) > 0 THEN ', stages ' || array_to_string(w.sts, ', ') ELSE '' END,
        w.s - 30, w.f + 7, CASE WHEN w.n_shop > 0 THEN format('; %s shop restoration expense(s) in that window may belong to this car', w.n_shop) ELSE '' END) AS lf
    FROM work_eps w CROSS JOIN hist h
  ), all_rows AS (
    SELECT * FROM rows_known UNION ALL
    SELECT r.kind, r.key, r.keys, r.vid, r.d, r.wend, r.vendor, r.ref, r.amt, r.basis, r.est_mid, r.st, r.cited, r.conf,
           CASE WHEN r.amt IS NOT NULL THEN round(r.amt * r.conf, 2) END, r.rs, r.lf
    FROM rows_eps r
  ), gaps AS (
    SELECT a.*, row_number() OVER (ORDER BY a.sc DESC NULLS LAST, a.conf DESC, a.d, a.key) AS rn
    FROM all_rows a WHERE a.st IN ('uncited', 'booked_not_expense')
    ORDER BY rn LIMIT lim
  ), summary AS (
    SELECT 'summary'::text AS kind, 'summary:' || p_owner_id || ':' || p_year, NULL::text[], NULL::uuid, y0, y1, NULL::text, NULL::text,
      (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'uncited' AND a.basis IN ('document', 'claim')),
      'document_and_claim_uncited', (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'uncited' AND a.basis = 'own_history_p25'),
      'summary', NULL::text[], NULL::numeric,
      (SELECT sum(a.sc) FROM all_rows a WHERE a.st = 'uncited'),
      jsonb_build_object(
        'traces', (SELECT count(*) FROM all_rows),
        'by_kind_status', (SELECT jsonb_object_agg(k, n) FROM (SELECT a.kind || ':' || a.st AS k, count(*) AS n FROM all_rows a GROUP BY 1) z),
        'gaps', (SELECT count(*) FROM all_rows a WHERE a.st = 'uncited'),
        'reclassification_candidates', (SELECT count(*) FROM all_rows a WHERE a.st = 'booked_not_expense'),
        'near_matches', (SELECT count(*) FROM all_rows a WHERE a.st = 'near_match'),
        'reclassification_amount', (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'booked_not_expense'),
        'gap_amount_document', (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'uncited' AND a.basis = 'document'),
        'gap_amount_claim', (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'uncited' AND a.basis = 'claim'),
        'gap_amount_estimated_p25', (SELECT sum(a.amt) FROM all_rows a WHERE a.st = 'uncited' AND a.basis = 'own_history_p25'),
        'gap_amount_estimated_median', (SELECT sum(a.est_mid) FROM all_rows a WHERE a.st = 'uncited' AND a.basis = 'own_history_p25'),
        'gaps_amount_unknown', (SELECT count(*) FROM all_rows a WHERE a.st = 'uncited' AND a.amt IS NULL),
        'confidence_weighted_amount', (SELECT sum(a.sc) FROM all_rows a WHERE a.st = 'uncited'),
        'own_history', (SELECT jsonb_build_object('cited_work_episodes', h.n, 'p25', round(h.p25::numeric, 2), 'median', round(h.p50::numeric, 2)) FROM hist h),
        'rows_returned', (SELECT count(*) FROM gaps), 'limit', lim, 'external_supplied', coalesce(jsonb_array_length(p_external), 0)),
      'Counts and dollars for every trace of the year; the rows above are the highest-ranked gaps.',
      lim + 1::bigint AS rn
  )
  SELECT o.kind, o.key, o.keys, o.vid, o.d, o.wend, o.vendor, o.ref, o.amt, o.basis, o.est_mid, o.st, o.cited, o.conf, o.sc, o.rs, o.lf
  FROM (SELECT g.kind, g.key, g.keys, g.vid, g.d, g.wend, g.vendor, g.ref, g.amt, g.basis, g.est_mid, g.st, g.cited, g.conf, g.sc, g.rs, g.lf, g.rn FROM gaps g
        UNION ALL
        SELECT * FROM summary) o
  ORDER BY o.rn;
END
$fn$;

REVOKE ALL ON FUNCTION public.accounting_expense_footprints(uuid, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_expense_footprints(uuid, integer, integer, jsonb) TO authenticated;
COMMENT ON FUNCTION public.accounting_expense_footprints(uuid, integer, integer, jsonb) IS
  'Owner-only, read-only: retained spending traces (receipts, work episodes, timeline costs, caller-supplied orders) for one year that no booked expense cites, ranked by amount x confidence, plus a summary row.';

COMMIT;
