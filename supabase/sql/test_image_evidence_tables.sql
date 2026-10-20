-- Disposable PG17 only, as a superuser (the sessions below switch session authorization), from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_image_evidence_tables -f supabase/sql/test_image_evidence_tables.sql
-- scripts/ci/run-db-contracts.sh runs it that way in the db-contracts job. Synthetic ids only (gen_random_uuid()).
-- Contract for 20261021220000_image_evidence_tables.sql (M1a): nine evidence tables, their insert, append-only and
-- truncate guards fired ALWAYS, owner-only RLS and the grants. Supabase's shape: anon, authenticated, service_role
-- (BYPASSRLS) and authenticator (LOGIN NOINHERIT, granted the three); the migration applied AS a non-superuser owner
-- (CREATEROLE, BYPASSRLS, owner of schema public, member of the API roles), as postgres is live; default privileges
-- granting the API roles ALL on new tables and service_role new functions; auth.uid(), auth.role() and auth.jwt() as
-- live defines them. A PostgREST call is session authorization authenticator plus SET ROLE and request.jwt.claims;
-- q.sh is a session of the owner, also after session_replication_role = replica (supautils allows that live).
-- It proves:
--   * 9 tables, 7 functions and 27 guard triggers, every one fired ALWAYS; RLS on all nine (not forced) with one SELECT
--     policy each for authenticated on user_id = auth.uid(); anon holds nothing, authenticated and service_role hold
--     SELECT only; no API role or PUBLIC can execute the guards; no existing table gained a column, constraint,
--     trigger or reference;
--   * an owner session reads only its own rows, a JWT without a user reads none, anon is refused, and service_role
--     reads every user's rows (the stated limit: RLS is not forced and service_role bypasses it);
--   * as the owner (q.sh), raw INSERT, UPDATE (a supersession stamp, a run close), DELETE and TRUNCATE on all nine are
--     refused, in normal and in replication mode, and so is a writer called from there; evidence_caller_check('probe')
--     raises 42501 in both modes; a forged human: decision carrying an aal2 stamp is refused in replication mode;
--   * in a PostgREST service_role session: no table privilege to write; an arbitrary-SQL SECURITY DEFINER function
--     (shaped like execute_recovery_sql) can neither INSERT nor call a writer, because the outermost frame is not a
--     writer, and cannot change the role setting; a DO block can neither call a writer nor insert;
--   * the channel rules on a writer's name: an owner session writes only through decide_evidence; a human: decision
--     needs role authenticated, the caller's own uid and an aal2 session, and is stamped with aal, amr, session_id,
--     api_role and outer_writer; an agent: decision needs service_role; a writer without its token is refused;
--   * no refused statement changed a row; over a conflicting public.evidence_decisions in a second database the
--     migration fails and leaves nothing behind.
-- Rows to attack are written through stand-ins carrying a writer's name: the guard trusts the outermost frame's name.
-- M1w (20261021221000) defines the real writers; its contract tests their honest paths.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL OR to_regclass('public.evidence_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run as a superuser: the sessions below switch session authorization';
  END IF;
END $$;
SET TimeZone = 'UTC';
\set VERBOSITY terse
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_evidence_owner') THEN
    CREATE ROLE dm_contract_evidence_owner NOLOGIN NOSUPERUSER CREATEROLE BYPASSRLS;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO dm_contract_evidence_owner;
-- auth.uid() and auth.role() as live defines them; auth.jwt() as live: request.jwt.claim, else request.jwt.claims.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
ALTER SCHEMA public OWNER TO dm_contract_evidence_owner;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE dm_contract_evidence_owner IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE dm_contract_evidence_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- After a statement that must fail: its SQLSTATE and message as psql recorded them (:SQLSTATE, :LAST_ERROR_MESSAGE).
CREATE FUNCTION public.t_refused(label text, got_state text, got_message text, want_state text, want_like text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got_state IS DISTINCT FROM want_state OR got_message NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL: % (got % "%")', label, got_state, got_message;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
-- Runs one statement and returns 'ok' or its SQLSTATE and message. Used only where the caller's frame cannot matter
-- (the session check fires first); every frame-sensitive case below runs at top level.
CREATE FUNCTION public.t_try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
SELECT t_assert((SELECT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'service_role')
  AND (SELECT rolcanlogin AND NOT rolinherit AND NOT rolsuper FROM pg_roles WHERE rolname = 'authenticator')
  AND (SELECT NOT rolsuper AND rolcreaterole AND rolbypassrls FROM pg_roles WHERE rolname = 'dm_contract_evidence_owner')
  AND pg_has_role('authenticator', 'service_role', 'MEMBER') AND pg_has_role('authenticator', 'authenticated', 'MEMBER'),
  'roles have live''s shape: service_role BYPASSRLS, authenticator LOGIN NOINHERIT, the owner not a superuser');

-- Existing tables the store sits beside (live has them; the migration must not touch them), created by the owner.
SET SESSION AUTHORIZATION dm_contract_evidence_owner;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, is_public boolean DEFAULT false,
  deleted_at timestamptz);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, taken_at timestamptz,
  file_hash text);
