-- Contract: 20261122004200. get_capture_ledger's day rows and totals carry no_file, non_vehicle and junk counts, so the
-- per-state counts of a day (and of the totals) add up to its taken for every state capture_ledger_states can return.
-- Disposable PG17 only, synthetic rows only. capture_ledger_states and capture_ledger_frames are installed by their
-- newest migration (20261116246000), checked against production's prosrc md5 of 2026-11-21; get_capture_ledger is
-- installed as production's body by the revert file, with production's grants.
-- Measured before the migration, after it, after a replay, after the revert and after a re-apply; also checked: owner,
-- grants, security, volatility, language, SET clause, arguments and return type do not move, a replay is a no-op, a
-- moved body is refused (by the migration and by the revert) and is not replaced, and the revert restores the earlier
-- output exactly.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== fixture tables: the columns the ledger and its states reader read
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  created_at timestamptz DEFAULT now(), source text, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  image_url text, thumbnail_url text, file_name text, exif_data jsonb, is_duplicate boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, set_key text,
  image_ids uuid[], reason text, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text);
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);
CREATE TABLE public.capture_non_vehicle_log(image_id uuid NOT NULL, user_id uuid, verdict text NOT NULL, reason text,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.capture_junk_placeholder_log(id bigserial PRIMARY KEY, user_id uuid NOT NULL, image_ids uuid[] NOT NULL,
  reverted_at timestamptz);
CREATE TABLE public.capture_skips(user_id uuid, asset_id text, reason text, taken_at timestamptz, decided_at timestamptz);
CREATE TABLE public.capture_rescan_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  requested_at timestamptz DEFAULT now(), finished_at timestamptz);

-- ===== the readers as production runs them
\ir ../migrations/20261116246000_capture_ledger_empty_url_no_file.sql
SELECT public.t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.capture_ledger_states(uuid,text,date,date)'::regprocedure)
  = '058bf0ef879c0457c4b927b24d659f8d', 'fixture: capture_ledger_states is production''s body');
\ir revert_20261122004200_capture_ledger_buckets_add_up.sql
REVOKE ALL ON FUNCTION public.get_capture_ledger(text, date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_capture_ledger(text, date, date, integer) TO service_role, authenticated;
\set was '933b34c957f1014110284ccc2dc88eae'
\set becomes 'b01cd915a4959c256e1e1e4b315b1fb7'
CREATE FUNCTION public.t_md5() RETURNS text LANGUAGE sql AS $$
  SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)') $$;
CREATE FUNCTION public.t_attrs() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname, p.proconfig::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.get_capture_ledger(text,date,date,integer)') $$;
CREATE TABLE public.t_pins AS SELECT public.t_attrs() AS attrs;
SELECT public.t_assert(public.t_md5() = :'was', 'fixture: get_capture_ledger is production''s body');
SELECT public.t_assert((SELECT attrs FROM public.t_pins)
  = 'postgres | {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres} | t | s | sql | {"search_path=public, pg_temp"} | '
    || 'p_tz text DEFAULT ''America/Los_Angeles''::text, p_from date DEFAULT (CURRENT_DATE - 365), p_to date DEFAULT NULL::date, p_limit integer DEFAULT 180 | jsonb',
  'fixture: owner, grants, security, volatility, language, SET clause, arguments and return type are production''s');

