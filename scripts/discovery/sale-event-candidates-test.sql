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
-- Empty at first: the existing unestablished-alias assertions still apply.
-- Duplicate rows below deliberately prove no native fan-out on bad metadata.
CREATE TABLE source_alias_mapping(raw_value text,canonical_slug text);
CREATE INDEX source_alias_raw_value ON source_alias_mapping(raw_value);
CREATE TABLE vehicle_events(id uuid PRIMARY KEY,vehicle_id uuid,source_platform text,source_url text,
 source_listing_id text,event_status text,final_price numeric,sold_at timestamptz,ended_at timestamptz,
 created_at timestamptz DEFAULT '2026-01-01Z',updated_at timestamptz DEFAULT '2026-02-01Z',
 extracted_at timestamptz DEFAULT '2026-01-01Z',metadata jsonb DEFAULT '{}',
 extraction_method text,extractor_version text,extraction_source text);
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

-- Wider market context survives sparse prices, repeat captures and unresolved
-- identity. These native claims cannot establish qualified sales or a trend.
INSERT INTO vehicles(id,year,make,model,is_public) VALUES
 ('90000000-0000-0000-0000-000000000001',1963,'Chevrolet','Corvette',true),
 ('90000000-0000-0000-0000-000000000002',1970,'Chevrolet','Corvette',true),
 ('90000000-0000-0000-0000-000000000003',1965,'Ford','Mustang',true),
 ('90000000-0000-0000-0000-000000000004',1963,'Chevrolet','Corvette',true);
INSERT INTO vehicle_events(id,vehicle_id,source_platform,source_url,event_status,final_price,sold_at) VALUES
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','mecum','https://mecum.com/lots/synthetic-corvette','sold',NULL,NULL),
 ('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002','mecum','https://mecum.com/lots/synthetic-corvette','sold',125000,'2014-01-24Z'),
 ('91000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','barrett-jackson','https://barrett-jackson.com/lots/synthetic-corvette','no_sale',50000,'2024-01-01Z'),
 ('91000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000003','bat','https://bringatrailer.com/listing/synthetic-mustang-context/','active',NULL,NULL),
 ('91000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000001','mecum','https://mecum.com/lots/synthetic-conflict','sold',0,'2025-01-01Z'),
 ('91000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000001','mecum',NULL,'no_sale',0,'2025-01-01Z'),
 ('91000000-0000-0000-0000-000000000007','90000000-0000-0000-0000-000000000001','mecum',NULL,NULL,NULL,NULL),
 ('91000000-0000-0000-0000-000000000008','90000000-0000-0000-0000-000000000003',NULL,'https://synthetic.example/unknown-platform',NULL,NULL,NULL),
 ('91000000-0000-0000-0000-000000000009','90000000-0000-0000-0000-000000000001','mecum','https://mecum.com/lots/synthetic-earlier-resale','sold',100000,'2013-01-01Z');
UPDATE vehicle_events SET source_listing_id='https://mecum.com/lots/synthetic-conflict'
 WHERE id='91000000-0000-0000-0000-000000000006';
INSERT INTO bat_listings(id,vehicle_id,bat_listing_url,listing_status) VALUES
 ('92000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','http://www.bringatrailer.com/listing/SYNTHETIC-MUSTANG-CONTEXT/?ref=synthetic','active');
CREATE TEMP TABLE context_result AS SELECT pg_temp.candidates(ARRAY[
 '90000000-0000-0000-0000-000000000001'::uuid,
 '90000000-0000-0000-0000-000000000002'::uuid,
 '90000000-0000-0000-0000-000000000003'::uuid,
 '90000000-0000-0000-0000-000000000004'::uuid],'2020-01-01Z') j;
SELECT pg_temp.assert_ok(j#>>'{sourceContext,presentationCount}'='10' AND jsonb_array_length(j->'candidates')=10,
 'all source presentations survive a narrower comparison cutoff and absent price qualification') FROM context_result;
SELECT pg_temp.assert_ok(j#>>'{sourceContext,identifiedEpisodeCount}'='5' AND j#>>'{sourceContext,unresolvedIdentityPresentationCount}'='2'
 AND j#>>'{sourceContext,additionalPresentationsForIdentifiedEpisodes}'='3',
 'episode identity separates repeated captures and unresolved rows without inventing unique vehicle counts') FROM context_result;
