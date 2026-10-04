-- Synthetic PG17 contract for the actual parameterized SELECT. Never run in prod.
\set ON_ERROR_STOP on
SET timezone='UTC';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
 END IF;
END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,year int,make text,model text,is_public boolean,
 deleted_at timestamptz,listing_kind text);
CREATE TABLE vehicle_events(id uuid PRIMARY KEY,vehicle_id uuid,source_platform text,source_url text,
 source_listing_id text,event_status text,final_price numeric,sold_at timestamptz,ended_at timestamptz,
 created_at timestamptz DEFAULT '2026-01-01Z',updated_at timestamptz DEFAULT '2026-02-01Z',
 extracted_at timestamptz DEFAULT '2026-01-01Z',metadata jsonb DEFAULT '{}');
CREATE INDEX idx_vehicle_events_vehicle ON vehicle_events(vehicle_id);
CREATE UNIQUE INDEX idx_vehicle_events_dedup ON vehicle_events(vehicle_id,source_platform,source_listing_id)
 WHERE source_listing_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vehicle_events_dedup_url ON vehicle_events(vehicle_id,source_platform,source_url)
 WHERE source_url IS NOT NULL AND source_listing_id IS NULL;
CREATE TABLE bat_listings(id uuid PRIMARY KEY,vehicle_id uuid,bat_listing_url text UNIQUE,bat_lot_number text,
 listing_status text,sale_price int,sale_date date,auction_end_date date,
 created_at timestamptz DEFAULT '2026-01-01Z',updated_at timestamptz DEFAULT '2026-02-01Z',
 scraped_at timestamptz DEFAULT '2026-01-01Z',raw_data jsonb DEFAULT '{}');
CREATE INDEX idx_bat_listings_vehicle ON bat_listings(vehicle_id);
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,platform text,listing_url text,fetched_at timestamptz,
 created_at timestamptz,http_status int,success boolean,html_sha256 text,html text,
 html_storage_path text,metadata jsonb DEFAULT '{}');
CREATE INDEX idx_listing_page_snapshots_platform_url_time ON listing_page_snapshots(platform,listing_url,fetched_at DESC);

INSERT INTO vehicles SELECT ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=2 THEN 2017 ELSE 1966 END,'SYNTHETIC',CASE WHEN i=2 THEN 'OTHER' ELSE 'MODEL' END,
 i<>3,CASE WHEN i=4 THEN '2025-01-01Z'::timestamptz END,
 CASE WHEN i=5 THEN 'non_vehicle_item' ELSE 'vehicle' END FROM generate_series(1,8) i;
