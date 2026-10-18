-- Empty disposable PG17 dm_refinement_* database only; actual reader and synthetic rows.
\set ON_ERROR_STOP on
\ir test_family_sales_truncation_contract.sql

CREATE TEMP TABLE gate_fixture (i integer, brand text, family_key text, usd numeric, model text, age integer);
INSERT INTO gate_fixture VALUES
  (1,'Ford','mustang',10000,'Mustang',1),
  (2,'Ford','mustang',11000,'Mustang',2),
  (3,'Ford','pickup',12000,'Pickup',3),
  (4,'Ford','f150',13000,'F-150',4),
  (5,'Chevrolet','pickup',14000,'Pickup',5),
  (6,'Chevrolet','c10',15000,'C10',6),
  (7,'Chevrolet','silverado',16000,'Silverado',7),
  (8,'Chevrolet','other-truck',17000,'Custom Silverado pickup',8),
  (9,'GMC','pickup',18000,'Pickup',9),
  (10,'GMC','sierra',19000,'Sierra',10),
  (11,'GMC','other-truck',20000,'Custom Sierra 1500',11),
  (12,'Chevrolet','camaro',21000,'Camaro',12),
  (13,'Ford','mustang',22000,'Mustang',-2), -- future: still excluded
  (14,'Ford','mustang',23000,'Mustang',2200), -- outside window
  (15,'Ford','other-truck',24000,'Silverado bait on an unrelated Ford',13);
INSERT INTO public.vehicles (id,model,vin)
  SELECT md5('gate-fixture-'||i)::uuid,model,'FIXTURE'||i FROM gate_fixture;
INSERT INTO public.mv_family_sales (vehicle_id,brand,family_key,sale_date,usd,source,year,model)
  SELECT md5('gate-fixture-'||i)::uuid,brand,family_key,current_date-age,usd,'Bring a Trailer',2000,model FROM gate_fixture;
INSERT INTO public.mv_family_market VALUES
  ('Ford','mustang','Mustang'),('Ford','pickup','Pickup'),('Ford','f150','F-150'),
  ('Chevrolet','pickup','Pickup'),('Chevrolet','c10','C10'),('Chevrolet','silverado','Silverado'),
  ('Chevrolet','camaro','Camaro'),('GMC','pickup','Pickup'),('GMC','sierra','Sierra');

-- Give the generic plan a real irrelevant brand population to visit on the old fallback arm.
INSERT INTO public.mv_family_sales (vehicle_id,brand,family_key,sale_date,usd,source,year,model)
  SELECT md5('unrelated-gate-'||i)::uuid,CASE WHEN i%2=0 THEN 'Ford' ELSE 'Porsche' END,
    'other-'||(i%1000),current_date-30,30000+i,'Mecum',1990,'Other model'
  FROM generate_series(1,40000) i;
CREATE INDEX gate_sales_family_date ON public.mv_family_sales (brand,family_key,sale_date DESC);
CREATE INDEX gate_market_family ON public.mv_family_market (brand,family_key);
ANALYZE public.mv_family_sales;
ANALYZE public.mv_family_market;
ANALYZE public.vehicles;

CREATE TEMP TABLE gate_cases (label text, brand text, family_key text, cap integer, expected_n integer);
INSERT INTO gate_cases VALUES
  ('mustang','Ford','mustang',15000,2),('mustang-capped','Ford','mustang',1,2),
  ('ford-pickup','Ford','pickup',15000,2),('porsche','Porsche','911',15000,5),
  ('chevrolet-pickup','Chevrolet','pickup',15000,3),('silverado-fallback','Chevrolet','silverado',15000,2),
  ('gmc-pickup','GMC','pickup',15000,2),('sierra-fallback','GMC','sierra',15000,2),
  ('camaro','Chevrolet','camaro',15000,1),('missing-family','Ford','missing',15000,0),
  ('missing-brand','No such brand','missing',15000,0),('null-brand',NULL,'mustang',15000,0),
  ('null-family','Ford',NULL,15000,0);
CREATE TEMP TABLE gate_before AS
  SELECT c.*,public.treemap_family_sales(brand,family_key,cap) AS result FROM gate_cases c;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM gate_before WHERE (result->>'n')::int<>expected_n),
  'baseline controls cover native families, pickup unions, Silverado/Sierra fallbacks and empty/NULL inputs');
