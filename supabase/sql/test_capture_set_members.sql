-- Contract: 20261126151500_capture_set_members. The member table keys every capture_set_candidates.image_ids element to
-- vehicle_images, the writer keeps both in step, and the backfill is bounded, idempotent and skips a photo that is gone.
-- Cases (owner U, run R1 written by production's writer body before the migration):
--   FK      a member must name an existing photo and candidate; deleting the photo deletes its member rows
--   ACCESS  RLS on; anon and authenticated cannot read (Supabase default privileges revoked); service_role SELECT only
--   BOUND   one call writes at most max(p_max_elems, the first candidate's photos) elements
--   SKIP    an element whose photo is gone is counted (dangling_skipped) and never inserted
--   SWEEP   a candidate written behind the cursor by the old body (deploy race) gets its members in pass 2
--   DONE    agreement short_existing 0 and extra 0, the job unschedules itself; a replay and a reset add 0 rows
--   WRITER  record_capture_set_candidates writes the members of each inserted row; a duplicate or skipped item none
--   REFUSE  the backfill fails, without marking done, while members and image_ids disagree
--   YIELD   the backfill job joins the auction_close_yield rule row and its command does nothing while lots close
--   CHECK   the hourly job writes the agreement as its job_assay_readings row: pending writes nothing, then passed;
--           a missing or an extra member reads failed, and the job's own command then fails the run with the row kept
--   REVERT  restores production's writer body (md5 ce597562...), drops the table and the job
--   GUARD   a drifted writer body stops the migration; a replay of the file applies cleanly
-- Disposable PG17 only, synthetic rows in stand-in tables. -- ALLOW_RAW_TESTIMONY_WRITE (local fixture, never production)
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database (dm_refinement_*)';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- Supabase's default privileges: every new public table and function is granted to the API roles unless revoked
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== stand-ins: pg_cron, and the columns the writer and the backfill read
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$
  WITH d AS (DELETE FROM cron.job WHERE jobid = p_jobid RETURNING 1) SELECT count(*) > 0 FROM d $$;
-- guardrail-allow(center-key-fk): vehicles: disposable PG17 stand-in of a live table; only the columns the writer reads
-- guardrail-allow(center-key-fk): vehicle_images: disposable PG17 stand-in of a live table; only the columns the writer reads
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid);
-- job_assay_readings as production defines it (the columns and CHECKs, 2026-11-25)
CREATE TABLE public.job_assay_readings(jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval NOT NULL, fresh_for interval NOT NULL, run_started_at timestamptz,
  CONSTRAINT job_assay_readings_cadence_check CHECK (refresh_every > '00:00:00'::interval AND fresh_for > refresh_every),
  CONSTRAINT job_assay_readings_clock_check CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0));
CREATE TABLE public.platform_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
-- the shared yield rule (20261126033500): its row, and a reader that says "closing" for a listed job while test.closing is on
INSERT INTO public.platform_config (config_key, config_value) VALUES ('auction_close_yield',
  '{"jobs": ["data-set-grades-backfill"], "minutes_before_end": 30, "minutes_after_end": 15, "soft_close_max_minutes": 60}');
CREATE FUNCTION public.auction_close_yield(p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT (config_value->'jobs') ? p_job FROM public.platform_config WHERE config_key = 'auction_close_yield'), false)
     AND coalesce(current_setting('test.closing', true), 'off') = 'on' $$;
-- capture_set_candidates as production defines it (pg_get_constraintdef / pg_get_indexdef, 2026-11-25)
-- guardrail-allow(center-key-fk): capture_set_candidates: disposable PG17 stand-in of a live table, its live definition
CREATE TABLE public.capture_set_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL, user_id uuid NOT NULL, set_key text NOT NULL,
  image_ids uuid[] NOT NULL, vehicle_id uuid NOT NULL, rank smallint NOT NULL CHECK (rank >= 1),
  combined numeric(5,4) NOT NULL CHECK (combined >= 0 AND combined <= 1),
  margin numeric(5,4) NOT NULL CHECK (margin >= -1 AND margin <= 1),
  band text NOT NULL CHECK (band IN ('clear', 'likely', 'weak', 'tie')),
  signals jsonb NOT NULL CHECK (jsonb_typeof(signals) = 'object'), method text NOT NULL, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revoked_reason text,
  CONSTRAINT csc_images_nonempty CHECK (cardinality(image_ids) > 0), UNIQUE (run_id, set_key, vehicle_id));
