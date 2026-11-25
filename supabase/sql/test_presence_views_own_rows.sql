-- Contract: 20261125091500. user_presence and vehicle_views answer each caller only its own rows: anon reads 0, a
-- second signed-in user reads 0 of the first's, the owner reads its own. Inserts name the caller or nobody; the web's
-- signed-in presence upsert still works and an anonymous one is refused. The revert restores the open policies.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_presence_views_own_rows%' OR to_regclass('public.user_presence') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_presence_views_own_rows* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

-- The live shapes, grants and policies as measured 2026-11-24 (Pacific).
CREATE TABLE public.user_presence(id bigserial PRIMARY KEY, vehicle_id uuid NOT NULL, user_id uuid,
  last_seen_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX user_presence_vehicle_user_unique ON public.user_presence(vehicle_id, user_id);
CREATE TABLE public.vehicle_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid,
  viewed_at timestamptz DEFAULT now(), ip_address text);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_views ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.user_presence TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.user_presence_id_seq TO anon, authenticated;
GRANT SELECT, INSERT ON public.vehicle_views TO anon, authenticated;
CREATE POLICY "Anyone can create presence" ON public.user_presence FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view presence" ON public.user_presence FOR SELECT USING (true);
CREATE POLICY user_presence_insert_any ON public.user_presence FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY user_presence_select_all ON public.user_presence FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY user_presence_update_self ON public.user_presence FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY view_insert ON public.vehicle_views FOR INSERT WITH CHECK (true);
CREATE POLICY view_select ON public.vehicle_views FOR SELECT USING (true);

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.refused(text) TO anon, authenticated;

-- Users A (...a1) and B (...b2); vehicle V; rows for A, for B and an anonymous one in each table.
INSERT INTO public.user_presence(vehicle_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c1', NULL);
INSERT INTO public.vehicle_views(vehicle_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000c1', NULL);

-- Before: anon reads every row of both tables.
SET ROLE anon; SET request.jwt.claims = '{"role":"anon"}';
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 3, 'before: anon reads all presence rows');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views) = 3, 'before: anon reads all view rows');
RESET ROLE; RESET request.jwt.claims;

\i supabase/migrations/20261125091500_presence_views_own_rows.sql

-- Anon: 0 rows of either table; it can still file an anonymous view, never one naming a user.
SET ROLE anon; SET request.jwt.claims = '{"role":"anon"}';
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 0, 'anon reads 0 presence rows');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views) = 0, 'anon reads 0 view rows');
INSERT INTO public.vehicle_views(vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c1', NULL);
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_views(vehicle_id, user_id)
  VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1')$q$), 'anon cannot file a view naming a user');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.user_presence(vehicle_id, user_id)
  VALUES ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1')$q$), 'anon cannot file presence naming a user');
-- The web's heartbeat shape (an upsert): anonymous is refused, which is why the web now beats only when signed in.
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.user_presence(vehicle_id, user_id, last_seen_at)
  VALUES ('00000000-0000-0000-0000-0000000000c1', NULL, now()) ON CONFLICT (vehicle_id, user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at$q$),
  'an anonymous presence upsert is refused');
RESET ROLE; RESET request.jwt.claims;

-- User B: its own row only, never A's; cannot file rows naming A.
SET ROLE authenticated; SET request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b2"}';
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 1, 'B reads 1 presence row');
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence WHERE user_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'B reads 0 of A''s presence');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views WHERE user_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'B reads 0 of A''s views');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views WHERE user_id IS NULL) = 0, 'B reads 0 anonymous views');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_views(vehicle_id, user_id)
  VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1')$q$), 'B cannot file a view naming A');
RESET ROLE; RESET request.jwt.claims;

-- User A: reads its own rows; the signed-in heartbeat upsert inserts and then updates its row.
SET ROLE authenticated; SET request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 1, 'A reads its own presence row');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views) = 1, 'A reads its own view row');
INSERT INTO public.vehicle_views(vehicle_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.user_presence(vehicle_id, user_id, last_seen_at)
  VALUES ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1', now() - interval '1 minute')
  ON CONFLICT (vehicle_id, user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
INSERT INTO public.user_presence(vehicle_id, user_id, last_seen_at)
  VALUES ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1', now())
  ON CONFLICT (vehicle_id, user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 2, 'A''s heartbeat upsert keeps one row per car');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views) = 2, 'A reads its two views');
RESET ROLE; RESET request.jwt.claims;

-- Revert restores the open reads.
\i supabase/sql/revert_20261125091500_presence_views_own_rows.sql
SET ROLE anon; SET request.jwt.claims = '{"role":"anon"}';
SELECT pg_temp.ok((SELECT count(*) FROM public.user_presence) = 4, 'revert: anon reads all presence rows again');
SELECT pg_temp.ok((SELECT count(*) FROM public.vehicle_views) = 5, 'revert: anon reads all view rows again');
RESET ROLE; RESET request.jwt.claims;
SELECT 'presence_views_own_rows contract passed' AS result;
