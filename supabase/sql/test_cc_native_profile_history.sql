-- Real existing profile owner and anonymous caller. No production data.
\set ON_ERROR_STOP on
\i supabase/sql/test_registered_profile_source_claims.sql
RESET ROLE;
-- The imported image fixture predates the deployed personal-name privacy guard.
\i supabase/migrations/20261004175418_observation_private_fields_guard.sql
ALTER TABLE public.vehicles ADD COLUMN status text,ADD COLUMN merged_into_vehicle_id uuid;
ALTER TABLE public.observation_sources ADD COLUMN species text,ADD COLUMN requires_auth boolean;
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS superseded_by uuid;
CREATE TABLE public.listing_page_snapshots(id uuid PRIMARY KEY,platform text,listing_url text,
 success boolean,http_status integer,html_sha256 text,metadata jsonb,fetched_at timestamptz,created_at timestamptz);
INSERT INTO public.observation_sources(id,slug,species,requires_auth,supported_observations) VALUES
 ('892f9062-8d05-4281-8119-9a197135d593','collecting-cars','timed_auction',false,ARRAY['listing']::public.observation_kind[]);
CREATE TEMP TABLE before_history AS SELECT pg_temp.profile() AS value,
 (SELECT proacl FROM pg_proc WHERE oid='public.get_vehicle_specs(uuid[],boolean,jsonb)'::regprocedure) acl;
SET statement_timeout='3s'; SET lock_timeout='1s';
\i supabase/migrations/20261110050835_cc_native_profile_history.sql
\i supabase/migrations/20261110050835_cc_native_profile_history.sql
SELECT pg_temp.ok('migration preserves caller budgets',current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s');
SELECT pg_temp.ok('existing profile outputs and ACL unchanged',
 (SELECT pg_temp.profile()-'native_listing_history'-'read_at'=value-'read_at' AND acl=(SELECT proacl FROM pg_proc
 WHERE oid='public.get_vehicle_specs(uuid[],boolean,jsonb)'::regprocedure) FROM before_history));
SELECT pg_temp.ok('existing read_at remains the actual current statement clock',
 (SELECT (pg_temp.profile()->>'read_at')::timestamptz=statement_timestamp()
 AND (pg_temp.profile()->>'read_at')::timestamptz>=(value->>'read_at')::timestamptz FROM before_history));
INSERT INTO public.listing_page_snapshots VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','collectingcars',
 'https://collectingcars.com/for-sale/fixture-car',true,200,repeat('a',64),'{}','2026-01-01T00:00Z','2026-01-01T00:00:01Z');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,source_url,observed_at,ingested_at,extraction_method,
 raw_source_ref,extraction_metadata,structured_data) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','892f9062-8d05-4281-8119-9a197135d593',
 'listing','https://collectingcars.com/for-sale/fixture-car','2026-01-01T00:00Z','2026-01-01T00:00:02Z','cc_native_listing_v1',
 'listing_page_snapshots:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 jsonb_build_object('source_capture',jsonb_build_object('snapshot_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256',repeat('a',64),
 'source_url','https://collectingcars.com/for-sale/fixture-car','source_read_at','2026-01-01T00:00Z')),
 '{"source_claims_only":true,"capture_kind":"listing_page","lot_type":"car","listing_id":"1","url":"https://collectingcars.com/for-sale/fixture-car","listing_url":"https://collectingcars.com/for-sale/fixture-car","stage":"sold","sale_outcome":"sold","price_kind":"sold","price_amount":67500,"currency":"GBP","sold_at":"2019-06-06T15:02:00Z","mileage":283785,"mileage_unit":"mi","mileage_raw":"283,785 miles","bid_count":38,"seller_name":"Private Seller","description":"Private prose","image_urls":["https://private.invalid/image"]}');
