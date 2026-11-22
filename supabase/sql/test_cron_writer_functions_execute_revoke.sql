-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_job_writer_execute -f this-file.sql
-- Contract for 20261121113427_cron_writer_functions_execute_revoke.sql. Synthetic functions and rows only; never
-- production.
--
-- The fixture is the live grant shape, read from production on 2026-11-21 (UTC): each of the 22 job writers is owned
-- by the deploy role, runs as its owner and carries the ACL {=X/owner, owner=X/owner, service_role=X/owner}, so anon
-- and authenticated reach it through PUBLIC only. The stubs carry the live signatures. Each writes one row to a log
-- table that only its owner can write, so a call that lands is visible. Four keep the live call chain
-- (capture_landing_tick -> capture_landing_advance -> capture_landing_apply_chunk ->
-- timeline_resolve_pending_for_images), and an owner-run trigger function calls vehicle_activity_bump as the three live
-- ones do. Two stubs also hold a direct grant to anon and authenticated, the other shape a default grant takes.
--
-- It proves:
--   * before: a logged-out caller and a signed-in one execute all 22, and a logged-out call writes a row the caller
--     could not write itself;
--   * after: neither executes any of the 22, by privilege and by an actual call of every one; the service role and
--     the owner (the role the scheduled jobs run as) call all 22; the chains still work (service role -> wrapper ->
--     writer -> writer; a signed-in insert -> owner-run trigger -> writer); the five kept signatures are untouched;
--     a rerun changes no ACL; CREATE OR REPLACE keeps the revoke; a signature that no longer exists is skipped; a
--     function dropped and created again gets the default grant back and the migration closes it again;
--   * the revert puts PUBLIC back;
--   * the migration refuses, and revokes nothing, when a function that runs as its caller and is open to clients
--     calls one of the 22, or when one of the 22 no longer runs as its owner; a caller-run function that clients
--     cannot execute does not stop it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regprocedure('public.capture_landing_tick()') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, dm_contract_deployer;
-- Prod's deploy role owns the functions and is not a superuser; build and migrate as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- denied(sql) is true when the statement fails with insufficient_privilege (42501).
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
-- The 22 signatures the migration names, as it names them.
CREATE FUNCTION pg_temp.sigs() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  'public.backfill_vehicle_activity(integer,integer)',
  'public.capture_landing_advance(uuid)',
  'public.capture_landing_apply_chunk(uuid,integer)',
  'public.capture_landing_gate_check(uuid)',
  'public.capture_landing_new_chunk(uuid,text,timestamp with time zone,timestamp with time zone,boolean,uuid)',
  'public.capture_landing_tick()',
  'public.compute_vehicle_activity(uuid)',
  'public.identifier_observations_ingest(uuid,timestamp with time zone,timestamp with time zone)',
  'public.identifier_observations_promote(uuid,uuid,boolean,numeric,numeric)',
  'public.photo_evidence_unwind(text,text[],boolean)',
  'public.photo_evidence_unwind_revert(text)',
  'public.photo_gate_unfile_older_drain()',
  'public.photo_land_backfill_drain(integer)',
  'public.photo_pipeline_skip_duplicate_pending(uuid,uuid,boolean,integer)',
  'public.photo_requeue_apply(text,integer)',
  'public.photo_requeue_drain()',
  'public.photo_requeue_revert(text,integer)',
  'public.photo_yield_resnap_drain(integer)',
  'public.timeline_consolidate_pending_sessions(uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
  'public.timeline_consolidate_revert(uuid)',
  'public.timeline_resolve_pending_for_images(uuid[],uuid)',
  'public.vehicle_activity_bump(uuid,text,timestamp with time zone)'
]::text[] $$;
-- can(role) = how many of the 22 the role may execute.
CREATE FUNCTION pg_temp.can(p_role text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM unnest(pg_temp.sigs()) s
   WHERE to_regprocedure(s) IS NOT NULL AND has_function_privilege(p_role, to_regprocedure(s), 'EXECUTE') $$;
-- call_sql(sig) = a call of that function with every argument NULL.
CREATE FUNCTION pg_temp.call_sql(p_sig text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.%I(%s)', p.proname,
           coalesce((SELECT string_agg(format('NULL::%s', format_type(a.t, NULL)), ', ' ORDER BY a.ord)
                       FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(t, ord)), ''))
    FROM pg_proc p WHERE p.oid = to_regprocedure(p_sig) $$;
-- call_all() calls every one of the 22 as the current role: how many refused with 42501, how many ran.
CREATE FUNCTION pg_temp.call_all() RETURNS TABLE(refused integer, ran integer) LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  refused := 0; ran := 0;
  FOREACH s IN ARRAY pg_temp.sigs() LOOP
    CONTINUE WHEN to_regprocedure(s) IS NULL;
    BEGIN
      EXECUTE pg_temp.call_sql(s);
      ran := ran + 1;
    EXCEPTION WHEN insufficient_privilege THEN
      refused := refused + 1;
    END;
  END LOOP;
  RETURN NEXT;
END $$;
-- acl_md5() = one checksum over the ACL of every function in public.
CREATE FUNCTION pg_temp.acl_md5() RETURNS text LANGUAGE sql AS $$
  SELECT md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, 'default'), ';' ORDER BY p.oid::regprocedure::text))
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fixture.
-- ---------------------------------------------------------------------------------------------------------------
-- Only the owner writes this table: no grant to anon, authenticated or the service role.
CREATE TABLE public.t_job_log (n bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fn text NOT NULL);
-- A table clients insert into, with an owner-run trigger that calls a job writer (as vehicle_images,
-- timeline_events and work_sessions do through trg_vehicle_activity_*).
CREATE TABLE public.t_photo (id uuid PRIMARY KEY);
GRANT INSERT ON public.t_photo TO authenticated;