-- ===== rows. Day 2026-03-01: a photo in each of the twelve states, with unequal counts in the three new ones (1 no_file,
-- 2 non_vehicle, 3 junk) so a key counting the wrong state is caught. Day 2026-03-02: two photos in old states only.
-- Day 2026-03-03: one skip and no photo. Another user's photo on 03-01 must not count.
\set U '00000000-0000-4000-8000-0000000000aa'
INSERT INTO public.vehicles VALUES ('00000000-0000-4000-8000-0000000000c1', 1970, 'Fixture', 'One');
INSERT INTO public.vehicle_images(id, user_id, vehicle_id, taken_at, source, vision_gate_status, image_url, is_duplicate, duplicate_of) VALUES
  ('00000000-0000-4000-8000-000000000001', :'U', NULL, '2026-03-01 10:01+00', 'capture_relay_ios', 'rejected_personal', 'https://example.test/1.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000002', :'U', NULL, '2026-03-01 10:02+00', 'capture_relay_ios', 'rejected_misattributed', 'https://example.test/2.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000003', :'U', '00000000-0000-4000-8000-0000000000c1', '2026-03-01 10:03+00', 'capture_relay_ios', 'approved', 'https://example.test/3.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000004', :'U', '00000000-0000-4000-8000-0000000000c1', '2026-03-01 10:04+00', 'capture_relay_ios', 'pending', 'https://example.test/4.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000005', :'U', NULL, '2026-03-01 10:05+00', 'capture_relay_ios', 'pending', 'https://example.test/5.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000006', :'U', NULL, '2026-03-01 10:06+00', 'capture_relay_ios', 'pending', 'https://example.test/6.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000007', :'U', NULL, '2026-03-01 10:07+00', 'capture_relay_ios', 'pending', 'https://example.test/7.jpg', true, '00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000008', :'U', NULL, '2026-03-01 10:08+00', 'capture_relay_ios', 'pending', 'https://example.test/8.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000009', :'U', NULL, '2026-03-01 10:09+00', 'capture_relay_ios', 'pending', 'https://example.test/9.jpg', false, NULL),
  ('00000000-0000-4000-8000-00000000000a', :'U', NULL, '2026-03-01 10:10+00', 'capture_relay_ios', 'pending', 'https://example.test/a.jpg', false, NULL),
  ('00000000-0000-4000-8000-00000000000b', :'U', NULL, '2026-03-01 10:11+00', 'capture_relay_ios', 'pending', NULL, false, NULL),
  ('00000000-0000-4000-8000-00000000000c', :'U', NULL, '2026-03-01 10:12+00', 'user_upload', 'pending', 'https://example.test/c.jpg', false, NULL),
  ('00000000-0000-4000-8000-00000000000d', :'U', NULL, '2026-03-01 10:13+00', 'capture_relay_ios', 'pending', 'https://example.test/d.jpg', false, NULL),
  ('00000000-0000-4000-8000-00000000000e', :'U', NULL, '2026-03-01 10:14+00', 'capture_relay_ios', 'pending', 'https://example.test/e.jpg', false, NULL),
  ('00000000-0000-4000-8000-00000000000f', :'U', NULL, '2026-03-01 10:15+00', 'capture_relay_ios', 'pending', 'https://example.test/f.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000021', :'U', '00000000-0000-4000-8000-0000000000c1', '2026-03-02 10:00+00', 'capture_relay_ios', 'approved', 'https://example.test/21.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000022', :'U', NULL, '2026-03-02 10:01+00', 'user_upload', 'pending', 'https://example.test/22.jpg', false, NULL),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-0000000000bb', NULL, '2026-03-01 10:00+00', 'capture_relay_ios', 'pending', NULL, false, NULL);
INSERT INTO public.capture_non_vehicle_log(image_id, user_id, verdict, reason) VALUES ('00000000-0000-4000-8000-000000000005', :'U', 'non_vehicle', 'fixture'),
  ('00000000-0000-4000-8000-00000000000d', :'U', 'non_vehicle', 'fixture');
INSERT INTO public.capture_junk_placeholder_log(user_id, image_ids) VALUES (:'U', ARRAY['00000000-0000-4000-8000-000000000006'::uuid,
  '00000000-0000-4000-8000-00000000000e'::uuid]), (:'U', ARRAY['00000000-0000-4000-8000-00000000000f'::uuid]);
INSERT INTO public.capture_upload_status VALUES ('00000000-0000-4000-8000-000000000008', :'U', 'failed', 'fixture_error');
INSERT INTO public.capture_landing_chunks(id, user_id, state) VALUES ('00000000-0000-4000-8000-0000000000d1', :'U', 'awaiting_gate');
INSERT INTO public.capture_landing_sets VALUES ('00000000-0000-4000-8000-0000000000d1', 'set-9', ARRAY['00000000-0000-4000-8000-000000000009'::uuid], 'clear');
INSERT INTO public.capture_set_review(user_id, set_key, image_ids, reason) VALUES (:'U', 'set-a', ARRAY['00000000-0000-4000-8000-00000000000a'::uuid], 'fixture_hold');
INSERT INTO public.capture_skips VALUES (:'U', 'asset-skip-1', 'off_site', '2026-03-03 10:00+00', '2026-03-03 11:00+00');

SELECT public.t_assert((SELECT string_agg(state || '=' || n, ',' ORDER BY state COLLATE "C") FROM (
    SELECT state, count(*) n FROM public.capture_ledger_states(:'U', 'UTC', '2026-03-01', '2026-03-01') GROUP BY 1) s)
  = 'duplicate=1,failed=1,held=1,junk=3,no_file=1,non_vehicle=2,on_vehicle=1,private=1,pulled=1,unsorted=1,unverified=1,waiting=1',
  'fixture: 2026-03-01 holds a photo in each of the twelve states the reader returns (1 no_file, 2 non_vehicle, 3 junk)');
