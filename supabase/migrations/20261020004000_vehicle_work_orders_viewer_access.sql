-- vehicle_work_orders_read tells the viewer their access to the vehicle (iOS: "Post a job" was shown only to owners).
--   viewer.vehicle_access: {role: owner|co_owner|uploader|access_holder|none, can_post_work_request, can_request_inspection,
--     post_work_request_reason, request_inspection_reason} where the booleans are exactly the eligibility checks of
--     post_work_request (vehicle not merged; the viewer is its user, owner or uploader, or vehicle_user_has_access) and
--     request_inspection (vehicle not merged; public, or one of those same relations). Anonymous viewers: role none, both
--     false, reason sign_in.
--   viewer.actions: post_work_request / request_inspection with argument hints when allowed.
-- One anchored edit in the live definition (the viewer block).
-- Contract: supabase/sql/test_vehicle_work_orders_viewer_access.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.vehicle_viewer_work_access(p_user uuid, p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v public.vehicles%ROWTYPE;
  perm text;
  role text;
  related boolean;
  can_post boolean;
  can_inspect boolean;
  actions jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE id = p_vehicle_id;
  IF p_user IS NULL OR v.id IS NULL THEN
    RETURN jsonb_build_object('vehicle_access', jsonb_build_object('role', 'none', 'can_post_work_request', false, 'can_request_inspection', false,
      'post_work_request_reason', 'sign_in', 'request_inspection_reason', 'sign_in'), 'actions', '[]'::jsonb);
  END IF;
  IF to_regclass('public.vehicle_user_permissions') IS NOT NULL THEN
    EXECUTE 'SELECT max(CASE vup.role WHEN ''owner'' THEN ''owner'' WHEN ''co_owner'' THEN ''co_owner'' END) FROM public.vehicle_user_permissions vup
      WHERE vup.vehicle_id = $1 AND vup.user_id = $2 AND COALESCE(vup.is_active, true) AND vup.role IN (''owner'', ''co_owner'')'
      INTO perm USING v.id, p_user;
  END IF;
  role := CASE WHEN v.owner_id = p_user OR v.user_id = p_user OR perm = 'owner' THEN 'owner'
    WHEN perm = 'co_owner' THEN 'co_owner'
    WHEN v.uploaded_by = p_user THEN 'uploader'
    WHEN public.vehicle_user_has_access(v.id, p_user) THEN 'access_holder'
    ELSE 'none' END;
  related := (v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user OR public.vehicle_user_has_access(v.id, p_user)) IS TRUE;
  can_post := v.merged_into_vehicle_id IS NULL AND related;
  can_inspect := v.merged_into_vehicle_id IS NULL AND (v.is_public IS TRUE OR related);
  IF can_post THEN
    actions := actions || jsonb_build_array(jsonb_build_object('action', 'post_work_request', 'rpc', 'post_work_request',
      'args', jsonb_build_object('p_vehicle_id', v.id, 'p_description', NULL, 'p_image_ids', NULL, 'p_requested_operations', NULL,
        'p_needed_by', NULL, 'p_visibility', 'open')));
  END IF;
  IF can_inspect THEN
    actions := actions || jsonb_build_array(jsonb_build_object('action', 'request_inspection', 'rpc', 'request_inspection',
      'args', jsonb_build_object('p_vehicle_id', v.id, 'p_parent_work_order_id', NULL, 'p_scope', jsonb_build_object('inspection_type', 'pre_purchase'))));
  END IF;
  RETURN jsonb_build_object('vehicle_access', jsonb_build_object('role', role, 'can_post_work_request', can_post, 'can_request_inspection', can_inspect,
      'post_work_request_reason', CASE WHEN can_post THEN NULL WHEN v.merged_into_vehicle_id IS NOT NULL THEN 'vehicle_merged' ELSE 'not_your_vehicle' END,
      'request_inspection_reason', CASE WHEN can_inspect THEN NULL WHEN v.merged_into_vehicle_id IS NOT NULL THEN 'vehicle_merged' ELSE 'vehicle_private' END),
    'actions', actions);
END $$;
REVOKE ALL ON FUNCTION public.vehicle_viewer_work_access(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_work_access(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.vehicle_viewer_work_access(uuid,uuid) IS 'Viewer''s relation to a vehicle and whether post_work_request / request_inspection would accept them (same predicates), with action hints.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.vehicle_work_orders_read(uuid,uuid,integer)'::regprocedure);
  a1 constant text := $a$public.viewer_identity_bridge(uid), false) || jsonb_build_object('money_visible_basis', 'per row'),$a$;
BEGIN
  IF position('vehicle_viewer_work_access' IN def) > 0 THEN RAISE EXCEPTION 'vehicle_work_orders_read already carries vehicle_access'; END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'vehicle_work_orders_read viewer anchor not found once'; END IF;
  EXECUTE replace(def, a1, $r$public.viewer_identity_bridge(uid), false) || jsonb_build_object('money_visible_basis', 'per row')
      || public.vehicle_viewer_work_access(uid, v.id),$r$);
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
