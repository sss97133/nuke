-- Empty disposable PG17 only:
--   createdb dm_refinement_profile; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_profile -f this-file.sql
--   (-v mig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125220000_profile_timeline_private_sources.sql: get_vehicle_profile_data applies timeline_events'
-- RESTRICTIVE policy timeline_events_private_source_read. An event from a private source (call_history,
-- imessage_thread, whatsapp_ingest, apple_health_export, call_history_lead_pattern) reaches only its author and the
-- service role, in the timeline list and in stats.event_count / stats.last_activity; everything else is unchanged.
\set ON_ERROR_STOP on
\if :{?mig}
\else
  \set mig ../migrations/20261125220000_profile_timeline_private_sources.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure)
    = '81845bbca63c4d720771a990b6088c27f4d0479b41d4134d7c2ffcaebd445583', 'fixture reader is the live one';
END $$;

-- bbbb owns both cars; cccc is a stranger; dddd a contributor on the private car; eeee wrote a private event on the
-- public car (an author who is not the owner).
INSERT INTO auth.users (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'), ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
INSERT INTO public.vehicles (id, is_public, owner_id, uploaded_by, user_id, make, model, year) VALUES
  ('11111111-1111-4111-8111-111111111111', true, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Public', 1973),
  ('22222222-2222-4222-8222-222222222222', false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Private', 1970);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, status, role) VALUES
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic');
-- Fixture rows in an empty disposable PG17 database, never production.
INSERT INTO public.timeline_events (id, vehicle_id, user_id, event_type, source, title, event_date, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'sale', 'bat', 'fixture public event', '2026-01-01', '2026-01-01'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'note', 'call_history', 'fixture owner call', '2026-02-01', '2026-02-01'),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'note', 'imessage_thread', 'fixture thread', '2026-03-01', '2026-03-01'),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', null,
   'note', 'apple_health_export', 'fixture health', '2026-04-01', '2026-04-01'),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'service', null, 'fixture sourceless event', '2025-06-01', '2025-06-01'),
  ('a0000000-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'note', 'whatsapp_ingest', 'fixture private-car chat', '2026-05-01', '2026-05-01'),
  ('a0000000-0000-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'service', 'photo_upload', 'fixture private-car work', '2025-07-01', '2025-07-01');

CREATE TABLE public.tp_answers (phase text, caller text, vehicle uuid, r jsonb, PRIMARY KEY (phase, caller, vehicle));
GRANT INSERT, SELECT ON public.tp_answers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
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
    INSERT INTO public.tp_answers SELECT p_phase, c.caller, v.id, public.get_vehicle_profile_data(v.id)::jsonb
      FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid), ('22222222-2222-4222-8222-222222222222'::uuid)) v(id);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
-- The titles of the timeline a caller received, sorted.
CREATE FUNCTION pg_temp.titles(p_phase text, p_caller text, p_vehicle uuid) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(e->>'title' ORDER BY e->>'title'), '{}')
  FROM public.tp_answers a, jsonb_array_elements(a.r->'timeline_events') e
  WHERE a.phase = p_phase AND a.caller = p_caller AND a.vehicle = p_vehicle $$;
CREATE FUNCTION pg_temp.ans(p_phase text, p_caller text, p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT r FROM public.tp_answers WHERE phase = p_phase AND caller = p_caller AND vehicle = p_vehicle $$;

BEGIN; SELECT pg_temp.capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT 'fixture owner call' = ANY (pg_temp.titles('before', 'anon', '11111111-1111-4111-8111-111111111111')),
    'the defect reproduces on the prior body: anon reads a call_history event';
END $$;

\ir :mig
\ir :mig
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE pub uuid := '11111111-1111-4111-8111-111111111111'; priv uuid := '22222222-2222-4222-8222-222222222222'; k text; n int;
BEGIN
  -- 1. Callers who wrote none of the private events see only the public and sourceless ones, and the stats agree.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims'] LOOP
    ASSERT pg_temp.titles('after', k, pub) = ARRAY['fixture public event','fixture sourceless event'],
      format('1 %s timeline holds no private-source event', k);
    ASSERT (pg_temp.ans('after', k, pub)->'stats'->>'event_count')::int = 2, format('1 %s event_count counts no private event', k);
    ASSERT (pg_temp.ans('after', k, pub)->'stats'->>'last_activity')::timestamptz = '2026-01-01'::timestamptz,
      format('1 %s last_activity is not a private event', k);
  END LOOP;

  -- 2. An author reads their own private event and no one else's, the owner included.
  ASSERT pg_temp.titles('after', 'owner', pub) = ARRAY['fixture owner call','fixture public event','fixture sourceless event'],
    '2 owner reads their own call and not the other author''s thread';
  ASSERT pg_temp.titles('after', 'author', pub) = ARRAY['fixture public event','fixture sourceless event','fixture thread'],
    '2 author reads their own thread and not the owner''s call';
  ASSERT (pg_temp.ans('after', 'owner', pub)->'stats'->>'event_count')::int = 3, '2 owner event_count';

  -- 3. The service role reads everything, unchanged.
  ASSERT pg_temp.ans('after', 'service', pub) = pg_temp.ans('before', 'service', pub)
     AND pg_temp.ans('after', 'service', priv) = pg_temp.ans('before', 'service', priv), '3 service unchanged';
  ASSERT cardinality(pg_temp.titles('after', 'service', pub)) = 5, '3 service reads all five events';

  -- 4. A tied contributor on the private car reads its public-source work and not the owner's chat; outsiders get NULL.
  ASSERT pg_temp.titles('after', 'contributor', priv) = ARRAY['fixture private-car work'], '4 contributor private car';
  ASSERT pg_temp.ans('after', 'anon', priv) IS NULL AND pg_temp.ans('after', 'stranger', priv) IS NULL, '4 private car NULL';

  -- 5. Nothing else changed: with the timeline list and the two stats set aside, every answer is byte-identical, and
  --    each remaining timeline is the prior one minus private-source events the caller did not write.
  SELECT count(*) INTO n FROM public.tp_answers a JOIN public.tp_answers b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before'
     AND ((a.r IS NULL) <> (b.r IS NULL) OR a.r IS NOT NULL AND (a.r - 'timeline_events' - 'stats') IS DISTINCT FROM (b.r - 'timeline_events' - 'stats')
       OR (a.r->'stats') - 'event_count' - 'last_activity' IS DISTINCT FROM (b.r->'stats') - 'event_count' - 'last_activity'
       OR a.r IS NOT NULL AND coalesce(a.r->'timeline_events', 'null') IS DISTINCT FROM coalesce((
            SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(b.r->'timeline_events') WITH ORDINALITY x(e, o)
            WHERE a.caller = 'service' OR e->>'source' IS NULL
               OR e->>'source' <> ALL (ARRAY['whatsapp_ingest','call_history','call_history_lead_pattern','imessage_thread','apple_health_export'])
               OR e->>'user_id' = (SELECT CASE a.caller WHEN 'owner' THEN 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                                     WHEN 'contributor' THEN 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
                                     WHEN 'author' THEN 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
                                     WHEN 'stranger' THEN 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' END)), '[]'::jsonb));
  ASSERT n = 0, format('5 %s answers changed beyond the private-source rows', n);
END $$;
SELECT 'PASS: get_vehicle_profile_data applies the timeline private-source policy' AS result;
