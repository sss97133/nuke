-- Empty local PG17 only. Source capture through the actual existing owner and
-- INSERT triggers; synthetic source data, no network or production connection.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
  RAISE EXCEPTION 'Empty disposable dm_refinement database required';
 END IF;
END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END$$;
CREATE SCHEMA auth;
CREATE SCHEMA net;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
SET request.jwt.claim.role='service_role';
CREATE TYPE content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
CREATE TYPE vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TABLE vehicles(id uuid PRIMARY KEY,deleted_at timestamptz,merged_into_vehicle_id uuid,user_id uuid);
CREATE TABLE observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,source_id uuid,source_url text,source_identifier text,
 kind text,extraction_method text,analysis_deferred boolean,is_superseded boolean DEFAULT false,agent_model text,observed_at timestamptz,
 structured_data jsonb,extraction_metadata jsonb);
CREATE TABLE reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_type text,old_observation_id uuid,
 old_vehicle_id uuid,new_observation_id uuid,new_vehicle_id uuid,reason text,actor_user_id uuid);
CREATE TABLE image_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phash_hex text UNIQUE,content_hash_sha256 text,phash bytea,
 first_seen_source text,first_seen_path text,original_filename text,mime_type text,file_size_bytes bigint,width_px int,height_px int,
 exif_data jsonb,camera_make text,camera_model text,taken_at timestamptz,gps_latitude numeric,gps_longitude numeric,photographer_id uuid,
 observation_count int DEFAULT 1,updated_at timestamptz DEFAULT now());
CREATE TABLE image_appearances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_identity_id uuid,source_type text,source_path text,
 source_filename text,source_identifier text,content_hash text,seen_by uuid,metadata jsonb);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_identity_id uuid,image_url text,storage_path text,
 user_id uuid,documented_by_user_id uuid,documented_by_device text,is_external boolean,source text,file_hash text,perceptual_hash text,
 phash text,dhash text,vehicle_id uuid,taken_at timestamptz,latitude numeric,longitude numeric,mime_type text,file_size bigint,
 exif_data jsonb,ai_scan_metadata jsonb,apple_ml_labels text[],category text,image_type text,
 ai_processing_status text DEFAULT 'pending' CHECK(ai_processing_status IN ('pending','processing','completed','failed','skipped','analyzed')),
 is_approved boolean DEFAULT true,approval_status content_approval_status NOT NULL DEFAULT 'pending',submitted_by uuid,imported_by uuid,
 ghost_user_id uuid,approved_by uuid,approved_at timestamptz,timeline_event_id uuid,device_fingerprint text,
 is_duplicate boolean DEFAULT false,duplicate_of uuid,is_sensitive boolean DEFAULT false,is_superseded boolean DEFAULT false,
 is_primary boolean DEFAULT false,is_document boolean DEFAULT false,doc_flag boolean DEFAULT false,image_vehicle_match_status text,
 vision_gate_status vision_gate_status DEFAULT 'pending',updated_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,user_id uuid,event_type text,source text,
 event_date date,title text,description text,image_urls text[],metadata jsonb);
