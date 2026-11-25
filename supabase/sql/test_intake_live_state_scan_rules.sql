-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_intake_live_state_scan_rules.sql
-- Proves 20261126104500_intake_live_state_scan_rules.sql (on top of 20261125200000_scan_metadata_withheld_paths.sql,
-- whose worker, compiled rules and vehicle_image_scan_metadata run here unstubbed):
--   * before (the live 20261125183500 body, md5 checked): anon reads the feed's 'line' (narrative_one_line) raw on every
--     shown frame.
--   * after: anon and a signed-in stranger read line NULL on every feed item and every other key as before (scene_type,
--     build_phase, intent, confidence, ids, photo, clocks); the owner (tied) and service_role read the feed byte for
--     byte as before; an untied uploader reads the line of their own frame only. fleet and sessions_today are unchanged
--     for every caller.
--   * the reader runs once per returned item (p_feed_limit 3 -> 3 calls), not once per reference to the reading.
--   * the revert restores the live body (md5).
-- Which assertion fails if the fix is removed (scratchpad intake_mut.py): the edit skipped -> the migration's own
-- check; the OFFSET 0 fence removed -> "one reader call per returned item"; the reader keyed by the car -> "every
-- other key".
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/scan_metadata_schema.sql
\ir ../migrations/20261125200000_scan_metadata_withheld_paths.sql

-- What intake_live_state reads beyond the shared fixture (live column names, 2026-11-25).
ALTER TABLE public.vehicles ADD COLUMN year integer, ADD COLUMN make text, ADD COLUMN model text;
UPDATE public.vehicles SET year = 1973, make = 'Fixture', model = 'Car';
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), vehicle_id uuid REFERENCES public.vehicles(id),
  session_date date, title text, image_count integer, work_description text, created_at timestamptz);
GRANT ALL ON public.work_sessions TO service_role;
\ir fixtures/intake_live_state_live_20261125.sql

-- Frames read in the last hour: f1, f3, f4 on public car A by u1 (owner), f2 on A by u3 (untied), f5 on private B by u1.
INSERT INTO public.vehicle_images (id, vehicle_id, user_id, image_url, source, is_document, is_external, vision_gate_status, taken_at,
  last_rerun_at, ai_scan_metadata)
SELECT ('30000000-0000-0000-0000-00000000000' || n)::uuid,
       CASE WHEN n = 5 THEN 'b0000000-0000-0000-0000-00000000000b' ELSE 'a0000000-0000-0000-0000-00000000000a' END::uuid,
       CASE WHEN n = 2 THEN '00000000-0000-0000-0000-000000000003' ELSE '00000000-0000-0000-0000-000000000001' END::uuid,
       'https://x.invalid/f' || n || '.jpg', 'user_upload', false, false, 'approved', '2026-11-20',
       now() - n * interval '1 minute',
       jsonb_build_object('byok_deep_analysis', jsonb_build_object('scene_type', 'body_exterior', 'build_phase_guess', 'assembly',
         'intent', 'progress', 'confidence', 0.8, 'narrative_one_line', 'parked at 12 Elm St',
         'presence', jsonb_build_object('place_hint', 'driveway on Elm St')))
  FROM generate_series(1, 5) n;
INSERT INTO public.work_sessions VALUES ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-00000000000a', current_date, 'fixture session', 3, 'fixture work', now());

