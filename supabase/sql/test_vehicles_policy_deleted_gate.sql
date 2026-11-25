-- Empty disposable PG17 only:
--   createdb dm_refinement_vpol; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vpol -f this-file.sql
--   (-v vmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125225000_vehicles_policy_deleted_gate.sql: through the vehicles read policies, anon and a signed-in
-- stranger no longer read a deleted, unmerged public car and still read a merged stub; the owner and a tied contributor
-- still read their deleted cars (public or private); the service role reads all; every other answer is unchanged; a
-- child table's policy that consults vehicles follows; the predicate is inlined into the anon plan; the watch row lands
-- and its own sample reads 0 as anon and as a stranger.
\set ON_ERROR_STOP on
\if :{?vmig}
\else
  \set vmig ../migrations/20261125225000_vehicles_policy_deleted_gate.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql

-- The live read policies on vehicles and the live public-image policy on vehicle_images (pg_policies, 2026-11-25).
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
-- Live 2026-11-25: anon and authenticated hold column grants on vehicle_images (these three among them), service_role the table.
GRANT SELECT (id, vehicle_id, is_superseded) ON public.vehicle_images TO anon, authenticated;
GRANT SELECT ON public.vehicle_images TO service_role;
CREATE POLICY "Users can view images for public vehicles" ON public.vehicle_images FOR SELECT
  USING ((COALESCE(is_superseded, false) = false) AND (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true)));
DO $$ BEGIN
  ASSERT (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_public_select') = 'bff26993e09e17fa0a65c86b36a7634a'
     AND (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_private_select') = '9f5079189d0163734d6fa1e83a2a388b',
    'fixture policies are the live ones (qual md5)';
END $$;
-- The live watch table (columns and constraints read 2026-11-25).
CREATE TABLE public.private_row_probes (relation text NOT NULL, subject_kind text NOT NULL, subject_column text NOT NULL,
  row_key text NOT NULL, rank smallint NOT NULL, owner_lane text NOT NULL, note text NOT NULL CHECK (length(btrim(note)) >= 12),
  audiences text[] NOT NULL DEFAULT '{anon,authenticated}' CHECK (audiences <@ '{anon,authenticated}'::text[] AND cardinality(audiences) > 0),
  sample_size integer NOT NULL DEFAULT 50 CHECK (sample_size BETWEEN 1 AND 500), active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(), reader text NOT NULL DEFAULT '', reader_args text, reader_ids text,
  sample_filter text CHECK (sample_filter IS NULL OR (reader_args IS NULL AND position(';' IN sample_filter) = 0)), reader_tail text,
  CHECK (subject_kind IN ('image', 'vehicle', 'user', 'flag', 'visibility', 'withheld_column')),
  PRIMARY KEY (relation, subject_kind, subject_column, reader));
-- The predicate as 20261125214500 left it live: revoked from PUBLIC.
CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicles TO pg_read_all_data;
-- Stand-ins for the guard only: it requires the two definer readers to call the predicate already. Their own
-- contracts are test_vehicle_row_read_deleted_gate.sql and test_profile_deleted_redirect.sql.
CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT NULL::jsonb /* vehicle_publicly_readable */ $$;
CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid) RETURNS json LANGUAGE sql AS
$$ SELECT NULL::json /* vehicle_publicly_readable */ $$;

-- Made-up rows in an empty disposable PG17 database, never production.
INSERT INTO auth.users (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
INSERT INTO public.profiles (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
-- 1111 public; 2222 private; 3333 public deleted unmerged; 5555 private deleted; 6666 public deleted merged (stub);
-- 7777 public merged, not deleted. Owner bbbb on every car; contributor dddd tied to 3333.
INSERT INTO public.vehicles (id, is_public, deleted_at, merged_into_vehicle_id, owner_id, uploaded_by, make, model, year)
SELECT v.id::uuid, v.p, CASE WHEN v.d THEN now() END, v.m::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', v.model, 1970
FROM (VALUES ('11111111-1111-4111-8111-111111111111', true, false, NULL, 'Public'),
             ('22222222-2222-4222-8222-222222222222', false, false, NULL, 'Private'),
             ('33333333-3333-4333-8333-333333333333', true, true, NULL, 'Deleted'),
             ('55555555-5555-4555-8555-555555555555', false, true, NULL, 'PrivDel'),
             ('66666666-6666-4666-8666-666666666666', true, true, '11111111-1111-4111-8111-111111111111', 'Stub'),
             ('77777777-7777-4777-8777-777777777777', true, false, '11111111-1111-4111-8111-111111111111', 'MergedLive')) v(id, p, d, m, model);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, status, role) VALUES
  (gen_random_uuid(), '33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic');
INSERT INTO public.vehicle_images (id, vehicle_id, image_url)
SELECT gen_random_uuid(), v.id, 'https://cdn.invalid/' || v.n || '.jpg'
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 1), ('33333333-3333-4333-8333-333333333333'::uuid, 3),
             ('66666666-6666-4666-8666-666666666666'::uuid, 6)) v(id, n);

