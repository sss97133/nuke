-- Four things a logged-out caller could do stop here (pg_policies, relacl, reloptions and proacl, live, 2026-11-21).
--
-- 1. vehicle_user_permissions. The SELECT policy "Public read access to vehicle permissions" (USING true, from the
--    initial schema) returned every permission row, with its account, role and note, to any caller. It is dropped.
--    The one reader that asks about another account is the public garage (iOS ProfileTab.loadPublicGarage: a
--    profile's owner and co-owner rows that are not revoked, then only the public, non-deleted vehicles among them).
--    vup_select_public_garage admits those rows, whole, and no others.
--    Unchanged: vup_select_own (the row's account), "Vehicle owners can manage permissions" (the account in the
--    vehicle's user_id, or the row's account), the three write policies, the grants and the triggers.
-- 2. user_vehicle_roles ran as its owner, so it returned every active permission row joined to its vehicle's year,
--    make, model and VIN whatever the caller could read, vehicles that are not public and deleted ones included.
--    It now runs as its caller (security_invoker) and shows a row only when the caller can read both the permission
--    and the vehicle.
-- 3. ghost_users. The UPDATE policy ghost_users_authenticated_claim was granted TO public and admits every profile
--    that is not claimed, and anon held INSERT, UPDATE, DELETE and TRUNCATE on the table, so a logged-out caller
--    could rewrite any unclaimed device profile. The policy now applies to authenticated and anon keeps SELECT. What
--    a signed-in caller may do is unchanged.
-- 4. photo_land_classification(uuid) kept the default EXECUTE for PUBLIC. It runs as its owner and calls the landing
--    writer, so any caller could land any completed image's reading again. EXECUTE is now the service role's.
--    The landing trigger (photo_land_trigger) runs as its owner and calls the two-argument writer directly, and the
--    backfill drain and land_identifier_claims run as their owner too: none of them needs this grant.
--
-- Consumers (git grep on origin/main; pg_policies, pg_depend and pg_proc, live, 2026-11-21):
--   * The policies on other tables that read vehicle_user_permissions (on timeline_events, vehicle_builds,
--     vehicle_field_sources, vehicle_images, vehicle_price_history and work_sessions) and the three that read
--     user_vehicle_roles (image_sets_select_policy, image_sets_insert_policy, image_set_members_insert_policy) ask
--     for the caller's own rows: vup_select_own keeps answering them. Through the view, a caller's own row now
--     counts only on a vehicle the caller can read.
--   * v_user_connections (security_invoker; web UserConnectionStateStrip) reads the caller's own rows.
--   * Web reads and writes the signed-in user's own rows (VehicleEditModal, Vehicles, ownershipService,
--     VehicleRelationshipManager, TriageDock) and iOS VehicleDetailView does the same. iOS ProfileTab.loadPublicGarage
--     is the one cross-account reader and is what the new policy serves. Every write policy admits only rows the
--     remaining read policies admit, so an UPDATE, a DELETE or an INSERT ... RETURNING reaches what it reached before.
--   * vehicle_user_has_access runs as its owner. has_vehicle_role, get_sibling_vehicles, get_disambiguation_queue and
--     receipt_user_vehicle_tie run as their caller and ask about one account: the service key, and a caller asking
--     about itself, are answered as before; a caller asking about another account now reads what the policies above
--     admit. Their callers on origin/main hold the service key (the check-image-vehicle-match function,
--     scripts/photo-manifest-builder.mjs) or are functions no API role can execute; receipt_vehicle_links, whose
--     trigger calls the last of them, has no write policy. set_vehicle_image_approval (BEFORE INSERT on
--     vehicle_images) runs as the inserter and asks about the row's user_id. The vehicle-agent function reads the
--     table with the service key.
--   * user_vehicle_roles: web VehicleTimeline reads the signed-in user's own row, and nothing mounts that component.
--   * ghost_users: web ImageLightbox and ImageGallery and two edge functions read it; web unifiedImageImportService,
--     which nothing imports, is the only browser code that writes it; the daemons and scripts write with the service
--     key. iOS does not name the table.
--   * photo_land_classification(uuid): no caller in web, iOS, edge functions or scripts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Permission rows: the row's account, the vehicle's adder, and the public garage.
DROP POLICY IF EXISTS "Public read access to vehicle permissions" ON public.vehicle_user_permissions;
DROP POLICY IF EXISTS vup_select_public_garage ON public.vehicle_user_permissions;
CREATE POLICY vup_select_public_garage ON public.vehicle_user_permissions
  FOR SELECT TO anon, authenticated
  USING (
    role IN ('owner', 'co_owner')
    AND revoked_at IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.vehicles v
       WHERE v.id = vehicle_user_permissions.vehicle_id
         AND v.is_public = true
         AND v.deleted_at IS NULL)
  );

-- 2. The roles view follows its caller.
ALTER VIEW public.user_vehicle_roles SET (security_invoker = true);

-- 3. Device profiles: no logged-out write.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ghost_users FROM anon;
ALTER POLICY ghost_users_authenticated_claim ON public.ghost_users TO authenticated;

-- 4. The landing wrapper is the service role's.
REVOKE ALL ON FUNCTION public.photo_land_classification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_land_classification(uuid) TO service_role;

-- The migration checks its own result.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'vehicle_user_permissions' AND cmd IN ('SELECT', 'ALL')
                AND regexp_replace(coalesce(qual, ''), '[\s()]', '', 'g') = 'true') THEN
    RAISE EXCEPTION 'vehicle_user_permissions still has a read policy that admits every row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.user_vehicle_roles'::regclass
                    AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'user_vehicle_roles still runs as its owner';
  END IF;
  IF has_table_privilege('anon', 'public.ghost_users', 'INSERT')
     OR has_table_privilege('anon', 'public.ghost_users', 'UPDATE')
     OR has_table_privilege('anon', 'public.ghost_users', 'DELETE')
     OR has_table_privilege('anon', 'public.ghost_users', 'TRUNCATE') THEN
    RAISE EXCEPTION 'anon can still write public.ghost_users';
  END IF;
  IF NOT has_table_privilege('anon', 'public.ghost_users', 'SELECT') THEN
    RAISE EXCEPTION 'anon lost SELECT on public.ghost_users';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'ghost_users' AND cmd <> 'SELECT'
                AND roles && ARRAY['public', 'anon']::name[]) THEN
    RAISE EXCEPTION 'a ghost_users write policy still applies to anon';
  END IF;
  IF has_function_privilege('anon', 'public.photo_land_classification(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_land_classification(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'an API caller can still execute public.photo_land_classification(uuid)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.photo_land_classification(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on public.photo_land_classification(uuid)';
  END IF;
END
$check$;

COMMIT;
