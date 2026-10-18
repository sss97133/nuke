-- Actual PG17 protected-registry regression. Synthetic IDs only; never run in production.
\set ON_ERROR_STOP on
-- Reuse the actual complete count/member migration and its 68 privacy/cap contracts.
-- Its initial guard requires an EMPTY disposable dm_refinement_* database.
\ir test_market_trends_recorded_sale_counts.sql
RESET ROLE;
DELETE FROM auction_events WHERE id::text LIKE '70000000-0000-0000-0000-%';

ALTER TABLE source_registry ADD COLUMN operator_secret text DEFAULT 'SYNTHETIC_OPERATOR_PRIVATE';
INSERT INTO source_registry(id,slug,display_name,extractor_function)
 VALUES('40000000-0000-0000-0000-000000000999','private-source','SYNTHETIC_PRIVATE_LABEL','SYNTHETIC_PRIVATE_EXTRACTOR');
-- Mirror actual source_registry: existing ordinary-role table grants do not grant row visibility.
GRANT ALL ON source_registry TO anon,authenticated,service_role;
ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_registry_read_all ON source_registry FOR SELECT TO authenticated USING(true);
CREATE POLICY source_registry_service_write ON source_registry FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE TEMP TABLE protected_source_contract AS SELECT c.relacl,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c WHERE c.oid='public.source_registry'::regclass;
CREATE TEMP TABLE protected_source_policies AS SELECT policyname,roles,cmd,qual,with_check
 FROM pg_policies WHERE schemaname='public' AND tablename='source_registry';
CREATE TEMP TABLE retained_readers AS SELECT oid,pg_get_functiondef(oid) AS definition,proacl
 FROM pg_proc WHERE oid IN('public.get_market_trends(text,text,integer,integer,text)'::regprocedure,
 'public.cohort_members(uuid)'::regprocedure,'public.cohort_members(uuid,uuid[])'::regprocedure);
CREATE TEMP TABLE count_acl AS SELECT proacl,proowner,prosecdef,proconfig
 FROM pg_proc WHERE oid='public.get_market_trends(jsonb)'::regprocedure;

SET ROLE anon;
SELECT assert_count(has_table_privilege('anon','public.source_registry','SELECT')
 AND(SELECT count(*)=0 FROM source_registry),'protected registry RLS hides rows despite table SELECT grant');
SELECT assert_count(get_market_trends(count_request())->>'reason'='source_registry_row_missing',
 'deployed count invoker reproduces public functional unavailable');
SELECT assert_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000001'))
 ->>'reason'='source_registry_row_missing','supported path also reproduces protected registry defect');
SET ROLE authenticated;
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6,
 'authenticated registry access confirms availability failure is not absent captured sales');
RESET ROLE;
-- Mirror live default grants on newly created views; migration must explicitly remove DML.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role;
\ir ../migrations/20261004085000_market_trends_public_source_labels.sql
-- CI can replay a successful SQL file after a later edge deployment fails.
CREATE TEMP TABLE repaired_count_contract AS SELECT oid,pg_get_functiondef(oid) AS definition,
 proacl,proowner,proconfig FROM pg_proc WHERE oid='public.get_market_trends(jsonb)'::regprocedure;
CREATE TEMP TABLE repaired_projection_contract AS SELECT oid,relacl,relowner,reloptions,
 pg_get_viewdef(oid) AS definition FROM pg_class WHERE oid='public.v_market_trend_source_labels'::regclass;
\ir ../migrations/20261004085000_market_trends_public_source_labels.sql
SELECT assert_count((SELECT old.definition=pg_get_functiondef(p.oid) AND old.proacl IS NOT DISTINCT FROM p.proacl
 AND old.proowner=p.proowner AND old.proconfig=p.proconfig FROM repaired_count_contract old
 JOIN pg_proc p USING(oid)),'actual twice-apply retains exact repaired count body, owner, ACL and config');
SELECT assert_count((SELECT old.definition=pg_get_viewdef(c.oid) AND old.relacl IS NOT DISTINCT FROM c.relacl
 AND old.relowner=c.relowner AND old.reloptions=c.reloptions FROM repaired_projection_contract old
 JOIN pg_class c USING(oid)),'actual twice-apply retains exact three-field barrier view, owner and ACL');

SELECT assert_count((SELECT c.relacl IS NOT DISTINCT FROM old.relacl AND c.relrowsecurity=old.relrowsecurity
 AND c.relforcerowsecurity=old.relforcerowsecurity FROM pg_class c CROSS JOIN protected_source_contract old
 WHERE c.oid='public.source_registry'::regclass),'protected source table ACL and RLS flags unchanged');
SELECT assert_count(NOT EXISTS((SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename='source_registry' EXCEPT SELECT * FROM protected_source_policies)
 UNION ALL(SELECT * FROM protected_source_policies EXCEPT SELECT policyname,roles,cmd,qual,with_check
 FROM pg_policies WHERE schemaname='public' AND tablename='source_registry')),
 'protected source policies unchanged');
