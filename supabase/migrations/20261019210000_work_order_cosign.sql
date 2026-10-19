-- Co-sign gate (QUOTE lane RSI pass 6; owner: a provider with a validated tool collection or a facility can co-sign on a
-- mechanic who is just showing up, and gets a cut). A co-sign is an AUTHENTICATED statement (supervision / suitability /
-- permission / availability) with an explicit scope on a subject's offer, plus an optional SEPARATE compensation term for the
-- cut (assignment role 'cosigner'). A co-sign is never skill evidence.
--
--   * cosign_provider(p_work_order_id, p_offer_id, p_kinds, p_scope, p_cut): an owner or active member of an organization
--     (business_ownership / organization_contributors) co-signs for that organization, or an account with claimed-owned tools
--     (user_tools / tool_inventory) co-signs for itself (p_cut.as = 'self' or p_cut.organization_id choose when both apply).
--     It writes one signed owner-input header record (work_order_cosign) and one attestation per kind through the existing
--     projector attestation event on the subject's offer; attestor = the signer or the organization, so the statement is
--     authenticated. The cut ({basis share_of_labor_line, percentage} | {basis flat, amount, currency} |
--     {basis day_rate, amount, currency, unit 'day'}) is a term, not a payment. A new co-sign by the same co-signer on the same
--     offer supersedes the previous one. Never the offering account or the customer.
--   * work_order_offer_terms_hash(p_offer_id): offer_hash when the offer has no current co-signs, otherwise SHA-256 over the
--     offer hash and its current co-signs. accept_offer now pins this hash (unchanged for offers without co-signs), records it
--     as accepted_terms_hash and turns each current co-sign with a cut into a cosigner assignment. A later co-sign change makes
--     the hash differ and withholds the acceptance (work_order_accepted_providers) and its cosigner terms
--     (work_order_accepted_cosigners).
--   * Readers: work_order_offers_read shows co_signs per offer (co-signer by handle / organization name, kinds, scope, cut;
--     open terms), terms_hash in the accept_offer args, accepted_cosigners and a cosign_provider action; the backend
--     work_order_resources_read reports attestor_basis 'authenticated_sign' for signed attestations (anchored one-value patch
--     of the live definition, refused unless the anchor occurs exactly once).
-- No payment, payout or messaging. Contract: supabase/sql/test_work_order_cosign.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_order_assignments
  ADD COLUMN accepted_terms_hash text CHECK (accepted_terms_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN cosign_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN cosign_acceptance_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN cosigner_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN cosigner_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_order_assignments_cosign_complete CHECK (num_nonnulls(cosign_observation_id, cosign_acceptance_observation_id) IN (0,2)
    AND (cosign_observation_id IS NULL OR (role = 'cosigner' AND acceptance_observation_id IS NULL
      AND num_nonnulls(cosigner_user_id, cosigner_organization_id) = 1)));
ALTER TABLE public.work_order_assignments DROP CONSTRAINT IF EXISTS work_order_assignments_performer;
ALTER TABLE public.work_order_assignments ADD CONSTRAINT work_order_assignments_performer
  CHECK (technician_id IS NOT NULL OR performer_actor_id IS NOT NULL OR cosigner_user_id IS NOT NULL OR cosigner_organization_id IS NOT NULL) NOT VALID;
CREATE UNIQUE INDEX work_order_assignments_cosign_term ON public.work_order_assignments(cosign_acceptance_observation_id, cosign_observation_id)
  WHERE cosign_observation_id IS NOT NULL;
COMMENT ON COLUMN public.work_order_assignments.accepted_terms_hash IS 'Offer terms hash (offer plus current co-signs) the customer accepted; a later co-sign change withholds the acceptance.';
COMMENT ON COLUMN public.work_order_assignments.cosign_observation_id IS 'Co-sign record this cosigner compensation term came from (cosign_provider).';
COMMENT ON COLUMN public.work_order_assignments.cosign_acceptance_observation_id IS 'Offer acceptance that made this cosigner term binding (accept_offer).';
COMMENT ON COLUMN public.work_order_assignments.cosigner_user_id IS 'Co-signing account (for itself).';
COMMENT ON COLUMN public.work_order_assignments.cosigner_organization_id IS 'Co-signing organization (facility).';

CREATE FUNCTION public.work_order_org_member(p_user uuid, p_organization_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN p_user IS NOT NULL AND p_organization_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active')
    OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = p_user
      AND oc.status = 'active'));