SELECT pg_temp.assert_ok(j#>>'{sourceContext,parentsWithNativePresentations}'='3' AND
 j#>>'{sourceContext,parentsWithoutNativePresentations}'='1',
 'complete native selection exposes parents with no event or listing evidence rather than implying coverage') FROM context_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j#>'{sourceContext,sources}') s WHERE s->>'platform'='mecum'
 AND s->>'presentationCount'='6' AND s->>'identifiedEpisodeCount'='3' AND s->>'reportedSoldEpisodes'='2'
 AND s->>'contradictoryOutcomeEpisodes'='1' AND s->>'episodesWithMultipleParents'='1'),
 'Mecum claims contribute context with two resales, duplicate parents and an explicit outcome conflict') FROM context_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j#>'{sourceContext,sources}') s WHERE s->>'platform'='barrett-jackson'
 AND s->>'reportedNotSoldEpisodes'='1') AND EXISTS(SELECT FROM jsonb_array_elements(j#>'{sourceContext,sources}') s
 WHERE s->>'platform'='bat' AND s->>'presentationCount'='2' AND s->>'identifiedEpisodeCount'='1' AND s->>'unknownOutcomeEpisodes'='1'
 AND s->>'episodesWithoutRecordedDay'='1'),
 'other venues and a non-Corvette retain no-sale and undated unknown-outcome context') FROM context_result;
SELECT pg_temp.assert_ok(j#>>'{sourceContext,priceQualified}'='false' AND j#>>'{sourceContext,windowApplied}'='false'
 AND j#>>'{sourceContext,knowledgeMode}'='current_native_rows_not_historical_availability'
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c WHERE c#>>'{qualification,status}'<>'candidate'),
 'context does not promote native claims into qualified prices or historical market movement') FROM context_result;
SELECT pg_temp.assert_ok(j#>'{sourceContext,presentationCount}'='null'::jsonb AND j#>>'{sourceContext,completeWithinPage}'='false'
 AND j#>'{sourceContext,sources}'='[]'::jsonb,
 'native overflow withholds context totals instead of presenting sampled or zero market counts')
 FROM (SELECT pg_temp.candidates(ARRAY['90000000-0000-0000-0000-000000000001'::uuid],NULL,NULL,1,100) j) q;

-- Exact current catalog links may connect platform spellings. They do not
-- qualify the source, admit prices or invent historical alias availability.
INSERT INTO source_alias_mapping VALUES
 ('cars_and_bids','cars-and-bids'),('bringatrailer','bat'),
 ('synthetic-ambiguous','cars-and-bids'),('synthetic-ambiguous','bat'),
 ('synthetic-empty',NULL);
INSERT INTO vehicle_events(id,vehicle_id,source_platform,source_url,event_status,final_price,sold_at) VALUES
 ('93000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004','cars_and_bids','https://carsandbids.com/auctions/synthetic-alias','sold',1000,'2025-01-01Z'),
 ('93000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000004','cars-and-bids','https://carsandbids.com/auctions/synthetic-alias','sold',1000,'2025-01-01Z'),
 ('93000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004','synthetic-ambiguous','https://carsandbids.com/auctions/synthetic-ambiguous','sold',1000,'2025-01-01Z'),
 ('93000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000004','synthetic-unknown','https://carsandbids.com/auctions/synthetic-unknown','sold',1000,'2025-01-01Z'),
 ('93000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000004','bringatrailer','https://bringatrailer.com/listing/synthetic-bat-alias/','sold',1000,'2025-01-01Z'),
 ('93000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000004','synthetic-empty','https://synthetic.example/empty','sold',1000,'2025-01-01Z');
