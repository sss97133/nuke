-- Completion on the work-order spine (standard language: ... work order -> completion -> invoice -> payment -> receipt).
-- THEORY decisions 3 and 9: a Sign captures signer, sign clock and a snapshot; status columns stay derived caches.
--
--   attest_work_completion(p_work_order_id, p_scope_hash, p_note, p_evidence): the provider's Sign. Eligible: a current
--     accepted provider (work_order_accepted_providers, from accept_offer), an active owner of the work order's
--     organization, or an active member of it; never the customer. p_scope_hash pins what was completed: the accepted
--     quote's quote_hash when the work order has a current accepted quote, otherwise sha256 of the current
--     work_order_quote_scope_snapshot (work_order_completion_basis). Optional evidence: [{kind, id}] of observations,
--     images, work sessions or component events on the same vehicle.
--   accept_work_completion(p_work_order_id, p_completion_id, p_completion_hash): the customer's Sign over one exact
--     provider attestation (its completion_hash).
--   Both write one owner-input work_record (signer = auth.uid(), sign clock) under a work_order_lifecycle envelope and
--     project it in the same transaction with project_work_order_lifecycle_event into immutable observation-keyed rows
--     (work_order_completion_attestations / work_order_completion_acceptances). A separate envelope and projector
--     keep the shared resource projector unchanged. work_order_resource_attestations kind 'delivery' does not fit:
--     it attests one candidate resource arrangement (fulfillment), not the work order's completion against a scope.
--   A superseded quote, a changed scope or a withdrawn source withholds the attestation and its acceptance.
-- Job path: the completion stage is recorded only with a current provider attestation (a completion clock alone is
-- partial); customer_acceptance is established only with the customer's Sign. One line is added to the live
-- read_work_order_job_path (work_order_completion_overlay after the completion block); nothing else in it changes.
-- No status write, no invoice, no payment, no messaging.
-- Contract: supabase/sql/test_work_order_completion_sign.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_completion_attestations (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role IN ('accepted_provider','organization_owner','organization_member')),
  scope_basis text NOT NULL CHECK (scope_basis IN ('accepted_quote','scope_snapshot')),
  quote_id uuid,
  quote_hash text,
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 50),
  completion_hash text NOT NULL CHECK (completion_hash ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz NOT NULL CHECK (isfinite(signed_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, work_order_id, completion_hash),
  CHECK ((scope_basis = 'accepted_quote') = (quote_id IS NOT NULL AND quote_hash IS NOT NULL))
);
CREATE INDEX work_order_completion_attestations_order ON public.work_order_completion_attestations(work_order_id, signed_at DESC);
CREATE TABLE public.work_order_completion_acceptances (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  completion_id uuid NOT NULL,
  completion_hash text NOT NULL,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role = 'customer'),
  signed_at timestamptz NOT NULL CHECK (isfinite(signed_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (completion_id, work_order_id, completion_hash)
    REFERENCES public.work_order_completion_attestations(id, work_order_id, completion_hash) ON DELETE RESTRICT
);
CREATE INDEX work_order_completion_acceptances_completion ON public.work_order_completion_acceptances(completion_id);
COMMENT ON TABLE public.work_order_completion_attestations IS 'Provider completion Sign: one row per owner-input work_record (attest_work_completion), pinned to the accepted quote hash or the scope snapshot hash. Immutable; withheld when its scope is no longer current. Writer: project_work_order_lifecycle_event.';
COMMENT ON TABLE public.work_order_completion_acceptances IS 'Customer completion acceptance Sign over one exact provider attestation hash (accept_work_completion). Immutable. Writer: project_work_order_lifecycle_event.';

CREATE FUNCTION public.work_order_lifecycle_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Work-order lifecycle projections are immutable; supersede the source and sign again'; END $$;
REVOKE ALL ON FUNCTION public.work_order_lifecycle_immutable() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_completion_attestations','work_order_completion_acceptances'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY lifecycle_service_read ON public.%I FOR SELECT TO service_role USING (true)', t);
    EXECUTE format('CREATE TRIGGER lifecycle_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
    EXECUTE format('CREATE TRIGGER lifecycle_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
  END LOOP;
END $$;

-- What a completion is pinned to now: the current accepted quote, else the current scope snapshot.
CREATE FUNCTION public.work_order_completion_basis(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE qs jsonb := public.work_order_quote_state(p_work_order_id);
BEGIN
  IF qs#>>'{acceptance,state}' = 'accepted' THEN
    RETURN jsonb_build_object('basis', 'accepted_quote', 'quote_id', qs#>'{acceptance,quote_id}', 'quote_version', qs#>'{acceptance,quote_version}',
      'scope_hash', qs#>>'{acceptance,quote_hash}');
  END IF;
  RETURN jsonb_build_object('basis', 'scope_snapshot', 'quote_id', NULL, 'quote_version', NULL,
    'scope_hash', encode(sha256(convert_to(public.work_order_quote_scope_snapshot(p_work_order_id)::text, 'UTF8')), 'hex'));
END $$;

CREATE FUNCTION public.work_order_completion_signer_role(p_work_order_id uuid, p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_user IS NULL OR w.customer_id IS NOT DISTINCT FROM p_user THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = p_user) THEN 'accepted_provider'
    WHEN w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id = w.organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN 'organization_owner'
    WHEN w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = w.organization_id AND oc.user_id = p_user AND oc.status = 'active') THEN 'organization_member' END
  FROM public.work_orders w WHERE w.id = p_work_order_id
$$;

CREATE FUNCTION public.work_order_lifecycle_evidence_valid(p_evidence jsonb, p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_typeof(COALESCE(p_evidence, '[]'::jsonb)) = 'array' AND jsonb_array_length(COALESCE(p_evidence, '[]'::jsonb)) <= 50
    AND COALESCE(bool_and(jsonb_typeof(e) = 'object' AND (e - ARRAY['kind','id']) = '{}'::jsonb
      AND (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND CASE e->>'kind'
        WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = (e->>'id')::uuid AND o.vehicle_id = p_vehicle_id AND o.is_superseded IS FALSE)
        WHEN 'image' THEN EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = (e->>'id')::uuid AND i.vehicle_id = p_vehicle_id)
        WHEN 'work_session' THEN EXISTS (SELECT 1 FROM public.work_sessions s WHERE s.id = (e->>'id')::uuid AND s.vehicle_id = p_vehicle_id)
        WHEN 'component_event' THEN EXISTS (SELECT 1 FROM public.component_events c WHERE c.id = (e->>'id')::uuid AND c.vehicle_id = p_vehicle_id)
        ELSE false END), true)
  FROM jsonb_array_elements(COALESCE(p_evidence, '[]'::jsonb)) e
$$;

-- Projector for work_order_lifecycle envelopes; called by the Sign RPCs in their transaction (service role may replay).
CREATE FUNCTION public.project_work_order_lifecycle_event(p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  ev text;
  role text;
  basis jsonb;
  att public.work_order_completion_attestations%ROWTYPE;
  inserted integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.submitted_by_user_id IS NULL
     OR o.source_id IS DISTINCT FROM (SELECT id FROM public.observation_sources WHERE slug = 'owner-input') THEN
    RAISE EXCEPTION 'Current signed owner-input work_record required';
  END IF;
  e := o.structured_data->'work_order_lifecycle';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'work_order_lifecycle version 1 envelope required'; END IF;
  ev := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN RAISE EXCEPTION 'Source and work order must identify the same vehicle'; END IF;
  IF ev = 'completion_attestation' THEN
    role := public.work_order_completion_signer_role(w.id, o.submitted_by_user_id);
    IF role IS NULL OR role IS DISTINCT FROM e->>'signer_role' THEN RAISE EXCEPTION 'Signer is not an eligible provider for this work order'; END IF;
    basis := public.work_order_completion_basis(w.id);
    IF e->>'scope_hash' IS DISTINCT FROM basis->>'scope_hash' THEN RAISE EXCEPTION 'Scope hash does not match the current accepted quote or scope'; END IF;
    IF NOT public.work_order_lifecycle_evidence_valid(e->'evidence', w.vehicle_id) THEN RAISE EXCEPTION 'Evidence must name existing rows on this vehicle'; END IF;
    INSERT INTO public.work_order_completion_attestations(id, work_order_id, signer_user_id, signer_role, scope_basis, quote_id, quote_hash,
      scope_hash, evidence, completion_hash, signed_at)
    VALUES (o.id, w.id, o.submitted_by_user_id, role, basis->>'basis', (basis->>'quote_id')::uuid,
      CASE WHEN basis->>'basis' = 'accepted_quote' THEN basis->>'scope_hash' END, basis->>'scope_hash', COALESCE(e->'evidence', '[]'::jsonb),
      encode(sha256(convert_to(jsonb_build_array('work_order_completion', w.id, o.submitted_by_user_id, role, basis->>'scope_hash',
        COALESCE(e->'evidence', '[]'::jsonb), o.observed_at)::text, 'UTF8')), 'hex'), o.observed_at)
    ON CONFLICT (id) DO NOTHING;
  ELSIF ev = 'completion_acceptance' THEN
    IF w.customer_id IS DISTINCT FROM o.submitted_by_user_id THEN RAISE EXCEPTION 'Only the work order customer accepts completion'; END IF;
    SELECT a.* INTO att FROM public.work_order_completion_attestations a JOIN public.vehicle_observations s ON s.id = a.id
      WHERE a.id = (e->>'completion_id')::uuid AND a.work_order_id = w.id AND s.is_superseded IS FALSE;
    IF att.id IS NULL OR att.completion_hash IS DISTINCT FROM e->>'completion_hash' THEN RAISE EXCEPTION 'Completion attestation and hash must match'; END IF;
    IF att.scope_hash IS DISTINCT FROM public.work_order_completion_basis(w.id)->>'scope_hash' THEN
      RAISE EXCEPTION 'Completion attestation is withheld: its quote or scope is no longer current';
    END IF;
    INSERT INTO public.work_order_completion_acceptances(id, work_order_id, completion_id, completion_hash, signer_user_id, signer_role, signed_at)
    VALUES (o.id, w.id, att.id, att.completion_hash, o.submitted_by_user_id, 'customer', o.observed_at) ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Unknown work_order_lifecycle event type';
  END IF;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN jsonb_build_object('id', o.id, 'event_type', ev, 'duplicate', inserted = 0);
END $$;

CREATE FUNCTION public.attest_work_completion(p_work_order_id uuid, p_scope_hash text, p_note text DEFAULT NULL, p_evidence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  role text;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  a public.work_order_completion_attestations%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  role := public.work_order_completion_signer_role(p_work_order_id, signer);
  IF w.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for completion' USING ERRCODE = '42501'; END IF;
  IF w.vehicle_id IS NULL THEN RAISE EXCEPTION 'Completion needs a vehicle-bound work order' USING ERRCODE = '23514'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 2000 THEN RAISE EXCEPTION 'Note must be at most 2000 characters' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_lifecycle:' || w.id::text, 0));
  IF p_scope_hash IS DISTINCT FROM public.work_order_completion_basis(w.id)->>'scope_hash' THEN
    RAISE EXCEPTION 'Scope hash does not match the current accepted quote or scope' USING ERRCODE = '23514';
  END IF;
  IF NOT public.work_order_lifecycle_evidence_valid(p_evidence, w.vehicle_id) THEN
    RAISE EXCEPTION 'Evidence must be [{kind, id}] naming existing rows on this vehicle' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-completion-attestation', signer, w.id, p_scope_hash, p_evidence, p_note)::text);
  SELECT x.* INTO a FROM public.work_order_completion_attestations x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_completion_attestation:' || w.id::text
      AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF a.id IS NULL THEN
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
      source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
      confidence, confidence_score)
    VALUES (w.vehicle_id, owner_source, 'work_order_completion_attestation:' || w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
      format('Provider attested completion of work order %s.', w.id), request_key,
      jsonb_build_object('work_order_lifecycle', jsonb_build_object('version', 1, 'event_type', 'completion_attestation', 'work_order_id', w.id,
        'scope_hash', p_scope_hash, 'evidence', COALESCE(p_evidence, '[]'::jsonb), 'note', p_note, 'signer_user_id', signer, 'signer_role', role)),
      signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'signer_role', role), 'work_order_completion_attestation_sign_v1', 'high', 0.95)
    RETURNING id INTO obs_id;
    PERFORM public.project_work_order_lifecycle_event(obs_id);
    SELECT * INTO a FROM public.work_order_completion_attestations WHERE id = obs_id;
    RETURN jsonb_build_object('completion_id', a.id, 'completion_hash', a.completion_hash, 'work_order_id', w.id, 'scope_basis', a.scope_basis,
      'quote_id', a.quote_id, 'signer_role', a.signer_role, 'signed_at', a.signed_at, 'evidence_count', jsonb_array_length(a.evidence),
      'duplicate', false, 'work_order_status_changed', false, 'customer_notified', false, 'payment_authorized', false);
  END IF;
  RETURN jsonb_build_object('completion_id', a.id, 'completion_hash', a.completion_hash, 'work_order_id', w.id, 'scope_basis', a.scope_basis,
    'quote_id', a.quote_id, 'signer_role', a.signer_role, 'signed_at', a.signed_at, 'evidence_count', jsonb_array_length(a.evidence),
    'duplicate', true, 'work_order_status_changed', false, 'customer_notified', false, 'payment_authorized', false);
END $$;

CREATE FUNCTION public.accept_work_completion(p_work_order_id uuid, p_completion_id uuid, p_completion_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  a public.work_order_completion_attestations%ROWTYPE;
  prior public.work_order_completion_acceptances%ROWTYPE;
  owner_source uuid;
  obs_id uuid;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF w.id IS NULL OR w.customer_id IS DISTINCT FROM signer THEN RAISE EXCEPTION 'Completion unavailable' USING ERRCODE = '42501'; END IF;
  SELECT x.* INTO a FROM public.work_order_completion_attestations x JOIN public.vehicle_observations s ON s.id = x.id
    WHERE x.id = p_completion_id AND x.work_order_id = w.id AND s.is_superseded IS FALSE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Completion unavailable' USING ERRCODE = '42501'; END IF;
  IF p_completion_hash IS DISTINCT FROM a.completion_hash THEN RAISE EXCEPTION 'Completion hash does not match this attestation' USING ERRCODE = '23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_lifecycle:' || w.id::text, 0));
  IF a.scope_hash IS DISTINCT FROM public.work_order_completion_basis(w.id)->>'scope_hash' THEN
    RAISE EXCEPTION 'Completion is withheld: its quote or scope is no longer current' USING ERRCODE = '42501';
  END IF;
  SELECT x.* INTO prior FROM public.work_order_completion_acceptances x JOIN public.vehicle_observations s ON s.id = x.id
    WHERE x.completion_id = a.id AND x.signer_user_id = signer AND s.is_superseded IS FALSE ORDER BY x.signed_at DESC LIMIT 1;
  IF prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('acceptance_id', prior.id, 'completion_id', a.id, 'work_order_id', w.id, 'signed_at', prior.signed_at,
      'signer_role', 'customer', 'duplicate', true, 'work_order_status_changed', false, 'payment_authorized', false);
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
    confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_completion_acceptance:' || a.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('Customer accepted the completion of work order %s (completion hash %s).', w.id, a.completion_hash),
    md5('work-order-completion-acceptance:' || signer::text || ':' || a.id::text || ':' || signed::text),
    jsonb_build_object('work_order_lifecycle', jsonb_build_object('version', 1, 'event_type', 'completion_acceptance', 'work_order_id', w.id,
      'completion_id', a.id, 'completion_hash', a.completion_hash, 'signer_user_id', signer, 'signer_role', 'customer')),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account'), 'work_order_completion_acceptance_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_lifecycle_event(obs_id);
  RETURN jsonb_build_object('acceptance_id', obs_id, 'completion_id', a.id, 'work_order_id', w.id, 'signed_at', signed, 'signer_role', 'customer',
    'duplicate', false, 'work_order_status_changed', false, 'payment_authorized', false);
END $$;

-- The job path's completion stage, from the Signs: recorded only with a current provider attestation.
CREATE FUNCTION public.work_order_completion_overlay(p_work_order_id uuid, p_stage jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  basis jsonb := public.work_order_completion_basis(p_work_order_id);
  cur public.work_order_completion_attestations%ROWTYPE;
  acc public.work_order_completion_acceptances%ROWTYPE;
  n_withheld integer;
  n_acc_withheld integer;
  state text;
  gaps jsonb := COALESCE(p_stage->'gaps', '[]'::jsonb);
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  SELECT a.* INTO cur FROM public.work_order_completion_attestations a JOIN public.vehicle_observations s ON s.id = a.id
    WHERE a.work_order_id = p_work_order_id AND s.is_superseded IS FALSE AND a.scope_hash = basis->>'scope_hash'
    ORDER BY a.signed_at DESC, a.id DESC LIMIT 1;
  SELECT count(*) INTO n_withheld FROM public.work_order_completion_attestations a JOIN public.vehicle_observations s ON s.id = a.id
    WHERE a.work_order_id = p_work_order_id AND s.is_superseded IS FALSE AND a.scope_hash IS DISTINCT FROM basis->>'scope_hash';
  IF cur.id IS NOT NULL THEN
    SELECT x.* INTO acc FROM public.work_order_completion_acceptances x JOIN public.vehicle_observations s ON s.id = x.id
      WHERE x.completion_id = cur.id AND s.is_superseded IS FALSE AND x.signer_user_id IS NOT DISTINCT FROM w.customer_id
      ORDER BY x.signed_at DESC LIMIT 1;
  END IF;
  SELECT count(*) INTO n_acc_withheld FROM public.work_order_completion_acceptances x JOIN public.vehicle_observations s ON s.id = x.id
    WHERE x.work_order_id = p_work_order_id AND s.is_superseded IS FALSE AND x.completion_id IS DISTINCT FROM cur.id;
  state := CASE WHEN cur.id IS NOT NULL THEN 'recorded' WHEN p_stage->>'state' = 'recorded' THEN 'partial' ELSE p_stage->>'state' END;
  IF cur.id IS NULL THEN gaps := gaps || '["no_provider_completion_attestation"]'::jsonb; END IF;
  IF n_withheld > 0 THEN gaps := gaps || '["completion_attestation_withheld_scope_changed"]'::jsonb; END IF;
  IF cur.id IS NOT NULL AND acc.id IS NULL THEN gaps := gaps || '["no_customer_completion_acceptance"]'::jsonb; END IF;
  RETURN p_stage || jsonb_build_object('state', state,
    'state_basis', CASE WHEN cur.id IS NOT NULL THEN 'provider_completion_attestation'
      WHEN p_stage->>'state' = 'recorded' THEN 'completion_clock_without_attestation' ELSE 'no_completion_sign' END,
    'provider_attestation', CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object('completion_id', cur.id, 'completion_hash', cur.completion_hash,
      'signed_at', cur.signed_at, 'signer_role', cur.signer_role, 'scope_basis', cur.scope_basis, 'quote_id', cur.quote_id,
      'evidence_count', jsonb_array_length(cur.evidence), 'basis', 'authenticated_sign') END,
    'attestations_withheld', n_withheld,
    'customer_acceptance', CASE WHEN acc.id IS NOT NULL THEN 'established' WHEN cur.id IS NULL AND n_acc_withheld > 0 THEN 'withheld'
      ELSE 'not_established' END,
    'acceptances_withheld', n_acc_withheld,
    'customer_acceptance_sign', CASE WHEN acc.id IS NULL THEN NULL ELSE jsonb_build_object('acceptance_id', acc.id, 'signed_at', acc.signed_at,
      'basis', 'authenticated_sign') END,
    'scope_basis', jsonb_build_object('basis', basis->>'basis', 'quote_id', basis->'quote_id', 'scope_hash', basis->>'scope_hash'),
    'gaps', gaps);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['work_order_completion_basis(uuid)','work_order_completion_signer_role(uuid,uuid)',
      'work_order_lifecycle_evidence_valid(jsonb,uuid)','project_work_order_lifecycle_event(uuid)','work_order_completion_overlay(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['attest_work_completion(uuid,text,text,jsonb)','accept_work_completion(uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.attest_work_completion(uuid,text,text,jsonb) IS 'Sign: an eligible provider (accepted provider, organization owner or member; never the customer) attests completion pinned to the current accepted quote hash or scope snapshot hash. Owner-input work_record + projection. No status write, invoice, payment or messaging.';
COMMENT ON FUNCTION public.accept_work_completion(uuid,uuid,text) IS 'Sign: the work order customer accepts one exact, current provider completion attestation (completion_hash). Owner-input work_record + projection. No payment.';

-- One line in the live job path: the completion stage passes through the overlay.
DO $apply$
DECLARE
  def text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  anchor constant text := $a$CASE WHEN n_asg_unclocked_complete>0 THEN 'assignment_completed_status_without_clock' END],NULL)));$a$;
BEGIN
  IF position('work_order_completion_overlay' IN def) > 0 THEN RAISE EXCEPTION 'job path already carries the completion overlay'; END IF;
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'job path completion block not found once'; END IF;
  EXECUTE replace(def, anchor, anchor || E'\n  completion := public.work_order_completion_overlay(w.id, completion);');
END $apply$;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, 'id', 'project_work_order_lifecycle_event', 'Observation-keyed completion Sign projection; written only by the Sign RPC in its transaction.', true,
  'attest_work_completion(uuid,text,text,jsonb); accept_work_completion(uuid,uuid,text)'
FROM unnest(ARRAY['work_order_completion_attestations','work_order_completion_acceptances']) t
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = t AND r.column_name = 'id');
NOTIFY pgrst, 'reload schema';
COMMIT;
