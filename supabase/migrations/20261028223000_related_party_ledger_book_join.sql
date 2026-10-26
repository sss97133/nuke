-- related_party_ledger: read the cited book records once instead of joining the books view per line.
-- Measured live 2026-10-26 as the book owner (role authenticated, row policies on), 59 lines citing 40 book
-- records: the per-line join took 17.4 s end to end (the authenticated role's statement_timeout is 15 s, so the API
-- call would fail); one bulk lookup of the 40 records takes 0.16 s. Same output; signature and grants unchanged.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- The balance and its lines, point in time. Runs as the caller; owner (or service role) only.
CREATE OR REPLACE FUNCTION public.related_party_ledger(
  p_party_id uuid, p_as_of date DEFAULT NULL, p_known_at timestamptz DEFAULT NULL, p_owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := coalesce(p_owner_id, auth.uid());
  v_as_of date := coalesce(p_as_of, current_date);
  v_known timestamptz := coalesce(p_known_at, now());
  v_name text;
  v_out jsonb;
BEGIN
  IF v_owner IS NULL OR NOT (v_owner = auth.uid() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'the related-party ledger is readable by its owner only' USING ERRCODE = '42501';
  END IF;
  SELECT r.entity_name INTO v_name FROM public.financial_related_parties(v_owner) r WHERE r.entity_id = p_party_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'unknown related party'; END IF;

  WITH e AS (
    SELECT 'deal'::text tbl, d.id, d.created_at recorded_at, d.superseded_at, d.superseded_by, 'work_owed'::text kind,
           d.rate_card_amount amount, d.currency, d.attributes a
      FROM public.financial_deals d
     WHERE d.owner_id = v_owner AND d.attributes->>'ledger' = 'related_party' AND d.attributes->>'party_id' = p_party_id::text
    UNION ALL
    SELECT 'payment', p.id, p.created_at, p.superseded_at, p.superseded_by, p.attributes->>'entry_kind', p.amount,
           p.currency, p.attributes
      FROM public.financial_payments p
     WHERE p.owner_id = v_owner AND p.attributes->>'ledger' = 'related_party' AND p.attributes->>'party_id' = p_party_id::text
  ), v AS (
    SELECT e.*, (e.a->>'occurred_on')::date occurred_on, public.related_party_evidence_level(e.a->'evidence') lvl,
           public.related_party_entry_sign(e.kind, e.a->>'offset_status', 'owner') * e.amount owner_signed,
           public.related_party_entry_sign(e.kind, e.a->>'offset_status', 'party') * e.amount party_signed
      FROM e
     WHERE (e.a->>'occurred_on')::date <= v_as_of AND e.recorded_at <= v_known
       AND (e.superseded_at IS NULL OR e.superseded_at > v_known)
     ORDER BY (e.a->>'occurred_on'), e.recorded_at, e.id LIMIT 5000
  ), refs AS MATERIALIZED (
    -- Every book record the lines cite, read from the books once (a per-line join re-planned the books view per row).
    SELECT DISTINCT (x->>'document_id')::uuid d, x->>'local_id' l
      FROM v, jsonb_array_elements(v.a->'evidence') x
     WHERE x ? 'document_id'
  ), bk AS MATERIALIZED (
    SELECT b.document_id, b.local_id, b.record_kind, b.year, b.record_date, b.section, b.category, b.amount_value
      FROM public.v_financial_accounting_records b
     WHERE b.owner_id = v_owner AND b.document_id = ANY (ARRAY(SELECT d FROM refs))
       AND b.local_id = ANY (ARRAY(SELECT l FROM refs))
  ), r AS (
    SELECT v.*,
           sum(v.owner_signed) OVER w running_owner,
           sum(v.party_signed) OVER w running_party,
           row_number() OVER w seq,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', b.document_id, 'local_id', b.local_id,
                      'record_kind', b.record_kind, 'year', b.year, 'date', b.record_date, 'section', b.section,
                      'category', b.category, 'amount', b.amount_value) ORDER BY b.local_id), '[]'::jsonb)
              FROM jsonb_array_elements(v.a->'evidence') x
              JOIN bk b ON b.document_id = (x->>'document_id')::uuid AND b.local_id = x->>'local_id'
             WHERE x ? 'document_id') booked_as
      FROM v
    WINDOW w AS (ORDER BY v.occurred_on, v.recorded_at, v.id ROWS UNBOUNDED PRECEDING)
  )
  SELECT jsonb_build_object(
    'party', jsonb_build_object('id', p_party_id, 'name', v_name),
    'as_of', v_as_of, 'known_at', v_known,
    'balance', jsonb_build_object(
      'owner_position', jsonb_build_object(
        'proven', coalesce(sum(owner_signed) FILTER (WHERE lvl = 'proven'), 0),
        'proven_and_supported', coalesce(sum(owner_signed) FILTER (WHERE lvl IN ('proven', 'supported')), 0),
        'all', coalesce(sum(owner_signed), 0)),
      'party_position', jsonb_build_object(
        'proven', coalesce(sum(party_signed) FILTER (WHERE lvl = 'proven'), 0),
        'proven_and_supported', coalesce(sum(party_signed) FILTER (WHERE lvl IN ('proven', 'supported')), 0),
        'all', coalesce(sum(party_signed), 0)),
      'disputed_offsets', coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' <> 'accepted'), 0)),
    'by_kind', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'level', k.lvl, 'n', k.n, 'amount', k.amt)
                                          ORDER BY k.kind, k.lvl)
                          FROM (SELECT kind, lvl, count(*) n, sum(amount) amt FROM r GROUP BY kind, lvl) k), '[]'::jsonb),
    'lines', coalesce(jsonb_agg(jsonb_build_object(
        'seq', seq, 'id', id, 'table', tbl, 'kind', kind, 'occurred_on', occurred_on, 'amount', amount, 'currency', currency,
        'owner_signed', owner_signed, 'party_signed', party_signed, 'running_owner', running_owner,
        'running_party', running_party, 'level', lvl, 'basis', a->>'basis', 'job', a->>'job', 'vehicle_id', a->>'vehicle_id',
        'method', a->>'method', 'offset_status', a->>'offset_status', 'equipment', a->'equipment',
        'entry_key', a->>'entry_key', 'evidence', a->'evidence', 'note', a->>'note', 'booked_as', booked_as,
        'for_entry', a->>'for_entry', 'supersedes', a->>'supersedes', 'recorded_at', recorded_at) ORDER BY seq), '[]'::jsonb),
    'equipment', coalesce(jsonb_agg(jsonb_build_object('id', id, 'occurred_on', occurred_on, 'amount_offset', amount,
        'offset_status', a->>'offset_status', 'level', lvl, 'equipment', a->'equipment', 'booked_as', booked_as)
        ORDER BY seq) FILTER (WHERE kind = 'offset'), '[]'::jsonb),
    'tax_by_year', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'year', t.y,
        'work_owed', t.work_owed,
        'payments_booked_as_revenue', t.paid_rev,
        'payments_not_booked_as_revenue', t.paid_other,
        'collected_for_party', t.collected, 'remitted_to_party', t.remitted, 'advanced_for_party', t.advanced,
        'offsets_accepted', t.off_acc, 'offsets_disputed', t.off_disp) ORDER BY t.y)
      FROM (SELECT extract(year FROM occurred_on)::int y,
                   coalesce(sum(amount) FILTER (WHERE kind = 'work_owed'), 0) work_owed,
                   coalesce(sum(amount) FILTER (WHERE kind = 'payment'
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(booked_as) b WHERE b->>'section' = 'Revenue')), 0) paid_rev,
                   coalesce(sum(amount) FILTER (WHERE kind = 'payment'
                     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(booked_as) b WHERE b->>'section' = 'Revenue')), 0) paid_other,
                   coalesce(sum(amount) FILTER (WHERE kind = 'collected'), 0) collected,
                   coalesce(sum(amount) FILTER (WHERE kind = 'remittance'), 0) remitted,
                   coalesce(sum(amount) FILTER (WHERE kind = 'advance'), 0) advanced,
                   coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' = 'accepted'), 0) off_acc,
                   coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' <> 'accepted'), 0) off_disp
              FROM r GROUP BY 1) t), '[]'::jsonb))
  INTO v_out
  FROM r;
  RETURN v_out;
END $$;

COMMIT;
