-- Empty disposable PG17 only:
--   createdb dm_refinement_childpol; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_childpol -f this-file.sql
--   (-v vmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261126023000_child_read_policies_contributors_conflicts.sql: through the read policies on vehicle_contributors
-- and timeline_event_conflicts, anon and a signed-in stranger read only rows on public, live cars; a contributor still
-- reads their own row; a tied user reads every row on their car; a conflict between two cars needs both; the service
-- role reads all; the write policies are unchanged; the
-- watch rows land and their own samples read 0 as anon and as a stranger; the reversal restores the open answers.
\set ON_ERROR_STOP on
\if :{?vmig}
\else
  \set vmig ../migrations/20261126023000_child_read_policies_contributors_conflicts.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql

-- The predicate as 20261125214500 left it live (ACL read 2026-11-25: anon, authenticated, service_role; not PUBLIC).
CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;
-- vehicle_user_has_access: live ACL is anon, authenticated, service_role, not PUBLIC.
REVOKE ALL ON FUNCTION public.vehicle_user_has_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;

-- The live read policies on vehicles (pg_policies, 2026-11-25).
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
DO $$ BEGIN
  ASSERT (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_public_select') = 'bff26993e09e17fa0a65c86b36a7634a'
     AND (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_private_select') = '9f5079189d0163734d6fa1e83a2a388b',
    'fixture vehicles policies are the live ones (qual md5)';
END $$;
GRANT SELECT ON public.vehicles TO pg_read_all_data;
-- The live read policies on vehicle_user_permissions (a timeline_events policy reads it), and its read grants.
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.vehicle_user_permissions TO anon, authenticated, pg_read_all_data;
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions
  USING ((EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_user_permissions.vehicle_id AND v.user_id = (SELECT auth.uid() AS uid)))
         OR ((SELECT auth.uid() AS uid) = user_id));
CREATE POLICY vup_select_own ON public.vehicle_user_permissions FOR SELECT USING (user_id = (SELECT auth.uid() AS uid));
CREATE POLICY vup_select_public_garage ON public.vehicle_user_permissions FOR SELECT TO anon, authenticated
  USING ((role = ANY (ARRAY['owner'::text, 'co_owner'::text])) AND (revoked_at IS NULL)
         AND (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_user_permissions.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)));

-- The live read policies on timeline_events (pg_policies, 2026-11-25; one restrictive).
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.timeline_events TO anon, authenticated;
CREATE POLICY "Public vehicle timeline events are viewable" ON public.timeline_events FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = timeline_events.vehicle_id AND vehicles.is_public = true));
CREATE POLICY "Timeline events are viewable by everyone" ON public.timeline_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = timeline_events.vehicle_id AND (vehicles.is_public = true
         OR vehicles.id IN (SELECT vehicle_user_permissions.vehicle_id FROM public.vehicle_user_permissions
                            WHERE vehicle_user_permissions.user_id = (SELECT auth.uid() AS uid)))));
CREATE POLICY "Users can view timeline events for vehicles they own" ON public.timeline_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = timeline_events.vehicle_id AND vehicles.user_id = (SELECT auth.uid() AS uid)));
CREATE POLICY timeline_events_author_read ON public.timeline_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid() AS uid));
CREATE POLICY timeline_events_vehicle_reader_read ON public.timeline_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = timeline_events.vehicle_id));
CREATE POLICY timeline_events_private_source_read ON public.timeline_events AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING ((source IS NULL) OR (source <> ALL (ARRAY['whatsapp_ingest'::text, 'call_history'::text, 'call_history_lead_pattern'::text,
         'imessage_thread'::text, 'apple_health_export'::text])) OR (user_id = (SELECT auth.uid() AS uid)));

