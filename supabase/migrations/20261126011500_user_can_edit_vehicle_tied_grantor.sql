-- user_can_edit_vehicle: an edit grant counts only when whoever made it is tied to the vehicle. Nobody grants themself.
--
-- Why (live, read-only, 2026-11-25). user_can_edit_vehicle(vehicle, user) is the edit check behind relink_testimony,
-- attribute_image_session and six other signed-in writers. Two of its branches count a grant without asking who made it:
--   * organization_vehicles: any active owner, manager or employee of an organization linked to the vehicle may edit it.
--     The table's only write policy ('Users/owners manage links') is FOR ALL with USING (linked_by_user_id = auth.uid()
--     OR ...) and no WITH CHECK, so any signed-in user can link any vehicle to any organization, and a member of that
--     organization then passes this check on a car its owner never tied them to. 62 links grant edit today, all in one
--     organization, all made by one linker who is tied to every one of those vehicles.
--   * vehicle_contributor_roles: a row with an edit role counts with no grantor. No end user can write the table (row
--     level security on, no INSERT or UPDATE policy; its one writer, approve_contributor_request, is not executable by
--     end users), and none of its 517 rows (all 'historian') counts today. The rule is closed here before a writer opens.
-- vehicle_viewer_tied / vehicle_user_has_access (the reviewed tie rule) already require the linker or grantor to be the
-- car's own; this brings the edit check to the same rule.
--
-- What changes:
--   * organization branch: a link counts only when linked_by_user_id is NULL (made by a service path) or the linker is
--     tied to the vehicle (uploaded_by, user_id, owner_id, created_by_user_id, or vehicle_user_has_access). A link made
--     by anyone else still records the relationship; it grants no edit.
--   * contributor-role branch: a row counts only when approved_by is set, is not the grantee, and is tied to the vehicle
--     the same way. Legacy rows without a grantor stop counting; they are not deleted.
--   * vehicle_contributor_roles: CHECK (approved_by IS NOT NULL AND approved_by <> user_id) NOT VALID. Every new or
--     changed row names a grantor who is not the grantee; the 517 existing rows are not rechecked.
--   * No write policy is added to vehicle_contributor_roles (it has none; adding one would open it). The
--     organization_vehicles policy is unchanged (13 web writers link dealer, consigner and service relationships).
-- Effect today: 0 of the 62 edit-granting links and 0 contributor-role rows change.
--
-- Refused when the live definition changed since it was read (md5 of pg_get_functiondef, 2026-11-25). Re-applying is a
-- no-op. Locks: ADD CONSTRAINT ... NOT VALID takes a brief exclusive lock on vehicle_contributor_roles (554 rows, no
-- scan); the function replacement takes none on tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure));
  IF f NOT IN ('d7e90f2f6a6f4c3375fb166f67505d5a', -- gitleaks:allow (function-definition fingerprint read 2026-11-25, not a secret)
               '1aa3a755163404d6cb5850c9d736600b') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'user_can_edit_vehicle(uuid, uuid) changed since 2026-11-25 (md5 %); review before replacement', f;
  END IF;
END
$guard$;

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
        -- (20261126011500) an organization link counts only when a service path made it or its linker is tied to the car
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
            AND (ov.linked_by_user_id IS NULL
                 OR ov.linked_by_user_id IN (v.uploaded_by, v.user_id, v.owner_id, v.created_by_user_id)
                 OR public.vehicle_user_has_access(v.id, ov.linked_by_user_id))
        )
      )
  ) INTO v_can_edit;

  RETURN COALESCE(v_can_edit, false);
END;
$function$;

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vehicle_contributor_roles'::regclass
                   AND conname = 'vehicle_contributor_roles_grantor_not_grantee') THEN
    ALTER TABLE public.vehicle_contributor_roles
      ADD CONSTRAINT vehicle_contributor_roles_grantor_not_grantee
      CHECK (approved_by IS NOT NULL AND approved_by <> user_id) NOT VALID;
  END IF;
END
$constraint$;
COMMENT ON CONSTRAINT vehicle_contributor_roles_grantor_not_grantee ON public.vehicle_contributor_roles IS
  'Every new or changed role row names a grantor who is not the grantee (20261126011500). NOT VALID: legacy rows without a grantor stay, and user_can_edit_vehicle does not count them.';

COMMIT;
