-- Actual PostgreSQL17 migration contract. Synthetic prices/IDs only; never run on production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database';
  END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.vehicles(
 id uuid PRIMARY KEY,make text DEFAULT 'SYNTHETIC',model text,year integer DEFAULT 1980,
 sale_price integer,sale_date date DEFAULT(CURRENT_DATE-2),mileage integer,
 is_public boolean DEFAULT true,deleted_at timestamptz,listing_kind text DEFAULT 'vehicle',
 sale_status text DEFAULT 'sold',auction_outcome text,canonical_platform text DEFAULT 'bat',
 listing_url text DEFAULT 'https://example.test/lot',discovery_url text,notes text,import_metadata jsonb,
 created_at timestamptz DEFAULT '2026-09-28 00:00:00+00'
);
-- This catalog-index shape is a local fixture only. The historical make/date index is absent live.
CREATE INDEX fixture_make_price ON public.vehicles(lower(make),sale_price);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON public.vehicles FOR SELECT TO anon,authenticated USING(is_public);
CREATE POLICY private_owner_read ON public.vehicles FOR SELECT TO authenticated
 USING(id='00000000-0000-0000-0000-000000000002');
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.vehicles TO anon,authenticated,service_role;
CREATE MATERIALIZED VIEW public.clean_vehicle_prices AS SELECT 1 AS fixture;
\ir ../migrations/20260927180000_sale_basis_conflicts_not_proven.sql

INSERT INTO public.vehicles(id,model,sale_price,mileage)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'CASE_'||i,i*100,i*1000
 FROM generate_series(1,26) i;
UPDATE vehicles SET sale_price=1000,model='VALID' WHERE id::text LIKE '%000001';
UPDATE vehicles SET is_public=false WHERE id::text LIKE '%000002';
UPDATE vehicles SET deleted_at=now() WHERE id::text LIKE '%000003';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE id::text LIKE '%000004';
UPDATE vehicles SET sale_status='not_sold' WHERE id::text LIKE '%000005';
UPDATE vehicles SET sale_status='auction_live' WHERE id::text LIKE '%000006';
UPDATE vehicles SET sale_status='for_sale' WHERE id::text LIKE '%000007';
UPDATE vehicles SET auction_outcome='reserve_not_met' WHERE id::text LIKE '%000008';
UPDATE vehicles SET sale_status='not_sold',auction_outcome='sold' WHERE id::text LIKE '%000009';
UPDATE vehicles SET sale_status=NULL,auction_outcome=NULL WHERE id::text LIKE '%000010';
UPDATE vehicles SET sale_price=NULL WHERE id::text LIKE '%000011';
UPDATE vehicles SET sale_price=0 WHERE id::text LIKE '%000012';
UPDATE vehicles SET sale_price=-1300 WHERE id::text LIKE '%000013';
UPDATE vehicles SET sale_date=NULL WHERE id::text LIKE '%000014';
UPDATE vehicles SET sale_date=CURRENT_DATE+1 WHERE id::text LIKE '%000015';
UPDATE vehicles SET sale_date=CURRENT_DATE-31 WHERE id::text LIKE '%000016';
UPDATE vehicles SET is_public=NULL WHERE id::text LIKE '%000017';
UPDATE vehicles SET listing_kind=NULL,year=1985 WHERE id::text LIKE '%000018';
UPDATE vehicles SET sale_status=NULL,auction_outcome='sold',year=NULL WHERE id::text LIKE '%000019';
UPDATE vehicles SET sale_status=NULL,auction_outcome=NULL,canonical_platform='unknown' WHERE id::text LIKE '%000020';
UPDATE vehicles SET sale_status=NULL,canonical_platform='mecum',notes='Result: sold',
 created_at='2026-09-01 00:00:00+00' WHERE id::text LIKE '%000021';
