-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_user_calendar -f this-file.sql
-- Proves that the user contribution calendar carries a day's work cost only to the signed-in user whose
-- sessions they are, and the same calendar with work_cost null and money_masked true to anyone else.
-- Starts from the live definition, then applies the migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.work_sessions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

-- The tables the calendar reads, with the columns it uses.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event_date date);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, session_date date, duration_minutes integer, total_job_cost numeric);
GRANT USAGE ON SCHEMA public, auth TO authenticated;

\ir helpers/get_user_contribution_calendar_live_20261013.sql
GRANT EXECUTE ON FUNCTION public.get_user_contribution_calendar(uuid) TO authenticated;
\ir ../migrations/20261013171500_user_calendar_money_owner_only.sql

-- Seeds (a disposable database, never production): one user with a photo, an event and two sessions on one day.
INSERT INTO public.vehicle_images (user_id, taken_at) VALUES ('20000000-0000-0000-0000-000000000001', '2025-01-24T15:00:00Z');
INSERT INTO public.vehicle_timeline_events (user_id, event_date) VALUES ('20000000-0000-0000-0000-000000000001', '2025-01-24');
INSERT INTO public.work_sessions (user_id, session_date, duration_minutes, total_job_cost) VALUES
 ('20000000-0000-0000-0000-000000000001', '2025-01-24', 120, 300.50),
 ('20000000-0000-0000-0000-000000000001', '2025-01-24', 60, 120);

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO authenticated;

SET ROLE authenticated;
-- 1. Another signed-in user: the day with its cost masked, everything else kept.
SET test.auth_uid = '20000000-0000-0000-0000-000000000009';
DO $$
DECLARE c jsonb;
BEGIN
  c := public.get_user_contribution_calendar('20000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(jsonb_array_length(c) = 1 AND c->0->>'day' = '2025-01-24', format('one day; got %s', c));
  PERFORM public.t_assert(c->0->'work_cost' = 'null'::jsonb AND c->0->'money_masked' = 'true'::jsonb, format('stranger: work cost masked; got %s', c->0));
  PERFORM public.t_assert((c->0->>'photos')::int = 1 AND (c->0->>'events')::int = 1 AND (c->0->>'work')::int = 2 AND (c->0->>'work_minutes')::int = 180,
    'stranger: photos, events, sessions and minutes kept');
END $$;
-- 2. No user at all (anonymous session): masked.
SET test.auth_uid = '';
SELECT public.t_assert(public.get_user_contribution_calendar('20000000-0000-0000-0000-000000000001')->0->'money_masked' = 'true'::jsonb, 'no user: masked');
-- 3. The user: the cost, rounded as before.
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE c jsonb;
BEGIN
  c := public.get_user_contribution_calendar('20000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert((c->0->>'work_cost')::numeric = 421 AND c->0->'money_masked' = 'false'::jsonb, format('user: work cost present; got %s', c->0));
END $$;
RESET ROLE;
SELECT 'user calendar money mask contract: PASS' AS result;