-- every state the reader can return (its CASE has these twelve arms and an ELSE)
SELECT public.t_assert((SELECT count(DISTINCT m[1]) FROM regexp_matches(
    (SELECT prosrc FROM pg_proc WHERE oid = 'public.capture_ledger_states(uuid,text,date,date)'::regprocedure),
    $re$(?:THEN|ELSE) '(on_vehicle|unverified|waiting|held|pulled|private|unsorted|failed|duplicate|no_file|non_vehicle|junk)'$re$, 'g') m) = 12,
  'fixture: the reader''s state CASE names all twelve states');

-- helpers: the ledger as the signed-in owner, without its clock; the twelve counts summed; the payload without the new keys
CREATE FUNCTION public.t_ledger(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000000aa"}', true);
  RETURN public.get_capture_ledger('UTC', p_from, p_to, 180) - 'generated_at';
END $$;
CREATE FUNCTION public.t_sum(o jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT sum(coalesce((o->>k)::bigint, 0)) FROM unnest(ARRAY['on_vehicle','unverified','waiting','held','pulled','private',
    'unsorted','failed','duplicate','no_file','non_vehicle','junk']) k $$;
CREATE FUNCTION public.t_old(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(jsonb_set(j, '{totals}', (j->'totals') - ARRAY['no_file','non_vehicle','junk']), '{days}',
    coalesce((SELECT jsonb_agg(d - ARRAY['no_file','non_vehicle','junk'] ORDER BY o) FROM jsonb_array_elements(j->'days') WITH ORDINALITY e(d, o)), '[]'::jsonb)) $$;
CREATE FUNCTION public.t_new(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(coalesce(x->>'day', 'totals') || ':' || coalesce(x->>'no_file', '-') || '/' || coalesce(x->>'non_vehicle', '-') || '/'
    || coalesce(x->>'junk', '-'), ',' ORDER BY o)
  FROM (SELECT d AS x, o FROM jsonb_array_elements(j->'days') WITH ORDINALITY e(d, o) UNION ALL SELECT j->'totals', 999999) s $$;
CREATE FUNCTION public.t_day(j jsonb, p_day text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT d FROM jsonb_array_elements(j->'days') d WHERE d->>'day' = p_day $$;
CREATE TABLE public.t_got(step text PRIMARY KEY, all_days jsonb, old_only jsonb);
CREATE FUNCTION public.t_take(p_step text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_got VALUES (p_step, public.t_ledger(NULL, NULL), public.t_ledger('2026-03-02', NULL)) $$;

-- ===== before: the gap
SELECT public.t_take('before');
SELECT public.t_assert((SELECT (public.t_day(all_days, '2026-03-01')->>'taken')::int = 15
    AND public.t_sum(public.t_day(all_days, '2026-03-01')) = 9 AND public.t_new(all_days) = '2026-03-03:-/-/-,2026-03-02:-/-/-,2026-03-01:-/-/-,totals:-/-/-'
    FROM public.t_got WHERE step = 'before'),
  'before (the gap): 15 photos taken on 2026-03-01, the named counts sum to 9, and no key says where the other 6 are');

-- ===== the migration
\ir ../migrations/20261122004200_capture_ledger_buckets_add_up.sql
SELECT public.t_assert(public.t_md5() = :'becomes', 'get_capture_ledger is the body the migration names');
SELECT public.t_assert(public.t_attrs() = (SELECT attrs FROM public.t_pins),
  'owner, grants, security, volatility, language, SET clause, arguments and return type are unchanged');
SET ROLE authenticated;
SELECT public.t_assert((public.t_ledger(NULL, NULL)->'totals'->>'taken')::int = 17, 'a signed-in caller can still read the ledger');
RESET ROLE;
SELECT public.t_take('after');
SELECT public.t_assert((SELECT public.t_day(all_days, '2026-03-01')->>'no_file' = '1' AND public.t_day(all_days, '2026-03-01')->>'non_vehicle' = '2'
    AND public.t_day(all_days, '2026-03-01')->>'junk' = '3'
    AND (SELECT bool_and(jsonb_typeof(public.t_day(all_days, '2026-03-01')->k) = 'number') FROM unnest(ARRAY['no_file','non_vehicle','junk']) k)
    FROM public.t_got WHERE step = 'after'),
  'after: the day holding every state counts 1 no_file, 2 non_vehicle and 3 junk, as numbers');
SELECT public.t_assert((SELECT public.t_sum(public.t_day(all_days, '2026-03-01')) = (public.t_day(all_days, '2026-03-01')->>'taken')::bigint
    AND public.t_sum(public.t_day(all_days, '2026-03-01')) = 15 FROM public.t_got WHERE step = 'after'),
  'after: that day''s twelve counts sum to its taken (15)');
SELECT public.t_assert((SELECT (SELECT bool_and(public.t_sum(d) = (d->>'taken')::bigint) FROM jsonb_array_elements(all_days->'days') d)
    AND public.t_sum(all_days->'totals') = (all_days->'totals'->>'taken')::bigint AND (all_days->'totals'->>'taken')::int = 17
    FROM public.t_got WHERE step = 'after'),
  'after: every day''s counts and the totals'' counts sum to taken (totals 17, the other user''s photo not counted)');
SELECT public.t_assert((SELECT public.t_new(all_days) = '2026-03-03:0/0/0,2026-03-02:0/0/0,2026-03-01:1/2/3,totals:1/2/3' FROM public.t_got WHERE step = 'after'),
  'after: the new keys are on every day row, 0 on a day without such photos and on a skip-only day, and in the totals');
SELECT public.t_assert((SELECT public.t_old(a.old_only) = b.old_only
    AND public.t_new(a.old_only) = '2026-03-03:0/0/0,2026-03-02:0/0/0,totals:0/0/0'
    FROM public.t_got a, public.t_got b WHERE a.step = 'after' AND b.step = 'before'),
  'after: a window with no photo in the three states returns the old keys with the old values plus three zeros');
SELECT public.t_assert((SELECT public.t_old(a.all_days) = b.all_days FROM public.t_got a, public.t_got b WHERE a.step = 'after' AND b.step = 'before'),
  'after: every existing key keeps its value, with the same days in the same order');

-- ===== replay: nothing moves
\ir ../migrations/20261122004200_capture_ledger_buckets_add_up.sql
SELECT public.t_take('replay');
SELECT public.t_assert(public.t_md5() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins)
  AND (SELECT a.all_days = b.all_days AND a.old_only = b.old_only FROM public.t_got a, public.t_got b WHERE a.step = 'replay' AND b.step = 'after'),
  'replay: the body, its attributes and its output are left as they are');

-- ===== revert: production's earlier body and the earlier output
\ir revert_20261122004200_capture_ledger_buckets_add_up.sql
SELECT public.t_take('reverted');
SELECT public.t_assert(public.t_md5() = :'was' AND public.t_attrs() = (SELECT attrs FROM public.t_pins), 'revert: the earlier body, attributes unchanged');
SELECT public.t_assert((SELECT a.all_days = b.all_days AND a.old_only = b.old_only FROM public.t_got a, public.t_got b WHERE a.step = 'reverted' AND b.step = 'before'),
  'revert: the earlier output is back exactly');
\ir revert_20261122004200_capture_ledger_buckets_add_up.sql
SELECT public.t_assert(public.t_md5() = :'was', 'a second revert changes nothing');

-- ===== refused: a body that moved since the migration was written is replaced by neither file
CREATE TABLE public.t_def AS SELECT pg_get_functiondef('public.get_capture_ledger(text,date,date,integer)'::regprocedure) AS def;
DO $$ BEGIN EXECUTE replace((SELECT def FROM public.t_def), 'LIMIT GREATEST', 'LIMIT  GREATEST'); END $$;
CREATE TABLE public.t_moved AS SELECT public.t_md5() AS m;
SELECT public.t_assert((SELECT m FROM public.t_moved) NOT IN (:'was', :'becomes'), 'fixture: the ledger body has moved');
\set ON_ERROR_STOP off
\ir ../migrations/20261122004200_capture_ledger_buckets_add_up.sql
\ir revert_20261122004200_capture_ledger_buckets_add_up.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.t_md5() = (SELECT m FROM public.t_moved) AND public.t_attrs() = (SELECT attrs FROM public.t_pins),
  'refused: a moved body is overwritten by neither the migration nor the revert');
DO $$ BEGIN EXECUTE (SELECT def FROM public.t_def); END $$;
SELECT public.t_assert(public.t_md5() = :'was', 'fixture: production''s body is back');

-- ===== applied again from the reverted state: the same body and the same output
\ir ../migrations/20261122004200_capture_ledger_buckets_add_up.sql
SELECT public.t_take('again');
SELECT public.t_assert(public.t_md5() = :'becomes' AND public.t_attrs() = (SELECT attrs FROM public.t_pins)
  AND (SELECT a.all_days = b.all_days AND a.old_only = b.old_only FROM public.t_got a, public.t_got b WHERE a.step = 'again' AND b.step = 'after'),
  'applied again from the reverted state: the same body and the same output');
\echo 'capture ledger buckets add up contract passed'
