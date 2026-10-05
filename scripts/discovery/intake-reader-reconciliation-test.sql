-- Empty local PG17 database dm_fold_reconcile_* only; no production fixture.
-- psql -X -v ON_ERROR_STOP=1 -d dm_fold_reconcile_ci -f this-file.sql
-- Reuse the ACTUAL existing owner/reader bootstrap + its unchanged controls.
\set ON_ERROR_STOP on
\ir ../../supabase/sql/test_listed_engine_reported_state.sql
BEGIN;
ALTER TABLE public.vehicles ADD COLUMN make text, ADD COLUMN model text;
CREATE TABLE public.listing_page_snapshots (
 id uuid PRIMARY KEY,html text,html_storage_path text,html_sha256 text,
 fetched_at timestamptz,created_at timestamptz,metadata jsonb
);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id));
CREATE TABLE public.observation_properties (
 id uuid PRIMARY KEY,property_key text UNIQUE,applies_to_kinds public.observation_kind[],deprecated_at timestamptz
);
ALTER TABLE public.vehicle_observations
 ADD COLUMN source_snapshot_id uuid REFERENCES public.listing_page_snapshots(id),
 ADD COLUMN source_vehicle_event_id uuid REFERENCES public.vehicle_events(id),
 ADD COLUMN property_id uuid REFERENCES public.observation_properties(id),
 ADD COLUMN content_hash text;