SET track_functions = 'all';
CREATE TABLE public.il_answers (phase text, caller text, r jsonb, calls bigint, PRIMARY KEY (phase, caller));
GRANT INSERT, SELECT ON public.il_answers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.il_capture(p_phase text, p_limit integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; r jsonb; c0 bigint; c1 bigint;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', '00000000-0000-0000-0000-000000000002', 'authenticated'),
      ('owner', '00000000-0000-0000-0000-000000000001', 'authenticated'),
      ('photog', '00000000-0000-0000-0000-000000000003', 'authenticated'),
      ('service', 'service', 'service_role')) x(caller, uid, role_name)
  LOOP
    SELECT coalesce(sum(calls), 0) INTO c0 FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_scan_metadata';
    PERFORM public.t_claims(c.uid);
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    r := public.intake_live_state(p_limit, 30) - 'server_time';
    RESET ROLE;
    SELECT coalesce(sum(calls), 0) INTO c1 FROM pg_stat_xact_user_functions WHERE funcname = 'vehicle_image_scan_metadata';
    INSERT INTO public.il_answers VALUES (p_phase, c.caller, r, c1 - c0);
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
-- Feed items with a line, the image ids among them, and the answer with every line removed.
CREATE FUNCTION pg_temp.lines(p_phase text, p_caller text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(e ->> 'id', 1), ',' ORDER BY e ->> 'id'), '')
    FROM public.il_answers a, jsonb_array_elements(a.r -> 'feed') e
   WHERE a.phase = p_phase AND a.caller = p_caller AND e ->> 'line' IS NOT NULL $$;
CREATE FUNCTION pg_temp.bare(p_phase text, p_caller text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_set(a.r, '{feed}', coalesce((SELECT jsonb_agg(e - 'line' ORDER BY o)
                                              FROM jsonb_array_elements(a.r -> 'feed') WITH ORDINALITY x(e, o)), '[]'))
    FROM public.il_answers a WHERE a.phase = p_phase AND a.caller = p_caller $$;

BEGIN; SELECT pg_temp.il_capture('before', 24); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.lines('before', 'anon') = '1,2,3,4', format('the defect reproduces: anon reads the line of every shown frame (%s)', pg_temp.lines('before', 'anon'));
  ASSERT pg_temp.lines('before', 'owner') = '1,2,3,4,5', 'the owner reads all five frames';
END $$;

\ir ../migrations/20261126104500_intake_live_state_scan_rules.sql
\ir ../migrations/20261126104500_intake_live_state_scan_rules.sql
BEGIN; SELECT pg_temp.il_capture('after', 24); COMMIT;
BEGIN; SELECT pg_temp.il_capture('after3', 3); COMMIT;

DO $$
DECLARE k text;
BEGIN
  ASSERT pg_temp.lines('after', 'anon') = '' AND pg_temp.lines('after', 'stranger') = '',
    format('anon (%s) and a stranger (%s) read no line', pg_temp.lines('after', 'anon'), pg_temp.lines('after', 'stranger'));
  FOREACH k IN ARRAY ARRAY['anon', 'stranger', 'photog'] LOOP
    ASSERT pg_temp.bare('after', k) = pg_temp.bare('before', k),
      format('%s: every other key of the answer unchanged (scene, phase, intent, confidence, fleet, sessions)', k);
  END LOOP;
  FOREACH k IN ARRAY ARRAY['owner', 'service'] LOOP
    ASSERT (SELECT r FROM public.il_answers WHERE phase = 'after' AND caller = k)
         = (SELECT r FROM public.il_answers WHERE phase = 'before' AND caller = k), format('%s reads the answer byte for byte as before', k);
  END LOOP;
  ASSERT pg_temp.lines('after', 'photog') = '2', format('an untied uploader reads the line of their own frame only (%s)', pg_temp.lines('after', 'photog'));
  ASSERT (SELECT calls FROM public.il_answers WHERE phase = 'after3' AND caller = 'anon') = 3
     AND jsonb_array_length((SELECT r -> 'feed' FROM public.il_answers WHERE phase = 'after3' AND caller = 'anon')) = 3,
    format('one reader call per returned item (%s for 3)', (SELECT calls FROM public.il_answers WHERE phase = 'after3' AND caller = 'anon'));
END $$;

\ir revert_20261126104500_intake_live_state_scan_rules.sql
DO $$ BEGIN
  ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.intake_live_state(integer,integer)'::regprocedure)
    = '880553287506d9f991040ba9a2370af5', 'the revert restores the 20261125183500 body';
END $$;
SELECT 'PASS: intake_live_state reads feed analyses through the image rule rows' AS result;
