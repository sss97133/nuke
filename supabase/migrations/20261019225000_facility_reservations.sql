-- Facility reservations: bay grain for "Facility/bay access" (R1). A job's customer or accepted provider requests a
-- declared asset for a window; the facility organization confirms. Only confirmed reservations occupy capacity.
--
--   reserve_facility(p_work_order_id, p_asset_id, p_from, p_until, p_terms): requester = the work order customer or a
--     current accepted provider. The asset must be a member-declared, in-service asset (declare_facility_asset). Window:
--     future, from before until, at most 31 days. Terms (open): null or {basis: hourly | day_rate | flat, amount, currency}.
--     The reservation is linked to the job's current facility requirement when there is one.
--   confirm_facility_reservation(p_reservation_id, p_hash): an active owner or member of the facility organization signs
--     the exact request (hash). Confirmation occupies one capacity slot of the asset for the window: facility_asset_occupancy
--     assigns the lowest free slot under a per-asset lock and refuses when every slot overlaps (capacity respected). When
--     an owner confirms and the job has a facility requirement, the organization's facility offer on it is recorded through
--     offer_on_requirement (window and terms as offer lines), so the job path plan counts it and the customer can
--     accept it like any offer; a member's confirmation records no offer (offers are owner Signs).
--   cancel_facility_reservation(p_reservation_id): the requester or a facility owner/member; a cancellation record
--     supersedes the request source and releases any occupied slot.
--   Requests, confirmations and cancellations are owner-input work_records (envelope facility_reservation v1) projected
--     by project_facility_reservation_event into immutable rows; occupancy is a derived cache. No payment.
-- Contract: supabase/sql/test_facility_reservations.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.facility_reservations (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  requirement_id uuid,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_role text NOT NULL CHECK (requester_role IN ('customer','accepted_provider')),
  window_from timestamptz NOT NULL CHECK (isfinite(window_from)),
  window_until timestamptz NOT NULL CHECK (isfinite(window_until)),
  terms jsonb CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object'),
  reservation_hash text NOT NULL CHECK (reservation_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (window_from < window_until AND window_until - window_from <= interval '31 days'),
  UNIQUE (id, reservation_hash)
);
CREATE INDEX facility_reservations_asset ON public.facility_reservations(asset_id, window_from);
CREATE INDEX facility_reservations_work_order ON public.facility_reservations(work_order_id);
CREATE INDEX facility_reservations_organization ON public.facility_reservations(organization_id, window_from);
CREATE TABLE public.facility_reservation_confirmations (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL UNIQUE,
  reservation_hash text NOT NULL,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role IN ('organization_owner','organization_member')),
  offer_id uuid,
  confirmed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (reservation_id, reservation_hash) REFERENCES public.facility_reservations(id, reservation_hash) ON DELETE RESTRICT
);
CREATE TABLE public.facility_reservation_cancellations (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.facility_reservations(id) ON DELETE RESTRICT,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role IN ('customer','accepted_provider','organization_owner','organization_member')),
  cancelled_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.facility_asset_occupancy (
  reservation_id uuid PRIMARY KEY REFERENCES public.facility_reservations(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  slot integer NOT NULL CHECK (slot >= 1),
  occupied tstzrange NOT NULL CHECK (NOT isempty(occupied)),
  released_at timestamptz
);
CREATE INDEX facility_asset_occupancy_active ON public.facility_asset_occupancy(asset_id, lower(occupied)) WHERE released_at IS NULL;
COMMENT ON TABLE public.facility_reservations IS 'Facility reservation requests (reserve_facility), one per owner-input work_record; immutable. State is derived: confirmed, cancelled, expired or requested.';
COMMENT ON TABLE public.facility_reservation_confirmations IS 'Facility organization Sign over one exact reservation request hash (confirm_facility_reservation); immutable.';
COMMENT ON TABLE public.facility_reservation_cancellations IS 'Cancellation records (cancel_facility_reservation); the request source is superseded; immutable.';
COMMENT ON TABLE public.facility_asset_occupancy IS 'Derived cache: confirmed reservations holding one capacity slot of an asset for a window; released on cancellation. Overlap per asset slot refused by trigger.';

CREATE FUNCTION public.facility_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Facility reservation records are immutable; cancel and request again'; END $$;
REVOKE ALL ON FUNCTION public.facility_records_immutable() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facility_reservations','facility_reservation_confirmations','facility_reservation_cancellations','facility_asset_occupancy'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY facility_service_read ON public.%I FOR SELECT TO service_role USING (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['facility_reservations','facility_reservation_confirmations','facility_reservation_cancellations'] LOOP
    EXECUTE format('CREATE TRIGGER facility_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.facility_records_immutable()', t);
    EXECUTE format('CREATE TRIGGER facility_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.facility_records_immutable()', t);
  END LOOP;
END $$;

-- Capacity: the lowest slot with no active overlapping occupancy, under a per-asset lock; refuse when none.
CREATE FUNCTION public.facility_asset_occupancy_assign() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cap integer; pick integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('facility_asset_occupancy:' || NEW.asset_id::text, 0));
  SELECT capacity INTO cap FROM public.equipment WHERE id = NEW.asset_id AND source = 'member_declaration' AND status = 'in_service';
  IF cap IS NULL THEN RAISE EXCEPTION 'Asset is not a declared, in-service facility asset' USING ERRCODE = '23514'; END IF;
  SELECT s INTO pick FROM generate_series(1, cap) s
    WHERE NOT EXISTS (SELECT 1 FROM public.facility_asset_occupancy o WHERE o.asset_id = NEW.asset_id AND o.slot = s
      AND o.released_at IS NULL AND o.occupied && NEW.occupied AND o.reservation_id <> NEW.reservation_id)
    ORDER BY s LIMIT 1;
  IF pick IS NULL THEN RAISE EXCEPTION 'Asset fully booked for that window (capacity %)', cap USING ERRCODE = '23P01'; END IF;
  NEW.slot := pick;
  RETURN NEW;
