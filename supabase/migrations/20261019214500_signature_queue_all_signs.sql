-- One signature queue: my_signature_queue() lists every Sign the viewer can act on now, not only own work sessions.
-- Each item: {kind, ref_id, work_order_id, display_title, vehicle_label, clock, summary, sign{rpc, args_hint, binds[],
-- does_not_bind[]}}. Kinds:
--   quote_to_accept           customer; current quote with no acceptance and no refusal (work_order_quote_acceptance_refusal)
--   change_order_to_accept    same, when work_order_quote_is_change_order(quote) (a hook returning false until the QUOTE
--                             lane's change orders land; that lane replaces the two hooks below)
--   offer_to_accept           customer; the accept_offer actions work_order_offers_read already computes for this viewer
--   completion_to_accept      customer; current provider attestation without the customer's acceptance
--   contact_request           incoming pending contact requests (recipient user, evidenced actor bridge, org owner/member)
--   inspection_access_request verified owner of a vehicle whose inspection job has an accepted inspector and no current
--                             seller permission
--   invoice_payment_to_confirm payee (accepted provider, org owner/member): customer-reported payment witnesses that payee
--                             witnesses do not yet cover; amounts shown only to this party
--   work_session              existing own unconfirmed work days (unchanged rows; sign normalized)
--   cosign_request            not available: cosign_provider is self-initiated, so no pending request exists
-- Summaries carry open data only (open prices, labels by handle); no contact fields. coverage.by_kind reports returned,
-- total and availability per kind; coverage.kinds lists kinds with items (as before).
-- Live definition patched in place: its final RETURN passes through signature_queue_extend (two anchors, each once).
-- Contract: supabase/sql/test_signature_queue_all_signs.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- Created only when absent: in filename order 20261019213000 (change orders) defines the live versions first.
DO $hooks$ BEGIN
  IF to_regprocedure('public.work_order_change_orders_live()') IS NULL THEN
    CREATE FUNCTION public.work_order_change_orders_live() RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT false $f$;
  END IF;
  IF to_regprocedure('public.work_order_quote_is_change_order(uuid)') IS NULL THEN
    CREATE FUNCTION public.work_order_quote_is_change_order(p_quote_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  END IF;
END $hooks$;
COMMENT ON FUNCTION public.work_order_change_orders_live() IS 'Hook for my_signature_queue: true once quote change orders exist (QUOTE lane replaces).';
COMMENT ON FUNCTION public.work_order_quote_is_change_order(uuid) IS 'Hook for my_signature_queue: whether a quote version is a change order (QUOTE lane replaces).';

CREATE FUNCTION public.signature_queue_extend(p_uid uuid, p_base jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  at_ts timestamptz := statement_timestamp();
  per_kind constant integer := 100;
  ws jsonb; quotes jsonb := '[]'; change_orders jsonb := '[]'; offers jsonb := '[]'; completions jsonb := '[]';
  contacts jsonb; inspections jsonb := '[]'; payments jsonb := '[]';
  n_contacts integer; w record; q record; hdr jsonb; qs jsonb; ofr jsonb; comp jsonb; act jsonb; o jsonb; item jsonb;
  insp record; rec jsonb; cur_inv uuid; pw record; covered numeric; cum numeric;
  items jsonb; by_kind jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(i || jsonb_build_object(
      'vehicle_label', jsonb_build_object('text', NULLIF(concat_ws(' ', i#>>'{vehicle,year}', i#>>'{vehicle,make}', i#>>'{vehicle,model}'), ''),
        'year', i#>'{vehicle,year}', 'make', i#>'{vehicle,make}', 'model', i#>'{vehicle,model}', 'trim', NULL), 'display_title', NULL,
      'summary', jsonb_build_object('capture_span_minutes', i->'capture_span_minutes', 'evidence_counts', i->'evidence_counts'),
      'sign', jsonb_build_object('rpc', 'confirm_work_session', 'args_hint', jsonb_build_object('p_session_id', i->'ref_id', 'p_confirm', true),
        'binds', CASE WHEN jsonb_typeof(i#>'{sign,binds}') = 'array' THEN i#>'{sign,binds}' ELSE jsonb_build_array(i#>>'{sign,binds}') END,
        'does_not_bind', i#>'{sign,does_not_bind}'))), '[]'::jsonb)
  INTO ws FROM jsonb_array_elements(COALESCE(p_base->'items', '[]'::jsonb)) i;

  FOR w IN SELECT wo.id FROM public.work_orders wo WHERE wo.customer_id = p_uid AND wo.vehicle_id IS NOT NULL
      ORDER BY wo.created_at DESC NULLS LAST, wo.id LIMIT 200 LOOP
    hdr := public.work_order_open_header(w.id, true);
    qs := public.work_order_quote_state(w.id);
    IF jsonb_typeof(qs->'current_quote') = 'object' AND qs#>>'{acceptance,state}' IS DISTINCT FROM 'accepted'
       AND public.work_order_quote_acceptance_refusal((qs#>>'{current_quote,quote_id}')::uuid, p_uid, at_ts) IS NULL THEN
      SELECT x.*, s.observed_at INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id = x.id
        WHERE x.id = (qs#>>'{current_quote,quote_id}')::uuid;
      item := jsonb_build_object('kind', CASE WHEN public.work_order_quote_is_change_order(q.id) THEN 'change_order_to_accept' ELSE 'quote_to_accept' END,
        'ref_id', q.id, 'work_order_id', w.id, 'display_title', hdr->'display_title', 'vehicle_label', hdr->'vehicle_label',
        'clock', jsonb_build_object('issued_at', q.observed_at, 'valid_until', q.valid_until),
        'summary', jsonb_build_object('version', q.version, 'line_count', jsonb_array_length(q.lines), 'scope_status', qs#>'{current_quote,scope_status}',
          'totals_by_currency', (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', c, 'total', t, 'complete', k) ORDER BY c), '[]'::jsonb)
            FROM (SELECT l->>'currency' c, sum(CASE WHEN l->>'pricing_basis' = 'flat' THEN (l->>'amount')::numeric
                WHEN l->>'quantity' IS NOT NULL THEN (l->>'amount')::numeric * (l->>'quantity')::numeric END) t,
                bool_and(l->>'pricing_basis' = 'flat' OR l->>'quantity' IS NOT NULL) k
              FROM jsonb_array_elements(q.lines) l WHERE l->>'amount' IS NOT NULL GROUP BY 1) x),
          'deposit_requested', CASE WHEN q.deposit_requested_amount IS NOT NULL THEN
            jsonb_build_object('amount', q.deposit_requested_amount, 'currency', q.deposit_requested_currency) END),
        'sign', jsonb_build_object('rpc', 'accept_work_order_quote', 'args_hint', jsonb_build_object('p_quote_id', q.id, 'p_quote_hash', q.quote_hash),
          'binds', jsonb_build_array('this exact quote version (lines, scope snapshot, deposit request) by its hash'),
          'does_not_bind', jsonb_build_array('payment or deposit collection', 'later quote versions', 'completion acceptance')));
      IF item->>'kind' = 'change_order_to_accept' THEN change_orders := change_orders || item; ELSE quotes := quotes || item; END IF;
    END IF;

    BEGIN
      ofr := public.work_order_offers_read(w.id);
    EXCEPTION WHEN OTHERS THEN ofr := NULL;
    END;
    FOR act IN SELECT a FROM jsonb_array_elements(COALESCE(ofr#>'{viewer,actions}', '[]'::jsonb)) a WHERE a->>'action' = 'accept_offer' LOOP
      SELECT jsonb_build_object('offer', fo, 'requirement_kind', r->'requirement_kind', 'requirement_description', r->'description') INTO o
        FROM jsonb_array_elements(ofr->'requirements') r, jsonb_array_elements(r->'offers') fo
        WHERE fo->>'offer_id' = act#>>'{args,p_offer_id}' LIMIT 1;
      offers := offers || jsonb_build_object('kind', 'offer_to_accept', 'ref_id', act#>'{args,p_offer_id}', 'work_order_id', w.id,
        'display_title', hdr->'display_title', 'vehicle_label', hdr->'vehicle_label',
        'clock', jsonb_build_object('offered_at', o#>'{offer,offered_at}', 'available_from', o#>'{offer,available_from}', 'available_until', o#>'{offer,available_until}'),
        'summary', jsonb_build_object('requirement_kind', o->'requirement_kind', 'requirement_description', o->'requirement_description',
          'provider', (o#>'{offer,provider}') - 'user_id', 'offer_kind', o#>'{offer,offer_kind}', 'offer_rung', o#>'{offer,offer_rung}', 'terms', o#>'{offer,terms}'),
        'sign', jsonb_build_object('rpc', 'accept_offer', 'args_hint', act->'args',
          'binds', jsonb_build_array('this provider for this requirement on these exact terms (by hash)'),
          'does_not_bind', jsonb_build_array('payment', 'completion acceptance', 'other requirements')));
    END LOOP;

    comp := public.work_order_completion_overlay(w.id, '{}'::jsonb);
    IF jsonb_typeof(comp->'provider_attestation') = 'object' AND comp->>'customer_acceptance' IS DISTINCT FROM 'established' THEN
      completions := completions || jsonb_build_object('kind', 'completion_to_accept', 'ref_id', comp#>'{provider_attestation,completion_id}', 'work_order_id', w.id,
        'display_title', hdr->'display_title', 'vehicle_label', hdr->'vehicle_label',
        'clock', jsonb_build_object('attested_at', comp#>'{provider_attestation,signed_at}'),
        'summary', jsonb_build_object('signer_role', comp#>'{provider_attestation,signer_role}', 'scope_basis', comp#>'{provider_attestation,scope_basis}',
          'quote_id', comp#>'{provider_attestation,quote_id}', 'evidence_count', comp#>'{provider_attestation,evidence_count}'),
        'sign', jsonb_build_object('rpc', 'accept_work_completion', 'args_hint', jsonb_build_object('p_work_order_id', w.id,
            'p_completion_id', comp#>'{provider_attestation,completion_id}', 'p_completion_hash', comp#>'{provider_attestation,completion_hash}'),
          'binds', jsonb_build_array('acceptance of this exact provider completion attestation (by hash)'),
          'does_not_bind', jsonb_build_array('payment', 'release of funds', 'later attestations')));
    END IF;
  END LOOP;

  SELECT count(*), COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC) FILTER (WHERE x.rn <= per_kind), '[]'::jsonb) INTO n_contacts, contacts
  FROM (SELECT r.created_at, row_number() OVER (ORDER BY r.created_at DESC, r.id) rn,
      jsonb_build_object('kind', 'contact_request', 'ref_id', r.id, 'work_order_id', CASE WHEN r.context_kind = 'work_order' THEN r.context_id END,
        'display_title', ci#>'{context,label}', 'vehicle_label', NULL, 'clock', jsonb_build_object('created_at', r.created_at),
        'summary', jsonb_build_object('from', ci->'counterpart', 'recipient_kind', ci->'recipient_kind', 'context', ci->'context', 'message', r.message),
        'sign', jsonb_build_object('rpc', 'respond_contact_request', 'args_hint', jsonb_build_object('p_id', r.id, 'p_accept', true),
          'binds', jsonb_build_array('opening (or declining) an in-app thread with the requester'),
          'does_not_bind', jsonb_build_array('sharing contact fields', 'any offer, agreement or payment'))) AS item
    FROM public.contact_requests r CROSS JOIN LATERAL (SELECT public.contact_request_item(r, p_uid) AS ci) c
    WHERE r.status = 'pending' AND r.requester_user_id <> p_uid
      AND p_uid = ANY (public.contact_recipient_users(r.recipient_user_id, r.recipient_actor_id, r.recipient_organization_id))) x;

  FOR insp IN SELECT wo.id, wo.customer_id FROM public.ownership_verifications ov
      JOIN public.work_orders wo ON wo.vehicle_id = ov.vehicle_id AND wo.scope_category = 'inspection'
      WHERE ov.user_id = p_uid AND ov.status = 'approved' AND (ov.expires_at IS NULL OR ov.expires_at > now())
        AND wo.customer_id IS DISTINCT FROM p_uid
      ORDER BY wo.created_at DESC NULLS LAST, wo.id LIMIT per_kind LOOP
    SELECT ap.account_id, ap.accepted_at, ap.offer_id INTO q FROM public.work_order_accepted_providers(insp.id) ap
      WHERE ap.role = 'inspector' ORDER BY ap.accepted_at DESC LIMIT 1;
    IF q.offer_id IS NOT NULL AND public.inspection_seller_permission(insp.id, true)->>'state' IS DISTINCT FROM 'established' THEN
      hdr := public.work_order_open_header(insp.id, true);
      inspections := inspections || jsonb_build_object('kind', 'inspection_access_request', 'ref_id', insp.id, 'work_order_id', insp.id,
        'display_title', hdr->'display_title', 'vehicle_label', hdr->'vehicle_label',
        'clock', jsonb_build_object('inspector_accepted_at', q.accepted_at),
        'summary', jsonb_build_object('requested_by', public.platform_person_label(insp.customer_id), 'inspector', public.platform_person_label(q.account_id),
          'inspector_offer_id', q.offer_id, 'permission_state', public.inspection_seller_permission(insp.id, true)->'state'),
        'sign', jsonb_build_object('rpc', 'grant_inspection_access', 'args_hint', jsonb_build_object('p_inspection_work_order_id', insp.id,
            'p_scope', NULL, 'p_window', NULL),
          'binds', jsonb_build_array('permission for the accepted inspector to inspect the vehicle within your stated scope and window'),
          'does_not_bind', jsonb_build_array('vehicle access rows', 'a sale or price', 'payment')));
    END IF;
  END LOOP;

  FOR w IN SELECT DISTINCT p.work_order_id AS id FROM public.work_order_payment_witnesses p JOIN public.vehicle_observations s ON s.id = p.id
      WHERE p.witness_side = 'payer' AND s.is_superseded IS FALSE LOOP
    CONTINUE WHEN public.work_order_completion_signer_role(w.id, p_uid) IS NULL;
    rec := public.work_order_invoice_reconciliation(w.id);
    cur_inv := (rec->>'invoice_id')::uuid;
    covered := COALESCE((rec->>'confirmed_received')::numeric, 0);
    cum := 0;
    hdr := public.work_order_open_header(w.id, true);
    FOR pw IN SELECT p.*, i.version AS invoice_version FROM public.work_order_payment_witnesses p
        JOIN public.vehicle_observations s ON s.id = p.id AND s.is_superseded IS FALSE
        JOIN public.work_order_invoices i ON i.id = p.invoice_id
        WHERE p.work_order_id = w.id AND p.witness_side = 'payer' ORDER BY p.paid_at, p.id LOOP
      IF pw.currency = rec->>'currency' THEN cum := cum + pw.amount; END IF;
      CONTINUE WHEN pw.currency = rec->>'currency' AND cum <= covered;
      payments := payments || jsonb_build_object('kind', 'invoice_payment_to_confirm', 'ref_id', pw.id, 'work_order_id', w.id,
        'display_title', hdr->'display_title', 'vehicle_label', hdr->'vehicle_label',
        'clock', jsonb_build_object('paid_at', pw.paid_at, 'witnessed_at', pw.witnessed_at),
        'summary', jsonb_build_object('reported_by_role', pw.witness_role, 'amount', pw.amount, 'currency', pw.currency, 'method', pw.method,
          'reference', pw.reference, 'invoice_version', pw.invoice_version, 'reconciliation_state', rec->'state', 'visibility', 'parties_only'),
        'sign', jsonb_build_object('rpc', 'record_work_order_payment', 'args_hint', jsonb_build_object('p_invoice_id', cur_inv, 'p_amount', pw.amount,
            'p_currency', pw.currency, 'p_method', pw.method, 'p_paid_at', pw.paid_at, 'p_reference', pw.reference),
          'binds', jsonb_build_array('your statement, as payee, that this amount was received'),
          'does_not_bind', jsonb_build_array('moving, charging or releasing money', 'payout or disbursement')));
    END LOOP;
  END LOOP;

  items := (SELECT COALESCE(jsonb_agg(e ORDER BY e->>'kind' = 'work_session'), '[]'::jsonb) FROM jsonb_array_elements(
    quotes || change_orders || offers || completions || payments || inspections || contacts || ws) e);
  by_kind := jsonb_build_object(
    'quote_to_accept', jsonb_build_object('returned', jsonb_array_length(quotes), 'available', true),
    'change_order_to_accept', jsonb_build_object('returned', jsonb_array_length(change_orders), 'available', public.work_order_change_orders_live(),
      'basis', CASE WHEN NOT public.work_order_change_orders_live() THEN 'quote change orders are not live yet' END),
    'offer_to_accept', jsonb_build_object('returned', jsonb_array_length(offers), 'available', true),
    'completion_to_accept', jsonb_build_object('returned', jsonb_array_length(completions), 'available', true),
    'invoice_payment_to_confirm', jsonb_build_object('returned', jsonb_array_length(payments), 'available', true),
    'inspection_access_request', jsonb_build_object('returned', jsonb_array_length(inspections), 'available', true),
    'contact_request', jsonb_build_object('returned', jsonb_array_length(contacts), 'total', n_contacts, 'available', true),
    'work_session', jsonb_build_object('returned', jsonb_array_length(ws), 'total', p_base#>'{coverage,total}', 'available', true),
    'cosign_request', jsonb_build_object('returned', 0, 'available', false,
      'basis', 'cosign_provider is self-initiated; no pending co-sign request record exists'));
  RETURN p_base || jsonb_build_object('items', items,
    'coverage', p_base->'coverage' || jsonb_build_object('returned', jsonb_array_length(items),
      'total', COALESCE((p_base#>>'{coverage,total}')::int, 0) + n_contacts + jsonb_array_length(quotes || change_orders || offers || completions || payments || inspections),
      'limit', per_kind, 'limit_basis', 'per kind; work sessions keep their own limit',
      'kinds', (SELECT COALESCE(jsonb_agg(DISTINCT e->>'kind'), '[]'::jsonb) FROM jsonb_array_elements(items) e),
      'by_kind', by_kind,
      'kinds_not_yet_available', (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_each(by_kind) b(k, v) WHERE (v->>'available')::boolean IS NOT TRUE),
      'population', 'Signs this account can act on now: customer quote/offer/completion acceptances, payee payment confirmations, verified-owner inspection permissions, incoming contact requests, own unconfirmed work sessions'),
    'money', 'open prices only; payment witnesses only to the payee party they concern; no contact fields');
END $$;
REVOKE ALL ON FUNCTION public.signature_queue_extend(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.signature_queue_extend(uuid,jsonb) IS 'Internal to my_signature_queue: adds every Sign the account can act on now (quote, change order, offer and completion acceptance, payment confirmation, inspection permission, contact request) to the work-session queue, with per-kind coverage.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.my_signature_queue()'::regprocedure);
  head constant text := $a$RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),$a$;
  tail constant text := $a$'population', 'own unconfirmed work sessions with capture span on own resolved vehicles'));$a$;
BEGIN
  IF position('signature_queue_extend' IN def) > 0 THEN RAISE EXCEPTION 'my_signature_queue already extended'; END IF;
  IF (length(def) - length(replace(def, head, ''))) / length(head) <> 1 OR (length(def) - length(replace(def, tail, ''))) / length(tail) <> 1 THEN
    RAISE EXCEPTION 'my_signature_queue anchors not found once';
  END IF;
  EXECUTE replace(replace(def, head, 'RETURN public.signature_queue_extend(uid, ' || substr(head, length('RETURN ') + 1)),
    tail, $t$'population', 'own unconfirmed work sessions with capture span on own resolved vehicles')));$t$);
END $apply$;
COMMENT ON FUNCTION public.my_signature_queue() IS 'Authenticated self queue of every Sign the account can act on now (see signature_queue_extend): kind, ref, work order, open summary, sign rpc with args hint, binds and does_not_bind; per-kind coverage. No contact fields; payments only to the payee they concern.';
NOTIFY pgrst, 'reload schema';
COMMIT;