INSERT INTO vehicle_events(id,vehicle_id,source_platform,source_url,source_listing_id,event_status,final_price,sold_at,ended_at) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bat','https://bringatrailer.com/listing/synthetic-first/','bringatrailer.com/listing/synthetic-first','sold',1000,'2020-06-15Z',NULL),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','bat','http://www.bringatrailer.com/listing/synthetic-first?utm_source=synthetic',NULL,'sold',1000,'2020-06-15Z',NULL),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','bat','https://bringatrailer.com/listing/synthetic-resale/',NULL,'sold',2000,'2025-05-01T20:30:45.123456Z',NULL),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/synthetic-other/',NULL,'sold',3000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000003','bat','https://bringatrailer.com/listing/synthetic-private/',NULL,'sold',4000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000004','bat','https://bringatrailer.com/listing/synthetic-deleted/',NULL,'sold',4000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000005','bat','https://bringatrailer.com/listing/synthetic-not-vehicle/',NULL,'sold',4000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000009','bat','https://bringatrailer.com/listing/synthetic-orphan/',NULL,'sold',4000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000006','bat','https://bringatrailer.com/listing/synthetic-no-clock/',NULL,'sold',1000,NULL,NULL),
 ('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000006','bat',NULL,NULL,'sold',1000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000007','deal_jacket_ocr','https://example.test/private/synthetic-upload',NULL,'sold',987654,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000008','bat','https://bringatrailer.com/listing/synthetic-conflict-a/','bringatrailer.com/listing/synthetic-conflict-b','sold',1000,'2024-08-01Z',NULL),
 ('20000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000002','bat','https://bringatrailer.com/listing/synthetic-unsold/',NULL,'unsold',500,NULL,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000002','bat','https://bringatrailer.com/listing/synthetic-live/',NULL,'active',NULL,NULL,'2027-08-01Z'),
 ('20000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000002','bat','https://bringatrailer.com/listing/synthetic-nan/',NULL,'sold','NaN','2024-08-01Z',NULL);
ALTER TABLE vehicle_events ADD CONSTRAINT vehicle_events_vehicle_id_fkey FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) NOT VALID;
INSERT INTO bat_listings(id,vehicle_id,bat_listing_url,listing_status,sale_price,sale_date,auction_end_date,raw_data) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://bringatrailer.com/listing/synthetic-first/','sold',1000,'2020-06-15',NULL,'{"sale_currency":"USD","sale_qualification":{"qualified":true}}'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','https://bringatrailer.com/listing/synthetic-resale/','sold',2000,'2025-05-01',NULL,'{}'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','https://bringatrailer.com/listing/synthetic-private-listing/','sold',1000,'2020-06-15',NULL,'{}'),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/synthetic-unsold/','no_sale',500,NULL,'2024-08-01','{}'),
 ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006','https://bringatrailer.com/listing/synthetic-no-clock-listing/','sold',1000,NULL,NULL,'{}'),
 ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/synthetic-ended/','ended',500,NULL,'2024-08-01','{}');
ALTER TABLE bat_listings ADD CONSTRAINT bat_listings_vehicle_id_fkey FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) NOT VALID;
INSERT INTO listing_page_snapshots VALUES
 ('40000000-0000-0000-0000-000000000001','bat','https://bringatrailer.com/listing/synthetic-first/','2026-01-01Z','2026-01-02Z',200,true,repeat('a',64),'SYNTHETIC RAW ONLY',NULL,'{"vehicle_id":"10000000-0000-0000-0000-000000000001","vehicle_matched":true,"parsed_at":"2026-01-03T00:00:00.123456Z"}'),
 ('40000000-0000-0000-0000-000000000002','bat','https://bringatrailer.com/listing/synthetic-first/','2027-01-01Z','2027-01-02Z',200,true,repeat('b',64),'SYNTHETIC LATER CONTRARY RAW',NULL,'{"vehicle_id":"10000000-0000-0000-0000-000000000001","vehicle_matched":true,"parsed_at":"2027-01-03T00:00:00Z"}'),
 ('40000000-0000-0000-0000-000000000003','bat','http://www.bringatrailer.com/listing/synthetic-first','2026-01-01Z','2026-01-02Z',200,true,repeat('c',64),'SYNTHETIC WRONG PARENT',NULL,'{"vehicle_id":"10000000-0000-0000-0000-000000000002","vehicle_matched":true,"parsed_at":"2026-01-03T00:00:00Z"}'),
 ('40000000-0000-0000-0000-000000000004','bat','https://bringatrailer.com/listing/synthetic-first/','2026-01-01Z','2026-01-02Z',200,true,repeat('d',64),NULL,'synthetic/archive.html','{"vehicle_id":"10000000-0000-0000-0000-000000000001","vehicle_matched":true,"parsed_at":"2026-01-03T00:00:00Z","archive_sale_qualification":{"currency":"USD","amount":1000,"qualified":true}}'),
 ('40000000-0000-0000-0000-000000000005','bat','https://bringatrailer.com/listing/synthetic-resale/','2026-01-01Z','2026-01-02Z',200,true,repeat('e',64),'SYNTHETIC RESALE RAW',NULL,'{"vehicle_id":"10000000-0000-0000-0000-000000000001","vehicle_matched":true,"parsed_at":"2026-01-03 00:00:00"}'),
 ('40000000-0000-0000-0000-000000000006','bat','https://bringatrailer.com/listing/synthetic-first/','2026-01-01Z','2026-01-02Z',500,false,repeat('f',64),'SYNTHETIC FAILED FETCH',NULL,'{"vehicle_id":"malformed","vehicle_matched":true}');
-- Run from the worktree root. Read the actual SELECT without replacing $n binds;
-- CSV control delimiters preserve its regular-expression backslashes and lines.
CREATE TEMP TABLE candidate_source(line_number bigint GENERATED ALWAYS AS IDENTITY,line text);
\copy candidate_source(line) FROM 'scripts/discovery/sale-event-candidates.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')
SELECT 'PREPARE sale_event_candidates(uuid[],timestamptz,timestamptz,integer,integer) AS '||string_agg(line,E'\n' ORDER BY line_number) FROM candidate_source
\gexec
CREATE FUNCTION pg_temp.candidates(ids uuid[],before_at timestamptz DEFAULT NULL,known_at timestamptz DEFAULT NULL,
 native_cap int DEFAULT 1000,capture_cap int DEFAULT 1000) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 EXECUTE format('EXECUTE sale_event_candidates(%L::uuid[],%L::timestamptz,%L::timestamptz,%s,%s)',
   ids,before_at,known_at,native_cap,capture_cap) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.assert_ok(condition boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
CREATE TEMP TABLE result AS SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles ORDER BY id)||ARRAY['10000000-0000-0000-0000-000000000009'::uuid],
 '2025-05-01T12:00:00Z','2026-01-02T12:00:00Z') AS j;