CREATE INDEX csc_run ON public.capture_set_candidates (run_id);
ALTER TABLE public.capture_set_candidates ENABLE ROW LEVEL SECURITY;

-- ===== production's writer body (pg_get_functiondef, 2026-11-25 06:00 PT; md5(prosrc) ce59756228fdd1f6125e1110a78cecf9)
CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE it jsonb; v_ids uuid[]; v_ok int := 0; v_skip int := 0; v_dup int := 0; v_n int;
BEGIN
  IF p_run_id IS NULL OR p_user IS NULL OR coalesce(p_method, '') = '' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'record_capture_set_candidates: run, user, method and an items array are required';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = (it->>'vehicle_id')::uuid AND v.deleted_at IS NULL
                     AND v.merged_into_vehicle_id IS NULL)
       OR (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids) AND vi.user_id = p_user AND vi.vehicle_id IS NULL)
          <> cardinality(v_ids) THEN
      v_skip := v_skip + 1; CONTINUE;
    END IF;
    INSERT INTO capture_set_candidates (run_id, user_id, set_key, image_ids, vehicle_id, rank, combined, margin, band,
                                        signals, method, created_by)
    VALUES (p_run_id, p_user, it->>'set_key', v_ids, (it->>'vehicle_id')::uuid, (it->>'rank')::smallint,
            (it->>'combined')::numeric, (it->>'margin')::numeric, it->>'band', it->'signals', p_method, 'agent:grok-bot')
    ON CONFLICT (run_id, set_key, vehicle_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'written', v_ok, 'skipped', v_skip, 'duplicate', v_dup);
END $function$;
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_capture_set_candidates(uuid,uuid,text,jsonb)'::regprocedure)
  = 'ce59756228fdd1f6125e1110a78cecf9', 'fixture writer is production''s body');

-- ===== rows written before the migration: run R1 through the old writer
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000a1', NULL, NULL), ('00000000-0000-4000-8000-0000000000a2', NULL, NULL),
                            ('00000000-0000-4000-8000-0000000000a3', NULL, NULL);
INSERT INTO vehicle_images
SELECT ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, '00000000-0000-4000-8000-0000000000f0', NULL
  FROM generate_series(1, 14) i;
INSERT INTO vehicle_images VALUES ('00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-0000000000f0',
                                   '00000000-0000-4000-8000-0000000000a1');  -- filed
CREATE FUNCTION pg_temp.item(k text, imgs int[], veh text, rnk int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('set_key', k, 'vehicle_id', '00000000-0000-4000-8000-0000000000' || veh, 'rank', rnk,
    'combined', 0.9, 'margin', 0.5, 'band', 'clear', 'signals', '{}'::jsonb,
    'image_ids', (SELECT jsonb_agg('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0')) FROM unnest(imgs) i)) $$;
SELECT pg_temp.ok((public.record_capture_set_candidates('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f0',
  'scored_session_v1', jsonb_build_array(
    pg_temp.item('s1', '{1,2,3}', 'a1', 1), pg_temp.item('s1', '{1,2,3}', 'a2', 2), pg_temp.item('s1', '{1,2,3}', 'a3', 3),
    pg_temp.item('s2', '{4}', 'a1', 1),
    pg_temp.item('s3', '{5,6,7,8,9}', 'a1', 1), pg_temp.item('s3', '{5,6,7,8,9}', 'a2', 2),
    pg_temp.item('s4', '{10,11}', 'a1', 1), pg_temp.item('s5', '{12}', 'a1', 1))) ->> 'written') = '8', 'old writer: 8 rows of R1');
