-- child_read_policies_contributors_conflicts_v1: vehicle_contributors and timeline_event_conflicts stop answering every
-- caller with USING (true); a row is read when its car is public, or by a caller tied to that car.
--
-- ROWS (prod, read-only counts, 2026-11-25):
--   vehicle_contributors     133 rows: 15 on private cars, 3 on deleted unmerged cars, 10 on merged stubs.
--     read today: read_contributors (TO public, true), "Allow authenticated reads" (TO authenticated, true),
--     "Users can view contributors for vehicles they own" (uploaded_by), and the write policies.
--   timeline_event_conflicts 181 rows: 1 on a private car; 2 rows name events on two different cars; no FK to
--     timeline_events (primary_event_id, conflicting_event_id are bare uuids).
--     read today: timeline_event_conflicts_public_read (TO public, true), "Users can view conflicts for their events".
--   anon holds SELECT on both tables.
--
-- AFTER:
--   vehicle_contributors_public_read (TO public): the car is vehicle_publicly_readable and is not a merged stub (a stub's
--     children follow its target; the predicate keeps stubs readable only as a redirect).
--   vehicle_contributors_tied_read (TO authenticated): the caller's own contributor row, or vehicle_user_has_access.
--   timeline_event_conflicts_public_read (TO public): every event the row names sits on such a car.
--   timeline_event_conflicts_tied_read (TO authenticated): every event the row names sits on such a car or on a car the
--     caller is tied to (a conflict between two cars is not shown to someone tied to only one of them).
--   The owner policies, the ALL "manage" policy, insert_self_contributor and update_self_contributor are untouched.
--   vehicle_user_has_access is used only in the TO authenticated policies: it is not granted to PUBLIC, and a role that
--   reads under RLS through pg_read_all_data would fail on it. vehicle_publicly_readable is granted to PUBLIC here, as
--   20261125225000 and 20261125225500 also do (idempotent).
--
-- CONSUMERS (grep of nuke_frontend/src, nuke_frontend/api, apps/nuke-capture-ios/Sources, supabase/functions at
--   867322b8e; pg_proc for invoker functions anon or authenticated can run):
--   web reads of vehicle_contributors filter by vehicle_id for the profile being viewed (VehicleOwnershipPanel,
--   ownershipService, ImageLightbox, adminConsignerAccess) or by the caller's own user_id: a public car or the caller's
--   own row, both still read. Edge functions (generate-vehicle-description, vehicle-agent) use the service key.
--   Invoker SQL readers (vehicle_profile_read, get_sibling_vehicles, get_disambiguation_queue) read rows WHERE
--   user_id = the caller: still read. timeline_event_conflicts has no client reader; detect_timeline_conflicts inserts.
--
-- WATCH: private_row_probes ranks 27 and 28 sample rows on cars that are not public-and-live and count what anon and a
--   signed-in stranger read of them: expected 0.
-- CONTRACT: supabase/sql/test_child_read_policies_contributors_conflicts.sql (PG17).
-- REVERSAL: supabase/sql/revert_20261126023000_child_read_policies_contributors_conflicts.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF to_regprocedure('public.vehicle_publicly_readable(boolean,timestamptz,uuid)') IS NULL
     OR to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_publicly_readable or vehicle_user_has_access missing';
  END IF;
  -- Each policy this replaces is either absent (already replaced) or exactly the open one read live.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND ((tablename = 'vehicle_contributors' AND policyname IN ('read_contributors', 'Allow authenticated reads'))
                 OR (tablename = 'timeline_event_conflicts' AND policyname = 'timeline_event_conflicts_public_read'))
               AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT IN ('true', '')
                    AND position('child_read_policies' in coalesce(qual, '')) = 0
                    AND position('vehicle_publicly_readable' in coalesce(qual, '')) = 0)) THEN
    RAISE EXCEPTION 'a replaced policy is not the open one read live 2026-11-25; review';
  END IF;
END $guard$;

GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS read_contributors ON public.vehicle_contributors;
DROP POLICY IF EXISTS "Allow authenticated reads" ON public.vehicle_contributors;
DROP POLICY IF EXISTS vehicle_contributors_public_read ON public.vehicle_contributors;
DROP POLICY IF EXISTS vehicle_contributors_tied_read ON public.vehicle_contributors;
CREATE POLICY vehicle_contributors_public_read ON public.vehicle_contributors FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM public.vehicles v
                  WHERE v.id = vehicle_contributors.vehicle_id AND v.merged_into_vehicle_id IS NULL
                    AND public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)));
