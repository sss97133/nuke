-- organization_vehicle_link_grants: one rule for when an organization link grants anything on a vehicle, failing closed
-- when the trigger that stamps the linker is missing, disabled or changed.
--
-- Why (live, read-only, 2026-11-25). Since 20261126011500, user_can_edit_vehicle counts an organization_vehicles link only
-- when linked_by_user_id is NULL (a service path) or names someone tied to the car. That rule trusts linked_by_user_id,
-- and the column is trusted only because trg_stamp_organization_vehicle_linker (BEFORE INSERT OR UPDATE, row,
-- stamp_organization_vehicle_linker(), prosrc md5 9e8299a8...) overwrites it with auth.uid() on every signed-in or anon
-- write. The table's write policy ('Users/owners manage links', FOR ALL, no WITH CHECK) lets an active owner of any
-- organization, including one a user made for themself, write a link with any linker. Without the trigger, that user
-- writes the car owner's id (or NULL) as linker and the edit check passes again.
-- The same untied link also reaches pending_vehicle_assignments: its SELECT and UPDATE policies admit an active owner or
-- manager of any organization linked to the car, with no rule about who made the link.
--
-- What changes:
--   * organization_vehicle_link_grants(vehicle, linker), SECURITY DEFINER, STABLE: true only while the stamp trigger is
--     present, enabled, BEFORE ROW INSERT OR UPDATE on organization_vehicles and calls a stamp function whose body md5 is
--     the one read live; and then only when the linker is NULL or tied to the car (uploaded_by, user_id, owner_id,
--     created_by_user_id, or vehicle_user_has_access). If the trigger or its body changes, no organization link grants
--     anything until this function is updated with it. The private-row watch (private_row_trigger_expectations) raises
--     on the same change.
--   * user_can_edit_vehicle: the organization branch calls it, replacing the inline rule of 20261126011500 (same result
--     while the trigger is intact).
--   * pending_vehicle_assignments: the organization branch of the SELECT and UPDATE policies counts a link only when it
--     grants, and both policies apply to authenticated only (anon has no auth.uid(), so neither branch could pass).
-- Effect today: none of the 62 edit-granting links changes (all made by a tied linker, trigger intact). Organization
-- links reaching pending_vehicle_assignments: counted in the pull request.
--
-- Refused when a live definition changed since it was read. Re-applying is a no-op. Locks: ALTER POLICY takes a brief
-- exclusive lock on pending_vehicle_assignments (15,305 rows, no scan); function replacement takes none on tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE f text; s text; u text; r text;
BEGIN
  f := md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure));
  IF f NOT IN ('1aa3a755163404d6cb5850c9d736600b', -- gitleaks:allow (function-definition fingerprint after 20261126011500, not a secret)
               'a40c71db7ade983fdefbae013e27ac37') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'user_can_edit_vehicle(uuid, uuid) is not the 20261126011500 body (md5 %); apply that first', f;
  END IF;
  SELECT md5(p.prosrc) INTO s
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.organization_vehicles'::regclass AND t.tgname = 'trg_stamp_organization_vehicle_linker'
    AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 23) = 23
    AND p.pronamespace = 'public'::regnamespace AND p.proname = 'stamp_organization_vehicle_linker';
  IF s IS DISTINCT FROM '9e8299a8e5024d4404e03d55ced96413' THEN -- gitleaks:allow (function-body fingerprint read 2026-11-25, not a secret)
    RAISE EXCEPTION 'trg_stamp_organization_vehicle_linker is missing, disabled or changed (body md5 %)', s;
  END IF;
  SELECT md5(string_agg(polname || ':' || coalesce(pg_get_expr(polqual, polrelid), ''), '|' ORDER BY polname)) INTO u
  FROM pg_policy WHERE polrelid = 'public.pending_vehicle_assignments'::regclass AND polcmd IN ('r', 'w');
  IF u NOT IN ('cc81088e1ea9ac6cf87af2199b1c2780', '3bed1187d0c8f9d865afc7d988d796f0') THEN -- gitleaks:allow (policy-expression fingerprints, not secrets)
    RAISE EXCEPTION 'pending_vehicle_assignments SELECT/UPDATE policies changed since 2026-11-25 (md5 %); review first', u;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.organization_vehicle_link_grants(p_vehicle_id uuid, p_linker uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE t.tgrelid = 'public.organization_vehicles'::regclass
             AND t.tgname = 'trg_stamp_organization_vehicle_linker'
             AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 23) = 23
             AND p.pronamespace = 'public'::regnamespace AND p.proname = 'stamp_organization_vehicle_linker'
             AND md5(p.prosrc) = '9e8299a8e5024d4404e03d55ced96413') -- gitleaks:allow (function-body fingerprint, not a secret)
     AND (p_linker IS NULL
          OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
                       AND p_linker IN (v.uploaded_by, v.user_id, v.owner_id, v.created_by_user_id))
          OR public.vehicle_user_has_access(p_vehicle_id, p_linker))
$function$;
COMMENT ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) IS
  'Whether an organization_vehicles link made by p_linker grants anything on the vehicle (20261126031500): only while trg_stamp_organization_vehicle_linker is intact (enabled, BEFORE ROW INSERT OR UPDATE, body md5 as read), and only for a NULL (service) or tied linker. Change the md5 here in the same migration that changes the stamp function.';
REVOKE ALL ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_can_edit BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.uploaded_by = p_user_id
        OR v.user_id = p_user_id
        OR v.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
            AND vc.user_id = p_user_id
            AND vc.status = 'active'
            AND vc.can_edit = true
        )
        -- (20261126011500) a role counts only when a grantor tied to the car, other than the grantee, approved it
        OR EXISTS (
          SELECT 1 FROM vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = v.id
            AND vcr.user_id = p_user_id
            AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
            AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
            AND vcr.approved_by IS NOT NULL
            AND vcr.approved_by <> vcr.user_id
            AND (vcr.approved_by IN (v.uploaded_by, v.user_id, v.owner_id, v.created_by_user_id)
                 OR public.vehicle_user_has_access(v.id, vcr.approved_by))
        )
        -- (20261126031500) an organization link counts only when organization_vehicle_link_grants says so
        OR EXISTS (
          SELECT 1 FROM organization_vehicles ov
          WHERE ov.vehicle_id = v.id
            AND EXISTS (
              SELECT 1 FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = p_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
            AND public.organization_vehicle_link_grants(v.id, ov.linked_by_user_id)
        )
      )
  ) INTO v_can_edit;

  RETURN COALESCE(v_can_edit, false);
END;
$function$;

ALTER POLICY "Users can view pending assignments for their vehicles" ON public.pending_vehicle_assignments
  TO authenticated
  USING (((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.vehicle_id = pending_vehicle_assignments.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid))
    AND (oc.status = 'active'::text) AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id))))));

ALTER POLICY "Users can update pending assignments for their vehicles" ON public.pending_vehicle_assignments
  TO authenticated
  USING (((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((ov.vehicle_id = pending_vehicle_assignments.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid))
    AND (oc.status = 'active'::text) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text]))
    AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id))))));

COMMIT;
