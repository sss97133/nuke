-- ActualPG17 existing-owner overload contract. Synthetic IDs only. Never run in production.
\set ON_ERROR_STOP on
SET timezone='UTC';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE canonical_makes(id uuid PRIMARY KEY,canonical_name text,aliases text[]);
CREATE TABLE canonical_models(id uuid PRIMARY KEY,make text,canonical_model text,aliases text[],year_start int,year_end int);
CREATE TABLE make_model_profiles(subject_id uuid PRIMARY KEY,canonical_make text,canonical_model text,grain text,
 year int,year_start int,year_end int,canonical_model_id uuid REFERENCES canonical_models(id),
 comparison_scope_status text,comparison_scope_basis text);
CREATE TABLE source_registry(id uuid PRIMARY KEY,slug text UNIQUE,display_name text,extractor_function text);
CREATE TABLE vehicles(id uuid PRIMARY KEY,make text DEFAULT 'SYNTHETIC',model text DEFAULT 'MODEL',
 year int DEFAULT 1977,canonical_make_id uuid REFERENCES canonical_makes(id),
 is_public boolean DEFAULT true,deleted_at timestamptz,listing_kind text DEFAULT 'vehicle',
 sale_status text DEFAULT 'sold',origin_metadata jsonb DEFAULT '{}');
CREATE TABLE auction_events(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),source text DEFAULT 'bat',
 source_url text,auction_end_date timestamptz,outcome text DEFAULT 'sold',winning_bid numeric DEFAULT 1000,
 created_at timestamptz DEFAULT(now()-interval '3 days'),updated_at timestamptz DEFAULT(now()-interval '5 minutes'),
 scraped_at timestamptz DEFAULT(now()-interval '1 hour'),raw_data jsonb DEFAULT '{}');
CREATE INDEX idx_auction_events_end_date ON auction_events(auction_end_date);
CREATE INDEX idx_auction_events_vehicle ON auction_events(vehicle_id);
CREATE INDEX fixture_make_year ON vehicles(lower(make),year);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON vehicles FOR SELECT TO anon,authenticated USING(is_public);
CREATE POLICY private_owner_read ON vehicles FOR SELECT TO authenticated
 USING(id='00000000-0000-0000-0000-000000000002');
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_events_public ON auction_events FOR SELECT TO anon,authenticated USING(true);
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;

INSERT INTO canonical_makes VALUES
 ('10000000-0000-0000-0000-000000000001','SYNTHETIC',ARRAY['synthetic','syn']),
 ('10000000-0000-0000-0000-000000000002','BENCHMARK',ARRAY['benchmark','DUPLICATE']),
 ('10000000-0000-0000-0000-000000000003','THIRD',ARRAY['third','DUPLICATE']);
INSERT INTO canonical_models VALUES
 ('20000000-0000-0000-0000-000000000001','SYNTHETIC','MODEL',ARRAY['model alias'],1970,1990),
 ('20000000-0000-0000-0000-000000000002','SYNTHETIC','OTHER',ARRAY['other'],1970,1990);
INSERT INTO make_model_profiles VALUES
 ('30000000-0000-0000-0000-000000000001','SYNTHETIC','MODEL','generation',NULL,1976,1980,
  '20000000-0000-0000-0000-000000000001','supported','Synthetic attributed comparison; factory/condition unproved'),
 ('30000000-0000-0000-0000-000000000002','SYNTHETIC','MODEL','generation',NULL,1970,1990,
  '20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('30000000-0000-0000-0000-000000000003','SYNTHETIC','MODEL','generation',NULL,1977,1979,
  '20000000-0000-0000-0000-000000000001','supported','Synthetic explicitly selected overlapping subject');
