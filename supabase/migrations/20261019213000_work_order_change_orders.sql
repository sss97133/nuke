-- Change orders (QUOTE lane RSI pass 6, PR C). A change order is a new quote version that amends the ACCEPTED current
-- quote by explicit changes, flagged as such and carrying its diff; the customer accepts it through the existing
-- accept_work_order_quote path on the new version. Until then the job path reports change_order_pending.
--
--   * issue_change_order(p_work_order_id, p_base_quote_id, p_changes, p_reason): the same issuers as issue_work_order_quote
--     (organization owner, accepted provider, evidenced performer; never the customer). The base must be the current quote
--     with a current customer acceptance. p_changes is a list of explicit changes against the base lines:
--       {action add, line} | {action remove, line_index} | {action modify, line_index, line} |
--       {action substitute, specification_id, field material|process, from_key, to_key[, to_label][, line_index[, line]]}
--     line_index is 0-based in the base quote lines, each used at most once; a substitution names a specification of the
--     current scope by id and its current material/process key (from_key) and the new key. New lines follow the base order
--     (removed lines dropped, modified lines replaced), then added lines. Lines are validated as quote lines.
--   * work_order_quotes.change_order: {base_quote_id, base_quote_hash, base_version, reason, changes[]} with each change's
--     action, base_line_index, new_line_index, from_line, to_line and specification reference. Included in the quote hash
--     (unchanged for ordinary quotes). Only the Sign records a change order (projector check).
--   * Readers: work_order_quote_for_viewer adds is_change_order and change_order (line descriptions and the reason withheld
--     when personal, as other quote text); work_order_quote_state adds current_quote.is_change_order and change_order
--     {state pending|accepted, base}; work_order_quotes_read adds change_order and viewer.issuer_actions (issue_change_order for issuers; viewer.actions unchanged).
--   * my_signature_queue hooks (backend 20261019214500): work_order_change_orders_live() true and
--     work_order_quote_is_change_order(quote) from work_order_quotes.change_order, so change orders queue as change_order_to_accept.
--   * Job path (anchored on the live definition, each anchor exactly once): terms.change_order, gap change_order_pending,
--     and accept clocks exclude cosigner terms that are no longer binding (work_order_accepted_cosigners).
-- No payment, deposit or messaging. Contract: supabase/sql/test_work_order_change_orders.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_order_quotes ADD COLUMN change_order jsonb
  CHECK (change_order IS NULL OR (jsonb_typeof(change_order) = 'object' AND change_order ?& ARRAY['base_quote_id','base_quote_hash','changes']));
COMMENT ON COLUMN public.work_order_quotes.change_order IS 'Set when this version is a change order: the accepted base version, its hash, the reason and the explicit changes (issue_change_order). Null for ordinary quote versions.';

-- Who may issue a quote version for a work order (same rule as issue_work_order_quote).
CREATE FUNCTION public.work_order_quote_issuer_role(p_user uuid, p_work_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE w public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND OR p_user IS NULL OR w.customer_id IS NOT DISTINCT FROM p_user THEN RETURN NULL; END IF;
  RETURN CASE
    WHEN w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id = w.organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN 'organization_owner'
    WHEN EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = p_user) THEN 'accepted_provider'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(public.viewer_identity_bridge(p_user)->'evidenced_actor_ids') a
      WHERE a::uuid = w.lead_actor_id OR EXISTS (SELECT 1 FROM public.work_order_line_items li
        WHERE li.work_order_id = w.id AND li.actor_id = a::uuid)) THEN 'performer' END;
