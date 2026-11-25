-- Empty disposable PG17 only:
--   createdb dm_refinement_profile; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_profile -f this-file.sql
--   (-v dmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125225500_profile_deleted_redirect.sql: get_vehicle_profile_data answers a non-insider for a deleted merged
-- car with the redirect only ({"vehicle": {"id", "merged_into_vehicle_id"}}), for a deleted unmerged car exactly as for a
-- missing one (NULL), and for a stub whose target the caller may not read exactly as missing too; insiders and the service role read both whole as before; every other answer is byte-identical;
-- vehicle_publicly_readable is the one predicate (same body as 20261125214500's). Builds on the 20261125221500 contract
-- (which runs 20261125220000's first) and its fixture, then 20261126034500's edit of this reader (production's body).
\set ON_ERROR_STOP on
\if :{?dmig}
\else
  \set dmig ../migrations/20261125225500_profile_deleted_redirect.sql
\endif
\ir test_profile_external_listings_columns.sql

-- The live state since 20261126034500 (#3971, live 2026-11-25 05:25 PT): organization_vehicle_link_grants and the linker
-- stamp trigger it checks (live definitions and ACL), and that migration's anchored edit of this reader's organization-member
-- test, run here verbatim for this reader only. The resulting body is asserted equal to production's.
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$
;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles FOR EACH ROW EXECUTE FUNCTION stamp_organization_vehicle_linker();
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
REVOKE ALL ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_vehicle_link_grants(uuid, uuid) TO authenticated, service_role;
DO $readers$
DECLARE d text := pg_get_functiondef('public.get_vehicle_profile_data(uuid)'::regprocedure); n int;
  a text := E'      AND oc.user_id = v_uid\n      AND oc.status = ''active''\n  );';
  r text := E'      AND oc.user_id = v_uid\n      AND oc.status = ''active''\n      AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id) /* org_link_reads_tied_linker_v1 */\n  );';
BEGIN
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  ASSERT n = 1, format('20261126034500 anchor found %s times', n);
  EXECUTE replace(d, a, r);
END $readers$;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
          WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)
       = '9c14f2dd77870a7bd21113c80934bcec2629f647d7de915555e6d571c6d10c31', 'fixture reader body equals production since 20261126034500'; -- gitleaks:allow (function-body fingerprint, not a secret)
END $$;

-- Fixture rows in an empty disposable PG17 database, never production.
-- 3333 public and deleted (owner bbbb); 6666 public, deleted, merged into 1111 (a stub; contributor dddd tied);
-- 7777 public, merged into 1111, not deleted; 4444 missing; 8888 public, deleted, merged into the private 2222 and
-- 9999 public, deleted, merged into the deleted 3333 (stubs whose target is not publicly readable).
INSERT INTO public.vehicles (id, is_public, deleted_at, merged_into_vehicle_id, owner_id, uploaded_by, make, model, year) VALUES
  ('33333333-3333-4333-8333-333333333333', true, now(), null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Deleted', 1970),
  ('66666666-6666-4666-8666-666666666666', true, now(), '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Stub', 1969),
  ('77777777-7777-4777-8777-777777777777', true, null, '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'MergedLive', 1968),
  ('88888888-8888-4888-8888-888888888888', true, now(), '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'StubToPrivate', 1967),
  ('99999999-9999-4999-8999-999999999999', true, now(), '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'StubToDeleted', 1966);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, status, role) VALUES
  (gen_random_uuid(), '66666666-6666-4666-8666-666666666666', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic');

CREATE TABLE public.pd_answers (phase text, caller text, vehicle uuid, r jsonb, PRIMARY KEY (phase, caller, vehicle));
GRANT INSERT, SELECT ON public.pd_answers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.pd_capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated'),
      ('owner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated'),
      ('contributor', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated'),
      ('author', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'authenticated'),
      ('service', 'service', 'service_role'), ('noclaims', 'none', 'postgres')) x(caller, uid, role_name)
  LOOP
    PERFORM public.t_claims(c.uid);
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    INSERT INTO public.pd_answers SELECT p_phase, c.caller, v.id, public.get_vehicle_profile_data(v.id)::jsonb
      FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid), ('22222222-2222-4222-8222-222222222222'::uuid),
                   ('33333333-3333-4333-8333-333333333333'::uuid), ('44444444-4444-4444-8444-444444444444'::uuid),
                   ('66666666-6666-4666-8666-666666666666'::uuid), ('77777777-7777-4777-8777-777777777777'::uuid),
                   ('88888888-8888-4888-8888-888888888888'::uuid), ('99999999-9999-4999-8999-999999999999'::uuid)) v(id);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
CREATE FUNCTION pg_temp.pd(p_phase text, p_caller text, p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT r FROM public.pd_answers WHERE phase = p_phase AND caller = p_caller AND vehicle = p_vehicle $$;

BEGIN; SELECT pg_temp.pd_capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.pd('before', 'anon', '33333333-3333-4333-8333-333333333333') -> 'vehicle' ->> 'model' = 'Deleted',
    'the defect reproduces on the prior body: anon opens a deleted public car';
  ASSERT pg_temp.pd('before', 'anon', '66666666-6666-4666-8666-666666666666') -> 'vehicle' ->> 'model' = 'Stub',
    'the prior body opens a deleted stub''s whole profile to anon';
END $$;

\ir :dmig
\ir :dmig
BEGIN; SELECT pg_temp.pd_capture('after'); COMMIT;

DO $$
DECLARE del uuid := '33333333-3333-4333-8333-333333333333'; stub uuid := '66666666-6666-4666-8666-666666666666'; k text; n int;
BEGIN
  -- 1. A deleted unmerged car answers an outsider exactly like a missing one (the contributor is not tied to 3333).
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims','author','contributor'] LOOP
    ASSERT pg_temp.pd('after', k, del) IS NULL AND pg_temp.pd('after', k, '44444444-4444-4444-8444-444444444444') IS NULL,
      format('1 %s: deleted = missing = NULL', k);
  END LOOP;
  -- 2. A deleted merged car answers an outsider with the redirect only: the one thing the page reads from it.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims','author'] LOOP
    ASSERT pg_temp.pd('after', k, stub)
         = '{"vehicle": {"id": "66666666-6666-4666-8666-666666666666", "merged_into_vehicle_id": "11111111-1111-4111-8111-111111111111"}}',
      format('2 %s reads the stub as a redirect only', k);
  END LOOP;
  -- 2b. A stub whose target an outsider may not read (private, or deleted and unmerged) answers exactly like a missing
  --     car: its redirect would name a car the caller cannot open.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims','author','contributor'] LOOP
    ASSERT pg_temp.pd('after', k, '88888888-8888-4888-8888-888888888888') IS NULL
       AND pg_temp.pd('after', k, '99999999-9999-4999-8999-999999999999') IS NULL, format('2b %s: stub to an unreadable car = missing', k);
  END LOOP;
  ASSERT pg_temp.pd('after', 'owner', '88888888-8888-4888-8888-888888888888') -> 'vehicle' ->> 'model' = 'StubToPrivate',
    '2b the owner still reads it whole';
  -- 3. Insiders and the service role read both deleted cars whole, as before.
  FOREACH k IN ARRAY ARRAY['owner','service'] LOOP
    ASSERT pg_temp.pd('after', k, del) = pg_temp.pd('before', k, del) AND pg_temp.pd('after', k, stub) = pg_temp.pd('before', k, stub)
       AND pg_temp.pd('after', k, stub) -> 'vehicle' ->> 'model' = 'Stub', format('3 %s unchanged', k);
  END LOOP;
  ASSERT pg_temp.pd('after', 'contributor', stub) = pg_temp.pd('before', 'contributor', stub)
     AND pg_temp.pd('after', 'contributor', stub) -> 'vehicle' ->> 'model' = 'Stub', '3 tied contributor reads the stub whole';
  -- 4. Everything else is byte-identical: live cars, merged-but-live cars, private cars, missing cars.
  SELECT count(*) INTO n FROM public.pd_answers a JOIN public.pd_answers b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before' AND a.r IS DISTINCT FROM b.r
     AND NOT (a.vehicle IN (del, stub, '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999')
              AND a.caller IN ('anon','stranger','noclaims','author'))
     AND NOT (a.vehicle IN ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999') AND a.caller = 'contributor')
     AND NOT (a.vehicle = del AND a.caller = 'contributor');
  ASSERT n = 0, format('4 %s other answers changed', n);
  ASSERT pg_temp.pd('after', 'anon', '77777777-7777-4777-8777-777777777777') -> 'vehicle' ->> 'model' = 'MergedLive',
    '4 merged, not deleted: unchanged';
END $$;

-- 5. One predicate: the body here is 20261125214500's byte for byte, plain SQL the planner can inline.
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)'::regprocedure)
       = '9fba27fc97f7e966763ee5f5e1c92d06dea5dda20aa720e1faaab63de31e8bd3', '5 same predicate body as vehicle_row_read''s migration';
  ASSERT has_function_privilege('pg_read_all_data', 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)', 'EXECUTE'),
    '5 EXECUTE stays with PUBLIC (the vehicles policies of 20261125225000 call it for every role)';
  ASSERT position('vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)' in
          (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)) > 0, '5 the reader calls it';
  ASSERT position('AND public.organization_vehicle_link_grants(ov.vehicle_id, ov.linked_by_user_id)' in
          (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)) > 0,
    '5 the organization-member test keeps 20261126034500''s organization_vehicle_link_grants line';
END $$;
SELECT 'PASS: get_vehicle_profile_data answers a deleted car as missing and a deleted stub as a redirect' AS result;
