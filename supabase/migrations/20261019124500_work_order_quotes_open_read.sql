-- Open the quote reader under the privacy doctrine (owner, 2026-10-18 23:06-23:08 PT; work-order-intelligence.md):
-- job and quote data is open by default. Quote scope, priced lines, labor rates and parts costs are readable by
-- anyone, including anon; personal information is withheld at the source; payments and balances between parties
-- are parties-only (this reader returns none); contact goes only through a platform-brokered request.
--
--   * work_order_quotes_read(p_work_order_id) becomes callable by anon and authenticated. It follows the open job
--     readers (20261019121500): work_order_viewer_slots for slots, a work order on a vehicle whose owner set
--     is_public = false only for slot holders, job_reader_is_party for parties, job_reader_viewer for the viewer
--     block, work_order_open_header for vehicle_label / display_title / request_source_label, and the platform_*_label
--     helpers for people. A visitor's viewer is {context:'visitor', slots:[], actions:[]}.
--   * The current quote and every non-withdrawn version carry the full scope snapshot, priced lines, totals, the
--     deposit as a requested term (not a payment) and validity. A withdrawn version shows its summary only.
--   * Quoting party and signer appear by public profile handle, organization name, or 'unnamed party'; raw user ids
--     only to parties. A quote issued through issue_work_order_quote is attributed 'authenticated_sign'.
--   * For non-parties, a free-text value that names the customer or looks like contact data is withheld
--     (the rule work_order_open_header applies to titles), with a <key>_visibility marker.
--   * accept_quote is offered only when work_order_quote_acceptance_refusal returns null for the viewer: the
--     customer, on the current, unexpired, in-scope version. Acceptance stays customer-only.
-- Read-only. Contract: supabase/sql/test_work_order_quotes_open_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_text_is_personal(p_work_order_id uuid, p_text text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_text IS NULL THEN RETURN false; END IF;
  IF p_text ~ '(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})' THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.work_orders w,
      regexp_split_to_table(concat_ws(' ', w.customer_name,
        (SELECT p.full_name FROM public.profiles p WHERE p.id = w.customer_id)), '\s+') tok
    WHERE w.id = p_work_order_id AND length(lower(regexp_replace(tok, '\W', '', 'g'))) >= 3
      AND p_text ~* ('\m' || lower(regexp_replace(tok, '\W', '', 'g')) || '\M'));