END $$;
REVOKE ALL ON FUNCTION public.work_order_quote_issuer_role(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Applies explicit changes to base quote lines. Returns {lines, changes} or raises.
CREATE FUNCTION public.work_order_change_order_apply(p_base_lines jsonb, p_snapshot jsonb, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  n_base integer := jsonb_array_length(COALESCE(p_base_lines, '[]'::jsonb));
  c jsonb; act text; idx integer; spec jsonb; fld text;
  used integer[] := '{}';
  repl jsonb := '{}'::jsonb;
  removed integer[] := '{}';
  added jsonb := '[]'::jsonb;
  norm jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  newpos jsonb := '{}'::jsonb;
  i integer; n integer := 0; spec_count integer := 0;
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Changes must be an array of 1 to 100 explicit changes' USING ERRCODE = '23514';
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    act := c->>'action';
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR COALESCE(act, '') NOT IN ('add','remove','modify','substitute')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) k WHERE k <> ALL (CASE act
        WHEN 'add' THEN ARRAY['action','line'] WHEN 'remove' THEN ARRAY['action','line_index']
        WHEN 'modify' THEN ARRAY['action','line_index','line']
        ELSE ARRAY['action','specification_id','field','from_key','to_key','to_label','line_index','line'] END)) THEN
      RAISE EXCEPTION 'Invalid change: %', c USING ERRCODE = '23514';
    END IF;
    IF act IN ('add','modify') AND jsonb_typeof(c->'line') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Change % needs a line object', act USING ERRCODE = '23514';
    END IF;
    IF act IN ('remove','modify') OR c ? 'line_index' THEN
      IF jsonb_typeof(c->'line_index') IS DISTINCT FROM 'number' OR (c->>'line_index') !~ '^\d+$'
        OR (c->>'line_index')::integer >= n_base THEN
        RAISE EXCEPTION 'line_index must name a line of the accepted quote (0 to %)', n_base - 1 USING ERRCODE = '23514';
      END IF;
      idx := (c->>'line_index')::integer;
      IF idx = ANY (used) THEN RAISE EXCEPTION 'Each accepted quote line may be changed once' USING ERRCODE = '23514'; END IF;
      used := used || idx;
    ELSE
      idx := NULL;
    END IF;
    spec := NULL;
    IF act = 'substitute' THEN
      fld := c->>'field';
      SELECT s INTO spec FROM jsonb_array_elements(COALESCE(p_snapshot->'specifications', '[]'::jsonb)) s WHERE s->>'id' = c->>'specification_id';
      IF spec IS NULL OR COALESCE(fld, '') NOT IN ('material','process')
        OR c->>'from_key' IS DISTINCT FROM spec->>(fld||'_key')
        OR jsonb_typeof(c->'to_key') IS DISTINCT FROM 'string' OR c->>'to_key' !~ '^[a-z0-9][a-z0-9_.:/-]{0,79}$'
        OR c->>'to_key' = c->>'from_key'
        OR (c ? 'to_label' AND (jsonb_typeof(c->'to_label') IS DISTINCT FROM 'string' OR length(btrim(c->>'to_label')) NOT BETWEEN 1 AND 200))
        OR (c ? 'line' AND (idx IS NULL OR jsonb_typeof(c->'line') IS DISTINCT FROM 'object')) THEN
        RAISE EXCEPTION 'A substitution names a current specification, field material or process, its current key and a new key: %', c USING ERRCODE = '23514';
      END IF;
      spec_count := spec_count + 1;
    END IF;
    IF act = 'remove' THEN removed := removed || idx;
    ELSIF act IN ('modify','substitute') AND c ? 'line' THEN repl := repl || jsonb_build_object(idx::text, c->'line');
    ELSIF act = 'add' THEN added := added || jsonb_build_array(c->'line');
    END IF;
    norm := norm || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('action', act, 'base_line_index', idx,
      'from_line', CASE WHEN idx IS NOT NULL AND act <> 'add' AND (act <> 'substitute' OR c ? 'line') THEN p_base_lines->idx END,
      'to_line', CASE WHEN act IN ('add','modify') OR (act = 'substitute' AND c ? 'line') THEN c->'line' END,
      'specification', CASE WHEN spec IS NOT NULL THEN jsonb_build_object('specification_id', spec->'id', 'line_item_id', spec->'line_item_id',
        'field', fld, 'from_key', c->'from_key', 'from_label', spec->(fld||'_label'), 'to_key', c->'to_key', 'to_label', c->'to_label') END)));
  END LOOP;
  FOR i IN 0 .. n_base - 1 LOOP
    CONTINUE WHEN i = ANY (removed);
    lines := lines || jsonb_build_array(COALESCE(repl->(i::text), p_base_lines->i));
    newpos := newpos || jsonb_build_object(i::text, n);
    n := n + 1;
  END LOOP;
  lines := lines || added;
  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'A change order keeps at least one line' USING ERRCODE = '23514'; END IF;
  IF lines = p_base_lines AND spec_count = 0 THEN RAISE EXCEPTION 'A change order changes something' USING ERRCODE = '23514'; END IF;
  -- Position of each change's line in the new version.
  SELECT jsonb_agg(CASE
      WHEN x->>'action' = 'remove' THEN x
      WHEN x->>'action' = 'add' THEN x || jsonb_build_object('new_line_index', n + (SELECT count(*) FROM jsonb_array_elements(norm) WITH ORDINALITY y(v, o2)
        WHERE y.v->>'action' = 'add' AND y.o2 < t.o))
      WHEN x ? 'base_line_index' THEN x || jsonb_build_object('new_line_index', newpos->(x->>'base_line_index'))
      ELSE x END ORDER BY t.o) INTO norm
    FROM jsonb_array_elements(norm) WITH ORDINALITY t(x, o);
  RETURN jsonb_build_object('lines', lines, 'changes', norm);
