-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_public_text_guard -f this-file.sql
-- Proves that after 20261020193000_public_text_contact_guard.sql a signed-in writer cannot put a phone number or an
-- e-mail address into a public comment (four comment tables, record_interaction) or a profile bio, and is told why; that
-- links (memes, photos) and ordinary text still post; that legacy rows can still be edited in other columns; and that
-- system writes have the details redacted instead of refused. Starts from the live functions
-- (helpers/public_text_live_20261020.sql) and shows each write landing there first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.user_comments') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, bio text);
CREATE TABLE public.work_orders (id uuid PRIMARY KEY, customer_id uuid, customer_name text);
CREATE TABLE public.user_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, comment_text text, target_type text, pinned boolean DEFAULT false);
CREATE TABLE public.vehicle_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, comment_text text);
CREATE TABLE public.timeline_event_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, user_id uuid, comment_text text);
CREATE TABLE public.vehicle_image_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid, user_id uuid, comment_text text);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_comments', 'vehicle_comments', 'timeline_event_comments', 'vehicle_image_comments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read_all ON public.%I FOR SELECT USING (true)', t);
  END LOOP;
END $$;
CREATE POLICY own_profile ON public.profiles FOR UPDATE USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY "Authenticated users can create comments" ON public.user_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own comments" ON public.user_comments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can create vehicle comments" ON public.vehicle_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can create timeline event comments" ON public.timeline_event_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can create comments" ON public.vehicle_image_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
\ir helpers/public_text_live_20261020.sql
GRANT EXECUTE ON FUNCTION public.text_redact_contact(text), public.record_interaction(text, text, uuid, jsonb) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_is(p_got text, p_want text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', p_what, p_got, p_want; END IF; END $$;
-- Runs one write as the caller: 'ok' when it lands, otherwise the message it raised.
CREATE FUNCTION public.t_write(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.t_is(text, text, text), public.t_write(text) TO anon, authenticated, service_role;
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'KDc+zsUdsAJCAS5t45O1J/r39CqcMjNQcfgUeDBrTU8=',
  'fixture: record_interaction as live') FROM pg_proc WHERE oid = 'public.record_interaction(text,text,uuid,jsonb)'::regprocedure;

INSERT INTO public.profiles (id, bio) VALUES ('20000000-0000-0000-0000-0000000000b1', 'Restorer');
-- A legacy comment that already carries a number (as 2 live rows do).
INSERT INTO public.user_comments (vehicle_id, user_id, comment_text, target_type)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'Call me 702 555 0123', 'vehicle');

\set refusal '''Please don''''t share phone numbers or emails here — people reach you through Nuke'''
\set v1 '''10000000-0000-0000-0000-000000000001'''
\set b1 '''20000000-0000-0000-0000-0000000000b1'''

-- 1. Before: every surface takes contact details.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
BEGIN;
SELECT public.t_is(public.t_write($q$INSERT INTO public.vehicle_comments (vehicle_id, user_id, comment_text)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'Text me 702-555-0123')$q$), 'ok', 'before: a comment takes a phone number');
SELECT public.t_is(public.record_interaction('comment', 'vehicle', :v1, '{"text": "email me at me@example.invalid"}') ->> 'ok', 'true',
  'before: record_interaction posts an e-mail address');
SELECT public.t_is(public.t_write($q$UPDATE public.profiles SET bio = 'Reach me: 702.555.0123' WHERE id = '20000000-0000-0000-0000-0000000000b1'$q$), 'ok',
  'before: a bio takes a phone number');
ROLLBACK;
RESET ROLE;

-- 2. The migration, twice.
SET test.auth_role = '';
SET test.auth_uid = '';
\ir ../migrations/20261020193000_public_text_contact_guard.sql
\ir ../migrations/20261020193000_public_text_contact_guard.sql

-- 3. After.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_is(public.t_write($q$INSERT INTO public.user_comments (vehicle_id, user_id, comment_text, target_type)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'Text me 702-555-0123', 'vehicle')$q$), :refusal,
  'after: user_comments refuses a phone number with the message');
SELECT public.t_is(public.t_write($q$INSERT INTO public.vehicle_comments (vehicle_id, user_id, comment_text)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'me@example.invalid')$q$), :refusal,
  'after: vehicle_comments refuses an e-mail address');
SELECT public.t_is(public.t_write($q$INSERT INTO public.timeline_event_comments (event_id, user_id, comment_text)
  VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', '(702) 555-0123')$q$), :refusal,
  'after: timeline_event_comments refuses a phone number');
SELECT public.t_is(public.t_write($q$INSERT INTO public.vehicle_image_comments (image_id, vehicle_id, user_id, comment_text)
  VALUES ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'call 7025550123')$q$), :refusal,
  'after: vehicle_image_comments refuses a phone number');
SELECT public.t_is(public.t_write($q$UPDATE public.profiles SET bio = 'Reach me: 702.555.0123' WHERE id = '20000000-0000-0000-0000-0000000000b1'$q$), :refusal,
  'after: a bio refuses a phone number');
SELECT public.t_is(public.record_interaction('comment', 'vehicle', :v1, '{"text": "email me at me@example.invalid"}')::text,
  '{"ok": false, "error": "contact_details", "message": "Please don''t share phone numbers or emails here — people reach you through Nuke"}',
  'after: record_interaction answers contact_details with the message and writes nothing');
BEGIN;
SELECT public.t_is(public.record_interaction('comment', 'vehicle', :v1, '{"text": "Gorgeous color, 1967 427 with 45,123 miles"}') ->> 'ok', 'true',
  'after: an ordinary comment posts');
SELECT public.t_is(public.t_write($q$INSERT INTO public.user_comments (vehicle_id, user_id, comment_text, target_type)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1',
  '[meme:Nice](https://example.supabase.co/storage/v1/object/public/memes/1697040000000-meme.png)', 'vehicle')$q$), 'ok',
  'after: a meme link with a long digit run posts');
SELECT public.t_is(public.t_write($q$UPDATE public.user_comments SET pinned = true WHERE comment_text = 'Call me 702 555 0123'$q$), 'ok',
  'after: a legacy comment can still be changed in other columns');
ROLLBACK;
RESET ROLE;
SET test.auth_role = 'service_role';
SET test.auth_uid = '';
INSERT INTO public.vehicle_comments (vehicle_id, user_id, comment_text)
  VALUES ('10000000-0000-0000-0000-000000000001', NULL, 'Imported: call 702-555-0123 or a@example.invalid');
SELECT public.t_is((SELECT comment_text FROM public.vehicle_comments WHERE user_id IS NULL),
  'Imported: call [contact through Nuke] or [contact through Nuke]', 'after: a system write has the details redacted');
SELECT public.t_is((SELECT count(*) FROM public.user_comments)::text, '1', 'after: no refused comment was written');

SELECT 'public text contact guard: ok' AS result;