SELECT assert_count((SELECT bool_and(old.definition=pg_get_functiondef(p.oid) AND old.proacl IS NOT DISTINCT FROM p.proacl)
 FROM retained_readers old JOIN pg_proc p USING(oid)),'legacy/member reader definitions and ACL unchanged');
SELECT assert_count((SELECT p.proacl IS NOT DISTINCT FROM old.proacl AND p.proowner=old.proowner
 AND NOT p.prosecdef AND p.prosecdef=old.prosecdef AND p.proconfig=old.proconfig
 FROM pg_proc p CROSS JOIN count_acl old WHERE p.oid='public.get_market_trends(jsonb)'::regprocedure),
 'count invoker owner/ACL/pinned path/timezone/5s preserved');
SELECT assert_count((SELECT reloptions @> ARRAY['security_barrier=true','security_invoker=false']
 FROM pg_class WHERE oid='public.v_market_trend_source_labels'::regclass),
 'intentional owner-mediated three-field projection has explicit security barrier');
SELECT assert_count((SELECT array_agg(column_name::text ORDER BY ordinal_position)=ARRAY['id','slug','display_name']::text[]
 FROM information_schema.columns WHERE table_schema='public' AND table_name='v_market_trend_source_labels'),
 'public view exposes exactly source identity and label, no operator fields');
SELECT assert_count(NOT has_table_privilege('public','public.v_market_trend_source_labels','SELECT'),
 'projection has no blanket PUBLIC grant');

SET ROLE anon;
SELECT assert_count((SELECT count(*)=0 FROM source_registry),'anonymous base registry remains hidden after repair');
SELECT assert_count((SELECT count(*)=1 AND min(id::text)='40000000-0000-0000-0000-000000000001'
 AND min(slug)='bringatrailer' AND min(display_name)='Synthetic source label'
 FROM v_market_trend_source_labels),'registered source UUID/slug/label is derived from actual protected row');
SELECT assert_count((SELECT count(*)=0 FROM v_market_trend_source_labels WHERE slug='private-source'),
 'other private registry source is not exposed');
SELECT assert_count(get_market_trends(count_request())->>'state'='partial'
 AND sum_count(get_market_trends(count_request()),'selected')=6
 AND sum_count(get_market_trends(count_request()),'benchmark')=1,'actual invoker public counts become available through label projection');
SELECT assert_count(sum_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000001')),
 'selected')=2,'supported bounded membership remains available through repaired lookup');
SELECT assert_count((get_market_trends(count_request())#>>'{source_registry,id}')='40000000-0000-0000-0000-000000000001'
 AND(get_market_trends(count_request())#>>'{source_registry,registry_declared_extractor}') IS NULL
 AND(get_market_trends(count_request())#>>'{source_registry,writer_registry_match}') IS NULL
 AND(get_market_trends(count_request())#>>'{source_registry,registry_declared_extractor_visibility}')='protected_unavailable',
 'public registered ID is real and protected declared writer/match are explicitly unknown');
SELECT assert_count(get_market_trends(count_request())::text NOT LIKE '%bat-simple-extract%'
 AND get_market_trends(count_request())::text NOT LIKE '%SYNTHETIC_OPERATOR_PRIVATE%'
 AND get_market_trends(count_request())::text NOT LIKE '%SYNTHETIC_PRIVATE_LABEL%',
 'no operator or other-source metadata leaks through count receipt');
SELECT assert_count((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id' IN('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'))),
 'repaired public contributor drill still excludes private/deleted/nonvehicle parents');
SELECT assert_count(get_market_trends(count_request()||'{"source_registry_slug":"private-source"}')->>'state'='unavailable',
 'unknown/private source cannot broaden registered count scope');
SELECT assert_count(has_table_privilege('anon','public.v_market_trend_source_labels','SELECT')
 AND NOT has_table_privilege('anon','public.v_market_trend_source_labels','INSERT')
 AND NOT has_table_privilege('anon','public.v_market_trend_source_labels','UPDATE')
 AND NOT has_table_privilege('anon','public.v_market_trend_source_labels','DELETE'),
 'anonymous view permission is SELECT only despite permissive defaults');
DO $$ BEGIN
 BEGIN
  UPDATE public.v_market_trend_source_labels SET display_name='forbidden';
  RAISE EXCEPTION 'FAILED: public label mutation allowed';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: actual anonymous label UPDATE denied';
 END;
END $$;
SET ROLE authenticated;
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6
 AND NOT has_table_privilege('authenticated','public.v_market_trend_source_labels','UPDATE'),
 'authenticated private owner cannot change public counts or write label view');
SET ROLE service_role;
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6
 AND NOT has_table_privilege('service_role','public.v_market_trend_source_labels','UPDATE'),
 'service bypass cannot change public counts and projection adds no writer grant');
RESET ROLE;
BEGIN;
DELETE FROM source_registry WHERE slug='bringatrailer';
SET ROLE anon;
SELECT assert_count(get_market_trends(count_request())->>'reason'='source_registry_row_missing',
 'absent registered row returns unavailable; label/UUID are never hardcoded guesses');
RESET ROLE;
ROLLBACK;