END $$;
REVOKE ALL ON FUNCTION public.work_order_change_order_apply(jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_change_order_apply(jsonb,jsonb,jsonb) IS 'Internal: applies explicit add/remove/modify/substitute changes to the accepted quote lines; returns the new lines and the normalized changes (base and new line positions, from/to lines, specification reference).';

CREATE FUNCTION public.issue_change_order(p_work_order_id uuid, p_base_quote_id uuid, p_changes jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  issued timestamptz := now();
  w public.work_orders%ROWTYPE;
  issuer_role text;
  owner_source uuid;
  request_key text;
  next_version integer;
  base public.work_order_quotes%ROWTYPE;
  qs jsonb;
  snapshot jsonb;
  applied jsonb;
  obs_id uuid;
  q public.work_order_quotes%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF FOUND AND w.customer_id IS NOT DISTINCT FROM signer THEN
    RAISE EXCEPTION 'The customer cannot issue a change order on their own job' USING ERRCODE = '42501';
  END IF;
  issuer_role := public.work_order_quote_issuer_role(signer, p_work_order_id);
  IF issuer_role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for change orders' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Change order reason required (at most 1000 characters)' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text, 0));
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-change-order', signer, w.id, p_base_quote_id, p_changes, btrim(p_reason))::text);
  SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_change_order:'||w.id::text
      AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('quote_id', q.id, 'version', q.version, 'quote_hash', q.quote_hash, 'work_order_id', w.id,
      'base_quote_id', p_base_quote_id, 'change_order', q.change_order, 'duplicate', true, 'payment_authorized', false, 'customer_notified', false);
  END IF;
  qs := public.work_order_quote_state(w.id);
  IF (qs#>>'{current_quote,quote_id}')::uuid IS DISTINCT FROM p_base_quote_id THEN
    RAISE EXCEPTION 'The base must be the current quote version' USING ERRCODE = '23514';
  END IF;
  IF qs#>>'{acceptance,state}' IS DISTINCT FROM 'accepted' OR (qs#>>'{acceptance,quote_id}')::uuid IS DISTINCT FROM p_base_quote_id THEN
    RAISE EXCEPTION 'A change order amends an accepted quote; revise an unaccepted quote with issue_work_order_quote' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO base FROM public.work_order_quotes WHERE id = p_base_quote_id;
  snapshot := public.work_order_quote_scope_snapshot(w.id);
  applied := public.work_order_change_order_apply(base.lines, snapshot, p_changes);
  SELECT COALESCE(max(version), 0) + 1 INTO next_version FROM public.work_order_quotes WHERE work_order_id = w.id;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis,
    source_event_at, source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id,
    observer_raw, extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_change_order:'||w.id::text, issued, 'event_time', issued, 'exact', 'work_record',
    format('Change order (quote version %s) amending accepted version %s of work order %s.', next_version, base.version, w.id), request_key,
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'quote', 'work_order_id', w.id,
      'quote_version', next_version, 'supersedes_quote_id', p_base_quote_id,
      'quoting_party', jsonb_build_object('kind', 'user', 'id', signer),
      'scope_snapshot', snapshot, 'lines', applied->'lines', 'deposit_requested', NULL, 'valid_until', NULL,
      'issued_by_role', issuer_role, 'issuer_organization_id', CASE WHEN issuer_role = 'organization_owner' THEN w.organization_id END,
      'change_order', jsonb_build_object('base_quote_id', p_base_quote_id, 'base_quote_hash', base.quote_hash,
        'reason', btrim(p_reason), 'requested', p_changes))),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'issued_by_role', issuer_role),
    'work_order_change_order_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_resource_observation(obs_id);
  SELECT * INTO q FROM public.work_order_quotes WHERE id = obs_id;
  RETURN jsonb_build_object('quote_id', q.id, 'version', q.version, 'quote_hash', q.quote_hash, 'work_order_id', w.id,
    'base_quote_id', p_base_quote_id, 'change_order', q.change_order, 'lines', q.lines, 'issued_by_role', issuer_role,
    'issued_at', issued, 'accept_with', jsonb_build_object('rpc', 'accept_work_order_quote', 'p_quote_id', q.id, 'p_quote_hash', q.quote_hash),
    'duplicate', false, 'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.issue_change_order(uuid,uuid,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_change_order(uuid,uuid,jsonb,text) TO authenticated;
COMMENT ON FUNCTION public.issue_change_order(uuid,uuid,jsonb,text) IS 'Sign: an organization owner, accepted provider or evidenced performer issues a change order: a new quote version amending the accepted current quote by explicit add/remove/modify/substitute changes (a substitution names a specification and its material/process key), with a reason. The customer accepts it with accept_work_order_quote. No payment.';

-- Live definitions (20261019094500 / 20261019124500) with the change-order additions.

CREATE OR REPLACE FUNCTION public.project_work_order_quote_event(p_observation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  event_type text;
  cur public.work_order_quotes%ROWTYPE;
  q public.work_order_quotes%ROWTYPE;
  next_version integer;
  party_kind text;
  party_id uuid;
  snapshot jsonb;
  ln jsonb;
  priced integer := 0;
  hash text;
  owner_source uuid;
  refusal text;
  co jsonb;
  applied jsonb;
  co_stored jsonb;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  event_type := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  -- One writer per work order at a time, so version numbers and the current quote cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text,0));
  IF event_type='quote' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_quotes WHERE id=o.id) THEN
      RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',true);
    END IF;
    SELECT x.* INTO cur FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
      WHERE x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      ORDER BY x.version DESC LIMIT 1;
    SELECT COALESCE(max(version),0)+1 INTO next_version FROM public.work_order_quotes WHERE work_order_id=w.id;
    IF jsonb_typeof(e->'quote_version') IS DISTINCT FROM 'number' OR (e->>'quote_version')::numeric <> next_version THEN
      RAISE EXCEPTION 'Quote version must be the next version for this work order (%)',next_version;
    END IF;
    IF (e->>'supersedes_quote_id')::uuid IS DISTINCT FROM cur.id THEN
      RAISE EXCEPTION 'A quote revision must name the current quote version it supersedes';
    END IF;
    party_kind := e#>>'{quoting_party,kind}';
    party_id := (e#>>'{quoting_party,id}')::uuid;
    IF jsonb_typeof(e->'quoting_party') IS DISTINCT FROM 'object' OR party_kind IS NULL
      OR party_kind NOT IN ('actor','user','organization','unknown') OR (party_kind='unknown') <> (party_id IS NULL) THEN
      RAISE EXCEPTION 'Quoting party must be an explicit actor, user or organization id, or unknown';
    END IF;
    snapshot := public.work_order_quote_scope_snapshot(w.id);
    IF e->'scope_snapshot' IS DISTINCT FROM snapshot THEN
      RAISE EXCEPTION 'Quote scope snapshot must equal the current work order scope';
    END IF;
    IF jsonb_typeof(e->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'lines') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Quote lines must be an array of 1 to 200 lines';
    END IF;
    FOR ln IN SELECT value FROM jsonb_array_elements(e->'lines') LOOP
      IF jsonb_typeof(ln) IS DISTINCT FROM 'object'
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(ln) k
          WHERE k NOT IN ('ref_kind','ref_id','description','pricing_basis','amount','currency','unit','quantity'))
        OR COALESCE(ln->>'ref_kind','') NOT IN ('operation','requirement','part','labor','fee')
        OR (ln->>'ref_kind'='fee') <> (ln->>'ref_id' IS NULL)
        OR (ln->>'ref_kind'<>'fee' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->(CASE ln->>'ref_kind'
            WHEN 'operation' THEN 'operations' WHEN 'requirement' THEN 'requirements' WHEN 'part' THEN 'parts' ELSE 'labor' END)) s
          WHERE s->>'id'=ln->>'ref_id'))
        OR jsonb_typeof(ln->'description') IS DISTINCT FROM 'string' OR length(btrim(ln->>'description')) NOT BETWEEN 1 AND 500
        OR COALESCE(ln->>'pricing_basis','') NOT IN ('flat','hourly','day_rate','per_operation')
        OR ln->>'unit' IS DISTINCT FROM (CASE ln->>'pricing_basis' WHEN 'hourly' THEN 'hour' WHEN 'day_rate' THEN 'day'
          WHEN 'per_operation' THEN 'operation' END)
        OR (ln->>'amount' IS NOT NULL AND (jsonb_typeof(ln->'amount')<>'number' OR (ln->>'amount')::numeric < 0))
        OR (ln->>'amount' IS NULL) <> (ln->>'currency' IS NULL)
        OR (ln->>'currency' IS NOT NULL AND (jsonb_typeof(ln->'currency')<>'string' OR ln->>'currency' !~ '^[A-Z]{3}$'))
        OR (ln->>'quantity' IS NOT NULL AND (ln->>'pricing_basis'='flat' OR jsonb_typeof(ln->'quantity')<>'number'
          OR (ln->>'quantity')::numeric <= 0)) THEN
        RAISE EXCEPTION 'Invalid quote line: %',ln;
      END IF;
      IF ln->>'amount' IS NOT NULL THEN priced := priced+1; END IF;
    END LOOP;
    IF priced=0 THEN
      RAISE EXCEPTION 'A quote prices at least one line; an unpriced scope is an estimate';
    END IF;
    IF e->>'deposit_requested' IS NOT NULL AND (jsonb_typeof(e->'deposit_requested')<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(e->'deposit_requested'))<>2
      OR NOT e->'deposit_requested' ?& ARRAY['amount','currency']
      OR jsonb_typeof(e#>'{deposit_requested,amount}')<>'number'
      OR jsonb_typeof(e#>'{deposit_requested,currency}')<>'string') THEN
      RAISE EXCEPTION 'Deposit requested must be {amount, currency}';
    END IF;
    IF e->>'valid_until' IS NOT NULL AND (e->>'valid_until')::timestamptz <= o.observed_at THEN
      RAISE EXCEPTION 'Quote validity must end after the quote clock';
    END IF;
    -- A change order amends the accepted current quote by explicit changes; only issue_change_order records one.
    co := CASE WHEN jsonb_typeof(e->'change_order') = 'object' THEN e->'change_order' END;
    IF e ? 'change_order' AND e->'change_order' <> 'null'::jsonb AND co IS NULL THEN RAISE EXCEPTION 'Change order must be an object'; END IF;
    IF co IS NOT NULL THEN
      SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
      IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_change_order_sign_v1'
        OR o.submitted_by_user_id IS NULL OR party_kind <> 'user' OR party_id IS DISTINCT FROM o.submitted_by_user_id THEN
        RAISE EXCEPTION 'A change order is recorded only by issue_change_order' USING ERRCODE='42501';
      END IF;
      IF cur.id IS NULL OR (co->>'base_quote_id')::uuid IS DISTINCT FROM cur.id OR co->>'base_quote_hash' IS DISTINCT FROM cur.quote_hash THEN
        RAISE EXCEPTION 'A change order names the current quote version and its hash';
      END IF;
      IF public.work_order_quote_state(w.id)#>>'{acceptance,state}' IS DISTINCT FROM 'accepted'
        OR (public.work_order_quote_state(w.id)#>>'{acceptance,quote_id}')::uuid IS DISTINCT FROM cur.id THEN
        RAISE EXCEPTION 'A change order amends the accepted current quote';
      END IF;
      IF jsonb_typeof(co->'reason') IS DISTINCT FROM 'string' OR length(btrim(co->>'reason')) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Change order reason required (at most 1000 characters)';
      END IF;
      applied := public.work_order_change_order_apply(cur.lines, snapshot, co->'requested');
      IF e->'lines' IS DISTINCT FROM applied->'lines' THEN
        RAISE EXCEPTION 'Change order lines must be the accepted quote lines with the requested changes applied';
      END IF;
      co_stored := jsonb_build_object('base_quote_id', cur.id, 'base_quote_hash', cur.quote_hash, 'base_version', cur.version,
        'reason', btrim(co->>'reason'), 'changes', applied->'changes');
    END IF;
    hash := encode(sha256(convert_to((jsonb_build_object('quote_id',o.id,'work_order_id',w.id,'version',next_version,
      'supersedes_quote_id',cur.id,'quoting_party',jsonb_build_object('kind',party_kind,'id',party_id),
      'scope_snapshot',snapshot,'lines',e->'lines','deposit_requested',e->'deposit_requested',
      'valid_until',(e->>'valid_until')::timestamptz)
      || CASE WHEN co_stored IS NOT NULL THEN jsonb_build_object('change_order',co_stored) ELSE '{}'::jsonb END)::text,'UTF8')),'hex');
    INSERT INTO public.work_order_quotes(id,work_order_id,version,supersedes_quote_id,quoting_party_kind,quoting_actor_id,
      quoting_user_id,quoting_organization_id,scope_snapshot,lines,deposit_requested_amount,deposit_requested_currency,valid_until,quote_hash,change_order)
      VALUES(o.id,w.id,next_version,cur.id,party_kind,CASE WHEN party_kind='actor' THEN party_id END,
      CASE WHEN party_kind='user' THEN party_id END,CASE WHEN party_kind='organization' THEN party_id END,
      snapshot,e->'lines',(e#>>'{deposit_requested,amount}')::numeric,e#>>'{deposit_requested,currency}',
      (e->>'valid_until')::timestamptz,hash,co_stored);
  ELSIF event_type='quote_acceptance' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_quote_acceptances WHERE id=o.id) THEN
      RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',true);
    END IF;
    IF current_setting('nuke.work_order_quote_sign',true) IS DISTINCT FROM o.id::text THEN
      RAISE EXCEPTION 'Quote acceptance is recorded only by accept_work_order_quote' USING ERRCODE='42501';
    END IF;
    SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
    IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_quote_acceptance_sign_v1'
      OR o.submitted_by_user_id IS NULL OR e->>'signer_user_id' IS DISTINCT FROM o.submitted_by_user_id::text THEN
      RAISE EXCEPTION 'Authenticated customer Sign source required' USING ERRCODE='42501';
    END IF;
    SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
      WHERE x.id=(e->>'quote_id')::uuid AND x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      FOR SHARE OF x,s;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current quote in the same work order required'; END IF;
    IF e->>'quote_hash' IS DISTINCT FROM q.quote_hash THEN
      RAISE EXCEPTION 'Quote hash does not match this quote version' USING ERRCODE='23514';
    END IF;
    refusal := public.work_order_quote_acceptance_refusal(q.id,o.submitted_by_user_id,o.observed_at);
    IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Quote cannot be accepted: %',refusal USING ERRCODE='42501'; END IF;
    INSERT INTO public.work_order_quote_acceptances(id,work_order_id,quote_id,quote_hash,signer_user_id,signer_role,signed_at)
      VALUES(o.id,w.id,q.id,q.quote_hash,o.submitted_by_user_id,'customer',o.observed_at);
  ELSE
    RAISE EXCEPTION 'Unknown quote event type';
  END IF;
  RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',false);
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_quote_for_viewer(p_quote_id uuid, p_party boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  q public.work_order_quotes%ROWTYPE;
  s public.vehicle_observations%ROWTYPE;
  snap jsonb;
  ln jsonb;
  co jsonb;
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
  co := q.change_order;
  IF co IS NOT NULL AND NOT p_party THEN
    co := co || jsonb_build_object(
      'reason', CASE WHEN public.work_order_text_is_personal(q.work_order_id, co->>'reason') THEN NULL ELSE co->'reason' END,
      'reason_visibility', CASE WHEN public.work_order_text_is_personal(q.work_order_id, co->>'reason') THEN 'withheld_personal' END,
      'changes', COALESCE((SELECT jsonb_agg(c || jsonb_build_object(
          'from_line', CASE WHEN jsonb_typeof(c->'from_line') = 'object' THEN public.work_order_quote_redact(q.work_order_id, jsonb_build_array(c->'from_line'), ARRAY['description'])->0 END,
          'to_line', CASE WHEN jsonb_typeof(c->'to_line') = 'object' THEN public.work_order_quote_redact(q.work_order_id, jsonb_build_array(c->'to_line'), ARRAY['description'])->0 END)
        ORDER BY ord) FROM jsonb_array_elements(co->'changes') WITH ORDINALITY t(c, ord)), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('quote_id', q.id, 'version', q.version, 'supersedes_quote_id', q.supersedes_quote_id,
    'quote_hash', q.quote_hash, 'is_change_order', q.change_order IS NOT NULL, 'change_order', co,
    'quoting_party', CASE q.quoting_party_kind
        WHEN 'user' THEN public.platform_person_label(q.quoting_user_id)
        WHEN 'organization' THEN public.platform_organization_label(q.quoting_organization_id)
        WHEN 'actor' THEN public.platform_actor_label(q.quoting_actor_id)
        ELSE jsonb_build_object('kind', 'unknown', 'label', 'unnamed party') END
      || jsonb_build_object('attribution', CASE WHEN s.extraction_method IN ('work_order_quote_issue_sign_v1', 'work_order_change_order_sign_v1')
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
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_quote_state(p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  w public.work_orders%ROWTYPE;
  cur record;
  acc record;
  n_versions integer;
  scope_matches boolean;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id;
  SELECT count(*) INTO n_versions FROM public.work_order_quotes WHERE work_order_id=p_work_order_id;
  IF NOT FOUND OR n_versions=0 THEN
    RETURN jsonb_build_object('quote_versions',0,'current_quote',NULL,
      'acceptance',jsonb_build_object('state','not_accepted'));
  END IF;
  SELECT x.*,s.observed_at INTO cur FROM public.work_order_quotes x JOIN public.vehicle_observations s ON s.id=x.id
    WHERE x.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id IS NOT DISTINCT FROM w.vehicle_id
    ORDER BY x.version DESC LIMIT 1;
  scope_matches := cur.id IS NOT NULL AND cur.scope_snapshot IS NOT DISTINCT FROM public.work_order_quote_scope_snapshot(w.id);
  SELECT a.*,x.version AS quote_version,
      CASE WHEN s.is_superseded IS NOT FALSE OR s.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'acceptance_source_withdrawn'
        WHEN qs.is_superseded IS NOT FALSE OR qs.vehicle_id IS DISTINCT FROM w.vehicle_id THEN 'quote_source_withdrawn'
        WHEN a.quote_id IS DISTINCT FROM cur.id THEN 'quote_superseded'
        WHEN a.signer_user_id IS DISTINCT FROM w.customer_id THEN 'signer_no_longer_customer'
        WHEN NOT scope_matches THEN 'scope_changed_since_quote' END AS withheld_reason
    INTO acc
    FROM public.work_order_quote_acceptances a JOIN public.vehicle_observations s ON s.id=a.id
    JOIN public.work_order_quotes x ON x.id=a.quote_id JOIN public.vehicle_observations qs ON qs.id=x.id
    WHERE a.work_order_id=w.id
    ORDER BY COALESCE(s.is_superseded IS FALSE AND a.quote_id=cur.id AND a.signer_user_id IS NOT DISTINCT FROM w.customer_id,false) DESC,
      a.signed_at DESC, a.id
    LIMIT 1;
  RETURN jsonb_build_object('quote_versions',n_versions,
    'current_quote',CASE WHEN cur.id IS NOT NULL THEN jsonb_build_object('quote_id',cur.id,'version',cur.version,
      'quote_hash',cur.quote_hash,'observed_at',cur.observed_at,'valid_until',cur.valid_until,
      'scope_status',CASE WHEN scope_matches THEN 'matches_current' ELSE 'changed_since_quote' END,
      'is_change_order',cur.change_order IS NOT NULL) END,
    'change_order',CASE WHEN cur.change_order IS NOT NULL THEN jsonb_build_object(
      'state',CASE WHEN acc.id IS NOT NULL AND acc.withheld_reason IS NULL AND acc.quote_id=cur.id THEN 'accepted' ELSE 'pending' END,
      'quote_id',cur.id,'version',cur.version,'base_quote_id',cur.change_order->'base_quote_id',
      'base_version',cur.change_order->'base_version','changes',jsonb_array_length(cur.change_order->'changes')) END,
    'acceptance',jsonb_build_object(
      'state',CASE WHEN acc.id IS NULL THEN 'not_accepted' WHEN acc.withheld_reason IS NULL THEN 'accepted' ELSE 'withheld' END,
      'acceptance_id',acc.id,'quote_id',acc.quote_id,'quote_version',acc.quote_version,'quote_hash',acc.quote_hash,
      'signed_at',acc.signed_at,'signer_user_id',acc.signer_user_id,'signer_role',acc.signer_role,
      'withheld_reason',acc.withheld_reason));
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_quotes_read(p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
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
    'current_quote', quote, 'change_order', qs->'change_order',
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
          'p_quote_hash', qs#>'{current_quote,quote_hash}'))) ELSE '[]'::jsonb END,
        'issuer_actions', CASE WHEN viewer IS NOT NULL AND cur_id IS NOT NULL AND acc_state = 'accepted' AND (qs#>>'{acceptance,quote_id}')::uuid = cur_id
            AND public.work_order_quote_issuer_role(viewer, w.id) IS NOT NULL
          THEN jsonb_build_array(jsonb_build_object('action', 'issue_change_order', 'rpc', 'issue_change_order',
            'args', jsonb_build_object('p_work_order_id', w.id, 'p_base_quote_id', cur_id))) ELSE '[]'::jsonb END),
    'coverage', jsonb_build_object('quote_versions', n_versions, 'versions_with_current_source', n_current,
      'acceptances_recorded', n_acceptances, 'source_scope', 'explicitly_projected_work_record_observations',
      'prices', 'open', 'party_money', 'not_returned_by_this_reader', 'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only',
    'deposit_collected', 'not_established', 'payment_authorized', false, 'disbursement', 'not_performed');
END $function$;

-- Backend my_signature_queue hooks (20261019214500): change orders are live; a quote version is one when it carries change_order.
CREATE OR REPLACE FUNCTION public.work_order_change_orders_live() RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.work_order_quote_is_change_order(p_quote_id uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$ SELECT EXISTS (SELECT 1 FROM public.work_order_quotes q WHERE q.id = p_quote_id AND q.change_order IS NOT NULL) $$;

-- Backend/shared read_work_order_job_path: change-order terms, its gap, and binding cosigner accept clocks (anchored).
DO $$
DECLARE
  def text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  a1 text := 'n_asg_accept_clock := n_asg_accept_clock-(n_offer_accepts-n_providers);';
  a2 text := '''customer_acceptance'',CASE acceptance_state WHEN';
  a3 text := 'CASE WHEN n_asg=0 THEN ''no_assignment'' END,';
BEGIN
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 OR (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1
    OR (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION 'read_work_order_job_path anchors not found exactly once';
  END IF;
  def := replace(def, a1, a1 || E'\n  -- A cosigner term counts as an accept clock only while it is binding.\n'
    || '  n_asg_accept_clock := n_asg_accept_clock-((SELECT count(*) FROM public.work_order_assignments WHERE work_order_id=w.id AND cosign_observation_id IS NOT NULL)'
    || '-(SELECT count(*) FROM public.work_order_accepted_cosigners(w.id)));');
  def := replace(def, a2, '''change_order'',qs->''change_order'',' || a2);
  def := replace(def, a3, 'CASE WHEN qs#>>''{change_order,state}''=''pending'' THEN ''change_order_pending'' END,' || a3);
  EXECUTE def;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
