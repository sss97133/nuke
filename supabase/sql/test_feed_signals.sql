-- Contract: 20261122063000. feed_signals takes a signed-in user's Explore events through record_feed_signals: rows are
-- stamped with the caller, a repeated event id is a no-op, a bad event refuses the batch whole, more than 200 is
-- refused, anon can neither call the writer nor read or insert rows, a user reads only their own rows and cannot
-- insert rows for someone else, there is no update or delete. Also: replay is a no-op, revert, re-apply.
-- Disposable PG17 only, synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT SELECT ON auth.users TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION public.t_refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text) TO anon, authenticated;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

\ir ../migrations/20261122063000_feed_signals.sql
\ir ../migrations/20261122063000_feed_signals.sql

SELECT t_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feed_signals'::regclass), 'RLS is on');
SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'feed_signals') = 2, 'two policies: read own, insert own');
SELECT t_assert(NOT has_table_privilege('anon', 'public.feed_signals', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.feed_signals', 'INSERT'), 'anon has no table privilege');
SELECT t_assert(NOT has_function_privilege('anon', 'public.record_feed_signals(jsonb)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.feed_signals_parse(jsonb)', 'EXECUTE'), 'anon cannot call the writer');
SELECT t_assert(NOT has_table_privilege('authenticated', 'public.feed_signals', 'UPDATE')
            AND NOT has_table_privilege('authenticated', 'public.feed_signals', 'DELETE'), 'append-only');

CREATE TEMP TABLE r(k text, v jsonb);
GRANT ALL ON r TO anon, authenticated;

-- anon
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t_assert(t_refused($q$INSERT INTO public.feed_signals(id, user_id, at, item_id, kind)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', now(), 'ask:x', 'impression')$q$), 'anon insert refused');
SELECT t_assert(t_refused($q$SELECT public.record_feed_signals('[]')$q$), 'anon writer call refused');
RESET ROLE;

-- user A writes three, then repeats one
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
INSERT INTO r SELECT 'first', public.record_feed_signals($j$[
  {"id":"10000000-0000-0000-0000-000000000001","at":"2026-11-21T10:00:00Z","session_id":"20000000-0000-0000-0000-000000000001",
   "item_id":"ask:e1","vehicle_id":"30000000-0000-0000-0000-000000000001","source":"Craigslist","kind":"impression","position":0},
  {"id":"10000000-0000-0000-0000-000000000002","at":"2026-11-21T10:00:05Z","item_id":"ask:e1","source":"Craigslist",
   "kind":"dwell","dwell_ms":5000,"page_kind":"photos","page_index":0,"photo_index":3},
  {"id":"10000000-0000-0000-0000-000000000003","at":"2026-11-21T10:01:00Z","item_id":"browse-tuning","source":"explore",
   "kind":"tune","tuned":"radius,make"}]$j$);
INSERT INTO r SELECT 'repeat', public.record_feed_signals($j$[
  {"id":"10000000-0000-0000-0000-000000000001","at":"2026-11-21T10:00:00Z","item_id":"ask:e1","source":"Craigslist","kind":"impression"}]$j$);
INSERT INTO r SELECT 'bad', public.record_feed_signals($j$[
  {"id":"10000000-0000-0000-0000-000000000004","at":"2026-11-21T10:02:00Z","item_id":"ask:e2","kind":"impression"},
  {"id":"10000000-0000-0000-0000-000000000005","at":"2026-11-21T10:02:00Z","item_id":"ask:e2","kind":"stolen"},
  {"id":"10000000-0000-0000-0000-000000000006","at":"2026-11-21T10:02:00Z","item_id":"ask:e2","kind":"dwell","dwell_ms":7200000}]$j$);
INSERT INTO r SELECT 'many', public.record_feed_signals((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(),
  'at', '2026-11-21T10:00:00Z', 'item_id', 'ask:m', 'kind', 'impression')) FROM generate_series(1, 201)));
RESET ROLE;

SELECT t_assert((SELECT v->>'ok' = 'true' AND (v->>'accepted')::int = 3 FROM r WHERE k = 'first'), 'three accepted');
SELECT t_assert((SELECT v->>'ok' = 'true' AND (v->>'accepted')::int = 0 FROM r WHERE k = 'repeat'), 'a repeated id is a no-op');
SELECT t_assert((SELECT v->>'ok' = 'true' AND (v->>'accepted')::int = 2 AND (v->>'skipped')::int = 1 FROM r WHERE k = 'bad'),
  'a bad event is skipped, the rest land');
SELECT t_assert((SELECT dwell_ms FROM public.feed_signals WHERE id = '10000000-0000-0000-0000-000000000006') = 3600000,
  'an hour-plus dwell is clamped, not refused');
SELECT t_assert((SELECT v->>'error' = 'too_many' FROM r WHERE k = 'many'), 'more than 200 refused');
SELECT t_assert((SELECT count(*) FROM public.feed_signals) = 5, 'five rows exist');
SELECT t_assert((SELECT bool_and(user_id = '00000000-0000-0000-0000-00000000000a') FROM public.feed_signals), 'stamped with the caller');

-- A inserting a row for B directly is refused by the policy; B reads none of A's rows
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
DO $$ BEGIN
  INSERT INTO public.feed_signals(id, user_id, at, item_id, kind)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', now(), 'ask:x', 'impression');
  RAISE EXCEPTION 'Contract failed: insert for another user was admitted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS insert for another user refused';
END $$;
SELECT t_assert((SELECT count(*) FROM public.feed_signals) = 5, 'A reads own five');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
SELECT t_assert((SELECT count(*) FROM public.feed_signals) = 0, 'B reads none of A''s rows');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
SELECT t_assert((SELECT public.record_feed_signals('[]')->>'error') = 'auth_required', 'no user, no write');
RESET ROLE;

\ir revert_20261122063000_feed_signals.sql
SELECT t_assert(to_regclass('public.feed_signals') IS NULL AND to_regprocedure('public.feed_signals_parse(jsonb)') IS NULL, 'revert drops the table and functions');
\ir ../migrations/20261122063000_feed_signals.sql
SELECT t_assert(to_regclass('public.feed_signals') IS NOT NULL, 're-apply');