CREATE TABLE capture_relay_default_vehicle(user_id uuid,vehicle_id uuid,path_marker text,enabled boolean);
CREATE TABLE vehicle_user_permissions(vehicle_id uuid,user_id uuid,is_active boolean);
CREATE TABLE vehicle_contributor_roles(vehicle_id uuid,user_id uuid,is_active boolean);
CREATE TABLE device_attributions(image_id uuid,device_fingerprint text,ghost_user_id uuid,uploaded_by_user_id uuid,attribution_source text,confidence_score numeric);
CREATE TABLE fixture_calls(kind text,body jsonb);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_calls VALUES('http',body); RETURN 1; END$$;
CREATE FUNCTION get_service_url() RETURNS text LANGUAGE sql AS $$SELECT 'https://example.invalid'$$;
CREATE FUNCTION get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$SELECT 'fixture'$$;
CREATE FUNCTION vehicle_image_holds_wrong_bytes(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION auto_approve_vehicle_content(uuid,uuid) RETURNS content_approval_status LANGUAGE sql AS $$SELECT 'pending'::content_approval_status$$;
-- Device attribution is outside capture scope; the real trigger must not call
-- its identity-minting helper from library metadata nested under its source.
CREATE FUNCTION generate_device_fingerprint(jsonb) RETURNS text LANGUAGE sql AS $$SELECT
 coalesce($1->>'Make',$1->>'camera_make','Unknown')||'-'||coalesce($1->>'Model',$1->>'camera_model','Unknown')||'-'||
 coalesce($1->>'LensModel',$1->>'lens_model','Unknown')||'-'||coalesce($1->>'Software',$1->>'software',$1->>'synced_by','Unknown')$$;
CREATE FUNCTION get_or_create_ghost_user(text,text,text,text,text) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Unexpected photographer/device inference'; END$$;
\ir fixtures/deferred_photo_rendition_prior_owner.sql
\ir fixtures/deferred_photo_rendition_insert_owners.sql
\ir fixtures/deferred_photo_rendition_pipeline_owners.sql
CREATE TRIGGER a00_trg_capture_relay_default_vehicle BEFORE INSERT ON vehicle_images FOR EACH ROW
 WHEN(NEW.vehicle_id IS NULL AND NEW.user_id IS NOT NULL) EXECUTE FUNCTION capture_relay_default_vehicle_fn();
CREATE TRIGGER trg_auto_approve_vehicle_images BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION apply_auto_approval_for_image();
CREATE TRIGGER trg_auto_attribute_device AFTER INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION auto_attribute_image_to_device();
CREATE TRIGGER trg_auto_group_photos BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION auto_group_photos_into_events();
CREATE TRIGGER trg_flag_duplicate_image BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION flag_duplicate_image();
CREATE TRIGGER trg_mark_exif_extraction BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION mark_image_for_exif_extraction();
CREATE TRIGGER trg_set_vehicle_image_approval BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION set_vehicle_image_approval();
CREATE TRIGGER trg_vehicle_images_default_attribution BEFORE INSERT ON vehicle_images FOR EACH ROW EXECUTE FUNCTION vehicle_images_default_attribution();
CREATE TRIGGER trigger_photo_pipeline_on_image_insert AFTER INSERT ON vehicle_images FOR EACH ROW
 WHEN(NEW.ai_processing_status='pending' AND NEW.is_duplicate IS NOT TRUE AND NEW.is_external IS NOT TRUE)
 EXECUTE FUNCTION trigger_photo_pipeline_orchestrator();
CREATE FUNCTION t_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END$$;
CREATE FUNCTION wait_for_fixture_lock(pid integer) RETURNS void LANGUAGE plpgsql AS $$DECLARE deadline timestamptz:=clock_timestamp()+interval '3 seconds'; BEGIN
 LOOP
  PERFORM pg_stat_clear_snapshot();
  IF EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid=$1 AND a.wait_event_type='Lock') THEN RETURN; END IF;
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'fixture did not observe the expected concurrent lock'; END IF;
  PERFORM pg_sleep(0.01);
 END LOOP;
END$$;
CREATE FUNCTION fixture_payload() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object(
 'processing_mode','subscription_review','user_id','40000000-0000-4000-8000-000000000001',
 'image_url','https://example.invalid/preview.jpeg','source','iphoto','source_type','local_filesystem',
 'source_identifier','10000000-0000-4000-8000-000000000001','source_path','/private/fixture/cached.jpeg',
 'source_filename','cached.jpeg','original_filename','IMG_0001.HEIC','owner_verified',false,
 'content_sha256',repeat('a',64),'mime_type','image/jpeg','file_size_bytes',12345,'width_px',1000,'height_px',750,
 'taken_at','2026-04-27T17:31:07.519Z','gps_latitude',35.0,'gps_longitude',-115.0,
 'exif_data',jsonb_build_object('ZEXIFTIMESTAMPSTRING','2026:04:27 10:31:07','ZTIMEZONENAME','GMT-0700'),
 'source_provenance',jsonb_build_object('contract','photos_cached_preview_v1',
  'photos_asset_uuid','10000000-0000-4000-8000-000000000001','rendition_kind','cached_preview','rendition_sha256',repeat('a',64),
  'clock_basis','photos_library_retained_exif','captured_at','2026-04-27T17:31:07.519Z',
  'original_local_timestamp','2026:04:27 10:31:07','timezone_name','America/Los_Angeles','timezone_offset_seconds',-25200,
  'metadata_captured_at','2026-11-07T01:37:32Z','original_available_at_capture',false))$$;
