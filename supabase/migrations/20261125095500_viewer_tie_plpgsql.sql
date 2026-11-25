-- vehicle_viewer_tie_plpgsql_v1: the tie test runs in plpgsql, so its plans are cached instead of rebuilt on every call.
--
-- WHY. Measured live 2026-11-25: service_records_tied_read (20261125081000) evaluates vehicle_viewer_tied once per row,
-- and a signed-in read of service_records (242 rows) took 7.0 s for count(id) and 9.1 s for count(cost), near the 15 s
-- authenticated limit. Each call re-plans the nested SQL function vehicle_user_has_access (SECURITY DEFINER with a SET
-- clause, so never inlined; 6 EXISTS branches): about 14 ms a call. Called directly at top level the same function costs
-- 0.3 ms, because one query keeps its plan. In plpgsql both keep their plans for the session. Measured with temporary
-- copies (pg_temp, rolled back), 50 calls as a signed-in stranger: live 0.72 s; plpgsql access 0.10 s; both plpgsql
-- 0.009 s.
-- The same two functions sit behind vehicles_private_select, work_orders_select_scoped, generated_invoices_party_read,
-- image_descriptions_select and service_records_tied_read, and 49 functions call vehicle_user_has_access.
--
-- WHAT CHANGES. Language only. Each body is the live SQL text, unchanged, inside BEGIN RETURN (...); END. Same
-- arguments, STABLE, SECURITY DEFINER, search_path, grants and comments (CREATE OR REPLACE keeps grants and comments).
-- The guard (same DO block as the definitions, so it is atomic) refuses to run unless each live body is the reviewed one (sha256 of prosrc read 2026-11-25) or already this
-- version, so a later rewrite is never overwritten.
--
-- REVERT. supabase/sql/revert_20261125095500_viewer_tie_plpgsql.sql restores both SQL bodies.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.proname, encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') AS h, p.prosrc
             FROM pg_proc p
            WHERE p.oid IN (to_regprocedure('public.vehicle_user_has_access(uuid,uuid)'), to_regprocedure('public.vehicle_viewer_tied(uuid)'))
  LOOP
    CONTINUE WHEN position('vehicle_viewer_tie_plpgsql_v1' IN r.prosrc) > 0;
    IF NOT ((r.proname = 'vehicle_user_has_access' AND r.h = 'kAl3Z/lUqX+Vjwpuv8vaoTQsEAK57PqOpTY4sIlA7zA=')
         OR (r.proname = 'vehicle_viewer_tied' AND r.h = 'UR/casVEciEsicVxkOmKeRUSNPHvrfgra8b6a4ReQiw=')) THEN
      RAISE EXCEPTION '% differs from the body read 2026-11-25 (%); not changing it', r.proname, r.h;
    END IF;
  END LOOP;
  -- The guard and both definitions run in one statement: a refused body changes nothing.
  EXECUTE $ddl1$CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
);
END
$function$;$ddl1$;
  EXECUTE $ddl2$CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
);
END
$function$;$ddl2$;
END $guard$;