-- An arbitrary-SQL SECURITY DEFINER function owned by the owner and executable by service_role, shaped like
-- execute_recovery_sql(text) (live revoked that one from service_role in 20261021230000; the guard does not rely on it).
CREATE FUNCTION public.run_sql_as_owner(p_sql text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.run_sql_as_owner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sql_as_owner(text) TO service_role;
RESET SESSION AUTHORIZATION;

-- Shape of the existing tables, to compare after the migration.
CREATE FUNCTION public.t_existing_shape() RETURNS text LANGUAGE sql AS $$
  SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
    SELECT format('col %s.%s %s %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull) AS x
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.oid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL SELECT format('con %s %s', conrelid::regclass, pg_get_constraintdef(oid)) FROM pg_constraint
     WHERE conrelid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
        OR confrelid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
    UNION ALL SELECT format('trg %s %s', tgrelid::regclass, tgname) FROM pg_trigger
     WHERE tgrelid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
    UNION ALL SELECT format('idx %s', pg_get_indexdef(indexrelid)) FROM pg_index
     WHERE indrelid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
    UNION ALL SELECT format('rel %s %s %s %s', relname, relowner::regrole, relacl, relrowsecurity) FROM pg_class
     WHERE oid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
    UNION ALL SELECT format('pol %s %s', polrelid::regclass, polname) FROM pg_policy
     WHERE polrelid IN ('public.profiles'::regclass, 'public.vehicles'::regclass, 'public.vehicle_images'::regclass)
  ) s $$;
SELECT t_existing_shape() AS existing_before,
  (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r') AS tables_before,
  (SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace) AS functions_before \gset

-- 1. The migration, applied as the owner.
SET SESSION AUTHORIZATION dm_contract_evidence_owner;
\ir ../migrations/20261021220000_image_evidence_tables.sql
RESET SESSION AUTHORIZATION;

\set nine '{evidence_runs,image_vehicle_candidates,image_capture_time_claims,evidence_links,evidence_account_entities,vehicle_change_claims,vehicle_change_claim_support,user_day_vehicle_context,evidence_decisions}'
\set seven '{evidence_pass_names,evidence_entity_key_ok,evidence_account_ref_ok,evidence_writer_names,evidence_caller_check,evidence_insert_guard,evidence_append_only_guard}'

-- 2. Shape: what it created, who owns it, the guards, RLS and grants. (Name lists are sorted COLLATE "C" on both
-- sides: under a collation that ignores '_' the two sides would sort differently.)
SELECT t_assert((SELECT array_agg(relname::text ORDER BY relname::text COLLATE "C") FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r')
  = (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(:'tables_before'::text[] || :'nine'::text[]) x),
  '9 tables, exactly the nine evidence tables');
SELECT t_assert((SELECT array_agg(proname::text ORDER BY proname::text COLLATE "C") FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace)
  = (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(:'functions_before'::text[] || :'seven'::text[]) x),
  '7 functions, exactly the vocabulary, the writer names, the caller check and the two guards');
SELECT t_assert((SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace
    AND relname = ANY (:'nine'::text[]) AND relowner = 'dm_contract_evidence_owner'::regrole) = 9
  AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY (:'seven'::text[])
    AND proowner = 'dm_contract_evidence_owner'::regrole AND NOT prosecdef
    AND proconfig = ARRAY['search_path=public, pg_temp']) = 7,
  'the non-superuser owner owns all of it; no function is SECURITY DEFINER; every one pins search_path');
SELECT t_assert((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
    AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (:'nine'::text[]))) = 27
  AND (SELECT count(*) FILTER (WHERE tgenabled = 'A') FROM pg_trigger
    WHERE tgname ~ '_(insert_guard|append_only|no_truncate)$' AND NOT tgisinternal) = 27,
  '27 guard triggers on the nine tables, every one fired ALWAYS (also under a replication-mode session)');
SELECT t_assert(NOT EXISTS (
  SELECT 1 FROM unnest(:'nine'::text[]) t,
    LATERAL (VALUES
      (t || '_insert_guard', '% BEFORE INSERT ON %' || t || ' FOR EACH ROW EXECUTE FUNCTION %evidence_insert_guard()'),
      (t || '_append_only', '% BEFORE DELETE OR UPDATE ON %' || t || ' FOR EACH ROW EXECUTE FUNCTION %evidence_append_only_guard()'),
      (t || '_no_truncate', '% BEFORE TRUNCATE ON %' || t || ' FOR EACH STATEMENT EXECUTE FUNCTION %evidence_append_only_guard()')) v(name, def)
  WHERE (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = v.name
          AND tgrelid = ('public.' || t)::regclass) NOT LIKE v.def
     OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgname = v.name AND tgrelid = ('public.' || t)::regclass)),
  'each table has its insert guard (row), append-only guard (row, UPDATE and DELETE) and truncate guard (statement)');
SELECT t_assert((SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (:'nine'::text[])
    AND relrowsecurity AND NOT relforcerowsecurity) = 9
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (:'nine'::text[])) = 9
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (:'nine'::text[])
    AND policyname = tablename || '_owner_read' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
    AND roles = '{authenticated}' AND qual = '(user_id = ( SELECT auth.uid() AS uid))') = 9,
  'RLS is on (not forced) on all nine, with one policy each: authenticated SELECT where user_id = auth.uid()');