-- two photos are deleted after their sets were written: s4 keeps one live photo, s5 none
DELETE FROM vehicle_images WHERE id IN ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000112');

-- ===== the migration
SET client_min_messages = notice;
\ir ../migrations/20261126151500_capture_set_members.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_capture_set_candidates(uuid,uuid,text,jsonb)'::regprocedure)
  = 'a59ee3b14324d7e60204738777046867', 'writer replaced with the reviewed body');
SELECT pg_temp.ok((SELECT count(*) FROM cron.job WHERE jobname = 'capture-set-members-backfill'
                    AND command LIKE 'SET client_min_messages = error;%' AND command LIKE '%capture_set_members_backfill(500)%'
                    AND command LIKE '%WHERE NOT public.auction_close_yield(''capture-set-members-backfill'')%'
                    AND command NOT ILIKE '%statement_timeout%') = 1,
  'one backfill job scheduled: yields while auctions close, sets no statement_timeout');
SELECT pg_temp.ok((SELECT (config_value->'jobs') ? 'capture-set-members-backfill' AND (config_value->'jobs') ? 'data-set-grades-backfill'
                     FROM platform_config WHERE config_key = 'auction_close_yield'), 'YIELD: the backfill joined the shared rule row''s jobs');
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members) = 0, 'the migration writes no member rows');
SELECT pg_temp.ok((SELECT count(*) FROM cron.job WHERE jobname = 'capture-set-members-agreement'
                    AND command LIKE 'SET client_min_messages = error;%'
                    AND command LIKE '%SELECT public.capture_set_members_check(); COMMIT; SELECT public.capture_set_members_check_raise();%'
                    AND command NOT ILIKE '%statement_timeout%') = 1,
  'one hourly agreement check job scheduled: reading committed, then a failed reading fails the run; no statement_timeout');
SELECT pg_temp.ok((SELECT public.capture_set_members_check()->>'status') = 'pending', 'CHECK: before the backfill is done the check returns pending');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement'), 'CHECK: and writes no assay row');

-- ===== ACCESS
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.capture_set_members'::regclass), 'RLS on');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'capture_set_members'), 'no policy');
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.capture_set_members', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.capture_set_members', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.capture_set_members', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.capture_set_members', 'INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role', 'public.capture_set_members', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.capture_set_members', 'INSERT,UPDATE,DELETE'),
  'anon and authenticated hold nothing; service_role SELECT only');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.capture_set_members_backfill(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_set_members_backfill(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_set_members_agreement()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_set_members_agreement()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_set_members_check()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_set_members_check()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_set_members_check_raise()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_set_members_check_raise()', 'EXECUTE'),
  'the backfill, the agreement and the two check functions are not callable by anon or authenticated');

-- ===== FK
DO $$ BEGIN
  INSERT INTO capture_set_members (candidate_id, image_id, added_run, added_via)
  SELECT id, '00000000-0000-4000-8000-0000000009ff', run_id, 'backfill' FROM capture_set_candidates LIMIT 1;
  RAISE EXCEPTION 'Contract failed: a member naming a missing photo was accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS FK: a missing photo is refused';
END $$;
DO $$ BEGIN
  INSERT INTO capture_set_members (candidate_id, image_id, added_run, added_via)
  VALUES ('00000000-0000-4000-8000-0000000009fe', '00000000-0000-4000-8000-000000000101', gen_random_uuid(), 'backfill');
  RAISE EXCEPTION 'Contract failed: a member naming a missing candidate was accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS FK: a missing candidate is refused';
END $$;
DO $$ BEGIN
  INSERT INTO capture_set_members (candidate_id, image_id, role, added_run, added_via)
  SELECT id, '00000000-0000-4000-8000-000000000101', 'filed', run_id, 'backfill' FROM capture_set_candidates LIMIT 1;
  RAISE EXCEPTION 'Contract failed: a role outside the list was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS role is a CHECK list';
END $$;

-- ===== anon and authenticated read nothing, even with rows present (checked again after the backfill)
CREATE FUNCTION pg_temp.api_roles_refused() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r text; n bigint; refused int := 0;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      SELECT count(*) INTO n FROM public.capture_set_members;
      RESET ROLE;
      IF n = 0 THEN refused := refused + 1; END IF;   -- a read that returns 0 rows also counts as refused
    EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1;
    END;
    RESET ROLE;
  END LOOP;
  RETURN refused = 2;
END $$;

-- ===== YIELD: the job's own command (sent as pg_cron sends it, one simple query) does nothing while auctions close
SET test.closing = 'on';
SELECT command FROM cron.job WHERE jobname = 'capture-set-members-backfill' \gexec
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members) = 0
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'capture_set_members_backfill'),
  'YIELD: while lots close the job''s command writes nothing');
