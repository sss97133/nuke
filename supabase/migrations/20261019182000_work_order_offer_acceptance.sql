-- The client accepts a provider (QUOTE lane RSI pass 5: close the matching loop). After offer_on_requirement
-- (20261019180000), accept_offer(p_offer_id, p_offer_hash) is the customer's Sign over one exact offer; it projects into
-- work_order_assignments, the dormant offer -> accept -> payout owner (R3 section 7 step 4).
--
--   * work_order_assignments gains performer_actor_id (actors), fulfillment_id (the accepted offer), acceptance_observation_id,
--     accepted_by_user_id, offer_hash and payout_currency; technician_id becomes nullable (old column kept); a row names a
--     technician or a performer actor. role adds 'inspector' and 'cosigner'; payout_type adds 'day_rate' and 'per_operation'.
--     A status of accepted or later requires accepted_at (NOT VALID: the 9 legacy rows, none clocked, are reported, not
--     repaired). Rows written by accept_offer are inserted only inside it and keep their acceptance fields immutable;
--     their status may still progress.
--   * accept_offer: only the work order's customer (as accept_work_order_quote), on a current performer offer
--     (skill or inspection) whose window is open, never the offering account itself, over the exact offer_hash. It writes an
--     owner-input work_record (signer, sign clock) and, through project_work_order_resource_observation event
--     offer_acceptance, one accepted assignment: role inspector on an inspection requirement, otherwise technician; offered_at
--     from the offer, accepted_at = sign clock; payout fields copy a single priced offer line (a term, not a payment).
--   * An acceptance counts while the acceptance, the offer and the requirement sources are current and the signer is still the
--     customer (work_order_accepted_providers). A revised or withdrawn offer withholds it.
--   * The accepted offering account may then issue quotes (issue_work_order_quote role accepted_provider) and, on an
--     inspection job, record findings (inspection_findings_role accepted_inspector) without an identity bridge: the customer
--     chose that authenticated account. Both functions are the live definitions plus that one branch.
-- No payment, deposit, payout or messaging.
-- Contract: supabase/sql/test_work_order_offer_acceptance.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_order_assignments
  ALTER COLUMN technician_id DROP NOT NULL,
  ADD COLUMN performer_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
  ADD COLUMN fulfillment_id uuid REFERENCES public.work_order_resource_fulfillments(id) ON DELETE RESTRICT,
  ADD COLUMN acceptance_observation_id uuid UNIQUE REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN offer_hash text CHECK (offer_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN payout_currency text CHECK (payout_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT work_order_assignments_performer CHECK (technician_id IS NOT NULL OR performer_actor_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT work_order_assignments_acceptance_complete
    CHECK (num_nonnulls(fulfillment_id, acceptance_observation_id, accepted_by_user_id, offer_hash) IN (0,4)),
  ADD CONSTRAINT work_order_assignments_accepted_clock CHECK (status NOT IN ('accepted','in_progress','proof_submitted','verified',
    'completed','paid_out') OR accepted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.work_order_assignments DROP CONSTRAINT IF EXISTS work_order_assignments_role_check;
ALTER TABLE public.work_order_assignments ADD CONSTRAINT work_order_assignments_role_check
  CHECK (role = ANY (ARRAY['lead','technician','helper','inspector','cosigner']));
ALTER TABLE public.work_order_assignments DROP CONSTRAINT IF EXISTS work_order_assignments_payout_type_check;
ALTER TABLE public.work_order_assignments ADD CONSTRAINT work_order_assignments_payout_type_check
  CHECK (payout_type = ANY (ARRAY['flat','hourly','percentage','day_rate','per_operation']));
CREATE INDEX work_order_assignments_fulfillment ON public.work_order_assignments(fulfillment_id) WHERE fulfillment_id IS NOT NULL;
CREATE INDEX work_order_assignments_performer ON public.work_order_assignments(performer_actor_id) WHERE performer_actor_id IS NOT NULL;
COMMENT ON COLUMN public.work_order_assignments.performer_actor_id IS 'Performer as an actors row (the resource graph identity); technician_id is the retained legacy key.';
COMMENT ON COLUMN public.work_order_assignments.fulfillment_id IS 'Accepted provider offer (work_order_resource_fulfillments offer row). Set only by accept_offer.';
COMMENT ON COLUMN public.work_order_assignments.acceptance_observation_id IS 'Customer acceptance Sign record (accept_offer). Set only by accept_offer.';
COMMENT ON COLUMN public.work_order_assignments.accepted_by_user_id IS 'auth.uid() of the customer who accepted the offer.';
COMMENT ON COLUMN public.work_order_assignments.offer_hash IS 'offer_hash of the exact accepted offer version.';
COMMENT ON COLUMN public.work_order_assignments.payout_currency IS 'Currency of payout_rate when copied from an accepted offer line. A term, not a payment.';

CREATE FUNCTION public.work_order_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.acceptance_observation_id IS NOT NULL THEN RAISE EXCEPTION 'Accepted offer assignments are retained'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.acceptance_observation_id IS NOT NULL
      AND current_setting('nuke.work_order_offer_accept_row', true) IS DISTINCT FROM NEW.acceptance_observation_id::text THEN
      RAISE EXCEPTION 'Offer acceptances are recorded only by accept_offer';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.acceptance_observation_id IS NOT NULL OR NEW.acceptance_observation_id IS NOT NULL)
    AND (NEW.work_order_id, NEW.technician_id, NEW.performer_actor_id, NEW.fulfillment_id, NEW.acceptance_observation_id,
      NEW.accepted_by_user_id, NEW.offer_hash, NEW.role, NEW.offered_at, NEW.accepted_at, NEW.payout_type, NEW.payout_rate,
      NEW.payout_currency) IS DISTINCT FROM (OLD.work_order_id, OLD.technician_id, OLD.performer_actor_id, OLD.fulfillment_id,
      OLD.acceptance_observation_id, OLD.accepted_by_user_id, OLD.offer_hash, OLD.role, OLD.offered_at, OLD.accepted_at,
      OLD.payout_type, OLD.payout_rate, OLD.payout_currency) THEN
    RAISE EXCEPTION 'Accepted offer terms are immutable; record a new offer and acceptance';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_assignment_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_order_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.work_order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.work_order_assignment_guard();

-- Why a signer cannot accept this offer now (null = acceptable).
CREATE FUNCTION public.work_order_offer_acceptance_refusal(p_offer_id uuid, p_signer uuid, p_at timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE f public.work_order_resource_fulfillments%ROWTYPE; s public.vehicle_observations%ROWTYPE; w public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = p_offer_id AND offer_kind IS NOT NULL;
  SELECT * INTO s FROM public.vehicle_observations WHERE id = p_offer_id;
  SELECT * INTO w FROM public.work_orders WHERE id = f.work_order_id;
  IF f.id IS NULL OR s.is_superseded IS DISTINCT FROM false OR s.vehicle_id IS DISTINCT FROM w.vehicle_id
    OR NOT EXISTS (SELECT 1 FROM public.vehicle_observations rs WHERE rs.id = f.requirement_id AND rs.is_superseded IS FALSE
      AND rs.vehicle_id = w.vehicle_id) THEN
    RETURN 'offer_unavailable';
  END IF;
  IF p_signer IS NULL OR w.customer_id IS DISTINCT FROM p_signer THEN RETURN 'not_customer'; END IF;
  IF s.submitted_by_user_id IS NOT DISTINCT FROM p_signer THEN RETURN 'offering_account_cannot_accept'; END IF;
  IF f.performer_actor_id IS NULL THEN RETURN 'facility_offer_not_an_assignment'; END IF;
  IF w.status IN ('completed','paid','cancelled','rejected') THEN RETURN 'work_order_concluded'; END IF;
  IF f.available_until IS NOT NULL AND f.available_until <= p_at THEN RETURN 'offer_window_closed'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.work_order_offer_acceptance_refusal(uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Current accepted providers of one work order: acceptance, offer and requirement sources current, signer still the customer.
CREATE FUNCTION public.work_order_accepted_providers(p_work_order_id uuid)
RETURNS TABLE(assignment_id uuid, offer_id uuid, account_id uuid, performer_actor_id uuid, role text, accepted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY SELECT a.id, a.fulfillment_id, os.submitted_by_user_id, a.performer_actor_id, a.role, a.accepted_at
  FROM public.work_order_assignments a
  JOIN public.work_orders w ON w.id = a.work_order_id
  JOIN public.vehicle_observations acc ON acc.id = a.acceptance_observation_id AND acc.is_superseded IS FALSE
  JOIN public.vehicle_observations os ON os.id = a.fulfillment_id AND os.is_superseded IS FALSE AND os.vehicle_id = w.vehicle_id
  JOIN public.work_order_resource_fulfillments f ON f.id = a.fulfillment_id
  JOIN public.vehicle_observations rs ON rs.id = f.requirement_id AND rs.is_superseded IS FALSE AND rs.vehicle_id = w.vehicle_id
  WHERE a.work_order_id = p_work_order_id AND a.accepted_by_user_id IS NOT DISTINCT FROM w.customer_id;
END $$;
REVOKE ALL ON FUNCTION public.work_order_accepted_providers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_accepted_providers(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_accepted_providers(uuid) IS 'Service-only: current accepted providers of a work order (accept_offer assignments whose acceptance, offer and requirement sources are current and whose signer is still the customer).';

CREATE OR REPLACE FUNCTION public.project_work_order_offer_event(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  event_type text;
  rkind text;
  owner_source uuid;
  hash text;
  f public.work_order_resource_fulfillments%ROWTYPE;
  refusal text;
  one_line jsonb;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  e := o.structured_data->'work_order_resource';
  event_type := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid FOR SHARE;
  IF event_type = 'offer_acceptance' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_assignments WHERE acceptance_observation_id = o.id) THEN
      RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', true);
    END IF;
    IF current_setting('nuke.work_order_offer_accept', true) IS DISTINCT FROM o.id::text THEN
      RAISE EXCEPTION 'An offer acceptance is recorded only by accept_offer' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
    IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_offer_acceptance_sign_v1'
      OR o.submitted_by_user_id IS NULL OR e->>'signer_user_id' IS DISTINCT FROM o.submitted_by_user_id::text THEN
      RAISE EXCEPTION 'Authenticated customer Sign source required' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = (e->>'offer_id')::uuid AND work_order_id = w.id FOR SHARE;
    IF f.id IS NULL OR f.offer_hash IS DISTINCT FROM e->>'offer_hash' THEN
      RAISE EXCEPTION 'Offer hash does not match this offer' USING ERRCODE = '23514';
    END IF;
    refusal := public.work_order_offer_acceptance_refusal(f.id, o.submitted_by_user_id, o.observed_at);
    IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Offer cannot be accepted: %', refusal USING ERRCODE = '42501'; END IF;
    SELECT r.requirement_kind INTO rkind FROM public.work_order_resource_requirements r WHERE r.id = f.requirement_id;
    SELECT CASE WHEN jsonb_array_length(f.offer_terms->'lines') = 1 AND f.offer_terms#>>'{lines,0,amount}' IS NOT NULL
      THEN f.offer_terms#>'{lines,0}' END INTO one_line;
    PERFORM set_config('nuke.work_order_offer_accept_row', o.id::text, true);
    INSERT INTO public.work_order_assignments(work_order_id, technician_id, performer_actor_id, fulfillment_id, acceptance_observation_id,
      accepted_by_user_id, offer_hash, role, status, offered_at, accepted_at, payout_type, payout_rate, payout_currency)
    VALUES (w.id, NULL, f.performer_actor_id, f.id, o.id, o.submitted_by_user_id, f.offer_hash,
      CASE WHEN rkind = 'inspection' THEN 'inspector' ELSE 'technician' END, 'accepted',
      (SELECT s.observed_at FROM public.vehicle_observations s WHERE s.id = f.id), o.observed_at,
      one_line->>'pricing_basis', (one_line->>'amount')::numeric, one_line->>'currency');
    PERFORM set_config('nuke.work_order_offer_accept_row', '', true);
    RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', false);
  END IF;
  IF event_type <> 'offer' THEN RAISE EXCEPTION 'Unknown offer event type'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments WHERE id = o.id) THEN
    RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', true);
  END IF;
  IF current_setting('nuke.work_order_offer_sign', true) IS DISTINCT FROM o.id::text THEN
    RAISE EXCEPTION 'An offer is recorded only by offer_on_requirement' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF o.source_id IS DISTINCT FROM owner_source OR o.extraction_method IS DISTINCT FROM 'work_order_offer_sign_v1'
    OR o.submitted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated provider Sign source required' USING ERRCODE = '42501';
  END IF;
  SELECT r.requirement_kind INTO rkind FROM public.work_order_resource_requirements r
    JOIN public.vehicle_observations s ON s.id = r.id
    JOIN public.work_order_line_items li ON li.id = r.line_item_id AND li.work_order_id = w.id
    WHERE r.id = (e->>'requirement_id')::uuid AND r.work_order_id = w.id AND s.is_superseded IS FALSE AND s.vehicle_id = w.vehicle_id
    FOR SHARE OF r, s, li;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current requirement in the same work order required'; END IF;
  IF NOT ((e->>'offer_kind' = 'individual' AND rkind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL
        AND e->>'supplier_user_id' = o.submitted_by_user_id::text AND e->>'supplier_organization_id' IS NULL AND e->>'facility_organization_id' IS NULL)
      OR (e->>'offer_kind' = 'organization' AND e->>'supplier_organization_id' IS NOT NULL AND e->>'supplier_user_id' IS NULL
        AND ((rkind = 'facility' AND e->>'facility_organization_id' = e->>'supplier_organization_id' AND e->>'performer_actor_id' IS NULL)
          OR (rkind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL AND e->>'facility_organization_id' IS NULL)))) THEN
    RAISE EXCEPTION 'This offer does not fit a % requirement', rkind USING ERRCODE = '23514';
  END IF;
  hash := encode(sha256(convert_to(jsonb_build_object('offer_id', o.id, 'work_order_id', w.id, 'requirement_id', e->'requirement_id',
    'offer_kind', e->'offer_kind', 'performer_actor_id', e->'performer_actor_id', 'supplier_user_id', e->'supplier_user_id',
    'supplier_organization_id', e->'supplier_organization_id', 'facility_organization_id', e->'facility_organization_id',
    'offer_rung', e->'offer_rung', 'terms', e->'terms', 'available_from', (e->>'available_from')::timestamptz,
    'available_until', (e->>'available_until')::timestamptz)::text, 'UTF8')), 'hex');
  INSERT INTO public.work_order_resource_fulfillments(id, work_order_id, requirement_id, supplier_user_id, supplier_organization_id,
    facility_organization_id, performer_actor_id, available_from, available_until, offer_kind, offer_rung, offer_terms, offer_hash)
  VALUES (o.id, w.id, (e->>'requirement_id')::uuid, (e->>'supplier_user_id')::uuid, (e->>'supplier_organization_id')::uuid,
    (e->>'facility_organization_id')::uuid, (e->>'performer_actor_id')::uuid, (e->>'available_from')::timestamptz,
    (e->>'available_until')::timestamptz, e->>'offer_kind', e->>'offer_rung', e->'terms', hash);
  RETURN jsonb_build_object('id', o.id, 'event_type', event_type, 'duplicate', false);
END $$;

REVOKE ALL ON FUNCTION public.project_work_order_offer_event(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Live definitions (md5 prefixes 042613b3 and a53546b2) plus the accepted-provider branch.
CREATE OR REPLACE FUNCTION public.issue_work_order_quote(p_work_order_id uuid, p_lines jsonb, p_deposit jsonb DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL, p_supersedes_quote_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  issued timestamptz := now();
  w public.work_orders%ROWTYPE;
  issuer_role text;
  owner_source uuid;
  request_key text;
  next_version integer;
  obs_id uuid;
  q public.work_order_quotes%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id;
  IF FOUND AND w.customer_id IS NOT DISTINCT FROM signer THEN
    RAISE EXCEPTION 'The customer cannot quote their own job' USING ERRCODE='42501';
  END IF;
  IF FOUND THEN
    issuer_role := CASE
      WHEN w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
        WHERE bo.business_id=w.organization_id AND bo.owner_id=signer AND bo.status='active') THEN 'organization_owner'
      WHEN EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = signer) THEN 'accepted_provider'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(public.viewer_identity_bridge(signer)->'evidenced_actor_ids') a
        WHERE a::uuid=w.lead_actor_id OR EXISTS (SELECT 1 FROM public.work_order_line_items li
          WHERE li.work_order_id=w.id AND li.actor_id=a::uuid)) THEN 'performer' END;
  END IF;
  IF issuer_role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for quoting' USING ERRCODE='42501'; END IF;
  IF w.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'A quote needs a vehicle-bound work order' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text,0));
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-quote-issue',signer,w.id,p_supersedes_quote_id,p_lines,p_deposit,
    p_valid_until)::text);
  SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations o ON o.id=x.id
    WHERE o.source_id=owner_source AND o.source_identifier='work_order_quote_issue:'||w.id::text
      AND o.content_hash=request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('quote_id',q.id,'version',q.version,'quote_hash',q.quote_hash,'work_order_id',w.id,
      'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind','user','id',signer),
      'issued_by_role',issuer_role,'duplicate',true,'payment_authorized',false,'customer_notified',false);
  END IF;
  SELECT COALESCE(max(version),0)+1 INTO next_version FROM public.work_order_quotes WHERE work_order_id=w.id;
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,source_identifier,observed_at,observed_at_basis,
    source_event_at,source_event_time_precision,kind,content_text,content_hash,structured_data,submitted_by_user_id,
    observer_raw,extraction_method,confidence,confidence_score)
  VALUES(w.vehicle_id,owner_source,'work_order_quote_issue:'||w.id::text,issued,'event_time',issued,'exact','work_record',
    format('Provider issued quote version %s for work order %s.',next_version,w.id),request_key,
    jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','quote','work_order_id',w.id,
      'quote_version',next_version,'supersedes_quote_id',p_supersedes_quote_id,
      'quoting_party',jsonb_build_object('kind','user','id',signer),
      'scope_snapshot',public.work_order_quote_scope_snapshot(w.id),'lines',p_lines,'deposit_requested',p_deposit,
      'valid_until',p_valid_until,'issued_by_role',issuer_role,
      'issuer_organization_id',CASE WHEN issuer_role='organization_owner' THEN w.organization_id END)),
    signer,jsonb_build_object('user_id',signer,'intake_actor','account','issued_by_role',issuer_role),
    'work_order_quote_issue_sign_v1','high',0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_resource_observation(obs_id);
  SELECT * INTO q FROM public.work_order_quotes WHERE id=obs_id;
  RETURN jsonb_build_object('quote_id',q.id,'version',q.version,'quote_hash',q.quote_hash,'work_order_id',w.id,
    'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind','user','id',signer),
    'issued_by_role',issuer_role,'issued_at',issued,'duplicate',false,'payment_authorized',false,'customer_notified',false);
