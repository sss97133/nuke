-- timeline_events: the read rule decides again.
--
-- Why. "Public can view all timeline events" (PERMISSIVE, USING true, from 20251020000001) makes every row readable by
-- every role through the API, so the narrower read policies beside it decide nothing. An event with no vehicle is an
-- account's own record, and an event on a vehicle that is not public belongs to a profile the vehicles read policies
-- already keep from a logged-out reader. 20261118160000 held five account-private sources back with a RESTRICTIVE
-- policy; this is the general rule.
--
-- After.
--   logged out: the events of public vehicles ("Public vehicle timeline events are viewable", "Timeline events are
--               viewable by everyone": both unchanged).
--   signed in:  those, plus the events the account wrote (new: timeline_events_author_read), plus the events of a
--               vehicle whose row the account can read (new: timeline_events_vehicle_reader_read).
--   timeline_events_private_source_read (RESTRICTIVE) is unchanged and still applies on top.
--
-- timeline_events_vehicle_reader_read reads public.vehicles as the caller, so the vehicles read policies decide: a
-- public vehicle, or a private one the caller holds (user_id, owner_id, uploaded_by) or is admitted to by
-- vehicle_user_has_access (admins, approved ownership verifications, permissions a holder granted, contributors,
-- members of an organization that owns or consigns the vehicle). Whoever can open the profile reads its events; there
-- is one rule, on vehicles. The guard below refuses to add it unless row security is on for vehicles and no read
-- policy there is USING (true): with vehicles open, this policy would be the open policy again.
--
--   * No row is written, moved or deleted. No grant, column or index changes.
--   * service_role and owner-run (SECURITY DEFINER) readers and writers are unaffected: auto_group_photos_into_events
--     runs as its owner, so a photo landing still finds and extends its event.
--   * The view vehicle_timeline_events is security_invoker (20261014130000), so it follows the same rule.
--   * Writes: INSERT, UPDATE and DELETE policies are unchanged. An INSERT ... RETURNING by a signed-in account returns
--     the row through timeline_events_author_read (it used to return through the open policy), which is why the drop
--     and the two new policies are one transaction.
--   * Cost: with the open policy gone the read policies are evaluated per row (one probe of vehicles by primary key
--     per policy). Reads by vehicle_id, user_id or id are index reads and stay that way. A read with no filter that
--     sorts on created_at has no index to walk and already runs out of time logged out (57014 after 15 s, twice,
--     measured 2026-11-20 23:21 PST); the per-row policies make that shape slower still. Its one reader is an admin
--     page tile that shows empty when the request fails.
--
-- Verify after the deploy run, logged out, through the API with count=exact:
--   /rest/v1/timeline_events?select=id&vehicle_id=is.null&limit=1   -> 0 rows
--   the same for a vehicle that is not public                      -> 0 rows
--   the same for a public vehicle                                  -> its events, as before
--   node scripts/ci/logged-out-live.mjs passes.
-- Contract: supabase/sql/test_timeline_events_read_rule.sql.
-- Revert: supabase/sql/revert_20261121101500_timeline_events_read_rule.sql

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  v_open text;
  v_missing text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.timeline_events'::regclass) THEN
    RAISE EXCEPTION 'row security is off on public.timeline_events; this migration assumes it is on';
  END IF;
  -- the two policies a logged-out reader keeps must be there before the open one goes
  SELECT string_agg(p, ', ') INTO v_missing
    FROM unnest(ARRAY['Public vehicle timeline events are viewable', 'Timeline events are viewable by everyone']) p
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timeline_events'
                        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND policyname = p);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'timeline_events is missing the public-vehicle read policy this migration leaves in charge: %', v_missing;
  END IF;
  -- the open policy is either still the USING (true) one, or already gone (re-apply)
  SELECT qual INTO v_open FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'timeline_events' AND policyname = 'Public can view all timeline events';
  IF FOUND AND v_open IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '"Public can view all timeline events" is not the USING (true) policy this migration was written against: %', v_open;
  END IF;
  -- timeline_events_vehicle_reader_read leans on the vehicles read policies: they must be in force and none may be open
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.vehicles'::regclass) THEN
    RAISE EXCEPTION 'row security is off on public.vehicles; a policy that follows the vehicles read rule would admit every signed-in account';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles'
               AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE' AND btrim(coalesce(qual, '')) = 'true') THEN
    RAISE EXCEPTION 'public.vehicles has a USING (true) read policy; a policy that follows the vehicles read rule would admit every signed-in account';
  END IF;
  -- the policies read vehicles.id as the caller
  IF NOT (has_column_privilege('authenticated', 'public.vehicles', 'id', 'SELECT')
          AND has_column_privilege('anon', 'public.vehicles', 'id', 'SELECT')) THEN
    RAISE EXCEPTION 'anon or authenticated cannot select vehicles.id; a policy reading it would fail every read of this table';
  END IF;
END $guard$;

DROP POLICY IF EXISTS timeline_events_author_read ON public.timeline_events;
CREATE POLICY timeline_events_author_read ON public.timeline_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS timeline_events_vehicle_reader_read ON public.timeline_events;
CREATE POLICY timeline_events_vehicle_reader_read ON public.timeline_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = timeline_events.vehicle_id));

DROP POLICY IF EXISTS "Public can view all timeline events" ON public.timeline_events;

COMMENT ON POLICY timeline_events_author_read ON public.timeline_events IS
'A signed-in account reads the events it wrote (user_id), with or without a vehicle. Added 20261121101500 when the open USING (true) read policy was dropped.';
COMMENT ON POLICY timeline_events_vehicle_reader_read ON public.timeline_events IS
'A signed-in account reads the events of a vehicle whose row it can read: the sub-select runs as the caller, so the vehicles read policies (vehicles_public_select, vehicles_private_select with vehicle_user_has_access) decide. Do not add an open read policy to vehicles without revisiting this one. Added 20261121101500.';

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timeline_events'
               AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE' AND btrim(coalesce(qual, '')) = 'true') THEN
    RAISE EXCEPTION 'an open USING (true) read policy is still on timeline_events';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timeline_events'
        AND policyname IN ('timeline_events_author_read', 'timeline_events_vehicle_reader_read')
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles = '{authenticated}') <> 2 THEN
    RAISE EXCEPTION 'the two signed-in read policies did not land as written';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timeline_events'
                   AND policyname = 'timeline_events_private_source_read' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'timeline_events_private_source_read is missing; it must stay on top of the read policies';
  END IF;
END $check$;

COMMIT;