END $$;
CREATE TRIGGER facility_asset_occupancy_assign BEFORE INSERT ON public.facility_asset_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.facility_asset_occupancy_assign();
CREATE FUNCTION public.facility_asset_occupancy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW.reservation_id, NEW.asset_id, NEW.slot, NEW.occupied) IS DISTINCT FROM (OLD.reservation_id, OLD.asset_id, OLD.slot, OLD.occupied)
    OR OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Occupancy rows are only released, never moved or deleted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facility_asset_occupancy_guard BEFORE UPDATE OR DELETE ON public.facility_asset_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.facility_asset_occupancy_guard();

CREATE FUNCTION public.facility_reservation_terms_normalize(p_terms jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_terms IS NULL OR p_terms = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_terms) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_terms) k WHERE k NOT IN ('basis','amount','currency'))
    OR COALESCE(p_terms->>'basis', '') NOT IN ('hourly','day_rate','flat')
    OR jsonb_typeof(p_terms->'amount') IS DISTINCT FROM 'number' OR (p_terms->>'amount')::numeric < 0 OR (p_terms->>'amount')::numeric >= 1000000
    OR jsonb_typeof(p_terms->'currency') IS DISTINCT FROM 'string' OR p_terms->>'currency' !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Terms must be {basis: hourly | day_rate | flat, amount, currency}' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('basis', p_terms->>'basis', 'amount', (p_terms->>'amount')::numeric, 'currency', p_terms->>'currency');
END $$;

CREATE FUNCTION public.facility_reservation_state(p_reservation_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.facility_reservation_cancellations c WHERE c.reservation_id = r.id) OR s.is_superseded IS NOT FALSE THEN 'cancelled'
    WHEN EXISTS (SELECT 1 FROM public.facility_reservation_confirmations c WHERE c.reservation_id = r.id) THEN
      CASE WHEN r.window_until <= statement_timestamp() THEN 'completed_window' ELSE 'confirmed' END
    WHEN r.window_until <= statement_timestamp() THEN 'expired'
    ELSE 'requested' END
  FROM public.facility_reservations r JOIN public.vehicle_observations s ON s.id = r.id WHERE r.id = p_reservation_id
$$;

