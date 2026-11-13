-- Disposable PG17 only: inherits original blank-database guard and full cursor/tape contracts.
\set ON_ERROR_STOP on
\ir test_cc_v2_snapshot_tape.sql
CREATE TEMP TABLE plus_prior_acl AS SELECT proacl FROM pg_proc WHERE oid='public.cc_latest_snapshot_states(jsonb)'::regprocedure;
\ir ../migrations/20261109022100_cc_literal_plus_native_slug.sql
\ir ../migrations/20261109022100_cc_literal_plus_native_slug.sql
DO $$ BEGIN
 IF (SELECT proacl FROM pg_proc WHERE oid='public.cc_latest_snapshot_states(jsonb)'::regprocedure) IS DISTINCT FROM (SELECT proacl FROM plus_prior_acl) THEN RAISE EXCEPTION 'Cursor grants changed'; END IF;
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Caller budgets changed'; END IF;
END $$;
SET ROLE service_role;
DO $$ DECLARE lots jsonb; bad text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('vehicle_id','00000000-0000-4000-8000-000000000001',
 'source_url',CASE WHEN n=188 THEN 'https://collectingcars.com/for-sale/2021-mercedes-amg-gt-43-4matic+' ELSE 'https://collectingcars.com/for-sale/fixture-'||n END)) INTO lots FROM generate_series(1,188) n;
 IF cc_latest_snapshot_states(lots)<>'[]'::jsonb THEN RAISE EXCEPTION 'Fixture invented prior owners'; END IF;
 FOREACH bad IN ARRAY ARRAY['https://evil.example/for-sale/4matic+','https://collectingcars.com/for-sale/wrong?query','https://collectingcars.com/for-sale/wrong#fragment','https://collectingcars.com/for-sale/../wrong'] LOOP
  BEGIN PERFORM cc_latest_snapshot_states(jsonb_build_array(jsonb_build_object('vehicle_id','00000000-0000-4000-8000-000000000001','source_url',bad)));
   RAISE EXCEPTION 'Unsafe owner accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unsafe owner accepted' THEN RAISE; END IF; END;
 END LOOP;
END $$;
RESET ROLE;