END $$;
REVOKE ALL ON FUNCTION public.work_order_org_member(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_org_member(uuid,uuid) IS 'Internal: active business_ownership owner or active organization_contributors member.';

-- A signed attestation: its current source was submitted by the attestor, or by an owner/member of the attesting organization.
CREATE FUNCTION public.work_order_attestation_authenticated(p_attestation_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.work_order_resource_attestations a JOIN public.vehicle_observations s ON s.id = a.id
    WHERE a.id = p_attestation_id AND s.is_superseded IS FALSE AND s.submitted_by_user_id IS NOT NULL
      AND (s.submitted_by_user_id = a.attestor_user_id OR public.work_order_org_member(s.submitted_by_user_id, a.attestor_organization_id)));
END $$;
REVOKE ALL ON FUNCTION public.work_order_attestation_authenticated(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_attestation_authenticated(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_attestation_authenticated(uuid) IS 'Service-only: true when an attestation source is current and signed by the attestor or an owner/member of the attesting organization.';

CREATE FUNCTION public.work_order_cosign_cut_normalize(p_cut jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE cut jsonb; b text;
BEGIN
  IF p_cut IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cut) <> 'object' THEN RAISE EXCEPTION 'Cut must be an object' USING ERRCODE = '23514'; END IF;
  cut := p_cut - 'as' - 'organization_id';
  IF cut = '{}'::jsonb THEN RETURN NULL; END IF;
  b := cut->>'basis';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(cut) k WHERE k NOT IN ('basis','percentage','amount','currency','unit'))
    OR COALESCE(b,'') NOT IN ('share_of_labor_line','flat','day_rate')
    OR (b = 'share_of_labor_line' AND (jsonb_typeof(cut->'percentage') IS DISTINCT FROM 'number'
      OR (cut->>'percentage')::numeric <= 0 OR (cut->>'percentage')::numeric > 100 OR cut ?| ARRAY['amount','currency','unit']))
    OR (b IN ('flat','day_rate') AND (jsonb_typeof(cut->'amount') IS DISTINCT FROM 'number' OR (cut->>'amount')::numeric < 0
      OR jsonb_typeof(cut->'currency') IS DISTINCT FROM 'string' OR cut->>'currency' !~ '^[A-Z]{3}$' OR cut ? 'percentage'))
    OR (b = 'flat' AND cut ? 'unit') OR (b = 'day_rate' AND cut->>'unit' IS DISTINCT FROM 'day') THEN
    RAISE EXCEPTION 'Cut must be {basis share_of_labor_line, percentage} or {basis flat|day_rate, amount, currency[, unit day]}' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('basis', b, 'percentage', cut->'percentage', 'amount', cut->'amount',
    'currency', cut->'currency', 'unit', cut->'unit'));
END $$;
REVOKE ALL ON FUNCTION public.work_order_cosign_cut_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Current co-signs on one offer (header records with their current attestations).
CREATE FUNCTION public.work_order_offer_cosigns(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
BEGIN
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('cosign_id', h.id,
      'attestor_kind', CASE WHEN h.structured_data#>>'{work_order_cosign,attestor_organization_id}' IS NOT NULL THEN 'organization' ELSE 'user' END,
      'attestor_user_id', h.structured_data#>'{work_order_cosign,attestor_user_id}',
      'attestor_organization_id', h.structured_data#>'{work_order_cosign,attestor_organization_id}',
      'kinds', h.structured_data#>'{work_order_cosign,kinds}', 'scope', h.structured_data#>'{work_order_cosign,scope}',
      'cut', h.structured_data#>'{work_order_cosign,cut}', 'signed_at', h.observed_at,
      'attestation_ids', (SELECT COALESCE(jsonb_agg(a.id ORDER BY a.id), '[]'::jsonb) FROM public.vehicle_observations s
        JOIN public.work_order_resource_attestations a ON a.id = s.id
        WHERE s.source_id = h.source_id AND s.source_identifier = 'work_order_cosign_attestation:'||h.id::text AND s.is_superseded IS FALSE))
      ORDER BY h.id), '[]'::jsonb)
    FROM public.vehicle_observations h
    WHERE h.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'owner-input')
      AND h.source_identifier = 'work_order_cosign:'||p_offer_id::text AND h.is_superseded IS FALSE
      AND h.extraction_method = 'work_order_cosign_sign_v1');