SELECT t_assert(NOT EXISTS (
    SELECT 1 FROM unnest(:'nine'::text[]) t, unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
      unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    WHERE has_table_privilege(r, 'public.' || t, p) IS DISTINCT FROM (p = 'SELECT' AND r <> 'anon'))
  AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (:'nine'::text[]) AND a.grantee = 0),
  'anon holds nothing; authenticated and service_role hold SELECT only, on all nine; PUBLIC holds nothing');
SELECT t_assert(NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.evidence_caller_check(text)', 'public.evidence_insert_guard()',
                               'public.evidence_append_only_guard()']) f,
      unnest(ARRAY['anon', 'authenticated', 'service_role']) r
    WHERE has_function_privilege(r, f, 'EXECUTE'))
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.evidence_pass_names()', 'public.evidence_entity_key_ok(text)',
                               'public.evidence_account_ref_ok(text)', 'public.evidence_writer_names()']) f
    WHERE has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE'))
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (:'seven'::text[]) AND a.grantee = 0),
  'no API role or PUBLIC can execute the guards or the caller check; the vocabulary is authenticated and service_role only');
SELECT t_assert(t_existing_shape() = :'existing_before'
  AND NOT EXISTS (SELECT FROM pg_constraint WHERE contype = 'f'
    AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (:'nine'::text[]))
    AND confrelid NOT IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (:'nine'::text[]))),
  'no existing table changed (columns, constraints, references, triggers, indexes, grants, policies); foreign keys stay inside the nine');
SELECT t_assert((SELECT bool_and(pg_get_indexdef(indexrelid) LIKE '% USING btree (user_id, %')
    FROM pg_index WHERE indexrelid IN ('public.ivc_one_current'::regclass, 'public.ictc_one_current'::regclass,
      'public.el_one_current'::regclass, 'public.eae_one_current'::regclass, 'public.udvc_one_current'::regclass)),
  'every one-current key starts with user_id, so one user''s row never supersedes another''s');

-- 3. Stand-ins under writers' names, owned by the owner like the real writers (SECURITY DEFINER, search_path pinned).
SET SESSION AUTHORIZATION dm_contract_evidence_owner;
-- One row in each of the nine tables for a user; a machine (rule:) decision on the capture time.
CREATE FUNCTION public.evidence_open_run(p_user_id uuid, p_tag text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_run uuid; v_cand uuid; v_time uuid; v_link uuid; v_ent uuid; v_claim uuid; v_sup uuid; v_day uuid; v_dec uuid;
BEGIN
  PERFORM set_config('evidence.writer', 'on', true);
  INSERT INTO evidence_runs(user_id, run_kind, pass, producer, code_version, config)
    VALUES (p_user_id, 'pilot', 'loop', 'script:contract', 'contract', '{}') RETURNING id INTO v_run;
  INSERT INTO image_vehicle_candidates(user_id, run_id, image_id, vehicle_id, verdict, pass, join_key, confidence,
      evidence, created_by)
    VALUES (p_user_id, v_run, gen_random_uuid(), gen_random_uuid(), 'is_vehicle', 'combined', 'contract', 0.5,
      '[{"kind": "contract"}]', 'script:contract') RETURNING id INTO v_cand;
  INSERT INTO image_capture_time_claims(user_id, run_id, image_id, corrected_taken_at, captured_on, rule, witness,
      confidence, created_by)
    VALUES (p_user_id, v_run, gen_random_uuid(), '2026-01-02 12:00Z', '2026-01-02', 'owner', '{}', 1, 'script:contract')
    RETURNING id INTO v_time;
  INSERT INTO evidence_links(user_id, run_id, vehicle_id, source_kind, external_ref, source_key, role, pass, join_key,
      confidence, evidence, created_by)
    VALUES (p_user_id, v_run, gen_random_uuid(), 'note', 'note:' || p_tag, 'note:' || p_tag, 'context', 'combined',
      'contract', 0.5, '[{"kind": "contract"}]', 'script:contract') RETURNING id INTO v_link;
  INSERT INTO evidence_account_entities(user_id, run_id, account_ref, entity_key, confidence, evidence, created_by)
    VALUES (p_user_id, v_run, 'bank_account:contract_' || p_tag, 'unknown', 0.5, '[{"kind": "contract"}]',
      'script:contract') RETURNING id INTO v_ent;
  INSERT INTO vehicle_change_claims(user_id, run_id, vehicle_id, claim_domain, kind, summary, confidence, created_by)
    VALUES (p_user_id, v_run, gen_random_uuid(), 'physical', 'inspection', 'contract claim', 0.5, 'script:contract')
    RETURNING id INTO v_claim;
  INSERT INTO vehicle_change_claim_support(claim_id, user_id, evidence_kind, evidence_id, stance, about, created_by)
    VALUES (v_claim, p_user_id, 'evidence_link', v_link, 'supports', 'other', 'script:contract') RETURNING id INTO v_sup;
  INSERT INTO user_day_vehicle_context(user_id, run_id, day, place_cluster, vehicle_id, confidence, basis, created_by)
    VALUES (p_user_id, v_run, '2026-01-02', 'cluster_a', gen_random_uuid(), 0.5, ARRAY['owner'], 'script:contract')
    RETURNING id INTO v_day;
  INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, reason, detail)
    VALUES (p_user_id, 'capture_time_claim', v_time, 'confirmed', 'rule:contract', 'contract seed',
      '{"writer": "evidence_open_run"}') RETURNING id INTO v_dec;
  RETURN jsonb_build_object('run', v_run, 'candidate', v_cand, 'time_claim', v_time, 'link', v_link, 'entity', v_ent,
    'claim', v_claim, 'support', v_sup, 'day', v_day, 'decision', v_dec);
