-- Disposable PG17 only. Proves 20261020002000_owner_delegated_signs.sql: the register is service-only and append-only
-- (only rolled_back false -> true), its row commits iff the Sign's transaction commits, registering before any write is
-- refused, personal information in args is refused, only the named owner can be registered, and the open reader shows
-- counts and clocks without arguments, references, sessions or the authorization wording.
-- Fixture: auth.users, admin_users, profiles and platform_person_label as live on 2026-10-19.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.owner_delegated_signs') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, is_public boolean, email text);
CREATE FUNCTION public.platform_person_label(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT CASE WHEN p_user IS NULL THEN NULL ELSE COALESCE(
    (SELECT jsonb_build_object('kind', 'user', 'profile_id', p.id, 'handle', p.username) FROM public.profiles p
      WHERE p.id = p_user AND p.is_public IS TRUE AND NULLIF(btrim(p.username), '') IS NOT NULL),
    jsonb_build_object('kind', 'user', 'label', 'unnamed party')) END
$function$;
CREATE TABLE public.scratch_sign(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
GRANT ALL ON public.scratch_sign TO service_role, anon, authenticated;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

-- O is the owner the authorization names; X is another admin.
INSERT INTO auth.users VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4'), ('00000000-0000-0000-0000-0000000000ee');
INSERT INTO profiles VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'owner_handle', true, 'owner@example.invalid');
INSERT INTO admin_users(user_id, is_active) VALUES ('00000000-0000-0000-0000-0000000000ee', true);

\ir ../migrations/20261020002000_owner_delegated_signs.sql

SELECT t_assert(NOT has_function_privilege('anon', 'public.owner_delegated_sign_register(text,jsonb,text,text,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.owner_delegated_sign_register(text,jsonb,text,text,text,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.owner_delegated_sign_register(text,jsonb,text,text,text,timestamptz)', 'EXECUTE'),
  'register helper is service-only');
SELECT t_assert(NOT has_function_privilege('service_role', 'public.owner_delegated_sign_record(text,jsonb,text,text,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.owner_delegated_sign_record(text,jsonb,text,text,text,timestamptz)', 'EXECUTE'),
  'the internal recorder has no grants');
SELECT t_assert(has_function_privilege('anon', 'public.owner_delegated_signs_read()', 'EXECUTE')
  AND has_function_privilege('anon', 'public.is_owner_delegated_sign(text,text)', 'EXECUTE'), 'reader and flag are open');
SELECT t_assert(NOT has_table_privilege('anon', 'public.owner_delegated_signs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.owner_delegated_signs', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.owner_delegated_signs', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.owner_delegated_signs', 'DELETE')
  AND has_table_privilege('service_role', 'public.owner_delegated_signs', 'SELECT'), 'table: service reads, nobody writes directly');

-- 1. The owner must be an active admin.
SET ROLE service_role;
BEGIN;
INSERT INTO scratch_sign DEFAULT VALUES;
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('confirm_work_session', '{"session_id":"00000000-0000-0000-0000-000000000001"}',
  '00000000-0000-0000-0000-000000000001', 'quote', 'agent-1')$q$), 'refused while the owner is not an active admin');
ROLLBACK;
RESET ROLE;
INSERT INTO admin_users(user_id, is_active) VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', true);

-- 2. Registering before the Sign wrote anything is refused.
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('confirm_work_session', '{}', 'x', 'quote', 'agent-1')$q$),
  'a transaction that wrote nothing cannot register a sign');

-- 3. Same transaction: rollback leaves no register row; commit keeps it.
BEGIN;
INSERT INTO scratch_sign DEFAULT VALUES;
SELECT owner_delegated_sign_register('confirm_work_session', '{"session_id":"00000000-0000-0000-0000-000000000001"}',
  '00000000-0000-0000-0000-000000000001', 'dude its fine', 'agent-1');
ROLLBACK;
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs) = 0, 'a rolled-back Sign leaves no register row');
BEGIN;
INSERT INTO scratch_sign DEFAULT VALUES;
CREATE TEMP TABLE r1 AS SELECT owner_delegated_sign_register('confirm_work_session', '{"session_id":"00000000-0000-0000-0000-000000000001","count":1}',
  '00000000-0000-0000-0000-000000000001', 'dude its fine', 'agent-1') AS id;
COMMIT;
SELECT t_assert((SELECT count(*) FROM owner_delegated_signs d JOIN r1 ON r1.id = d.id
  WHERE d.owner_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' AND d.authorized_at = '2026-10-19 16:09:00+00'
    AND NOT d.rolled_back AND d.signed_at >= d.authorized_at) = 1, 'a committed Sign keeps its register row with the authorization clock');

