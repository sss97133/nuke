-- Facility reservations on a job (iOS lane gaps).
--
--   work_order_facility_reservations_read(p_work_order_id): open (anon and authenticated) on the same access rule as the
--     other job readers (slot holders, or a public vehicle). Job parties (customer, organization owner, performer), the
--     reservation's requester and members of the facility organization see every request and confirmation: asset
--     (kind, label, capacity), shop by name, window, state requested|confirmed|completed_window|expired|cancelled, requester
--     role and handle, open terms, clocks and slot. Everyone else sees confirmed busy windows only (asset kind/label, shop,
--     window, state); no ids, requester or terms.
--   work_order_facility_actions(user, work_order): reserve_facility for the work order's customer or a current accepted
--     provider on an open, vehicle-bound job, with the job's facility requirement id and the reachable facilities (the job's
--     shop and proposed facility organizations) as hints; cancel_facility_reservation for the requester's own live requests.
--   work_order_job_path_read viewer.actions gains these actions (one anchored insertion), so the app offers "Book a bay"
--   only to those who can sign it.
-- Contract: supabase/sql/test_job_facility_reservations_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_facility_actions(p_user uuid, p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  role text;
  req uuid;
  actions jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF p_user IS NULL OR w.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  role := public.facility_reservation_requester_role(w.id, p_user);
  IF role IS NOT NULL AND w.vehicle_id IS NOT NULL AND COALESCE(w.status, 'pending') NOT IN ('completed','paid','cancelled','rejected') THEN
    SELECT rq.id INTO req FROM public.work_order_resource_requirements rq JOIN public.vehicle_observations s ON s.id = rq.id
      WHERE rq.work_order_id = w.id AND rq.requirement_kind = 'facility' AND s.is_superseded IS FALSE ORDER BY s.observed_at, rq.id LIMIT 1;
    actions := actions || jsonb_build_array(jsonb_build_object('action', 'reserve_facility', 'rpc', 'reserve_facility', 'as', role,
      'args', jsonb_build_object('p_work_order_id', w.id, 'p_asset_id', NULL, 'p_from', NULL, 'p_until', NULL, 'p_terms', NULL),
      'facility_requirement_id', req,
      'facilities', (SELECT COALESCE(jsonb_agg(public.platform_organization_label(x.org) || jsonb_build_object('organization_id', x.org) ORDER BY x.org), '[]'::jsonb)
        FROM (SELECT w.organization_id AS org WHERE w.organization_id IS NOT NULL
          UNION SELECT f.facility_organization_id FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
            WHERE f.work_order_id = w.id AND f.facility_organization_id IS NOT NULL AND s.is_superseded IS FALSE) x),
      'assets_from', 'facility_read(organization_id): declared assets with busy windows',
      'binds', jsonb_build_array('a request for one declared asset for the window; it occupies capacity only when the facility confirms'),
      'does_not_bind', jsonb_build_array('payment', 'vehicle access', 'the facility''s confirmation')));
  END IF;
  SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'cancel_facility_reservation', 'rpc', 'cancel_facility_reservation',
      'args', jsonb_build_object('p_reservation_id', r.id)) ORDER BY r.window_from, r.id), '[]'::jsonb)
    INTO actions FROM public.facility_reservations r
    WHERE r.work_order_id = w.id AND r.requested_by_user_id = p_user AND public.facility_reservation_state(r.id) IN ('requested','confirmed');
  RETURN actions;
END $$;
REVOKE ALL ON FUNCTION public.work_order_facility_actions(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_facility_actions(uuid,uuid) TO service_role;

CREATE FUNCTION public.work_order_facility_reservations_read(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  items jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots);
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.window_from, x.id), '[]'::jsonb) INTO items FROM (
    SELECT r.id, r.window_from,
      CASE WHEN party OR r.requested_by_user_id = viewer OR public.organization_facility_role(viewer, r.organization_id) IS NOT NULL THEN
        jsonb_build_object('reservation_id', r.id, 'asset', jsonb_build_object('asset_id', e.id, 'kind', e.asset_kind, 'label', e.name, 'capacity', e.capacity),
          'shop', public.platform_organization_label(r.organization_id), 'window', jsonb_build_object('from', r.window_from, 'until', r.window_until),
          'state', st.state, 'requester_role', r.requester_role, 'requested_by', public.platform_person_label(r.requested_by_user_id),
          'terms', r.terms, 'requested_at', r.requested_at,
          'confirmed_at', (SELECT c.confirmed_at FROM public.facility_reservation_confirmations c WHERE c.reservation_id = r.id),
          'cancelled_at', (SELECT c.cancelled_at FROM public.facility_reservation_cancellations c WHERE c.reservation_id = r.id),
          'slot', (SELECT oc.slot FROM public.facility_asset_occupancy oc WHERE oc.reservation_id = r.id AND oc.released_at IS NULL),
          'visibility', 'party')
      ELSE jsonb_build_object('asset', jsonb_build_object('kind', e.asset_kind, 'label', e.name), 'shop', public.platform_organization_label(r.organization_id),
          'window', jsonb_build_object('from', r.window_from, 'until', r.window_until), 'state', st.state, 'visibility', 'busy_window_only') END AS item
    FROM public.facility_reservations r JOIN public.equipment e ON e.id = r.asset_id
    CROSS JOIN LATERAL (SELECT public.facility_reservation_state(r.id) AS state) st
    WHERE r.work_order_id = w.id
      AND (party OR r.requested_by_user_id = viewer OR public.organization_facility_role(viewer, r.organization_id) IS NOT NULL
        OR st.state IN ('confirmed','completed_window'))) x;
  RETURN jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(), 'reservations', items,
    'viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', public.work_order_facility_actions(viewer, w.id)),
    'coverage', jsonb_build_object('reservations', jsonb_array_length(items),
      'visibility', 'parties, the requester and facility members see every request with terms; others see confirmed busy windows only'),
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.work_order_facility_reservations_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_facility_reservations_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_facility_reservations_read(uuid) IS 'Open reader of a job''s facility reservation requests and confirmations: asset, shop, window, state; requester and terms to parties, the requester and facility members; confirmed busy windows only for others. viewer.actions reserve_facility / cancel_facility_reservation.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.work_order_job_path_read(uuid)'::regprocedure);
  a1 constant text := $a$jsonb_build_object('actions', public.work_order_job_actions(uid, p_work_order_id),$a$;
  a2 constant text := $a$'actions_basis', 'Signs this viewer can take from the job view (start_work for a current accepted provider who has not started)'),$a$;
  a text;
BEGIN
  IF position('work_order_facility_actions' IN def) > 0 THEN RAISE EXCEPTION 'job path read already carries facility actions'; END IF;
  FOREACH a IN ARRAY ARRAY[a1, a2] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'work_order_job_path_read anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$jsonb_build_object('actions', public.work_order_job_actions(uid, p_work_order_id) || public.work_order_facility_actions(uid, p_work_order_id),$r$);
  def := replace(def, a2, $r$'actions_basis', 'Signs this viewer can take from the job view (start_work for a current accepted provider who has not started; reserve_facility for the customer or a current accepted provider; cancel_facility_reservation for your own requests)'),$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