-- The live policies on vehicle_contributors (all of them, 2026-11-25) and its grants (anon, authenticated: all).
ALTER TABLE public.vehicle_contributors ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.vehicle_contributors TO anon, authenticated;
GRANT SELECT ON public.vehicle_contributors TO pg_read_all_data;
CREATE POLICY "Allow authenticated reads" ON public.vehicle_contributors FOR SELECT TO authenticated USING (true);
CREATE POLICY read_contributors ON public.vehicle_contributors FOR SELECT USING (true);
CREATE POLICY "Users can manage contributors for vehicles they own" ON public.vehicle_contributors
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = vehicle_contributors.vehicle_id AND vehicles.uploaded_by = (SELECT auth.uid() AS uid)));
CREATE POLICY "Users can view contributors for vehicles they own" ON public.vehicle_contributors FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles WHERE vehicles.id = vehicle_contributors.vehicle_id AND vehicles.uploaded_by = (SELECT auth.uid() AS uid)));
CREATE POLICY insert_self_contributor ON public.vehicle_contributors FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid() AS uid)) AND ((EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_contributors.vehicle_id
    AND ((SELECT auth.uid() AS uid) = v.owner_id OR (SELECT auth.uid() AS uid) = v.user_id OR (SELECT auth.uid() AS uid) = v.uploaded_by
         OR (SELECT auth.uid() AS uid) = v.created_by_user_id)))
    OR (status = 'pending' AND COALESCE(can_edit, false) = false AND COALESCE(can_delete, false) = false
        AND COALESCE(can_approve, false) = false AND COALESCE(can_sell, false) = false)));
CREATE POLICY update_self_contributor ON public.vehicle_contributors FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid() AS uid))
  WITH CHECK ((user_id = (SELECT auth.uid() AS uid)) AND ((EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_contributors.vehicle_id
    AND ((SELECT auth.uid() AS uid) = v.owner_id OR (SELECT auth.uid() AS uid) = v.user_id OR (SELECT auth.uid() AS uid) = v.uploaded_by
         OR (SELECT auth.uid() AS uid) = v.created_by_user_id)))
    OR (status = 'pending' AND COALESCE(can_edit, false) = false AND COALESCE(can_delete, false) = false
        AND COALESCE(can_approve, false) = false AND COALESCE(can_sell, false) = false)));

-- The live timeline_event_conflicts (columns, constraints, FK to auth.users, no FK to timeline_events), policies, grants.
CREATE TABLE public.timeline_event_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_event_id uuid, conflicting_event_id uuid,
  conflict_type text NOT NULL, conflict_description text NOT NULL, resolution_status text DEFAULT 'unresolved',
  resolution_notes text, resolved_by uuid REFERENCES auth.users(id), resolved_at timestamptz, created_at timestamptz DEFAULT now(),
  CHECK (primary_event_id <> conflicting_event_id), UNIQUE (primary_event_id, conflicting_event_id));
ALTER TABLE public.timeline_event_conflicts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.timeline_event_conflicts TO anon, authenticated, service_role;
GRANT SELECT ON public.timeline_event_conflicts TO pg_read_all_data;
CREATE POLICY timeline_event_conflicts_public_read ON public.timeline_event_conflicts FOR SELECT USING (true);
CREATE POLICY "Users can view conflicts for their events" ON public.timeline_event_conflicts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.timeline_events te JOIN public.vehicles v ON v.id = te.vehicle_id
                  WHERE (te.id = timeline_event_conflicts.primary_event_id OR te.id = timeline_event_conflicts.conflicting_event_id)
                    AND v.user_id = (SELECT auth.uid() AS uid)));

-- The live watch table and assay (20261125 definitions, read 2026-11-25), verbatim.
CREATE TABLE public.private_row_probes (relation text NOT NULL, subject_kind text NOT NULL, subject_column text NOT NULL,
  row_key text NOT NULL, rank smallint NOT NULL, owner_lane text NOT NULL, note text NOT NULL CHECK (length(btrim(note)) >= 12),
  audiences text[] NOT NULL DEFAULT '{anon,authenticated}' CHECK (audiences <@ '{anon,authenticated}'::text[] AND cardinality(audiences) > 0),
  sample_size integer NOT NULL DEFAULT 50 CHECK (sample_size BETWEEN 1 AND 500), active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(), reader text NOT NULL DEFAULT '', reader_args text, reader_ids text,
  sample_filter text CHECK (sample_filter IS NULL OR (reader_args IS NULL AND position(';' IN sample_filter) = 0)), reader_tail text,
  CHECK (subject_kind IN ('image', 'vehicle', 'user', 'flag', 'visibility', 'withheld_column')),
  PRIMARY KEY (relation, subject_kind, subject_column, reader));
\ir helpers/assay_private_row_exposure_20261125.sql