END $$;
REVOKE ALL ON FUNCTION public.work_order_offer_cosigns(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_offer_cosigns(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_offer_cosigns(uuid) IS 'Service-only: current co-signs on one offer (co-signer, kinds, scope, cut, signed_at, attestation ids).';

CREATE FUNCTION public.work_order_offer_terms_hash(p_offer_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE h text; cs jsonb;
BEGIN
  SELECT offer_hash INTO h FROM public.work_order_resource_fulfillments WHERE id = p_offer_id;
  cs := public.work_order_offer_cosigns(p_offer_id);
  IF h IS NULL OR jsonb_array_length(cs) = 0 THEN RETURN h; END IF;
  RETURN encode(sha256(convert_to(jsonb_build_object('offer_hash', h, 'co_signs',
    (SELECT jsonb_agg(c - 'attestation_ids' ORDER BY c->>'cosign_id') FROM jsonb_array_elements(cs) c))::text, 'UTF8')), 'hex');
END $$;
REVOKE ALL ON FUNCTION public.work_order_offer_terms_hash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_offer_terms_hash(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_offer_terms_hash(uuid) IS 'Service-only: hash the customer must accept: offer_hash without co-signs, otherwise SHA-256 over the offer hash and its current co-signs.';

-- Who may co-sign an offer and as what (p_cut.as = 'self' or p_cut.organization_id choose the capacity).
CREATE FUNCTION public.work_order_cosign_eligibility(p_user uuid, p_offer_id uuid, p_cut jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f public.work_order_resource_fulfillments%ROWTYPE; s public.vehicle_observations%ROWTYPE; w public.work_orders%ROWTYPE;
  orgs uuid[]; org uuid; mode text := p_cut->>'as';
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reason', 'authentication_required'); END IF;
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = p_offer_id AND offer_kind IS NOT NULL AND performer_actor_id IS NOT NULL;
  SELECT * INTO s FROM public.vehicle_observations WHERE id = p_offer_id;
  SELECT * INTO w FROM public.work_orders WHERE id = f.work_order_id;
  IF f.id IS NULL OR s.is_superseded IS DISTINCT FROM false OR w.status IN ('completed','paid','cancelled','rejected')
    OR NOT (public.work_order_vehicle_open(w.vehicle_id)
      OR cardinality(COALESCE((SELECT x.slots FROM public.work_order_viewer_slots(p_user, w.id) x), '{}'::text[])) > 0) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'offer_unavailable');
  END IF;
  IF s.submitted_by_user_id = p_user THEN RETURN jsonb_build_object('eligible', false, 'reason', 'cannot_cosign_own_offer'); END IF;
  IF w.customer_id IS NOT DISTINCT FROM p_user THEN RETURN jsonb_build_object('eligible', false, 'reason', 'customer_cannot_cosign'); END IF;
  IF p_cut ? 'organization_id' THEN
    org := (p_cut->>'organization_id')::uuid;
    IF NOT public.work_order_org_member(p_user, org) THEN RETURN jsonb_build_object('eligible', false, 'reason', 'not_organization_member'); END IF;
    RETURN jsonb_build_object('eligible', true, 'attestor_kind', 'organization', 'attestor_organization_id', org, 'offer_id', f.id, 'work_order_id', w.id);
  END IF;
  IF mode IS DISTINCT FROM 'self' THEN
    orgs := ARRAY(SELECT DISTINCT y.x FROM (SELECT bo.business_id x FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active'
      UNION SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = p_user AND oc.status = 'active') y WHERE y.x IS NOT NULL);
    IF cardinality(orgs) = 1 THEN
      RETURN jsonb_build_object('eligible', true, 'attestor_kind', 'organization', 'attestor_organization_id', orgs[1], 'offer_id', f.id, 'work_order_id', w.id);
    ELSIF cardinality(orgs) > 1 THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'name_organization_id', 'organization_count', cardinality(orgs));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_tools t WHERE t.user_id = p_user) OR EXISTS (SELECT 1 FROM public.tool_inventory t WHERE t.owner_id = p_user) THEN
    RETURN jsonb_build_object('eligible', true, 'attestor_kind', 'user', 'attestor_user_id', p_user, 'offer_id', f.id, 'work_order_id', w.id);
  END IF;
  RETURN jsonb_build_object('eligible', false, 'reason', 'needs_facility_organization_or_owned_tools');
END $$;
REVOKE ALL ON FUNCTION public.work_order_cosign_eligibility(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cosign_provider(p_work_order_id uuid, p_offer_id uuid, p_kinds text[], p_scope text, p_cut jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  el jsonb;
  cut jsonb;
  kinds text[];
  w public.work_orders%ROWTYPE;
  owner_source uuid;
  attestor_key text;
  request_key text;
  prev uuid;
  header_id uuid;
  att_id uuid;
  k text;
  att_ids jsonb := '[]'::jsonb;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  el := public.work_order_cosign_eligibility(signer, p_offer_id, p_cut);
  IF NOT (el->>'eligible')::boolean OR (el->>'work_order_id')::uuid IS DISTINCT FROM p_work_order_id THEN
    RAISE EXCEPTION 'Co-sign unavailable: %', COALESCE(el->>'reason', 'offer_not_on_this_work_order') USING ERRCODE = '42501';
  END IF;
  kinds := ARRAY(SELECT DISTINCT x FROM unnest(p_kinds) x ORDER BY 1);
  IF COALESCE(cardinality(p_kinds), 0) = 0 OR cardinality(kinds) <> cardinality(p_kinds)
    OR EXISTS (SELECT 1 FROM unnest(p_kinds) x WHERE x IS NULL OR x NOT IN ('supervision','suitability','permission','availability')) THEN
    RAISE EXCEPTION 'Kinds must be distinct values of supervision, suitability, permission, availability' USING ERRCODE = '23514';
  END IF;
  IF p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Scope of the co-sign is required (at most 2000 characters)' USING ERRCODE = '23514';
  END IF;
  cut := public.work_order_cosign_cut_normalize(p_cut);
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  attestor_key := COALESCE(el->>'attestor_organization_id', el->>'attestor_user_id');
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_cosign:'||p_offer_id::text, 0));
  request_key := md5(jsonb_build_array('work-order-cosign', signer, p_offer_id, el->'attestor_kind', attestor_key, kinds, btrim(p_scope), cut)::text);
  SELECT h.id INTO prev FROM public.vehicle_observations h
    WHERE h.source_id = owner_source AND h.source_identifier = 'work_order_cosign:'||p_offer_id::text AND h.is_superseded IS FALSE
      AND h.extraction_method = 'work_order_cosign_sign_v1'
      AND COALESCE(h.structured_data#>>'{work_order_cosign,attestor_organization_id}', h.structured_data#>>'{work_order_cosign,attestor_user_id}') = attestor_key
    ORDER BY h.observed_at DESC LIMIT 1;
  IF prev IS NOT NULL AND (SELECT structured_data#>>'{work_order_cosign,request_key}' FROM public.vehicle_observations WHERE id = prev) = request_key THEN
    RETURN jsonb_build_object('cosign_id', prev, 'offer_id', p_offer_id, 'work_order_id', w.id, 'duplicate', true,
      'terms_hash', public.work_order_offer_terms_hash(p_offer_id));
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
    structured_data, submitted_by_user_id, observer_raw, extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_cosign:'||p_offer_id::text, signed, 'work_record',
    format('Co-sign (%s) on offer %s: %s', array_to_string(kinds, ', '), p_offer_id, btrim(p_scope)),
    md5(request_key||':'||COALESCE(prev::text, '')),
    jsonb_build_object('work_order_cosign', jsonb_build_object('version', 1, 'work_order_id', w.id, 'offer_id', p_offer_id,
      'request_key', request_key,
      'attestor_user_id', el->'attestor_user_id', 'attestor_organization_id', el->'attestor_organization_id', 'kinds', to_jsonb(kinds),
      'scope', btrim(p_scope), 'cut', cut, 'supersedes_cosign_id', prev, 'binding', 'on_offer_acceptance')),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account'), 'work_order_cosign_sign_v1', 'high', 0.95)
  RETURNING id INTO header_id;
  IF prev IS NOT NULL THEN
    UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = header_id, superseded_at = signed,
      lineage_chain = array_append(COALESCE(lineage_chain, ARRAY[]::uuid[]), header_id)
      WHERE source_id = owner_source AND is_superseded IS FALSE
        AND (id = prev OR source_identifier = 'work_order_cosign_attestation:'||prev::text);
  END IF;
  FOREACH k IN ARRAY kinds LOOP
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
      structured_data, submitted_by_user_id, observer_raw, extraction_method, confidence, confidence_score)
    VALUES (w.vehicle_id, owner_source, 'work_order_cosign_attestation:'||header_id::text, signed, 'work_record',
      format('Co-sign %s: %s', k, btrim(p_scope)), md5(header_id::text||':'||k),
      jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'attestation', 'work_order_id', w.id,
        'fulfillment_id', p_offer_id, 'attestor_user_id', el->'attestor_user_id', 'attestor_organization_id', el->'attestor_organization_id',
        'attestation_kind', k, 'verdict', 'supports', 'scope', btrim(p_scope)), 'work_order_cosign_id', header_id),
      signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account'), 'work_order_cosign_sign_v1', 'high', 0.95)
    RETURNING id INTO att_id;
    PERFORM public.project_work_order_resource_observation(att_id);
    att_ids := att_ids || to_jsonb(att_id);
  END LOOP;
  RETURN jsonb_build_object('cosign_id', header_id, 'offer_id', p_offer_id, 'work_order_id', w.id, 'attestation_ids', att_ids,
    'kinds', to_jsonb(kinds), 'scope', btrim(p_scope), 'cut', cut,
    'co_signer', jsonb_build_object('kind', el->'attestor_kind', 'user_id', el->'attestor_user_id', 'organization_id', el->'attestor_organization_id'),
    'supersedes_cosign_id', prev, 'terms_hash', public.work_order_offer_terms_hash(p_offer_id), 'binding', 'on_offer_acceptance',
    'signed_at', signed, 'duplicate', false, 'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.cosign_provider(uuid,uuid,text[],text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cosign_provider(uuid,uuid,text[],text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.cosign_provider(uuid,uuid,text[],text,jsonb) IS 'Sign: an organization owner/member (for the organization) or an account with claimed-owned tools (for itself) co-signs a performer offer: signed header record plus one authenticated attestation per kind (supervision, suitability, permission, availability) with scope, and an optional cut term binding on offer acceptance. Never the offering account or the customer. No payment.';

-- Binding cosigner terms: their provider acceptance is current and the co-sign record is current.
CREATE FUNCTION public.work_order_accepted_cosigners(p_work_order_id uuid)
RETURNS TABLE(assignment_id uuid, cosign_id uuid, offer_id uuid, cosigner_user_id uuid, cosigner_organization_id uuid,
  payout_type text, payout_rate numeric, payout_percentage numeric, payout_currency text, accepted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY SELECT c.id, c.cosign_observation_id, ap.offer_id, c.cosigner_user_id, c.cosigner_organization_id, c.payout_type,
      c.payout_rate, c.payout_percentage, c.payout_currency, c.accepted_at
    FROM public.work_order_assignments c
    JOIN public.work_order_assignments pa ON pa.acceptance_observation_id = c.cosign_acceptance_observation_id
    JOIN public.work_order_accepted_providers(p_work_order_id) ap ON ap.assignment_id = pa.id
    JOIN public.vehicle_observations h ON h.id = c.cosign_observation_id AND h.is_superseded IS FALSE
    WHERE c.work_order_id = p_work_order_id AND c.cosign_observation_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.work_order_accepted_cosigners(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_accepted_cosigners(uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_accepted_cosigners(uuid) IS 'Service-only: binding cosigner terms of a work order (their provider acceptance and co-sign record are current).';

-- Live definitions (20261019182000 / 20261019183000) with the co-sign changes.

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
    IF f.id IS NULL OR public.work_order_offer_terms_hash(f.id) IS DISTINCT FROM e->>'offer_hash' THEN
      RAISE EXCEPTION 'Offer hash does not match this offer and its current co-signs' USING ERRCODE = '23514';
    END IF;
    refusal := public.work_order_offer_acceptance_refusal(f.id, o.submitted_by_user_id, o.observed_at);
    IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Offer cannot be accepted: %', refusal USING ERRCODE = '42501'; END IF;
    SELECT r.requirement_kind INTO rkind FROM public.work_order_resource_requirements r WHERE r.id = f.requirement_id;
    SELECT CASE WHEN jsonb_array_length(f.offer_terms->'lines') = 1 AND f.offer_terms#>>'{lines,0,amount}' IS NOT NULL
      THEN f.offer_terms#>'{lines,0}' END INTO one_line;
    PERFORM set_config('nuke.work_order_offer_accept_row', o.id::text, true);
    INSERT INTO public.work_order_assignments(work_order_id, technician_id, performer_actor_id, fulfillment_id, acceptance_observation_id,
      accepted_by_user_id, offer_hash, accepted_terms_hash, role, status, offered_at, accepted_at, payout_type, payout_rate, payout_currency)
    VALUES (w.id, NULL, f.performer_actor_id, f.id, o.id, o.submitted_by_user_id, f.offer_hash, e->>'offer_hash',
      CASE WHEN rkind = 'inspection' THEN 'inspector' ELSE 'technician' END, 'accepted',
      (SELECT s.observed_at FROM public.vehicle_observations s WHERE s.id = f.id), o.observed_at,
      one_line->>'pricing_basis', (one_line->>'amount')::numeric, one_line->>'currency');
    -- Each current co-sign with a cut becomes its own cosigner compensation term, binding with this acceptance.
    INSERT INTO public.work_order_assignments(work_order_id, role, status, offered_at, accepted_at, cosigner_user_id,
      cosigner_organization_id, cosign_observation_id, cosign_acceptance_observation_id, payout_type, payout_rate, payout_percentage, payout_currency)
    SELECT w.id, 'cosigner', 'accepted', (c->>'signed_at')::timestamptz, o.observed_at, (c->>'attestor_user_id')::uuid,
      (c->>'attestor_organization_id')::uuid, (c->>'cosign_id')::uuid, o.id,
      CASE c#>>'{cut,basis}' WHEN 'share_of_labor_line' THEN 'percentage' WHEN 'flat' THEN 'flat' WHEN 'day_rate' THEN 'day_rate' END,
      (c#>>'{cut,amount}')::numeric, (c#>>'{cut,percentage}')::numeric, c#>>'{cut,currency}'
    FROM jsonb_array_elements(public.work_order_offer_cosigns(f.id)) c WHERE jsonb_typeof(c->'cut') = 'object';
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

CREATE OR REPLACE FUNCTION public.work_order_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.acceptance_observation_id, OLD.cosign_acceptance_observation_id) IS NOT NULL THEN
      RAISE EXCEPTION 'Accepted offer assignments are retained';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.acceptance_observation_id, NEW.cosign_acceptance_observation_id) IS NOT NULL
      AND current_setting('nuke.work_order_offer_accept_row', true) IS DISTINCT FROM
        COALESCE(NEW.acceptance_observation_id, NEW.cosign_acceptance_observation_id)::text THEN
      RAISE EXCEPTION 'Offer acceptances are recorded only by accept_offer';
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.acceptance_observation_id, NEW.acceptance_observation_id, OLD.cosign_acceptance_observation_id,
      NEW.cosign_acceptance_observation_id) IS NOT NULL
    AND (NEW.work_order_id, NEW.technician_id, NEW.performer_actor_id, NEW.fulfillment_id, NEW.acceptance_observation_id,
      NEW.accepted_by_user_id, NEW.offer_hash, NEW.role, NEW.offered_at, NEW.accepted_at, NEW.payout_type, NEW.payout_rate,
      NEW.payout_currency, NEW.payout_percentage, NEW.accepted_terms_hash, NEW.cosign_observation_id, NEW.cosign_acceptance_observation_id,
      NEW.cosigner_user_id, NEW.cosigner_organization_id) IS DISTINCT FROM (OLD.work_order_id, OLD.technician_id, OLD.performer_actor_id,
      OLD.fulfillment_id, OLD.acceptance_observation_id, OLD.accepted_by_user_id, OLD.offer_hash, OLD.role, OLD.offered_at, OLD.accepted_at,
      OLD.payout_type, OLD.payout_rate, OLD.payout_currency, OLD.payout_percentage, OLD.accepted_terms_hash, OLD.cosign_observation_id,
      OLD.cosign_acceptance_observation_id, OLD.cosigner_user_id, OLD.cosigner_organization_id) THEN
    RAISE EXCEPTION 'Accepted offer terms are immutable; record a new offer and acceptance';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_assignment_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.work_order_accepted_providers(p_work_order_id uuid)
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
  WHERE a.work_order_id = p_work_order_id AND a.accepted_by_user_id IS NOT DISTINCT FROM w.customer_id AND a.cosign_observation_id IS NULL
    AND public.work_order_offer_terms_hash(a.fulfillment_id) = COALESCE(a.accepted_terms_hash, a.offer_hash);
END $$;
REVOKE ALL ON FUNCTION public.work_order_accepted_providers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_accepted_providers(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_offer(p_offer_id uuid, p_offer_hash text)
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
  terms_hash text;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM public.work_order_resource_fulfillments WHERE id = p_offer_id AND offer_kind IS NOT NULL;
  IF FOUND THEN SELECT * INTO w FROM public.work_orders WHERE id = f.work_order_id; END IF;
  IF f.id IS NULL OR w.customer_id IS DISTINCT FROM signer THEN RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '42501'; END IF;
  terms_hash := public.work_order_offer_terms_hash(f.id);
  IF p_offer_hash IS DISTINCT FROM terms_hash THEN
    RAISE EXCEPTION 'Offer hash does not match this offer and its current co-signs' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_offer_accept:'||f.id::text, 0));
  refusal := public.work_order_offer_acceptance_refusal(f.id, signer, signed);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION 'Offer cannot be accepted: %', refusal USING ERRCODE = '42501'; END IF;
  SELECT a0.* INTO prior FROM public.work_order_assignments a0 JOIN public.vehicle_observations s ON s.id = a0.acceptance_observation_id
    WHERE a0.fulfillment_id = f.id AND a0.accepted_by_user_id = signer AND s.is_superseded IS FALSE AND a0.cosign_observation_id IS NULL
      AND COALESCE(a0.accepted_terms_hash, a0.offer_hash) = terms_hash ORDER BY a0.accepted_at DESC LIMIT 1;
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
      'offer_id', f.id, 'offer_hash', terms_hash, 'offer_own_hash', f.offer_hash, 'requirement_id', f.requirement_id,
      'signer_user_id', signer, 'signer_role', 'customer', 'co_signs', public.work_order_offer_cosigns(f.id))),
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
    'terms_hash', terms_hash, 'cosigner_terms', (SELECT count(*) FROM public.work_order_assignments c WHERE c.cosign_acceptance_observation_id = obs_id),
    'duplicate', false, 'work_order_status_changed', false, 'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.accept_offer(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_offer(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_order_offers_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  offering boolean;
  requirements jsonb;
  actions jsonb := '[]'::jsonb;
  n_offers integer;
  n_withdrawn integer;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots);
  offering := viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments f
    JOIN public.vehicle_observations s ON s.id = f.id WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL
      AND s.is_superseded IS FALSE AND s.submitted_by_user_id = viewer);
  IF offering THEN my_slots := array_append(my_slots, 'offering_provider'); END IF;

  WITH reqs AS (
    SELECT q->>'id' AS rid, q->>'requirement_kind' AS kind, q->>'description' AS description, q->>'line_item_id' AS line_item_id
    FROM jsonb_array_elements(public.read_work_order_resources(w.id)->'requirements') q
  ), offers AS (
    SELECT f.*, s.observed_at AS offered_at, s.submitted_by_user_id AS offering_account,
      s.structured_data#>>'{work_order_resource,note}' AS note,
      (SELECT ap.assignment_id FROM public.work_order_accepted_providers(w.id) ap WHERE ap.offer_id = f.id LIMIT 1) AS current_assignment,
      (SELECT a.accepted_at FROM public.work_order_assignments a WHERE a.fulfillment_id = f.id ORDER BY a.accepted_at DESC LIMIT 1) AS accepted_at,
      (SELECT a.role FROM public.work_order_assignments a WHERE a.fulfillment_id = f.id ORDER BY a.accepted_at DESC LIMIT 1) AS accepted_role
    FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
    WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL AND s.is_superseded IS FALSE AND s.vehicle_id = w.vehicle_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requirement_id', r.rid, 'requirement_kind', r.kind, 'description', r.description,
      'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('offer_id', o.id, 'offer_hash', o.offer_hash, 'offer_kind', o.offer_kind,
          'offer_rung', o.offer_rung,
          'provider', CASE WHEN o.offer_kind = 'organization' THEN public.platform_organization_label(o.supplier_organization_id)
            ELSE public.platform_person_label(o.offering_account) END
            || CASE WHEN party OR o.offering_account = viewer THEN jsonb_build_object('user_id', o.offering_account) ELSE '{}'::jsonb END,
          'performer', CASE WHEN o.performer_actor_id IS NOT NULL THEN public.platform_actor_label(o.performer_actor_id) END,
          'facility', CASE WHEN o.facility_organization_id IS NOT NULL THEN public.platform_organization_label(o.facility_organization_id) END,
          'terms', o.offer_terms, 'available_from', o.available_from, 'available_until', o.available_until, 'offered_at', o.offered_at,
          'note', CASE WHEN party OR o.offering_account = viewer THEN o.note END,
          'terms_hash', public.work_order_offer_terms_hash(o.id),
          'co_signs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('cosign_id', c->'cosign_id',
              'co_signer', CASE WHEN c->>'attestor_organization_id' IS NOT NULL THEN public.platform_organization_label((c->>'attestor_organization_id')::uuid)
                ELSE public.platform_person_label((c->>'attestor_user_id')::uuid)
                  || CASE WHEN party THEN jsonb_build_object('user_id', c->'attestor_user_id') ELSE '{}'::jsonb END END,
              'kinds', c->'kinds', 'scope', c->'scope', 'cut', c->'cut', 'signed_at', c->'signed_at', 'attribution', 'authenticated_sign',
              'binding', 'on_offer_acceptance')), '[]'::jsonb) FROM jsonb_array_elements(public.work_order_offer_cosigns(o.id)) c),
          'acceptance', jsonb_build_object('state', CASE WHEN o.current_assignment IS NOT NULL THEN 'accepted'
              WHEN o.accepted_at IS NOT NULL THEN 'withheld' ELSE 'not_accepted' END,
            'accepted_at', o.accepted_at, 'role', o.accepted_role),
          'attribution', 'authenticated_sign') ORDER BY o.offered_at, o.id) FROM offers o WHERE o.requirement_id::text = r.rid), '[]'::jsonb))
    ORDER BY r.rid), '[]'::jsonb) INTO requirements FROM reqs r;

  SELECT count(*) INTO n_offers FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers');
  SELECT count(*) INTO n_withdrawn FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
    WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL AND s.is_superseded IS NOT FALSE;

  IF viewer IS NOT NULL THEN
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'offer', 'rpc', 'offer_on_requirement',
        'args', jsonb_build_object('p_requirement_id', r->>'requirement_id'),
        'as', jsonb_build_object('offer_kind', el->'offer_kind', 'offer_rung', el->'rung'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r
      CROSS JOIN LATERAL (SELECT public.work_order_offer_eligibility(viewer, (r->>'requirement_id')::uuid) AS el) e
      WHERE (el->>'eligible')::boolean;
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'withdraw_offer', 'rpc', 'withdraw_offer',
        'args', jsonb_build_object('p_offer_id', o->>'offer_id'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers') o
      WHERE (SELECT s.submitted_by_user_id FROM public.vehicle_observations s WHERE s.id = (o->>'offer_id')::uuid) = viewer;
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'accept_offer', 'rpc', 'accept_offer',
        'args', jsonb_build_object('p_offer_id', o->>'offer_id', 'p_offer_hash', o->>'terms_hash'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers') o
      WHERE o#>>'{acceptance,state}' <> 'accepted'
        AND public.work_order_offer_acceptance_refusal((o->>'offer_id')::uuid, viewer, statement_timestamp()) IS NULL;
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'cosign_provider', 'rpc', 'cosign_provider',
        'args', jsonb_build_object('p_work_order_id', w.id, 'p_offer_id', o->>'offer_id'),
        'as', jsonb_build_object('attestor_kind', el->'attestor_kind', 'attestor_organization_id', el->'attestor_organization_id'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers') o
      CROSS JOIN LATERAL (SELECT public.work_order_cosign_eligibility(viewer, (o->>'offer_id')::uuid, NULL) AS el) e
      WHERE (el->>'eligible')::boolean;
  END IF;

  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(),
    'work_order_status', w.status, 'requirements', requirements,
    'accepted_providers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('assignment_id', ap.assignment_id, 'offer_id', ap.offer_id,
        'role', ap.role, 'accepted_at', ap.accepted_at, 'performer', public.platform_actor_label(ap.performer_actor_id),
        'provider', public.platform_person_label(ap.account_id)
          || CASE WHEN party THEN jsonb_build_object('user_id', ap.account_id) ELSE '{}'::jsonb END) ORDER BY ap.accepted_at), '[]'::jsonb)
      FROM public.work_order_accepted_providers(w.id) ap),
    'accepted_cosigners', (SELECT COALESCE(jsonb_agg(jsonb_build_object('assignment_id', ac.assignment_id, 'cosign_id', ac.cosign_id,
        'offer_id', ac.offer_id, 'accepted_at', ac.accepted_at,
        'co_signer', CASE WHEN ac.cosigner_organization_id IS NOT NULL THEN public.platform_organization_label(ac.cosigner_organization_id)
          ELSE public.platform_person_label(ac.cosigner_user_id) END,
        'cut', jsonb_build_object('pricing_basis', ac.payout_type, 'amount', ac.payout_rate, 'percentage', ac.payout_percentage,
          'currency', ac.payout_currency)) ORDER BY ac.accepted_at), '[]'::jsonb)
      FROM public.work_order_accepted_cosigners(w.id) ac),
    'viewer', public.job_reader_viewer(CASE WHEN offering AND public.job_reader_context(my_slots) = 'visitor' THEN 'provider'
        ELSE public.job_reader_context(my_slots) END, my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', actions),
    'coverage', jsonb_build_object('requirements', jsonb_array_length(requirements), 'current_offers', n_offers,
      'withdrawn_or_revised_offers', n_withdrawn, 'source_scope', 'offer_on_requirement and accept_offer Sign records',
      'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only',
    'payment_authorized', false, 'disbursement', 'not_performed');
END $$;
REVOKE ALL ON FUNCTION public.work_order_offers_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_offers_read(uuid) TO anon, authenticated;

-- Backend work_order_resources_read: report signed attestations as authenticated (one value, anchored on the live definition).
DO $$
DECLARE
  def text := pg_get_functiondef('public.work_order_resources_read(uuid)'::regprocedure);
  anchor text := '''attestor_basis'', ''attributed_by_source_testimony''';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'work_order_resources_read attestor_basis anchor not found exactly once';
  END IF;
  EXECUTE replace(def, anchor, '''attestor_basis'', CASE WHEN public.work_order_attestation_authenticated((a->>''id'')::uuid) THEN ''authenticated_sign'' ELSE ''attributed_by_source_testimony'' END');
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