INSERT INTO source_registry VALUES('40000000-0000-0000-0000-000000000001','bringatrailer','Synthetic source label','bat-simple-extract');
-- Apply the actual existing cohort_members resolver, not a parallel membership fixture.
\ir ../migrations/20260928183000_market_readers_skip_non_vehicle_lots.sql
-- A sentinel proves that overload creation leaves the existing named five-argument/API route alone.
CREATE FUNCTION public.get_market_trends(p_make text,p_model text DEFAULT NULL,p_year_from int DEFAULT NULL,
 p_year_to int DEFAULT NULL,p_period text DEFAULT '90d') RETURNS TABLE(period_start date,period_end date,
 sale_count bigint,avg_price numeric,median_price numeric,p25_price numeric,p75_price numeric,min_price numeric,
 max_price numeric,avg_mileage numeric) LANGUAGE sql AS $$
 SELECT CURRENT_DATE-1,CURRENT_DATE,17::bigint,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric
$$;
CREATE TEMP TABLE legacy_contract AS SELECT pg_get_functiondef(oid) AS definition,proacl
 FROM pg_proc WHERE oid='public.get_market_trends(text,text,integer,integer,text)'::regprocedure;
CREATE TEMP TABLE membership_contract AS SELECT pg_get_functiondef(oid) AS definition,proacl
 FROM pg_proc WHERE oid='public.cohort_members(uuid)'::regprocedure;

INSERT INTO vehicles(id,canonical_make_id)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001'
 FROM generate_series(1,30) i;
UPDATE vehicles SET is_public=false WHERE id::text LIKE '%000002';
UPDATE vehicles SET deleted_at=now() WHERE id::text LIKE '%000003';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE id::text LIKE '%000004';
UPDATE vehicles SET is_public=NULL WHERE id::text LIKE '%000005';
UPDATE vehicles SET make='BENCHMARK',canonical_make_id='10000000-0000-0000-0000-000000000002' WHERE id::text LIKE '%000006';
UPDATE vehicles SET make='UNKNOWN',canonical_make_id=NULL WHERE id::text LIKE '%000007';
UPDATE vehicles SET make='DUPLICATE',canonical_make_id=NULL WHERE id::text LIKE '%000008';
UPDATE vehicles SET make='BENCHMARK' WHERE id::text LIKE '%000009';
UPDATE vehicles SET make=NULL,canonical_make_id=NULL WHERE id::text LIKE '%000010';
UPDATE vehicles SET model=NULL WHERE id::text LIKE '%000011';
UPDATE vehicles SET year=NULL WHERE id::text LIKE '%000012';
UPDATE vehicles SET year=1981 WHERE id::text LIKE '%000013';
UPDATE vehicles SET model='OTHER' WHERE id::text LIKE '%000014';
-- The entity is now active again; its historical source episode remains a sale.
UPDATE vehicles SET sale_status='auction_live',origin_metadata='{"currency":"EUR"}' WHERE id::text LIKE '%000001';

INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,winning_bid)
 SELECT ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/fixture-'||i,date_trunc('day',now())-interval '1 day'+i*interval '1 minute',i*100
 FROM generate_series(1,30) i;
UPDATE auction_events SET outcome='reserve_not_met' WHERE id::text LIKE '%000015';
UPDATE auction_events SET outcome='bid_to' WHERE id::text LIKE '%000016';
UPDATE auction_events SET outcome='pending' WHERE id::text LIKE '%000017';
UPDATE auction_events SET outcome='live' WHERE id::text LIKE '%000018';
UPDATE auction_events SET winning_bid=NULL WHERE id::text LIKE '%000019';
UPDATE auction_events SET winning_bid=0 WHERE id::text LIKE '%000020';
UPDATE auction_events SET winning_bid=-1 WHERE id::text LIKE '%000021';
UPDATE auction_events SET winning_bid='Infinity' WHERE id::text LIKE '%000022';
UPDATE auction_events SET winning_bid='NaN' WHERE id::text LIKE '%000023';
UPDATE auction_events SET auction_end_date=now()+interval '1 day' WHERE id::text LIKE '%000024';
UPDATE auction_events SET created_at=now()+interval '1 day' WHERE id::text LIKE '%000025';
UPDATE auction_events SET updated_at=now()+interval '1 day' WHERE id::text LIKE '%000026';
UPDATE auction_events SET source='other' WHERE id::text LIKE '%000027';
UPDATE auction_events SET source_url=NULL WHERE id::text LIKE '%000028';
UPDATE auction_events SET source_url='https://example.test/listing/unqualified' WHERE id::text LIKE '%000029';
UPDATE auction_events SET created_at=NULL WHERE id::text LIKE '%000030';
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,winning_bid)
 VALUES('50000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001',
 'https://bringatrailer.com/listing/previous-episode',date_trunc('day',now())-interval '2 days'+interval '1 hour',1500);