-- The 22 stubs: live signature, owner-run, one log row a call. EXECUTE to PUBLIC is PostgreSQL's default for a new
-- function; the explicit service-role grant makes the ACL the one read from production.
DO $$
DECLARE s text; nm text;
BEGIN
  FOREACH s IN ARRAY pg_temp.sigs() LOOP
    nm := substring(s from '^public\.([a-z0-9_]+)\(');
    EXECUTE format('CREATE FUNCTION %s RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS %L',
                   s, format('BEGIN INSERT INTO public.t_job_log(fn) VALUES (%L); END', nm));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
  END LOOP;
END $$;
-- The live chain: the tick advances a chunk, which applies it, which resolves its pending photos.
CREATE OR REPLACE FUNCTION public.capture_landing_apply_chunk(uuid, integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  INSERT INTO public.t_job_log(fn) VALUES ('capture_landing_apply_chunk');
  PERFORM public.timeline_resolve_pending_for_images(NULL::uuid[], NULL::uuid);
END $f$;
CREATE OR REPLACE FUNCTION public.capture_landing_advance(uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  INSERT INTO public.t_job_log(fn) VALUES ('capture_landing_advance');
  PERFORM public.capture_landing_apply_chunk($1, 40);
END $f$;
CREATE OR REPLACE FUNCTION public.capture_landing_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  INSERT INTO public.t_job_log(fn) VALUES ('capture_landing_tick');
  PERFORM public.capture_landing_advance(NULL::uuid);
END $f$;
-- The other shape a default grant takes: direct grants to the two client roles.
GRANT EXECUTE ON FUNCTION public.photo_requeue_drain(), public.timeline_consolidate_revert(uuid) TO anon, authenticated;

-- An owner-run trigger function that calls a job writer, with the live ACL of trg_vehicle_activity_image.
CREATE FUNCTION public.trg_vehicle_activity_image() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  PERFORM public.vehicle_activity_bump(NEW.id, 'image', now());
  RETURN NEW;
END $f$;
GRANT EXECUTE ON FUNCTION public.trg_vehicle_activity_image() TO service_role;
CREATE TRIGGER t_photo_activity AFTER INSERT ON public.t_photo
  FOR EACH ROW EXECUTE FUNCTION public.trg_vehicle_activity_image();

-- The five signatures the migration keeps open, with their live signatures and grants.
CREATE FUNCTION public.register_make_model_subject(text, text, integer, text, integer, integer, text, text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.validate_data_room_access_code(uuid, text, text) RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.validate_data_room_access_code(uuid, text, text, text) RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.analyze_organization_data_signals(uuid) RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.get_pipeline_pulse(integer) RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
GRANT EXECUTE ON FUNCTION
  public.register_make_model_subject(text, text, integer, text, integer, integer, text, text),
  public.validate_data_room_access_code(uuid, text, text), public.validate_data_room_access_code(uuid, text, text, text),
  public.analyze_organization_data_signals(uuid), public.get_pipeline_pulse(integer)
  TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.kept_open() RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('register_make_model_subject', 'validate_data_room_access_code',
                       'analyze_organization_data_signals', 'get_pipeline_pulse')
     AND has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Before.
-- ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('fixture: all 22 exist, each owner-run',
  (SELECT count(*) FROM unnest(pg_temp.sigs()) s JOIN pg_proc p ON p.oid = to_regprocedure(s) WHERE p.prosecdef) = 22);
SELECT pg_temp.ok('fixture: 20 carry the ACL read from production, PUBLIC plus owner plus service role',
  (SELECT count(*) FROM unnest(pg_temp.sigs()) s JOIN pg_proc p ON p.oid = to_regprocedure(s)
    WHERE p.proacl::text = '{=X/dm_contract_deployer,dm_contract_deployer=X/dm_contract_deployer,service_role=X/dm_contract_deployer}') = 20);
SELECT pg_temp.ok('before: anon, authenticated and the service role may execute all 22',
  pg_temp.can('anon') = 22 AND pg_temp.can('authenticated') = 22 AND pg_temp.can('service_role') = 22);

SET ROLE anon;
SELECT pg_temp.ok('before: a logged-out caller cannot write the log table itself',
  pg_temp.denied($q$INSERT INTO public.t_job_log(fn) VALUES ('anon, directly')$q$));
SELECT pg_temp.ok('before: every one of the 22 runs for a logged-out caller',
  (SELECT refused = 0 AND ran = 22 FROM pg_temp.call_all()));
SET ROLE dm_contract_deployer;
-- 28 rows: 19 functions write one; the tick writes 4, the advance 3 and the apply 2 through the chain.
SELECT pg_temp.ok('before: those logged-out calls wrote, as the owner, to a table the caller cannot write',
  (SELECT count(DISTINCT fn) = 22 AND count(*) = 28 FROM public.t_job_log));

TRUNCATE public.t_job_log;
SET ROLE authenticated;
SELECT pg_temp.ok('before: every one of the 22 runs for a signed-in caller',
  (SELECT refused = 0 AND ran = 22 FROM pg_temp.call_all()));
INSERT INTO public.t_photo(id) VALUES ('00000000-0000-0000-0000-0000000000a1');
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('before: a signed-in insert fires the owner-run trigger, which calls vehicle_activity_bump',
  (SELECT count(*) FROM public.t_job_log WHERE fn = 'vehicle_activity_bump') = 2);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The revoke.
-- ---------------------------------------------------------------------------------------------------------------
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql

-- ---------------------------------------------------------------------------------------------------------------
-- 3. After.
-- ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('after: anon and authenticated may execute none of the 22',
  pg_temp.can('anon') = 0 AND pg_temp.can('authenticated') = 0);
SELECT pg_temp.ok('after: the service role and the owner may execute all 22',
  pg_temp.can('service_role') = 22 AND pg_temp.can('dm_contract_deployer') = 22);
SELECT pg_temp.ok('after: all 22 carry owner plus service role and nothing else',
  (SELECT count(*) FROM unnest(pg_temp.sigs()) s JOIN pg_proc p ON p.oid = to_regprocedure(s)
    WHERE p.proacl::text = '{dm_contract_deployer=X/dm_contract_deployer,service_role=X/dm_contract_deployer}') = 22);
SELECT pg_temp.ok('after: the five kept signatures still answer anon and authenticated', pg_temp.kept_open() = 5);
SELECT pg_temp.ok('after: the owner-run trigger function is untouched',
  has_function_privilege('authenticated', 'public.trg_vehicle_activity_image()', 'EXECUTE'));

TRUNCATE public.t_job_log;
SET ROLE anon;
SELECT pg_temp.ok('after: every one of the 22 refuses a logged-out call',
  (SELECT refused = 22 AND ran = 0 FROM pg_temp.call_all()));
SET ROLE authenticated;
SELECT pg_temp.ok('after: every one of the 22 refuses a signed-in call',
  (SELECT refused = 22 AND ran = 0 FROM pg_temp.call_all()));
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('after: the refused calls wrote nothing', (SELECT count(*) FROM public.t_job_log) = 0);

SET ROLE service_role;
SELECT pg_temp.ok('after: every one of the 22 runs for the service role',
  (SELECT refused = 0 AND ran = 22 FROM pg_temp.call_all()));
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('after: the service role''s calls landed, the wrappers reaching the writers they call',
  (SELECT count(DISTINCT fn) = 22 AND count(*) = 28 FROM public.t_job_log));

TRUNCATE public.t_job_log;
SELECT pg_temp.ok('after: every one of the 22 runs for the owner, the role the scheduled jobs run as',
  (SELECT refused = 0 AND ran = 22 FROM pg_temp.call_all()));
SELECT pg_temp.ok('after: the tick still reaches the photo resolver through the chain',
  (SELECT count(*) FROM public.t_job_log WHERE fn = 'timeline_resolve_pending_for_images') = 4);

TRUNCATE public.t_job_log;
SET ROLE authenticated;
INSERT INTO public.t_photo(id) VALUES ('00000000-0000-0000-0000-0000000000a2');
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('after: a signed-in insert still fires the owner-run trigger, which still calls vehicle_activity_bump',
  (SELECT count(*) FROM public.t_job_log WHERE fn = 'vehicle_activity_bump') = 1);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Rerun, replace, drop and re-create.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE t_acl AS SELECT pg_temp.acl_md5() AS before_rerun;
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('a rerun changes no ACL', (SELECT before_rerun FROM t_acl) = pg_temp.acl_md5());

CREATE OR REPLACE FUNCTION public.photo_requeue_drain() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN INSERT INTO public.t_job_log(fn) VALUES ('photo_requeue_drain'); END $f$;
SELECT pg_temp.ok('CREATE OR REPLACE keeps the revoke', pg_temp.can('anon') = 0 AND pg_temp.can('authenticated') = 0);

DROP FUNCTION public.photo_yield_resnap_drain(integer);
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('a signature that no longer exists is skipped; the other 21 stay closed and stay with the service role',
  pg_temp.can('anon') = 0 AND pg_temp.can('authenticated') = 0 AND pg_temp.can('service_role') = 21);

CREATE FUNCTION public.photo_yield_resnap_drain(integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN INSERT INTO public.t_job_log(fn) VALUES ('photo_yield_resnap_drain'); END $f$;
SELECT pg_temp.ok('a function dropped and created again is open to anon and authenticated again',
  pg_temp.can('anon') = 1 AND pg_temp.can('authenticated') = 1);
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('and the migration closes it again',
  pg_temp.can('anon') = 0 AND pg_temp.can('authenticated') = 0 AND pg_temp.can('service_role') = 22);

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The revert.
-- ---------------------------------------------------------------------------------------------------------------
\ir revert_20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('revert: anon, authenticated and the service role may execute all 22 again',
  pg_temp.can('anon') = 22 AND pg_temp.can('authenticated') = 22 AND pg_temp.can('service_role') = 22);
UPDATE t_acl SET before_rerun = pg_temp.acl_md5();
\ir revert_20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('revert twice changes no ACL', (SELECT before_rerun FROM t_acl) = pg_temp.acl_md5());

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Refusals: the migration revokes nothing when a premise no longer holds.
-- ---------------------------------------------------------------------------------------------------------------
-- (a) A function that runs as its caller, open to clients, calls a job writer: revoking would break it for them.
CREATE FUNCTION public.t_client_helper(uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM public.compute_vehicle_activity($1); END $f$;
UPDATE t_acl SET before_rerun = pg_temp.acl_md5();
\set ON_ERROR_STOP off
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: a caller-run function open to clients calls a job writer, and no ACL changed',
  pg_temp.can('anon') = 22 AND pg_temp.can('authenticated') = 22 AND (SELECT before_rerun FROM t_acl) = pg_temp.acl_md5());

-- (b) The same function closed to clients is not a client path: the migration applies.
REVOKE EXECUTE ON FUNCTION public.t_client_helper(uuid) FROM PUBLIC;
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
SELECT pg_temp.ok('applied: a caller-run function that clients cannot execute does not stop the revoke',
  pg_temp.can('anon') = 0 AND pg_temp.can('authenticated') = 0 AND pg_temp.can('service_role') = 22);
DROP FUNCTION public.t_client_helper(uuid);
\ir revert_20261121113427_cron_writer_functions_execute_revoke.sql

-- (c) One of the 22 no longer runs as its owner. It is the 13th in the list: the twelve revokes before it roll back.
ALTER FUNCTION public.photo_land_backfill_drain(integer) SECURITY INVOKER;
UPDATE t_acl SET before_rerun = pg_temp.acl_md5();
\set ON_ERROR_STOP off
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: one of the 22 no longer runs as its owner, and no ACL changed',
  pg_temp.can('anon') = 22 AND pg_temp.can('authenticated') = 22 AND (SELECT before_rerun FROM t_acl) = pg_temp.acl_md5());
ALTER FUNCTION public.photo_land_backfill_drain(integer) SECURITY DEFINER;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Re-apply.
-- ---------------------------------------------------------------------------------------------------------------
\ir ../migrations/20261121113427_cron_writer_functions_execute_revoke.sql
TRUNCATE public.t_job_log;
SET ROLE anon;
SELECT pg_temp.ok('re-applied after the refusals: every one of the 22 refuses a logged-out call',
  (SELECT refused = 22 AND ran = 0 FROM pg_temp.call_all()));
SET ROLE dm_contract_deployer;
SELECT pg_temp.ok('re-applied after the refusals: nothing was written, and the service role keeps all 22',
  (SELECT count(*) FROM public.t_job_log) = 0 AND pg_temp.can('service_role') = 22);

RESET ROLE;
\echo 'test_cron_writer_functions_execute_revoke: all contract assertions passed'