-- Made-up rows in an empty disposable PG17 database, never production.
-- Users: owner 0b (owns every car), mechanic 0c (tied by an active mechanic row on every car), self 0d (a 'contributor'
-- row on every car: not a tie), stranger 0e, restorer 0a (tied to 2222 only, by an active restorer row).
INSERT INTO auth.users (id) SELECT ('0000000' || c || '-0000-4000-8000-000000000000')::uuid FROM unnest(ARRAY['a', 'b', 'c', 'd', 'e']) c;
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
-- Cars: 1111 public; 2222 private; 3333 public deleted unmerged; 6666 public deleted merged stub into 1111.
INSERT INTO public.vehicles (id, is_public, deleted_at, merged_into_vehicle_id, owner_id, uploaded_by, user_id, make, model, year)
SELECT v.id::uuid, v.p, CASE WHEN v.d THEN now() END, v.m::uuid, '0000000b-0000-4000-8000-000000000000',
       '0000000b-0000-4000-8000-000000000000', '0000000b-0000-4000-8000-000000000000', 'Fixture', 'M', 1970
FROM (VALUES ('11111111-1111-4111-8111-111111111111', true, false, NULL),
             ('22222222-2222-4222-8222-222222222222', false, false, NULL),
             ('33333333-3333-4333-8333-333333333333', true, true, NULL),
             ('66666666-6666-4666-8666-666666666666', true, true, '11111111-1111-4111-8111-111111111111')) v(id, p, d, m);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, role, status)
SELECT gen_random_uuid(), v.id, u.id, u.role, 'active'
FROM public.vehicles v CROSS JOIN (VALUES ('0000000c-0000-4000-8000-000000000000'::uuid, 'mechanic'),
                                          ('0000000d-0000-4000-8000-000000000000'::uuid, 'contributor')) u(id, role);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, role, status) VALUES
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', '0000000a-0000-4000-8000-000000000000', 'restorer', 'active');
-- Events: two on each car. Conflicts: within 1111 (a), within 2222 (b), within 3333 (c), within 6666 (d),
-- and across 1111 and 2222 (x).
INSERT INTO public.timeline_events (id, vehicle_id, event_type)
SELECT (left(v.id::text, 8) || '-0000-4000-8000-00000000000' || n)::uuid, v.id, 'service'
FROM public.vehicles v CROSS JOIN generate_series(1, 2) n;
INSERT INTO public.timeline_event_conflicts (id, primary_event_id, conflicting_event_id, conflict_type, conflict_description)
SELECT c.id::uuid, (c.a || '-0000-4000-8000-00000000000' || c.an)::uuid, (c.b || '-0000-4000-8000-00000000000' || c.bn)::uuid,
       'date_mismatch', 'fixture'
FROM (VALUES ('aaaaaaaa-0000-4000-8000-000000000000', '11111111', 1, '11111111', 2),
             ('bbbbbbbb-0000-4000-8000-000000000000', '22222222', 1, '22222222', 2),
             ('cccccccc-0000-4000-8000-000000000000', '33333333', 1, '33333333', 2),
             ('dddddddd-0000-4000-8000-000000000000', '66666666', 1, '66666666', 2),
             ('eeeeeeee-0000-4000-8000-000000000000', '11111111', 2, '22222222', 1)) c(id, a, an, b, bn);
-- A second owner's view of the cross conflict: 4444 private, owned by mechanic 0c only, and a conflict across 1111 and
-- 4444 (y): the owner 0b is tied to 1111's side only, and 1111 is public, so 0b reads y only through the live owner
-- policy (v.user_id on either event), not through the new tied policy.
INSERT INTO public.vehicles (id, is_public, owner_id, uploaded_by, user_id, make, model, year) VALUES
  ('44444444-4444-4444-8444-444444444444', false, '0000000c-0000-4000-8000-000000000000', '0000000c-0000-4000-8000-000000000000',
   '0000000c-0000-4000-8000-000000000000', 'Fixture', 'M', 1970);
