-- Disposable synthetic contract: p_include_visual=false drops only the visual work part of the
-- public build log; two-argument calls and grants are unchanged. No production rows.
\set ON_ERROR_STOP on
\ir test_visual_work_build_log_state.sql

-- A current visual work card so the visual part is present before the change.
UPDATE vehicle_observations SET is_superseded=false,structured_data=(SELECT packet FROM baseline_packet)
 WHERE id='a0000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE before_log(include_reported boolean PRIMARY KEY, output jsonb);
DO $$ BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 INSERT INTO before_log VALUES(false,public.vehicle_build_log_public('10000000-0000-0000-0000-000000000001',false)),
  (true,public.vehicle_build_log_public('10000000-0000-0000-0000-000000000001',true));
 ASSERT (SELECT output FROM before_log WHERE include_reported) ? 'master_ledger','fixture needs visual work';
END $$;
CREATE TEMP TABLE before_acl AS SELECT a.grantee::regrole::text AS grantee FROM pg_proc p, aclexplode(p.proacl) a
 WHERE p.oid='public.vehicle_build_log_public(uuid,boolean)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>0;

\ir ../migrations/20261116028000_build_log_public_visual_optional.sql

DO $$
DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; b jsonb; t boolean;
BEGIN
 ASSERT to_regprocedure('public.vehicle_build_log_public(uuid,boolean)') IS NULL,'the two-argument signature is replaced';
 ASSERT (SELECT array_agg(a.grantee::regrole::text ORDER BY 1) FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid='public.vehicle_build_log_public(uuid,boolean,boolean)'::regprocedure AND a.privilege_type='EXECUTE')
  IS NOT DISTINCT FROM (SELECT array_agg(grantee ORDER BY 1) FROM before_acl),'grants unchanged';
 ASSERT (SELECT count(*) FROM before_acl WHERE grantee IN ('anon','authenticated','service_role'))=3,'fixture grants';
 ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid='public.vehicle_build_log_public(uuid,boolean,boolean)'::regprocedure AND a.grantee=0),'no PUBLIC execute';
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 FOR t IN SELECT unnest(ARRAY[false,true]) LOOP
  SELECT output INTO b FROM before_log WHERE include_reported=t;
  -- Two-argument calls (the profile's visual work hook) return what they returned before.
  ASSERT public.vehicle_build_log_public(v,t) #- '{master_ledger,as_of}' = b #- '{master_ledger,as_of}';
  ASSERT public.vehicle_build_log_public(v,t,true) #- '{master_ledger,as_of}' = b #- '{master_ledger,as_of}';
  -- Without visual work: exactly the work table keys.
  ASSERT public.vehicle_build_log_public(v,t,false) = jsonb_build_object('work_records',b->'work_records','reported_work',b->'reported_work'),
   'include_reported='||t;
 END LOOP;
 -- Named arguments as PostgREST sends them resolve to the one function.
 ASSERT public.vehicle_build_log_public(p_vehicle_id=>v,p_include_reported=>true) ? 'master_ledger';
 ASSERT NOT (public.vehicle_build_log_public(p_vehicle_id=>v,p_include_reported=>true,p_include_visual=>false) ? 'master_ledger');
 -- A NULL flag keeps the default behavior.
 ASSERT public.vehicle_build_log_public(v,true,NULL) ? 'master_ledger';
END $$;
SELECT 'build log public visual optional contract passed' AS result;
