-- Activate the privately built copy from 20261018232934. Full build:79.5s,101,347 rows.
-- Read-only corrected Bultaco/Suzuki reference:716 rows, exact digest equal to built copy.
-- This is an evaluation optimization, not a change to price/cohort eligibility.
-- Preserve populated original privately for reverse rename; no drops or cron changes.
-- Reversible rename only after the private optimized build is validated.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $swap$
DECLARE live text; want text; g record;
BEGIN
 IF to_regclass('public.mv_family_year_prices_v2') IS NULL THEN
   IF pg_get_viewdef('public.mv_family_year_prices'::regclass) LIKE '%named AS MATERIALIZED%'
      AND pg_get_viewdef('public.mv_family_year_prices'::regclass) LIKE '%p AS MATERIALIZED%' THEN RETURN; END IF;
   RAISE EXCEPTION 'no optimized beside copy';
 END IF;
 IF to_regclass('public.mv_family_year_prices_v1') IS NOT NULL THEN
   RAISE EXCEPTION 'archive already exists; preserve and inspect'; END IF;
 IF NOT (SELECT relispopulated FROM pg_class WHERE oid='public.mv_family_year_prices_v2'::regclass)
    OR NOT EXISTS(SELECT 1 FROM public.mv_family_year_prices_v2) THEN
   RAISE EXCEPTION 'optimized copy is not built'; END IF;
 IF has_table_privilege('anon','public.mv_family_year_prices_v2','SELECT')
    OR has_table_privilege('authenticated','public.mv_family_year_prices_v2','SELECT') THEN
   RAISE EXCEPTION 'beside copy became public'; END IF;
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
    WHERE d.refobjid IN ('public.mv_family_year_prices'::regclass,'public.mv_family_year_prices_v2'::regclass)
      AND d.classid='pg_rewrite'::regclass AND r.ev_class<>d.refobjid)
 OR EXISTS(SELECT 1 FROM pg_depend d WHERE d.refobjid IN
    (SELECT reltype FROM pg_class WHERE oid IN ('public.mv_family_year_prices'::regclass,'public.mv_family_year_prices_v2'::regclass))
    AND d.deptype='n') THEN RAISE EXCEPTION 'tracked consumers changed; inspect before rename'; END IF;
 live:=pg_get_viewdef('public.mv_family_year_prices'::regclass);
 IF (SELECT count(*) FROM regexp_matches(live,'\mnamed AS \(','g'))<>1
    OR (SELECT count(*) FROM regexp_matches(live,'\mp AS \(','g'))<>1 THEN
   RAISE EXCEPTION 'live stages changed'; END IF;
 want:=replace(replace(live,'named AS (','named AS MATERIALIZED ('),'p AS (','p AS MATERIALIZED (');
 EXECUTE 'CREATE TEMP VIEW fyp_swap_want AS '||regexp_replace(want,';\s*$','');
 want:=pg_get_viewdef('pg_temp.fyp_swap_want'::regclass);
 DROP VIEW pg_temp.fyp_swap_want;
 IF pg_get_viewdef('public.mv_family_year_prices_v2'::regclass)<>want THEN
   RAISE EXCEPTION 'copy changes rules beyond the two evaluation fences'; END IF;
 -- Preserve exact reader privileges at its original name; archive becomes owner-only.
 FOR g IN SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
                  a.privilege_type,a.is_grantable
          FROM pg_class c,aclexplode(c.relacl) a
          WHERE c.oid='public.mv_family_year_prices'::regclass AND a.grantee<>c.relowner LOOP
   EXECUTE format('GRANT %s ON public.mv_family_year_prices_v2 TO %s%s',g.privilege_type,g.grantee,
                  CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
 END LOOP;
 ALTER MATERIALIZED VIEW public.mv_family_year_prices RENAME TO mv_family_year_prices_v1;
 ALTER MATERIALIZED VIEW public.mv_family_year_prices_v2 RENAME TO mv_family_year_prices;
 ALTER INDEX public.mv_family_year_prices_key RENAME TO mv_family_year_prices_key_v1;
 ALTER INDEX public.mv_family_year_prices_key_v2 RENAME TO mv_family_year_prices_key;
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee
          FROM pg_class c,aclexplode(c.relacl) a
          WHERE c.oid='public.mv_family_year_prices_v1'::regclass AND a.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON public.mv_family_year_prices_v1 FROM %s',g.grantee);
 END LOOP;
 COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_v1 IS
   'Pre-optimization year-price fold retained privately for reversible rename; no public readers.';
END $swap$;
NOTIFY pgrst,'reload schema';
COMMIT;