END $$;
-- One confirm of an image candidate on the caller's behalf, named by decided_by.
CREATE FUNCTION public.decide_evidence(p_user uuid, p_target uuid, p_decided_by text, p_review_method text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  PERFORM set_config('evidence.writer', 'on', true);
  INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, review_ref, review_method,
      reason, detail)
    VALUES (coalesce(auth.uid(), p_user), 'image_candidate', p_target, 'confirmed',
      p_decided_by, 'app:contract', p_review_method, 'contract', '{"writer": "decide_evidence"}')
    RETURNING id INTO v;
  RETURN v;
END $$;
-- A writer's name that forgets its token.
CREATE FUNCTION public.record_day_context(p_user_id uuid, p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO user_day_vehicle_context(user_id, run_id, day, place_cluster, vehicle_id, confidence, basis, created_by)
    VALUES (p_user_id, p_run, '2026-01-03', 'cluster_b', gen_random_uuid(), 0.5, ARRAY['owner'], 'script:contract');
END $$;
REVOKE ALL ON FUNCTION public.evidence_open_run(uuid, text), public.decide_evidence(uuid, uuid, text, text),
  public.record_day_context(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evidence_open_run(uuid, text), public.decide_evidence(uuid, uuid, text, text),
  public.record_day_context(uuid, uuid) TO authenticated, service_role;
RESET SESSION AUTHORIZATION;

-- Sessions. ADMIN: the superuser. QSH: q.sh, a session of the owner; QSH_R: the same after it entered replication
-- mode. JOB: PostgREST with the service-role key. OWNER / ANON: PostgREST with a signed-in user's JWT / the anon key.
\set ADMIN 'RESET ROLE; RESET SESSION AUTHORIZATION; RESET session_replication_role; RESET request.jwt.claims; RESET evidence.writer;'
\set QSH :ADMIN 'SET SESSION AUTHORIZATION dm_contract_evidence_owner;'
\set QSH_R 'RESET ROLE; RESET SESSION AUTHORIZATION; RESET request.jwt.claims; RESET evidence.writer; SET session_replication_role = replica; SET SESSION AUTHORIZATION dm_contract_evidence_owner;'
\set JOB :ADMIN 'SET SESSION AUTHORIZATION authenticator; SET ROLE service_role; SET request.jwt.claims = ''{"role": "service_role"}'';'
\set OWNER :ADMIN 'SET SESSION AUTHORIZATION authenticator; SET ROLE authenticated;'
\set ANON :ADMIN 'SET SESSION AUTHORIZATION authenticator; SET ROLE anon; SET request.jwt.claims = ''{"role": "anon"}'';'
SELECT gen_random_uuid() AS u1, gen_random_uuid() AS u2, gen_random_uuid() AS sid \gset
SELECT jsonb_build_object('sub', :'u1', 'role', 'authenticated', 'aal', 'aal2', 'session_id', :'sid',
         'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1),
                                  jsonb_build_object('method', 'totp', 'timestamp', 2))) AS u1_aal2,
       jsonb_build_object('sub', :'u1', 'role', 'authenticated', 'aal', 'aal1', 'session_id', :'sid',
         'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))) AS u1_aal1,
       jsonb_build_object('sub', :'u2', 'role', 'authenticated', 'aal', 'aal2') AS u2_aal2 \gset

-- 4. Rows to attack: a writer's name called at top level from a PostgREST service_role session, once per user.
:JOB
SELECT public.evidence_open_run(:'u1', 'one') AS seed_u1 \gset
SELECT public.evidence_open_run(:'u2', 'two') AS seed_u2 \gset
:ADMIN
SELECT (:'seed_u1'::jsonb)->>'run' AS run_u1, (:'seed_u1'::jsonb)->>'candidate' AS cand_u1,
       (:'seed_u1'::jsonb)->>'decision' AS dec_u1, (:'seed_u2'::jsonb)->>'candidate' AS cand_u2 \gset
CREATE FUNCTION public.t_users_seen() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'evidence_runs', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.evidence_runs),
    'image_vehicle_candidates', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.image_vehicle_candidates),
    'image_capture_time_claims', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.image_capture_time_claims),
    'evidence_links', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.evidence_links),
    'evidence_account_entities', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.evidence_account_entities),
    'vehicle_change_claims', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.vehicle_change_claims),
    'vehicle_change_claim_support', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.vehicle_change_claim_support),
    'user_day_vehicle_context', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.user_day_vehicle_context),
    'evidence_decisions', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM public.evidence_decisions)) $$;
