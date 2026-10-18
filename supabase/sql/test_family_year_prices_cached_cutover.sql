-- Disposable PG17 only: actual pricing fixtures, private copy and current refresh owner.
\ir test_family_year_prices_cached_conflicts.sql
-- Base fixture helper returns the old composite type; the production guard correctly refuses it.
-- Remove this test-only consumer before exercising the accepted production-shaped case.
DROP FUNCTION pg_temp.r(text,integer,text);
-- Match the production service ACL, and exercise a retained grant option too.
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
 ON public.mv_family_year_prices TO service_role;
GRANT SELECT ON public.mv_family_year_prices TO authenticated WITH GRANT OPTION;
CREATE TEMP TABLE cached_acl_before AS
SELECT a.grantee,a.privilege_type,a.is_grantable FROM pg_class c,aclexplode(c.relacl) a
WHERE c.oid='public.mv_family_year_prices'::regclass AND a.grantee<>c.relowner;
\ir ../migrations/20261018234554_activate_cached_family_year_prices.sql
\ir ../migrations/20261018234554_activate_cached_family_year_prices.sql
SELECT pg_temp.ok('populated optimized reader replaces its name; populated archive stays private',
 (SELECT relispopulated FROM pg_class WHERE oid='public.mv_family_year_prices'::regclass)
 AND (SELECT relispopulated FROM pg_class WHERE oid='public.mv_family_year_prices_v1'::regclass)
 AND pg_get_viewdef('public.mv_family_year_prices'::regclass) LIKE '%p AS MATERIALIZED%'
 AND NOT has_table_privilege('anon','public.mv_family_year_prices_v1','SELECT')
 AND NOT has_table_privilege('authenticated','public.mv_family_year_prices_v1','SELECT')
 AND NOT has_table_privilege('service_role','public.mv_family_year_prices_v1','SELECT'));
SELECT pg_temp.ok('reader preserves exact non-owner role privileges and grant options',
 NOT EXISTS(SELECT * FROM cached_acl_before EXCEPT ALL
   SELECT a.grantee,a.privilege_type,a.is_grantable FROM pg_class c,aclexplode(c.relacl) a
   WHERE c.oid='public.mv_family_year_prices'::regclass AND a.grantee<>c.relowner)
 AND NOT EXISTS(SELECT a.grantee,a.privilege_type,a.is_grantable FROM pg_class c,aclexplode(c.relacl) a
   WHERE c.oid='public.mv_family_year_prices'::regclass AND a.grantee<>c.relowner
   EXCEPT ALL SELECT * FROM cached_acl_before));
GRANT SELECT ON before_cached_prices TO anon;
SELECT public.refresh_family_year_prices();
SET ROLE anon;
SELECT pg_temp.ok('existing owner still refreshes concurrently; anonymous reader retains all pricing values',
 NOT EXISTS(SELECT to_jsonb(v)-'as_of' FROM public.mv_family_year_prices v
   EXCEPT ALL SELECT to_jsonb(v)-'as_of' FROM before_cached_prices v)
 AND NOT EXISTS(SELECT to_jsonb(v)-'as_of' FROM before_cached_prices v
   EXCEPT ALL SELECT to_jsonb(v)-'as_of' FROM public.mv_family_year_prices v));
RESET ROLE;
