-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.user_notifications') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
CREATE TABLE public.user_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text,
  metadata jsonb, is_read boolean DEFAULT false, created_at timestamptz DEFAULT now(), organization_id uuid, notification_type text,
  vehicle_id uuid, image_id uuid, from_user_id uuid, action_url text, read_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
INSERT INTO user_notifications(user_id,type,title,is_read,from_user_id,created_at) VALUES
 ('10000000-0000-0000-0000-00000000000a','offer','A1',false,'10000000-0000-0000-0000-00000000000c','2026-01-02'),
 ('10000000-0000-0000-0000-00000000000a','offer','A2',true,NULL,'2026-01-03'),
 ('10000000-0000-0000-0000-00000000000b','offer','B1',false,NULL,'2026-01-01');

\ir ../migrations/20261020031000_notification_readers_identity_check.sql

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid), public.get_recent_notifications(uuid,integer) TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT t_assert(get_unread_notification_count('10000000-0000-0000-0000-00000000000a')=1,'the caller counts their own unread');
SELECT t_assert(t_refused($q$SELECT get_unread_notification_count('10000000-0000-0000-0000-00000000000b')$q$),'another account''s count is refused');
SELECT t_assert((SELECT count(*) FROM get_recent_notifications('10000000-0000-0000-0000-00000000000a'))=2,'the caller reads their own notifications');
SELECT t_assert((SELECT title FROM get_recent_notifications('10000000-0000-0000-0000-00000000000a') LIMIT 1)='A1','unread first');
SELECT t_assert((SELECT related_user_id='10000000-0000-0000-0000-00000000000c' AND is_responded IS NULL AND priority IS NULL
  FROM get_recent_notifications('10000000-0000-0000-0000-00000000000a') WHERE title='A1'),'from_user_id as related_user_id; unrecorded fields unknown');
SELECT t_assert((SELECT count(*) FROM get_recent_notifications('10000000-0000-0000-0000-00000000000a',1000))=2 AND
  (SELECT count(*) FROM get_recent_notifications('10000000-0000-0000-0000-00000000000a',0))=1,'limit clamped to 1..100');
SELECT t_assert(t_refused($q$SELECT * FROM get_recent_notifications('10000000-0000-0000-0000-00000000000b')$q$),'another account''s notifications are refused');
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_assert(t_refused($q$SELECT get_unread_notification_count('10000000-0000-0000-0000-00000000000a')$q$),'a JWT without a user is refused');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT t_assert(get_unread_notification_count('10000000-0000-0000-0000-00000000000b')=1,'service role is exempt');