-- Current behavior ignores the requested mode, creates a timeline event and
-- labels the library holder as own work when owner_verified is omitted.
SELECT ingest_image_identity_first((fixture_payload()-'owner_verified')||jsonb_build_object('content_sha256',repeat('b',64))) AS old \gset
SELECT t_assert(EXISTS(SELECT 1 FROM fixture_calls WHERE kind='http') AND EXISTS(SELECT 1 FROM timeline_events)
 AND EXISTS(SELECT 1 FROM vehicle_images WHERE id=(:'old'::jsonb->>'image_id')::uuid AND documented_by_user_id IS NOT NULL),
 'prior owner ignores defer and launches normal processing with inferred attribution');
\ir ../migrations/20261110025657_deferred_photo_rendition_intake.sql
SELECT count(*) AS old_events FROM timeline_events \gset
SELECT count(*) AS old_calls FROM fixture_calls \gset
SELECT ingest_image_identity_first(fixture_payload()) AS result \gset
SELECT t_assert(EXISTS(SELECT 1 FROM vehicle_images WHERE id=(:'result'::jsonb->>'image_id')::uuid
 AND vehicle_id IS NULL AND ai_processing_status='skipped' AND NOT is_approved AND documented_by_user_id IS NULL
 AND is_external AND timeline_event_id IS NULL AND file_hash=repeat('a',64)
 AND exif_data->'source_rendition'=fixture_payload()->'source_provenance'
 AND exif_data->>'uuid'=fixture_payload()->>'source_identifier'
 AND exif_data->>'capture_time_zone'='America/Los_Angeles'), 'deferred capture preserves exact source/clock without filing or work attribution');
SELECT t_assert((SELECT count(*) FROM timeline_events)=:old_events AND (SELECT count(*) FROM fixture_calls)=:old_calls
 AND NOT EXISTS(SELECT 1 FROM device_attributions), 'no pipeline request, generic pending event or inferred device claim');
SELECT t_assert(EXISTS(SELECT 1 FROM image_identities WHERE id=(:'result'::jsonb->>'identity_id')::uuid AND photographer_id IS NULL
 AND content_hash_sha256=repeat('a',64) AND width_px=1000)
 AND EXISTS(SELECT 1 FROM image_appearances WHERE id=(:'result'::jsonb->>'appearance_id')::uuid AND metadata->>'trust_class'='unknown'
 AND metadata->'source_provenance'=fixture_payload()->'source_provenance'), 'root and appearance retain rendition provenance without photographer claim');
SELECT ingest_image_identity_first(fixture_payload()) AS replay \gset
SELECT t_assert(:'replay'::jsonb->>'image_id'=:'result'::jsonb->>'image_id' AND (:'replay'::jsonb->>'reused_leaf')::boolean
 AND (SELECT count(*) FROM image_appearances WHERE content_hash=repeat('a',64))=1, 'replay is idempotent before any source writes');