CREATE TEMP TABLE query_text(line text);
\copy query_text FROM 'scripts/discovery/intake-reader-reconciliation.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')
CREATE FUNCTION pg_temp.reconcile(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; sql text;
BEGIN
 SELECT string_agg(line,E'\n' ORDER BY ctid) INTO sql FROM query_text;
 EXECUTE sql INTO result USING p_input;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.item(n integer,f text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('key','case_'||n,'field',f,'observationId',pg_temp.uid(n))
$$;
CREATE FUNCTION pg_temp.doc(items jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('asOf',statement_timestamp()+interval '1 hour','requests',items)
$$;
CREATE TEMP TABLE checks(n integer);
CREATE FUNCTION pg_temp.check(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE,label; INSERT INTO checks VALUES(1); END $$;

INSERT INTO public.vehicles(id,is_public,make,model) VALUES
 (pg_temp.uid(101),true,'Ford','Mustang'),(pg_temp.uid(102),true,'Porsche','911'),
 (pg_temp.uid(103),true,'Chevrolet','C10'),(pg_temp.uid(104),true,'Toyota','FJ40'),
 (pg_temp.uid(105),false,'Fixture','Private');
INSERT INTO public.observation_sources VALUES
 (pg_temp.uid(201),'bat',.8),(pg_temp.uid(202),'mecum',.8),(pg_temp.uid(203),'classified_fixture',.6);
INSERT INTO public.listing_page_snapshots
SELECT pg_temp.uid(n),'DO_NOT_PRINT_SOURCE_PAYLOAD',NULL,
 encode(sha256(convert_to('DO_NOT_PRINT_SOURCE_PAYLOAD','UTF8')),'hex'),
 '2025-01-01','2025-01-02',jsonb_build_object('vehicle_id',pg_temp.uid(101))
FROM generate_series(301,303) n;
INSERT INTO public.listing_page_snapshots VALUES
 (pg_temp.uid(304),NULL,'PRIVATE_PATH_NOT_CONTENT',NULL,'2025-01-01','2025-01-02','{}'),
 (pg_temp.uid(305),repeat('x',4194305),NULL,NULL,'2025-01-01','2025-01-02','{}'),
 (pg_temp.uid(306),NULL,NULL,NULL,'2025-01-01','2025-01-02','{}');
INSERT INTO public.vehicle_events VALUES (pg_temp.uid(401),pg_temp.uid(101)),(pg_temp.uid(402),pg_temp.uid(102));
INSERT INTO public.observation_properties VALUES
 (pg_temp.uid(501),'image_visible_rust_severity',ARRAY['condition'::public.observation_kind],NULL),
 (pg_temp.uid(502),'retired_property',ARRAY['condition'::public.observation_kind],'2025-01-01');
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at,
  content_text,extraction_method,content_hash,source_snapshot_id,source_vehicle_event_id,property_id)
VALUES
 (pg_temp.uid(1),pg_temp.uid(101),pg_temp.uid(201),'listing','{"color":"Blue"}',.8,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',pg_temp.uid(301),pg_temp.uid(401),NULL),
 (pg_temp.uid(2),pg_temp.uid(102),pg_temp.uid(202),'sale_result','{"engine_size":"Source-reported engine"}',.8,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(3),pg_temp.uid(103),pg_temp.uid(203),'specification','{"transmission":"Manual"}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(4),pg_temp.uid(104),pg_temp.uid(201),'condition',
  jsonb_build_object('image_visible_rust_severity','surface','image_id',pg_temp.uid(601)),.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,pg_temp.uid(501)),
 (pg_temp.uid(5),NULL,pg_temp.uid(203),'listing','{"color":"Blue"}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(6),pg_temp.uid(103),pg_temp.uid(202),'listing','{"color":"Red"}',.6,'2027-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(7),pg_temp.uid(103),pg_temp.uid(203),'listing','{"mileage":1000}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(8),pg_temp.uid(103),pg_temp.uid(203),'listing','{"mileage":2000}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(9),pg_temp.uid(105),pg_temp.uid(203),'listing','{"color":"Blue"}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(10),pg_temp.uid(101),pg_temp.uid(201),'listing','{"body_style":"Notchback","email":"PRIVATE_MARKER"}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(11),pg_temp.uid(101),pg_temp.uid(201),'listing','{"color":"Red"}',.6,NULL,'2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(12),pg_temp.uid(104),pg_temp.uid(201),'condition','{"retired_property":"old"}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,pg_temp.uid(502)),
 (pg_temp.uid(13),pg_temp.uid(101),pg_temp.uid(201),'listing','{}',.6,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',NULL,NULL,NULL),
 (pg_temp.uid(14),pg_temp.uid(101),pg_temp.uid(201),'sale_result','{"engine_size":"289ci V8"}',.8,'2025-01-01','2025-01-03',
  'DO_NOT_PRINT_SOURCE_PAYLOAD','fixture_parser','fixture_hash',pg_temp.uid(301),pg_temp.uid(401),NULL);
UPDATE public.vehicle_observations SET source_url='https://source.invalid/listing/engine-14'
WHERE id=pg_temp.uid(14);
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,is_sensitive)
VALUES(pg_temp.uid(601),pg_temp.uid(104),'https://fixture.invalid/image.jpg',false);
INSERT INTO public.observation_witnesses VALUES(pg_temp.uid(701),pg_temp.uid(4),pg_temp.uid(601),'derived');
UPDATE public.vehicle_observations SET observed_at=statement_timestamp()+interval '2 days' WHERE id=pg_temp.uid(6);
SELECT public.detect_field_conflicts(pg_temp.uid(101)),public.detect_field_conflicts(pg_temp.uid(103));
-- Current fold time is explicitly independent of the earlier request cutoff.
CREATE TEMP TABLE results AS SELECT pg_temp.reconcile(pg_temp.doc(jsonb_build_array(
 pg_temp.item(1,'color')||jsonb_build_object('vehicleId',pg_temp.uid(101),'captureId',pg_temp.uid(301),'eventId',pg_temp.uid(401)),
 pg_temp.item(2,'engine_size')||jsonb_build_object('captureId',pg_temp.uid(302)),
 pg_temp.item(3,'transmission')||'{"propertyKey":"unknown_property"}'::jsonb,
 pg_temp.item(4,'image_visible_rust_severity')||'{"propertyKey":"image_visible_rust_severity"}'::jsonb,
 pg_temp.item(5,'color'),pg_temp.item(6,'color'),pg_temp.item(7,'mileage'),pg_temp.item(9,'color'),
 pg_temp.item(10,'body_style'),pg_temp.item(11,'color'),
 pg_temp.item(12,'retired_property')||'{"propertyKey":"retired_property"}'::jsonb,
 pg_temp.item(13,'color'),
 pg_temp.item(14,'engine_size')||jsonb_build_object('vehicleId',pg_temp.uid(101),'captureId',pg_temp.uid(301),'eventId',pg_temp.uid(401)),
 jsonb_build_object('key','capture_only','field','color','captureId',pg_temp.uid(303)),
 jsonb_build_object('key','parsed_not_admitted','field','color','captureId',pg_temp.uid(303),'parsedStatus','extracted_unadmitted'),
 jsonb_build_object('key','offload_only','field','color','captureId',pg_temp.uid(304)),
 jsonb_build_object('key','large_retained','field','color','captureId',pg_temp.uid(305)),
 jsonb_build_object('key','header_only','field','color','captureId',pg_temp.uid(306))
))) receipt;
CREATE FUNCTION pg_temp.result(k text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT i FROM results r CROSS JOIN LATERAL jsonb_array_elements(r.receipt->'items') i WHERE i->>'key'=k
$$;
SELECT pg_temp.check((SELECT receipt->>'requestedItems'='18' FROM results),'explicit inventory denominator');
SELECT pg_temp.check((SELECT (SELECT sum(v::integer) FROM jsonb_each_text(receipt->'stageCounts') c(k,v))=18 FROM results),'every request counted once');
SELECT pg_temp.check(pg_temp.result('case_1')->>'stage'='exposed','listing fold evidence exposed');
SELECT pg_temp.check(pg_temp.result('case_1')->'links'->>'typedCapture'='true','typed capture relation');
SELECT pg_temp.check(pg_temp.result('case_1')->'links'->>'typedEpisode'='true','typed episode relation');
SELECT pg_temp.check(pg_temp.result('case_1')->'reader'->>'foldMatches'='true','fold source value and clocks');
SELECT pg_temp.check(pg_temp.result('case_1')->'reader'->>'scalarPresent'='false','absent canonical scalar does not lose reported source');
SELECT pg_temp.check(pg_temp.result('case_2')->>'finding'='typed_capture_link_missing_or_different','native NULL FK remains linkage gap');
SELECT pg_temp.check(pg_temp.result('case_2')->'retention'->>'originalObservation'='true','native original retained');
SELECT pg_temp.check(pg_temp.result('case_3')->>'finding'='property_unregistered_unbound_or_inapplicable','unknown registry relation');
SELECT pg_temp.check(pg_temp.result('case_4')->'links'->>'registeredProperty'='true','registered condition property');
SELECT pg_temp.check(pg_temp.result('case_4')->>'stage'='linked','typed image property remains linked without invented fold');
SELECT pg_temp.check(pg_temp.result('case_4')->'reader'->>'provenanceMeasurement'='unmeasured_unbounded_owner','unbounded drill not executed or post-filtered into coverage');
SELECT pg_temp.check(pg_temp.result('case_5')->>'finding'='unbound_or_contradictory_vehicle','unresolved blip not mislabeled private');
SELECT pg_temp.check(pg_temp.result('case_6')->>'stage'='clock_withheld','future event cutoff');
SELECT pg_temp.check(pg_temp.result('case_7')->>'finding'='reported_conflict_not_resolved_truth','conflict remains visible');
SELECT pg_temp.check(pg_temp.result('case_9')->>'stage'='privacy_withheld','private parent withheld');
SELECT pg_temp.check(pg_temp.result('case_10')->>'stage'='privacy_withheld','private observation on public parent withheld');
SELECT pg_temp.check(pg_temp.result('case_11')->'clocks'->>'observationState'='unknown','missing clocks not fabricated');
SELECT pg_temp.check(pg_temp.result('case_12')->>'finding'='property_unregistered_unbound_or_inapplicable','deprecated registry relation');
SELECT pg_temp.check(pg_temp.result('case_13')->>'finding'='field_not_extracted_original_testimony_retained','original text retained without scalar claim');
SELECT pg_temp.check(pg_temp.result('case_14')->>'stage'='exposed'
 AND pg_temp.result('case_14')->'reader'->>'specsValueCurrent'='true','current deployed listed-engine owner exposes same source field value');
SELECT pg_temp.check(pg_temp.result('case_14')->'propertyId'='null'::jsonb
 AND NOT (pg_temp.result('case_14')->'relationGaps' ? 'requested_property_relation_unestablished'),'listed-engine envelope needs no invented property admission');
SELECT pg_temp.check((SELECT f->>'sale_episode_binding'='unestablished'
 AND f->>'field_meaning'='listed_engine_phrase_not_parsed_architecture_or_displacement'
 FROM jsonb_array_elements(public.get_vehicle_specs(pg_temp.uid(101))) f
 WHERE f->>'field'='engine_size'),'positive phrase exposure does not fabricate sale-configuration qualification');
SELECT pg_temp.check(pg_temp.result('capture_only')->>'stage'='retained_only','capture retained only');
SELECT pg_temp.check(pg_temp.result('parsed_not_admitted')->>'stage'='parsed_unadmitted','parsed inventory not DB admission');
SELECT pg_temp.check(pg_temp.result('offload_only')->'retention'->>'offloadLocatorOnly'='true','offload locator not fetched proof');
SELECT pg_temp.check(pg_temp.result('offload_only')->>'stage'='retention_locator_only','offload path is not verified retained bytes');
SELECT pg_temp.check(pg_temp.result('header_only')->>'stage'='retention_unestablished','bare header is not retained source body');
SELECT pg_temp.check(pg_temp.result('large_retained')->'retention'->>'rawSizeWithheld'='true','size gate preserves retained source');
SELECT pg_temp.check((SELECT receipt::text NOT LIKE '%DO_NOT_PRINT_SOURCE_PAYLOAD%' AND receipt::text NOT LIKE '%PRIVATE_PATH%' AND receipt::text NOT LIKE '%PRIVATE_MARKER%' FROM results),'no raw source/path/private text emitted');
SELECT pg_temp.check(pg_temp.result('case_2')->'repair'->>'canonicalIntake'='ingest-observation','existing intake owner named');
SELECT pg_temp.check(pg_temp.result('case_7')->'repair'->'owner' ? 'detect_field_conflicts','existing fold owner named');
SELECT pg_temp.check(pg_temp.result('case_7')->'repair'->>'acceptanceCase'='case_7','executable supplied acceptance key');
SELECT pg_temp.check(NOT (pg_temp.result('case_1')->'relationGaps' ? 'requested_property_relation_unestablished'),'multi-field envelope property NULL not blanket extraction loss');
SELECT pg_temp.check(pg_temp.result('case_2')->'relationGaps' ? 'current_fold_not_selected_or_unestablished','downstream fold gap retained alongside first missing link');
SELECT pg_temp.check(pg_temp.reconcile('{"requests":[{"key":"bad","field":"color","observationId":"invalid"}],"asOf":"2026-01-01"}')->>'status'='refused','malformed UUID refused without cast error');
SELECT pg_temp.check(pg_temp.reconcile('{"requests":[],"asOf":"bad date"}')->>'status'='refused','malformed clock refused');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(pg_temp.item(1,'color'),pg_temp.item(1,'color'))))->>'status'='refused','duplicate request keys refuse denominator inflation');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc((SELECT jsonb_agg(jsonb_build_object('key','many_'||n,'field','color')) FROM generate_series(1,51) n)))->>'status'='refused','overcap refuses unsampled request set');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(pg_temp.item(1,'color')||jsonb_build_object('captureId',pg_temp.uid(301),'sourceDigest',repeat('0',64)))))->'items'->0->>'finding'='source_header_digest_mismatch_or_missing','digest mismatch preserved');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(pg_temp.item(1,'color')||'{"requiredRole":"current"}'::jsonb)))->'items'->0->>'finding'='source_role_requires_episode_qualification','current scalar not installed-role proof');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(
 pg_temp.item(1,'color')||jsonb_build_object('vehicleId',pg_temp.uid(102))
)))->'items'->0->'reader'->>'specsValueCurrent'='false','wrong requested public parent cannot expose different parent observation');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(
 pg_temp.item(9,'color')||jsonb_build_object('vehicleId',pg_temp.uid(101))
)))->'items'->0->'reader'->>'specsReference'='false','public requested parent does not expose actual private-parent observation');
SELECT pg_temp.check(pg_temp.reconcile(jsonb_build_object('asOf','2025-01-04','requests',
 jsonb_build_array(pg_temp.item(1,'color'))
))->'items'->0->'reader'->>'foldAfterCutoff'='true','current fold does not prove historical reader availability');
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(
 jsonb_build_object('key','region_a','field','color','captureId',pg_temp.uid(301),'regionKey','details'),
 jsonb_build_object('key','region_b','field','color','captureId',pg_temp.uid(301),'regionKey','details')
)))->>'status'='refused','same capture region field refuses duplicate coverage even with different request keys');
-- ID-only correspondence cannot claim field-value exposure.
UPDATE public.vehicles SET color='Canonical different color' WHERE id=pg_temp.uid(101);
SELECT pg_temp.check(pg_temp.reconcile(pg_temp.doc(jsonb_build_array(pg_temp.item(1,'color'))))->'items'->0->'reader'->>'specsValueCurrent'='false','source FK with conflicting scalar does not expose matching value');
-- The imported provenance owner remains available, but this assay deliberately
-- does not invoke its unbounded source array or narrate it as a bounded route.
SELECT pg_temp.check(public.get_field_provenance(pg_temp.uid(104),'image_visible_rust_severity')->'observations'->0->>'id'=pg_temp.uid(4)::text,'actual synthetic direct reader exists outside measured bounded path');
-- Public readers themselves retain privacy under actual anonymous role.
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_vehicle_specs('00000000-0000-4000-8000-000000000105') IS NULL;
 ASSERT public.get_field_provenance('00000000-0000-4000-8000-000000000105','color') IS NULL;
END $$;
RESET ROLE;
SELECT count(*) AS reconciliation_checks_passed FROM checks;
ROLLBACK;
