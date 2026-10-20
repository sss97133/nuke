-- A job's publication state as a reader, with publish / unpublish offered as viewer actions.
--
-- publish_work_order / unpublish_work_order (20261020081000) shipped as Signs only: no reader stated a job's visibility or
-- offered the Signs, so clients could neither show "Open / Invite only / Not published" nor render the steps from a
-- server-supplied action list. This adds, without changing any existing function:
--   work_order_publication_state(p_user, p_work_order_id) (internal): visibility ('open' | 'invite_only' | 'not_published'),
--     the latest publication Sign's action and clock (no signer id), the job's current requirement count, whether it is
--     listed in open_requirements_read now (open + requirements + public vehicle), and viewer.actions for the publication
--     party (work_order_publication_party: the customer or a person with access to the vehicle) on an open, non-inspection
--     job: publish 'open' unless already open (carrying refused_reason when the title or description holds names or contact
--     details, the same check publish_work_order makes), publish 'invite_only' while not published, unpublish while open.
--     Each action states what it binds and does not bind.
--   work_order_publication_read(p_work_order_id) (anon + authenticated): the job path's access rule (a slot, or an open
--     vehicle).
--   vehicle_work_publication_read(p_vehicle_id) (anon + authenticated): the same state for each job on the vehicle,
--     with vehicle_work_orders_read's access rule.
-- No writes, money, contact fields or people ids. Contract: supabase/sql/test_work_order_publication_read.sql (PG17, on
-- the publish_work_order chain).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.work_order_publication_state(p_user uuid, p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  w public.work_orders%ROWTYPE;
  vis text;
  party boolean;
  personal boolean;
  last_at timestamptz;
  last_action text;
  reqs integer;
  acts jsonb := '[]'::jsonb;
  open_job boolean;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  vis := COALESCE(w.request_visibility, 'not_published');
  party := public.work_order_publication_party(w.id, p_user);
  SELECT o.observed_at, o.structured_data#>>'{work_order_publication,action}' INTO last_at, last_action
    FROM public.vehicle_observations o
    WHERE o.source_identifier = 'work_order_publication:' || w.id::text AND o.extraction_method = 'work_order_publication_sign_v1'
      AND o.is_superseded IS FALSE
    ORDER BY o.observed_at DESC, o.id DESC LIMIT 1;
  SELECT count(*) INTO reqs FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id = r.id
    WHERE r.work_order_id = w.id AND s.is_superseded IS FALSE;
  open_job := COALESCE(w.status, 'pending') NOT IN ('completed', 'paid', 'cancelled', 'rejected') AND COALESCE(w.scope_category, '') <> 'inspection';
  IF party AND open_job THEN
    personal := public.work_order_publication_text_is_personal(w.id, concat_ws(' ', w.title, w.description, w.scope_description));
    IF vis <> 'open' THEN
      acts := acts || jsonb_build_array(jsonb_build_object('action', 'publish_work_order', 'rpc', 'publish_work_order',
        'args', jsonb_build_object('p_work_order_id', w.id, 'p_visibility', 'open'), 'visibility', 'open',
        'refused_reason', CASE WHEN personal THEN 'Remove names and contact details from the job title and description before opening it; contact goes through Nuke' END,
        'binds', jsonb_build_array('your statement that this job is open: technicians near you can see its needs and offer',
          'operations quoting your own description when the job has none, and requirements from the reviewed template'),
        'does_not_bind', jsonb_build_array('a price', 'a provider', 'a schedule', 'payment', 'your contact details (contact goes through Nuke)')));
    END IF;
    IF vis = 'not_published' THEN
      acts := acts || jsonb_build_array(jsonb_build_object('action', 'publish_work_order', 'rpc', 'publish_work_order',
        'args', jsonb_build_object('p_work_order_id', w.id, 'p_visibility', 'invite_only'), 'visibility', 'invite_only',
        'binds', jsonb_build_array('your statement that this job is published invite only: its needs are recorded but not listed'),
        'does_not_bind', jsonb_build_array('a price', 'a provider', 'a schedule', 'payment')));
    END IF;
    IF vis = 'open' THEN
      acts := acts || jsonb_build_array(jsonb_build_object('action', 'unpublish_work_order', 'rpc', 'unpublish_work_order',
        'args', jsonb_build_object('p_work_order_id', w.id), 'visibility', 'invite_only',
        'binds', jsonb_build_array('your statement that this job is no longer listed; it becomes invite only'),
        'does_not_bind', jsonb_build_array('withdrawing offers already made', 'deleting its needs (they stay on record)', 'payment')));
    END IF;
  END IF;
  RETURN jsonb_build_object('work_order_id', w.id, 'visibility', vis,
    'last_sign', CASE WHEN last_at IS NOT NULL THEN jsonb_build_object('action', last_action, 'signed_at', last_at) END,
    'requirements', reqs,
    'listed_in_open_requirements', vis = 'open' AND reqs > 0 AND public.work_order_vehicle_open(w.vehicle_id),
    'viewer', jsonb_build_object('party', party, 'actions', acts,
      'actions_basis', 'publish and unpublish for the customer or a person with access to the vehicle, on an open, non-inspection job'));
END $function$;

REVOKE ALL ON FUNCTION public.work_order_publication_state(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.work_order_publication_read(p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  my_slots text[];
  vid uuid;
BEGIN
  SELECT s.slots, s.vehicle_id INTO my_slots, vid FROM public.work_order_viewer_slots(uid, p_work_order_id) s;
  IF NOT FOUND OR (cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(vid)) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN public.work_order_publication_state(uid, p_work_order_id) || jsonb_build_object('as_of', statement_timestamp());
END $function$;

CREATE OR REPLACE FUNCTION public.vehicle_work_publication_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v public.vehicles%ROWTYPE;
  vehicle_open boolean;
  rows_out jsonb;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
  vehicle_open := v.is_public IS TRUE OR (uid IS NOT NULL AND (v.user_id = uid OR v.owner_id = uid OR v.uploaded_by = uid
    OR public.vehicle_user_has_access(v.id, uid)
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active)));
  SELECT COALESCE(jsonb_agg(public.work_order_publication_state(uid, s.work_order_id) ORDER BY s.work_order_id), '[]'::jsonb) INTO rows_out
    FROM (SELECT x.work_order_id FROM public.work_order_viewer_slots(uid, NULL, p_vehicle_id) x
      WHERE vehicle_open OR cardinality(x.slots) > 0 ORDER BY x.work_order_id LIMIT 100) s;
  IF NOT vehicle_open AND jsonb_array_length(rows_out) = 0 THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
  RETURN jsonb_build_object('vehicle_id', v.id, 'as_of', statement_timestamp(), 'rows', rows_out,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'limit', 100, 'population', 'work orders on this vehicle visible to you'));
END $function$;

REVOKE ALL ON FUNCTION public.work_order_publication_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_work_publication_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_publication_read(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_work_publication_read(uuid) TO anon, authenticated;

COMMIT;