INSERT INTO auction_events SELECT '50000000-0000-0000-0000-000000000101',vehicle_id,source,source_url||'/',
 auction_end_date,outcome,winning_bid,created_at,updated_at,scraped_at,raw_data FROM auction_events WHERE id::text LIKE '%000001';
UPDATE auction_events SET scraped_at=now()-interval '2 minutes',raw_data=jsonb_build_object(
 'extractor','extract-bat-core','listing_url',source_url,'source_read',jsonb_build_object('clock_version',1,
 'basis','direct_fetch','at',to_char((now()-interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE id::text LIKE '%000001';
UPDATE auction_events SET scraped_at=now()-interval '1 day',raw_data=jsonb_build_object(
 'extractor','extract-bat-core','listing_url',source_url,'source_read',jsonb_build_object('clock_version',1,
 'basis','cached_snapshot','at',to_char((now()-interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE id::text LIKE '%000100';

\ir ../migrations/20261004073500_market_trends_recorded_sale_counts.sql
CREATE FUNCTION assert_count(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
 RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION count_request(scope_kind text DEFAULT 'canonical_make',scope_uuid uuid DEFAULT '10000000-0000-0000-0000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('metric','recorded_sale_events','source_registry_slug','bringatrailer',
 'benchmark','same_platform_excluding_scope','scope',jsonb_build_object('kind',scope_kind,
 CASE WHEN scope_kind='canonical_make' THEN 'canonical_make_id' ELSE 'subject_id' END,scope_uuid),
 'event_from',date_trunc('day',now())-interval '2 days','event_to',date_trunc('day',now()))
$$;
CREATE FUNCTION sum_count(receipt jsonb,which_series text,field_name text DEFAULT 'value') RETURNS numeric LANGUAGE sql AS $$
 SELECT sum((s->>field_name)::numeric) FROM jsonb_array_elements(receipt->'series') s WHERE s->>'series'=which_series
$$;
CREATE FUNCTION rejects_count(request jsonb,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  PERFORM public.get_market_trends(request);
  RAISE EXCEPTION 'FAILED to reject: %',label;
 EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'PASS: rejected %',label;
 END $$;
SELECT assert_count((SELECT old.definition=pg_get_functiondef(p.oid) AND old.proacl IS NOT DISTINCT FROM p.proacl
 FROM legacy_contract old CROSS JOIN pg_proc p WHERE p.oid='get_market_trends(text,text,integer,integer,text)'::regprocedure),
 'five-argument legacy definition and ACL unaffected');
SELECT assert_count((SELECT NOT prosecdef AND proconfig @> ARRAY['statement_timeout=5s','search_path=public, pg_temp']
 FROM pg_proc WHERE oid='public.get_market_trends(jsonb)'::regprocedure),'read-only invoker with pinned path and5s');
SELECT assert_count(NOT has_function_privilege('public','public.get_market_trends(jsonb)','EXECUTE'),
 'PUBLIC execute revoked on new overload');
SELECT assert_count((SELECT old.definition=pg_get_functiondef(p.oid) AND old.proacl IS NOT DISTINCT FROM p.proacl
 FROM membership_contract old CROSS JOIN pg_proc p WHERE p.oid='public.cohort_members(uuid)'::regprocedure),
 'original membership owner definition and ACL unaffected');
SELECT assert_count((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
 FROM pg_proc WHERE oid='public.cohort_members(uuid,uuid[])'::regprocedure)
 AND NOT has_function_privilege('public','public.cohort_members(uuid,uuid[])','EXECUTE'),
 'bounded membership is an invoker extension with pinned path and no broader PUBLIC grant');
CREATE FUNCTION rejects_members(ids uuid[],label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  PERFORM public.cohort_members('30000000-0000-0000-0000-000000000001',ids);
  RAISE EXCEPTION 'FAILED to reject membership: %',label;
 EXCEPTION WHEN SQLSTATE '22023' THEN RAISE NOTICE 'PASS: rejected membership %',label;
 END $$;
SELECT rejects_members(NULL,'NULL candidates');
SELECT rejects_members(array_fill('00000000-0000-0000-0000-000000000001'::uuid,ARRAY[2001]),'raw candidate cap2001');
SELECT assert_count((SELECT count(*)=0 FROM cohort_members('30000000-0000-0000-0000-000000000001',ARRAY[]::uuid[])),
 'empty membership candidates return no rows');
SELECT assert_count((SELECT count(*)=0 FROM cohort_members('30000000-0000-0000-0000-000000000999',
 ARRAY['00000000-0000-0000-0000-000000000001'::uuid])), 'unknown membership subject does not broaden');
SELECT assert_count((SELECT count(*)=1 FROM cohort_members('30000000-0000-0000-0000-000000000001',
 array_fill('00000000-0000-0000-0000-000000000001'::uuid,ARRAY[2000]))),
 'exact2000raw candidate cap accepted and duplicate IDs cannot inflate');
CREATE FUNCTION members_equivalent() RETURNS boolean LANGUAGE sql AS $$
 WITH ids AS (SELECT array_agg(id) AS values FROM vehicles),old AS (
  SELECT vehicle_id FROM cohort_members('30000000-0000-0000-0000-000000000001')
  WHERE vehicle_id=ANY((SELECT values FROM ids)::uuid[])
 ),bounded AS (SELECT vehicle_id FROM cohort_members('30000000-0000-0000-0000-000000000001',
  (SELECT values FROM ids)))
 SELECT NOT EXISTS((SELECT * FROM old EXCEPT SELECT * FROM bounded)
  UNION ALL(SELECT * FROM bounded EXCEPT SELECT * FROM old))
$$;
SET ROLE anon;
SELECT assert_count(members_equivalent(),'anonymous bounded resolver equals actual original intersected with admitted IDs');
SELECT assert_count((SELECT count(*)=0 FROM cohort_members('30000000-0000-0000-0000-000000000001',
 ARRAY['00000000-0000-0000-0000-000000000002'::uuid])), 'anonymous membership cannot read denied private parent');
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6,'six actual source sale episodes including repeated vehicle sale');
SELECT assert_count(sum_count(get_market_trends(count_request()),'benchmark')=1,'same-platform benchmark excludes selected make');
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected','denominator')=15,'explicit recorded episode denominator includes missing outcomes/amounts');
SELECT assert_count((get_market_trends(count_request())#>>'{coverage,unresolved_scope}')::int=4,'unknown/ambiguous/conflicting make identity not benchmark');
SELECT assert_count((get_market_trends(count_request())->>'captured_candidates')::int=21,'only public valid known-time candidates admitted before cap');
SELECT assert_count((get_market_trends(count_request())#>>'{source_registry,writer_registry_match}')::boolean=false,
 'stale declared extractor mapping is disclosed instead of invented');
SELECT assert_count((get_market_trends(count_request())->>'state')='partial' AND
 NOT(get_market_trends(count_request())#>>'{coverage,complete_external_capture}')::boolean,
 'captured counts do not claim external market completion');
SELECT assert_count((SELECT bool_and(s->>'ratio' IS NULL AND s->>'absolute_change' IS NULL AND s->>'relative_change' IS NULL)
 FROM jsonb_array_elements(get_market_trends(count_request())->'series') s),'no unsupported rate/value/performance ratios');
SELECT assert_count((SELECT sum((s#>>'{coverage,ended_pending}')::int)=2 AND sum((s#>>'{coverage,bid_to}')::int)=1
 AND sum((s#>>'{coverage,sold_without_supported_amount}')::int)=5
 FROM jsonb_array_elements(get_market_trends(count_request())->'series') s WHERE s->>'series'='selected'),
 'ended live/pending and misleading positive/missing sale amounts remain coverage');
SELECT assert_count((SELECT count(*)=2 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='00000000-0000-0000-0000-000000000001'),'relisting does not erase historical source episodes');
SELECT assert_count((SELECT jsonb_array_length(e->'source_event_ids')=2 FROM
 jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_url'='https://bringatrailer.com/listing/fixture-1/'),'URL aliases dedup but retain actual event IDs');
SELECT assert_count((SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_read_basis'='direct_fetch'),'trusted exact direct source read is retained');
SELECT assert_count((SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_read_basis'='cached_snapshot'),'original cached read clock retained');
SELECT assert_count((SELECT count(*)=5 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_read_basis'='unknown'),'legacy source write/scrape clocks remain unknown');
SELECT assert_count(sum_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000001')),
 'selected')=2,'supported subject uses actual cohort resolver without claiming factory generation');
SELECT assert_count(sum_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000001')),
 'benchmark')=3,'subject benchmark includes exact known outside range/model and excludes unknown membership');
SELECT assert_count((get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000001'))
 #>>'{coverage,unresolved_scope}')::int=6,'missing year/model stays unresolved for supported subject');
SELECT assert_count(sum_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000003')),
 'selected')=2,'explicit overlapping subject ID is honored without arbitrary narrowest scope selection');
SELECT assert_count(get_market_trends(count_request('supported_subject','30000000-0000-0000-0000-000000000002'))->>'state'='unavailable',
 'context-only subject cannot become supported cohort');
SELECT assert_count(get_market_trends(count_request('canonical_make','10000000-0000-0000-0000-000000000999'))->>'state'='unavailable',
 'unknown canonical make does not broaden scope');
SELECT assert_count(get_market_trends(count_request()||'{"knowledge_as_of":"2020-01-01T00:00:00Z"}')->>'reason'='historical_knowledge_versions_unavailable',
 'mutable rows never reconstruct a historical knowledge cutoff');
SELECT assert_count(get_market_trends(count_request()||'{"metric":"valuation"}')->>'state'='unavailable','no unsupported valuation metric');
SELECT assert_count((SELECT count(*)=1 FROM get_market_trends(p_make=>'SYNTHETIC') WHERE sale_count=17),
 'legacy named RPC remains callable');
SELECT assert_count((SELECT jsonb_array_length(get_market_trends(count_request()||'{"evidence_limit":1}')#>'{evidence,contributors}')=3
 AND (get_market_trends(count_request()||'{"evidence_limit":1}')#>>'{evidence,has_more}')::boolean),
 'evidence cap applies per bucket/series and truncation is explicit');
SELECT assert_count((get_market_trends(count_request()||jsonb_build_object('evidence_bucket',(CURRENT_DATE-2)::text,
 'evidence_series','selected'))#>'{evidence,contributors}') @> '[{"auction_event_id":"50000000-0000-0000-0000-000000000100"}]',
 'existing overload supports an exact bucket/series contributor drill');
SELECT assert_count((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e ? 'price' OR e ? 'observation_id' OR e ? 'currency')),'no money or fabricated observation identity is exposed');
SELECT rejects_count(count_request()-'event_from'-'event_to','missing window');
SELECT rejects_count(count_request()||'{"extra":true}','unknown request field');
SELECT rejects_count(count_request()||'{"event_to":"infinity"}','unbounded time');
SELECT rejects_count(count_request()||jsonb_build_object('event_from',date_trunc('day',now())-interval '8 days'),'window beyond seven days');
SELECT rejects_count(count_request()||jsonb_build_object('event_to',now()+interval '1 day'),'future event window');
SELECT rejects_count(count_request()||'{"scope":{"kind":"canonical_make","canonical_make_id":"bad"}}','malformed scope UUID');
SELECT rejects_count(count_request()||'{"scope":{"kind":"canonical_make","canonical_make_id":"10000000-0000-0000-0000-000000000001","subject_id":"30000000-0000-0000-0000-000000000001"}}','conflicting scope selectors');
SET ROLE authenticated;
SELECT assert_count(members_equivalent(),'authenticated bounded resolver preserves exact old-registry membership and owner RLS');
SELECT assert_count((SELECT count(*)=1 FROM cohort_members('30000000-0000-0000-0000-000000000001',
 ARRAY['00000000-0000-0000-0000-000000000002'::uuid])),
 'bounded helper retains legitimate authenticated owner access; aggregate parent gates exclude it');
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6,'private owner access cannot alter public totals');
SET ROLE service_role;
SELECT assert_count(members_equivalent(),'service bounded resolver equals original membership under bypass while aggregate gates remain public');
SELECT assert_count(sum_count(get_market_trends(count_request()),'selected')=6,'service bypass cannot alter public totals');
RESET ROLE;
-- Source aliases are one episode; conflicting aliases are unassigned and never become a chosen sale.
BEGIN;
INSERT INTO make_model_profiles VALUES
 ('30000000-0000-0000-0000-000000000004','SYNTHETIC','MODEL','year',1977,NULL,NULL,
  '20000000-0000-0000-0000-000000000001','supported','Synthetic year receipt');
UPDATE canonical_models SET aliases=aliases||ARRAY['m+odel'] WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE vehicles SET model='m+odel' WHERE id::text LIKE '%000030';
SET ROLE anon;
SELECT assert_count((WITH ids AS (SELECT array_agg(id) AS values FROM vehicles),old AS (
 SELECT vehicle_id FROM cohort_members('30000000-0000-0000-0000-000000000004')
 WHERE vehicle_id=ANY((SELECT values FROM ids)::uuid[])),bounded AS (
 SELECT vehicle_id FROM cohort_members('30000000-0000-0000-0000-000000000004',(SELECT values FROM ids)))
 SELECT NOT EXISTS((SELECT * FROM old EXCEPT SELECT * FROM bounded)
 UNION ALL(SELECT * FROM bounded EXCEPT SELECT * FROM old))),
 'year-grain bounded resolver equals original intersect with escaped aliases and missing years');
SELECT assert_count((SELECT count(*)=1 FROM cohort_members('30000000-0000-0000-0000-000000000004',
 ARRAY['00000000-0000-0000-0000-000000000030'::uuid])), 'punctuated registry alias is escaped exactly as original');
RESET ROLE;
ROLLBACK;
BEGIN;
INSERT INTO auction_events SELECT '50000000-0000-0000-0000-000000000102',vehicle_id,source,source_url||'/',
 auction_end_date,outcome,999,created_at,updated_at,scraped_at,raw_data FROM auction_events WHERE id::text LIKE '%000006';
SET ROLE anon;
SELECT assert_count((get_market_trends(count_request())#>>'{coverage,conflicting_alias_episodes}')::int=1
 AND sum_count(get_market_trends(count_request()),'benchmark')=0
 AND (get_market_trends(count_request())#>>'{coverage,unresolved_scope}')::int=5,
 'conflicting source amounts remain unresolved, not an arbitrary benchmark sale');
SELECT assert_count((SELECT bool_and((s#>>'{coverage,conflicting_aliases}')::int=1)
 FROM jsonb_array_elements(get_market_trends(count_request())->'series') s
 WHERE (s->>'bucket_start')::timestamptz=date_trunc('day',now())-interval '1 day'),
 'unassigned alias conflict remains visible in shared bucket coverage for both series');
RESET ROLE;
ROLLBACK;

BEGIN;
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,at}','"wrong"') WHERE id::text LIKE '%000001';
SET ROLE anon;
SELECT assert_count((SELECT count(*)=0 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_read_basis'='direct_fetch'),'mismatched marker clock cannot become observed source time');
RESET ROLE;
ROLLBACK;
BEGIN;
UPDATE auction_events SET scraped_at=now()+interval '1 day',raw_data=jsonb_set(raw_data,'{source_read,at}',
 to_jsonb(to_char((now()+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE id::text LIKE '%000001';
SET ROLE anon;
SELECT assert_count((SELECT count(*)=0 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'source_read_basis'='direct_fetch'),'future source clock stays unknown');
RESET ROLE;
ROLLBACK;
SET ROLE anon;
SELECT assert_count((SELECT bool_and((s#>>'{coverage,incomplete_bucket}')::boolean)
 FROM jsonb_array_elements(get_market_trends(count_request()||jsonb_build_object(
 'event_from',date_trunc('day',now()),'event_to',now()-interval '1 minute'))->'series') s),
 'current partial UTC day carries elapsed fraction instead of pretending a full period');
SELECT assert_count(sum_count(get_market_trends(count_request()||jsonb_build_object(
 'event_from',date_trunc('day',now())-interval '7 days','event_to',date_trunc('day',now())-interval '6 days')),'selected')=0
 AND get_market_trends(count_request())->>'state'='partial','empty captured window zero is explicitly incomplete market coverage');
SELECT rejects_count('[]','non-object input');
SELECT rejects_count(count_request()||jsonb_build_object('extra',repeat('x',5000)),'oversized input');
RESET ROLE;

-- A very large private input population cannot consume the public candidate cap or enter evidence.
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date)
 SELECT ('60000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000002',
 'https://bringatrailer.com/listing/private-fixture-'||i,date_trunc('day',now())-interval '1 day'+interval '3 hours'
 FROM generate_series(1,2005) i;
SET ROLE anon;
SELECT assert_count((get_market_trends(count_request())->>'captured_candidates')::int=21
 AND NOT(get_market_trends(count_request())->>'truncated')::boolean,
 'private source events excluded before public cap and denominator');
SELECT assert_count((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_market_trends(count_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id' IN('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'))),
 'private deleted and nonvehicle IDs never appear in bounded contributor drill');
SELECT assert_count(NOT has_table_privilege('anon','public.auction_events','INSERT')
 AND NOT has_table_privilege('anon','public.auction_events','UPDATE'),'public reader cannot mutate clock/outcome custody');
SET ROLE authenticated;
SELECT assert_count((get_market_trends(count_request())->>'captured_candidates')::int=21,'private owner access cannot consume cap');
SET ROLE service_role;
SELECT assert_count((get_market_trends(count_request())->>'captured_candidates')::int=21,'service bypass cannot consume cap with private events');
RESET ROLE;

INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT ('70000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001',
 'https://bringatrailer.com/listing/public-fixture-'||i,date_trunc('day',now())-interval '1 day'+interval '4 hours','live'
 FROM generate_series(1,2001) i;
SET ROLE anon;
SELECT assert_count((get_market_trends(count_request())->>'captured_candidates')::int=2001
 AND(get_market_trends(count_request())->>'truncated')::boolean,'public candidate cap is exactly2000plus sentinel');
SELECT assert_count((SELECT bool_and(s->>'value' IS NULL AND s->>'numerator' IS NULL AND s->>'denominator' IS NULL AND s->>'ratio' IS NULL)
 FROM jsonb_array_elements(get_market_trends(count_request())->'series') s),'truncation refuses all series totals and ratios');
SELECT assert_count(get_market_trends(count_request())->>'reason'='candidate_cap_exceeded','truncated sample reason is explicit');
RESET ROLE;