CREATE FUNCTION public.t_users_expected(VARIADIC p_users uuid[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(t, (SELECT coalesce(jsonb_agg(DISTINCT u), '[]') FROM unnest(p_users) u))
    FROM unnest(ARRAY['evidence_runs', 'image_vehicle_candidates', 'image_capture_time_claims', 'evidence_links',
      'evidence_account_entities', 'vehicle_change_claims', 'vehicle_change_claim_support', 'user_day_vehicle_context',
      'evidence_decisions']) t $$;
-- Every row of the nine tables, as one fingerprint (read as the superuser).
CREATE FUNCTION public.t_rows() RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.evidence_runs r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.image_vehicle_candidates r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.image_capture_time_claims r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.evidence_links r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.evidence_account_entities r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.vehicle_change_claims r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.vehicle_change_claim_support r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.user_day_vehicle_context r),
    (SELECT string_agg(to_jsonb(r)::text, ',' ORDER BY r.id) FROM public.evidence_decisions r))) $$;
SELECT t_assert(t_users_seen() = t_users_expected(:'u1', :'u2')
  AND (SELECT count(*) FROM evidence_runs) + (SELECT count(*) FROM image_vehicle_candidates)
    + (SELECT count(*) FROM image_capture_time_claims) + (SELECT count(*) FROM evidence_links)
    + (SELECT count(*) FROM evidence_account_entities) + (SELECT count(*) FROM vehicle_change_claims)
    + (SELECT count(*) FROM vehicle_change_claim_support) + (SELECT count(*) FROM user_day_vehicle_context)
    + (SELECT count(*) FROM evidence_decisions) = 18,
  'a writer''s name called at top level from a PostgREST service_role session writes all nine tables, one row each per user');
SELECT t_assert((SELECT detail @> '{"api_role": "service_role", "outer_writer": "evidence_open_run"}'
  FROM evidence_decisions WHERE id = :'dec_u1'), 'the guard stamps api_role and outer_writer into the decision');

-- 5. Reads through the API: an owner session reads only its own rows; service_role reads everyone's.
:OWNER
SET request.jwt.claims = :'u1_aal2';
SELECT t_users_seen() AS seen_u1 \gset
SET request.jwt.claims = :'u2_aal2';
SELECT t_users_seen() AS seen_u2 \gset
SET request.jwt.claims = '{"role": "authenticated"}';
SELECT t_users_seen() AS seen_no_user \gset
:JOB
SELECT t_users_seen() AS seen_job \gset
:ANON
\set ON_ERROR_STOP off
SELECT count(*) FROM public.evidence_decisions;
\set ON_ERROR_STOP on
SELECT t_refused('anon cannot read the store', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'permission denied for table evidence_decisions');
:ADMIN
SELECT t_assert(:'seen_u1'::jsonb = t_users_expected(:'u1') AND :'seen_u2'::jsonb = t_users_expected(:'u2'),
  'an owner session reads only its own rows, in each of the nine tables');
SELECT t_assert(:'seen_no_user'::jsonb = t_users_expected(), 'a JWT without a user reads no row');
SELECT t_assert(:'seen_job'::jsonb = t_users_expected(:'u1', :'u2'),
  'service_role reads every user''s rows (the stated limit: RLS is not forced; the readers filter by user)');
SELECT t_rows() AS rows_seeded \gset

-- 6. q.sh: a session of the owner. Nothing it writes reaches the store, in normal or in replication mode.
SELECT format('INSERT INTO public.evidence_decisions(user_id, target_kind, target_id, decision, decided_by, review_ref,'
  ' review_method, reason, detail) VALUES (%L, ''image_candidate'', %L, ''confirmed'', ''human:'' || %L, ''forged'','
  ' ''owner_page'', ''forged'', ''{"writer": "decide_evidence", "aal": "aal2"}'')', :'u1', :'cand_u1', :'u1') AS forged_human \gset