SET test.closing = 'off';

-- ===== BOUND: the first call takes one 3-photo candidate under p_max_elems 3
SELECT pg_temp.ok((SELECT (r #>> '{last_run,candidates}')::int = 1 AND (r #>> '{last_run,added}')::int = 3
                     AND (r->>'pass')::int = 1 FROM (SELECT public.capture_set_members_backfill(3) r) x),
  'BOUND: one call of max 3 writes the first candidate''s 3 photos only');
-- SWEEP setup: a member of the row just passed is lost (the row is short, not empty), and a row the old writer body
-- commits behind the cursor while the migration deploys (run e0 < e1). Pass 1 has passed both; pass 2 must fix both.
DELETE FROM capture_set_members WHERE image_id = '00000000-0000-4000-8000-000000000102';
INSERT INTO capture_set_candidates (run_id, user_id, set_key, image_ids, vehicle_id, rank, combined, margin, band, signals, method, created_by)
VALUES ('00000000-0000-4000-8000-0000000000e0', '00000000-0000-4000-8000-0000000000f0', 'race',
        '{00000000-0000-4000-8000-000000000113}', '00000000-0000-4000-8000-0000000000a1', 1, 0.9, 0.5, 'clear', '{}',
        'scored_session_v1', 'agent:grok-bot');
CREATE TEMP TABLE calls(n serial, r jsonb);
DO $$ DECLARE r jsonb; i int := 0; BEGIN
  LOOP
    i := i + 1;
    IF i > 40 THEN RAISE EXCEPTION 'Contract failed: the backfill did not finish in 40 calls'; END IF;
    r := public.capture_set_members_backfill(3);
    INSERT INTO calls(r) VALUES (r);
    EXIT WHEN coalesce((r->>'done')::boolean, false);
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT bool_and((r #>> '{last_run,added}')::int + (r #>> '{last_run,dangling}')::int <= 5) FROM calls),
  'BOUND: no call wrote more than max(3, the largest single candidate = 5) elements');
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members) = 21 + 1, 'every live element became a member (21 of R1 + 1 race row)');
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members WHERE image_id IN ('00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000112')) = 0, 'SKIP: no member names a deleted photo');
SELECT pg_temp.ok((SELECT (config_value->>'dangling_skipped')::int = 2 AND (config_value->>'sweep_dangling_skipped')::int = 2
                     AND (config_value->>'done')::boolean FROM platform_config WHERE config_key = 'capture_set_members_backfill'),
  'SKIP: 2 dangling elements counted in pass 1, and again when pass 2 revisits their short rows; done');
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members m JOIN capture_set_candidates c ON c.id = m.candidate_id
                    WHERE c.set_key = 's1' AND c.vehicle_id = '00000000-0000-4000-8000-0000000000a1') = 3,
  'SWEEP: pass 2 restored the member lost from a row that still had others');
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members m JOIN capture_set_candidates c ON c.id = m.candidate_id
                    WHERE c.set_key = 'race') = 1, 'SWEEP: the row written behind the cursor has its member');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM capture_set_members m JOIN capture_set_candidates c ON c.id = m.candidate_id
                    WHERE NOT (m.image_id = ANY (c.image_ids)) OR m.added_run <> c.run_id OR m.added_via <> 'backfill' OR m.role <> 'unfiled'),
  'every member is in its row''s array, carries the row''s run, via backfill, role unfiled');