CREATE FUNCTION expect_refusal(p jsonb,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM ingest_image_identity_first(p); RAISE EXCEPTION 'unexpected acceptance';
EXCEPTION WHEN OTHERS THEN IF SQLERRM<>expected THEN RAISE; END IF; RAISE NOTICE 'PASS: refused %',expected; END$$;
SELECT expect_refusal(fixture_payload()||'{"image_url":"https://example.invalid/replacement.jpeg"}', 'deferred_rendition_source_conflict');
SELECT expect_refusal(fixture_payload()||'{"original_filename":"replacement.HEIC"}', 'deferred_rendition_source_conflict');
SELECT expect_refusal(fixture_payload()||'{"vehicle_id":"20000000-0000-4000-8000-000000000001"}', 'invalid_deferred_rendition');
SELECT expect_refusal(fixture_payload()||'{"owner_verified":true}', 'invalid_deferred_rendition');
SELECT expect_refusal(fixture_payload()||'{"mime_type":"image/heic"}', 'invalid_deferred_rendition');
SELECT expect_refusal(fixture_payload()||'{"exif_data":[]}', 'invalid_deferred_rendition');
SELECT expect_refusal(jsonb_set(fixture_payload(),'{source_provenance,timezone_offset_seconds}','0'), 'invalid_deferred_capture_clock');
SELECT expect_refusal(jsonb_set(fixture_payload(),'{source_provenance,original_local_timestamp}','"2025:04:27 10:31:07"'), 'invalid_deferred_capture_clock');
SELECT expect_refusal(jsonb_set(fixture_payload(),'{source_provenance,rendition_sha256}','"bad"'), 'invalid_deferred_rendition');
SET request.jwt.claim.role='authenticated';
SELECT expect_refusal(fixture_payload(),'deferred_rendition_requires_service_role');
SET request.jwt.claim.role='service_role';
SELECT ingest_image_identity_first(fixture_payload()||'{"user_id":"40000000-0000-4000-8000-000000000002"}') AS second_custody \gset
SELECT t_assert(:'second_custody'::jsonb->>'image_id'<>:'result'::jsonb->>'image_id'
 AND :'second_custody'::jsonb->>'identity_id'=:'result'::jsonb->>'identity_id'
 AND :'second_custody'::jsonb->>'appearance_id'<>:'result'::jsonb->>'appearance_id', 'same bytes share content but never another custodian leaf/appearance');
-- Two actual PostgreSQL sessions race the same rendition; the second waits for
-- the first receipt, then reuses it without a second appearance or leaf.
CREATE EXTENSION dblink;
SELECT dblink_connect('capture_one',format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user));
SELECT dblink_connect('capture_two',format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('capture_one','BEGIN');
SELECT dblink_exec('capture_one','SET request.jwt.claim.role=''service_role''');
SELECT dblink_exec('capture_two','SET request.jwt.claim.role=''service_role''');
SELECT pid AS capture_pid FROM dblink('capture_two','SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT result AS concurrent_first FROM dblink('capture_one',
 $$SELECT ingest_image_identity_first(fixture_payload()||'{"user_id":"40000000-0000-4000-8000-000000000004"}')$$) AS t(result jsonb) \gset
SELECT dblink_send_query('capture_two',
 $$SELECT ingest_image_identity_first(fixture_payload()||'{"user_id":"40000000-0000-4000-8000-000000000004"}')$$);
SELECT wait_for_fixture_lock(:capture_pid);
SELECT t_assert(dblink_is_busy('capture_two')=1,'second simultaneous rendition is serialized');
SELECT dblink_exec('capture_one','COMMIT');
SELECT result AS concurrent_second FROM dblink_get_result('capture_two') AS t(result jsonb) \gset
SELECT t_assert(:'concurrent_first'::jsonb->>'image_id'=:'concurrent_second'::jsonb->>'image_id'
 AND (:'concurrent_second'::jsonb->>'reused_leaf')::boolean
 AND (SELECT count(*) FROM image_appearances WHERE seen_by='40000000-0000-4000-8000-000000000004')=1,
 'concurrent source intake retains one immutable appearance and one leaf');
SELECT dblink_disconnect('capture_one');
SELECT dblink_disconnect('capture_two');
-- A default-route configuration must not silently file a captured source.
INSERT INTO vehicles(id) VALUES('20000000-0000-4000-8000-000000000001');
INSERT INTO capture_relay_default_vehicle VALUES('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','preview.jpeg',true);
SELECT expect_refusal(fixture_payload()||'{"user_id":"40000000-0000-4000-8000-000000000003"}', 'deferred_rendition_intake_effect_changed');
SELECT t_assert(NOT EXISTS(SELECT 1 FROM vehicle_images WHERE user_id='40000000-0000-4000-8000-000000000003'), 'unexpected trigger filing rolls back source capture');
UPDATE vehicle_images SET is_superseded=true WHERE id=(:'result'::jsonb->>'image_id')::uuid;
SELECT expect_refusal(fixture_payload(),'deferred_rendition_source_conflict');
SELECT t_assert(NOT has_function_privilege('anon','public.ingest_image_identity_first(jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.ingest_image_identity_first(jsonb)','EXECUTE'), 'existing service-only boundary remains');
SELECT 'deferred photo rendition contract PASS';

-- The separately held classification producer must implement this exact
-- persisted contract. Here synthetic receipts exercise the source-bound writer.
INSERT INTO observation_sources(id,slug) VALUES('50000000-0000-4000-8000-000000000001','photo_pipeline');
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url,file_hash,taken_at,vision_gate_status,source,is_external)
 VALUES('6a000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000004','https://example.invalid/anchor.jpeg',repeat('c',64),'2026-04-27T17:35:00Z','approved','iphoto',true);