UPDATE vehicles SET canonical_platform='mecum',notes='Result: bid-goes-on' WHERE id::text LIKE '%000022';
UPDATE vehicles SET sale_status=NULL,canonical_platform='mecum',notes='Result: sold' WHERE id::text LIKE '%000023';
UPDATE vehicles SET make=NULL WHERE id::text LIKE '%000024';
UPDATE vehicles SET model=NULL WHERE id::text LIKE '%000025';
UPDATE vehicles SET make='OTHER' WHERE id::text LIKE '%000026';

-- Existing deployed SECURITY DEFINER/ACL context, with a deliberately raw-price reader to reproduce the leak.
CREATE FUNCTION public.get_market_trends(
 p_make text,p_model text DEFAULT NULL,p_year_from integer DEFAULT NULL,p_year_to integer DEFAULT NULL,
 p_period text DEFAULT '90d')
RETURNS TABLE(period_start date,period_end date,sale_count bigint,avg_price numeric,median_price numeric,
 p25_price numeric,p75_price numeric,min_price numeric,max_price numeric,avg_mileage numeric)
LANGUAGE sql SECURITY DEFINER SET statement_timeout='5s' AS $$
 SELECT CURRENT_DATE-30,CURRENT_DATE,count(*)::bigint,avg(sale_price)::numeric,
 NULL::numeric,NULL::numeric,NULL::numeric,min(sale_price)::numeric,max(sale_price)::numeric,NULL::numeric
 FROM public.vehicles WHERE lower(make)=lower(p_make) AND sale_price>0 AND sale_date>=CURRENT_DATE-30
 AND sale_date<=CURRENT_DATE AND(p_model IS NULL OR lower(model)=lower(p_model))
$$;
GRANT EXECUTE ON FUNCTION public.get_market_trends(text,text,integer,integer,text) TO anon,authenticated,service_role;
CREATE TEMP TABLE prior_function_contract AS SELECT proacl,prosecdef,pg_get_function_result(oid) AS result,
 pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.get_market_trends(text,text,integer,integer,text)'::regprocedure;
CREATE FUNCTION public.assert_market_trends(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
 RAISE NOTICE 'PASS: %',label; END $$;
SET ROLE anon;
SELECT assert_market_trends((SELECT sum(sale_count)=1 FROM get_market_trends('SYNTHETIC','CASE_2',NULL,NULL,'30d')),
 'raw definer reproduces private-price aggregate despite parent RLS');
RESET ROLE;
\ir ../migrations/20261004071000_market_trends_public_sale_eligibility.sql
SELECT assert_market_trends((SELECT old.proacl IS NOT DISTINCT FROM p.proacl AND old.prosecdef=p.prosecdef
 AND old.result=pg_get_function_result(p.oid) AND old.owner=pg_get_userbyid(p.proowner)
 FROM prior_function_contract old CROSS JOIN pg_proc p
 WHERE p.oid='public.get_market_trends(text,text,integer,integer,text)'::regprocedure),
 'signature/table/security context/owner/ACL preserved');
SELECT assert_market_trends((SELECT proconfig @> ARRAY['statement_timeout=5s','search_path=public, pg_temp']
 FROM pg_proc WHERE oid='public.get_market_trends(text,text,integer,integer,text)'::regprocedure),
 'five-second reader timeout retained and search_path pinned');
SET ROLE anon;
SELECT assert_market_trends((SELECT sum(sale_count)=5 FROM get_market_trends('synthetic',NULL,NULL,NULL,'30d')),
 'only positive known-dated supported public sale records contribute');
SELECT assert_market_trends((SELECT avg_price=1860 AND median_price=1900 AND p25_price=1800 AND p75_price=2100
 AND min_price=1000 AND max_price=2500 AND avg_mileage=16800
 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'30d') WHERE sale_count>0),
 'all legacy price/mileage aggregates exclude denied and unproven rows');
SELECT assert_market_trends((SELECT count(*)=5 AND count(*) FILTER(WHERE sale_count=0 AND avg_price IS NULL)=4
 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'30d')),'legacy fixed-width empty buckets retained');
SELECT assert_market_trends((SELECT sum(sale_count)=1 FROM get_market_trends('SYNTHETIC','valid',NULL,NULL,'30d')),
 'exact case-insensitive make/model parameters retained');