SELECT pg_temp.ok((SELECT (a->>'short_existing')::int = 0 AND (a->>'extra')::int = 0 AND (a->>'short_dangling')::int = 2
                     FROM (SELECT public.capture_set_members_agreement() a) x), 'DONE: members and image_ids agree; 2 dangling');
SELECT pg_temp.ok((SELECT count(*) FROM cron.job WHERE jobname = 'capture-set-members-backfill') = 0, 'DONE: the job unscheduled itself');
SELECT pg_temp.ok((SELECT public.capture_set_members_check()->>'status') = 'passed', 'CHECK: after the backfill the check passes');
SELECT pg_temp.ok((SELECT reading->>'status' = 'passed' AND fresh_for = interval '3 hours' AND refresh_every = interval '1 hour'
                     FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement'),
  'CHECK: the assay row for v_job_health reads passed, fresh for 3 h');
SELECT pg_temp.ok(pg_temp.api_roles_refused(), 'ACCESS: anon and authenticated read 0 rows of 22');

-- ===== idempotent: a call after done changes nothing; a reset re-walks and adds 0
SELECT pg_temp.ok((SELECT (public.capture_set_members_backfill(1000)->>'done')::boolean), 'a call after done returns done');
DELETE FROM platform_config WHERE config_key = 'capture_set_members_backfill';
DO $$ DECLARE r jsonb; i int := 0; BEGIN
  LOOP i := i + 1; IF i > 10 THEN RAISE EXCEPTION 'Contract failed: reset run did not finish'; END IF;
    r := public.capture_set_members_backfill(1000); EXIT WHEN coalesce((r->>'done')::boolean, false); END LOOP;
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members) = 22
  AND (SELECT (config_value->>'members_added')::int FROM platform_config WHERE config_key = 'capture_set_members_backfill') = 0,
  'idempotent: a full re-walk adds 0 rows');

-- ===== WRITER keeps members in step
SELECT pg_temp.ok((SELECT r->>'written' = '1' AND r->>'duplicate' = '1' AND r->>'skipped' = '1' AND r->>'members' = '2'
                     FROM (SELECT public.record_capture_set_candidates('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f0',
                       'scored_session_v1', jsonb_build_array(pg_temp.item('s6', '{13,14}', 'a1', 1), pg_temp.item('s6', '{13,14}', 'a1', 1),
                         pg_temp.item('s7', '{14,15}', 'a2', 1))) r) x),
  'WRITER: one row written with 2 members; the duplicate and the filed-photo item write none');
SELECT pg_temp.ok((SELECT array_agg(m.image_id ORDER BY m.image_id) = (SELECT array_agg(x ORDER BY x) FROM unnest(c.image_ids) x)
                          AND bool_and(m.added_via = 'writer' AND m.added_run = c.run_id)
                     FROM capture_set_members m JOIN capture_set_candidates c ON c.id = m.candidate_id
                    WHERE c.set_key = 's6' GROUP BY c.id, c.image_ids), 'WRITER: members equal the row''s image_ids, via writer, run e2');
SELECT pg_temp.ok((SELECT (a->>'short_existing')::int = 0 AND (a->>'extra')::int = 0 FROM (SELECT public.capture_set_members_agreement() a) x),
  'WRITER: agreement holds after a write');
-- a photo deleted later: its member rows go with it, and the agreement calls the gap dangling, not missing
DELETE FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000113';
SELECT pg_temp.ok((SELECT count(*) FROM capture_set_members WHERE image_id = '00000000-0000-4000-8000-000000000113') = 0
  AND (SELECT (a->>'short_existing')::int = 0 AND (a->>'short_dangling')::int = 4 FROM (SELECT public.capture_set_members_agreement() a) x),
  'FK cascade: a deleted photo''s members go; agreement counts 4 dangling, 0 missing');