INSERT INTO listing_page_snapshots VALUES
 ('94000000-0000-0000-0000-000000000001','cars-and-bids','https://carsandbids.com/auctions/synthetic-alias','2026-01-01Z','2026-01-02Z',200,true,repeat('a',64),'SYNTHETIC CANONICAL LABEL',NULL,'{}'),
 ('94000000-0000-0000-0000-000000000002','cars_and_bids','https://carsandbids.com/auctions/synthetic-alias','2026-01-01Z','2026-01-02Z',200,true,repeat('b',64),'SYNTHETIC RECORDED LABEL',NULL,'{}'),
 ('94000000-0000-0000-0000-000000000003','bat','https://carsandbids.com/auctions/synthetic-alias','2026-01-01Z','2026-01-02Z',200,true,repeat('c',64),'SYNTHETIC WRONG PLATFORM',NULL,'{}'),
 ('94000000-0000-0000-0000-000000000004','bat','https://bringatrailer.com/listing/synthetic-bat-alias','2026-01-01Z','2026-01-02Z',200,true,repeat('d',64),'SYNTHETIC BAT ALIAS',NULL,'{}');
CREATE TEMP TABLE alias_result AS SELECT pg_temp.candidates(ARRAY['90000000-0000-0000-0000-000000000004'::uuid]) j;
SELECT pg_temp.assert_ok(jsonb_array_length(j->'candidates')=6 AND j#>>'{sourceContext,presentationCount}'='6',
 'ambiguous alias lookup never multiplies or removes native presentations') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{capture,id}'='93000000-0000-0000-0000-000000000001'
 AND c->>'sourcePlatform'='cars-and-bids' AND c->>'sourcePlatformRaw'='cars_and_bids'
 AND c->>'sourcePlatformBasis'='current_exact_alias_mapping'),
 'exact registered platform alias is attributed while original label survives') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j#>'{sourceContext,sources}') s
 WHERE s->>'platform'='cars-and-bids' AND s->>'presentationCount'='2' AND s->>'identifiedEpisodeCount'='1'),
 'known source spellings share one episode rather than two claimed sales') FROM alias_result;
SELECT pg_temp.assert_ok((SELECT count(*) FROM jsonb_array_elements(j->'sourceCaptureHeaders') h
 WHERE h->>'sourcePlatform'='cars-and-bids')=2
 AND EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') h
 WHERE h->>'sourcePlatformRaw'='cars_and_bids'),
 'raw and canonical capture labels connect once to the same attributed episode') FROM alias_result;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') h
 WHERE h#>>'{capture,id}'='94000000-0000-0000-0000-000000000003'),
 'same URL on an unrelated platform is not lent to the episode') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c->>'sourcePlatform'='synthetic-ambiguous'
 AND c->>'sourcePlatformBasis'='ambiguous_or_empty_alias_kept_raw'),
 'contradictory alias mappings retain unresolved recorded source context') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c->>'sourcePlatform'='synthetic-unknown'
 AND c->>'sourcePlatformBasis'='recorded_platform_context_alias_unestablished'),
 'a familiar domain does not invent a missing platform alias') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c->>'sourcePlatform'='synthetic-empty'
 AND c->>'sourcePlatformBasis'='ambiguous_or_empty_alias_kept_raw'),
 'empty registered alias target stays unresolved instead of deleting source context') FROM alias_result;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'sourceCaptureHeaders') h
 WHERE h#>>'{capture,id}'='94000000-0000-0000-0000-000000000004'
 AND h->>'sourcePlatform'='bat' AND h->>'sourceEpisodeKey'='bringatrailer.com/listing/synthetic-bat-alias'),
 'explicit BaT platform alias reaches the existing exact listing URL aliases') FROM alias_result;
SELECT pg_temp.assert_ok(j#>>'{sourceContext,priceQualified}'='false'
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c->'currency'<>'null'::jsonb OR c->'knownAt'<>'null'::jsonb
 OR c->>'publicSourceStatus'<>'unestablished' OR c#>>'{qualification,status}'<>'candidate'),
 'current alias resolution never supplies units, source publication or historical knowledge') FROM alias_result;
UPDATE vehicle_events SET event_status='no_sale'
 WHERE id='93000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j#>'{sourceContext,sources}') s
 WHERE s->>'platform'='cars-and-bids' AND s->>'contradictoryOutcomeEpisodes'='1'
 AND s->>'reportedSoldEpisodes'='0' AND s->>'reportedNotSoldEpisodes'='0'),
 'opposing outcomes under a known alias remain a conflict rather than a sold episode')
 FROM (SELECT pg_temp.candidates(ARRAY['90000000-0000-0000-0000-000000000004'::uuid]) j) q;