CREATE FUNCTION pg_temp.history() RETURNS jsonb LANGUAGE sql AS $$SELECT pg_temp.profile()->'native_listing_history'$$;
GRANT SELECT ON public.vehicle_observations TO anon;
-- The imported observation RLS evaluates these vehicle columns as the caller.
-- Its prior tests only call SECURITY DEFINER readers, so supply this fixture dependency.
GRANT SELECT(id,user_id,owner_id,uploaded_by,is_public) ON public.vehicles TO anon;
-- Raw listing remains unavailable to anon under the original fixture's RLS.
SET ROLE anon;
SELECT pg_temp.ok('raw seller testimony remains private',NOT EXISTS(SELECT FROM public.vehicle_observations WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
SELECT pg_temp.ok('actual anonymous sanitized history reports original amount/currency/event/capture clocks',
 pg_temp.history()#>>'{entries,0,reported_amount}'='67500' AND pg_temp.history()#>>'{entries,0,currency}'='GBP'
 AND (pg_temp.history()#>>'{entries,0,reported_event_at}')::timestamptz='2019-06-06T15:02Z'
 AND (pg_temp.history()#>>'{entries,0,source_captured_at}')::timestamptz='2026-01-01T00:00Z'
 AND pg_temp.history()#>>'{entries,0,qualification}'='publisher_reported_unverified'
 AND pg_temp.history()#>>'{entries,0,mileage_unit}'='mi'
 AND pg_temp.history()::text !~ '(Private|private.invalid|seller_name|description|image_urls|sha256)');
RESET ROLE;
CREATE TEMP TABLE original_cc AS SELECT * FROM public.vehicle_observations WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
BEGIN;
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"mileage":98,"mileage_unit":"km","mileage_raw":"157 Km (Indicated)"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('native157km survives normalized98miles scalar without a mixed-unit claim',
 pg_temp.history()#>>'{entries,0,mileage}'='157' AND pg_temp.history()#>>'{entries,0,mileage_unit}'='km');
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"mileage":34271,"mileage_raw":"55,154 Km (Indicated)"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('native55154km survives normalized34271miles scalar',
 pg_temp.history()#>>'{entries,0,mileage}'='55154' AND pg_temp.history()#>>'{entries,0,mileage_unit}'='km');
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"mileage_raw":"157 Km (Private Seller)"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('arbitrary mileage suffix is not published',
 pg_temp.history()#>'{entries,0,mileage}'='null'::jsonb AND pg_temp.history()#>'{entries,0,mileage_unit}'='null'::jsonb);
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"mileage_raw":"1,57 km"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('malformed native odometer is unknown, never inferred from converted scalar',
 pg_temp.history()#>'{entries,0,mileage}'='null'::jsonb AND pg_temp.history()#>'{entries,0,mileage_unit}'='null'::jsonb);
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"mileage_raw":"157 miles"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('conflicting source odometer unit refuses the number-unit pair',pg_temp.history()#>'{entries,0,mileage}'='null'::jsonb);
ROLLBACK;
DO $$ DECLARE patch jsonb; BEGIN
 FOREACH patch IN ARRAY ARRAY[
  '{"stage":"live","sale_outcome":"live"}'::jsonb,'{"stage":"withdrawn"}',
  '{"lot_type":"plate"}','{"url":"https://collectingcars.com/for-sale/other"}',
  '{"listing_url":"https://collectingcars.com/for-sale/other"}','{"source_claims_only":false}',
  '{"listing_id":"bad"}','{"sale_outcome":"unsold"}'] LOOP
  UPDATE public.vehicle_observations SET structured_data=(SELECT structured_data FROM original_cc)||patch WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  PERFORM pg_temp.ok('invalid source state refused '||patch::text,jsonb_array_length(pg_temp.history()->'entries')=0);
 END LOOP;
 UPDATE public.vehicle_observations SET structured_data=(SELECT structured_data FROM original_cc) WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
END $$;
BEGIN;
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"currency":"PERSON"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('unknown currency remains null without dropping its attributed amount',
 pg_temp.history()#>'{entries,0,currency}'='null'::jsonb AND pg_temp.history()#>>'{entries,0,reported_amount}'='67500');
ROLLBACK;
BEGIN;
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"price_amount":null,"price_kind":null}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('undisclosed price remains sold with a null amount',pg_temp.history()#>>'{entries,0,reported_outcome}'='sold'
 AND pg_temp.history()#>'{entries,0,reported_amount}'='null'::jsonb);
ROLLBACK;
BEGIN;
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"stage":"unsold","sale_outcome":"sealed_unsold","price_kind":"high_bid","auction_end_at":"2019-06-06T14:02Z"}' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.ok('unsold high bid never becomes a sale amount',pg_temp.history()#>>'{entries,0,reported_outcome}'='unsold'
 AND pg_temp.history()#>>'{entries,0,reported_amount}'='67500' AND pg_temp.history()#>>'{entries,0,reported_amount_kind}'='high_bid');
ROLLBACK;
DO $$ DECLARE clause text; BEGIN
 FOREACH clause IN ARRAY ARRAY['is_superseded=true','superseded_by=''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''','submitted_by_user_id=''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
  'source_id=''33333333-3333-3333-3333-333333333333''','subject_type=''user''','raw_source_ref=''wrong''',
  'observed_at=''2025-01-01T00:00Z''','extraction_metadata=''{}''::jsonb'] LOOP
  BEGIN
   EXECUTE 'UPDATE public.vehicle_observations SET '||clause||' WHERE id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''';
   PERFORM pg_temp.ok('identity and custody refuse '||clause,jsonb_array_length(pg_temp.history()->'entries')=0);
   RAISE EXCEPTION 'fixture rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 END LOOP;
 FOREACH clause IN ARRAY ARRAY['is_public=false','deleted_at=now()','status=''merged''',
  'merged_into_vehicle_id=''22222222-2222-2222-2222-222222222222''','listing_kind=''non_vehicle_item'''] LOOP
  BEGIN
   EXECUTE 'UPDATE public.vehicles SET '||clause||' WHERE id=''11111111-1111-1111-1111-111111111111''';
   PERFORM pg_temp.ok('private/deleted/merged/nonvehicle guard '||clause,coalesce(jsonb_array_length(pg_temp.history()->'entries'),0)=0);
   RAISE EXCEPTION 'fixture rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 END LOOP;
 FOREACH clause IN ARRAY ARRAY['success=false','http_status=403','platform=''collecting-cars''','html_sha256=repeat(''b'',64)',
  'metadata='' {"withdrawn":true}''::jsonb','metadata='' {"rows_only":true}''::jsonb','listing_url=''https://collectingcars.com/for-sale/other'''] LOOP
  BEGIN
   EXECUTE 'UPDATE public.listing_page_snapshots SET '||clause;
   PERFORM pg_temp.ok('snapshot refuses '||clause,jsonb_array_length(pg_temp.history()->'entries')=0);
   RAISE EXCEPTION 'fixture rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 END LOOP;
END $$;
BEGIN;
INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,source_url,observed_at,ingested_at,extraction_method,structured_data)
 SELECT vehicle_id,source_id,kind,source_url,observed_at+interval '1 day',ingested_at+interval '1 day',extraction_method,
 structured_data||'{"stage":"live"}' FROM original_cc;
SELECT pg_temp.ok('newer live capture hides prior sold claim before custody/terminal selection',jsonb_array_length(pg_temp.history()->'entries')=0);
UPDATE public.vehicle_observations SET is_superseded=true WHERE observed_at='2026-01-02T00:00Z';
SELECT pg_temp.ok('withdrawn newest capture cannot resurrect old sold claim',jsonb_array_length(pg_temp.history()->'entries')=0);
ROLLBACK;
BEGIN;
INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,source_url,observed_at,ingested_at,extraction_method,structured_data)
 SELECT vehicle_id,source_id,kind,source_url||'-'||n,observed_at+interval '1 day',ingested_at+interval '1 day',extraction_method,
 structured_data||'{"stage":"live"}' FROM original_cc CROSS JOIN generate_series(1,51)n;
SELECT pg_temp.ok('bounded capture window declares truncation, never population completeness',
 pg_temp.history()->>'has_more_captures'='true' AND pg_temp.history()->>'capture_limit'='50'
 AND jsonb_array_length(pg_temp.history()->'entries')=0);
ROLLBACK;