INSERT INTO vehicle_observations(id,source_id,source_url,source_identifier,kind,extraction_method,analysis_deferred,agent_model,observed_at,structured_data,extraction_metadata)
 SELECT '30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',image_url,
 'supplied_image_classification_v1:fixture','media','supplied_image_classification_v1',true,'fixture-reviewer',clock_timestamp(),
 jsonb_build_object('source_image_id',id,'classification','{"classifier_ok":true,"is_automotive":true,"image_medium":"photograph","image_type":"vehicle_interior","description":"A photographed cabin","v2":{"is_document":false,"vehicle_fields":[],"vin":null}}'::jsonb),
 jsonb_build_object('source',jsonb_build_object('image_url',image_url,'reviewed_url',image_url,'expected_updated_at',updated_at,
  'reviewed_sha256',file_hash,'reviewed_at',clock_timestamp()))
 FROM vehicle_images WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
UPDATE vehicle_images i SET ai_processing_status='completed',updated_at=clock_timestamp(),
 ai_scan_metadata=i.ai_scan_metadata||jsonb_build_object('classification',o.structured_data->'classification',
  'classification_review',jsonb_build_object('observation_id',o.id,'source_identifier',o.source_identifier)||(o.extraction_metadata->'source'))
 FROM vehicle_observations o WHERE o.id='30000000-0000-4000-8000-000000000001' AND i.id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
INSERT INTO vehicle_observations(id,source_id,source_url,source_identifier,kind,extraction_method,analysis_deferred,agent_model,observed_at,structured_data,extraction_metadata)
 SELECT '30000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001',image_url,
 'reviewed_image_attribution_v1:fixture','provenance','reviewed_image_attribution_v1',true,'fixture-reviewer',clock_timestamp(),
 jsonb_build_object('contract','reviewed_image_attribution_v1','source_image_id',id,'source_sha256',file_hash,
  'target_vehicle_id','20000000-0000-4000-8000-000000000001','classification_observation_id','30000000-0000-4000-8000-000000000001',
  'basis','visual_sequence','candidate_scope','Synthetic two-frame comparison; no global novelty claim','global_novelty_asserted',false,
  'contradictions','[]'::jsonb,'anchors',jsonb_build_array(jsonb_build_object('image_id','6a000000-0000-4000-8000-000000000001',
   'source_url','https://example.invalid/anchor.jpeg','source_sha256',repeat('c',64),'taken_at','2026-04-27T17:35:00Z')),
  'correspondences','[{"anchor_image_id":"6a000000-0000-4000-8000-000000000001","sequence_context":"The same visible cabin structure appears in adjacent captured frames.","features":[{"kind":"component_geometry","source_witness":"Asymmetric seat support geometry beside the tunnel","anchor_witness":"The same asymmetric support beside the same tunnel"},{"kind":"fixed_wear","source_witness":"A distinctive triangular tear at the cushion seam","anchor_witness":"The same tear at the same seam"}]}]'::jsonb),
 '{"is_inferred":true}' FROM vehicle_images WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
SELECT jsonb_build_object('image_url',image_url,'source_sha256',file_hash,'expected_updated_at',updated_at) AS expected_source
 FROM vehicle_images WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid \gset