SELECT assert_market_trends((SELECT sum(sale_count)=0 FROM get_market_trends(NULL,NULL,NULL,NULL,'30d')),
 'NULL make does not expand the population');
SELECT assert_market_trends((SELECT sum(sale_count)=1 FROM get_market_trends('SYNTHETIC','CASE_18',NULL,NULL,'30d')),
 'NULL listing_kind retains real vehicle compatibility');
SELECT assert_market_trends((SELECT sum(sale_count)=1 FROM get_market_trends('SYNTHETIC','CASE_19',NULL,NULL,'30d')),
 'sold outcome with NULL sale_status remains supported');
SELECT assert_market_trends((SELECT sum(sale_count)=1 FROM get_market_trends('SYNTHETIC','CASE_21',NULL,NULL,'30d')),
 'sanctioned pre-cutover platform sale marker remains supported');
SELECT assert_market_trends((SELECT sum(sale_count)=3 FROM get_market_trends('SYNTHETIC',NULL,1980,1980,'30d')),
 'year bounds retain their existing NULL exclusion and range behavior');
SELECT assert_market_trends((SELECT sum(sale_count)=0 FROM get_market_trends('SYNTHETIC','quote'' OR true --',NULL,NULL,'30d')),
 'parameter binding prevents SQL text from broadening scope');
DO $$
DECLARE case_id integer;
BEGIN
 FOREACH case_id IN ARRAY ARRAY[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,20,22,23] LOOP
   PERFORM public.assert_market_trends((SELECT sum(sale_count)=0 FROM public.get_market_trends(
    'SYNTHETIC','CASE_'||case_id,NULL,NULL,'30d')),'excluded case '||case_id);
 END LOOP;
END $$;
SELECT assert_market_trends((SELECT sum(sale_count)=6 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'90d')),
 'older supported sale remains available under wider period');
SELECT assert_market_trends((SELECT count(*)=7 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'90d')),
 'ninety-day bucket contract retained');
SELECT assert_market_trends((SELECT count(*)=13 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'1y')),
 'year bucket contract retained');
SELECT assert_market_trends((SELECT count(*)=13 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'3y')),
 'three-year bucket contract retained');
SELECT assert_market_trends((SELECT a.sale_count=b.sale_count AND a.period_start=b.period_start
 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'unknown') a
 JOIN get_market_trends('SYNTHETIC',NULL,NULL,NULL,'90d') b USING(period_start)
 ORDER BY a.period_start LIMIT 1),'unknown period retains deployed ninety-day fallback');
SET ROLE authenticated;
SELECT assert_market_trends((SELECT sum(sale_count)=0 FROM get_market_trends('SYNTHETIC','CASE_2',NULL,NULL,'30d')),
 'authenticated private-owner RLS access cannot enter public aggregate');
SET ROLE service_role;
SELECT assert_market_trends((SELECT sum(sale_count)=5 FROM get_market_trends('SYNTHETIC',NULL,NULL,NULL,'30d')),
 'privileged RLS-bypassing caller still receives only public supported sales');
RESET ROLE;
CREATE SCHEMA shadow_reader;
CREATE TABLE shadow_reader.vehicles (LIKE public.vehicles);
INSERT INTO shadow_reader.vehicles SELECT * FROM public.vehicles WHERE id::text LIKE '%000002';
CREATE FUNCTION shadow_reader.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)
RETURNS text LANGUAGE sql AS $$ SELECT 'status'::text $$;
GRANT USAGE ON SCHEMA shadow_reader TO anon;
GRANT SELECT ON shadow_reader.vehicles TO anon;
SET ROLE anon;
SET search_path=shadow_reader,public;
SELECT public.assert_market_trends((SELECT sum(sale_count)=5 FROM public.get_market_trends(
 'SYNTHETIC',NULL,NULL,NULL,'30d')),'caller schema cannot shadow the parent table or sale predicate');
RESET search_path;
RESET ROLE;