SELECT pg_temp.assert_ok(j#>>'{coverage,complete}'='true' AND j#>>'{population,eligiblePublicParents}'='5','complete explicit supplied population with public-real gate') FROM result;
SELECT pg_temp.assert_ok(jsonb_array_length(j->'candidates')=16,'all eligible native presentations retained without current-sale or outcome filter') FROM result;
SELECT pg_temp.assert_ok((SELECT count(DISTINCT c->>'sourceEpisodeKey') FROM jsonb_array_elements(j->'candidates') c WHERE c->>'vehicleId'='10000000-0000-0000-0000-000000000001')=2,'earlier and later resale episodes of one vehicle both survive') FROM result;
SELECT pg_temp.assert_ok((SELECT count(*) FROM jsonb_array_elements(j->'candidates') c WHERE c->>'sourceEpisodeKey'='bringatrailer.com/listing/synthetic-first')=3,'same episode repeated captures remain separately attributed before qualification/dedup') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'sourcePlatform'='mecum' AND c->>'eventDay'='2024-08-01'),'supplied other year/model/platform survives without hidden exact-year or BaT filter') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'eventDay'='2020-06-15'),'events older than three years retained for later explicit matching') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'eventDay'='2027-08-01' AND c#>>'{flags,eventBeforeCutoff}'='false'),'future event retained and annotated rather than silently discarded') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{qualification,status}'<>'candidate' OR c->'currency'<>'null'::jsonb OR c->'priceBasis'<>'null'::jsonb),'native amount and metadata units never become dollar comparisons') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE NOT c ? 'unitSource' OR c->'unitSource'<>'null'::jsonb OR c->>'conditionEvidence'<>'unknown'),'native candidate explicitly retains unknown unit attribution and condition evidence') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->'knownAt'<>'null'::jsonb OR c->'knownAtEvidence'<>'null'::jsonb),'mutable row ingestion/modification clocks do not become historical claim knowledge proof') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'publicSourceStatus'<>'unestablished'),'public vehicle does not authorize publication of private or unverified source values') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'sourcePlatform'='deal_jacket_ocr' AND c#>>'{qualification,status}'='candidate'),'private-source candidate remains private/tooling-only and unqualified') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'vehicleId' IN ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000009')),'private deleted nonvehicle and legacy orphan parents never exposed') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000009' AND c->'eventAt'='null'::jsonb AND c->>'outcome'='sold'),'missing event clock stays unknown with candidate retained') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000010' AND c#>>'{flags,unresolvedEpisode}'='true' AND c->'sourceEpisodeKey'='null'::jsonb),'missing episode identity is never replaced by vehicle/date grouping') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000012' AND c#>>'{flags,identityConflict}'='true' AND c->'sourceEpisodeKey'='null'::jsonb),'contradictory source URL and listing identifier refuse canonical episode assignment') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'recordedOutcome'='unsold' AND c->>'outcome'='not_sold'),'unsold positive price never becomes a sale') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c->>'recordedOutcome'='ended' AND c->>'outcome'='unknown'),'ended positive price is not inferred as sold or loss') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000015' AND c#>>'{flags,pricePositiveFinite}'='false' AND c->'amount'='null'::jsonb AND c#>>'{nativeRow,recordedAmount}'='NaN'),'nonfinite recorded amount remains raw testimony while candidate amount is null') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000003' AND c->>'eventAt'='2025-05-01T20:30:45.123456Z' AND c->>'eventGrain'='instant'),'original source instant preserves explicit UTC microseconds') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='30000000-0000-0000-0000-000000000002' AND c->>'eventAt'='2025-05-01' AND c->>'eventGrain'='day' AND c#>'{flags,eventBeforeCutoff}'='null'::jsonb),'date-only same-cutoff-day sale never acquires fabricated intraday ordering') FROM result;
SELECT pg_temp.assert_ok(jsonb_array_length(j->'sourceCaptureHeaders')=6,'all indexed same-source headers retained including repeats late bad and offloaded bodies') FROM result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{qualification,status}'<>'candidate'),'stored SHA or archived qualification metadata never substitutes raw verification') FROM result;
SELECT pg_temp.assert_ok(j::text NOT LIKE '%SYNTHETIC RAW ONLY%' AND j::text NOT LIKE '%SYNTHETIC LATER CONTRARY RAW%','no protected HTML projected through candidate headers') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000003' AND c->>'parentAttested'='false'),'different protected snapshot parent remains an explicit mismatch') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000004' AND c->>'archivedBodyRecorded'='true' AND c#>>'{qualification,status}'='candidate'),'unadmitted archive remains a pointer and never a qualified currency price') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000005' AND c->'parsedAt'='null'::jsonb),'unzoned parse header timestamp remains unknown') FROM result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000002' AND c->>'sourceHeadersWithinKnowledgeCutoff'='false'),'future protected capture kept distinct from earlier knowledge window') FROM result;
SELECT pg_temp.assert_ok(j#>>'{coverage,complete}'='false' AND j#>>'{coverage,refusal}'='native_presentation_cap_no_sample' AND jsonb_array_length(j->'candidates')=0,'native source cap refuses instead of sampling') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,1,1000) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,complete}'='true' AND j#>>'{coverage,captureHeadersComplete}'='false' AND jsonb_array_length(j->'candidates')=16 AND jsonb_array_length(j->'sourceCaptureHeaders')=0,'capture cap preserves candidate population but refuses partial source-header proof') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,1000,1) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,refusal}'='invalid_request' AND jsonb_array_length(j->'candidates')=0,'invalid population/cap has explicit refusal') FROM (SELECT pg_temp.candidates(NULL,NULL,NULL,0,0) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,refusal}'='invalid_request' AND jsonb_array_length(j->'candidates')=0,'negative limits refuse without evaluating an invalid SQL LIMIT') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,-2,-2) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,refusal}'='invalid_request' AND jsonb_array_length(j->'candidates')=0,'invalid maximum integer limits refuse without cap sentinel overflow') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,2147483647,2147483647) j) q;
SELECT pg_temp.assert_ok(jsonb_array_length(j->'candidates')=5 AND j#>>'{population,eligiblePublicParents}'='1','duplicate supplied parent IDs do not multiply events') FROM (SELECT pg_temp.candidates(ARRAY['10000000-0000-0000-0000-000000000001'::uuid,'10000000-0000-0000-0000-000000000001'::uuid]) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,complete}'='true' AND jsonb_array_length(j->'candidates')=16,'exact native row boundary retains a complete candidate page') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,11,1000) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,complete}'='false' AND jsonb_array_length(j->'candidates')=0,'native boundary plus one explicitly refuses the whole sampled page') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,10,1000) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,captureHeadersComplete}'='true' AND jsonb_array_length(j->'sourceCaptureHeaders')=6,'exact protected header boundary is complete') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,1000,6) j) q;
SELECT pg_temp.assert_ok(j#>>'{coverage,captureHeadersComplete}'='false' AND jsonb_array_length(j->'sourceCaptureHeaders')=0,'protected header boundary plus one refuses partial source evidence') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),NULL,NULL,1000,5) j) q;
INSERT INTO listing_page_snapshots VALUES ('40000000-0000-0000-0000-000000000007','bat','http://www.bringatrailer.com/listing/synthetic-first?utm_source=synthetic','2026-01-01Z','2026-01-02Z',200,true,repeat('1',64),'SYNTHETIC EXACT RECORDED URL',NULL,'{}');
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') h WHERE h#>>'{capture,id}'='40000000-0000-0000-0000-000000000007'),'exact recorded query-bearing URL uses indexed capture selection alongside canonical variants') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles)) j) q;
SET timezone='America/Los_Angeles';
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='30000000-0000-0000-0000-000000000001' AND c->>'eventAt'='2020-06-15') AND EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000003' AND c->>'eventAt'='2025-05-01T20:30:45.123456Z'),'LA session neither shifts sourced calendar dates nor discards UTC instant precision') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles)) j) q;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000003' AND c#>>'{flags,eventBeforeCutoff}'='false'),'instant equal to exclusive comparison cutoff remains outside') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),'2025-05-01T20:30:45.123456Z') j) q;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000003' AND c#>>'{flags,eventBeforeCutoff}'='true'),'instant one microsecond before exclusive comparison cutoff is inside') FROM (SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles),'2025-05-01T20:30:45.123457Z') j) q;
INSERT INTO vehicle_events(id,vehicle_id,source_platform,source_url,source_listing_id,event_status,final_price,sold_at) VALUES
 ('20000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lot?lot=synthetic-one',NULL,'sold',1000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lot?lot=synthetic-two',NULL,'sold',2000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/SyntheticLot',NULL,'sold',1000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000019','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/syntheticlot',NULL,'sold',2000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lot?lot=synthetic-three','https://mecum.com/lot?lot=synthetic-four','sold',1000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','bat','HTTPS://WWW.BRINGATRAILER.COM/LISTING/SYNTHETIC-FIRST/?utm_source=synthetic',NULL,'sold',1000,'2020-06-15Z'),
 ('20000000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000002','bringatrailer','https://bringatrailer.com/listing/synthetic-platform-alias/',NULL,'sold',1000,'2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000023','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/synthetic-infinity',NULL,'sold','Infinity','2024-08-01Z'),
 ('20000000-0000-0000-0000-000000000024','10000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/synthetic-negative-infinity',NULL,'sold','-Infinity','2024-08-01Z');
INSERT INTO listing_page_snapshots VALUES
 ('40000000-0000-0000-0000-000000000008','mecum','https://mecum.com/lot?lot=synthetic-one','2026-01-01Z','2026-01-02Z',200,true,repeat('2',64),'SYNTHETIC QUERY ONE',NULL,'{}'),
 ('40000000-0000-0000-0000-000000000009','mecum','https://mecum.com/lot?lot=synthetic-two','2026-01-01Z','2026-01-02Z',200,true,repeat('3',64),'SYNTHETIC QUERY TWO',NULL,'{}');
CREATE TEMP TABLE identity_result AS SELECT pg_temp.candidates(ARRAY(SELECT id FROM vehicles)) j;
SELECT pg_temp.assert_ok((SELECT count(DISTINCT c->>'sourceEpisodeKey') FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}' IN ('20000000-0000-0000-0000-000000000016','20000000-0000-0000-0000-000000000017'))=2,'non-BaT query-identified lots retain distinct source episodes') FROM identity_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000016' AND c->>'sourceEpisodeKey'='https://mecum.com/lot?lot=synthetic-one'),'non-BaT query value survives exact candidate identity') FROM identity_result;
SELECT pg_temp.assert_ok((SELECT count(DISTINCT c->>'sourceEpisodeKey') FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}' IN ('20000000-0000-0000-0000-000000000018','20000000-0000-0000-0000-000000000019'))=2,'non-BaT case-sensitive paths retain distinct source episodes') FROM identity_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000018' AND c->>'sourceEpisodeKey'='https://mecum.com/lots/SyntheticLot'),'non-BaT path case is preserved rather than lowercased') FROM identity_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000020' AND c#>>'{flags,identityConflict}'='true' AND c->'sourceEpisodeKey'='null'::jsonb),'conflicting non-BaT query listing identity remains unresolved') FROM identity_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000021' AND c->>'sourceEpisodeKey'='bringatrailer.com/listing/synthetic-first'),'known BaT host path query and transport aliases share one episode key') FROM identity_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000022' AND c->>'sourcePlatform'='bringatrailer' AND c->>'sourceEpisodeKey'='https://bringatrailer.com/listing/synthetic-platform-alias/' AND c#>>'{qualification,status}'='candidate'),'unestablished platform alias is not silently reassigned to BaT') FROM identity_result;
SELECT pg_temp.assert_ok((SELECT count(*) FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}' IN ('40000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000009'))=2 AND EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000008' AND c->>'sourceEpisodeKey'='https://mecum.com/lot?lot=synthetic-one') AND EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') c WHERE c#>>'{capture,id}'='40000000-0000-0000-0000-000000000009' AND c->>'sourceEpisodeKey'='https://mecum.com/lot?lot=synthetic-two'),'exact indexed non-BaT capture pointers remain attributed to their distinct query lots') FROM identity_result;
SELECT pg_temp.assert_ok((SELECT count(*) FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{capture,id}' IN ('20000000-0000-0000-0000-000000000023','20000000-0000-0000-0000-000000000024') AND c->'amount'='null'::jsonb AND c#>>'{nativeRow,recordedAmount}' IN ('Infinity','-Infinity') AND c#>>'{flags,pricePositiveFinite}'='false')=2,'infinite native prices cannot break finite-number-or-null candidate DTO') FROM identity_result;
