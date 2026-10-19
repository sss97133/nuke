-- The seller's inspection-access step on the job (owner, 2026-10-19: "need the whole process in ios").
-- my_signature_queue already sends the vehicle's verified owner an inspection_access_request whose Sign is
-- grant_inspection_access, and points them at the job; the job's inspection reader offered only the inspector's
-- record_findings, so there was nothing to sign there. work_order_inspection_read now also offers the verified
-- owner grant_inspection_access for each inspection on the job that has an accepted inspector and no current
-- permission (not_established or expired). Eligibility stays the Sign's: the reader only lists it.
-- Contract: supabase/sql/test_work_order_inspection_seller_actions.sql (PG17); composition: test_job_loop_replay.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.inspection_seller_actions(p_user uuid, p_work_order_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('action', 'grant_inspection_access', 'kind', 'grant_inspection_access',
      'stage', 'inspection', 'rpc', 'grant_inspection_access',
      'args', jsonb_build_object('p_inspection_work_order_id', x.id),
      'permission_state', public.inspection_seller_permission(x.id, true)->>'state',
      'binds', jsonb_build_array('your permission, as the verified owner, for the accepted inspector to inspect this vehicle within the scope you state'),
      'does_not_bind', jsonb_build_array('access to your account or records', 'payment', 'the sale of the vehicle'))
    ORDER BY x.created_at, x.id), '[]'::jsonb)
  FROM public.work_orders x
  WHERE p_user IS NOT NULL AND x.scope_category = 'inspection'
    AND (x.id = p_work_order_id OR x.parent_work_order_id = p_work_order_id)
    AND public.vehicle_verified_owner(p_user, x.vehicle_id)
    AND EXISTS (SELECT 1 FROM public.work_order_accepted_providers(x.id) ap WHERE ap.role = 'inspector')
    AND public.inspection_seller_permission(x.id, true)->>'state' IN ('not_established', 'expired')
$$;
REVOKE ALL ON FUNCTION public.inspection_seller_actions(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspection_seller_actions(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.inspection_seller_actions(uuid,uuid) IS 'grant_inspection_access actions for the vehicle''s verified owner on inspections of this job that have an accepted inspector and no current permission; listed in work_order_inspection_read viewer.actions.';

DO $edit$
DECLARE
  rd text := pg_get_functiondef('public.work_order_inspection_read(uuid)'::regprocedure);
  a1 text := $a$        ELSE '[]'::jsonb END),$a$;
BEGIN
  IF (length(rd)-length(replace(rd,a1,'')))/length(a1) <> 1 THEN
    RAISE EXCEPTION 'inspection reader anchor not found exactly once';
  END IF;
  EXECUTE replace(rd, a1, $r$        ELSE public.inspection_seller_actions(viewer, w.id) END),$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