INSERT INTO public.timeline_events (id, vehicle_id, event_type) VALUES
  ('44444444-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'service');
INSERT INTO public.timeline_event_conflicts (id, primary_event_id, conflicting_event_id, conflict_type, conflict_description) VALUES
  ('ffffffff-0000-4000-8000-000000000000', '11111111-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
   'date_mismatch', 'fixture'),
  -- 0: across 2222 and 4444. tied2222 is tied to one side only and must not read it; a rule that admits a conflict when
  -- any one of its events is tied would show it.
  ('00000000-0000-4000-8000-000000000000', '22222222-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000001',
   'date_mismatch', 'fixture');

CREATE TABLE public.cp_seen (phase text, caller text, tbl text, k text, PRIMARY KEY (phase, caller, tbl, k));
GRANT INSERT, SELECT ON public.cp_seen TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.cp_capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', '0000000e-0000-4000-8000-000000000000', 'authenticated'),
      ('owner', '0000000b-0000-4000-8000-000000000000', 'authenticated'),
      ('mechanic', '0000000c-0000-4000-8000-000000000000', 'authenticated'),
      ('self', '0000000d-0000-4000-8000-000000000000', 'authenticated'),
      ('tied2222', '0000000a-0000-4000-8000-000000000000', 'authenticated'),
      ('service', 'service', 'service_role')) x(caller, uid, role_name)
  LOOP
    PERFORM public.t_claims(c.uid);
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    INSERT INTO public.cp_seen
    SELECT p_phase, c.caller, 'vc', left(vc.vehicle_id::text, 4) || ':' || substr(vc.user_id::text, 8, 1)
      FROM public.vehicle_contributors vc
    UNION ALL
    SELECT p_phase, c.caller, 'tec', left(t.id::text, 1) FROM public.timeline_event_conflicts t;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
CREATE FUNCTION pg_temp.seen(p_phase text, p_caller text, p_tbl text) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(k, ',' ORDER BY k), '') FROM public.cp_seen WHERE phase = p_phase AND caller = p_caller AND tbl = p_tbl $$;
CREATE FUNCTION pg_temp.write_policies() RETURNS text LANGUAGE sql AS
$$ SELECT md5(string_agg(tablename || policyname || permissive || roles::text || cmd || coalesce(qual, '') || coalesce(with_check, ''),
                         '|' ORDER BY tablename, policyname))
     FROM pg_policies WHERE tablename IN ('vehicle_contributors', 'timeline_event_conflicts') AND cmd <> 'SELECT' $$;
CREATE TABLE public.cp_hash (phase text PRIMARY KEY, h text);
INSERT INTO public.cp_hash VALUES ('before', pg_temp.write_policies());

BEGIN; SELECT pg_temp.cp_capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.seen('before', 'anon', 'vc') = '1111:c,1111:d,2222:a,2222:c,2222:d,3333:c,3333:d,6666:c,6666:d', 'the defect reproduces: anon reads contributor rows on a private car';
  ASSERT pg_temp.seen('before', 'anon', 'tec') = '0,a,b,c,d,e,f', 'the defect reproduces: anon reads every conflict';
END $$;

\ir :vmig
-- Idempotent: a second run is a no-op.
\ir :vmig
BEGIN; SELECT pg_temp.cp_capture('after'); COMMIT;