CREATE FUNCTION public.facility_reservation_requester_role(p_work_order_id uuid, p_user uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE w public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF p_user IS NULL OR w.id IS NULL THEN RETURN NULL; END IF;
  IF w.customer_id = p_user THEN RETURN 'customer'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = p_user) THEN RETURN 'accepted_provider'; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.project_facility_reservation_event(p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  ev text;
  r public.facility_reservations%ROWTYPE;
  inserted integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.submitted_by_user_id IS NULL
     OR o.source_id IS DISTINCT FROM (SELECT id FROM public.observation_sources WHERE slug = 'owner-input') THEN
    RAISE EXCEPTION 'Signed owner-input work_record required';
  END IF;
  e := o.structured_data->'facility_reservation';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'facility_reservation version 1 envelope required'; END IF;
  ev := e->>'event_type';
  IF ev = 'request' THEN
    IF o.is_superseded IS DISTINCT FROM false THEN RAISE EXCEPTION 'Current request source required'; END IF;
    IF public.facility_reservation_requester_role((e->>'work_order_id')::uuid, o.submitted_by_user_id) IS DISTINCT FROM e->>'requester_role' THEN
      RAISE EXCEPTION 'Requester is not the customer or an accepted provider of this work order';
    END IF;
    INSERT INTO public.facility_reservations(id, work_order_id, asset_id, organization_id, requirement_id, requested_by_user_id, requester_role,
      window_from, window_until, terms, reservation_hash, requested_at)
    VALUES (o.id, (e->>'work_order_id')::uuid, (e->>'asset_id')::uuid, (e->>'organization_id')::uuid, (e->>'requirement_id')::uuid,
      o.submitted_by_user_id, e->>'requester_role', (e->>'from')::timestamptz, (e->>'until')::timestamptz,
      public.facility_reservation_terms_normalize(e->'terms'),
      encode(sha256(convert_to(jsonb_build_array('facility_reservation', o.id, e->'work_order_id', e->'asset_id', e->'organization_id',
        (e->>'from')::timestamptz, (e->>'until')::timestamptz, public.facility_reservation_terms_normalize(e->'terms'), o.submitted_by_user_id,
        o.observed_at)::text, 'UTF8')), 'hex'), o.observed_at)
    ON CONFLICT (id) DO NOTHING;
  ELSIF ev = 'confirmation' THEN
    SELECT * INTO r FROM public.facility_reservations WHERE id = (e->>'reservation_id')::uuid;
    IF r.id IS NULL OR r.reservation_hash IS DISTINCT FROM e->>'reservation_hash' THEN RAISE EXCEPTION 'Reservation and hash must match'; END IF;
    IF public.facility_reservation_state(r.id) <> 'requested' THEN RAISE EXCEPTION 'Only a current, unexpired request can be confirmed'; END IF;
    IF public.organization_facility_role(o.submitted_by_user_id, r.organization_id) IS DISTINCT FROM e->>'signer_role' THEN
      RAISE EXCEPTION 'Signer is not an active owner or member of the facility organization';
    END IF;
    INSERT INTO public.facility_reservation_confirmations(id, reservation_id, reservation_hash, signer_user_id, signer_role, offer_id, confirmed_at)
    VALUES (o.id, r.id, r.reservation_hash, o.submitted_by_user_id, e->>'signer_role', (e->>'offer_id')::uuid, o.observed_at);
    INSERT INTO public.facility_asset_occupancy(reservation_id, asset_id, slot, occupied)
    VALUES (r.id, r.asset_id, 1, tstzrange(r.window_from, r.window_until, '[)'));
  ELSIF ev = 'cancellation' THEN
    SELECT * INTO r FROM public.facility_reservations WHERE id = (e->>'reservation_id')::uuid;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Reservation unavailable'; END IF;
    INSERT INTO public.facility_reservation_cancellations(id, reservation_id, signer_user_id, signer_role, cancelled_at)
    VALUES (o.id, r.id, o.submitted_by_user_id, e->>'signer_role', o.observed_at) ON CONFLICT (reservation_id) DO NOTHING;
    UPDATE public.facility_asset_occupancy SET released_at = o.observed_at WHERE reservation_id = r.id AND released_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown facility_reservation event type';
  END IF;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN jsonb_build_object('id', o.id, 'event_type', ev);
END $$;

CREATE FUNCTION public.facility_reservation_insert_source(p_vehicle_id uuid, p_identifier text, p_key text, p_text text, p_envelope jsonb,
  p_signer uuid, p_method text, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE src uuid; obs_id uuid;
BEGIN
  SELECT id INTO src FROM public.observation_sources WHERE slug = 'owner-input';
  IF src IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
    confidence, confidence_score)
  VALUES (p_vehicle_id, src, p_identifier, p_at, 'event_time', p_at, 'exact', 'work_record', p_text, p_key,
    jsonb_build_object('facility_reservation', p_envelope), p_signer, jsonb_build_object('user_id', p_signer, 'intake_actor', 'account'), p_method, 'high', 0.95)
  RETURNING id INTO obs_id;
  RETURN obs_id;
END $$;

CREATE FUNCTION public.reserve_facility(p_work_order_id uuid, p_asset_id uuid, p_from timestamptz, p_until timestamptz, p_terms jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  a public.equipment%ROWTYPE;
  role text;
  terms jsonb;
  req uuid;
  request_key text;
  obs_id uuid;
  r public.facility_reservations%ROWTYPE;
  dup boolean := false;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  role := public.facility_reservation_requester_role(p_work_order_id, signer);
  IF w.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Only the customer or an accepted provider reserves a facility for this job' USING ERRCODE = '42501'; END IF;
  IF w.vehicle_id IS NULL OR w.status IN ('completed','paid','cancelled','rejected') THEN
    RAISE EXCEPTION 'Facility reservations need an open, vehicle-bound work order' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO a FROM public.equipment WHERE id = p_asset_id AND source = 'member_declaration' AND status = 'in_service' AND shop_id IS NOT NULL;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Asset is not a declared, in-service facility asset' USING ERRCODE = '23514'; END IF;
  IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until) OR p_from >= p_until OR p_until <= signed
    OR p_until - p_from > interval '31 days' THEN
    RAISE EXCEPTION 'Window must be future, from before until, at most 31 days' USING ERRCODE = '23514';
  END IF;
  terms := public.facility_reservation_terms_normalize(p_terms);
  SELECT rq.id INTO req FROM public.work_order_resource_requirements rq JOIN public.vehicle_observations s ON s.id = rq.id
    WHERE rq.work_order_id = w.id AND rq.requirement_kind = 'facility' AND s.is_superseded IS FALSE ORDER BY s.observed_at, rq.id LIMIT 1;
  PERFORM pg_advisory_xact_lock(hashtextextended('facility_reservation:' || a.id::text, 0));
  request_key := md5(jsonb_build_array('facility-reservation', signer, w.id, a.id, p_from, p_until, terms)::text);
  SELECT x.* INTO r FROM public.facility_reservations x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_identifier = 'facility_reservation:' || a.id::text AND o.content_hash = request_key AND o.is_superseded IS FALSE
      AND public.facility_reservation_state(x.id) = 'requested';
  IF r.id IS NOT NULL THEN
    dup := true;
  ELSE
    obs_id := public.facility_reservation_insert_source(w.vehicle_id, 'facility_reservation:' || a.id::text, request_key,
      format('Facility reservation requested for work order %s: %s "%s" from %s to %s.', w.id, a.asset_kind, a.name, p_from, p_until),
      jsonb_build_object('version', 1, 'event_type', 'request', 'work_order_id', w.id, 'asset_id', a.id, 'organization_id', a.shop_id,
        'requirement_id', req, 'from', p_from, 'until', p_until, 'terms', terms, 'requester_role', role, 'signer_user_id', signer),
      signer, 'facility_reservation_request_sign_v1', signed);
    PERFORM public.project_facility_reservation_event(obs_id);
    SELECT * INTO r FROM public.facility_reservations WHERE id = obs_id;
  END IF;
  RETURN jsonb_build_object('reservation_id', r.id, 'reservation_hash', r.reservation_hash, 'work_order_id', w.id, 'asset_id', a.id,
    'organization_id', a.shop_id, 'requirement_id', r.requirement_id, 'window', jsonb_build_object('from', r.window_from, 'until', r.window_until),
    'terms', r.terms, 'requester_role', r.requester_role, 'state', public.facility_reservation_state(r.id),
    'capacity_free_now', EXISTS (SELECT 1 FROM generate_series(1, a.capacity) s WHERE NOT EXISTS (SELECT 1 FROM public.facility_asset_occupancy oc
      WHERE oc.asset_id = a.id AND oc.slot = s AND oc.released_at IS NULL AND oc.occupied && tstzrange(r.window_from, r.window_until, '[)'))),
    'duplicate', dup, 'payment_authorized', false);
END $$;

CREATE FUNCTION public.confirm_facility_reservation(p_reservation_id uuid, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  r public.facility_reservations%ROWTYPE;
  a public.equipment%ROWTYPE;
  w public.work_orders%ROWTYPE;
  role text;
  offer jsonb;
  offer_note jsonb;
  qty numeric;
  obs_id uuid;
  c public.facility_reservation_confirmations%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.facility_reservations WHERE id = p_reservation_id;
  role := public.organization_facility_role(signer, r.organization_id);
  IF r.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Only active owners or members of the facility organization confirm its reservations' USING ERRCODE = '42501'; END IF;
  IF p_hash IS DISTINCT FROM r.reservation_hash THEN RAISE EXCEPTION 'Reservation hash does not match this request' USING ERRCODE = '23514'; END IF;
  SELECT * INTO c FROM public.facility_reservation_confirmations WHERE reservation_id = r.id;
  IF c.id IS NOT NULL THEN
    RETURN jsonb_build_object('confirmation_id', c.id, 'reservation_id', r.id, 'state', public.facility_reservation_state(r.id),
      'slot', (SELECT slot FROM public.facility_asset_occupancy WHERE reservation_id = r.id), 'facility_offer_id', c.offer_id, 'duplicate', true,
      'payment_authorized', false);
  END IF;
  IF public.facility_reservation_state(r.id) <> 'requested' THEN RAISE EXCEPTION 'Only a current, unexpired request can be confirmed' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM public.equipment WHERE id = r.asset_id;
  SELECT * INTO w FROM public.work_orders WHERE id = r.work_order_id;
  IF role = 'organization_owner' AND r.requirement_id IS NOT NULL THEN
    qty := CASE r.terms->>'basis' WHEN 'hourly' THEN ceil(extract(epoch FROM r.window_until - r.window_from) / 3600)
      WHEN 'day_rate' THEN ceil(extract(epoch FROM r.window_until - r.window_from) / 86400) END;
    BEGIN
      offer := public.offer_on_requirement(r.requirement_id, jsonb_build_object('organization_id', r.organization_id,
          'lines', CASE WHEN r.terms IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
            'description', format('Facility: %s (%s)', a.name, a.asset_kind), 'pricing_basis', r.terms->>'basis',
            'amount', (r.terms->>'amount')::numeric, 'currency', r.terms->>'currency',
            'unit', CASE r.terms->>'basis' WHEN 'hourly' THEN 'hour' WHEN 'day_rate' THEN 'day' END, 'quantity', qty)) END),
        r.window_from, r.window_until, NULL);
    EXCEPTION WHEN OTHERS THEN
      offer := NULL; offer_note := jsonb_build_object('state', 'not_created', 'reason', SQLERRM);
    END;
  ELSE
    offer_note := jsonb_build_object('state', 'not_created', 'reason', CASE WHEN r.requirement_id IS NULL THEN 'job_has_no_facility_requirement'
      ELSE 'facility offers are organization owner Signs' END);
  END IF;
  obs_id := public.facility_reservation_insert_source(w.vehicle_id, 'facility_reservation_confirmation:' || r.id::text,
    md5('facility-reservation-confirmation:' || signer::text || ':' || r.id::text || ':' || signed::text),
    format('Facility organization confirmed reservation %s (hash %s).', r.id, r.reservation_hash),
    jsonb_build_object('version', 1, 'event_type', 'confirmation', 'work_order_id', r.work_order_id, 'reservation_id', r.id,
      'reservation_hash', r.reservation_hash, 'signer_role', role, 'offer_id', offer->'offer_id', 'signer_user_id', signer),
    signer, 'facility_reservation_confirmation_sign_v1', signed);
  PERFORM public.project_facility_reservation_event(obs_id);
  RETURN jsonb_build_object('confirmation_id', obs_id, 'reservation_id', r.id, 'state', 'confirmed', 'signer_role', role,
    'slot', (SELECT slot FROM public.facility_asset_occupancy WHERE reservation_id = r.id), 'capacity', a.capacity,
    'facility_offer', COALESCE(CASE WHEN offer IS NOT NULL THEN jsonb_build_object('state', 'offered', 'offer_id', offer->'offer_id',
      'offer_hash', offer->'offer_hash', 'requirement_id', r.requirement_id) END, offer_note),
    'duplicate', false, 'payment_authorized', false);
