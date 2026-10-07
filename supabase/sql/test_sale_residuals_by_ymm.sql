-- Synthetic PostgreSQL 17 contract; run in an empty dm_refinement_* database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.fixture_sales') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
SET timezone='UTC';
SET statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
CREATE TABLE fixture_sales(e jsonb);
CREATE TABLE fixture_contract(complete boolean DEFAULT true, error text);
INSERT INTO fixture_contract DEFAULT VALUES;
CREATE TABLE vehicle_location_observations(
 id uuid PRIMARY KEY,vehicle_id uuid,source_type text,source_url text,observed_at timestamptz,
 created_at timestamptz,country_code text,confidence real,county_fips text
);
CREATE INDEX ON vehicle_location_observations(vehicle_id,observed_at DESC);
CREATE TABLE us_county_boundaries(fips text PRIMARY KEY);
INSERT INTO us_county_boundaries VALUES('32003'),('06037');
CREATE FUNCTION valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.error IS NOT NULL THEN jsonb_build_object('error',c.error)
  ELSE jsonb_build_object('query',jsonb_build_object('year',$1,'make',$2,'model',$3),
    'receipt',jsonb_build_object('coverage',jsonb_build_object('complete',c.complete),
      'cohort',jsonb_build_object('complete',true,'membership_as_of','current_recorded_membership_not_historical'),
      'currency',$7,'price_basis','published_bid_excluding_fees','knowledge_mode',$10,
      'event_from',$5,'event_before',$4,'evidence_as_of',$6,
      'eligible',coalesce((SELECT jsonb_agg(e) FROM fixture_sales
        WHERE (e->>'eventAt')::date >= $5::date AND (e->>'eventAt')::date < $4::date
          AND (e->>'knownAt')::timestamptz <= $6),'[]'::jsonb))) END
  FROM fixture_contract c;