DO $$ BEGIN
  -- Case 1: anon and a stranger read only rows on public, live cars (not 2222 private, 3333 deleted, 6666 stub, 4444).
  ASSERT pg_temp.seen('after', 'anon', 'vc') = '1111:c,1111:d', format('case 1 anon vc: %s', pg_temp.seen('after', 'anon', 'vc'));
  ASSERT pg_temp.seen('after', 'stranger', 'vc') = '1111:c,1111:d', format('case 1 stranger vc: %s', pg_temp.seen('after', 'stranger', 'vc'));
  ASSERT pg_temp.seen('after', 'anon', 'tec') = 'a', format('case 1 anon tec: %s', pg_temp.seen('after', 'anon', 'tec'));
  ASSERT pg_temp.seen('after', 'stranger', 'tec') = 'a', format('case 1 stranger tec: %s', pg_temp.seen('after', 'stranger', 'tec'));
  -- Case 2: a contributor without a tie still reads their own row on every car, and nobody else's off the public car.
  ASSERT pg_temp.seen('after', 'self', 'vc') = '1111:c,1111:d,2222:d,3333:d,6666:d', format('case 2 self vc: %s', pg_temp.seen('after', 'self', 'vc'));
  -- Case 3: the tied mechanic reads every row on every car it is tied to (all nine).
  ASSERT pg_temp.seen('after', 'mechanic', 'vc') = pg_temp.seen('before', 'mechanic', 'vc'), format('case 3 mechanic vc: %s', pg_temp.seen('after', 'mechanic', 'vc'));
  -- Case 4: the owner reads every row on its own cars (1111, 2222, 3333, 6666), deleted and stub included.
  ASSERT pg_temp.seen('after', 'owner', 'vc') = '1111:c,1111:d,2222:a,2222:c,2222:d,3333:c,3333:d,6666:c,6666:d', format('case 4 owner vc: %s', pg_temp.seen('after', 'owner', 'vc'));
  -- Case 5: conflicts. The mechanic is tied to every car: all seven. The owner is tied to 1111/2222/3333/6666: a-e, and
  -- f and 0 (each with a 4444 event, not tied) only through the live owner policy on either event, which stays.
  ASSERT pg_temp.seen('after', 'mechanic', 'tec') = '0,a,b,c,d,e,f', format('case 5 mechanic tec: %s', pg_temp.seen('after', 'mechanic', 'tec'));
  ASSERT pg_temp.seen('after', 'owner', 'tec') = '0,a,b,c,d,e,f', format('case 5 owner tec: %s', pg_temp.seen('after', 'owner', 'tec'));
  -- Case 5b: the self contributor (no tie) reads only the conflict on the public car; e (1111 x 2222) needs 2222 too.
  ASSERT pg_temp.seen('after', 'self', 'tec') = 'a', format('case 5b self tec: %s', pg_temp.seen('after', 'self', 'tec'));
  -- Case 5c: a user tied to 2222 only reads 2222's rows and the conflicts whose every event is public or on 2222
  -- (a, b, e), not f (1111 public x 4444) nor 0 (2222 tied x 4444 not tied).
  ASSERT pg_temp.seen('after', 'tied2222', 'vc') = '1111:c,1111:d,2222:a,2222:c,2222:d', format('case 5c tied2222 vc: %s', pg_temp.seen('after', 'tied2222', 'vc'));
  ASSERT pg_temp.seen('after', 'tied2222', 'tec') = 'a,b,e', format('case 5c tied2222 tec: %s', pg_temp.seen('after', 'tied2222', 'tec'));
  -- Case 6: the service role (BYPASSRLS live, and as the fixture creates it on a fresh cluster) reads all, unchanged.
  ASSERT NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role')
      OR (pg_temp.seen('after', 'service', 'vc') = pg_temp.seen('before', 'service', 'vc')
          AND pg_temp.seen('after', 'service', 'tec') = '0,a,b,c,d,e,f'), 'case 6 service role unchanged';
  -- Case 7: the write policies are byte-for-byte unchanged.
  ASSERT pg_temp.write_policies() = (SELECT h FROM public.cp_hash WHERE phase = 'before'), 'case 7 write policies changed';
END $$;

-- Case 9: the watch rows landed, and the assay's own samples read 0 as anon and as a stranger.
DO $$
DECLARE r jsonb; rel jsonb;
BEGIN
  ASSERT (SELECT count(*) FROM public.private_row_probes WHERE rank IN (27, 28) AND active AND owner_lane = 'ta-provenance') = 2,
    'case 9 watch rows';
  r := public.assay_private_row_exposure();
  FOR rel IN SELECT * FROM jsonb_array_elements(r -> 'relations') LOOP
    IF rel ->> 'relation' IN ('vehicle_contributors', 'timeline_event_conflicts') THEN
      ASSERT coalesce((rel ->> 'private_sampled')::int, 0) > 0, format('case 9 the probe samples rows: %s', rel);
      ASSERT NOT coalesce((rel ->> 'exposed')::boolean, true), format('case 9 exposed: %s', rel);
    END IF;
  END LOOP;
  ASSERT (SELECT count(*) FROM jsonb_array_elements(r -> 'relations') e
           WHERE e ->> 'relation' IN ('vehicle_contributors', 'timeline_event_conflicts')) = 2, format('case 9 both probes ran: %s', r);
END $$;

-- Case 10: the reversal restores the open answers.
\ir revert_20261126023000_child_read_policies_contributors_conflicts.sql
BEGIN; SELECT pg_temp.cp_capture('reverted'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.seen('reverted', 'anon', 'vc') = pg_temp.seen('before', 'anon', 'vc')
     AND pg_temp.seen('reverted', 'anon', 'tec') = pg_temp.seen('before', 'anon', 'tec')
     AND pg_temp.seen('reverted', 'stranger', 'vc') = pg_temp.seen('before', 'stranger', 'vc'), 'case 10 reversal';
  ASSERT (SELECT count(*) FROM public.private_row_probes WHERE rank IN (27, 28) AND active) = 0, 'case 10 probes off';
END $$;
SELECT 'test_child_read_policies_contributors_conflicts: ok' AS result;