CREATE POLICY vehicle_contributors_tied_read ON public.vehicle_contributors FOR SELECT TO authenticated
  USING (vehicle_contributors.user_id = (SELECT auth.uid())
         OR public.vehicle_user_has_access(vehicle_contributors.vehicle_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS timeline_event_conflicts_public_read ON public.timeline_event_conflicts;
DROP POLICY IF EXISTS timeline_event_conflicts_tied_read ON public.timeline_event_conflicts;
CREATE POLICY timeline_event_conflicts_public_read ON public.timeline_event_conflicts FOR SELECT TO public
  USING (timeline_event_conflicts.primary_event_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM unnest(ARRAY[timeline_event_conflicts.primary_event_id,
                                      timeline_event_conflicts.conflicting_event_id]) e(id)
            WHERE e.id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.timeline_events te JOIN public.vehicles v ON v.id = te.vehicle_id
                               WHERE te.id = e.id AND v.merged_into_vehicle_id IS NULL
                                 AND public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id))));
CREATE POLICY timeline_event_conflicts_tied_read ON public.timeline_event_conflicts FOR SELECT TO authenticated
  USING (timeline_event_conflicts.primary_event_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM unnest(ARRAY[timeline_event_conflicts.primary_event_id,
                                      timeline_event_conflicts.conflicting_event_id]) e(id)
            WHERE e.id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.timeline_events te JOIN public.vehicles v ON v.id = te.vehicle_id
                               WHERE te.id = e.id
                                 AND ((v.merged_into_vehicle_id IS NULL
                                       AND public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id))
                                      OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))))));

COMMENT ON POLICY vehicle_contributors_public_read ON public.vehicle_contributors IS
  'child_read_policies_v1: rows on a public, live car (vehicle_publicly_readable, not a merged stub). 20261126023000.';
COMMENT ON POLICY vehicle_contributors_tied_read ON public.vehicle_contributors IS
  'child_read_policies_v1: the caller''s own row, or any row on a car the caller is tied to. 20261126023000.';
COMMENT ON POLICY timeline_event_conflicts_public_read ON public.timeline_event_conflicts IS
  'child_read_policies_v1: every event the conflict names is on a public, live car. 20261126023000.';
COMMENT ON POLICY timeline_event_conflicts_tied_read ON public.timeline_event_conflicts IS
  'child_read_policies_v1: every event the conflict names is on a public, live car or a car the caller is tied to. 20261126023000.';

DO $w$
BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, sample_filter,
                                           owner_lane, note, audiences, active, sample_size)
    VALUES (27, 'vehicle_contributors', 'id', 'vehicle', 'vehicle_id', '', NULL, 'ta-provenance',
            'contributor rows on private, deleted or merged cars: none readable outside their insiders (20261126023000)',
            '{anon,authenticated}', true, 50),
           (28, 'timeline_event_conflicts', 'id', 'user', 'id', '',
            'EXISTS (SELECT 1 FROM public.timeline_events te WHERE te.id IN (x.primary_event_id, x.conflicting_event_id) '
            'AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = te.vehicle_id AND v.is_public AND v.deleted_at IS NULL))',
            'ta-provenance',
            'conflicts naming an event on a private or deleted car: none readable outside their insiders (20261126023000)',
            '{anon,authenticated}', true, 50)
    ON CONFLICT (relation, subject_kind, subject_column, reader) DO NOTHING;
    IF (SELECT count(*) FROM public.private_row_probes
         WHERE active AND reader = '' AND ((relation = 'vehicle_contributors' AND subject_kind = 'vehicle'
                                            AND subject_column = 'vehicle_id' AND sample_filter IS NULL)
                                        OR (relation = 'timeline_event_conflicts' AND subject_kind = 'user'
                                            AND subject_column = 'id' AND position('x.primary_event_id' in sample_filter) > 0))) <> 2 THEN
      RAISE EXCEPTION 'private_row_probes already holds a vehicle_contributors or timeline_event_conflicts probe with another filter or inactive; review';
    END IF;
  END IF;
END $w$;

DO $check$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('vehicle_contributors', 'timeline_event_conflicts') AND cmd IN ('SELECT', 'ALL')
        AND coalesce(qual, '') IN ('true', '')) > 0 THEN
    RAISE EXCEPTION 'an open read policy remains on vehicle_contributors or timeline_event_conflicts';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('vehicle_contributors', 'timeline_event_conflicts')
        AND policyname IN ('vehicle_contributors_public_read', 'vehicle_contributors_tied_read',
                           'timeline_event_conflicts_public_read', 'timeline_event_conflicts_tied_read')
        AND position('vehicle_publicly_readable' in qual) + position('vehicle_user_has_access' in qual) > 0) <> 4 THEN
    RAISE EXCEPTION 'child read policies not as intended';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r CROSS JOIN (VALUES ('public.vehicle_contributors'), ('public.timeline_event_conflicts')) t(rel)
              WHERE NOT r.rolsuper AND NOT r.rolbypassrls AND has_any_column_privilege(r.oid, t.rel, 'SELECT')
                AND NOT has_function_privilege(r.oid, 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'a role that reads these tables under RLS cannot execute vehicle_publicly_readable';
  END IF;
END $check$;
COMMIT;