CREATE TABLE public.vp_seen (phase text, caller text, vehicle uuid, n int, imgs int, PRIMARY KEY (phase, caller, vehicle));
GRANT INSERT, SELECT ON public.vp_seen TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.vp_capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated'),
      ('owner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated'),
      ('contributor', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated'),
      ('service', 'service', 'service_role')) x(caller, uid, role_name)
  LOOP
    PERFORM public.t_claims(c.uid);
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    INSERT INTO public.vp_seen
    SELECT p_phase, c.caller, k.id, (SELECT count(*) FROM public.vehicles v WHERE v.id = k.id),
           (SELECT count(*) FROM public.vehicle_images i WHERE i.vehicle_id = k.id)
    FROM (SELECT unnest(ARRAY['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
                              '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555',
                              '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']::uuid[]) id) k;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
CREATE FUNCTION pg_temp.seen(p_phase text, p_caller text, p_vehicle text) RETURNS int LANGUAGE sql AS
$$ SELECT n FROM public.vp_seen WHERE phase = p_phase AND caller = p_caller AND vehicle = p_vehicle::uuid $$;

BEGIN; SELECT pg_temp.vp_capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.seen('before', 'anon', '33333333-3333-4333-8333-333333333333') = 1, 'the defect reproduces: anon reads a deleted public car';
END $$;

\ir :vmig
\ir :vmig
BEGIN; SELECT pg_temp.vp_capture('after'); COMMIT;

DO $$
DECLARE k text; n int;
BEGIN
  -- 1. Outsiders no longer read a deleted, unmerged public car, or its photos through vehicle_images' policy.
  FOREACH k IN ARRAY ARRAY['anon', 'stranger'] LOOP
    ASSERT pg_temp.seen('after', k, '33333333-3333-4333-8333-333333333333') = 0, format('1 %s: deleted public car hidden', k);
    ASSERT (SELECT imgs FROM public.vp_seen WHERE phase = 'after' AND caller = k AND vehicle = '33333333-3333-4333-8333-333333333333') = 0,
      format('1 %s: its photos follow', k);
  -- 2. A merged stub stays readable (the redirect needs it), with its photos.
    ASSERT pg_temp.seen('after', k, '66666666-6666-4666-8666-666666666666') = 1
       AND (SELECT imgs FROM public.vp_seen WHERE phase = 'after' AND caller = k AND vehicle = '66666666-6666-4666-8666-666666666666') = 1,
      format('2 %s: stub readable', k);
  END LOOP;
  -- 3. Insiders still read every car they read before, including their deleted public car (which reached them
  --    only through the public policy before) and their deleted private car.
  ASSERT pg_temp.seen('after', 'owner', '33333333-3333-4333-8333-333333333333') = 1
     AND pg_temp.seen('after', 'owner', '55555555-5555-4555-8555-555555555555') = 1
     AND pg_temp.seen('after', 'contributor', '33333333-3333-4333-8333-333333333333') = 1, '3 insiders keep their deleted cars';
  -- 4. Every other answer, row and photo, is the same.
  SELECT count(*) INTO n FROM public.vp_seen a JOIN public.vp_seen b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before' AND (a.n, a.imgs) IS DISTINCT FROM (b.n, b.imgs)
     AND NOT (a.vehicle = '33333333-3333-4333-8333-333333333333' AND a.caller IN ('anon', 'stranger'));
  ASSERT n = 0, format('4 %s other answers changed', n);
  ASSERT (SELECT count(*) FROM public.vp_seen s WHERE s.phase = 'after' AND s.caller = 'service' AND s.n = 1) = 6, '4 service reads all';