-- Row-construction labels distinguish inspection targets without establishing
-- independent source testimony or changing any existing candidate decision.
CREATE TEMP TABLE extraction_before AS SELECT pg_temp.candidates(ARRAY[
 '90000000-0000-0000-0000-000000000004'::uuid,
 '10000000-0000-0000-0000-000000000001'::uuid]) j;
UPDATE vehicle_events SET extraction_method='orphan-backfill-v1',
 extractor_version=NULL,extraction_source='SYNTHETIC PRIVATE PAYLOAD',
 metadata='{"independent":true,"currency":"USD","qualified":true}'
 WHERE id='93000000-0000-0000-0000-000000000001';
UPDATE vehicle_events SET extraction_method=' retained synthetic method ',
 extractor_version='synthetic-v2'
 WHERE id='93000000-0000-0000-0000-000000000002';
CREATE TEMP TABLE extraction_after AS SELECT pg_temp.candidates(ARRAY[
 '90000000-0000-0000-0000-000000000004'::uuid,
 '10000000-0000-0000-0000-000000000001'::uuid]) j;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{capture,id}'='93000000-0000-0000-0000-000000000001'
 AND c#>>'{nativeRow,extractionMethod}'='orphan-backfill-v1'
 AND c#>'{nativeRow,extractorVersion}'='null'::jsonb
 AND c#>>'{nativeRow,extractionMetadataBasis}'='vehicle_events.extraction_method_and_extractor_version'),
 'retained backfill label is exposed without inventing a version') FROM extraction_after;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{capture,id}'='93000000-0000-0000-0000-000000000002'
 AND c#>>'{nativeRow,extractionMethod}'=' retained synthetic method '
 AND c#>>'{nativeRow,extractorVersion}'='synthetic-v2'),
 'method and version preserve exact retained attribution') FROM extraction_after;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{capture,table}'='bat_listings'
 AND c#>'{nativeRow,extractionMethod}'='null'::jsonb
 AND c#>'{nativeRow,extractorVersion}'='null'::jsonb
 AND c#>>'{nativeRow,extractionMetadataBasis}'='not_retained_in_bat_listing_columns'),
 'listing scrape clock does not invent extraction provenance') FROM extraction_after;
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{capture,id}'='20000000-0000-0000-0000-000000000001'
 AND c#>'{nativeRow,extractionMethod}'='null'::jsonb
 AND c#>>'{nativeRow,extractionMetadataBasis}'='vehicle_events.extraction_method_and_extractor_version'),
 'missing event extraction method stays explicitly unknown') FROM extraction_after;
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c#>>'{nativeRow,sourceIndependence}'<>'unestablished'
 OR c->'knownAt'<>'null'::jsonb OR c->'currency'<>'null'::jsonb
 OR c#>>'{qualification,status}'<>'candidate'),
 'native extraction labels and arbitrary metadata do not qualify sources or prices') FROM extraction_after;
SELECT pg_temp.assert_ok(position('SYNTHETIC PRIVATE PAYLOAD' in j::text)=0
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(j->'candidates') c
 WHERE c->'nativeRow' ? 'extractionSource' OR c->'nativeRow' ? 'metadata'),
 'raw extraction payload and arbitrary metadata are not projected') FROM extraction_after;
SELECT pg_temp.assert_ok((SELECT j-'candidates' FROM extraction_before)=j-'candidates'
 AND (SELECT jsonb_agg(c||jsonb_build_object('nativeRow',(c->'nativeRow')-'extractionMethod'-'extractorVersion')
 ORDER BY c#>>'{capture,table}',c#>>'{capture,id}') FROM jsonb_array_elements(j->'candidates') c)
 = (SELECT jsonb_agg(c||jsonb_build_object('nativeRow',(c->'nativeRow')-'extractionMethod'-'extractorVersion')
 ORDER BY c#>>'{capture,table}',c#>>'{capture,id}') FROM extraction_before b,
 jsonb_array_elements(b.j->'candidates') c),
 'extraction metadata changes preserve every candidate decision, clock, capture and count') FROM extraction_after;