-- ===== REFUSE: the backfill's last pass fails instead of finishing while members and image_ids disagree, each way
CREATE FUNCTION pg_temp.backfill_refuses() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE platform_config SET config_value = jsonb_build_object('pass', 2,
    'cursor', jsonb_build_object('run_id', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 'set_key', 'zz', 'vehicle_id', 'ffffffff-ffff-4fff-bfff-ffffffffffff'))
   WHERE config_key = 'capture_set_members_backfill';
  BEGIN
    PERFORM public.capture_set_members_backfill(1000);
    RETURN false;
  EXCEPTION WHEN raise_exception THEN
    RETURN SQLERRM LIKE 'capture_set_members_backfill: members and image_ids disagree after the sweep:%';
  END;
END $$;
-- (a) short_existing: a row lacks a member whose photo exists
DELETE FROM capture_set_members WHERE image_id = '00000000-0000-4000-8000-000000000114';
SELECT pg_temp.ok((SELECT (a->>'short_existing')::int = 1 AND (a->>'extra')::int = 0 FROM (SELECT public.capture_set_members_agreement() a) x),
  'agreement sees the missing member');
SELECT pg_temp.ok((SELECT c->>'status' = 'failed' AND c->>'reason' = 'members_missing' FROM (SELECT public.capture_set_members_check() c) x),
  'CHECK: a missing member fails the check (members_missing)');
SELECT pg_temp.ok((SELECT reading->>'status' FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement') = 'failed',
  'CHECK: and its assay row reads failed');
-- the job's own command: the run fails, and the failed reading it wrote stays
DELETE FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement';
\set ON_ERROR_STOP off
SELECT command FROM cron.job WHERE jobname = 'capture-set-members-agreement' \gexec
\set ON_ERROR_STOP on
SELECT pg_temp.ok(:'ERROR' = 'true', 'CHECK job: a failed reading fails the run');
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT reading->>'status' = 'failed' AND reading->>'reason' = 'members_missing'
                     FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement'),
  'CHECK job: the failed reading is committed before the run fails');
SELECT pg_temp.ok(pg_temp.backfill_refuses(), 'REFUSE short_existing: the backfill raises instead of marking done');
SELECT pg_temp.ok(NOT coalesce((SELECT (config_value->>'done')::boolean FROM platform_config WHERE config_key = 'capture_set_members_backfill'), false),
  'REFUSE short_existing: not marked done');
-- (b) extra: a row's image_ids loses a photo after its members were written
INSERT INTO capture_set_members (candidate_id, image_id, role, added_run, added_via)
SELECT c.id, '00000000-0000-4000-8000-000000000114', 'unfiled', c.run_id, 'writer' FROM capture_set_candidates c WHERE c.set_key = 's6';
UPDATE capture_set_candidates SET image_ids = '{00000000-0000-4000-8000-000000000113}' WHERE set_key = 's6';
SELECT pg_temp.ok((SELECT (a->>'short_existing')::int = 0 AND (a->>'extra')::int = 1 FROM (SELECT public.capture_set_members_agreement() a) x),
  'agreement sees the extra member');
SELECT pg_temp.ok(pg_temp.backfill_refuses(), 'REFUSE extra: the backfill raises instead of marking done');
UPDATE platform_config SET config_value = config_value || '{"done": true}' WHERE config_key = 'capture_set_members_backfill';
SELECT pg_temp.ok((SELECT c->>'status' = 'failed' AND c->>'reason' = 'members_not_in_image_ids' FROM (SELECT public.capture_set_members_check() c) x),
  'CHECK: an extra member fails the assay (members_not_in_image_ids)');
-- (c) control: with the array put back the same last pass finishes
UPDATE capture_set_candidates SET image_ids = '{00000000-0000-4000-8000-000000000113,00000000-0000-4000-8000-000000000114}' WHERE set_key = 's6';
SELECT pg_temp.ok(NOT pg_temp.backfill_refuses(), 'REFUSE control: agreement restored, the last pass does not raise');
SELECT pg_temp.ok((SELECT (config_value->>'done')::boolean FROM platform_config WHERE config_key = 'capture_set_members_backfill'),
  'REFUSE control: and marks done');
