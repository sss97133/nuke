-- Empty disposable PG17 only:
--   createdb dm_refinement_row_read_stub; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_row_read_stub -f this-file.sql
--   (-v smig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261126020000_vehicle_row_read_stub_target.sql: a deleted merged car whose target is not publicly readable
-- (private, or deleted and unmerged) answers anon, a signed-in stranger and a caller with no claims NULL, exactly like a
-- missing car; a stub into a public car still answers the redirect; insiders and the service role read stubs whole;
-- every other answer is byte-identical; the revert restores the prior body. Builds on the 20261125214500 contract.
\set ON_ERROR_STOP on
\if :{?smig}
\else
  \set smig ../migrations/20261126020000_vehicle_row_read_stub_target.sql
\endif
\ir test_vehicle_row_read_deleted_gate.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure)
       = 'cdd2d17f8c769b3bee02eb1c63b7b8e94ba29088eeb5adca9aad2af290baa775', 'fixture vehicle_row_read is the live body (after 20261125214500)';
END $$;

-- Made-up rows in an empty disposable PG17 database, never production.
-- 8888 public, deleted, merged into the private 2222; 9999 public, deleted, merged into the deleted unmerged 3333.
INSERT INTO public.vehicles (id, is_public, deleted_at, merged_into_vehicle_id, owner_id, uploaded_by, make, model, year) VALUES
  ('88888888-8888-4888-8888-888888888888', true, now(), '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'StubToPrivate', 1967),
  ('99999999-9999-4999-8999-999999999999', true, now(), '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'StubToDeleted', 1966);

CREATE FUNCTION pg_temp.capture2(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated'),
      ('owner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated'),
      ('contributor', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated'), ('service', 'service', 'service_role'),
      ('noclaims', 'none', 'postgres')) x(caller, uid, role_name)
  LOOP
    IF c.uid = 'none' THEN PERFORM set_config('request.jwt.claims', '', false); ELSE PERFORM public.t_claims(c.uid); END IF;
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    INSERT INTO public.rd_answers SELECT p_phase, c.caller, v.id, public.vehicle_row_read(v.id) FROM public.vehicles v;
    INSERT INTO public.rd_answers SELECT p_phase, c.caller, '44444444-4444-4444-8444-444444444444', public.vehicle_row_read('44444444-4444-4444-8444-444444444444');
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;

BEGIN; SELECT pg_temp.capture2('s_before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.ans('s_before', 'anon', '88888888-8888-4888-8888-888888888888') ->> 'merged_into_vehicle_id' = '22222222-2222-4222-8222-222222222222',
    'the defect reproduces on the live body: anon is handed a private car''s id';
END $$;

\ir :smig
\ir :smig
BEGIN; SELECT pg_temp.capture2('s_after'); COMMIT;

DO $$
DECLARE k text; n int;
BEGIN
  -- 1. A stub into a car the public may not open answers outsiders (the contributor is tied only to 3333 and 6666) exactly
  --    like a missing car.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims','contributor'] LOOP
    ASSERT pg_temp.ans('s_after', k, '88888888-8888-4888-8888-888888888888') IS NULL
       AND pg_temp.ans('s_after', k, '99999999-9999-4999-8999-999999999999') IS NULL
       AND pg_temp.ans('s_after', k, '44444444-4444-4444-8444-444444444444') IS NULL, format('1 %s: stub to an unreadable car = missing', k);
  END LOOP;
  -- 2. A stub into a public car still redirects.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims'] LOOP
    ASSERT pg_temp.ans('s_after', k, '66666666-6666-4666-8666-666666666666')
         = '{"id": "66666666-6666-4666-8666-666666666666", "merged_into_vehicle_id": "11111111-1111-4111-8111-111111111111"}',
      format('2 %s: stub to a public car redirects', k);
  END LOOP;
  -- 3. Insiders and the service role read both new stubs whole.
  FOREACH k IN ARRAY ARRAY['owner','service'] LOOP
    ASSERT pg_temp.ans('s_after', k, '88888888-8888-4888-8888-888888888888') ->> 'model' = 'StubToPrivate', format('3 %s reads it whole', k);
  END LOOP;
  -- 4. Every other answer is byte-identical.
  SELECT count(*) INTO n FROM public.rd_answers a JOIN public.rd_answers b USING (caller, vehicle)
   WHERE a.phase = 's_after' AND b.phase = 's_before' AND a.r IS DISTINCT FROM b.r
     AND NOT (a.vehicle IN ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999')
              AND a.caller IN ('anon','stranger','noclaims','contributor'));
  ASSERT n = 0, format('4 %s other answers changed', n);
END $$;

-- 5. The revert restores the live body.
\ir revert_20261126020000_vehicle_row_read_stub_target.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure)
       = 'cdd2d17f8c769b3bee02eb1c63b7b8e94ba29088eeb5adca9aad2af290baa775', '5 revert restores the 20261125214500 body';
END $$;
SELECT 'PASS: vehicle_row_read answers a stub into an unreadable car as missing' AS result;