CREATE FUNCTION expect_filing_refusal(image uuid,proof uuid,snapshot jsonb,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM public.attribute_testimony(image,proof,snapshot); RAISE EXCEPTION 'unexpected acceptance';
EXCEPTION WHEN OTHERS THEN IF SQLERRM<>expected THEN RAISE; END IF; RAISE NOTICE 'PASS: refused %',expected; END$$;
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb||'{"image_url":"https://example.invalid/replaced.jpeg"}','reviewed_filing_source_changed');
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb-'expected_updated_at','invalid_reviewed_filing_scope');
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb||'{"expected_updated_at":null}','invalid_reviewed_filing_scope');
UPDATE vehicle_observations SET observed_at=NULL WHERE id='30000000-0000-4000-8000-000000000002';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'invalid_reviewed_filing_proof');
UPDATE vehicle_observations SET observed_at=clock_timestamp() WHERE id='30000000-0000-4000-8000-000000000002';
SELECT extraction_metadata AS class_source_metadata FROM vehicle_observations WHERE id='30000000-0000-4000-8000-000000000001' \gset
UPDATE vehicle_observations SET extraction_metadata=extraction_metadata#-'{source,reviewed_at}' WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE vehicle_images SET ai_scan_metadata=ai_scan_metadata#-'{classification_review,reviewed_at}' WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_requires_current_physical_classification');
UPDATE vehicle_observations SET extraction_metadata=jsonb_set(extraction_metadata,'{source,reviewed_at}','null') WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(ai_scan_metadata,'{classification_review,reviewed_at}','null') WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_requires_current_physical_classification');
UPDATE vehicle_observations SET extraction_metadata=:'class_source_metadata'::jsonb WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(ai_scan_metadata,'{classification_review,reviewed_at}',:'class_source_metadata'::jsonb#>'{source,reviewed_at}') WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
UPDATE vehicle_images SET is_sensitive=true WHERE id='6a000000-0000-4000-8000-000000000001';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_anchor_changed');
UPDATE vehicle_images SET is_sensitive=false WHERE id='6a000000-0000-4000-8000-000000000001';
UPDATE vehicle_observations SET is_superseded=true WHERE id='30000000-0000-4000-8000-000000000001';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_classification_changed');
UPDATE vehicle_observations SET is_superseded=false WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE vehicle_images SET image_url='https://example.invalid/anchor-replaced.jpeg' WHERE id='6a000000-0000-4000-8000-000000000001';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_anchor_changed');
UPDATE vehicle_images SET image_url='https://example.invalid/anchor.jpeg' WHERE id='6a000000-0000-4000-8000-000000000001';
SELECT structured_data AS original_proof FROM vehicle_observations WHERE id='30000000-0000-4000-8000-000000000002' \gset
UPDATE vehicle_observations SET structured_data=jsonb_set(jsonb_set(structured_data,'{anchors}',
 (structured_data->'anchors')||jsonb_build_array(jsonb_set(structured_data#>'{anchors,0}','{image_id}','"6A000000-0000-4000-8000-000000000001"'))),
 '{correspondences}',(structured_data->'correspondences')||(structured_data->'correspondences'))
 WHERE id='30000000-0000-4000-8000-000000000002';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_duplicate_source');
UPDATE vehicle_observations SET structured_data=:'original_proof'::jsonb WHERE id='30000000-0000-4000-8000-000000000002';
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{correspondences,0,features}',
 '[{"kind":"work_state","source_witness":"Disassembled","anchor_witness":"Disassembled"},{"kind":"configuration","source_witness":"Black","anchor_witness":"Black"}]')
 WHERE id='30000000-0000-4000-8000-000000000002';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_requires_visible_correspondence');
UPDATE vehicle_observations SET structured_data=:'original_proof'::jsonb WHERE id='30000000-0000-4000-8000-000000000002';
-- A source change committed while the filing call waits on an anchor lock must
-- be observed after the lock, not accepted from its earlier statement snapshot.
SELECT dblink_connect('filing_race',format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('filing_race','SET request.jwt.claim.role=''service_role''');
SELECT pid AS filing_pid FROM dblink('filing_race','SELECT pg_backend_pid()') AS t(pid integer) \gset
BEGIN;
SELECT id FROM vehicle_images WHERE id='6a000000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT dblink_send_query('filing_race',format('SELECT expect_filing_refusal(%L::uuid,%L::uuid,%L::jsonb,%L)',
 :'concurrent_first'::jsonb->>'image_id','30000000-0000-4000-8000-000000000002',:'expected_source','reviewed_filing_anchor_changed'));
SELECT wait_for_fixture_lock(:filing_pid);
SELECT t_assert(dblink_is_busy('filing_race')=1,'filing waits for the anchor source lock');
UPDATE vehicle_images SET image_url='https://example.invalid/race-replacement.jpeg' WHERE id='6a000000-0000-4000-8000-000000000001';
COMMIT;
SELECT * FROM dblink_get_result('filing_race') AS t(result text);
SELECT dblink_disconnect('filing_race');
SELECT t_assert(NOT EXISTS(SELECT 1 FROM reattribution_audit),'source race did not file or audit');
UPDATE vehicle_images SET image_url='https://example.invalid/anchor.jpeg' WHERE id='6a000000-0000-4000-8000-000000000001';
SELECT dblink_connect('target_race',format('host=%s port=%s dbname=%s user=%s',current_setting('unix_socket_directories'),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('target_race','SET request.jwt.claim.role=''service_role''');
SELECT pid AS target_pid FROM dblink('target_race','SELECT pg_backend_pid()') AS t(pid integer) \gset
BEGIN;
SELECT id FROM vehicles WHERE id='20000000-0000-4000-8000-000000000001' FOR UPDATE;
SELECT dblink_send_query('target_race',format('SELECT expect_filing_refusal(%L::uuid,%L::uuid,%L::jsonb,%L)',
 :'concurrent_first'::jsonb->>'image_id','30000000-0000-4000-8000-000000000002',:'expected_source','reviewed_filing_target_unavailable'));
SELECT wait_for_fixture_lock(:target_pid);
SELECT t_assert(dblink_is_busy('target_race')=1,'filing waits for target availability lock');
UPDATE vehicles SET deleted_at=clock_timestamp() WHERE id='20000000-0000-4000-8000-000000000001';
COMMIT;
SELECT * FROM dblink_get_result('target_race') AS t(result text);
SELECT dblink_disconnect('target_race');
SELECT t_assert(NOT EXISTS(SELECT 1 FROM reattribution_audit),'target withdrawal race did not file or audit');
UPDATE vehicles SET deleted_at=NULL WHERE id='20000000-0000-4000-8000-000000000001';
-- Valid case-insensitive UUIDs resolve to the same physical source identity.
UPDATE vehicle_observations SET structured_data=jsonb_set(jsonb_set(structured_data,'{anchors,0,image_id}',
 '"6A000000-0000-4000-8000-000000000001"'),'{correspondences,0,anchor_image_id}','"6A000000-0000-4000-8000-000000000001"')
 WHERE id='30000000-0000-4000-8000-000000000002';
SET request.jwt.claim.role='authenticated';
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_requires_service_role');
SET request.jwt.claim.role='service_role';
SELECT count(*) AS before_filing_calls FROM fixture_calls \gset
SELECT attribute_testimony((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',:'expected_source'::jsonb) AS filed \gset
SELECT t_assert((:'filed'::jsonb->>'success')::boolean AND EXISTS(SELECT 1 FROM vehicle_images
 WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid AND vehicle_id='20000000-0000-4000-8000-000000000001'
 AND vision_gate_status='approved' AND documented_by_user_id IS NULL AND is_external AND file_hash=repeat('a',64)
 AND exif_data->'source_rendition'=fixture_payload()->'source_provenance'), 'current cited visual chain files source through existing audit owner without rewriting custody');
SELECT t_assert((SELECT count(*) FROM fixture_calls)=:before_filing_calls AND (SELECT count(*) FROM reattribution_audit)=1,
 'filing emits one attribution audit and no pipeline HTTP request');
SELECT attribute_testimony((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',:'expected_source'::jsonb) AS filed_replay \gset
SELECT t_assert(:'filed_replay'::jsonb->>'mode'='existing_reviewed_attribution' AND (SELECT count(*) FROM reattribution_audit)=1,
 'same source/proof replay stays idempotent after attribution clock changed');
UPDATE vehicle_images SET image_url='https://example.invalid/replaced-source.jpeg' WHERE id=(:'concurrent_first'::jsonb->>'image_id')::uuid;
SELECT expect_filing_refusal((:'concurrent_first'::jsonb->>'image_id')::uuid,'30000000-0000-4000-8000-000000000002',
 :'expected_source'::jsonb,'reviewed_filing_source_changed');
SELECT t_assert(NOT has_function_privilege('anon','public.attribute_testimony(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.attribute_testimony(uuid,uuid,jsonb)','EXECUTE'), 'source-bound filing is service-only');
SELECT 'source-bound first filing contract PASS';