-- 4. No personal information in args.
BEGIN;
INSERT INTO scratch_sign DEFAULT VALUES;
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{"email":"a"}', NULL, 'q', 'a')$q$), 'an email key is refused');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{"customer_name":"A B"}', NULL, 'q', 'a')$q$), 'a name key is refused');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{"note":"call +1 555 010 0199"}', NULL, 'q', 'a')$q$), 'a phone value is refused');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{"nested":{"to":"a@b.c"}}', NULL, 'q', 'a')$q$), 'a nested address value is refused');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('Bad Rpc', '{}', NULL, 'q', 'a')$q$), 'an rpc must be a function identifier');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{}', NULL, ' ', 'a')$q$), 'an authorization quote is required');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('x', '{}', NULL, 'q', 'a', now() + interval '1 day')$q$),
  'an authorization after the sign is refused');
SELECT t_assert(t_refused($q$SELECT owner_delegated_sign_register('approve_actor_link_claim_owner_delegated', '{}', 'c', 'q', 'a')$q$),
  'an owner-delegated writer''s sign cannot be registered from outside it');
ROLLBACK;

-- 5. Append-only.
SELECT t_assert(t_refused($q$INSERT INTO owner_delegated_signs(owner_user_id, rpc, authorization_quote, authorized_at, agent_session)
  VALUES ('0b9f107a-d124-49de-9ded-94698f63c1c4', 'x', 'q', now(), 'a')$q$), 'service cannot insert directly');
RESET ROLE;
SELECT t_assert(t_refused($q$INSERT INTO owner_delegated_signs(owner_user_id, rpc, authorization_quote, authorized_at, agent_session)
  VALUES ('00000000-0000-0000-0000-0000000000ee', 'x', 'q', now(), 'a')$q$), 'only the named owner can be registered');
SELECT t_assert(t_refused($q$UPDATE owner_delegated_signs SET rpc = 'other'$q$), 'register rows cannot be edited');
SELECT t_assert(t_refused($q$UPDATE owner_delegated_signs SET signed_at = now(), rolled_back = true$q$), 'rolled_back cannot ride along with an edit');
SELECT t_assert(t_refused($q$DELETE FROM owner_delegated_signs$q$), 'register rows cannot be deleted');
SELECT t_assert(t_refused($q$TRUNCATE owner_delegated_signs$q$), 'the register cannot be truncated');
UPDATE owner_delegated_signs SET rolled_back = true WHERE id = (SELECT id FROM r1);
SELECT t_assert((SELECT rolled_back FROM owner_delegated_signs WHERE id = (SELECT id FROM r1)), 'a later reversal is marked rolled_back');
SELECT t_assert(t_refused($q$UPDATE owner_delegated_signs SET rolled_back = false$q$), 'a reversal cannot be undone in place');

-- 6. Open reader and flag.
SET ROLE service_role;
BEGIN;
INSERT INTO scratch_sign DEFAULT VALUES;
SELECT owner_delegated_sign_register('accept_work_order_quote', '{"claim_id":"00000000-0000-0000-0000-0000000000c1"}',
  '00000000-0000-0000-0000-0000000000c1', 'dude its fine', 'agent-secret-session');
COMMIT;
RESET ROLE;
SET ROLE anon;
CREATE TEMP TABLE rd AS SELECT owner_delegated_signs_read() j;
SELECT t_assert((SELECT j @> '{"totals":{"signs":2,"rolled_back":1},"owner":{"handle":"owner_handle"},
  "by_rpc":[{"rpc":"accept_work_order_quote","signs":1},{"rpc":"confirm_work_session","signs":1,"rolled_back":1}],
  "authorizations":["2026-10-19T16:09:00+00:00"]}' AND jsonb_array_length(j->'recent') = 2 FROM rd), 'anon reads counts by rpc and clocks');
SELECT t_assert((SELECT j::text !~ '(dude its fine|agent-secret-session|0000000000c1|00000000-0000-0000-0000-000000000001|owner@example|session_id|claim_id)' FROM rd),
  'reader carries no arguments, references, sessions, wording or contact');
SELECT t_assert(is_owner_delegated_sign('accept_work_order_quote', '00000000-0000-0000-0000-0000000000c1')
  AND NOT is_owner_delegated_sign('confirm_work_session', '00000000-0000-0000-0000-000000000001')
  AND NOT is_owner_delegated_sign('accept_work_order_quote', 'other'), 'flag: registered and not rolled back');
SELECT t_assert(t_refused($q$SELECT * FROM owner_delegated_signs$q$), 'anon cannot read the register rows');
RESET ROLE;