END $$;

-- 5. One predicate: the same body vehicle_row_read's 20261125214500 created, inlined into the anon plan (no function
--    call left in the filter).
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)'::regprocedure)
       = '9fba27fc97f7e966763ee5f5e1c92d06dea5dda20aa720e1faaab63de31e8bd3', '5 same predicate body as the readers''';
  -- Live 2026-11-25: pg_read_all_data reads vehicles under RLS; a role like it must be able to execute the predicate.
  ASSERT has_function_privilege('pg_read_all_data', 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)', 'EXECUTE'),
    '5 every role that reads vehicles can execute the predicate';
END $$;
BEGIN;
SELECT public.t_claims('');
SET LOCAL ROLE anon;
CREATE TEMP TABLE vp_plan (line text);
DO $$ DECLARE l text; BEGIN
  FOR l IN EXPLAIN (VERBOSE, COSTS OFF) SELECT id FROM public.vehicles WHERE id = '11111111-1111-4111-8111-111111111111' LOOP
    INSERT INTO vp_plan VALUES (l);
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM vp_plan WHERE line LIKE '%vehicle_publicly_readable%')
     AND EXISTS (SELECT 1 FROM vp_plan WHERE line LIKE '%deleted_at IS NULL%'), '5 the predicate is inlined for anon';
END $$;
ROLLBACK;

-- 6. The watch row lands, and its own sample is read 0 times by anon and by a stranger.
DO $$ DECLARE f text := (SELECT sample_filter FROM public.private_row_probes WHERE relation = 'vehicles' AND subject_kind = 'vehicle'
                                                                              AND subject_column = 'id' AND reader = '' AND active);
               keys uuid[]; seen int;
BEGIN
  ASSERT f IS NOT NULL, '6 watch row present and active';
  EXECUTE format('SELECT array_agg(x.id) FROM public.vehicles x WHERE %s', f) INTO keys;
  ASSERT keys = ARRAY['33333333-3333-4333-8333-333333333333'::uuid], '6 the sample is the deleted unmerged public car';
  PERFORM public.t_claims('');
  SET LOCAL ROLE anon;
  SELECT count(*) INTO seen FROM public.vehicles WHERE id = ANY (keys);
  RESET ROLE;
  ASSERT seen = 0, '6 anon reads none of the sample';
  PERFORM public.t_claims('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.vehicles WHERE id = ANY (keys);
  RESET ROLE;
  ASSERT seen = 0, '6 a stranger reads none of the sample';
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- 7. The revert restores the live policies exactly.
\ir revert_20261125225000_vehicles_policy_deleted_gate.sql
DO $$ BEGIN
  ASSERT (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_public_select') = 'bff26993e09e17fa0a65c86b36a7634a'
     AND (SELECT md5(qual) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_private_select') = '9f5079189d0163734d6fa1e83a2a388b',
    '7 revert gives the live quals back';
END $$;
SELECT 'PASS: vehicles read policies hide deleted unmerged cars from outsiders and keep stubs and insiders' AS result;