SELECT command FROM cron.job WHERE jobname = 'capture-set-members-agreement' \gexec
SELECT pg_temp.ok(:'ERROR' = 'false', 'CHECK job: an agreeing run succeeds');
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT reading->>'status' FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement') = 'passed',
  'CHECK job: and its reading is passed');

-- ===== REVERT restores production's writer and removes the table and the job
SET client_min_messages = warning;
\ir revert_20261126151500_capture_set_members.sql
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_capture_set_candidates(uuid,uuid,text,jsonb)'::regprocedure)
  = 'ce59756228fdd1f6125e1110a78cecf9', 'REVERT: writer md5 back to production''s');
SELECT pg_temp.ok(to_regclass('public.capture_set_members') IS NULL AND to_regprocedure('public.capture_set_members_backfill(integer)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('capture-set-members-backfill', 'capture-set-members-agreement'))
  AND NOT EXISTS (SELECT 1 FROM job_assay_readings WHERE jobname = 'capture-set-members-agreement')
  AND to_regprocedure('public.capture_set_members_check()') IS NULL AND to_regprocedure('public.capture_set_members_check_raise()') IS NULL
  AND NOT (SELECT (config_value->'jobs') ? 'capture-set-members-backfill' FROM platform_config WHERE config_key = 'auction_close_yield')
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'capture_set_members_backfill'), 'REVERT: table, functions, job and state gone');

-- ===== GUARD: a drifted writer body stops the migration
CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126151500_capture_set_members.sql
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.ok(to_regclass('public.capture_set_members') IS NULL, 'GUARD: a drifted writer stops the migration');
-- production's body back, then the file applies, and a replay of it applies too
CREATE OR REPLACE FUNCTION public.record_capture_set_candidates(p_run_id uuid, p_user uuid, p_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE it jsonb; v_ids uuid[]; v_ok int := 0; v_skip int := 0; v_dup int := 0; v_n int;
BEGIN
  IF p_run_id IS NULL OR p_user IS NULL OR coalesce(p_method, '') = '' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'record_capture_set_candidates: run, user, method and an items array are required';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = (it->>'vehicle_id')::uuid AND v.deleted_at IS NULL
                     AND v.merged_into_vehicle_id IS NULL)
       OR (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids) AND vi.user_id = p_user AND vi.vehicle_id IS NULL)
          <> cardinality(v_ids) THEN
      v_skip := v_skip + 1; CONTINUE;
    END IF;
    INSERT INTO capture_set_candidates (run_id, user_id, set_key, image_ids, vehicle_id, rank, combined, margin, band,
                                        signals, method, created_by)
    VALUES (p_run_id, p_user, it->>'set_key', v_ids, (it->>'vehicle_id')::uuid, (it->>'rank')::smallint,
            (it->>'combined')::numeric, (it->>'margin')::numeric, it->>'band', it->'signals', p_method, 'agent:grok-bot')
    ON CONFLICT (run_id, set_key, vehicle_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'written', v_ok, 'skipped', v_skip, 'duplicate', v_dup);
END $function$;
SET client_min_messages = warning;
\ir ../migrations/20261126151500_capture_set_members.sql
\ir ../migrations/20261126151500_capture_set_members.sql
SET client_min_messages = notice;
SELECT pg_temp.ok(to_regclass('public.capture_set_members') IS NOT NULL
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_capture_set_candidates(uuid,uuid,text,jsonb)'::regprocedure) = 'a59ee3b14324d7e60204738777046867'
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'capture-set-members-backfill') = 1
  AND (SELECT count(*) FROM platform_config c, jsonb_array_elements_text(c.config_value->'jobs') j
        WHERE c.config_key = 'auction_close_yield' AND j = 'capture-set-members-backfill') = 1,
  'GUARD: the file applies and replays cleanly (the job joins the yield rule once)');
\echo 'PASS test_capture_set_members'