$$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
CREATE FUNCTION pg_temp.sale(n integer,day date,amount numeric,vehicle integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('vehicleId',('00000000-0000-0000-0000-'||lpad(coalesce(vehicle,n)::text,12,'0'))::uuid,
 'sourceKey','bringatrailer.com/listing/synthetic-'||n,'snapshotId',('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'amount',amount,'eventAt',day,'knownAt','2026-01-01T00:00:00Z',
 'outcome','sold','currency','USD','priceBasis','published_bid_excluding_fees');
$$;
INSERT INTO fixture_sales SELECT pg_temp.sale(i,'2025-01-01',100) FROM generate_series(1,10) i;
-- Same vehicle sold twice: the older episode belongs in the baseline.
INSERT INTO fixture_sales VALUES(pg_temp.sale(11,'2025-03-03',200,1)),(pg_temp.sale(12,'2025-03-04',50,1));
-- Outside the 36-month window and following month must not affect either side.
INSERT INTO fixture_sales VALUES(pg_temp.sale(13,'2022-02-28',999999)),(pg_temp.sale(14,'2025-04-01',999999));
INSERT INTO vehicle_location_observations VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','listing','https://www.bringatrailer.com/listing/synthetic-11/?x=1','2025-03-03','2025-03-03','US',0.9,'32003'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','listing','https://bringatrailer.com/listing/synthetic-12/','2025-03-04','2025-03-04','US',0.9,'06037'),
 -- A newer unrelated listing cannot move either sale's county.
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','listing','https://bringatrailer.com/listing/unrelated/','2025-05-04','2025-05-04','US',0.9,'06037');
\ir ../migrations/20261007183841_sale_residuals_by_ymm.sql
\ir ../migrations/20261007191200_qualify_sale_residual_county_country.sql
SELECT pg_temp.ok('service role only, invoker, fixed path',
 has_function_privilege('service_role','sale_residuals_by_ymm(integer,text,text,date,text)','EXECUTE')
 AND NOT has_function_privilege('anon','sale_residuals_by_ymm(integer,text,text,date,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','sale_residuals_by_ymm(integer,text,text,date,text)','EXECUTE')
 AND (SELECT NOT prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig)
 FROM pg_proc WHERE oid='sale_residuals_by_ymm(integer,text,text,date,text)'::regprocedure));
CREATE TEMP TABLE result AS SELECT sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01') j;
SELECT pg_temp.ok('prior window excludes target and future month',
 (SELECT j#>>'{baseline,n}'='10' AND j#>>'{baseline,median}'='100'
 AND j#>>'{coverage,qualified_target_sales}'='2' FROM result));
SELECT pg_temp.ok('same-vehicle resales remain separate and log ratio correct',
 (SELECT abs((j#>>'{sales,0,log_residual}')::numeric-ln(2::numeric))<0.000000001
 AND abs((j#>>'{sales,1,log_residual}')::numeric-ln(0.5::numeric))<0.000000001 FROM result));
SELECT pg_temp.ok('exact listing county, not newest vehicle county',
 (SELECT j#>>'{sales,0,county_fips}'='32003' AND j#>>'{sales,1,county_fips}'='06037'
 AND jsonb_array_length(j->'counties')=2 FROM result));
SELECT pg_temp.ok('denominators and absent metrics explicit',
 (SELECT j#>>'{coverage,county_residuals}'='2' AND j->'sell_through'='null'::jsonb
 AND j->'days_to_sale'='null'::jsonb AND j->>'knowledge_mode'='retrospective'
 AND j->'source_receipt' IS NOT NULL FROM result));
BEGIN;
UPDATE vehicle_location_observations SET country_code=NULL;
SELECT pg_temp.ok('unknown country qualifies only through the canonical US county entity',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='2'
 AND sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')->>'method'='sale_residual_month_start_v2');
UPDATE vehicle_location_observations SET country_code='CA';
SELECT pg_temp.ok('explicit non-US country contradicts a US county key and is refused',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='0'
 AND sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,residuals}'='2');
UPDATE vehicle_location_observations SET country_code='';
SELECT pg_temp.ok('unrecognized country spelling is not silently treated as unknown',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='0');
UPDATE vehicle_location_observations SET country_code=NULL,county_fips='_none';
SELECT pg_temp.ok('unknown country without a registered US county stays withheld',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='0');
ROLLBACK;
SELECT pg_temp.ok('open month refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe',date_trunc('month',now())::date)?'error');
SELECT pg_temp.ok('invalid month refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-02')?'error');
SELECT pg_temp.ok('unknown units refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01','CAD')?'error');
BEGIN;
DELETE FROM fixture_sales WHERE e->>'sourceKey'='bringatrailer.com/listing/synthetic-10';
SELECT pg_temp.ok('sparse baseline keeps sales but withholds residuals',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{status}'='insufficient_baseline'
 AND sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,residuals}'='0');
ROLLBACK;
BEGIN;
INSERT INTO fixture_sales SELECT e FROM fixture_sales LIMIT 1;
SELECT pg_temp.ok('duplicate source episodes refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')?'error');
ROLLBACK;
BEGIN;
UPDATE fixture_sales SET e=jsonb_set(e,'{currency}','"EUR"') WHERE e->>'sourceKey' LIKE '%-11';
SELECT pg_temp.ok('mixed currency owner regression refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')?'error');
ROLLBACK;
BEGIN;
UPDATE fixture_sales SET e=jsonb_set(e,'{amount}','0') WHERE e->>'sourceKey' LIKE '%-11';
SELECT pg_temp.ok('zero amount refused before logarithm',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')?'error');
ROLLBACK;
BEGIN;
UPDATE fixture_contract SET complete=false;
SELECT pg_temp.ok('incomplete owner population never becomes a sampled baseline',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')?'error');
ROLLBACK;
BEGIN;
UPDATE fixture_contract SET error='source limit';
SELECT pg_temp.ok('owner error preserved',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')->>'source_error'='source limit');
ROLLBACK;
BEGIN;
INSERT INTO vehicle_location_observations SELECT
 '20000000-0000-0000-0000-000000000004',vehicle_id,source_type,source_url,observed_at,created_at,country_code,confidence,'06037'
 FROM vehicle_location_observations WHERE id='20000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok('conflicting same-listing counties withheld, sale retained',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{sales,0,geography_status}'='same_listing_county_conflict'
 AND sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,residuals}'='2');
ROLLBACK;
BEGIN;
UPDATE vehicle_location_observations SET source_type='sighting';
SELECT pg_temp.ok('private sightings do not become listing geography',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='0');
ROLLBACK;
BEGIN;
UPDATE vehicle_location_observations SET county_fips='_none';
SELECT pg_temp.ok('unregistered county sentinel withheld',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,county_keyed_sales}'='0');
ROLLBACK;
BEGIN;
INSERT INTO vehicle_location_observations SELECT
 ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001',
 'listing','https://bringatrailer.com/listing/synthetic-11/','2025-03-03','2025-03-03','US',0.9,'32003'
 FROM generate_series(1,101) i;
SELECT pg_temp.ok('location cap withholds geography instead of choosing a sampled winner',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{sales,0,geography_status}'='location_scan_limit');
ROLLBACK;
BEGIN;
INSERT INTO fixture_sales SELECT pg_temp.sale(i,'2025-03-05',100) FROM generate_series(100,600) i;
SELECT pg_temp.ok('target overflow refused',sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')?'error');
ROLLBACK;
BEGIN;
UPDATE fixture_sales SET e=jsonb_set(e,'{knownAt}',to_jsonb((now()+interval '1 day')::text)) WHERE e->>'sourceKey' LIKE '%-11';
SELECT pg_temp.ok('future knowledge remains outside owner population',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')#>>'{coverage,qualified_target_sales}'='1');
ROLLBACK;
BEGIN;
SELECT pg_temp.ok('same statement replay is deterministic',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01')=sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-03-01'));
ROLLBACK;
\ir ../migrations/20261007191200_qualify_sale_residual_county_country.sql
SELECT pg_temp.ok('reapply preserves access',NOT has_function_privilege('anon','sale_residuals_by_ymm(integer,text,text,date,text)','EXECUTE'));