-- Every write on every table, through t_try (the session check fires before anything else, whatever the frame).
CREATE FUNCTION public.t_owner_writes() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(format('%s %s -> %s', t, op, got), '; '), 'all refused') FROM (
    SELECT t, op, public.t_try(sql) AS got, want FROM unnest(ARRAY['evidence_runs', 'image_vehicle_candidates',
        'image_capture_time_claims', 'evidence_links', 'evidence_account_entities', 'vehicle_change_claims',
        'vehicle_change_claim_support', 'user_day_vehicle_context', 'evidence_decisions']) t,
      LATERAL (VALUES
        ('insert', format('INSERT INTO public.%I DEFAULT VALUES', t),
         format('42501 %s: rows are written only by the evidence writers through the API (session %s)', t, session_user)),
        ('update', CASE t WHEN 'evidence_runs'
                            THEN 'UPDATE public.evidence_runs SET status = ''done'', finished_at = now() WHERE status = ''running'''
                          WHEN 'evidence_decisions' THEN 'UPDATE public.evidence_decisions SET reason = ''changed'''
                          ELSE format('UPDATE public.%I SET superseded_by = gen_random_uuid(), superseded_at = now()', t) END,
         CASE WHEN t = 'evidence_decisions' THEN '42501 evidence_decisions: append-only; write a later decision'
              ELSE format('42501 %s: rows are written only by the evidence writers through the API (session %s)', t, session_user) END),
        ('delete', format('DELETE FROM public.%I', t), format('42501 %s: append-only; supersede instead', t)),
        -- a table other tables reference is truncated together with them (else the foreign key refuses it first)
        ('truncate', CASE t WHEN 'evidence_runs' THEN 'TRUNCATE public.evidence_runs, public.image_vehicle_candidates,'
                              || ' public.image_capture_time_claims, public.evidence_links, public.evidence_account_entities,'
                              || ' public.vehicle_change_claims, public.vehicle_change_claim_support, public.user_day_vehicle_context'
                            WHEN 'vehicle_change_claims'
                              THEN 'TRUNCATE public.vehicle_change_claims, public.vehicle_change_claim_support'
                            ELSE format('TRUNCATE public.%I', t) END,
         format('42501 %s: append-only; supersede instead', t))) v(op, sql, want)
  ) s WHERE got NOT LIKE want $$;

:QSH
SELECT t_assert(session_user = 'dm_contract_evidence_owner' AND current_setting('session_replication_role') = 'origin',
  'q.sh: a session of the owner, in origin mode');