END $$;

REVOKE ALL ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.inspection_findings_role(p_user uuid, p_work_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE w public.work_orders%ROWTYPE;
BEGIN
  IF p_user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id AND scope_category = 'inspection';
  IF NOT FOUND OR w.customer_id IS NOT DISTINCT FROM p_user THEN RETURN NULL; END IF;
  IF w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id = w.organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN
    RETURN 'organization_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = p_user) THEN
    RETURN 'accepted_inspector';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(public.viewer_identity_bridge(p_user)->'evidenced_actor_ids') a
      WHERE a::uuid = w.lead_actor_id OR EXISTS (SELECT 1 FROM public.work_order_line_items li
        WHERE li.work_order_id = w.id AND li.actor_id = a::uuid)) THEN
    RETURN 'inspector';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.inspection_findings_role(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.accept_offer(p_offer_id uuid, p_offer_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  f public.work_order_resource_fulfillments%ROWTYPE;
  w public.work_orders%ROWTYPE;
  prior public.work_order_assignments%ROWTYPE;
  refusal text;
  owner_source uuid;
  obs_id uuid;
  a public.work_order_assignments%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = p_offer_id AND offer_kind IS NOT NULL;
  IF FOUND THEN SELECT * INTO w FROM public.work_orders WHERE id = f.work_order_id; END IF;
  IF f.id IS NULL OR w.customer_id IS DISTINCT FROM signer THEN RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '42501'; END IF;
  IF p_offer_hash IS DISTINCT FROM f.offer_hash THEN
    RAISE EXCEPTION 'Offer hash does not match this offer' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_offer_accept:'||f.id::text, 0));
  refusal := public.work_order_offer_acceptance_refusal(f.id, signer, signed);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Offer cannot be accepted: %', refusal USING ERRCODE = '42501'; END IF;
  SELECT a0.* INTO prior FROM public.work_order_assignments a0 JOIN public.vehicle_observations s ON s.id = a0.acceptance_observation_id
    WHERE a0.fulfillment_id = f.id AND a0.accepted_by_user_id = signer AND s.is_superseded IS FALSE ORDER BY a0.accepted_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('assignment_id', prior.id, 'offer_id', f.id, 'offer_hash', f.offer_hash, 'work_order_id', w.id,
      'requirement_id', f.requirement_id, 'role', prior.role, 'performer_actor_id', prior.performer_actor_id, 'accepted_at', prior.accepted_at,
      'duplicate', true, 'payment_authorized', false, 'customer_notified', false);
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_offer_acceptance:'||f.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('Customer accepted offer %s on requirement %s (offer hash %s).', f.id, f.requirement_id, f.offer_hash),
    md5('work-order-offer-acceptance:'||signer::text||':'||f.id::text||':'||signed::text),
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'offer_acceptance', 'work_order_id', w.id,
      'offer_id', f.id, 'offer_hash', f.offer_hash, 'requirement_id', f.requirement_id, 'signer_user_id', signer, 'signer_role', 'customer')),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account'), 'work_order_offer_acceptance_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM set_config('nuke.work_order_offer_accept', obs_id::text, true);
  PERFORM public.project_work_order_resource_observation(obs_id);
  PERFORM set_config('nuke.work_order_offer_accept', '', true);
  SELECT * INTO a FROM public.work_order_assignments WHERE acceptance_observation_id = obs_id;
  RETURN jsonb_build_object('assignment_id', a.id, 'acceptance_observation_id', obs_id, 'offer_id', f.id, 'offer_hash', f.offer_hash,
    'work_order_id', w.id, 'requirement_id', f.requirement_id, 'role', a.role, 'performer_actor_id', a.performer_actor_id,
    'offered_at', a.offered_at, 'accepted_at', a.accepted_at, 'payout_term', CASE WHEN a.payout_type IS NOT NULL AND a.payout_rate IS NOT NULL
      THEN jsonb_build_object('pricing_basis', a.payout_type, 'amount', a.payout_rate, 'currency', a.payout_currency) END,
    'duplicate', false, 'work_order_status_changed', false, 'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.accept_offer(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_offer(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.accept_offer(uuid,text) IS 'Sign: the work order customer accepts one exact current performer offer (offer_hash). Writes an owner-input work_record projected as one accepted work_order_assignments row (role inspector for inspection requirements, else technician). A revised or withdrawn offer withholds it. No payment, payout or messaging.';

UPDATE public.pipeline_registry SET write_via = 'accept_offer(uuid,text)', owned_by = 'accept_offer',
  description = 'Accepted provider assignments written by accept_offer (projection of an owner-input acceptance record); legacy technician rows retained.'
  WHERE table_name = 'work_order_assignments' AND column_name = 'id';
INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'work_order_assignments', 'id', 'accept_offer',
  'Accepted provider assignments written by accept_offer (projection of an owner-input acceptance record); legacy technician rows retained.',
  true, 'accept_offer(uuid,text)'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'work_order_assignments' AND column_name = 'id');
NOTIFY pgrst, 'reload schema';
COMMIT;