END $$;

CREATE FUNCTION public.cancel_facility_reservation(p_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  r public.facility_reservations%ROWTYPE;
  w public.work_orders%ROWTYPE;
  role text;
  obs_id uuid;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.facility_reservations WHERE id = p_reservation_id;
  role := CASE WHEN r.requested_by_user_id = signer THEN r.requester_role ELSE public.organization_facility_role(signer, r.organization_id) END;
  IF r.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Only the requester or the facility organization cancels this reservation' USING ERRCODE = '42501'; END IF;
  IF public.facility_reservation_state(r.id) = 'cancelled' THEN
    RETURN jsonb_build_object('reservation_id', r.id, 'state', 'cancelled', 'duplicate', true);
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = r.work_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('facility_reservation:' || r.asset_id::text, 0));
  obs_id := public.facility_reservation_insert_source(w.vehicle_id, 'facility_reservation_cancellation:' || r.id::text,
    md5('facility-reservation-cancellation:' || signer::text || ':' || r.id::text || ':' || signed::text),
    format('Facility reservation %s cancelled.', r.id),
    jsonb_build_object('version', 1, 'event_type', 'cancellation', 'work_order_id', r.work_order_id, 'reservation_id', r.id,
      'signer_role', role, 'signer_user_id', signer), signer, 'facility_reservation_cancellation_sign_v1', signed);
  PERFORM public.project_facility_reservation_event(obs_id);
  UPDATE public.vehicle_observations SET is_superseded = true, superseded_by = obs_id, superseded_at = signed WHERE id = r.id AND is_superseded IS FALSE;
  RETURN jsonb_build_object('reservation_id', r.id, 'state', 'cancelled', 'cancellation_id', obs_id, 'signer_role', role,
    'slot_released', EXISTS (SELECT 1 FROM public.facility_asset_occupancy WHERE reservation_id = r.id AND released_at IS NOT NULL), 'duplicate', false);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['facility_reservation_terms_normalize(jsonb)','facility_reservation_state(uuid)','facility_reservation_requester_role(uuid,uuid)',
      'project_facility_reservation_event(uuid)','facility_reservation_insert_source(uuid,text,text,text,jsonb,uuid,text,timestamptz)',
      'facility_asset_occupancy_assign()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['reserve_facility(uuid,uuid,timestamptz,timestamptz,jsonb)','confirm_facility_reservation(uuid,text)',
      'cancel_facility_reservation(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.reserve_facility(uuid,uuid,timestamptz,timestamptz,jsonb) IS 'Sign: the work order customer or an accepted provider requests a declared facility asset for a future window with optional open terms. Does not occupy capacity until confirmed.';
COMMENT ON FUNCTION public.confirm_facility_reservation(uuid,text) IS 'Sign: a facility owner or member confirms an exact request (hash); occupies one capacity slot (refused when fully booked). An owner''s confirmation also records the organization''s facility offer on the job''s facility requirement.';
COMMENT ON FUNCTION public.cancel_facility_reservation(uuid) IS 'Sign: the requester or the facility organization cancels; supersedes the request and releases the slot.';

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, 'id', 'project_facility_reservation_event', 'Facility reservation Sign projection; written only by its Sign RPC in the same transaction.', true, v
FROM (VALUES ('facility_reservations', 'reserve_facility(uuid,uuid,timestamptz,timestamptz,jsonb)'),
  ('facility_reservation_confirmations', 'confirm_facility_reservation(uuid,text)'),
  ('facility_reservation_cancellations', 'cancel_facility_reservation(uuid)')) x(t, v)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = x.t AND r.column_name = 'id');
NOTIFY pgrst, 'reload schema';
COMMIT;