END $$;
REVOKE ALL ON FUNCTION public.work_order_text_is_personal(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_text_is_personal(uuid,text) IS 'Internal: true when text names the work order customer (customer_name or profile full_name tokens of 3+ letters) or looks like an email or phone number. Same rule as work_order_open_header titles.';

CREATE FUNCTION public.work_order_quote_redact(p_work_order_id uuid, p_items jsonb, p_keys text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE item jsonb; k text; result jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RETURN p_items; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(item) = 'object' THEN
      FOREACH k IN ARRAY p_keys LOOP
        IF jsonb_typeof(item->k) = 'string' AND public.work_order_text_is_personal(p_work_order_id, item->>k) THEN
          item := item || jsonb_build_object(k, NULL, k || '_visibility', 'withheld_personal_info');
        END IF;
      END LOOP;
    END IF;
    result := result || jsonb_build_array(item);
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.work_order_quote_redact(uuid,jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_quote_redact(uuid,jsonb,text[]) IS 'Internal: withholds the named free-text keys of each array element when work_order_text_is_personal, marking <key>_visibility.';

-- One quote version as the open reader shows it.
CREATE FUNCTION public.work_order_quote_for_viewer(p_quote_id uuid, p_party boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  q public.work_order_quotes%ROWTYPE;
  s public.vehicle_observations%ROWTYPE;
  snap jsonb;
  ln jsonb;
BEGIN
  SELECT * INTO q FROM public.work_order_quotes WHERE id = p_quote_id;
  SELECT * INTO s FROM public.vehicle_observations WHERE id = p_quote_id;
  snap := q.scope_snapshot;
  ln := q.lines;
  IF NOT p_party THEN
    snap := snap || jsonb_build_object(
      'operations', public.work_order_quote_redact(q.work_order_id, snap->'operations', ARRAY['task_description']),
      'requirements', public.work_order_quote_redact(q.work_order_id, snap->'requirements', ARRAY['description']),
      'specifications', public.work_order_quote_redact(q.work_order_id, snap->'specifications', ARRAY['material_label','process_label']),
      'parts', public.work_order_quote_redact(q.work_order_id, snap->'parts', ARRAY['part_name','brand']),
      'labor', public.work_order_quote_redact(q.work_order_id, snap->'labor', ARRAY['task_name']));
    ln := public.work_order_quote_redact(q.work_order_id, ln, ARRAY['description']);
  END IF;
  RETURN jsonb_build_object('quote_id', q.id, 'version', q.version, 'supersedes_quote_id', q.supersedes_quote_id,
    'quote_hash', q.quote_hash,
    'quoting_party', CASE q.quoting_party_kind
        WHEN 'user' THEN public.platform_person_label(q.quoting_user_id)
        WHEN 'organization' THEN public.platform_organization_label(q.quoting_organization_id)
        WHEN 'actor' THEN public.platform_actor_label(q.quoting_actor_id)
        ELSE jsonb_build_object('kind', 'unknown', 'label', 'unnamed party') END
      || jsonb_build_object('attribution', CASE WHEN s.extraction_method = 'work_order_quote_issue_sign_v1'
          AND s.submitted_by_user_id IS NOT DISTINCT FROM q.quoting_user_id THEN 'authenticated_sign'
          ELSE 'source_attributed_not_authenticated' END,
        'issued_by_role', s.structured_data#>'{work_order_resource,issued_by_role}')
      || CASE WHEN p_party AND q.quoting_user_id IS NOT NULL THEN jsonb_build_object('user_id', q.quoting_user_id) ELSE '{}'::jsonb END,
    'valid_until', q.valid_until, 'expired', q.valid_until IS NOT NULL AND q.valid_until <= statement_timestamp(),
    'scope_snapshot', snap,
    'scope_counts', (SELECT jsonb_object_agg(k, jsonb_array_length(v)) FROM jsonb_each(q.scope_snapshot) t(k, v)
      WHERE jsonb_typeof(v) = 'array'),
    'lines', ln,
    'unpriced_lines', (SELECT count(*) FROM jsonb_array_elements(q.lines) l WHERE l->>'amount' IS NULL),
    'totals_by_currency', (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', c, 'total', t, 'complete', k) ORDER BY c), '[]'::jsonb)
      FROM (SELECT l->>'currency' c,
          sum(CASE WHEN l->>'pricing_basis' = 'flat' THEN (l->>'amount')::numeric
            WHEN l->>'quantity' IS NOT NULL THEN (l->>'amount')::numeric * (l->>'quantity')::numeric END) t,
          bool_and(l->>'pricing_basis' = 'flat' OR l->>'quantity' IS NOT NULL) k
        FROM jsonb_array_elements(q.lines) l WHERE l->>'amount' IS NOT NULL GROUP BY 1) x),
    'totals_basis', 'flat amounts plus rate times stated quantity; a rate line without a quantity leaves its currency incomplete',
    'deposit_requested', CASE WHEN q.deposit_requested_amount IS NOT NULL THEN jsonb_build_object('amount', q.deposit_requested_amount,
      'currency', q.deposit_requested_currency, 'nature', 'requested_term_not_payment') END,
    'source', jsonb_build_object('observation_id', s.id, 'source_id', s.source_id, 'extraction_method', s.extraction_method,
      'confidence_score', s.confidence_score, 'observed_at', s.observed_at, 'ingested_at', s.ingested_at),
    'recorded_at', q.recorded_at);
END $$;
REVOKE ALL ON FUNCTION public.work_order_quote_for_viewer(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_quote_for_viewer(uuid,boolean) IS 'Internal: one quote version for the open reader: scope, priced lines, totals, deposit as a requested term, people by handle or unnamed party, raw ids and personal free text only for parties.';

CREATE OR REPLACE FUNCTION public.work_order_quotes_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  quoting_viewer boolean;
  ctx text;
  qs jsonb;
  cur_id uuid;
  acc_state text;
  signer uuid;
  quote jsonb;
  history jsonb;
  eligible boolean;
  n_versions integer; n_current integer; n_acceptances integer;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  quoting_viewer := viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_quotes x
    WHERE x.work_order_id = w.id AND x.quoting_user_id = viewer);
  IF quoting_viewer THEN my_slots := array_append(my_slots, 'quoting_party'); END IF;
  party := public.job_reader_is_party(my_slots) OR quoting_viewer;
  ctx := public.job_reader_context(my_slots);
  IF ctx = 'visitor' AND quoting_viewer THEN ctx := 'provider'; END IF;

  qs := public.work_order_quote_state(w.id);
  cur_id := (qs#>>'{current_quote,quote_id}')::uuid;
  acc_state := qs#>>'{acceptance,state}';
  signer := (qs#>>'{acceptance,signer_user_id}')::uuid;
  IF cur_id IS NOT NULL THEN
    quote := public.work_order_quote_for_viewer(cur_id, party) || jsonb_build_object('scope_status', qs#>'{current_quote,scope_status}');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE s.is_superseded IS FALSE AND s.vehicle_id IS NOT DISTINCT FROM w.vehicle_id),
      COALESCE(jsonb_agg(
        CASE WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id
          THEN jsonb_build_object('quote_id', x.id, 'version', x.version, 'supersedes_quote_id', x.supersedes_quote_id,
            'quote_hash', x.quote_hash)
          ELSE public.work_order_quote_for_viewer(x.id, party) END
        || jsonb_build_object('observed_at', s.observed_at,
          'state', CASE WHEN x.id = cur_id THEN 'current'
            WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'withdrawn' ELSE 'superseded' END,
          'withheld_reason', CASE WHEN x.id = cur_id THEN NULL
            WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'source_withdrawn'
            ELSE 'superseded_by_newer_version' END,
          'acceptances_recorded', (SELECT count(*) FROM public.work_order_quote_acceptances a WHERE a.quote_id = x.id))
        ORDER BY x.version), '[]'::jsonb)
    INTO n_versions, n_current, history
    FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id = x.id WHERE x.work_order_id = w.id;
  SELECT count(*) INTO n_acceptances FROM public.work_order_quote_acceptances WHERE work_order_id = w.id;

  eligible := viewer IS NOT NULL AND cur_id IS NOT NULL
    AND public.work_order_quote_acceptance_refusal(cur_id, viewer, statement_timestamp()) IS NULL
    AND NOT (acc_state = 'accepted' AND (qs#>>'{acceptance,quote_id}')::uuid = cur_id);

  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object(
    'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,
    'quoted_at', jsonb_build_object('stored', w.quoted_at, 'derived', qs#>'{current_quote,observed_at}',
      'basis', 'current quote observation clock'),
    'approved_at', jsonb_build_object('stored', w.approved_at,
      'derived', CASE WHEN acc_state = 'accepted' THEN qs#>'{acceptance,signed_at}' END,
      'basis', 'current quote acceptance sign clock; work_orders.approved_at is not written by this path'),
    'current_quote', quote,
    'history', history,
    'acceptance', jsonb_build_object('state', acc_state,
      'accepted_by_viewer', acc_state = 'accepted' AND viewer IS NOT NULL AND signer = viewer,
      'quote_id', qs#>'{acceptance,quote_id}', 'quote_version', qs#>'{acceptance,quote_version}',
      'quote_hash', qs#>'{acceptance,quote_hash}', 'signed_at', qs#>'{acceptance,signed_at}',
      'signer_role', qs#>'{acceptance,signer_role}',
      'signer', CASE WHEN signer IS NOT NULL THEN public.platform_person_label(signer)
        || CASE WHEN party THEN jsonb_build_object('user_id', signer) ELSE '{}'::jsonb END END,
      'withheld_reason', qs#>'{acceptance,withheld_reason}'),
    'viewer', public.job_reader_viewer(ctx, my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'prices_visible', true,
        'actions', CASE WHEN eligible THEN jsonb_build_array(jsonb_build_object('action', 'accept_quote',
          'rpc', 'accept_work_order_quote', 'args', jsonb_build_object('p_quote_id', cur_id,
          'p_quote_hash', qs#>'{current_quote,quote_hash}'))) ELSE '[]'::jsonb END),
    'coverage', jsonb_build_object('quote_versions', n_versions, 'versions_with_current_source', n_current,
      'acceptances_recorded', n_acceptances, 'source_scope', 'explicitly_projected_work_record_observations',
      'prices', 'open', 'party_money', 'not_returned_by_this_reader', 'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only',
    'deposit_collected', 'not_established', 'payment_authorized', false, 'disbursement', 'not_performed');
END $$;
REVOKE ALL ON FUNCTION public.work_order_quotes_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_quotes_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_quotes_read(uuid) IS 'Open (anon and authenticated) quote reader for one work order under the privacy doctrine: current quote and version history with scope, priced lines, totals and deposit as a requested term; acceptance state; people by handle or unnamed party; vehicle_label, display_title, request_source_label; viewer block and accept_quote only for the eligible customer. A work order on a non-public vehicle only for slot holders. No contact fields, payments or balances. Read-only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