CREATE TEMP TABLE gate_attributes AS
  SELECT oid,prosecdef,provolatile,proparallel,proisstrict,proconfig,proacl,proargdefaults::text AS defaults
  FROM pg_proc WHERE oid='public.treemap_family_sales(text,text,integer)'::regprocedure;

-- EXPLAIN of a SQL-function call hides its internal plan. Prepare the actual prosrc with parameters instead,
-- then force the same generic planning mode and inspect execution loops rather than wall-clock timing.
SET plan_cache_mode=force_generic_plan;
CREATE FUNCTION pg_temp.gate_plan() RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE body text; plan jsonb;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='public.treemap_family_sales(text,text,integer)'::regprocedure;
  body:=replace(replace(replace(body,'p_brand','$1'),'p_family_key','$2'),'p_limit','$3');
  EXECUTE 'PREPARE family_gate_probe(text,text,integer) AS '||body;
  EXECUTE 'EXPLAIN (ANALYZE,FORMAT JSON) EXECUTE family_gate_probe(''Ford'',''mustang'',15000)' INTO plan;
  EXECUTE 'DEALLOCATE family_gate_probe';
  RETURN plan;
END $test$;
CREATE FUNCTION pg_temp.fallback_scans(plan jsonb) RETURNS SETOF jsonb LANGUAGE sql AS $test$
  SELECT DISTINCT node FROM jsonb_path_query(plan,'lax $.** ? (@."Relation Name" == "mv_family_sales")') node
  WHERE node->>'Filter' LIKE '%silverado%'
$test$;
CREATE TEMP TABLE gate_old_plan AS SELECT pg_temp.gate_plan() AS j;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM gate_old_plan,pg_temp.fallback_scans(j) node
  WHERE (node->>'Actual Loops')::int>0 AND (node->>'Rows Removed by Filter')::int>=10000),
  'negative control: the old generic Ford read scans thousands of irrelevant fallback rows');

\ir ../migrations/20261019083000_family_sales_gate_brand_fallback.sql
\ir ../migrations/20261019083000_family_sales_gate_brand_fallback.sql

SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM gate_before b
  WHERE public.treemap_family_sales(b.brand,b.family_key,b.cap) IS DISTINCT FROM b.result),
  'every full result is identical, including both truck fallbacks, row order, counts, cap and date exclusions');
SELECT pg_temp.check((SELECT md5(prosrc)::uuid='b5714a15-c8ff-d169-6675-e25e053b217f'::uuid FROM pg_proc
  WHERE oid='public.treemap_family_sales(text,text,integer)'::regprocedure), 'the exact reviewed body is installed');
SELECT pg_temp.check((SELECT to_jsonb(a)=jsonb_build_object('oid',p.oid,'prosecdef',p.prosecdef,
  'provolatile',p.provolatile,'proparallel',p.proparallel,'proisstrict',p.proisstrict,'proconfig',p.proconfig,
  'proacl',p.proacl,'defaults',p.proargdefaults::text) FROM gate_attributes a JOIN pg_proc p USING(oid)),
  'identity, invoker rights, attributes, configuration, grants and defaults are unchanged');

CREATE TEMP TABLE gate_new_plan AS SELECT pg_temp.gate_plan() AS j;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM gate_new_plan,pg_temp.fallback_scans(j) node)
  AND NOT EXISTS (SELECT 1 FROM gate_new_plan,pg_temp.fallback_scans(j) node WHERE (node->>'Actual Loops')::int<>0),
  'the actual new generic Ford plan never executes the ineligible fallback scan');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM gate_new_plan,
  jsonb_path_query(j,'lax $.** ? (exists(@."One-Time Filter"))') node
  WHERE node->>'One-Time Filter' LIKE '%Chevrolet,GMC%'), 'the brand guard gates the scan once per execution');

GRANT SELECT ON public.vehicles,public.mv_family_sales,public.mv_family_market TO anon;
SET ROLE anon;
SELECT pg_temp.check((public.treemap_family_sales('Ford','mustang',15000)->>'n')::int=2,
  'the anonymous actual reader still returns the intended native family');
SELECT pg_temp.check((public.treemap_family_sales('Chevrolet','silverado',15000)->>'n')::int=2,
  'the anonymous actual reader still returns the cross-family Silverado fallback');
RESET ROLE;
SELECT 'family sales fallback gate contract passed' AS result;