\set ON_ERROR_STOP off
SELECT public.evidence_caller_check('probe');
\set ON_ERROR_STOP on
SELECT t_refused('q.sh runs the guards'' caller check and is refused, writing nothing', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'probe: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
SELECT t_assert(t_owner_writes() = 'all refused',
  'q.sh: INSERT, UPDATE, DELETE and TRUNCATE on all nine tables are refused');
\set ON_ERROR_STOP off
:forged_human;
\set ON_ERROR_STOP on
SELECT t_refused('q.sh: a raw INSERT of a human: decision is refused by the insert guard', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'evidence_decisions: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
\set ON_ERROR_STOP off
SELECT public.evidence_open_run(:'u1', 'qsh');
\set ON_ERROR_STOP on
SELECT t_refused('q.sh: a writer called from q.sh is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_runs: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
\set ON_ERROR_STOP off
DO $$ BEGIN
  PERFORM set_config('evidence.writer', 'on', true);
  INSERT INTO public.evidence_runs(user_id, run_kind, pass, producer, code_version, config)
    VALUES (gen_random_uuid(), 'pilot', 'loop', 'script:forged', 'forged', '{}');
END $$;
\set ON_ERROR_STOP on
SELECT t_refused('q.sh: a DO block that sets the token and inserts is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_runs: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
-- The owner role with an API role, spoofed claims and the token (sim S3).
SET ROLE service_role;
SET request.jwt.claims = '{"role": "service_role"}';
SET evidence.writer = 'on';
\set ON_ERROR_STOP off
:forged_human;
\set ON_ERROR_STOP on
SELECT t_refused('q.sh as service_role with spoofed claims and the token: no INSERT privilege', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'permission denied for table evidence_decisions');
RESET ROLE;
\set ON_ERROR_STOP off
UPDATE public.image_vehicle_candidates SET superseded_by = gen_random_uuid(), superseded_at = now() WHERE id = :'cand_u1';
\set ON_ERROR_STOP on
SELECT t_refused('q.sh with the token set: a supersession stamp is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'image_vehicle_candidates: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');

:QSH_R
SELECT t_assert(session_user = 'dm_contract_evidence_owner' AND current_setting('session_replication_role') = 'replica',
  'q.sh in replication mode: a session of the owner with session_replication_role = replica');
\set ON_ERROR_STOP off
SELECT public.evidence_caller_check('probe');
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: the caller check is refused the same way', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'probe: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
SELECT t_assert(t_owner_writes() = 'all refused',
  'q.sh in replication mode: INSERT, UPDATE, DELETE and TRUNCATE on all nine tables are refused');
\set ON_ERROR_STOP off
:forged_human;
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: a forged human: decision carrying an aal2 stamp is refused', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'evidence_decisions: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
\set ON_ERROR_STOP off
UPDATE public.image_vehicle_candidates SET confidence = 0.99 WHERE id = :'cand_u1';
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: an in-place UPDATE is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'image_vehicle_candidates: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');
\set ON_ERROR_STOP off
DELETE FROM public.evidence_runs WHERE id = :'run_u1';
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: a DELETE is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_runs: append-only; supersede instead');
\set ON_ERROR_STOP off
TRUNCATE public.evidence_decisions;
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: a TRUNCATE is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_decisions: append-only; supersede instead');
\set ON_ERROR_STOP off
SELECT public.evidence_open_run(:'u1', 'qsh-replica');
\set ON_ERROR_STOP on
SELECT t_refused('q.sh in replication mode: a writer called from q.sh is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_runs: rows are written only by the evidence writers through the API (session dm_contract_evidence_owner)');

-- 7. A PostgREST service_role session (the service key, every edge function).
SELECT format('INSERT INTO public.evidence_runs(user_id, run_kind, pass, producer, code_version, config)'
  ' VALUES (%L, ''pilot'', ''loop'', ''script:forged'', ''forged'', ''{}'')', :'u1') AS raw_run_insert \gset
SELECT format('DO $d$ BEGIN PERFORM set_config(''evidence.writer'', ''on'', true);'
  ' PERFORM set_config(''request.jwt.claims'', %L, true); %s; END $d$', :'u1_aal2', :'forged_human') AS rpc_do_forged_human,
  format('SELECT public.evidence_open_run(%L, ''rpc'')', :'u1') AS rpc_writer,
  format('DO $d$ BEGIN PERFORM public.evidence_open_run(%L, ''do''); END $d$', :'u1') AS do_writer,
  format('DO $d$ BEGIN PERFORM set_config(''evidence.writer'', ''on'', true); %s; END $d$',
    format('INSERT INTO public.evidence_runs(user_id, run_kind, pass, producer, code_version, config)'
      ' VALUES (%L, ''pilot'', ''loop'', ''script:forged'', ''forged'', ''{}'')', :'u1')) AS do_insert \gset
:JOB
SELECT t_assert(session_user = 'authenticator' AND current_setting('role') = 'service_role',
  'job: a PostgREST session (authenticator) with the service_role role setting');
\set ON_ERROR_STOP off
:raw_run_insert;
\set ON_ERROR_STOP on
SELECT t_refused('job: a raw INSERT has no table privilege', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'permission denied for table evidence_runs');
\set ON_ERROR_STOP off
UPDATE public.image_vehicle_candidates SET superseded_by = gen_random_uuid(), superseded_at = now() WHERE id = :'cand_u1';
\set ON_ERROR_STOP on
SELECT t_refused('job: a raw supersession stamp has no table privilege', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'permission denied for table image_vehicle_candidates');
\set ON_ERROR_STOP off
SELECT public.evidence_caller_check('probe');
\set ON_ERROR_STOP on
SELECT t_refused('job: the caller check cannot be executed through the API', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'permission denied for function evidence_caller_check');
\set ON_ERROR_STOP off
SELECT public.run_sql_as_owner(:'raw_run_insert');
\set ON_ERROR_STOP on
SELECT t_refused('job: the arbitrary-SQL definer function''s raw INSERT is refused: the outermost caller is not a writer',
  :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_runs: the outermost caller is not an evidence writer (PL/pgSQL function run_sql_as_owner(text) line % at EXECUTE)');
\set ON_ERROR_STOP off
SELECT public.run_sql_as_owner(:'rpc_do_forged_human');
\set ON_ERROR_STOP on
SELECT t_refused('job: through the definer function, a DO block with the token and an owner aal2 JWT cannot insert a human: decision',
  :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_decisions: the outermost caller is not an evidence writer (PL/pgSQL function run_sql_as_owner(text) line % at EXECUTE)');
\set ON_ERROR_STOP off
SELECT public.run_sql_as_owner(:'rpc_writer');
\set ON_ERROR_STOP on
SELECT t_refused('job: a writer called through the definer function is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_runs: the outermost caller is not an evidence writer (PL/pgSQL function run_sql_as_owner(text) line % at EXECUTE)');
SELECT public.run_sql_as_owner($q$SELECT 1 WHERE current_setting('role') = 'service_role'
  AND current_user = 'dm_contract_evidence_owner'$q$) AS rpc_sees_role \gset
SELECT t_assert(:rpc_sees_role = 1,
  'job: inside the definer function the role setting is still service_role (current_user is the owner)');
\set ON_ERROR_STOP off
SELECT public.run_sql_as_owner($q$SELECT set_config('role', 'authenticated', true)$q$);
\set ON_ERROR_STOP on
SELECT t_refused('job: the definer function cannot change the role setting', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'cannot set parameter "role" within security-definer function');
\set ON_ERROR_STOP off
:do_writer;
\set ON_ERROR_STOP on
SELECT t_refused('job: a DO block calling a writer is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'evidence_runs: the outermost caller is not an evidence writer (PL/pgSQL function inline_code_block line % at PERFORM)');
\set ON_ERROR_STOP off
:do_insert;
\set ON_ERROR_STOP on
SELECT t_refused('job: a DO block that sets the token and inserts is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'permission denied for table evidence_runs');
\set ON_ERROR_STOP off
SELECT public.record_day_context(:'u1', :'run_u1');
\set ON_ERROR_STOP on
SELECT t_refused('job: a writer that did not set its token is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE', '42501',
  'user_day_vehicle_context: writer token missing');
\set ON_ERROR_STOP off
SELECT public.decide_evidence(:'u1', :'cand_u1', 'human:' || :'u1', 'owner_app');
\set ON_ERROR_STOP on
SELECT t_refused('job: a service_role session cannot write a human: decision', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_decisions: an owner decision comes only from the owner''s own session');
:ADMIN
SELECT t_assert(t_rows() = :'rows_seeded', 'no refused statement changed a row');

-- 8. The owner's own session (PostgREST, role authenticated): the channel rules the guard enforces on a writer's name.
:OWNER
SET request.jwt.claims = :'u1_aal2';
\set ON_ERROR_STOP off
SELECT public.evidence_open_run(:'u1', 'owner');
\set ON_ERROR_STOP on
SELECT t_refused('owner session: a writer other than decide_evidence is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_runs: an owner session writes only through decide_evidence');
\set ON_ERROR_STOP off
SELECT public.decide_evidence(:'u2', :'cand_u2', 'human:' || :'u2', 'owner_app');
\set ON_ERROR_STOP on
SELECT t_refused('owner session: a human: decision naming another user is refused', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_decisions: an owner decision comes only from the owner''s own session');
\set ON_ERROR_STOP off
SELECT public.decide_evidence(:'u1', :'cand_u1', 'agent:contract-session', 'owner_chat_review');
\set ON_ERROR_STOP on
SELECT t_refused('owner session: an agent: decision is refused (agent rows come only from service_role)', :'SQLSTATE',
  :'LAST_ERROR_MESSAGE', '42501', 'evidence_decisions: an agent decision comes only from a service-role job through decide_evidence');
SET request.jwt.claims = :'u1_aal1';
\set ON_ERROR_STOP off
SELECT public.decide_evidence(:'u1', :'cand_u1', 'human:' || :'u1', 'owner_app');
\set ON_ERROR_STOP on
SELECT t_refused('owner session at aal1: a human: decision needs a step-up session', :'SQLSTATE', :'LAST_ERROR_MESSAGE',
  '42501', 'evidence_decisions: an owner decision needs a step-up (aal2) session');
SET request.jwt.claims = :'u1_aal2';
SELECT public.decide_evidence(:'u1', :'cand_u1', 'human:' || :'u1', 'owner_app') AS human_decision \gset
:ADMIN
SELECT t_assert((SELECT user_id = :'u1' AND decided_by = 'human:' || :'u1'
    AND detail @> jsonb_build_object('writer', 'decide_evidence', 'aal', 'aal2', 'session_id', :'sid',
      'amr', jsonb_build_array('password', 'totp'), 'api_role', 'authenticated', 'outer_writer', 'decide_evidence')
  FROM evidence_decisions WHERE id = :'human_decision')
  AND (SELECT count(*) FROM evidence_decisions WHERE decided_by LIKE 'human:%') = 1,
  'owner session at aal2: the human: decision is written and stamped with aal, amr, session_id, api_role and outer_writer; it is the only human: row');

-- 9. Atomic apply: over a conflicting public.evidence_decisions in a second database, the migration fails and leaves
-- nothing behind. The second database is dropped before its result is asserted.
SELECT current_database() AS main_db, left(current_database(), 56) || '_atomic' AS atomic_db \gset
DROP DATABASE IF EXISTS :"atomic_db" WITH (FORCE);
CREATE DATABASE :"atomic_db";
\c :atomic_db
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
ALTER SCHEMA public OWNER TO dm_contract_evidence_owner;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SET SESSION AUTHORIZATION dm_contract_evidence_owner;
CREATE TABLE public.evidence_decisions(x integer);
\set LAST_ERROR_SQLSTATE none
\echo 'Expected next: the migration fails at CREATE TABLE evidence_decisions (relation already exists) and the rest of its transaction is skipped.'
\set ON_ERROR_STOP off
\ir ../migrations/20261021220000_image_evidence_tables.sql
\set ON_ERROR_STOP on
RESET SESSION AUTHORIZATION;
SELECT :'LAST_ERROR_SQLSTATE' AS atomic_state,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r') AS atomic_tables,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS atomic_functions,
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS atomic_triggers,
  (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.evidence_decisions'::regclass AND attnum > 0 AND NOT attisdropped) AS atomic_conflict_columns \gset
\c :main_db
DROP DATABASE :"atomic_db" WITH (FORCE);
SELECT t_assert(:'atomic_state' = '25P02' AND :atomic_tables = 1 AND :atomic_functions = 0 AND :atomic_triggers = 0
  AND :'atomic_conflict_columns' = 'x' AND NOT EXISTS (SELECT FROM pg_database WHERE datname = :'atomic_db'),
  'over a conflicting evidence_decisions the migration fails and leaves nothing: no evidence_runs, no guard, no trigger; the conflicting table untouched');

-- 10. The end state: every guard still fires ALWAYS, RLS and its policies on all nine, no API write.
SELECT t_assert((SELECT count(*) FILTER (WHERE tgenabled = 'A') FROM pg_trigger
    WHERE tgname ~ '_(insert_guard|append_only|no_truncate)$' AND NOT tgisinternal) = 27
  AND (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (:'nine'::text[])
    AND relrowsecurity) = 9
  AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname ~ '_owner_read$') = 9
  AND NOT has_table_privilege('anon', 'public.evidence_decisions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.evidence_links', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.evidence_decisions', 'INSERT'),
  'end state: 27 of 27 guard triggers ALWAYS, RLS 9 of 9 with 9 owner policies, no anon read, no API write');
SELECT 'image evidence tables contract: PASS' AS result;
